import { ROUTER_IP } from "@isp/shared";
import type { Collector } from "../scheduler";
import { getDb } from "../db";

/**
 * Heartbeat collector — lightweight gateway ping every 5 seconds.
 *
 * Does NOT store every ping result (that would be 17,280 rows/day).
 * Instead, tracks consecutive failures in memory and only writes
 * an outage record to the DB when connectivity drops and recovers.
 *
 * An "outage" is defined as 3+ consecutive missed pings (>= 15 seconds).
 */
export class HeartbeatCollector implements Collector {
  name = "heartbeat";
  interval = 5_000; // 5 seconds

  private consecutiveFailures = 0;
  private outageStartTime: string | null = null;
  private currentOutageId: number | null = null;

  /** Minimum consecutive failures before recording an outage */
  private static readonly OUTAGE_THRESHOLD = 3;

  async collect(): Promise<string | void> {
    const reachable = await this.pingGateway();

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
      // Gateway is reachable — close any open outage
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
   * Single ICMP ping to the gateway with 2 second timeout.
   * Returns true if gateway responds, false otherwise.
   */
  private async pingGateway(): Promise<boolean> {
    try {
      const proc = Bun.spawn(
        ["ping", "-c", "1", "-W", "2", ROUTER_IP],
        { stdout: "pipe", stderr: "pipe" }
      );
      const code = await proc.exited;
      return code === 0;
    } catch {
      return false;
    }
  }
}
