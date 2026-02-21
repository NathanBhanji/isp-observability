import { Hono } from "hono";
import { getDb } from "../db";

const tracerouteRoute = new Hono();

/** Latest traceroute per destination */
tracerouteRoute.get("/latest", (c) => {
  const db = getDb();

  const traces = db
    .prepare(
      `SELECT * FROM traceroutes
       WHERE id IN (
         SELECT MAX(id) FROM traceroutes GROUP BY destination
       )
       ORDER BY destination`
    )
    .all();

  // Attach hops to each traceroute
  const withHops = (traces as any[]).map((t) => {
    const hops = db
      .prepare(
        "SELECT * FROM traceroute_hops WHERE traceroute_id = ? ORDER BY hop_number ASC"
      )
      .all(t.id);
    return { ...t, hops };
  });

  return c.json(withHops);
});

/** Traceroute history — ?since=ISO or all time */
tracerouteRoute.get("/history", (c) => {
  const since = c.req.query("since");
  const dest = c.req.query("destination");
  const db = getDb();

  const conditions: string[] = [];
  const params: string[] = [];

  if (since) {
    conditions.push("timestamp >= ?");
    params.push(since);
  }
  if (dest) {
    conditions.push("destination = ?");
    params.push(dest);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const traces = db
    .prepare(`SELECT * FROM traceroutes ${where} ORDER BY timestamp ASC`)
    .all(...params);

  return c.json(traces);
});

/** Per-hop latency trends over time — ?since=ISO, ?ip=X.X.X.X */
tracerouteRoute.get("/hop-trends", (c) => {
  const since = c.req.query("since");
  const ip = c.req.query("ip");
  const db = getDb();

  const conditions: string[] = ["h.rtt_ms IS NOT NULL"];
  const params: any[] = [];

  if (since) {
    conditions.push("t.timestamp >= ?");
    params.push(since);
  }
  if (ip) {
    conditions.push("h.ip = ?");
    params.push(ip);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT
         h.ip,
         h.hostname,
         date(t.timestamp) as day,
         AVG(h.rtt_ms) as avg_rtt,
         MIN(h.rtt_ms) as min_rtt,
         MAX(h.rtt_ms) as max_rtt,
         COUNT(*) as samples
       FROM traceroute_hops h
       JOIN traceroutes t ON h.traceroute_id = t.id
       ${where}
       GROUP BY h.ip, day
       ORDER BY h.ip, day`
    )
    .all(...params);

  return c.json(rows);
});

/** Trigger manual traceroute */
tracerouteRoute.post("/trigger", async (c) => {
  const { TracerouteCollector } = await import("../collectors/traceroute.collector");
  const collector = new TracerouteCollector();
  collector.collect().catch((e) => console.error("[traceroute/trigger]", e));
  return c.json({ status: "triggered" });
});

export { tracerouteRoute };
