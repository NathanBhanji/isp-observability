import { INTERVALS, TRACEROUTE_DESTINATIONS, TRACEROUTE_DESTINATIONS_V6 } from "@isp/shared";
import type { Collector } from "../scheduler";
import { getDb } from "../db";
import { runTraceroute } from "../lib/traceroute";

export class TracerouteCollector implements Collector {
  name = "traceroute";
  interval = INTERVALS.traceroute;

  /** Track whether IPv6 traceroute works */
  private ipv6Available: boolean | null = null;

  async collect(): Promise<void> {
    const db = getDb();
    const timestamp = new Date().toISOString();

    const insertTrace = db.prepare(`
      INSERT INTO traceroutes (destination, timestamp, hop_count, responding_hops, dark_hops, path_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertHop = db.prepare(`
      INSERT INTO traceroute_hops (traceroute_id, hop_number, ip, hostname, rtt_ms)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Include IPv6 destinations if available
    const allDestinations = [
      ...TRACEROUTE_DESTINATIONS,
      ...(this.ipv6Available !== false ? TRACEROUTE_DESTINATIONS_V6 : []),
    ];

    // Run traceroutes sequentially to avoid resource contention
    for (const dest of allDestinations) {
      try {
        const result = await runTraceroute(dest);
        const respondingHops = result.hops.filter((h) => h.ip !== null).length;
        const darkHops = result.hops.filter((h) => h.ip === null).length;

        const traceResult = insertTrace.run(
          dest,
          timestamp,
          result.hops.length,
          respondingHops,
          darkHops,
          result.pathHash
        );
        const traceId = Number(traceResult.lastInsertRowid);

        const insertHops = db.transaction(() => {
          for (const hop of result.hops) {
            insertHop.run(traceId, hop.hopNumber, hop.ip, hop.hostname, hop.rttMs);
          }
        });
        insertHops();

        console.log(
          `[traceroute] ${dest}: ${result.hops.length} hops ` +
            `(${respondingHops} responding, ${darkHops} dark)`
        );
      } catch (e) {
        console.error(`[traceroute] Failed for ${dest}:`, (e as Error).message);
        // Disable IPv6 if an IPv6 traceroute fails
        if (dest.includes(":") && this.ipv6Available === null) {
          console.warn("[traceroute] IPv6 destination unreachable — disabling IPv6 traceroutes");
          this.ipv6Available = false;
        }
      }
    }
  }
}
