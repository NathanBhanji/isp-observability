/**
 * Server-side fetch helpers for the collector API.
 * ONLY used in Server Components and Server Actions.
 * The COLLECTOR_URL is never exposed to the client.
 */

import { TIMEFRAMES, DEFAULT_TIMEFRAME, type TimeframeKey } from "@isp/shared";

const COLLECTOR_URL = process.env.COLLECTOR_URL || "http://localhost:4000";

async function fetchCollector<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${COLLECTOR_URL}${path}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[collector] ${path} returned ${res.status}`);
      return null;
    }
    return res.json();
  } catch (e) {
    console.error(`[collector] Failed to fetch ${path}:`, (e as Error).message);
    return null;
  }
}

// ── Timeframe helpers ────────────────────────────────────────

export interface TimeRange {
  since?: string;
  until?: string;
}

/**
 * Convert a timeframe key (from the URL ?t= param) to an ISO timestamp.
 * Returns undefined for "all" (= no filter).
 */
export function timeframeToSince(t: string | undefined): string | undefined {
  const key = (t || DEFAULT_TIMEFRAME) as TimeframeKey;
  const tf = TIMEFRAMES.find((f) => f.key === key);
  if (!tf || tf.ms === 0) return undefined; // "all" or unrecognised
  return new Date(Date.now() - tf.ms).toISOString();
}

/**
 * Resolve search params into a time range.
 * Custom range (`from`/`to`) takes precedence over preset (`t`).
 */
export function resolveTimeRange(params: {
  t?: string;
  from?: string;
  to?: string;
}): TimeRange {
  if (params.from) {
    return { since: params.from, until: params.to };
  }
  return { since: timeframeToSince(params.t) };
}

/**
 * Filter an array of rows by an `until` timestamp (inclusive).
 * Rows must have a `timestamp` field (ISO string).
 * Returns null if input is null.
 */
export function filterByUntil<T extends { timestamp: string }>(
  rows: T[] | null,
  until?: string
): T[] | null {
  if (!rows || !until) return rows;
  return rows.filter((r) => r.timestamp <= until);
}

/** Append ?since=ISO to a path if since is defined */
function withSince(basePath: string, since?: string): string {
  if (!since) return basePath;
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}since=${encodeURIComponent(since)}`;
}

// ── Latency ──────────────────────────────────────────────────

export async function fetchLatencyLatest() {
  return fetchCollector<any[]>("/api/latency/latest");
}

export async function fetchLatencyHistory(since?: string, target?: string) {
  let path = "/api/latency/history";
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  if (target) params.set("target", target);
  const qs = params.toString();
  return fetchCollector<any[]>(qs ? `${path}?${qs}` : path);
}

export async function fetchLatencyRaw(windowId: number) {
  return fetchCollector<any[]>(`/api/latency/raw/${windowId}`);
}

// ── Throughput ───────────────────────────────────────────────

export async function fetchThroughputLatest() {
  return fetchCollector<{
    single: any;
    multi: any;
    ratio: number | null;
    adjustedRatio: number | null;
    download: { single: any; multi: any; ratio: number | null; adjustedRatio: number | null };
    upload: { single: any; multi: any; ratio: number | null; adjustedRatio: number | null };
  }>("/api/throughput/latest");
}

export async function fetchThroughputHistory(since?: string) {
  return fetchCollector<any[]>(withSince("/api/throughput/history", since));
}

export async function fetchThroughputTimeseries(testId: number) {
  return fetchCollector<any[]>(`/api/throughput/timeseries/${testId}`);
}

// ── Correlation ──────────────────────────────────────────────

export async function fetchCorrelationLatest() {
  return fetchCollector<any>("/api/correlation/latest");
}

export async function fetchCorrelationHistory(since?: string) {
  return fetchCollector<any[]>(withSince("/api/correlation/history", since));
}

// ── Traceroute ───────────────────────────────────────────────

export async function fetchTracerouteLatest() {
  return fetchCollector<any[]>("/api/traceroute/latest");
}

export async function fetchTracerouteHistory(since?: string) {
  return fetchCollector<any[]>(withSince("/api/traceroute/history", since));
}

// ── RIPE Atlas ───────────────────────────────────────────────

export async function fetchRipeAtlasLatest() {
  return fetchCollector<any[]>("/api/ripe-atlas/latest");
}

// ── Router ───────────────────────────────────────────────────

export async function fetchRouterLatest() {
  return fetchCollector<any>("/api/router/latest");
}

export async function fetchRouterHistory(since?: string) {
  return fetchCollector<any[]>(withSince("/api/router/history", since));
}

// ── Status ───────────────────────────────────────────────────

export async function fetchCollectorStatus() {
  return fetchCollector<any>("/api/status");
}

// ── Outages ─────────────────────────────────────────────────

export async function fetchOutages(since?: string) {
  return fetchCollector<any[]>(withSince("/api/outages", since));
}

export async function fetchOutageSummary(since?: string) {
  return fetchCollector<any>(withSince("/api/outages/summary", since));
}

// ── Traceroute Hop Trends ───────────────────────────────────

export async function fetchHopTrends(since?: string, ip?: string) {
  let path = "/api/traceroute/hop-trends";
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  if (ip) params.set("ip", ip);
  const qs = params.toString();
  return fetchCollector<any[]>(qs ? `${path}?${qs}` : path);
}

// ── Evidence ─────────────────────────────────────────────────

export async function fetchEvidenceSummary(since?: string) {
  return fetchCollector<any>(withSince("/api/evidence/summary", since));
}
