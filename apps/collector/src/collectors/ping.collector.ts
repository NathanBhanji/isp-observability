import { PING_TARGETS, PING_TARGETS_V6, THRESHOLDS, INTERVALS } from "@isp/shared";
import type { Collector } from "../scheduler";
import { getDb } from "../db";
import { runPing } from "../lib/ping";
import { computeRttStats } from "../lib/stats";

export class PingCollector implements Collector {
  name = "ping";
  interval = INTERVALS.ping;

  /** Track whether IPv6 is available (skip if first attempt fails) */
  private ipv6Available: boolean | null = null;

  async collect(): Promise<void> {
    const db = getDb();
    const timestamp = new Date().toISOString();

    // Determine IPv6 targets to include
    let v6Targets: readonly { id: string; ip: string; label: string; hop: number }[] = [];
    if (this.ipv6Available !== false) {
      v6Targets = PING_TARGETS_V6;
    }

    const allTargets = [...PING_TARGETS, ...v6Targets];

    // Run pings to all targets in parallel
    const results = await Promise.allSettled(
      allTargets.map(async (target) => {
        const samples = await runPing(target.ip);
        const rtts = samples.map((s) => s.rttMs);
        const stats = computeRttStats(rtts, THRESHOLDS.spikeMs);

        // Insert ping window
        const insertWindow = db.prepare(`
          INSERT INTO ping_windows (
            target_id, target_ip, timestamp,
            samples_sent, samples_received, loss_pct,
            rtt_min, rtt_max, rtt_mean, rtt_median, rtt_stddev,
            rtt_p50, rtt_p90, rtt_p95, rtt_p99,
            jitter_mean, jitter_max,
            spikes_10ms, spikes_15ms, spikes_20ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = insertWindow.run(
          target.id,
          target.ip,
          timestamp,
          stats.sent,
          stats.received,
          stats.lossPct,
          stats.min,
          stats.max,
          stats.mean,
          stats.median,
          stats.stddev,
          stats.p50,
          stats.p90,
          stats.p95,
          stats.p99,
          stats.jitterMean,
          stats.jitterMax,
          stats.spikes[10] || 0,
          stats.spikes[15] || 0,
          stats.spikes[20] || 0
        );

        const windowId = Number(result.lastInsertRowid);

        // Insert individual samples
        const insertSample = db.prepare(`
          INSERT INTO ping_samples (window_id, seq, rtt_ms, timestamp)
          VALUES (?, ?, ?, ?)
        `);

        const insertMany = db.transaction((rows: { seq: number; rttMs: number | null; timestamp: string }[]) => {
          for (const sample of rows) {
            insertSample.run(windowId, sample.seq, sample.rttMs, sample.timestamp);
          }
        });
        insertMany(samples);

        console.log(
          `[ping] ${target.id} (${target.ip}): ` +
            `mean=${stats.mean}ms stddev=${stats.stddev}ms loss=${stats.lossPct}%`
        );
      })
    );

    // Log any failures and detect IPv6 availability
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        const targetId = allTargets[i].id;
        console.error(
          `[ping] Failed for ${targetId}:`,
          (results[i] as PromiseRejectedResult).reason
        );

        // If an IPv6 target fails, disable IPv6 for future runs
        if (targetId.endsWith("_v6") && this.ipv6Available === null) {
          console.warn("[ping] IPv6 target unreachable — disabling IPv6 ping targets");
          this.ipv6Available = false;
        }
      } else if (allTargets[i].id.endsWith("_v6") && this.ipv6Available === null) {
        this.ipv6Available = true;
        console.log("[ping] IPv6 connectivity confirmed");
      }
    }
  }
}
