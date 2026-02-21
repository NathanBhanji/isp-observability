import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { Scheduler } from "./scheduler";
import { getDb, closeDb } from "./db";

// Routes
import { latency } from "./routes/latency";
import { throughput } from "./routes/throughput";
import { correlation } from "./routes/correlation";
import { tracerouteRoute } from "./routes/traceroute";
import { ripeAtlas } from "./routes/ripe-atlas";
import { routerStatus } from "./routes/router-status";
import { createStatusRoute } from "./routes/status";
import { evidence } from "./routes/evidence";
import { outages } from "./routes/outages";

// Collectors
import { PingCollector } from "./collectors/ping.collector";
import { ThroughputCollector } from "./collectors/throughput.collector";
// CorrelationCollector removed — correlation pings are now integrated
// into ThroughputCollector (latency measured during speed tests)
import { TracerouteCollector } from "./collectors/traceroute.collector";
import { RipeAtlasCollector } from "./collectors/ripe-atlas.collector";
import { RouterCollector } from "./collectors/router.collector";
import { RetentionCollector } from "./collectors/retention.collector";
import { HeartbeatCollector } from "./collectors/heartbeat.collector";

// ── Initialize ───────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "4000", 10);

// Ensure DB is initialized
getDb();

// ── Hono App ─────────────────────────────────────────────────

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    // Only allow the Next.js frontend (server-side requests)
    origin: ["http://localhost:3000", "http://host.docker.internal:3000"],
  })
);

// Mount routes
const scheduler = new Scheduler();

app.route("/api/latency", latency);
app.route("/api/throughput", throughput);
app.route("/api/correlation", correlation);
app.route("/api/traceroute", tracerouteRoute);
app.route("/api/ripe-atlas", ripeAtlas);
app.route("/api/router", routerStatus);
app.route("/api/status", createStatusRoute(scheduler));
app.route("/api/evidence", evidence);
app.route("/api/outages", outages);

// Health check
app.get("/health", (c) => c.json({ ok: true }));

// ── Start Collectors ─────────────────────────────────────────

scheduler.register(new PingCollector());
scheduler.register(new ThroughputCollector()); // includes correlation pings during downloads
scheduler.register(new TracerouteCollector());
scheduler.register(new RipeAtlasCollector());
scheduler.register(new RouterCollector());
scheduler.register(new RetentionCollector()); // hourly data pruning
scheduler.register(new HeartbeatCollector()); // 5s gateway heartbeat for outage detection

// ── Graceful Shutdown ────────────────────────────────────────

process.on("SIGINT", () => {
  console.log("\n[app] Shutting down...");
  scheduler.stop();
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[app] SIGTERM received, shutting down...");
  scheduler.stop();
  closeDb();
  process.exit(0);
});

// ── Start Server ─────────────────────────────────────────────

console.log(`[app] ISP Observability Collector starting on port ${PORT}`);
console.log(`[app] Database: ${process.env.DATABASE_PATH || "./data/isp-observability.db"}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
