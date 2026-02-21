import type { TargetId } from "./constants";

// ── Ping ─────────────────────────────────────────────────────

export interface PingSample {
  id: number;
  windowId: number;
  seq: number;
  rttMs: number | null; // null = packet lost
  timestamp: string;
}

export interface PingWindow {
  id: number;
  targetId: TargetId;
  targetIp: string;
  timestamp: string;
  samplesSent: number;
  samplesReceived: number;
  lossPct: number;
  rttMin: number | null;
  rttMax: number | null;
  rttMean: number | null;
  rttMedian: number | null;
  rttStddev: number | null;
  rttP50: number | null;
  rttP90: number | null;
  rttP95: number | null;
  rttP99: number | null;
  jitterMean: number | null;
  jitterMax: number | null;
  spikes10ms: number;
  spikes15ms: number;
  spikes20ms: number;
}

// ── Throughput ────────────────────────────────────────────────

export interface ThroughputTest {
  id: number;
  timestamp: string;
  streamCount: number;
  bytesDownloaded: number;
  durationMs: number;
  speedMbps: number;
  sourceUrl: string;
  sourceType: "wired" | "ethernet";
  direction: "download" | "upload";
}

export interface ThroughputTimeseries {
  id: number;
  testId: number;
  secondOffset: number;
  bytesThisSecond: number;
  speedMbps: number;
}

export interface ThroughputPair {
  singleStream: ThroughputTest | null;
  multiStream: ThroughputTest | null;
  ratio: number | null;
}

// ── Correlation ──────────────────────────────────────────────

export interface CorrelationSample {
  id: number;
  sessionId: string;
  timestamp: string;
  targetId: TargetId;
  rttMs: number | null;
  throughputMbps: number | null;
}

export interface CorrelationSession {
  sessionId: string;
  timestamp: string;
  samples: CorrelationSample[];
  pearsonR: number | null;
}

// ── Traceroute ───────────────────────────────────────────────

export interface TracerouteHop {
  id: number;
  tracerouteId: number;
  hopNumber: number;
  ip: string | null; // null = dark hop (*)
  hostname: string | null;
  rttMs: number | null;
}

export interface TracerouteResult {
  id: number;
  destination: string;
  timestamp: string;
  hopCount: number;
  respondingHops: number;
  darkHops: number;
  pathHash: string;
  hops: TracerouteHop[];
}

// ── RIPE Atlas ───────────────────────────────────────────────

export interface RipeAtlasResult {
  id: number;
  probeId: number;
  destination: string;
  timestamp: string;
  hopCount: number;
  matchedTargetIds: string;
  transitRttMs: number | null;
  rawJson: string;
}

// ── Router Status ────────────────────────────────────────────

export interface RouterStatus {
  id: number;
  timestamp: string;
  downstreamMaxBps: number | null;
  upstreamMaxBps: number | null;
  physicalLinkStatus: string | null;
  connectionUptimeSec: number | null;
  totalBytesReceived: number | null;
  totalBytesSent: number | null;
}

// ── Collector Status ─────────────────────────────────────────

export interface CollectorHealth {
  uptime: number;
  startedAt: string;
  collectors: Record<
    string,
    {
      lastRun: string | null;
      lastError: string | null;
      runCount: number;
      errorCount: number;
    }
  >;
}

// ── Evidence Summary ─────────────────────────────────────────

export interface EvidenceSummary {
  /** Per-hop comparison (adjacent hops) */
  hopComparison: {
    hops: { targetId: string; label: string; ip: string; stddev: number; spikes15msPct: number; meanRtt: number }[];
  } | null;
  /** Throughput policing evidence */
  throughputPolicing: {
    singleStreamMean: number;
    multiStreamMean: number;
    ratio: number;
    decayDetected: boolean;
  } | null;
  /** Correlation evidence */
  correlation: {
    pearsonR: number;
    interpretation: string;
  } | null;
  /** Path analysis */
  pathAnalysis: {
    yourHopCount: number;
    peerMeanHopCount: number;
    peersMatchedTargets: Record<string, number>;
  } | null;
  /** Packet loss per target */
  packetLoss: {
    perTarget: Record<string, { avgLoss: number; maxLoss: number; windows: number }>;
    lossyWindowsPerTarget: Record<string, number>;
  } | null;
  /** Time-of-day / peak vs off-peak analysis */
  timeOfDay: {
    hourlyLatency: { hour: number; avgRtt: number; avgStddev: number; avgLoss: number; samples: number }[];
    hourlyThroughput: { hour: number; avgSpeed: number; samples: number }[];
    peak: { avgRtt: number | null; avgLoss: number | null; avgSpeed: number | null };
    offPeak: { avgRtt: number | null; avgLoss: number | null; avgSpeed: number | null };
  } | null;
  /** Upload vs download comparison */
  uploadEvidence: {
    downloadMean: number;
    uploadMean: number;
    ratio: number | null;
    downloadTests: number;
    uploadTests: number;
  } | null;
  /** Per-hop latency degradation over time */
  hopTrending: {
    perTarget: Record<string, { day: string; avgRtt: number; minRtt: number; maxRtt: number; samples: number }[]>;
    degradationMs: Record<string, number>;
    periodDays: number;
  } | null;
  /** Micro-outage summary */
  outageSummary: {
    count: number;
    totalDurationMs: number;
    longestMs: number;
    recent: { startedAt: string; endedAt: string | null; durationMs: number; missedPings: number }[];
  } | null;
  /** Data collection period */
  collectionPeriod: {
    start: string;
    end: string;
    totalPingWindows: number;
    totalThroughputTests: number;
  };
}
