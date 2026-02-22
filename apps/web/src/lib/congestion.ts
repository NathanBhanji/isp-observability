/**
 * Shared congestion detection logic.
 *
 * Used by:
 *   - Verdict page (server-side) for congestion event summary
 *   - CongestionOverlay chart (client-side) for interactive event replay
 *
 * The core algorithm:
 *   1. Join throughput tests with ISP + gateway latency (nearest within ±2 min)
 *   2. Only consider multi-stream tests (stream_count >= 2) for congestion
 *      detection — single-stream tests reflect throttling, not ISP capacity
 *   3. Compute "excess traffic" = WAN throughput − speed test result
 *      (= bandwidth consumed by other devices on the network)
 *   4. Threshold: max(100 Mbps, medianExcess × 3) — if exceeded, the slowdown
 *      is self-inflicted (local traffic), not ISP congestion
 *   5. For tests missing WAN data, borrow the nearest neighbor's excess within ±3 min
 *   6. A point is "congested" if latency > max(2× median, 5ms) AND
 *      speed < 70% median AND NOT locally busy
 *   7. Group nearby congested points into events (within 10-min gap tolerance)
 *   8. Discard single-point events as insufficient evidence
 */

// ── Constants ────────────────────────────────────────────────

/** Minimum absolute latency (ms) to consider "elevated" regardless of median */
const MIN_LATENCY_FLOOR_MS = 5;

/** Minimum number of data points required to form a confirmed event */
const MIN_POINTS_PER_EVENT = 2;

/**
 * Maximum gap (ms) between consecutive congested points to still group
 * them into the same event. Tests run every 5 min, so 10 min allows
 * one missed cycle without splitting an event.
 */
const EVENT_GAP_TOLERANCE_MS = 10 * 60 * 1000;

/** Minimum stream count to qualify as a multi-stream test */
const MULTI_STREAM_MIN = 2;

// ── Types ────────────────────────────────────────────────────

export interface JoinedPoint {
  idx: number;
  time: string;
  timestamp: string;
  speed: number | null;
  latency: number | null;
  routerLatency: number | null;
  wanSpeedMbps: number | null;
  streamCount: number | null;
  uploadSpeed: number | null;
}

export interface CongestionEvent {
  startIdx: number;
  endIdx: number;
  joinedStartIdx: number;
  joinedEndIdx: number;
  startTime: string;
  endTime: string;
  peakLatency: number;
  minSpeed: number;
}

export interface DetectedEvent {
  startTime: string;
  endTime: string;
  peakLatency: number;
  minSpeed: number;
  avgRouterLatency: number | null;
  pointCount: number;
}

export interface CongestionAnalysisResult {
  events: DetectedEvent[];
  filtered: number;
  total: number;
  medianSpeed: number;
  medianLatency: number;
  medianWan: number | null;
}

// ── Helpers ──────────────────────────────────────────────────

