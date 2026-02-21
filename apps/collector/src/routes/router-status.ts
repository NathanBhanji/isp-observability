import { Hono } from "hono";
import { getDb } from "../db";

const routerStatus = new Hono();

/** Latest router status */
routerStatus.get("/latest", (c) => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM router_status ORDER BY id DESC LIMIT 1")
    .get();
  return c.json(row || null);
});

/** Router status history — ?since=ISO or all time */
routerStatus.get("/history", (c) => {
  const since = c.req.query("since");
  const db = getDb();

  const where = since ? "WHERE timestamp >= ?" : "";
  const params = since ? [since] : [];

  const rows = db
    .prepare(
      `SELECT * FROM router_status ${where} ORDER BY timestamp ASC`
    )
    .all(...params);
  return c.json(rows);
});

export { routerStatus };
