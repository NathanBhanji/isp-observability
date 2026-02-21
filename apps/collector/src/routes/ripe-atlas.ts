import { Hono } from "hono";
import { getDb } from "../db";

const ripeAtlas = new Hono();

/** Latest RIPE Atlas results */
ripeAtlas.get("/latest", (c) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, probe_id, destination, timestamp, hop_count,
              matched_target_ids, transit_rtt_ms, raw_json
       FROM ripe_atlas_results
       WHERE id IN (
         SELECT MAX(id) FROM ripe_atlas_results GROUP BY probe_id, destination
       )
       ORDER BY probe_id, destination`
    )
    .all();
  return c.json(rows);
});

/** RIPE Atlas history — ?since=ISO or all time */
ripeAtlas.get("/history", (c) => {
  const since = c.req.query("since");
  const db = getDb();

  const where = since ? "WHERE timestamp >= ?" : "";
  const params = since ? [since] : [];

  const rows = db
    .prepare(
      `SELECT id, probe_id, destination, timestamp, hop_count, matched_target_ids, transit_rtt_ms
       FROM ripe_atlas_results
       ${where}
       ORDER BY timestamp ASC`
    )
    .all(...params);
  return c.json(rows);
});

export { ripeAtlas };