export function medianOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function findNearest(
  points: any[],
  targetMs: number,
  maxDist: number
): any | null {
  let best: any = null;
  let bestDist = Infinity;
  for (const p of points) {
    const dist = Math.abs(new Date(p.timestamp).getTime() - targetMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best && bestDist <= maxDist ? best : null;
}

/**
 * Returns the peak (max) rtt_p50 value within ±maxDist of targetMs.
 *
 * Speed tests and latency windows don't align perfectly — a test runs for
 * ~15 seconds while latency is sampled every minute. Using the peak in the
 * window answers "was latency elevated around this test?" rather than
 * "what was latency at this exact instant?" which can miss spikes that
 * occur between measurements.
 */
function findPeakInWindow(
  points: any[],
  targetMs: number,
  maxDist: number,
  field: string = "rtt_p50"
): number | null {
  let peak: number | null = null;
  for (const p of points) {
    const dist = Math.abs(new Date(p.timestamp).getTime() - targetMs);
    if (dist <= maxDist && p[field] != null) {
      if (peak === null || p[field] > peak) {
        peak = p[field];
      }
    }
  }
  return peak;
}

function isMultiStream(streamCount: number | null | undefined): boolean {
  return streamCount != null && streamCount >= MULTI_STREAM_MIN;
}

// ── Data joining ─────────────────────────────────────────────

/**
 * Joins throughput, ISP latency, and gateway latency into a single timeline.
 * Each multi-stream download test becomes a point; latency-only points fill
 * gaps for continuity.
 *
 * Only multi-stream tests are included — single-stream tests reflect per-
 * connection throttling, not ISP capacity, and would create misleading dips
 * on the congestion chart.
 */
export function joinData(
  latencyData: any[],
  throughputData: any[],
  gatewayLatencyData: any[]
): JoinedPoint[] {
  const downloads = (throughputData || [])
    .filter(
      (t: any) =>
        t.direction === "download" &&
        t.speed_mbps > 0 &&
        isMultiStream(t.stream_count)
    )
    .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));

  const uploads = (throughputData || [])
    .filter(
      (t: any) =>
        t.direction === "upload" &&
        t.speed_mbps > 0 &&
        isMultiStream(t.stream_count)
    )
    .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));

  const latencyPoints = (latencyData || [])
    .filter((l: any) => l.rtt_p50 != null)
    .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));

  const gatewayPoints = (gatewayLatencyData || [])
    .filter((l: any) => l.rtt_p50 != null)
    .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));

  if (downloads.length === 0 && latencyPoints.length === 0) return [];

  const THREE_MIN = 3 * 60 * 1000;
  const TWO_MIN = 2 * 60 * 1000;
  const joined: JoinedPoint[] = [];

  // Create one point per throughput test.
  // ISP latency: use peak (max) in ±3 min window — speed tests and latency
  // windows don't align perfectly, so we ask "was latency elevated around
  // this test?" rather than "what was the exact reading at this instant?"
  // Gateway latency: use nearest (we want typical, not worst-case, to check
  // if the *router* was congested).
  for (const dl of downloads) {
    const dlTime = new Date(dl.timestamp).getTime();
    const peakIspLatency = findPeakInWindow(latencyPoints, dlTime, THREE_MIN);
    const nearestGw = findNearest(gatewayPoints, dlTime, TWO_MIN);
    // Upload runs ~40-53s after download — find paired upload within ±2 min
    const nearUl = findNearest(uploads, dlTime, TWO_MIN);

    // Compute WAN speed from wan_rx_delta on the throughput test row
    let wanSpeedMbps: number | null = null;
    if (dl.wan_rx_delta != null && dl.duration_ms > 0) {
      wanSpeedMbps =
        Math.round(
          ((dl.wan_rx_delta * 8) / (dl.duration_ms / 1000) / 1_000_000) * 10
        ) / 10;
    }

    joined.push({
      idx: 0,
      time: dl.timestamp.slice(11, 16),
      timestamp: dl.timestamp,
      speed: dl.speed_mbps,
      latency: peakIspLatency,
      routerLatency: nearestGw ? nearestGw.rtt_p50 : null,
      wanSpeedMbps,
      streamCount: dl.stream_count ?? null,
      uploadSpeed: nearUl ? nearUl.speed_mbps : null,
    });
  }

  // Add latency-only points between throughput tests for continuity
  const usedLatencyTimestamps = new Set<string>();
  for (const j of joined) {
    if (j.latency != null) {
      const dlTime = new Date(j.timestamp).getTime();
      const nearest = findNearest(latencyPoints, dlTime, TWO_MIN);
      if (nearest) usedLatencyTimestamps.add(nearest.timestamp);
    }
  }

  for (const lp of latencyPoints) {
    if (!usedLatencyTimestamps.has(lp.timestamp)) {
      const lpTime = new Date(lp.timestamp).getTime();
      const nearestGw = findNearest(gatewayPoints, lpTime, TWO_MIN);

      joined.push({
        idx: 0,
        time: lp.timestamp.slice(11, 16),
        timestamp: lp.timestamp,
        speed: null,
        latency: lp.rtt_p50,
        routerLatency: nearestGw ? nearestGw.rtt_p50 : null,
        wanSpeedMbps: null,
        streamCount: null,
        uploadSpeed: null,
      });
    }
  }

  joined.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  joined.forEach((p, i) => (p.idx = i));
  return joined;
}

