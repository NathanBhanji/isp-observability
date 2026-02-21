import { PING_TARGETS, RIPE_BUILTIN_MEASUREMENTS, ISP_ASN, RIPE_ATLAS_PROBES_FALLBACK } from "@isp/shared";

const RIPE_ATLAS_BASE = "https://atlas.ripe.net/api/v2";

/** Map of monitored IPs to their target IDs for fast lookup */
const IP_TO_TARGET = new Map<string, string>(PING_TARGETS.map((t) => [t.ip, t.id]));

// ── Probe Discovery ──────────────────────────────────────────

/** Cached discovered probe IDs */
let cachedProbeIds: number[] | null = null;
let cacheTimestamp = 0;
/** Re-discover probes every 6 hours */
const CACHE_TTL_MS = 6 * 3600 * 1000;

/**
 * Auto-discover ALL active RIPE Atlas probes on the configured ASN.
 * Results are cached for 6 hours to avoid hammering the API.
 * Falls back to RIPE_ATLAS_PROBES_FALLBACK if discovery fails.
 */
export async function discoverProbesForAsn(asn: number = ISP_ASN): Promise<number[]> {
  const now = Date.now();
  if (cachedProbeIds && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedProbeIds;
  }

  try {
    const url = `${RIPE_ATLAS_BASE}/probes/?asn_v4=${asn}&status=1&page_size=500`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      console.warn(`[ripe-atlas] Probe discovery failed (HTTP ${res.status}), using fallback`);
      return [...RIPE_ATLAS_PROBES_FALLBACK];
    }

    const data = (await res.json()) as { results: Array<{ id: number; status: { id: number } }> };
    const probeIds = data.results
      .filter((p) => p.status.id === 1) // 1 = Connected
      .map((p) => p.id);

    if (probeIds.length === 0) {
      console.warn(`[ripe-atlas] No probes found on AS${asn}, using fallback`);
      return [...RIPE_ATLAS_PROBES_FALLBACK];
    }

    cachedProbeIds = probeIds;
    cacheTimestamp = now;
    console.log(`[ripe-atlas] Discovered ${probeIds.length} active probes on AS${asn}: ${probeIds.join(", ")}`);
    return probeIds;
  } catch (e) {
    console.warn(`[ripe-atlas] Probe discovery error:`, (e as Error).message, "— using fallback");
    return [...RIPE_ATLAS_PROBES_FALLBACK];
  }
}

/**
 * How far back to fetch results on each collection (seconds).
 * Built-in measurements run every 1800s, so 4h gives ~8 results per probe per msm.
 */
const LOOKBACK_SECONDS = 4 * 3600;

export interface RipeProbeTraceroute {
  probeId: number;
  destination: string;
  hopCount: number;
  /** Comma-separated target IDs whose IPs appeared in the traceroute path */
  matchedTargetIds: string;
  transitRttMs: number | null;
  rawJson: string;
  /** UNIX timestamp of the measurement result (for dedup) */
  measuredAt: number;
}

/**
 * Fetch recent traceroute results for a RIPE Atlas probe.
 * Queries the results endpoint with a time window (not just latest)
 * to collect multiple samples per measurement.
 */
export async function fetchProbeTraceroutes(
  probeId: number,
  _destinations: string[]
): Promise<RipeProbeTraceroute[]> {
  const results: RipeProbeTraceroute[] = [];
  const now = Math.floor(Date.now() / 1000);
  const start = now - LOOKBACK_SECONDS;

  for (const msmId of RIPE_BUILTIN_MEASUREMENTS) {
    try {
      // Fetch historical results within our lookback window
      const url =
        `${RIPE_ATLAS_BASE}/measurements/${msmId}/results/` +
        `?probe_ids=${probeId}&start=${start}&stop=${now}&format=json`;

      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        // Fall back to latest if results endpoint fails
        const latestUrl = `${RIPE_ATLAS_BASE}/measurements/${msmId}/latest/?probe_ids=${probeId}`;
        const latestRes = await fetch(latestUrl, { signal: AbortSignal.timeout(15000) });
        if (!latestRes.ok) continue;
        const latestData = (await latestRes.json()) as RipeRawEntry[];
        for (const entry of latestData) {
          const parsed = parseTracerouteEntry(probeId, entry);
          if (parsed) results.push(parsed);
        }
        continue;
      }

      const data = (await res.json()) as RipeRawEntry[];

      for (const entry of data) {
        const parsed = parseTracerouteEntry(probeId, entry);
        if (parsed) results.push(parsed);
      }
    } catch (e) {
      console.warn(`[ripe-atlas] msm ${msmId} failed for probe ${probeId}:`, (e as Error).message);
    }
  }

  return results;
}

// ── Raw RIPE entry type ──────────────────────────────────────

interface RipeRawEntry {
  result: Array<{
    hop: number;
    result: Array<{ from?: string; rtt?: number; x?: string }>;
  }>;
  dst_addr: string;
  timestamp?: number;
  stored_timestamp?: number;
}

// ── Parser ───────────────────────────────────────────────────

function parseTracerouteEntry(
  probeId: number,
  entry: RipeRawEntry
): RipeProbeTraceroute | null {
  const hops = entry.result || [];
  if (hops.length === 0) return null;

  const matched = new Set<string>();
  let lastRtt: number | null = null;

  for (const hop of hops) {
    for (const probe of hop.result || []) {
      if (probe.from && IP_TO_TARGET.has(probe.from)) {
        matched.add(IP_TO_TARGET.get(probe.from)!);
      }
      if (probe.rtt && probe.rtt > 0) {
        lastRtt = probe.rtt;
      }
    }
  }

  return {
    probeId,
    destination: entry.dst_addr,
    hopCount: hops.length,
    matchedTargetIds: Array.from(matched).join(","),
    transitRttMs: lastRtt,
    rawJson: JSON.stringify(entry),
    measuredAt: entry.timestamp || entry.stored_timestamp || 0,
  };
}
