import { Hono } from "hono";
import { getDb } from "../db";

const throughput = new Hono();

/** Compute WAN-adjusted speed fields for a test row */
function enrichWithWan(row: any): any {
  if (!row) return row;
  const wanDelta = row.direction === "upload" ? row.wan_tx_delta : row.wan_rx_delta;
  const wanSpeedMbps =
    wanDelta != null && row.duration_ms > 0
      ? Math.round(((wanDelta * 8) / (row.duration_ms / 1000) / 1_000_000) * 100) / 100
      : null;
  const adjustedSpeedMbps =
    wanSpeedMbps != null
      ? Math.round(Math.max(row.speed_mbps, wanSpeedMbps) * 100) / 100
      : row.speed_mbps;
  return { ...row, wan_speed_mbps: wanSpeedMbps, adjusted_speed_mbps: adjustedSpeedMbps };
}

/** Latest single + multi stream tests (download + upload) */
throughput.get("/latest", (c) => {
  const db = getDb();

  // Download latest
  const dlSingle = enrichWithWan(db
    .prepare(
      `SELECT * FROM throughput_tests
       WHERE stream_count = 1 AND direction = 'download'
       ORDER BY id DESC LIMIT 1`
    )
    .get());

  const dlMulti = enrichWithWan(db
    .prepare(
      `SELECT * FROM throughput_tests
       WHERE stream_count > 1 AND direction = 'download'
       ORDER BY id DESC LIMIT 1`
    )
    .get());

  const dlSingleSpeed = dlSingle?.speed_mbps || 0;
  const dlMultiSpeed = dlMulti?.speed_mbps || 0;
  const dlRatio = dlSingleSpeed > 0 ? Math.round((dlMultiSpeed / dlSingleSpeed) * 100) / 100 : null;

  // WAN-adjusted ratio for download
  const dlAdjSingleSpeed = dlSingle?.adjusted_speed_mbps || 0;
  const dlAdjMultiSpeed = dlMulti?.adjusted_speed_mbps || 0;
  const dlAdjustedRatio = dlAdjSingleSpeed > 0 ? Math.round((dlAdjMultiSpeed / dlAdjSingleSpeed) * 100) / 100 : null;

  // Upload latest
  const ulSingle = enrichWithWan(db
    .prepare(
      `SELECT * FROM throughput_tests
       WHERE stream_count = 1 AND direction = 'upload'
       ORDER BY id DESC LIMIT 1`
    )
    .get());

  const ulMulti = enrichWithWan(db
    .prepare(
      `SELECT * FROM throughput_tests
       WHERE stream_count > 1 AND direction = 'upload'
       ORDER BY id DESC LIMIT 1`
    )
    .get());

  const ulSingleSpeed = ulSingle?.speed_mbps || 0;
  const ulMultiSpeed = ulMulti?.speed_mbps || 0;
  const ulRatio = ulSingleSpeed > 0 ? Math.round((ulMultiSpeed / ulSingleSpeed) * 100) / 100 : null;

  // WAN-adjusted ratio for upload
  const ulAdjSingleSpeed = ulSingle?.adjusted_speed_mbps || 0;
  const ulAdjMultiSpeed = ulMulti?.adjusted_speed_mbps || 0;
  const ulAdjustedRatio = ulAdjSingleSpeed > 0 ? Math.round((ulAdjMultiSpeed / ulAdjSingleSpeed) * 100) / 100 : null;

  // Backward-compat: single/multi/ratio still point to download
  return c.json({
    single: dlSingle,
    multi: dlMulti,
    ratio: dlRatio,
    adjustedRatio: dlAdjustedRatio,
    download: { single: dlSingle, multi: dlMulti, ratio: dlRatio, adjustedRatio: dlAdjustedRatio },
    upload: { single: ulSingle, multi: ulMulti, ratio: ulRatio, adjustedRatio: ulAdjustedRatio },
  });
});

/** Throughput history — ?since=ISO or all time.
 *  Only returns tests from complete sessions (both single + multi for each direction).
 *  Pre-migration rows (NULL session_id) are always included. */
throughput.get("/history", (c) => {
  const since = c.req.query("since");
  const db = getDb();

  const sinceClause = since ? "AND t.timestamp >= ?" : "";
  const params = since ? [since] : [];
  const rows = db
    .prepare(
      `SELECT t.* FROM throughput_tests t
       WHERE (
         t.session_id IS NULL
         OR EXISTS (
           SELECT 1 FROM throughput_tests t2
           WHERE t2.session_id = t.session_id
             AND t2.direction = t.direction
             AND ((t.stream_count = 1 AND t2.stream_count > 1)
               OR (t.stream_count > 1 AND t2.stream_count = 1))
         )
       )
       ${sinceClause}
       ORDER BY t.timestamp ASC`
    )
    .all(...params);
  return c.json(rows);
});

/** Per-second timeseries for a specific test */
throughput.get("/timeseries/:testId", (c) => {
  const testId = parseInt(c.req.param("testId"), 10);
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM throughput_timeseries WHERE test_id = ? ORDER BY second_offset ASC"
    )
    .all(testId);
  return c.json(rows);
});

/** Trigger a manual speed test */
throughput.post("/trigger", async (c) => {
  // Import dynamically to avoid circular deps
  const { ThroughputCollector } = await import("../collectors/throughput.collector");
  const collector = new ThroughputCollector();
  collector.collect().catch((e) => console.error("[throughput/trigger]", e));
  return c.json({ status: "triggered" });
});

export { throughput };
