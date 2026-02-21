import { Hono } from "hono";
import { getDb } from "../db";

const outages = new Hono();

/** Get all outages — ?since=ISO or all time */
outages.get("/", (c) => {
  const since = c.req.query("since");
  const db = getDb();

  const where = since ? "WHERE started_at >= ?" : "";
  const params = since ? [since] : [];
  const rows = db
    .prepare(`SELECT * FROM outages ${where} ORDER BY started_at DESC`)
    .all(...params);
  return c.json(rows);
});

/** Get outage summary stats — ?since=ISO or all time */
outages.get("/summary", (c) => {
  const since = c.req.query("since");
  const db = getDb();

  const where = since ? "WHERE started_at >= ?" : "";
  const params = since ? [since] : [];

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) as total_outages,
         SUM(duration_ms) as total_duration_ms,
         MAX(duration_ms) as longest_ms,
         AVG(duration_ms) as avg_ms,
         SUM(missed_pings) as total_missed_pings
       FROM outages ${where}`
    )
    .get(...params) as any;

  const recent = db
    .prepare(
      `SELECT * FROM outages ${where} ORDER BY started_at DESC LIMIT 10`
    )
    .all(...params);

  return c.json({
    totalOutages: stats?.total_outages ?? 0,
    totalDurationMs: stats?.total_duration_ms ?? 0,
    longestMs: stats?.longest_ms ?? 0,
    avgMs: Math.round((stats?.avg_ms ?? 0) * 100) / 100,
    totalMissedPings: stats?.total_missed_pings ?? 0,
    recent,
  });
});

export { outages };
