import { Database } from "bun:sqlite";

export function initializeDatabase(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS ping_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      target_ip TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      samples_sent INTEGER NOT NULL,
      samples_received INTEGER NOT NULL,
      loss_pct REAL NOT NULL,
      rtt_min REAL,
      rtt_max REAL,
      rtt_mean REAL,
      rtt_median REAL,
      rtt_stddev REAL,
      rtt_p50 REAL,
      rtt_p90 REAL,
      rtt_p95 REAL,
      rtt_p99 REAL,
      jitter_mean REAL,
      jitter_max REAL,
      spikes_10ms INTEGER NOT NULL DEFAULT 0,
      spikes_15ms INTEGER NOT NULL DEFAULT 0,
      spikes_20ms INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_ping_windows_target_ts ON ping_windows(target_id, timestamp)"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS ping_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id INTEGER NOT NULL REFERENCES ping_windows(id),
      seq INTEGER NOT NULL,
      rtt_ms REAL,
      timestamp TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ping_samples_window ON ping_samples(window_id)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS throughput_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      stream_count INTEGER NOT NULL,
      bytes_transferred INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      speed_mbps REAL NOT NULL,
      source_url TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'ethernet',
      direction TEXT NOT NULL DEFAULT 'download'
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_throughput_ts ON throughput_tests(timestamp)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_throughput_dir ON throughput_tests(direction, stream_count)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS throughput_timeseries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL REFERENCES throughput_tests(id),
      second_offset INTEGER NOT NULL,
      bytes_this_second INTEGER NOT NULL,
      speed_mbps REAL NOT NULL
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_throughput_ts_test ON throughput_timeseries(test_id)"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS correlation_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      target_id TEXT NOT NULL,
      rtt_ms REAL,
      throughput_mbps REAL,
      pearson_r REAL
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_correlation_session ON correlation_samples(session_id)"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS traceroutes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      hop_count INTEGER NOT NULL,
      responding_hops INTEGER NOT NULL,
      dark_hops INTEGER NOT NULL,
      path_hash TEXT NOT NULL
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_traceroute_ts ON traceroutes(destination, timestamp)"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS traceroute_hops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traceroute_id INTEGER NOT NULL REFERENCES traceroutes(id),
      hop_number INTEGER NOT NULL,
      ip TEXT,
      hostname TEXT,
      rtt_ms REAL
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_traceroute_hops_tr ON traceroute_hops(traceroute_id)"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS ripe_atlas_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      probe_id INTEGER NOT NULL,
      destination TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      hop_count INTEGER NOT NULL,
      traverses_bcube INTEGER NOT NULL DEFAULT 0,
      matched_target_ids TEXT NOT NULL DEFAULT '',
      transit_rtt_ms REAL,
      raw_json TEXT,
      measured_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ripe_ts ON ripe_atlas_results(timestamp)");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_ripe_dedup ON ripe_atlas_results(probe_id, destination, measured_at)"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS router_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      downstream_max_bps INTEGER,
      upstream_max_bps INTEGER,
      physical_link_status TEXT,
      connection_uptime_sec INTEGER,
      total_bytes_received INTEGER,
      total_bytes_sent INTEGER,
      external_ip TEXT,
      gateway_ip TEXT,
      dns_resolve_ms REAL,
      interface_name TEXT,
      interface_rx_bytes INTEGER,
      interface_tx_bytes INTEGER,
      cf_colo TEXT
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_router_ts ON router_status(timestamp)");

  // ── Outages (micro-outage detection via heartbeat) ─────
  db.exec(`
    CREATE TABLE IF NOT EXISTS outages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      missed_pings INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_outages_start ON outages(started_at)");

  // Migration: add columns to existing databases that lack them
  migrateRouterStatus(db);
  migrateThroughputTests(db);
  migrateBytesColumn(db);
  migrateRipeAtlasResults(db);
  migrateRipeMeasuredAt(db);
  migrateThroughputLatency(db);

}

/** Add idle_latency_ms column to throughput_tests (idempotent). */
function migrateThroughputLatency(db: Database): void {
  const existing = db.prepare("PRAGMA table_info(throughput_tests)").all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));

  if (!names.has("idle_latency_ms")) {
    db.exec(`ALTER TABLE throughput_tests ADD COLUMN idle_latency_ms REAL`);
  }
}

/** Add direction column to existing throughput_tests tables (idempotent). */
function migrateThroughputTests(db: Database): void {
  const existing = db.prepare("PRAGMA table_info(throughput_tests)").all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));

  if (!names.has("direction")) {
    db.exec(`ALTER TABLE throughput_tests ADD COLUMN direction TEXT NOT NULL DEFAULT 'download'`);
  }
}

/** Add matched_target_ids column to ripe_atlas_results and backfill from traverses_bcube. */
function migrateRipeAtlasResults(db: Database): void {
  const existing = db.prepare("PRAGMA table_info(ripe_atlas_results)").all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));

  if (!names.has("matched_target_ids")) {
    db.exec(`ALTER TABLE ripe_atlas_results ADD COLUMN matched_target_ids TEXT NOT NULL DEFAULT ''`);
    // Backfill: if traverses_bcube=1, set matched_target_ids='bcube'
    db.exec(`UPDATE ripe_atlas_results SET matched_target_ids = 'bcube' WHERE traverses_bcube = 1`);
  }
}

/** Add measured_at column to existing ripe_atlas_results + create dedup index (idempotent). */
function migrateRipeMeasuredAt(db: Database): void {
  const existing = db.prepare("PRAGMA table_info(ripe_atlas_results)").all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));

  if (!names.has("measured_at")) {
    db.exec(`ALTER TABLE ripe_atlas_results ADD COLUMN measured_at INTEGER NOT NULL DEFAULT 0`);
  }

  // Ensure dedup index exists (safe to call even if already exists via CREATE TABLE)
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_ripe_dedup ON ripe_atlas_results(probe_id, destination, measured_at)"
  );
}

/** Rename bytes_downloaded → bytes_transferred in throughput_tests (idempotent). */
function migrateBytesColumn(db: Database): void {
  const existing = db.prepare("PRAGMA table_info(throughput_tests)").all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));

  if (names.has("bytes_downloaded") && !names.has("bytes_transferred")) {
    db.exec(`ALTER TABLE throughput_tests RENAME COLUMN bytes_downloaded TO bytes_transferred`);
  }
}

/** Add new columns to existing router_status tables (idempotent). */
function migrateRouterStatus(db: Database): void {
  const existing = db.prepare("PRAGMA table_info(router_status)").all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));

  const additions: [string, string][] = [
    ["external_ip", "TEXT"],
    ["gateway_ip", "TEXT"],
    ["dns_resolve_ms", "REAL"],
    ["interface_name", "TEXT"],
    ["interface_rx_bytes", "INTEGER"],
    ["interface_tx_bytes", "INTEGER"],
    ["cf_colo", "TEXT"],
  ];

  for (const [col, type] of additions) {
    if (!names.has(col)) {
      db.exec(`ALTER TABLE router_status ADD COLUMN ${col} ${type}`);
    }
  }
}
