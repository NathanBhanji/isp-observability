import { RETENTION, RETENTION_INTERVAL } from "@isp/shared";
import type { Collector } from "../scheduler";
import { getDb } from "../db";

/**
 * Data retention collector — prunes old rows from every table
 * according to the configured retention periods.
 *
 * Uses DELETE with a cutoff timestamp. SQLite's `datetime()` function
 * handles the ISO-8601 strings stored in our `timestamp` columns.
 *
 * Child rows (ping_samples, throughput_timeseries, traceroute_hops)
 * are deleted first via their parent foreign keys to respect
 * PRAGMA foreign_keys = ON.
 */
export class RetentionCollector implements Collector {
  name = "retention";
  interval = RETENTION_INTERVAL;

  async collect(): Promise<string | void> {
    const db = getDb();
    let totalDeleted = 0;

    const prune = (
      label: string,
      statements: { sql: string; days: number }[]
    ) => {
      for (const { sql, days } of statements) {
        const cutoff = new Date(
          Date.now() - days * 24 * 60 * 60 * 1000
        ).toISOString();
        const result = db.prepare(sql).run(cutoff);
        const deleted = result.changes;
        if (deleted > 0) {
          console.log(
            `[retention] ${label}: deleted ${deleted} rows older than ${days}d`
          );
          totalDeleted += deleted;
        }
      }
    };

    db.transaction(() => {
      // ── Ping (child first) ──────────────────────────────────
      prune("ping_samples", [
        {
          sql: `DELETE FROM ping_samples WHERE window_id IN (
                  SELECT id FROM ping_windows WHERE timestamp < ?
                )`,
          days: RETENTION.pingDays,
        },
      ]);
      prune("ping_windows", [
        {
          sql: `DELETE FROM ping_windows WHERE timestamp < ?`,
          days: RETENTION.pingDays,
        },
      ]);

      // ── Throughput (child first) ────────────────────────────
      prune("throughput_timeseries", [
        {
          sql: `DELETE FROM throughput_timeseries WHERE test_id IN (
                  SELECT id FROM throughput_tests WHERE timestamp < ?
                )`,
          days: RETENTION.throughputDays,
        },
      ]);
      prune("throughput_tests", [
        {
          sql: `DELETE FROM throughput_tests WHERE timestamp < ?`,
          days: RETENTION.throughputDays,
        },
      ]);

      // ── Correlation ─────────────────────────────────────────
      prune("correlation_samples", [
        {
          sql: `DELETE FROM correlation_samples WHERE timestamp < ?`,
          days: RETENTION.correlationDays,
        },
      ]);

      // ── Traceroute (child first) ────────────────────────────
      prune("traceroute_hops", [
        {
          sql: `DELETE FROM traceroute_hops WHERE traceroute_id IN (
                  SELECT id FROM traceroutes WHERE timestamp < ?
                )`,
          days: RETENTION.tracerouteDays,
        },
      ]);
      prune("traceroutes", [
        {
          sql: `DELETE FROM traceroutes WHERE timestamp < ?`,
          days: RETENTION.tracerouteDays,
        },
      ]);

      // ── RIPE Atlas ──────────────────────────────────────────
      prune("ripe_atlas_results", [
        {
          sql: `DELETE FROM ripe_atlas_results WHERE timestamp < ?`,
          days: RETENTION.ripeAtlasDays,
        },
      ]);

      // ── Router Status ───────────────────────────────────────
      prune("router_status", [
        {
          sql: `DELETE FROM router_status WHERE timestamp < ?`,
          days: RETENTION.routerDays,
        },
      ]);

      // ── Outages ────────────────────────────────────────────
      prune("outages", [
        {
          sql: `DELETE FROM outages WHERE started_at < ?`,
          days: RETENTION.routerDays, // Same retention as router (30 days)
        },
      ]);
    })();

    if (totalDeleted > 0) {
      console.log(
        `[retention] Total: pruned ${totalDeleted} rows across all tables`
      );
    } else {
      console.log("[retention] Nothing to prune");
    }
  }
}
