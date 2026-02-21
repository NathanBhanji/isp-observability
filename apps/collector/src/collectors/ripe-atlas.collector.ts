import { INTERVALS, TRACEROUTE_DESTINATIONS } from "@isp/shared";
import type { Collector } from "../scheduler";
import { getDb } from "../db";
import { fetchProbeTraceroutes, discoverProbesForAsn } from "../lib/ripe-api";

export class RipeAtlasCollector implements Collector {
  name = "ripe-atlas";
  interval = INTERVALS.ripeAtlas;

  async collect(): Promise<void> {
    const db = getDb();
    const timestamp = new Date().toISOString();

    // Auto-discover all active probes on our ASN
    const probeIds = await discoverProbesForAsn();
    console.log(`[ripe-atlas] Collecting from ${probeIds.length} probes`);

    // INSERT OR IGNORE: the unique index on (probe_id, destination, measured_at) prevents duplicates
    const insertResult = db.prepare(`
      INSERT OR IGNORE INTO ripe_atlas_results (
        probe_id, destination, timestamp, hop_count, traverses_bcube,
        matched_target_ids, transit_rtt_ms, raw_json, measured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalInserted = 0;
    let totalSkipped = 0;

    for (const probeId of probeIds) {
      try {
        const traceroutes = await fetchProbeTraceroutes(
          probeId,
          [...TRACEROUTE_DESTINATIONS]
        );

        const insertMany = db.transaction(() => {
          for (const tr of traceroutes) {
            // Legacy column: set traverses_bcube based on whether 'bcube' is in matched targets
            const traversesBcube = tr.matchedTargetIds.split(",").includes("bcube") ? 1 : 0;
            const result = insertResult.run(
              tr.probeId,
              tr.destination,
              timestamp,
              tr.hopCount,
              traversesBcube,
              tr.matchedTargetIds,
              tr.transitRttMs,
              tr.rawJson,
              tr.measuredAt
            );
            if (result.changes > 0) {
              totalInserted++;
            } else {
              totalSkipped++;
            }
          }
        });
        insertMany();

        console.log(
          `[ripe-atlas] Probe ${probeId}: ${traceroutes.length} results fetched`
        );
      } catch (e) {
        console.error(
          `[ripe-atlas] Failed for probe ${probeId}:`,
          (e as Error).message
        );
      }
    }

    console.log(
      `[ripe-atlas] Done: ${totalInserted} new results inserted, ${totalSkipped} duplicates skipped`
    );
  }
}
