/**
 * Human-readable labels for technical metrics and jargon.
 * Used across all pages to translate network engineering terminology
 * into language ISP customers can understand.
 */

/** Hop target labels — human-readable names for network hops */
export const HOP_LABELS: Record<string, string> = {
  gateway: "Home Router",
  aggregation: "ISP Local Node",
  bcube: "ISP Backbone",
  google: "Google (External)",
  cloudflare: "Cloudflare (External)",
  google_v6: "Google IPv6",
  cloudflare_v6: "Cloudflare IPv6",
};

/** Metric label translations — jargon → plain English */
export const METRIC_LABELS: Record<string, { short: string; tooltip: string }> = {
  p50_rtt:     { short: "Median response time",         tooltip: "Half of all measurements were faster than this" },
  p95_rtt:     { short: "Slow response time",            tooltip: "Only 5% of measurements were slower than this" },
  p99_rtt:     { short: "Worst-case response time",      tooltip: "Only 1% of measurements were slower" },
  mean_rtt:    { short: "Average response time",         tooltip: "The average of all response time measurements" },
  rtt:         { short: "Response time",                 tooltip: "Time for data to travel to a server and back" },
  stddev:      { short: "Consistency",                   tooltip: "Lower means more consistent; higher means erratic" },
  jitter:      { short: "Stability",                     tooltip: "How much your response time varies moment to moment" },
  packet_loss: { short: "Dropped data",                  tooltip: "Percentage of data packets that didn't arrive" },
  policing:    { short: "Speed throttling",              tooltip: "Your ISP limits speed per connection, not your total bandwidth" },
  ratio:       { short: "Throttle ratio",                tooltip: "How much faster multiple connections are vs one — above 1.3x suggests throttling" },
  pearson_r:   { short: "Correlation strength",          tooltip: "How strongly two measurements move together (-1 to +1)" },
  bufferbloat: { short: "Network congestion delay",      tooltip: "Downloads causing your internet to feel slow because of queue buildup" },
  hop:         { short: "Network step",                  tooltip: "One router your data passes through on its way to the destination" },
  traceroute:  { short: "Network path",                  tooltip: "The route your data takes across the internet" },
};

/** Tab label translations for the latency page */
export const LATENCY_TAB_LABELS: Record<string, string> = {
  p50:  "Typical",
  mean: "Average",
  p95:  "Slow",
  p99:  "Worst Case",
};

/** Correlation strength interpretation */
export function interpretCorrelation(r: number | null): string {
  if (r === null) return "Waiting for data";
  const abs = Math.abs(r);
  if (abs < 0.1) return "No effect";
  if (abs < 0.3) return "Mild effect";
  if (abs < 0.5) return "Moderate effect";
  return "Strong effect";
}

/** Format duration in ms to human-readable */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

/** Format uptime seconds to human-readable */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format timestamp for tables — relative when recent, absolute otherwise */
export function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    const date = new Date(ts);
    const now = Date.now();
    const diffMs = now - date.getTime();
    if (diffMs < 60_000) return "Just now";
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return ts.slice(11, 19) || "—";
  }
}
