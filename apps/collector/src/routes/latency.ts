import { Hono } from "hono";
import { getDb } from "../db";

const latency = new Hono();

/** Latest ping window per target */
latency.get("/latest", (c) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM ping_windows
       WHERE id IN (
         SELECT MAX(id) FROM ping_windows GROUP BY target_id
       )
       ORDER BY target_id`
    )
    .all();
  return c.json(rows);
});

/** Historical ping data — ?since=ISO or all time */
latency.get("/history", (c) => {
  const since = c.req.query("since");
  const targetId = c.req.query("target");
  const db = getDb();

  const conditions: string[] = [];
  const params: string[] = [];

  if (since) {
    conditions.push("timestamp >= ?");
    params.push(since);
  }
  if (targetId) {
    conditions.push("target_id = ?");
    params.push(targetId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM ping_windows ${where} ORDER BY timestamp ASC`)
    .all(...params);
  return c.json(rows);
});

/** Individual RTTs for a specific window */
latency.get("/raw/:windowId", (c) => {
  const windowId = parseInt(c.req.param("windowId"), 10);
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM ping_samples WHERE window_id = ? ORDER BY seq ASC")
    .all(windowId);
  return c.json(rows);
});

export { latency };
