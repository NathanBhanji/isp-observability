import type { Collector } from "../scheduler";
import { getDb } from "../db";

/**
 * Heartbeat collector — lightweight HTTP connectivity check every 5 seconds.
 *
 * Uses HTTP health-check endpoints (Google generate_204 + Cloudflare) instead
 * of gateway ICMP ping. This detects actual ISP outages (WAN link down) rather
 * than just local router reachability.
 *
 * Does NOT store every check result (that would be 17,280 rows/day).
 * Instead, tracks consecutive failures in memory and only writes
 * an outage record to the DB when connectivity drops and recovers.
 *
 * An "outage" is defined as 3+ consecutive failed checks (>= 15 seconds).
 */

/** Endpoints to check — if ANY succeeds, we have connectivity */
const HEALTH_ENDPOINTS = [
  "http://clients3.google.com/generate_204",
  "http://1.1.1.1/cdn-cgi/trace",
];

/** Timeout for each HTTP request (ms) */
const REQUEST_TIMEOUT = 3_000;

export class HeartbeatCollector implements Collector {
  name = "heartbeat";
  interval = 5_000; // 5 seconds

  private consecutiveFailures = 0;
  private outageStartTime: string | null = null;
  private currentOutageId: number | null = null;

  /** Minimum consecutive failures before recording an outage */
  private static readonly OUTAGE_THRESHOLD = 3;

  async collect(): Promise<string | void> {
    const reachable = await this.checkConnectivity();

    if (!reachable) {
      this.consecutiveFailures++;

      // Start tracking a new outage
      if (
        this.consecutiveFailures === HeartbeatCollector.OUTAGE_THRESHOLD &&
        !this.outageStartTime
      ) {
        // Backdate the start to when failures began
        this.outageStartTime = new Date(
          Date.now() - (HeartbeatCollector.OUTAGE_THRESHOLD - 1) * 5000
        ).toISOString();

        const db = getDb();
        const result = db
          .prepare(
            `INSERT INTO outages (started_at, missed_pings) VALUES (?, ?)`
          )
          .run(this.outageStartTime, this.consecutiveFailures);
        this.currentOutageId = Number(result.lastInsertRowid);

        console.warn(
          `[heartbeat] OUTAGE STARTED at ${this.outageStartTime} ` +
            `(${this.consecutiveFailures} consecutive failures)`
        );
      } else if (
        this.consecutiveFailures > HeartbeatCollector.OUTAGE_THRESHOLD &&
        this.currentOutageId
      ) {
        // Update the ongoing outage with current miss count
        const db = getDb();
        db.prepare(
          `UPDATE outages SET missed_pings = ? WHERE id = ?`
        ).run(this.consecutiveFailures, this.currentOutageId);
      }
    } else {
      // Internet is reachable — close any open outage
      if (this.outageStartTime && this.currentOutageId) {
        const endedAt = new Date().toISOString();
        const durationMs =
          new Date(endedAt).getTime() -
          new Date(this.outageStartTime).getTime();

        const db = getDb();
        db.prepare(
          `UPDATE outages SET ended_at = ?, duration_ms = ?, missed_pings = ?
           WHERE id = ?`
        ).run(endedAt, durationMs, this.consecutiveFailures, this.currentOutageId);

        console.warn(
          `[heartbeat] OUTAGE ENDED — duration ${(durationMs / 1000).toFixed(1)}s ` +
            `(${this.consecutiveFailures} missed pings)`
        );
      }

      this.consecutiveFailures = 0;
      this.outageStartTime = null;
      this.currentOutageId = null;
    }
  }

  /**
   * Check internet connectivity by hitting well-known HTTP endpoints.
   * Returns true if ANY endpoint responds successfully.
   *
   * Uses HTTP rather than ICMP because:
   * - Some ISPs/routers drop or deprioritize ICMP
   * - HTTP checks verify L7 connectivity, not just L3
   * - Google's generate_204 and Cloudflare's trace are highly available
   */
  private async checkConnectivity(): Promise<boolean> {
    const checks = HEALTH_ENDPOINTS.map((url) =>
      Promise.race([
        fetch(url, { redirect: "manual" })
          .then((r) => r.status >= 200 && r.status < 400)
          .catch(() => false),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), REQUEST_TIMEOUT)
        ),
      ])
    );

    const results = await Promise.all(checks);
    return results.some((ok) => ok);
  }
}
