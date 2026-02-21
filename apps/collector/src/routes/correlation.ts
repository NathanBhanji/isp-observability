import { Hono } from "hono";
import { getDb } from "../db";

const correlation = new Hono();

/** Latest correlation session */
correlation.get("/latest", (c) => {
  const db = getDb();

  // Get the latest session ID
  const latest = db
    .prepare(
      `SELECT DISTINCT session_id, MAX(timestamp) as timestamp
       FROM correlation_samples
       GROUP BY session_id
       ORDER BY timestamp DESC
       LIMIT 1`
    )
    .get() as { session_id: string; timestamp: string } | null;

  if (!latest) return c.json(null);

  const samples = db
    .prepare(
      `SELECT * FROM correlation_samples
       WHERE session_id = ?
       ORDER BY timestamp ASC`
    )
    .all(latest.session_id);

  // Get the pearson_r values (stored on last sample per target)
  const correlations = db
    .prepare(
      `SELECT target_id, pearson_r FROM correlation_samples
       WHERE session_id = ? AND pearson_r IS NOT NULL`
    )
    .all(latest.session_id);

  return c.json({
    sessionId: latest.session_id,
    timestamp: latest.timestamp,
    samples,
    correlations,
  });
});

/** Correlation history — ?since=ISO or all time */
correlation.get("/history", (c) => {
  const since = c.req.query("since");
  const db = getDb();

  const where = since ? "WHERE timestamp >= ? AND pearson_r IS NOT NULL" : "WHERE pearson_r IS NOT NULL";
  const params = since ? [since] : [];

  const sessions = db
    .prepare(
      `SELECT session_id, target_id, pearson_r, MAX(timestamp) as timestamp
       FROM correlation_samples
       ${where}
       GROUP BY session_id, target_id
       ORDER BY timestamp ASC`
    )
    .all(...params);

  return c.json(sessions);
});

export { correlation };
