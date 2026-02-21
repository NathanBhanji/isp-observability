// ── Ping Targets ──────────────────────────────────────────────
export const PING_TARGETS = [
  { id: "gateway", ip: "192.168.1.1", label: "Gateway", hop: 1 },
  { id: "aggregation", ip: "10.129.56.1", label: "Hop 2", hop: 2 },
  { id: "bcube", ip: "185.24.122.177", label: "Hop 3", hop: 3 },
  { id: "google", ip: "8.8.8.8", label: "Google DNS", hop: 4 },
  { id: "cloudflare", ip: "1.1.1.1", label: "Cloudflare DNS", hop: 5 },
] as const;

export type TargetId = (typeof PING_TARGETS)[number]["id"];

/** Lookup map: target id → user-facing label */
export const TARGET_LABELS: Record<string, string> = Object.fromEntries(
  PING_TARGETS.map((t) => [t.id, t.label])
);

/** Lookup map: target id → IP address */
export const TARGET_IPS: Record<string, string> = Object.fromEntries(
  PING_TARGETS.map((t) => [t.id, t.ip])
);

/** All monitored IPs — used for matching hops in peer traceroutes */
export const MONITORED_IPS: readonly string[] = PING_TARGETS.map((t) => t.ip);

// ── IPv6 Ping Targets ────────────────────────────────────────
// Only external targets with known IPv6 addresses.
// Gateway and aggregation are IPv4-only (private ranges).
export const PING_TARGETS_V6 = [
  { id: "google_v6", ip: "2001:4860:4860::8888", label: "Google DNS (IPv6)", hop: 4 },
  { id: "cloudflare_v6", ip: "2606:4700:4700::1111", label: "Cloudflare DNS (IPv6)", hop: 5 },
] as const;

export type TargetIdV6 = (typeof PING_TARGETS_V6)[number]["id"];

// ── Traceroute Destinations ──────────────────────────────────
// Includes the same root server IPs that RIPE Atlas built-in
// measurements trace to, enabling direct path comparison.
export const TRACEROUTE_DESTINATIONS = [
  "193.0.14.129",   // k.root-servers.net  (RIPE msm 5001)
  "192.5.5.241",    // f.root-servers.net  (RIPE msm 5004)
  "192.36.148.17",  // i.root-servers.net  (RIPE msm 5005)
  "8.8.8.8",        // Google DNS
  "1.1.1.1",        // Cloudflare DNS
] as const;

export const TRACEROUTE_DESTINATIONS_V6 = [
  "2001:4860:4860::8888", // Google DNS IPv6
  "2606:4700:4700::1111", // Cloudflare DNS IPv6
] as const;

// ── ISP ASN ─────────────────────────────────────────────────
/** Autonomous System Number for probe auto-discovery */
export const ISP_ASN = 56478;

// ── RIPE Atlas Probes ───────────────────────────────────────
/** @deprecated Fallback only — probes are now auto-discovered via RIPE Atlas API */
export const RIPE_ATLAS_PROBES_FALLBACK = [65932, 61522, 1011465] as const;

// ── Built-in RIPE Atlas measurement IDs ─────────────────────
// These are measurements that ALL probes participate in automatically.
// 5001-5010: traceroute to DNS root servers (k-root, etc.)
export const RIPE_BUILTIN_MEASUREMENTS = [5001, 5004, 5005] as const;

/** Map RIPE measurement IDs → target IPs + hostnames */
export const RIPE_MEASUREMENT_TARGETS: Record<number, { ip: string; hostname: string }> = {
  5001: { ip: "193.0.14.129",  hostname: "k.root-servers.net" },
  5004: { ip: "192.5.5.241",   hostname: "f.root-servers.net" },
  5005: { ip: "192.36.148.17", hostname: "i.root-servers.net" },
};

/** Friendly labels for traceroute destination IPs */
export const DESTINATION_LABELS: Record<string, string> = {
  "193.0.14.129":  "k-root",
  "192.5.5.241":   "f-root",
  "192.36.148.17": "i-root",
  "8.8.8.8":       "Google DNS",
  "1.1.1.1":       "Cloudflare DNS",
};

/** Set of IPs that RIPE Atlas peers also trace to (for comparison) */
export const RIPE_SHARED_DESTINATIONS = new Set(
  Object.values(RIPE_MEASUREMENT_TARGETS).map((t) => t.ip)
);

// ── Thresholds ───────────────────────────────────────────────
export const THRESHOLDS = {
  /** RTT spike thresholds in ms */
  spikeMs: [10, 15, 20] as const,
  /** Single-to-multi ratio above this is notable */
  policingRatio: 1.3,
  /** RTT stddev threshold for flagging instability (ms) */
  maxAcceptableStddev: 3.0,
  /** Packet loss threshold (%) */
  maxAcceptableLoss: 1.0,
  /** Minimum expected single-stream speed Mbps */
  minSingleStreamMbps: 150,
} as const;

// ── Collection Intervals (ms) ────────────────────────────────
export const INTERVALS = {
  ping: 60_000,          // 1 min
  throughput: 300_000,   // 5 min — includes correlation pings
  traceroute: 900_000,   // 15 min
  ripeAtlas: 3_600_000,  // 1 hr
  router: 300_000,       // 5 min
} as const;

// ── Ping Config ──────────────────────────────────────────────
export const PINGS_PER_WINDOW = 50;
export const PING_INTERVAL_SEC = 0.5;

// ── Throughput Config ────────────────────────────────────────
/** Number of parallel streams for multi-stream test */
export const MULTI_STREAM_COUNT = 4;
/** Minimum bytes for a valid speed test — rejects broken/placeholder responses */
export const MIN_VALID_DOWNLOAD_BYTES = 1_000_000;

// ── Dashboard Timeframes ─────────────────────────────────────
/** Available time windows for the global dashboard selector */
export const TIMEFRAMES = [
  { key: "1h",  label: "1 hour",   ms: 60 * 60 * 1000 },
  { key: "6h",  label: "6 hours",  ms: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { key: "7d",  label: "7 days",   ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30 days",  ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All time", ms: 0 },
] as const;

export type TimeframeKey = (typeof TIMEFRAMES)[number]["key"];

/** Default timeframe — show everything */
export const DEFAULT_TIMEFRAME: TimeframeKey = "all";

// ── Data Retention ───────────────────────────────────────────
/** How long to keep data before pruning (in days) */
export const RETENTION = {
  /** ping_windows + ping_samples — high volume (1 per target per minute) */
  pingDays: 30,
  /** throughput_tests + throughput_timeseries — low volume */
  throughputDays: 90,
  /** correlation_samples — tied to throughput tests */
  correlationDays: 90,
  /** traceroutes + traceroute_hops — low volume */
  tracerouteDays: 90,
  /** ripe_atlas_results — very low volume */
  ripeAtlasDays: 90,
  /** router_status — moderate volume (every 5 min) */
  routerDays: 30,
} as const;

/** How often to run the pruning job (ms) — once per hour */
export const RETENTION_INTERVAL = 3_600_000;

// ── Router ───────────────────────────────────────────────────
export const ROUTER_IP = "192.168.1.1";
/** @deprecated UPnP port is now auto-discovered via SSDP */
export const ROUTER_UPNP_PORT = 56688;