// ── Congestion detection (chart-oriented) ────────────────────

/**
 * Detects congestion events from joined data.
 * Returns CongestionEvent[] with index references for chart rendering.
 *
 * Key design decisions:
 *   - Only multi-stream tests are evaluated — single-stream speeds reflect
 *     throttling, not ISP capacity, and would cause massive false positives
 *   - Latency threshold has an absolute floor (5ms) so that sub-2ms baselines
 *     don't trigger on normal jitter
 *   - Events must have ≥2 data points to be reported (single-point = noise)
 *   - Nearby congested points within 10 min are grouped into one event
 */
export function detectCongestionEvents(data: JoinedPoint[]): CongestionEvent[] {
  // Only consider multi-stream points with both speed and latency
  const multiWithBoth = data.filter(
    (p) =>
      p.speed != null &&
      p.latency != null &&
      isMultiStream(p.streamCount)
  );
  if (multiWithBoth.length < 5) return [];

  const speeds = multiWithBoth.map((p) => p.speed!);
  const latencies = multiWithBoth.map((p) => p.latency!);
  const overallMedianSpeed = medianOf(speeds);
  const overallMedianLatency = medianOf(latencies);
  const latencyThreshold = Math.max(
    overallMedianLatency * 2,
    MIN_LATENCY_FLOOR_MS
  );

  // Upload corroboration: upload is consistently ~800 Mbps regardless of
  // household download traffic, so upload degradation = ISP pipe is choked
  const uploadSpeeds = multiWithBoth
    .filter((p) => p.uploadSpeed != null)
    .map((p) => p.uploadSpeed!);
  const medianUpload = uploadSpeeds.length > 0 ? medianOf(uploadSpeeds) : null;
  const uploadDegradedThreshold = medianUpload != null ? medianUpload * 0.7 : null;

  // Compute excess traffic = WAN − speed (other devices' bandwidth)
  const wanVals = multiWithBoth
    .filter((p) => p.wanSpeedMbps != null)
    .map((p) => p.wanSpeedMbps!);
  const medianWan = wanVals.length > 0 ? medianOf(wanVals) : null;
  const excessVals = multiWithBoth
    .filter((p) => p.wanSpeedMbps != null)
    .map((p) => p.wanSpeedMbps! - p.speed!);
  const medianExcess = excessVals.length > 0 ? medianOf(excessVals) : null;
  const excessThreshold =
    medianExcess != null ? Math.max(100, medianExcess * 3) : 100;

  // WAN sanity: if total router throughput >= 40% of median, the ISP pipe
  // was open — the speed test's poor result is local traffic, not ISP.
  const wanNormalThreshold = medianWan != null ? medianWan * 0.4 : null;

  // Build lookup for neighbor excess within ±3 min
  const THREE_MIN = 3 * 60 * 1000;
  const pointsWithWan = multiWithBoth.filter((p) => p.wanSpeedMbps != null);

  function getExcess(p: JoinedPoint): number | null {
    if (p.wanSpeedMbps != null) return p.wanSpeedMbps - p.speed!;
    // No WAN data — borrow nearest neighbor's excess
    const pTime = new Date(p.timestamp).getTime();
    let best: number | null = null;
    let bestDist = Infinity;
    for (const w of pointsWithWan) {
      const d = Math.abs(new Date(w.timestamp).getTime() - pTime);
      if (d > 0 && d < bestDist && d <= THREE_MIN) {
        bestDist = d;
        best = w.wanSpeedMbps! - w.speed!;
      }
    }
    return best;
  }

  // Identify all congested multi-stream points
  const congestedPoints: JoinedPoint[] = [];
  for (const p of multiWithBoth) {
    const excess = getExcess(p);
    const highExcess = excess != null && excess > excessThreshold;
    const wanNormal =
      p.wanSpeedMbps != null &&
      wanNormalThreshold != null &&
      p.wanSpeedMbps >= wanNormalThreshold;
    const localNetworkBusy = highExcess || wanNormal;

    const isCongested =
      !localNetworkBusy &&
      p.latency! > latencyThreshold &&
      p.speed! < overallMedianSpeed * 0.7;

    if (isCongested) {
      congestedPoints.push(p);
    }
  }

  // Group nearby congested points into events (within gap tolerance).
  // Require WAN confirmation and upload corroboration.
  const events: CongestionEvent[] = [];
  let curGroup: JoinedPoint[] = [];

  function hasWanConfirmation(group: JoinedPoint[]): boolean {
    return group.some((p) => p.wanSpeedMbps != null);
  }

  function hasUploadCorroboration(group: JoinedPoint[]): boolean {
    if (uploadDegradedThreshold == null) return true; // no upload data available
    return group.some(
      (p) => p.uploadSpeed != null && p.uploadSpeed < uploadDegradedThreshold
    );
  }

  for (const p of congestedPoints) {
    if (curGroup.length === 0) {
      curGroup.push(p);
    } else {
      const lastTime = new Date(
        curGroup[curGroup.length - 1].timestamp
      ).getTime();
      const thisTime = new Date(p.timestamp).getTime();
      if (thisTime - lastTime <= EVENT_GAP_TOLERANCE_MS) {
        curGroup.push(p);
      } else {
        if (
          curGroup.length >= MIN_POINTS_PER_EVENT &&
          hasWanConfirmation(curGroup) &&
          hasUploadCorroboration(curGroup)
        ) {
          events.push(groupToChartEvent(curGroup));
        }
        curGroup = [p];
      }
    }
  }
  if (
    curGroup.length >= MIN_POINTS_PER_EVENT &&
    hasWanConfirmation(curGroup) &&
    hasUploadCorroboration(curGroup)
  ) {
    events.push(groupToChartEvent(curGroup));
  }

  return events;
}

