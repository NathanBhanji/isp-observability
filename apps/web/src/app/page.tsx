import { Metadata } from "next";
import {
  fetchEvidenceSummary,
  fetchThroughputHistory,
  fetchLatencyHistory,
  timeframeToSince,
} from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { THRESHOLDS, TARGET_LABELS, ISP_PLAN } from "@isp/shared";
import {
  adjustedSpeed,
  adjustedMedian,
  verdictSoftening,
  type ThroughputTest,
} from "@/lib/throughput-utils";
import { type VerdictStatus } from "@/components/dashboard/verdict-card";
import { analyzeCongestion } from "@/lib/congestion";
import { HourlyPerformanceChart } from "@/components/charts/hourly-latency-bar";
import { interpretCorrelation, HOP_LABELS, formatDurationMs } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  XCircle,
  ArrowRight,
  Shield,
  Database,
  Info,
} from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = { title: "ISP Observatory" };

// ── Types ────────────────────────────────────────────────────

interface DetectedIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  evidence: string;
  frequency?: string;
  recommendation: string;
  link?: string;
  linkLabel?: string;
}

// ── Status styling ───────────────────────────────────────────

const STATUS_CONFIG: Record<
  VerdictStatus,
  { label: string; icon: typeof CheckCircle2; border: string; bg: string; text: string; badgeBg: string; badgeBorder: string }
> = {
  healthy: {
    label: "All Clear",
    icon: CheckCircle2,
    border: "border-l-verdict-healthy",
    bg: "bg-verdict-healthy/5",
    text: "text-verdict-healthy",
    badgeBg: "bg-verdict-healthy/10",
    badgeBorder: "border-verdict-healthy/20",
  },
  degraded: {
    label: "Minor Issues",
    icon: AlertTriangle,
    border: "border-l-verdict-degraded",
    bg: "bg-verdict-degraded/5",
    text: "text-verdict-degraded",
    badgeBg: "bg-verdict-degraded/10",
    badgeBorder: "border-verdict-degraded/20",
  },
  poor: {
    label: "Performance Issues",
    icon: AlertCircle,
    border: "border-l-verdict-poor",
    bg: "bg-verdict-poor/5",
    text: "text-verdict-poor",
    badgeBg: "bg-verdict-poor/10",
    badgeBorder: "border-verdict-poor/20",
  },
  critical: {
    label: "Action Needed",
    icon: XCircle,
    border: "border-l-verdict-critical",
    bg: "bg-verdict-critical/5",
    text: "text-verdict-critical",
    badgeBg: "bg-verdict-critical/10",
    badgeBorder: "border-verdict-critical/20",
  },
};

// ── Helpers ──────────────────────────────────────────────────

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural || singular + "s"}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function trendArrow(delta: number, threshold = 1) {
  if (Math.abs(delta) < threshold) return <Minus className="h-3 w-3 text-muted-foreground inline" />;
  if (delta > 0) return <TrendingUp className="h-3 w-3 text-verdict-poor inline" />;
  return <TrendingDown className="h-3 w-3 text-verdict-healthy inline" />;
}

