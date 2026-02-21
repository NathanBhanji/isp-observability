import { Hono } from "hono";
import { getDb } from "../db";

const throughput = new Hono();

/** Latest single + multi stream tests (download + upload) */
throughput.get("/latest", (c) => {
  const db = getDb();

  // Download latest
  const dlSingle = db
    .prepare(
      `SELECT * FROM throughput_tests
       WHERE stream_count = 1 AND direction = 'download'
       ORDER BY id DESC LIMIT 1`
    )
    .get();

  const dlMulti = db
    .prepare(
      `SELECT * FROM throughput_tests
       WHERE stream_count > 1 AND direction = 'download'
       ORDER BY id DESC LIMIT 1`
    )
    .get();

  const dlSingleSpeed = (dlSingle as any)?.speed_mbps || 0;
  const dlMultiSpeed = (dlMulti as any)?.speed_mbps || 0;
  const dlRatio = dlSingleSpeed > 0 ? Math.round((dlMultiSpeed / dlSingleSpeed) * 100) / 100 : null;

  // Upload latest
  const ulSingle = db
    .prepare(
      `SELECT * FROM throughput_tests
       WHERE stream_count = 1 AND direction = 'upload'
       ORDER BY id DESC LIMIT 1`
    )
    .get();

  const ulMulti = db
    .prepare(
      `SELECT * FROM throughput_tests
       WHERE stream_count > 1 AND direction = 'upload'
       ORDER BY id DESC LIMIT 1`
    )
    .get();

  const ulSingleSpeed = (ulSingle as any)?.speed_mbps || 0;
  const ulMultiSpeed = (ulMulti as any)?.speed_mbps || 0;
  const ulRatio = ulSingleSpeed > 0 ? Math.round((ulMultiSpeed / ulSingleSpeed) * 100) / 100 : null;

  // Backward-compat: single/multi/ratio still point to download
  return c.json({
    single: dlSingle,
    multi: dlMulti,
    ratio: dlRatio,
    download: { single: dlSingle, multi: dlMulti, ratio: dlRatio },
    upload: { single: ulSingle, multi: ulMulti, ratio: ulRatio },
  });
});

/** Throughput history — ?since=ISO or all time */
throughput.get("/history", (c) => {
  const since = c.req.query("since");
  const db = getDb();

  const where = since ? "WHERE timestamp >= ?" : "";
  const params = since ? [since] : [];
  const rows = db
    .prepare(`SELECT * FROM throughput_tests ${where} ORDER BY timestamp ASC`)
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