function groupToChartEvent(points: JoinedPoint[]): CongestionEvent {
  return {
    startIdx: 0,
    endIdx: 0,
    joinedStartIdx: points[0].idx,
    joinedEndIdx: points[points.length - 1].idx,
    startTime: points[0].time,
    endTime: points[points.length - 1].time,
    peakLatency: Math.max(...points.map((p) => p.latency!)),
    minSpeed: Math.min(...points.map((p) => p.speed!)),
  };
}

// ── Evidence-style analysis (server-side) ────────────────────

/**
 * Full congestion analysis for the verdict page.
 * Accepts raw throughput + latency arrays, returns a summary with events,
 * filtered count, and medians.
 *
 * Key improvements over earlier versions:
 *   - Multi-stream only: single-stream tests reflect throttling, not congestion
 *   - Absolute latency floor: requires ≥5ms to trigger (not just 2× a sub-2ms median)
 *   - Minimum evidence: events need ≥2 data points (single-point = noise)
 *   - Time-based grouping: points within 10 min form one event (tolerates test gaps)
 */
export function analyzeCongestion(
  throughputHistory: any[],
  latencyHistory: any[],
  gatewayLatencyHistory: any[]
): CongestionAnalysisResult {
  // Filter to multi-stream downloads and uploads
  const downloads = (throughputHistory || [])
    .filter(
      (t: any) =>
        t.direction === "download" &&
        t.speed_mbps > 0 &&
        isMultiStream(t.stream_count)
    )
    .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
  const uploads = (throughputHistory || [])
    .filter(
      (t: any) =>
        t.direction === "upload" &&
        t.speed_mbps > 0 &&
        isMultiStream(t.stream_count)
    )
    .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
  const ispLatency = (latencyHistory || [])
    .filter((l: any) => l.rtt_p50 != null && l.target_id === "bcube")
    .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
  const gwLatency = (gatewayLatencyHistory || [])
    .filter((l: any) => l.rtt_p50 != null)
    .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));

  const medianUpload = medianOf(uploads.map((u: any) => u.speed_mbps));
  const uploadDegradedThreshold = medianUpload * 0.7;

  if (downloads.length < 5 || ispLatency.length < 5) {
    return {
      events: [],
      filtered: 0,
      total: 0,
      medianSpeed: 0,
      medianLatency: 0,
      medianWan: null,
    };
  }

  const THREE_MIN = 3 * 60 * 1000;
  const TWO_MIN = 2 * 60 * 1000;

  // Join: for each multi-stream download, find peak ISP latency (±3 min)
  // and nearest gateway latency (±2 min).
  // Peak latency captures spikes that occur between speed test and latency
  // measurement timestamps — crucial for detecting congestion events where
  // latency fluctuates minute-to-minute.
  interface AnnotatedPoint {
    timestamp: string;
    time: string;
    speed: number;
    latency: number;
    routerLatency: number | null;
    wanSpeedMbps: number | null;
    uploadSpeed: number | null;
    localNetworkBusy: boolean;
    isCongested: boolean;
  }

  const joined: AnnotatedPoint[] = downloads
    .map((dl: any) => {
      const dlTime = new Date(dl.timestamp).getTime();
      const peakIspLatency = findPeakInWindow(ispLatency, dlTime, THREE_MIN);
      const nearGw = findNearest(gwLatency, dlTime, TWO_MIN);
      // Upload runs ~40-53s after download — find paired upload within ±2 min
      const nearUl = findNearest(uploads, dlTime, TWO_MIN);
      let wanSpeedMbps: number | null = null;
      if (dl.wan_rx_delta != null && dl.duration_ms > 0) {
        wanSpeedMbps =
          Math.round(
            ((dl.wan_rx_delta * 8) / (dl.duration_ms / 1000) / 1_000_000) * 10
          ) / 10;
      }
      return {
        timestamp: dl.timestamp,
        time: dl.timestamp.slice(11, 16),
        speed: dl.speed_mbps as number,
        latency: peakIspLatency,
        routerLatency: nearGw ? (nearGw.rtt_p50 as number) : null,
        wanSpeedMbps,
        uploadSpeed: nearUl ? (nearUl.speed_mbps as number) : null,
        localNetworkBusy: false,
        isCongested: false,
      };
    })
    .filter((p: any) => p.latency != null) as AnnotatedPoint[];

  const medianSpeed = medianOf(joined.map((p) => p.speed));
  const medianLatency = medianOf(joined.map((p) => p.latency));
  const latencyThreshold = Math.max(medianLatency * 2, MIN_LATENCY_FLOOR_MS);
  const wanVals = joined
    .filter((p) => p.wanSpeedMbps != null)
    .map((p) => p.wanSpeedMbps!);
  const medianWan = wanVals.length > 0 ? medianOf(wanVals) : null;

  // Excess traffic = WAN throughput minus the test result = other devices' usage
  const excessVals = joined
    .filter((p) => p.wanSpeedMbps != null)
    .map((p) => p.wanSpeedMbps! - p.speed);
  const medianExcess = excessVals.length > 0 ? medianOf(excessVals) : null;
  // Threshold: at least 100 Mbps of other traffic, or 3x normal household background
  const excessThreshold =
    medianExcess != null ? Math.max(100, medianExcess * 3) : 100;

  // Points with WAN data for neighbor lookup
  const pointsWithWan = joined.filter((p) => p.wanSpeedMbps != null);

  // WAN sanity threshold: if total router throughput is above 40% of the
  // median WAN, the ISP pipe was open — the speed test's poor result is
  // explained by local traffic sharing the connection, not ISP congestion.
  // 40% rather than 50% because evening peak naturally depresses WAN totals
  // due to household usage, which is NOT the ISP's fault.
  const wanNormalThreshold = medianWan != null ? medianWan * 0.4 : null;

  // Annotate each point
  for (const p of joined) {
    let excess: number | null = null;
    if (p.wanSpeedMbps != null) {
      excess = p.wanSpeedMbps - p.speed;
    } else {
      // No WAN data — check nearest neighbor within ±3 min
      const pTime = new Date(p.timestamp).getTime();
      let bestDist = Infinity;
      for (const w of pointsWithWan) {
        const d = Math.abs(new Date(w.timestamp).getTime() - pTime);
        if (d > 0 && d < bestDist && d <= THREE_MIN) {
          bestDist = d;
          excess = w.wanSpeedMbps! - w.speed;
        }
      }
    }

    // Local network busy: either high excess traffic OR WAN total is
    // normal (ISP pipe was open, speed test just got a smaller share)
    const highExcess = excess != null && excess > excessThreshold;
    const wanNormal =
      p.wanSpeedMbps != null &&
      wanNormalThreshold != null &&
      p.wanSpeedMbps >= wanNormalThreshold;

    p.localNetworkBusy = highExcess || wanNormal;
    p.isCongested =
      !p.localNetworkBusy &&
      p.latency > latencyThreshold &&
      p.speed < medianSpeed * 0.7;

  }

  // Group nearby congested points into events (time-based, not consecutive-only).
  // An event requires:
  //   1. ≥ MIN_POINTS_PER_EVENT congested points
  //   2. At least one point with WAN data confirming local network wasn't busy
  //   3. At least one point with a degraded paired upload test — upload is
  //      consistently high (~800 Mbps) regardless of household download traffic,
  //      so upload degradation is strong evidence the ISP pipe itself is choked
  const congestedPoints = joined.filter((p) => p.isCongested);
  const events: DetectedEvent[] = [];
  let filteredCount = 0;
  let curGroup: AnnotatedPoint[] = [];

  function hasWanConfirmation(group: AnnotatedPoint[]): boolean {
    return group.some((p) => p.wanSpeedMbps != null && !p.localNetworkBusy);
  }

  function hasUploadCorroboration(group: AnnotatedPoint[]): boolean {
    return group.some(
      (p) => p.uploadSpeed != null && p.uploadSpeed < uploadDegradedThreshold
    );
  }

  for (const p of congestedPoints) {
    if (curGroup.length === 0) {
      curGroup.push(p);
    } else {
      const lastTime = new Date(
        curGroup[curGroup.length - 1].timestamp
      ).getTime();
      const thisTime = new Date(p.timestamp).getTime();
      if (thisTime - lastTime <= EVENT_GAP_TOLERANCE_MS) {
        curGroup.push(p);
      } else {
        if (
          curGroup.length >= MIN_POINTS_PER_EVENT &&
          hasWanConfirmation(curGroup) &&
          hasUploadCorroboration(curGroup)
        ) {
          events.push(makeEvent(curGroup));
        }
        curGroup = [p];
      }
    }
  }
  if (
    curGroup.length >= MIN_POINTS_PER_EVENT &&
    hasWanConfirmation(curGroup) &&
    hasUploadCorroboration(curGroup)
  ) {
    events.push(makeEvent(curGroup));
  }

  // Count filtered points (would have been congested but for local traffic)
  for (const p of joined) {
    if (
      p.localNetworkBusy &&
      p.latency > latencyThreshold &&
      p.speed < medianSpeed * 0.7
    ) {
      filteredCount++;
    }
  }

  function makeEvent(points: AnnotatedPoint[]): DetectedEvent {
    const rlVals = points
      .filter((p) => p.routerLatency != null)
      .map((p) => p.routerLatency!);
    return {
      startTime: points[0].timestamp,
      endTime: points[points.length - 1].timestamp,
      peakLatency: Math.max(...points.map((p) => p.latency)),
      minSpeed: Math.min(...points.map((p) => p.speed)),
      avgRouterLatency:
        rlVals.length > 0
          ? rlVals.reduce((s, v) => s + v, 0) / rlVals.length
          : null,
      pointCount: points.length,
    };
  }

  return {
    events,
    filtered: filteredCount,
    total: events.length + filteredCount,
    medianSpeed,
    medianLatency,
    medianWan,
  };
}
