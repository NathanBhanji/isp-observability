import { z } from "zod";

// ── Ping Schemas ─────────────────────────────────────────────

export const PingSampleSchema = z.object({
  id: z.number(),
  windowId: z.number(),
  seq: z.number(),
  rttMs: z.number().nullable(),
  timestamp: z.string(),
});

export const PingWindowSchema = z.object({
  id: z.number(),
  targetId: z.string(),
  targetIp: z.string(),
  timestamp: z.string(),
  samplesSent: z.number(),
  samplesReceived: z.number(),
  lossPct: z.number(),
  rttMin: z.number().nullable(),
  rttMax: z.number().nullable(),
  rttMean: z.number().nullable(),
  rttMedian: z.number().nullable(),
  rttStddev: z.number().nullable(),
  rttP50: z.number().nullable(),
  rttP90: z.number().nullable(),
  rttP95: z.number().nullable(),
  rttP99: z.number().nullable(),
  jitterMean: z.number().nullable(),
  jitterMax: z.number().nullable(),
  spikes10ms: z.number(),
  spikes15ms: z.number(),
  spikes20ms: z.number(),
});

// ── Throughput Schemas ───────────────────────────────────────

export const ThroughputTestSchema = z.object({
  id: z.number(),
  timestamp: z.string(),
  streamCount: z.number(),
  bytesDownloaded: z.number(),
  durationMs: z.number(),
  speedMbps: z.number(),
  sourceUrl: z.string(),
  sourceType: z.enum(["wired", "ethernet"]),
});

export const ThroughputTimeseriesSchema = z.object({
  id: z.number(),
  testId: z.number(),
  secondOffset: z.number(),
  bytesThisSecond: z.number(),
  speedMbps: z.number(),
});

// ── Correlation Schemas ──────────────────────────────────────

export const CorrelationSampleSchema = z.object({
  id: z.number(),
  sessionId: z.string(),
  timestamp: z.string(),
  targetId: z.string(),
  rttMs: z.number().nullable(),
  throughputMbps: z.number().nullable(),
});

export const CorrelationSessionSchema = z.object({
  sessionId: z.string(),
  timestamp: z.string(),
  samples: z.array(CorrelationSampleSchema),
  pearsonR: z.number().nullable(),
});

// ── Traceroute Schemas ───────────────────────────────────────

export const TracerouteHopSchema = z.object({
  id: z.number(),
  tracerouteId: z.number(),
  hopNumber: z.number(),
  ip: z.string().nullable(),
  hostname: z.string().nullable(),
  rttMs: z.number().nullable(),
});

export const TracerouteResultSchema = z.object({
  id: z.number(),
  destination: z.string(),
  timestamp: z.string(),
  hopCount: z.number(),
  respondingHops: z.number(),
  darkHops: z.number(),
  pathHash: z.string(),
  hops: z.array(TracerouteHopSchema),
});

// ── Router Status Schema ─────────────────────────────────────

export const RouterStatusSchema = z.object({
  id: z.number(),
  timestamp: z.string(),
  downstreamMaxBps: z.number().nullable(),
  upstreamMaxBps: z.number().nullable(),
  physicalLinkStatus: z.string().nullable(),
  connectionUptimeSec: z.number().nullable(),
  totalBytesReceived: z.number().nullable(),
  totalBytesSent: z.number().nullable(),
});

// ── RIPE Atlas Schema ────────────────────────────────────────

export const RipeAtlasResultSchema = z.object({
  id: z.number(),
  probeId: z.number(),
  destination: z.string(),
  timestamp: z.string(),
  hopCount: z.number(),
  matchedTargetIds: z.string(),
  transitRttMs: z.number().nullable(),
  rawJson: z.string(),
});

// ── Evidence Summary Schema ──────────────────────────────────

export const EvidenceSummarySchema = z.object({
  hopComparison: z
    .object({
      hops: z.array(z.object({ targetId: z.string(), label: z.string(), ip: z.string(), stddev: z.number(), spikes15msPct: z.number(), meanRtt: z.number() })),
    })
    .nullable(),
  throughputPolicing: z
    .object({
      singleStreamMean: z.number(),
      multiStreamMean: z.number(),
      ratio: z.number(),
      decayDetected: z.boolean(),
    })
    .nullable(),
  correlation: z
    .object({
      pearsonR: z.number(),
      interpretation: z.string(),
    })
    .nullable(),
  pathAnalysis: z
    .object({
      yourHopCount: z.number(),
      peerMeanHopCount: z.number(),
      peersMatchedTargets: z.record(z.number()),
    })
    .nullable(),
  collectionPeriod: z.object({
    start: z.string(),
    end: z.string(),
    totalPingWindows: z.number(),
    totalThroughputTests: z.number(),
  }),
});

// ── Collector Health Schema ──────────────────────────────────

export const CollectorHealthSchema = z.object({
  uptime: z.number(),
  startedAt: z.string(),
  collectors: z.record(
    z.object({
      lastRun: z.string().nullable(),
      lastError: z.string().nullable(),
      runCount: z.number(),
      errorCount: z.number(),
    })
  ),
});