// ── Page Component ───────────────────────────────────────────

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const [evidence, throughputHistory, latencyHistory, gatewayLatencyHistory] = await Promise.all([
    fetchEvidenceSummary(since),
    fetchThroughputHistory(since),
    fetchLatencyHistory(since),
    fetchLatencyHistory(since, "gateway"),
  ]);

  // ── Period ─────────────────────────────────────────────────
  const periodStart = evidence?.collectionPeriod?.start;
  const periodEnd = evidence?.collectionPeriod?.end;
  let periodMs = 0;
  let periodLabel = "N/A";
  if (periodStart && periodEnd) {
    periodMs = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
    const days = Math.floor(periodMs / 86400000);
    const hours = Math.floor((periodMs % 86400000) / 3600000);
    if (days > 0) periodLabel = `${pluralize(days, "day")}, ${pluralize(hours, "hour")}`;
    else periodLabel = pluralize(hours, "hour");
  }

  // ── Throughput stats ───────────────────────────────────────
  const dlMulti = (throughputHistory || []).filter((t: any) => t.direction === "download" && t.stream_count === 4);
  const dlSingle = (throughputHistory || []).filter((t: any) => t.direction === "download" && t.stream_count === 1);
  const ulMulti = (throughputHistory || []).filter((t: any) => t.direction === "upload" && t.stream_count === 4);
  const ulSingle = (throughputHistory || []).filter((t: any) => t.direction === "upload" && t.stream_count === 1);

  const dlMultiSpeeds = dlMulti.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);
  const dlSingleSpeeds = dlSingle.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);
  const ulMultiSpeeds = ulMulti.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);
  const ulSingleSpeeds = ulSingle.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);

  const adjDlMultiSpeeds = (dlMulti as ThroughputTest[]).map(adjustedSpeed).sort((a, b) => a - b);
  const adjUlMultiSpeeds = (ulMulti as ThroughputTest[]).map(adjustedSpeed).sort((a, b) => a - b);
  const hasAdjData = adjDlMultiSpeeds.length > 0 &&
    adjDlMultiSpeeds.some((v, i) => Math.abs(v - dlMultiSpeeds[i]) > 0.1);

  const dlMedian = percentile(dlMultiSpeeds, 50);
  const ulMedian = percentile(ulMultiSpeeds, 50);
  const adjDlMedian = hasAdjData ? percentile(adjDlMultiSpeeds, 50) : null;
  const adjUlMedian = adjustedMedian(ulMulti as ThroughputTest[]) ?? ulMedian;
  const effectiveMedianDl = adjDlMedian ?? dlMedian;

  // Throttle detection
  const hasThrottling = evidence?.throughputPolicing?.policingRatio > THRESHOLDS.policingRatio;
  const adjPolicingRatio = evidence?.throughputPolicing?.adjustedPolicingRatio;
  const adjMultiDlMean = evidence?.throughputPolicing?.adjustedMultiDownloadMean;
  const rawMultiDlMean = evidence?.throughputPolicing?.multiDownloadMean;
  const hasWanContext = adjMultiDlMean != null && adjMultiDlMean !== rawMultiDlMean;

  // Throttle frequency: how often is ratio > threshold?
  const ratioTests: number[] = [];
  for (let i = 0; i < Math.min(dlSingle.length, dlMulti.length); i++) {
    if (dlSingle[i]?.speed_mbps > 0 && dlMulti[i]?.speed_mbps > 0) {
      ratioTests.push(dlMulti[i].speed_mbps / dlSingle[i].speed_mbps);
    }
  }
  const throttledCount = ratioTests.filter((r) => r > THRESHOLDS.policingRatio).length;
  const throttleFreq = ratioTests.length > 0 ? (throttledCount / ratioTests.length) * 100 : 0;

  // Upload throttle frequency
  const ulRatioTests: number[] = [];
  for (let i = 0; i < Math.min(ulSingle.length, ulMulti.length); i++) {
    if (ulSingle[i]?.speed_mbps > 0 && ulMulti[i]?.speed_mbps > 0) {
      ulRatioTests.push(ulMulti[i].speed_mbps / ulSingle[i].speed_mbps);
    }
  }
  const ulThrottledCount = ulRatioTests.filter((r) => r > THRESHOLDS.policingRatio).length;
  const ulThrottleFreq = ulRatioTests.length > 0 ? (ulThrottledCount / ulRatioTests.length) * 100 : 0;
  const hasUlThrottling = ulThrottleFreq > 50;

  // Verdict softening (ISP delivering OK but household traffic reducing measurement)
  const dlSoftening = verdictSoftening(
    dlMedian > 0 ? dlMedian : null,
    effectiveMedianDl > 0 ? effectiveMedianDl : null,
    ISP_PLAN.minimumDown,
    "the speed test"
  );

  // ── Per-target latency stats ───────────────────────────────
  const targetIds = ["gateway", "aggregation", "bcube", "google", "cloudflare"];
  const latencyStats = targetIds.map((tid) => {
    const windows = (latencyHistory || []).filter((l: any) => l.target_id === tid);
    const rtts = windows.map((l: any) => l.rtt_p50).filter((v: any) => v != null).sort((a: number, b: number) => a - b);
    const stddevs = windows.map((l: any) => l.rtt_stddev).filter((v: any) => v != null);
    const losses = windows.map((l: any) => l.loss_pct).filter((v: any) => v != null);
    const avgLoss = losses.length > 0 ? losses.reduce((s: number, v: number) => s + v, 0) / losses.length : 0;
    const avgStddev = stddevs.length > 0 ? stddevs.reduce((s: number, v: number) => s + v, 0) / stddevs.length : 0;
    return {
      targetId: tid,
      label: HOP_LABELS[tid] || TARGET_LABELS[tid] || tid,
      count: windows.length,
      p5: percentile(rtts, 5),
      p50: percentile(rtts, 50),
      p95: percentile(rtts, 95),
      avgStddev,
      avgLoss,
      degradation: evidence?.hopTrending?.degradationMs?.[tid] ?? null,
    };
  });

  // ── Packet loss ────────────────────────────────────────────
  const hasHighLoss = evidence?.packetLoss?.perTarget &&
    Object.values(evidence.packetLoss.perTarget).some((t: any) => t.avgLoss > THRESHOLDS.maxAcceptableLoss);

  const allLoss = (latencyHistory || [])
    .filter((l: any) => l.target_id !== "google_v6" && l.target_id !== "cloudflare_v6")
    .map((l: any) => l.loss_pct)
    .filter((v: any) => v != null);
  const lossyWindows = allLoss.filter((l: number) => l > 0).length;
  const lossRate = allLoss.length > 0 ? (lossyWindows / allLoss.length) * 100 : 0;

  const highLossTargets = evidence?.packetLoss?.perTarget
    ? Object.entries(evidence.packetLoss.perTarget).filter(([, d]: [string, any]) => d.avgLoss > THRESHOLDS.maxAcceptableLoss)
    : [];

  // ── IPv6 ───────────────────────────────────────────────────
  const v6History = (latencyHistory || []).filter(
    (l: any) => l.target_id === "google_v6" || l.target_id === "cloudflare_v6"
  );
  const v6TotalSent = v6History.reduce((s: number, l: any) => s + (l.samples_sent || 0), 0);
  const v6TotalReceived = v6History.reduce((s: number, l: any) => s + (l.samples_received || 0), 0);
  const v6Broken = v6TotalSent > 10 && v6TotalReceived === 0;

  // ── Outages ────────────────────────────────────────────────
  const hasOutages = evidence?.outageSummary?.count > 0;
  const outageCount = evidence?.outageSummary?.count || 0;
  const totalDowntimeMs = evidence?.outageSummary?.totalDurationMs || 0;
  const hasSignificantOutages = outageCount > 3 || totalDowntimeMs > 60000;

  // ── Congestion analysis ────────────────────────────────────
  const congestionAnalysis = analyzeCongestion(
    throughputHistory || [],
    latencyHistory || [],
    gatewayLatencyHistory || [],
  );
  const congestionEventCount = congestionAnalysis.events.length;
  const hasCongestionEvents = congestionEventCount > 0;

  // ── Time-of-day ────────────────────────────────────────────
  const peakSpeed = evidence?.timeOfDay?.peak?.avgSpeed as number | null;
  const offPeakSpeed = evidence?.timeOfDay?.offPeak?.avgSpeed as number | null;
  const peakSlowerPct = (peakSpeed != null && offPeakSpeed != null && offPeakSpeed > 0)
    ? ((1 - peakSpeed / offPeakSpeed) * 100)
    : null;
  const hasPeakDegradation = peakSlowerPct != null && peakSlowerPct > 15;
  const peakBelowMinimum = peakSpeed != null && peakSpeed < ISP_PLAN.minimumDown;

  const peakAvgRtt = evidence?.timeOfDay?.peak?.avgRtt as number | null;
  const offPeakAvgRtt = evidence?.timeOfDay?.offPeak?.avgRtt as number | null;

  // ── Hop trending ───────────────────────────────────────────
  const hopDegradation = evidence?.hopTrending?.degradationMs || {};
  const degradingHops = Object.entries(hopDegradation)
    .filter(([, d]) => (d as number) > 2)
    .map(([id, d]) => ({ id, delta: d as number }));

  // ── Latency stability ──────────────────────────────────────
  const unstableHops = latencyStats.filter(s => s.avgStddev > THRESHOLDS.maxAcceptableStddev);
  const hasLatencyInstability = unstableHops.length > 0;

  // ── Plan comparison ────────────────────────────────────────
  const belowMinimum = effectiveMedianDl != null && effectiveMedianDl > 0 && effectiveMedianDl < ISP_PLAN.minimumDown;
  const belowAvgPeak = effectiveMedianDl != null && effectiveMedianDl > 0 && effectiveMedianDl < ISP_PLAN.avgPeakDown;
  const dlPlanPct = effectiveMedianDl > 0 ? (effectiveMedianDl / ISP_PLAN.avgPeakDown) * 100 : null;
  const ulPlanPct = adjUlMedian > 0 ? (adjUlMedian / ISP_PLAN.avgPeakUp) * 100 : null;
  const ulBelowMinimum = adjUlMedian > 0 && adjUlMedian < ISP_PLAN.minimumUp;

  // ══════════════════════════════════════════════════════════
  // ── VERDICT — holistic status from 7 signals ─────────────
  // ══════════════════════════════════════════════════════════

  const issueSignals = [
    belowAvgPeak,
    hasPeakDegradation,
    hasCongestionEvents,
    hasThrottling,
    hasHighLoss,
    hasOutages,
    hasLatencyInstability,
  ].filter(Boolean).length;

  let verdictStatus: VerdictStatus = "healthy";
  if (belowMinimum || peakBelowMinimum || issueSignals >= 4) verdictStatus = "critical";
  else if (hasCongestionEvents || hasThrottling || hasHighLoss || belowAvgPeak || issueSignals >= 2) verdictStatus = "poor";
  else if (hasOutages || hasPeakDegradation || hasLatencyInstability) verdictStatus = "degraded";

  // Verdict softening override
  if (verdictStatus === "critical" && belowMinimum && dlSoftening.shouldSoften && issueSignals < 3) {
    verdictStatus = "degraded";
  }

  // Headline — most impactful finding first
  let verdictHeadline: string;
  if (belowMinimum && !dlSoftening.shouldSoften) {
    verdictHeadline = `Median speed ${effectiveMedianDl!.toFixed(0)} Mbps — below ${ISP_PLAN.provider}'s ${ISP_PLAN.minimumDown} Mbps minimum guarantee`;
  } else if (peakBelowMinimum) {
    verdictHeadline = `Peak-hour speed ${peakSpeed!.toFixed(0)} Mbps — below ${ISP_PLAN.minimumDown} Mbps minimum guarantee`;
  } else if (belowAvgPeak && hasCongestionEvents) {
    verdictHeadline = `Speeds below ${ISP_PLAN.avgPeakDown} Mbps promise with ${congestionEventCount} congestion event${congestionEventCount > 1 ? "s" : ""}`;
  } else if (belowAvgPeak) {
    verdictHeadline = `Median speed ${effectiveMedianDl!.toFixed(0)} Mbps — below ${ISP_PLAN.provider}'s ${ISP_PLAN.avgPeakDown} Mbps average promise`;
  } else if (dlSoftening.shouldSoften && belowMinimum) {
    verdictHeadline = "Household traffic reducing measured speed — ISP delivering adequately";
  } else if (hasCongestionEvents && hasThrottling) {
    verdictHeadline = `${congestionEventCount} congestion event${congestionEventCount > 1 ? "s" : ""} and speed throttling detected`;
  } else if (hasCongestionEvents) {
    verdictHeadline = `${congestionEventCount} ISP congestion event${congestionEventCount > 1 ? "s" : ""} confirmed in measurement data`;
  } else if (hasThrottling) {
    verdictHeadline = `Speed throttling detected — ${evidence?.throughputPolicing?.policingRatio?.toFixed(2)}x single-to-multi ratio`;
  } else if (hasSignificantOutages) {
    verdictHeadline = `${outageCount} connectivity drop${outageCount > 1 ? "s" : ""} recorded`;
  } else if (hasHighLoss) {
    verdictHeadline = `Elevated packet loss on ${highLossTargets.length} network path${highLossTargets.length > 1 ? "s" : ""}`;
  } else {
    verdictHeadline = "No significant issues found in historical measurements";
  }

  // ── Upload vs download asymmetry ─────────────────────────
  const effectiveMedianUl = adjUlMedian > 0 ? adjUlMedian : ulMedian;
  const ulFasterThanDl = effectiveMedianDl > 0 && effectiveMedianUl > 0 && effectiveMedianUl > effectiveMedianDl;
  const ulDlDeltaPct = ulFasterThanDl
    ? Math.round(((effectiveMedianUl - effectiveMedianDl) / effectiveMedianDl) * 100)
    : 0;

  // ══════════════════════════════════════════════════════════
  // ── ISSUES — rich expandable list ────────────────────────
  // ══════════════════════════════════════════════════════════

  const issues: DetectedIssue[] = [];

  // DL throttling
  if (hasThrottling) {
    const ratio = evidence?.throughputPolicing?.policingRatio;
    const adjRatio = evidence?.throughputPolicing?.adjustedPolicingRatio;
    issues.push({
      id: "dl-throttle",
      severity: throttleFreq > 70 ? "critical" : "warning",
      title: "Download speed throttling detected",
      description: `Your ISP limits individual connections to ${evidence?.throughputPolicing?.singleStreamMean?.toFixed(0) || "?"} Mbps, but allows ${evidence?.throughputPolicing?.multiDownloadMean?.toFixed(0) || "?"} Mbps across multiple connections. This is a ${ratio?.toFixed(2)}x raw ratio${adjRatio != null ? ` (${adjRatio.toFixed(2)}x WAN-adjusted)` : ""}.`,
      evidence: `Observed in ${throttleFreq.toFixed(0)}% of ${ratioTests.length} paired speed tests`,
      frequency: `${throttleFreq.toFixed(0)}% of tests`,
      recommendation: "This is a deliberate ISP policy that limits individual connection speeds. Consider using a download manager that supports multiple connections, or contact your ISP to ask about their speed limiting policy.",
      link: "/throughput",
      linkLabel: "View speed analysis",
    });
  }

  // UL throttling
  if (hasUlThrottling) {
    const ulAvgRatio = ulRatioTests.length > 0
      ? ulRatioTests.reduce((s, r) => s + r, 0) / ulRatioTests.length
      : 0;
    issues.push({
      id: "ul-throttle",
      severity: ulThrottleFreq > 70 ? "critical" : "warning",
      title: "Upload speed throttling detected",
      description: `Upload speeds are being limited per-connection. Average ratio of ${ulAvgRatio.toFixed(2)}x between single and multi-stream uploads.`,
      evidence: `Observed in ${ulThrottleFreq.toFixed(0)}% of ${ulRatioTests.length} paired upload tests`,
      frequency: `${ulThrottleFreq.toFixed(0)}% of tests`,
      recommendation: "Upload throttling affects video calls, cloud backups, and file sharing. If this is impacting your work, contact your ISP about upload speed policies.",
      link: "/throughput",
      linkLabel: "View speed analysis",
    });
  }

  // Speeds below plan (DL)
  if (dlPlanPct != null && dlPlanPct < 80 && !hasThrottling) {
    const showAdjContext = hasAdjData && (adjDlMedian ?? 0) > dlMedian;
    issues.push({
      id: "below-plan",
      severity: belowMinimum && !dlSoftening.shouldSoften ? "critical" : dlSoftening.shouldSoften ? "info" : dlPlanPct < 60 ? "warning" : "info",
      title: belowMinimum && !dlSoftening.shouldSoften
        ? `Download speed critically below ${ISP_PLAN.provider} ${ISP_PLAN.tier} plan`
        : dlSoftening.shouldSoften
          ? "Household traffic reducing measured speed"
          : `Download speed below ${ISP_PLAN.provider} ${ISP_PLAN.tier} expectations`,
      description: belowMinimum && !dlSoftening.shouldSoften
        ? `Your ISP delivered a median of ${effectiveMedianDl.toFixed(0)} Mbps — below the ${ISP_PLAN.minimumDown} Mbps minimum threshold. ${ISP_PLAN.provider} publishes an average of ${ISP_PLAN.avgPeakDown} Mbps for the ${ISP_PLAN.tier} plan — you're getting ${dlPlanPct.toFixed(0)}% of that.`
        : dlSoftening.shouldSoften
          ? `${dlSoftening.backgroundNote}. Your ISP is delivering ${dlPlanPct.toFixed(0)}% of the ${ISP_PLAN.avgPeakDown} Mbps plan average.`
          : `${showAdjContext ? "Your ISP delivered" : "Your median download of"} ${effectiveMedianDl.toFixed(0)} Mbps${showAdjContext ? ` to the router (measured: ${dlMedian.toFixed(0)} Mbps)` : ""} — ${dlPlanPct.toFixed(0)}% of ${ISP_PLAN.provider}'s published ${ISP_PLAN.avgPeakDown} Mbps average for the ${ISP_PLAN.tier} plan.`,
      evidence: `Median across ${dlMultiSpeeds.length} multi-connection tests${hasAdjData ? " (adjusted for household traffic via UPnP)" : ""}`,
      recommendation: belowMinimum && !dlSoftening.shouldSoften
        ? `Under Ofcom's Broadband Speeds Code of Practice, if ${ISP_PLAN.provider} cannot resolve speeds below your minimum guaranteed level, you may be entitled to exit your contract without penalty. Contact ${ISP_PLAN.provider} with this data.`
        : dlSoftening.shouldSoften
          ? "Your ISP is delivering adequate speed. Other devices on your network are consuming bandwidth during speed tests. Consider pausing other devices for more accurate measurements."
          : `This may be due to WiFi limitations, router placement, or network congestion. Try testing on a wired connection. If the issue persists, contact ${ISP_PLAN.provider} referencing their published average of ${ISP_PLAN.avgPeakDown} Mbps.`,
      link: "/throughput",
      linkLabel: "View speed analysis",
    });
  }

  // Speeds below plan (UL)
  if (ulPlanPct != null && ulPlanPct < 50) {
    issues.push({
      id: "ul-below-plan",
      severity: ulBelowMinimum ? "critical" : "warning",
      title: `Upload speed significantly below ${ISP_PLAN.tier} plan`,
      description: `Your ${hasAdjData ? "ISP delivered a" : ""} median upload of ${adjUlMedian.toFixed(0)} Mbps — only ${ulPlanPct.toFixed(0)}% of ${ISP_PLAN.provider}'s published ${ISP_PLAN.avgPeakUp} Mbps average for the ${ISP_PLAN.tier} plan.`,
      evidence: `Median across ${ulMultiSpeeds.length} multi-connection tests`,
      recommendation: `${ISP_PLAN.provider}'s ${ISP_PLAN.tier} plan promises symmetrical speeds (${ISP_PLAN.avgPeakUp} Mbps upload). Contact ${ISP_PLAN.provider} — this level of upload underperformance is not consistent with the plan.`,
      link: "/throughput",
      linkLabel: "View speed analysis",
    });
  }

  // Congestion events
  if (hasCongestionEvents) {
    const worstEvent = congestionAnalysis.events.reduce((w, e) => e.minSpeed < w.minSpeed ? e : w, congestionAnalysis.events[0]);
    issues.push({
      id: "congestion-events",
      severity: "warning",
      title: `${congestionEventCount} ISP congestion event${congestionEventCount > 1 ? "s" : ""} confirmed`,
      description: `Periods where ISP response time spiked while download speed simultaneously dropped. Worst event: speed fell to ${worstEvent.minSpeed.toFixed(0)} Mbps, latency spiked to ${worstEvent.peakLatency.toFixed(0)} ms.${worstEvent.avgRouterLatency != null ? ` Router latency stayed flat (~${worstEvent.avgRouterLatency.toFixed(1)} ms), confirming the issue is beyond your home network.` : ""}`,
      evidence: `Detected by correlating ${congestionAnalysis.total + congestionAnalysis.events.length} measurement pairs, ${congestionAnalysis.filtered} excluded as local traffic`,
      recommendation: "ISP congestion is outside your control. Document these events and report to your ISP if they coincide with poor experience. This data can support a formal complaint.",
      link: "/congestion",
      linkLabel: "View congestion analysis",
    });
  }

  // Peak vs off-peak degradation
  if (hasPeakDegradation && peakSpeed != null) {
    issues.push({
      id: "peak-degradation",
      severity: peakBelowMinimum ? "critical" : "warning",
      title: "Significant evening slowdown",
      description: `Peak-hour speed (7-11 PM) averages ${peakSpeed.toFixed(0)} Mbps — ${peakSlowerPct!.toFixed(0)}% slower than off-peak.${peakBelowMinimum ? ` This is below ${ISP_PLAN.provider}'s ${ISP_PLAN.minimumDown} Mbps minimum guarantee.` : ""}${peakAvgRtt != null && offPeakAvgRtt != null && peakAvgRtt > offPeakAvgRtt * 1.2 ? ` Response times also increase: ${peakAvgRtt.toFixed(1)}ms vs ${offPeakAvgRtt.toFixed(1)}ms off-peak.` : ""}`,
      evidence: "Based on hourly aggregation of all latency and speed measurements",
      frequency: "Every evening",
      recommendation: "This pattern suggests your ISP's network becomes congested during peak usage hours. Consider scheduling large downloads for off-peak times.",
    });
  }

  // Packet loss
  if (lossRate > 5) {
    const avgLoss = allLoss.reduce((s: number, l: number) => s + l, 0) / allLoss.length;
    issues.push({
      id: "packet-loss",
      severity: avgLoss > 2 ? "critical" : "warning",
      title: "Elevated packet loss",
      description: `${lossRate.toFixed(1)}% of monitoring windows recorded some packet loss. Average loss when present: ${avgLoss.toFixed(2)}%.`,
      evidence: `${lossyWindows} of ${allLoss.length} measurement windows had dropped packets`,
      recommendation: "Persistent packet loss can cause buffering, call drops, and slow page loads. Check your router and cables, and report to your ISP if the issue persists.",
      link: "/latency",
      linkLabel: "View latency details",
    });
  }

  // Outages
  if (outageCount > 0) {
    const recentOutage = evidence?.outageSummary?.recent?.[0];
    issues.push({
      id: "outages",
      severity: hasSignificantOutages ? "critical" : "info",
      title: `${pluralize(outageCount, "connection drop")} detected`,
      description: `Total downtime of ${formatDurationMs(totalDowntimeMs)} across ${pluralize(outageCount, "event")}.`,
      evidence: recentOutage?.startedAt
        ? `Most recent: ${new Date(recentOutage.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : "See outage details below",
      recommendation: outageCount > 3
        ? "Frequent connection drops may indicate a line fault or modem issue. Contact your ISP to report intermittent connectivity problems."
        : "Occasional brief drops are normal. Monitor for patterns — if they increase, it may indicate a developing issue.",
      link: "/outages",
      linkLabel: "View outage log",
    });
  }

  // Latency degradation (hop trending)
  if (degradingHops.length > 0) {
    issues.push({
      id: "latency-degradation",
      severity: degradingHops.some((h) => h.delta > 5) ? "warning" : "info",
      title: "Response times are increasing",
      description: `${degradingHops.map((h) => `${HOP_LABELS[h.id] || h.id}: +${h.delta.toFixed(1)}ms`).join(", ")} over the observation period.`,
      evidence: `Comparing first and last day averages from traceroute data over ${evidence?.hopTrending?.periodDays || "?"} days`,
      recommendation: "Gradually increasing latency may indicate growing congestion on your ISP's network. Keep monitoring — if the trend continues, contact your ISP.",
    });
  }

  // IPv6 broken
  if (v6Broken) {
    issues.push({
      id: "ipv6-broken",
      severity: "warning",
      title: "IPv6 connectivity is not working",
      description: `${v6TotalSent} IPv6 pings sent, 0 received. Your connection does not appear to support IPv6.`,
      evidence: `100% packet loss across all IPv6 targets over ${pluralize(v6History.length, "test window")}`,
      recommendation: "IPv6 is becoming increasingly important. Check if your router has IPv6 enabled, or contact your ISP to confirm IPv6 availability on your plan.",
      link: "/latency",
      linkLabel: "View latency details",
    });
  }

  // Correlation / bufferbloat
  if (evidence?.correlation?.pearsonR != null && Math.abs(evidence.correlation.pearsonR) > 0.3) {
    issues.push({
      id: "bufferbloat",
      severity: Math.abs(evidence.correlation.pearsonR) > 0.5 ? "critical" : "warning",
      title: "Network congestion under load",
      description: `When downloading at full speed, your response times increase significantly. Correlation strength: ${interpretCorrelation(evidence.correlation.pearsonR)} (r = ${evidence.correlation.pearsonR.toFixed(3)}).`,
      evidence: "Based on simultaneous speed + response time measurements",
      recommendation: "Enable Smart Queue Management (SQM) on your router if available, or consider a router that actively manages network congestion to keep response times low during heavy usage.",
      link: "/congestion",
      linkLabel: "View congestion analysis",
    });
  }

  // Upload outperforms download (asymmetric throttling)
  if (ulFasterThanDl && ulDlDeltaPct >= 5) {
    issues.push({
      id: "ul-faster-than-dl",
      severity: "info",
      title: `Upload ${ulDlDeltaPct}% faster than download on symmetrical plan`,
      description: `Your median upload (${effectiveMedianUl.toFixed(0)} Mbps) consistently exceeds download (${effectiveMedianDl.toFixed(0)} Mbps) on a plan advertised as symmetrical ${ISP_PLAN.advertisedDown}/${ISP_PLAN.advertisedUp} Mbps. This suggests your ISP applies more aggressive per-connection throttling to downloads than uploads.`,
      evidence: `Upload median ${effectiveMedianUl.toFixed(0)} Mbps vs download median ${effectiveMedianDl.toFixed(0)} Mbps across ${dlMultiSpeeds.length} multi-stream tests. Upload is less affected by household traffic because home internet usage is predominantly download.`,
      recommendation: "This asymmetry strengthens the case that your ISP is deliberately throttling download connections. Upload speeds being closer to the plan's advertised speed shows the underlying connection is capable of higher throughput.",
      link: "/throughput",
      linkLabel: "View speed analysis",
    });
  }

  // Sort by severity
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ══════════════════════════════════════════════════════════
  // ── KPIs for the verdict panel ───────────────────────────
  // ══════════════════════════════════════════════════════════

  const uptimePct = periodMs > 0
    ? (((periodMs - totalDowntimeMs) / periodMs) * 100)
    : null;

  const verdictMetrics = [
    ...(effectiveMedianDl > 0 ? [{
      label: "Median DL",
      value: `${effectiveMedianDl.toFixed(0)}`,
      subValue: `/ ${ISP_PLAN.advertisedDown} Mbps`,
    }] : []),
    ...(effectiveMedianUl > 0 ? [{
      label: "Median UL",
      value: `${effectiveMedianUl.toFixed(0)}`,
      subValue: ulFasterThanDl ? `+${ulDlDeltaPct}% vs DL` : `/ ${ISP_PLAN.advertisedUp} Mbps`,
    }] : []),
    {
      label: "Congestion",
      value: String(congestionEventCount),
      subValue: congestionEventCount > 0 ? "events" : "none",
    },
    ...(uptimePct != null ? [{
      label: "Uptime",
      value: `${uptimePct.toFixed(uptimePct >= 99.9 ? 3 : 1)}%`,
      subValue: hasOutages ? `${outageCount} drops` : undefined as string | undefined,
    }] : []),
    { label: "Period", value: periodLabel },
  ];

  // ── Data confidence ────────────────────────────────────────
  const totalPings = (evidence?.collectionPeriod?.totalPingWindows || 0) * 50;
  const totalSpeedTests = evidence?.collectionPeriod?.totalThroughputTests || 0;

  const confidenceLevel = periodMs < 6 * 3600000
    ? { label: "Low", color: "text-warning border-warning/30" }
    : periodMs < 24 * 3600000
      ? { label: "Moderate", color: "text-chart-3 border-chart-3/30" }
      : periodMs < 7 * 24 * 3600000
        ? { label: "Good", color: "text-primary border-primary/30" }
        : { label: "Excellent", color: "text-verdict-healthy border-verdict-healthy/30" };

  const statusConfig = STATUS_CONFIG[verdictStatus];
  const StatusIcon = statusConfig.icon;

  // ══════════════════════════════════════════════════════════
  // ── RENDER ───────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          ISP performance assessment over {periodLabel !== "N/A" ? periodLabel : "the monitoring period"}
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      {/* UNIFIED VERDICT PANEL                                 */}
      {/* ══════════════════════════════════════════════════════ */}
      <Card className={cn("border-l-4 overflow-hidden", statusConfig.border, statusConfig.bg)}>
        <CardContent className="pt-4 pb-4">
          {/* Status + headline + KPIs */}
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10px] font-medium border", statusConfig.text, statusConfig.badgeBg, statusConfig.badgeBorder)}>
                  <StatusIcon className="h-2.5 w-2.5" />
                  {statusConfig.label}
                </span>
              </div>
              <h2 className="text-base font-semibold tracking-tight">{verdictHeadline}</h2>
            </div>

            {/* Desktop KPIs */}
            <div className="hidden sm:flex gap-5 shrink-0 border-l border-border/50 pl-5">
              {verdictMetrics.map((m) => (
                <div key={m.label} className="text-right">
                  <div className="text-[10px] text-muted-foreground">{m.label}</div>
                  <div className="text-lg font-bold font-mono tracking-tight leading-tight">{m.value}</div>
                  {m.subValue && <div className="text-[10px] text-muted-foreground font-mono">{m.subValue}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Mobile KPIs */}
          <div className="flex sm:hidden flex-wrap gap-4 mt-2 pt-2 border-t border-border/50">
            {verdictMetrics.map((m) => (
              <div key={m.label}>
                <div className="text-[10px] text-muted-foreground">{m.label}</div>
                <div className="text-base font-bold font-mono tracking-tight">{m.value}</div>
                {m.subValue && <div className="text-[10px] text-muted-foreground font-mono">{m.subValue}</div>}
              </div>
            ))}
          </div>

          {/* Issues feed */}
          {issues.length > 0 ? (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Detected Issues
                </h3>
                <div className="flex gap-1.5">
                  {issues.filter((i) => i.severity === "critical").length > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                      {issues.filter((i) => i.severity === "critical").length} critical
                    </Badge>
                  )}
                  {issues.filter((i) => i.severity === "warning").length > 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-verdict-poor border-verdict-poor/30">
                      {issues.filter((i) => i.severity === "warning").length} warning
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-0">
                {issues.map((issue, idx) => (
                  <details key={issue.id} className="group">
                    <summary className={cn(
                      "flex items-center gap-2.5 py-2 cursor-pointer select-none hover:bg-muted/30 -mx-3 px-3 rounded",
                      idx > 0 && "border-t border-border/30"
                    )}>
                      {issue.severity === "critical" ? (
                        <XCircle className="h-3.5 w-3.5 text-verdict-critical shrink-0" />
                      ) : issue.severity === "warning" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-verdict-poor shrink-0" />
                      ) : (
                        <Info className="h-3.5 w-3.5 text-info shrink-0" />
                      )}
                      <span className="text-xs font-medium flex-1 truncate">{issue.title}</span>
                      {issue.frequency && (
                        <Badge variant="outline" className="text-[9px] font-mono px-1 py-0 shrink-0">
                          {issue.frequency}
                        </Badge>
                      )}
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="pl-6 pr-3 pb-2.5 space-y-1.5">
                      <p className="text-xs text-muted-foreground leading-relaxed">{issue.description}</p>
                      <div className="text-[10px] text-muted-foreground/60 font-mono">{issue.evidence}</div>
                      <div className="flex items-start gap-1.5 pt-1">
                        <Shield className="h-3 w-3 mt-0.5 text-muted-foreground/60 shrink-0" />
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          <span className="font-medium text-foreground/70">Action:</span>{" "}
                          {issue.recommendation}
                        </p>
                      </div>
                      {issue.link && (
                        <Link href={issue.link} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                          {issue.linkLabel || "View details"} <ArrowRight className="h-2.5 w-2.5" />
                        </Link>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-verdict-healthy" />
              <p className="text-xs text-muted-foreground">
                All metrics within healthy ranges across {periodLabel} of monitoring.
              </p>
            </div>
          )}

          {/* Data confidence footer */}
          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
            <span>
              Since {periodStart ? new Date(periodStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span>{totalPings.toLocaleString()} pings</span>
            <span className="text-muted-foreground/30">·</span>
            <span>{totalSpeedTests} speed tests</span>
            <Badge variant="outline" className={cn("text-[10px] ml-auto", confidenceLevel.color)}>
              {confidenceLevel.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════ */}
      {/* DETAILED EVIDENCE SECTIONS                            */}
      {/* ══════════════════════════════════════════════════════ */}

      {/* ── 1: Speed Test Statistics ────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">SPEED</Badge>
            <CardTitle className="text-base">Speed Test Statistics</CardTitle>
          </div>
          <CardDescription>
            Statistical breakdown of all speed tests vs {ISP_PLAN.provider} {ISP_PLAN.tier} plan promises
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Download */}
            <div className="space-y-3">
              <div className="text-xs font-medium">Download</div>
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead className="h-7 px-2">Metric</TableHead>
                    <TableHead className="h-7 px-2 text-right">Multi ({dlMulti.length})</TableHead>
                    {hasAdjData && (
                      <TableHead className="h-7 px-2 text-right text-primary/70">Adjusted</TableHead>
                    )}
                    <TableHead className="h-7 px-2 text-right">Single ({dlSingle.length})</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { label: "P5 (worst)", p: 5 },
                    { label: "P25", p: 25 },
                    { label: "Median", p: 50 },
                    { label: "P75", p: 75 },
                    { label: "P95 (best)", p: 95 },
                  ].map((row) => (
                    <TableRow key={row.label} className="text-xs font-mono">
                      <TableCell className="px-2 py-1 font-sans text-muted-foreground">{row.label}</TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        {dlMultiSpeeds.length > 0 ? `${percentile(dlMultiSpeeds, row.p).toFixed(0)} Mbps` : "\u2014"}
                      </TableCell>
                      {hasAdjData && (
                        <TableCell className="px-2 py-1 text-right text-primary/70">
                          {adjDlMultiSpeeds.length > 0 ? `${percentile(adjDlMultiSpeeds, row.p).toFixed(0)} Mbps` : "\u2014"}
                        </TableCell>
                      )}
                      <TableCell className="px-2 py-1 text-right text-muted-foreground">
                        {dlSingleSpeeds.length > 0 ? `${percentile(dlSingleSpeeds, row.p).toFixed(0)} Mbps` : "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {hasThrottling && (
                <div className="text-[11px] text-verdict-poor flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" />
                  Throttle ratio: {evidence?.throughputPolicing?.policingRatio?.toFixed(2)}x raw
                  {adjPolicingRatio != null && (
                    <span className="text-muted-foreground ml-1">
                      ({adjPolicingRatio.toFixed(2)}x WAN-adjusted)
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Upload */}
            <div className="space-y-3">
              <div className="text-xs font-medium">Upload</div>
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead className="h-7 px-2">Metric</TableHead>
                    <TableHead className="h-7 px-2 text-right">Multi ({ulMulti.length})</TableHead>
                    {hasAdjData && (
                      <TableHead className="h-7 px-2 text-right text-primary/70">Adjusted</TableHead>
                    )}
                    <TableHead className="h-7 px-2 text-right">Single ({ulSingle.length})</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { label: "P5 (worst)", p: 5 },
                    { label: "P25", p: 25 },
                    { label: "Median", p: 50 },
                    { label: "P75", p: 75 },
                    { label: "P95 (best)", p: 95 },
                  ].map((row) => (
                    <TableRow key={row.label} className="text-xs font-mono">
                      <TableCell className="px-2 py-1 font-sans text-muted-foreground">{row.label}</TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        {ulMultiSpeeds.length > 0 ? `${percentile(ulMultiSpeeds, row.p).toFixed(0)} Mbps` : "\u2014"}
                      </TableCell>
                      {hasAdjData && (
                        <TableCell className="px-2 py-1 text-right text-primary/70">
                          {adjUlMultiSpeeds.length > 0 ? `${percentile(adjUlMultiSpeeds, row.p).toFixed(0)} Mbps` : "\u2014"}
                        </TableCell>
                      )}
                      <TableCell className="px-2 py-1 text-right text-muted-foreground">
                        {ulSingleSpeeds.length > 0 ? `${percentile(ulSingleSpeeds, row.p).toFixed(0)} Mbps` : "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {evidence?.uploadEvidence?.ratio > THRESHOLDS.policingRatio && (
                <div className="text-[11px] text-verdict-poor flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" />
                  UL throttle ratio: {evidence.uploadEvidence.ratio.toFixed(2)}x
                </div>
              )}
            </div>
          </div>

          {/* Asymmetry note */}
          {ulFasterThanDl && ulDlDeltaPct >= 5 && (
            <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground mt-1">
              <TrendingUp className="h-3 w-3 mt-0.5 text-chart-4 shrink-0" />
              <span>
                Upload consistently outperforms download by ~{ulDlDeltaPct}% on a symmetrical {ISP_PLAN.advertisedDown}/{ISP_PLAN.advertisedUp} Mbps plan
                {hasThrottling ? " — likely due to more aggressive per-connection download throttling" : ""}.
                Upload is less affected because household traffic is predominantly download.
              </span>
            </div>
          )}

          {/* Speed comparison bars */}
          {(dlMultiSpeeds.length > 0 || ulMultiSpeeds.length > 0) && (() => {
            const planMax = ISP_PLAN.advertisedDown;
            const allBars = [
              { label: "Advertised", value: ISP_PLAN.advertisedDown, color: "bg-white/20", plan: true },
              { label: "Avg Peak", value: ISP_PLAN.avgPeakDown, color: "bg-white/15", plan: true },
              { label: "Minimum", value: ISP_PLAN.minimumDown, color: "bg-white/10 border border-dashed border-destructive/40", plan: true },
              { label: "DL Multi", value: percentile(dlMultiSpeeds, 50), color: "bg-chart-1", plan: false },
              ...(hasAdjData ? [{ label: "DL Adjusted", value: percentile(adjDlMultiSpeeds, 50), color: "bg-chart-1 opacity-60 border border-dashed border-primary/40", plan: false }] : []),
              { label: "DL Single", value: percentile(dlSingleSpeeds, 50), color: "bg-chart-1/50", plan: false },
              { label: "UL Multi", value: percentile(ulMultiSpeeds, 50), color: "bg-chart-4", plan: false },
              ...(hasAdjData ? [{ label: "UL Adjusted", value: percentile(adjUlMultiSpeeds, 50), color: "bg-chart-4 opacity-60 border border-dashed border-chart-4/40", plan: false }] : []),
              { label: "UL Single", value: percentile(ulSingleSpeeds, 50), color: "bg-chart-4/50", plan: false },
            ].filter((b) => b.value > 0);

            return (
              <div className="mt-4 pt-4 border-t border-border/30 space-y-2">
                <div className="text-[11px] text-muted-foreground mb-2">
                  Measured Median vs {ISP_PLAN.provider} {ISP_PLAN.tier} Plan
                </div>
                {allBars.map((bar, i) => (
                  <div key={bar.label}>
                    {i > 0 && !bar.plan && allBars[i - 1].plan && (
                      <div className="border-t border-border/20 my-2" />
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] w-20 text-right shrink-0 ${bar.plan ? "text-muted-foreground/60 italic" : "text-muted-foreground"}`}>
                        {bar.label}
                      </span>
                      <div className="flex-1 h-4 bg-muted/20 rounded overflow-hidden">
                        <div
                          className={`h-full ${bar.color} rounded`}
                          style={{ width: `${Math.max((bar.value / planMax) * 100, 2)}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-mono w-16 text-right shrink-0 ${bar.plan ? "text-muted-foreground/60" : ""}`}>
                        {bar.value.toFixed(0)} Mbps
                      </span>
                    </div>
                  </div>
                ))}
                <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                  <div>Top 3 bars = {ISP_PLAN.provider} plan promises. Below = your measured medians.</div>
                  {hasAdjData && (
                    <div>&quot;Adjusted&quot; = total router throughput (UPnP), accounting for other household devices</div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Peak vs Off-Peak subsection */}
          {(evidence?.timeOfDay?.peak?.avgRtt != null || evidence?.timeOfDay?.offPeak?.avgRtt != null) && (() => {
            const PEAK_HOURS_SET = new Set([19, 20, 21, 22]);
            const OFF_PEAK_HOURS_SET = new Set([2, 3, 4, 5, 6]);
            const hourlyData: any[] = evidence.timeOfDay.hourlyLatency ?? [];
            const peakHoursWithData = hourlyData.filter((h: any) => PEAK_HOURS_SET.has(h.hour) && h.samples > 0).length;
            const offPeakHoursWithData = hourlyData.filter((h: any) => OFF_PEAK_HOURS_SET.has(h.hour) && h.samples > 0).length;

            return (
              <div className="mt-4 pt-4 border-t border-border/30 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="text-[11px] text-muted-foreground font-medium">Peak vs Off-Peak</div>
                  <Badge variant="outline" className="font-mono text-[10px]">TIME-OF-DAY</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border p-3 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-xs text-muted-foreground font-medium">Peak (19:00 - 23:00)</div>
                      {peakHoursWithData < 4 && (
                        <Badge variant="outline" className="text-[10px] text-warning border-warning/30 px-1.5 py-0">
                          {peakHoursWithData} of 4 hours
                        </Badge>
                      )}
                    </div>
                    {evidence.timeOfDay.peak?.avgSpeed != null ? (
                      <div className="text-sm font-mono">
                        Speed: <strong>{evidence.timeOfDay.peak.avgSpeed.toFixed(0)} Mbps</strong>
                        <span className="text-muted-foreground/60 ml-1 text-xs">/ {ISP_PLAN.avgPeakDown} promised</span>
                        {evidence.timeOfDay.peak.avgSpeed < ISP_PLAN.minimumDown && (
                          <Badge variant="outline" className="ml-2 text-[10px] text-destructive border-destructive/30">
                            Below {ISP_PLAN.minimumDown} Mbps minimum
                          </Badge>
                        )}
                        {evidence.timeOfDay.offPeak?.avgSpeed != null && evidence.timeOfDay.peak.avgSpeed < evidence.timeOfDay.offPeak.avgSpeed * 0.85 && (
                          <Badge variant="outline" className="ml-2 text-[10px] text-verdict-poor border-verdict-poor/30">
                            {((1 - evidence.timeOfDay.peak.avgSpeed / evidence.timeOfDay.offPeak.avgSpeed) * 100).toFixed(0)}% slower
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No peak speed data</div>
                    )}
                    {evidence.timeOfDay.peak?.avgRtt != null ? (
                      <div className="text-sm font-mono text-muted-foreground">
                        Latency: {evidence.timeOfDay.peak.avgRtt.toFixed(1)}ms
                        {evidence.timeOfDay.offPeak?.avgRtt != null && evidence.timeOfDay.peak.avgRtt > evidence.timeOfDay.offPeak.avgRtt * 1.2 && (
                          <Badge variant="outline" className="ml-2 text-[10px] text-verdict-poor border-verdict-poor/30">
                            +{((evidence.timeOfDay.peak.avgRtt / evidence.timeOfDay.offPeak.avgRtt - 1) * 100).toFixed(0)}%
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No peak data yet</div>
                    )}
                  </div>
                  <div className="rounded-lg border border-border p-3 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-xs text-muted-foreground font-medium">Off-Peak (02:00 - 06:00)</div>
                      {offPeakHoursWithData < 5 && (
                        <Badge variant="outline" className="text-[10px] text-warning border-warning/30 px-1.5 py-0">
                          {offPeakHoursWithData} of 5 hours
                        </Badge>
                      )}
                    </div>
                    {evidence.timeOfDay.offPeak?.avgSpeed != null && (
                      <div className="text-sm font-mono">
                        Speed: <strong>{evidence.timeOfDay.offPeak.avgSpeed.toFixed(0)} Mbps</strong>
                        <span className="text-muted-foreground/60 ml-1 text-xs">/ {ISP_PLAN.advertisedDown} plan</span>
                      </div>
                    )}
                    {evidence.timeOfDay.offPeak?.avgRtt != null && (
                      <div className="text-sm font-mono text-muted-foreground">Latency: {evidence.timeOfDay.offPeak.avgRtt.toFixed(1)}ms</div>
                    )}
                  </div>
                </div>

                {hourlyData.length > 0 && (
                  <HourlyPerformanceChart
                    latencyData={hourlyData}
                    throughputData={evidence.timeOfDay.hourlyThroughput}
                  />
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── 2: Response Time Statistics ────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">LATENCY</Badge>
            <CardTitle className="text-base">Response Time Statistics</CardTitle>
          </div>
          <CardDescription>
            Percentile breakdown per network step — P5 (best), P50 (typical), P95 (worst realistic)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead className="h-8 px-2">Network Step</TableHead>
                <TableHead className="h-8 px-2 text-right">P5 (Best)</TableHead>
                <TableHead className="h-8 px-2 text-right">P50 (Typical)</TableHead>
                <TableHead className="h-8 px-2 text-right">P95 (Slow)</TableHead>
                <TableHead className="h-8 px-2 text-right">Consistency</TableHead>
                <TableHead className="h-8 px-2 text-right">Avg Loss</TableHead>
                <TableHead className="h-8 px-2 text-right">Trend</TableHead>
                <TableHead className="h-8 px-2 text-right">Samples</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latencyStats.map((s) => {
                const isUnstable = s.avgStddev > THRESHOLDS.maxAcceptableStddev;
                const isLossy = s.avgLoss > THRESHOLDS.maxAcceptableLoss;
                return (
                  <TableRow key={s.targetId} className="text-xs font-mono">
                    <TableCell className="px-2 py-2 font-sans text-xs font-medium">{s.label}</TableCell>
                    <TableCell className="px-2 py-2 text-right text-verdict-healthy">{s.p5.toFixed(1)}ms</TableCell>
                    <TableCell className="px-2 py-2 text-right font-semibold">{s.p50.toFixed(1)}ms</TableCell>
                    <TableCell className="px-2 py-2 text-right text-muted-foreground">{s.p95.toFixed(1)}ms</TableCell>
                    <TableCell className={`px-2 py-2 text-right ${isUnstable ? "text-verdict-poor font-semibold" : "text-muted-foreground"}`}>
                      ±{s.avgStddev.toFixed(1)}ms
                    </TableCell>
                    <TableCell className={`px-2 py-2 text-right ${isLossy ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                      {s.avgLoss.toFixed(2)}%
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right">
                      {s.degradation != null ? (
                        <span className="inline-flex items-center gap-1">
                          {trendArrow(s.degradation)}
                          <span className={s.degradation > 2 ? "text-verdict-poor" : s.degradation < -1 ? "text-verdict-healthy" : "text-muted-foreground"}>
                            {s.degradation > 0 ? "+" : ""}{s.degradation.toFixed(1)}ms
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                     <TableCell className="px-2 py-2 text-right text-muted-foreground">{s.count}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Visual bars */}
          <div className="mt-4 pt-4 border-t border-border/30 space-y-2">
            <div className="text-[11px] text-muted-foreground mb-2">Visual — P50 Response Time</div>
            {latencyStats.filter((s) => s.p50 > 0).map((s) => {
              const maxP95 = Math.max(...latencyStats.map((x) => x.p95), 1);
              return (
                <div key={s.targetId} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-28 text-right shrink-0 truncate">{s.label}</span>
                  <div className="flex-1 h-4 bg-muted/20 rounded overflow-hidden relative">
                    <div
                      className="absolute h-full bg-muted/30 rounded"
                      style={{
                        left: `${(s.p5 / maxP95) * 100}%`,
                        width: `${Math.max(((s.p95 - s.p5) / maxP95) * 100, 1)}%`,
                      }}
                    />
                    <div
                      className={`absolute h-full w-1.5 rounded ${s.avgStddev > THRESHOLDS.maxAcceptableStddev ? "bg-verdict-poor" : "bg-primary"}`}
                      style={{ left: `${(s.p50 / maxP95) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono w-14 text-right shrink-0">{s.p50.toFixed(1)}ms</span>
                </div>
              );
            })}
            <div className="text-[10px] text-muted-foreground mt-1">
              Shaded area = P5-P95 range, marker = P50 median
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 3: Packet Loss Analysis ──────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">LOSS</Badge>
            <CardTitle className="text-base">Packet Loss Analysis</CardTitle>
          </div>
          <CardDescription>Data delivery reliability per network step</CardDescription>
        </CardHeader>
        <CardContent>
          {evidence?.packetLoss?.perTarget ? (() => {
            const entries = Object.entries(evidence.packetLoss.perTarget);
            const allZero = entries.every(([, d]: [string, any]) => d.avgLoss === 0);
            if (allZero) {
              return (
                <div className="flex items-center gap-2 py-2">
                  <Badge variant="secondary" className="text-[10px]">0% LOSS</Badge>
                  <span className="text-sm text-muted-foreground">
                    No dropped packets detected on any network step. Excellent reliability.
                  </span>
                </div>
              );
            }
            return (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead className="h-8 px-2">Network Step</TableHead>
                      <TableHead className="h-8 px-2 text-right">Avg Loss</TableHead>
                      <TableHead className="h-8 px-2 text-right">Max Loss</TableHead>
                      <TableHead className="h-8 px-2 text-right">Lossy Windows</TableHead>
                      <TableHead className="h-8 px-2 text-right">Total Windows</TableHead>
                      <TableHead className="h-8 px-2 text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map(([target, data]: [string, any]) => {
                      const isHigh = data.avgLoss > THRESHOLDS.maxAcceptableLoss;
                      const lossyCount = evidence.packetLoss.lossyWindowsPerTarget?.[target] || 0;
                      return (
                        <TableRow key={target} className="text-xs font-mono">
                          <TableCell className="px-2 py-1.5 font-sans">
                            {TARGET_LABELS[target] || HOP_LABELS[target] || target}
                          </TableCell>
                          <TableCell className={`px-2 py-1.5 text-right ${isHigh ? "text-destructive font-semibold" : ""}`}>
                            {data.avgLoss.toFixed(2)}%
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right text-muted-foreground">
                            {data.maxLoss.toFixed(1)}%
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right text-muted-foreground">{lossyCount}</TableCell>
                          <TableCell className="px-2 py-1.5 text-right text-muted-foreground">{data.windows}</TableCell>
                          <TableCell className="px-2 py-1.5 text-right">
                            {isHigh ? (
                              <Badge variant="destructive" className="text-[10px]">HIGH</Badge>
                            ) : lossyCount > 0 ? (
                              <Badge variant="outline" className="text-[10px]">MINOR</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">OK</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Each window = 50 pings over 1 minute. A &quot;lossy window&quot; had at least 1 dropped ping.
                </p>
              </>
            );
          })() : (
            <p className="text-sm text-muted-foreground">Insufficient data.</p>
          )}
        </CardContent>
      </Card>

      {/* ── 4: Congestion Events ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">EVENTS</Badge>
            <CardTitle className="text-base">Congestion Events</CardTitle>
          </div>
          <CardDescription>
            Periods where ISP latency spiked and speed simultaneously dropped, excluding local network saturation
          </CardDescription>
        </CardHeader>
        <CardContent>
          {congestionAnalysis.events.length > 0 || congestionAnalysis.filtered > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">ISP-Caused Events</div>
                  <div className={`text-lg font-bold font-mono ${congestionAnalysis.events.length > 0 ? "text-destructive" : "text-verdict-healthy"}`}>
                    {congestionAnalysis.events.length}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Filtered (Local Traffic)</div>
                  <div className="text-lg font-bold font-mono text-muted-foreground">{congestionAnalysis.filtered}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Baseline Speed</div>
                  <div className="text-lg font-bold font-mono">
                    {congestionAnalysis.medianSpeed.toFixed(0)} <span className="text-xs font-normal text-muted-foreground">Mbps</span>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Baseline Latency</div>
                  <div className="text-lg font-bold font-mono">
                    {congestionAnalysis.medianLatency.toFixed(1)} <span className="text-xs font-normal text-muted-foreground">ms</span>
                  </div>
                </div>
              </div>

              {congestionAnalysis.events.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead className="h-8 px-2">Time</TableHead>
                      <TableHead className="h-8 px-2 text-right">Peak Latency</TableHead>
                      <TableHead className="h-8 px-2 text-right">Min Speed</TableHead>
                      <TableHead className="h-8 px-2 text-right">Router Latency</TableHead>
                      <TableHead className="h-8 px-2 text-right">Points</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {congestionAnalysis.events.map((ev, i) => {
                      const startFmt = new Date(ev.startTime).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
                      const endFmt = new Date(ev.endTime).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" });
                      const latencyMultiple = (ev.peakLatency / congestionAnalysis.medianLatency).toFixed(1);
                      const speedPct = ((ev.minSpeed / congestionAnalysis.medianSpeed) * 100).toFixed(0);
                      return (
                        <TableRow key={i} className="text-xs font-mono">
                          <TableCell className="px-2 py-1.5">{startFmt}-{endFmt}</TableCell>
                          <TableCell className="px-2 py-1.5 text-right text-destructive">
                            {ev.peakLatency.toFixed(1)} ms
                            <span className="text-[10px] text-muted-foreground ml-1">({latencyMultiple}x)</span>
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right text-warning">
                            {ev.minSpeed.toFixed(0)} Mbps
                            <span className="text-[10px] text-muted-foreground ml-1">({speedPct}%)</span>
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right">
                            {ev.avgRouterLatency != null ? (
                              <span className="text-verdict-healthy">{ev.avgRouterLatency.toFixed(2)} ms</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right text-muted-foreground">{ev.pointCount}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              <p className="text-sm text-muted-foreground">
                {congestionAnalysis.events.length > 0
                  ? `${congestionAnalysis.events.length} confirmed ISP congestion event${congestionAnalysis.events.length > 1 ? "s" : ""} — latency spiked while download speed dropped, and router latency remained flat${congestionAnalysis.events[0].avgRouterLatency != null ? ` (~${congestionAnalysis.events[0].avgRouterLatency.toFixed(1)} ms)` : ""}. This rules out local network issues as the cause.`
                  : ""}
                {congestionAnalysis.filtered > 0
                  ? ` ${congestionAnalysis.filtered} additional period${congestionAnalysis.filtered > 1 ? "s" : ""} of degraded performance ${congestionAnalysis.filtered > 1 ? "were" : "was"} excluded because other devices on the network were using significant bandwidth at the time.`
                  : ""}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2">
              <Badge variant="secondary" className="text-[10px]">NONE</Badge>
              <span className="text-sm text-muted-foreground">No congestion events detected in the measurement period.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 5: Hop Trending ──────────────────────────────────── */}
      {evidence?.hopTrending?.perTarget && Object.keys(evidence.hopTrending.perTarget).length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px]">TREND</Badge>
              <CardTitle className="text-base">Daily Response Time Trends</CardTitle>
            </div>
            <CardDescription>
              Daily average response time from traceroute data — {pluralize(evidence.hopTrending.periodDays || 0, "day")} of data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(evidence.hopTrending.perTarget).map(([targetId, days]: [string, any]) => {
              const change = evidence.hopTrending.degradationMs?.[targetId];
              const maxRtt = Math.max(...days.map((d: any) => d.maxRtt || d.avgRtt || 0), 1);
              return (
                <div key={targetId}>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-medium">{HOP_LABELS[targetId] || TARGET_LABELS[targetId] || targetId}</span>
                    {change != null && (
                      <span className={`font-mono flex items-center gap-1 ${change > 2 ? "text-verdict-poor" : change < -1 ? "text-verdict-healthy" : "text-muted-foreground"}`}>
                        {trendArrow(change)}
                        {change > 0 ? "+" : ""}{change.toFixed(1)}ms
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 items-end h-14">
                    {days.map((d: any, i: number) => {
                      const height = Math.max((d.avgRtt / maxRtt) * 100, 4);
                      return (
                        <div
                          key={i}
                          className="flex-1 group"
                          title={`${d.day}: avg ${d.avgRtt.toFixed(1)}ms (min ${d.minRtt.toFixed(1)}, max ${d.maxRtt.toFixed(1)}, ${d.samples} samples)`}
                        >
                          <div className="w-full rounded-t bg-primary/40 group-hover:bg-primary/60 transition-colors" style={{ height: `${height}%` }} />
                        </div>
                      );
                    })}
                  </div>
                  {days.length > 1 && (
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>{days[0]?.day}</span>
                      <span>{days[days.length - 1]?.day}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── 6: Connectivity Drops ────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">OUTAGES</Badge>
            <CardTitle className="text-base">Connectivity Drops</CardTitle>
          </div>
          <CardDescription>Connection stability monitored every 5 seconds</CardDescription>
        </CardHeader>
        <CardContent>
          {evidence?.outageSummary ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Total Drops</div>
                  <div className={`text-lg font-bold font-mono ${outageCount > 0 ? "text-destructive" : ""}`}>
                    {outageCount}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Total Downtime</div>
                  <div className="text-lg font-bold font-mono">{formatDurationMs(totalDowntimeMs)}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Longest</div>
                  <div className="text-lg font-bold font-mono">{formatDurationMs(evidence.outageSummary.longestMs || 0)}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Uptime</div>
                  <div className="text-lg font-bold font-mono">
                    {periodMs > 0
                      ? `${(((periodMs - totalDowntimeMs) / periodMs) * 100).toFixed(3)}%`
                      : "\u2014"}
                  </div>
                </div>
              </div>

              {evidence.outageSummary.recent?.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead className="h-8 px-2">Started</TableHead>
                      <TableHead className="h-8 px-2">Ended</TableHead>
                      <TableHead className="h-8 px-2 text-right">Duration</TableHead>
                      <TableHead className="h-8 px-2 text-right">Missed Pings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evidence.outageSummary.recent.map((o: any, i: number) => (
                      <TableRow key={i} className="text-xs font-mono">
                        <TableCell className="px-2 py-1.5">
                          {o.startedAt ? new Date(o.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "?"}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-muted-foreground">
                          {o.endedAt ? new Date(o.endedAt).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "ongoing"}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right">{formatDurationMs(o.durationMs || 0)}</TableCell>
                        <TableCell className="px-2 py-1.5 text-right text-muted-foreground">{o.missedPings}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2">
              <Badge variant="secondary" className="text-[10px]">NONE</Badge>
              <span className="text-sm text-muted-foreground">No connectivity drops detected.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Data Collection Footer ───────────────────────────── */}
      <Card className="border-muted/50 bg-muted/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            <span>
              Data collected from{" "}
              {periodStart ? new Date(periodStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014"}{" "}
              to{" "}
              {periodEnd ? new Date(periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014"}{" "}
              ({periodLabel}).
              Includes {totalPings.toLocaleString()} individual ping measurements and {totalSpeedTests} speed tests.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
