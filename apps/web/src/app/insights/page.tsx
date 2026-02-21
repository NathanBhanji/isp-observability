import { Metadata } from "next";
import {
  fetchEvidenceSummary,
  fetchThroughputHistory,
  fetchLatencyHistory,
  fetchOutages,
  fetchCollectorStatus,
  timeframeToSince,
} from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { THRESHOLDS, TARGET_LABELS, ISP_PLAN } from "@isp/shared";
import {
  adjustedSpeed,
  adjustedMedian,
  verdictSoftening,
  type ThroughputTest,
} from "@/lib/throughput-utils";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { AlertBanner } from "@/components/dashboard/alert-banner";
import { interpretCorrelation, formatDurationMs, HOP_LABELS } from "@/lib/labels";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Shield,
  Clock,
  Activity,
  Wifi,
  WifiOff,
  ArrowRight,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = { title: "Insights — ISP Observatory" };

// ── Types for detected issues ────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural || singular + "s"}`;
}

function pctChange(before: number, after: number): number {
  if (before === 0) return 0;
  return ((after - before) / before) * 100;
}

function trendIcon(delta: number, inverted = false) {
  // For latency: positive delta = bad (higher latency), inverted = false
  // For speed: positive delta = good (faster), inverted = true
  const isGood = inverted ? delta > 0 : delta < 0;
  const isBad = inverted ? delta < 0 : delta > 0;

  if (Math.abs(delta) < 0.5) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  if (isGood) return <TrendingDown className="h-3.5 w-3.5 text-verdict-healthy" />;
  if (isBad) return <TrendingUp className="h-3.5 w-3.5 text-verdict-poor" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Page Component ───────────────────────────────────────────

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  // Fetch all data in parallel
  const [evidence, throughputHistory, latencyHistory, outages, collectorStatus] =
    await Promise.all([
      fetchEvidenceSummary(since),
      fetchThroughputHistory(since),
      fetchLatencyHistory(since),
      fetchOutages(since),
      fetchCollectorStatus(),
    ]);

  // ── Compute observation period ─────────────────────────────
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

  // ── Compute historical statistics ──────────────────────────

  // Throughput stats
  const dlTests = (throughputHistory || []).filter(
    (t: any) => t.direction === "download" && t.stream_count === 4
  );
  const ulTests = (throughputHistory || []).filter(
    (t: any) => t.direction === "upload" && t.stream_count === 4
  );
  const singleDlTests = (throughputHistory || []).filter(
    (t: any) => t.direction === "download" && t.stream_count === 1
  );

  const dlSpeeds = dlTests.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);
  const ulSpeeds = ulTests.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);
  const singleDlSpeeds = singleDlTests.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);

  const dlMedian = percentile(dlSpeeds, 50);
  const dlP5 = percentile(dlSpeeds, 5);
  const dlP95 = percentile(dlSpeeds, 95);
  const ulMedian = percentile(ulSpeeds, 50);

  // WAN-adjusted medians (what ISP actually delivered)
  const adjDlMedian = adjustedMedian(dlTests as ThroughputTest[]) ?? dlMedian;
  const adjUlMedian = adjustedMedian(ulTests as ThroughputTest[]) ?? ulMedian;
  const adjDlSpeeds = (dlTests as ThroughputTest[]).map(adjustedSpeed).sort((a, b) => a - b);
  const adjDlP5 = adjDlSpeeds.length > 0 ? percentile(adjDlSpeeds, 5) : dlP5;
  const adjDlP95 = adjDlSpeeds.length > 0 ? percentile(adjDlSpeeds, 95) : dlP95;
  const hasAdjData = adjDlMedian !== dlMedian;

  // Throttle frequency: how often is ratio > threshold? (raw — for policing evidence)
  const ratioTests: number[] = [];
  for (let i = 0; i < Math.min(singleDlTests.length, dlTests.length); i++) {
    if (singleDlTests[i]?.speed_mbps > 0 && dlTests[i]?.speed_mbps > 0) {
      ratioTests.push(dlTests[i].speed_mbps / singleDlTests[i].speed_mbps);
    }
  }
  const throttledCount = ratioTests.filter((r) => r > THRESHOLDS.policingRatio).length;
  const throttleFreq = ratioTests.length > 0 ? (throttledCount / ratioTests.length) * 100 : 0;

  // WAN-adjusted throttle ratios (full context)
  const adjRatioTests: number[] = [];
  for (let i = 0; i < Math.min(singleDlTests.length, dlTests.length); i++) {
    const adjSingle = adjustedSpeed(singleDlTests[i] as ThroughputTest);
    if (adjSingle > 0) {
      adjRatioTests.push(adjustedSpeed(dlTests[i] as ThroughputTest) / adjSingle);
    }
  }
  const adjMedianRatio = adjRatioTests.length > 0
    ? adjRatioTests.sort((a, b) => a - b)[Math.floor(adjRatioTests.length / 2)]
    : null;

  // Upload throttle frequency
  const singleUlTests = (throughputHistory || []).filter(
    (t: any) => t.direction === "upload" && t.stream_count === 1
  );
  const ulRatioTests: number[] = [];
  for (let i = 0; i < Math.min(singleUlTests.length, ulTests.length); i++) {
    if (singleUlTests[i]?.speed_mbps > 0 && ulTests[i]?.speed_mbps > 0) {
      ulRatioTests.push(ulTests[i].speed_mbps / singleUlTests[i].speed_mbps);
    }
  }
  const ulThrottledCount = ulRatioTests.filter((r) => r > THRESHOLDS.policingRatio).length;
  const ulThrottleFreq = ulRatioTests.length > 0 ? (ulThrottledCount / ulRatioTests.length) * 100 : 0;

  // Latency stats (ISP Backbone = bcube as primary)
  const bcubeHistory = (latencyHistory || []).filter((l: any) => l.target_id === "bcube");
  const bcubeRtts = bcubeHistory.map((l: any) => l.rtt_p50).filter((v: any) => v != null).sort((a: number, b: number) => a - b);
  const latencyMedian = percentile(bcubeRtts, 50);
  const latencyP95 = percentile(bcubeRtts, 95);
  const latencyP5 = percentile(bcubeRtts, 5);

  // Packet loss stats
  const allLoss = (latencyHistory || [])
    .filter((l: any) => l.target_id !== "google_v6" && l.target_id !== "cloudflare_v6")
    .map((l: any) => l.loss_pct)
    .filter((v: any) => v != null);
  const lossyWindows = allLoss.filter((l: number) => l > 0).length;
  const lossRate = allLoss.length > 0 ? (lossyWindows / allLoss.length) * 100 : 0;

  // IPv6 check
  const v6History = (latencyHistory || []).filter(
    (l: any) => l.target_id === "google_v6" || l.target_id === "cloudflare_v6"
  );
  const v6TotalSent = v6History.reduce((s: number, l: any) => s + (l.samples_sent || 0), 0);
  const v6TotalReceived = v6History.reduce((s: number, l: any) => s + (l.samples_received || 0), 0);
  const v6Broken = v6TotalSent > 10 && v6TotalReceived === 0;

  // Outage stats
  const outageCount = outages?.length || 0;
  const totalDowntimeMs = (outages || []).reduce((s: number, o: any) => s + (o.duration_ms || 0), 0);

  // Hop trending (from evidence)
  const hopDegradation = evidence?.hopTrending?.degradationMs || {};

  // Time-of-day analysis
  const peakAvgRtt = evidence?.timeOfDay?.peak?.avgRtt;
  const offPeakAvgRtt = evidence?.timeOfDay?.offPeak?.avgRtt;
  const peakAvgSpeed = evidence?.timeOfDay?.peak?.avgSpeed;
  const offPeakAvgSpeed = evidence?.timeOfDay?.offPeak?.avgSpeed;

  // Speed trend: first half of tests vs second half
  let dlTrendPct = 0;
  if (dlSpeeds.length >= 4) {
    const half = Math.floor(dlTests.length / 2);
    const firstHalf = dlTests.slice(0, half);
    const secondHalf = dlTests.slice(half);
    const firstAvg = firstHalf.reduce((s: number, t: any) => s + t.speed_mbps, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s: number, t: any) => s + t.speed_mbps, 0) / secondHalf.length;
    dlTrendPct = pctChange(firstAvg, secondAvg);
  }

  // Latency trend: first half vs second half
  let latencyTrendMs = 0;
  if (bcubeHistory.length >= 4) {
    const half = Math.floor(bcubeHistory.length / 2);
    const firstHalf = bcubeHistory.slice(0, half);
    const secondHalf = bcubeHistory.slice(half);
    const firstAvg = firstHalf.reduce((s: number, l: any) => s + (l.rtt_p50 || 0), 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s: number, l: any) => s + (l.rtt_p50 || 0), 0) / secondHalf.length;
    latencyTrendMs = secondAvg - firstAvg;
  }

  // ── Plan comparison (use WAN-adjusted medians) ──────────────
  const dlPlanPct = adjDlMedian > 0 ? (adjDlMedian / ISP_PLAN.avgPeakDown) * 100 : null;
  const dlPlanPctRaw = dlMedian > 0 ? (dlMedian / ISP_PLAN.avgPeakDown) * 100 : null;
  const ulPlanPct = adjUlMedian > 0 ? (adjUlMedian / ISP_PLAN.avgPeakUp) * 100 : null;
  const dlBelowMinimum = adjDlMedian > 0 && adjDlMedian < ISP_PLAN.minimumDown;
  const dlBelowMinimumRaw = dlMedian > 0 && dlMedian < ISP_PLAN.minimumDown;
  const ulBelowMinimum = adjUlMedian > 0 && adjUlMedian < ISP_PLAN.minimumUp;

  // Verdict softening
  const dlSoftening = verdictSoftening(
    dlMedian > 0 ? dlMedian : null,
    adjDlMedian > 0 ? adjDlMedian : null,
    ISP_PLAN.minimumDown,
    "the speed test"
  );

  // ── Build historical verdict ───────────────────────────────

  const hasThrottling = evidence?.throughputPolicing?.policingRatio > THRESHOLDS.policingRatio;
  const hasUlThrottling = ulThrottleFreq > 50;
  const hasHighLoss = lossRate > 10; // >10% of windows had some loss
  const hasSignificantOutages = outageCount > 3 || totalDowntimeMs > 60000;
  const hasDegradation = Object.values(hopDegradation).some((d: any) => d > 3); // >3ms degradation

  let verdictStatus: VerdictStatus = "healthy";
  if ((hasThrottling && throttleFreq > 50) || hasSignificantOutages || dlBelowMinimum) verdictStatus = "critical";
  else if (dlBelowMinimumRaw && dlSoftening.shouldSoften) verdictStatus = "degraded"; // softened from critical
  else if (hasThrottling || hasUlThrottling || hasHighLoss) verdictStatus = "poor";
  else if (dlPlanPct != null && dlPlanPct < 60) verdictStatus = "poor";
  else if (outageCount > 0 || hasDegradation) verdictStatus = "degraded";
  else if (dlPlanPct != null && dlPlanPct < 80) verdictStatus = "degraded";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "Your internet has been performing well",
    degraded: "Minor issues detected over this period",
    poor: "Consistent performance problems found",
    critical: "Significant ISP problems detected",
  };

  const verdictDescSuffix = periodLabel !== "N/A"
    ? ` Based on ${periodLabel} of continuous monitoring.`
    : "";

  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: `All metrics are within healthy ranges across ${evidence?.collectionPeriod?.totalPingWindows || 0} latency tests and ${evidence?.collectionPeriod?.totalThroughputTests || 0} speed tests.${verdictDescSuffix}`,
    degraded: `Some minor issues found that may occasionally affect your experience.${verdictDescSuffix}`,
    poor: hasThrottling
      ? `Your ISP is consistently throttling connection speeds. Detected in ${throttleFreq.toFixed(0)}% of tests over this period.${verdictDescSuffix}`
      : `Elevated packet loss or performance degradation detected across your monitoring period.${verdictDescSuffix}`,
    critical: `Multiple serious issues found that are likely impacting your daily internet usage.${verdictDescSuffix}`,
  };

  // ── Build issues list ──────────────────────────────────────

  const issues: DetectedIssue[] = [];

  // Download throttling
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

  // Upload throttling
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

  // Speeds below plan
  if (dlPlanPct != null && dlPlanPct < 80 && !hasThrottling) {
    const effectiveMedian = adjDlMedian > 0 ? adjDlMedian : dlMedian;
    const showAdjContext = hasAdjData && adjDlMedian > dlMedian;
    issues.push({
      id: "below-plan",
      severity: dlBelowMinimum ? "critical" : dlSoftening.shouldSoften ? "info" : dlPlanPct < 60 ? "warning" : "info",
      title: dlBelowMinimum
        ? `Download speed critically below ${ISP_PLAN.provider} ${ISP_PLAN.tier} plan`
        : dlSoftening.shouldSoften
          ? `Household traffic reducing measured speed`
          : `Download speed below ${ISP_PLAN.provider} ${ISP_PLAN.tier} expectations`,
      description: dlBelowMinimum
        ? `Your ISP delivered a median of ${effectiveMedian.toFixed(0)} Mbps — below the ${ISP_PLAN.minimumDown} Mbps minimum threshold. ${ISP_PLAN.provider} publishes an average of ${ISP_PLAN.avgPeakDown} Mbps for the ${ISP_PLAN.tier} plan — you're getting ${dlPlanPct.toFixed(0)}% of that.`
        : dlSoftening.shouldSoften
          ? `${dlSoftening.backgroundNote}. Your ISP is delivering ${dlPlanPct.toFixed(0)}% of the ${ISP_PLAN.avgPeakDown} Mbps plan average.`
          : `${showAdjContext ? `Your ISP delivered` : `Your median download of`} ${effectiveMedian.toFixed(0)} Mbps${showAdjContext ? ` to the router (measured: ${dlMedian.toFixed(0)} Mbps)` : ""} — ${dlPlanPct.toFixed(0)}% of ${ISP_PLAN.provider}'s published ${ISP_PLAN.avgPeakDown} Mbps average for the ${ISP_PLAN.tier} plan.`,
      evidence: `Median across ${dlSpeeds.length} multi-connection tests${hasAdjData ? ` (adjusted for household traffic via UPnP)` : ""}`,
      recommendation: dlBelowMinimum
        ? `Under Ofcom's Broadband Speeds Code of Practice, if ${ISP_PLAN.provider} cannot resolve speeds below your minimum guaranteed level, you may be entitled to exit your contract without penalty. Contact ${ISP_PLAN.provider} with this data.`
        : dlSoftening.shouldSoften
          ? `Your ISP is delivering adequate speed. Other devices on your network are consuming bandwidth during speed tests. Consider pausing other devices for more accurate measurements.`
          : `This may be due to WiFi limitations, router placement, or network congestion. Try testing on a wired connection. If the issue persists, contact ${ISP_PLAN.provider} referencing their published average of ${ISP_PLAN.avgPeakDown} Mbps.`,
      link: "/throughput",
      linkLabel: "View speed analysis",
    });
  }

  if (ulPlanPct != null && ulPlanPct < 50) {
    issues.push({
      id: "ul-below-plan",
      severity: ulBelowMinimum ? "critical" : "warning",
      title: `Upload speed significantly below ${ISP_PLAN.tier} plan`,
      description: `Your ${hasAdjData ? "ISP delivered a" : ""} median upload of ${adjUlMedian.toFixed(0)} Mbps — only ${ulPlanPct.toFixed(0)}% of ${ISP_PLAN.provider}'s published ${ISP_PLAN.avgPeakUp} Mbps average for the ${ISP_PLAN.tier} plan.`,
      evidence: `Median across ${ulSpeeds.length} multi-connection tests`,
      recommendation: `${ISP_PLAN.provider}'s ${ISP_PLAN.tier} plan promises symmetrical speeds (${ISP_PLAN.avgPeakUp} Mbps upload). Contact ${ISP_PLAN.provider} — this level of upload underperformance is not consistent with the plan.`,
      link: "/throughput",
      linkLabel: "View speed analysis",
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

  // Outages
  if (outageCount > 0) {
    issues.push({
      id: "outages",
      severity: hasSignificantOutages ? "critical" : "info",
      title: `${pluralize(outageCount, "connection drop")} detected`,
      description: `Total downtime of ${formatDurationMs(totalDowntimeMs)} across ${pluralize(outageCount, "event")}.`,
      evidence: outages && outages.length > 0
        ? `Most recent: ${new Date(outages[0].started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : "See outages page for details",
      recommendation: outageCount > 3
        ? "Frequent connection drops may indicate a line fault or modem issue. Contact your ISP to report intermittent connectivity problems."
        : "Occasional brief drops are normal. Monitor for patterns — if they increase, it may indicate a developing issue.",
      link: "/outages",
      linkLabel: "View outage history",
    });
  }

  // Latency degradation
  const degradingHops = Object.entries(hopDegradation)
    .filter(([, d]) => (d as number) > 2)
    .map(([id, d]) => ({ id, delta: d as number }));
  if (degradingHops.length > 0) {
    issues.push({
      id: "latency-degradation",
      severity: degradingHops.some((h) => h.delta > 5) ? "warning" : "info",
      title: "Response times are increasing",
      description: `${degradingHops.map((h) => `${HOP_LABELS[h.id] || h.id}: +${h.delta.toFixed(1)}ms`).join(", ")} over the observation period.`,
      evidence: `Comparing first and last day averages from traceroute data over ${evidence?.hopTrending?.periodDays || "?"} days`,
      recommendation: "Gradually increasing latency may indicate growing congestion on your ISP's network. Keep monitoring — if the trend continues, contact your ISP.",
      link: "/evidence",
      linkLabel: "View historical evidence",
    });
  }

  // Peak vs off-peak degradation
  if (peakAvgRtt != null && offPeakAvgRtt != null && peakAvgRtt > offPeakAvgRtt * 1.5) {
    issues.push({
      id: "peak-degradation",
      severity: "warning",
      title: "Significant evening slowdown",
      description: `Response times during peak hours (7-11 PM) average ${peakAvgRtt.toFixed(1)}ms compared to ${offPeakAvgRtt.toFixed(1)}ms off-peak — a ${((peakAvgRtt / offPeakAvgRtt - 1) * 100).toFixed(0)}% increase.`,
      evidence: "Based on hourly aggregation of all latency measurements",
      frequency: "Every evening",
      recommendation: "This pattern suggests your ISP's network becomes congested during peak usage hours. Consider scheduling large downloads for off-peak times.",
      link: "/evidence",
      linkLabel: "View time-of-day analysis",
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

  // Correlation / bufferbloat
  if (evidence?.correlation?.pearsonR != null && Math.abs(evidence.correlation.pearsonR) > 0.3) {
    issues.push({
      id: "bufferbloat",
      severity: Math.abs(evidence.correlation.pearsonR) > 0.5 ? "critical" : "warning",
      title: "Network congestion under load",
      description: `When downloading at full speed, your response times increase significantly. Correlation strength: ${interpretCorrelation(evidence.correlation.pearsonR)} (r = ${evidence.correlation.pearsonR.toFixed(3)}).`,
      evidence: "Based on simultaneous speed + response time measurements",
      recommendation: "Enable Smart Queue Management (SQM) on your router if available, or consider a router that actively manages network congestion to keep response times low during heavy usage.",
      link: "/correlation",
      linkLabel: "View correlation analysis",
    });
  }

  // Sort issues by severity
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          What your monitoring data reveals about your internet connection
        </p>
      </div>

      {/* Historical verdict */}
      <VerdictCard
        status={verdictStatus}
        headline={verdictHeadlines[verdictStatus]}
        description={verdictDescriptions[verdictStatus]}
        metrics={[
          { label: "Monitoring Period", value: periodLabel },
          {
            label: "Latency Tests",
            value: String(evidence?.collectionPeriod?.totalPingWindows || 0),
          },
          {
            label: "Speed Tests",
            value: String(evidence?.collectionPeriod?.totalThroughputTests || 0),
          },
          {
            label: "Issues Found",
            value: String(issues.length),
            subValue: issues.filter((i) => i.severity === "critical").length > 0
              ? `${issues.filter((i) => i.severity === "critical").length} critical`
              : undefined,
          },
        ]}
      />

      {/* ── Issues Feed ─────────────────────────────────────── */}
      {issues.length > 0 && (
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Detected Issues
              </h2>
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
                  <summary className={`flex items-center gap-2.5 py-2 cursor-pointer select-none hover:bg-muted/30 -mx-3 px-3 rounded ${idx > 0 ? "border-t border-border/30" : ""}`}>
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
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {issue.description}
                    </p>
                    <div className="text-[10px] text-muted-foreground/60 font-mono">
                      {issue.evidence}
                    </div>
                    <div className="flex items-start gap-1.5 pt-1">
                      <Shield className="h-3 w-3 mt-0.5 text-muted-foreground/60 shrink-0" />
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        <span className="font-medium text-foreground/70">Action:</span>{" "}
                        {issue.recommendation}
                      </p>
                    </div>
                    {issue.link && (
                      <Link
                        href={issue.link}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        {issue.linkLabel || "View details"} <ArrowRight className="h-2.5 w-2.5" />
                      </Link>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No issues */}
      {issues.length === 0 && (
        <Card className="border-verdict-healthy/20 bg-verdict-healthy/5">
          <CardContent className="pt-4 pb-4 text-center">
            <CheckCircle2 className="h-6 w-6 text-verdict-healthy mx-auto mb-1" />
            <p className="text-sm font-medium">No issues detected</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              All metrics healthy across {periodLabel} of monitoring.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Historical KPIs ─────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Performance Summary
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Download Speed */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Download Speed</span>
                </div>
                {dlSpeeds.length >= 4 && (
                  <div className="flex items-center gap-1" title={`Trend: ${dlTrendPct > 0 ? "+" : ""}${dlTrendPct.toFixed(1)}%`}>
                    {trendIcon(dlTrendPct, true)}
                  </div>
                )}
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight">
                {dlMedian > 0 ? `${dlMedian.toFixed(0)}` : "—"}
                <span className="text-sm font-normal text-muted-foreground ml-1">Mbps</span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono mt-1 space-y-0.5">
                <div>Median across {dlSpeeds.length} tests</div>
                {hasAdjData && (
                  <div className="text-primary/80">ISP delivered: {adjDlMedian.toFixed(0)} Mbps</div>
                )}
                {dlSpeeds.length > 2 && (
                  <div>Range: {dlP5.toFixed(0)} – {dlP95.toFixed(0)} Mbps (P5–P95)</div>
                )}
                {dlPlanPct != null && (
                  <div className={dlBelowMinimum ? "text-verdict-critical" : dlPlanPct < 80 ? "text-verdict-poor" : "text-verdict-healthy"}>
                    {dlPlanPct.toFixed(0)}% of {ISP_PLAN.avgPeakDown} Mbps plan
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Upload Speed */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Upload Speed</span>
                </div>
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight">
                {ulMedian > 0 ? `${ulMedian.toFixed(0)}` : "—"}
                <span className="text-sm font-normal text-muted-foreground ml-1">Mbps</span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono mt-1 space-y-0.5">
                <div>Median across {ulSpeeds.length} tests</div>
                {hasAdjData && adjUlMedian !== ulMedian && (
                  <div className="text-primary/80">ISP delivered: {adjUlMedian.toFixed(0)} Mbps</div>
                )}
                {ulPlanPct != null && (
                  <div className={ulBelowMinimum ? "text-verdict-critical" : ulPlanPct < 80 ? "text-verdict-poor" : "text-verdict-healthy"}>
                    {ulPlanPct.toFixed(0)}% of {ISP_PLAN.avgPeakUp} Mbps plan
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Latency */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Response Time</span>
                </div>
                {bcubeHistory.length >= 4 && (
                  <div className="flex items-center gap-1" title={`Trend: ${latencyTrendMs > 0 ? "+" : ""}${latencyTrendMs.toFixed(1)}ms`}>
                    {trendIcon(latencyTrendMs)}
                  </div>
                )}
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight">
                {latencyMedian > 0 ? `${latencyMedian.toFixed(1)}` : "—"}
                <span className="text-sm font-normal text-muted-foreground ml-1">ms</span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono mt-1 space-y-0.5">
                <div>Median to ISP Backbone</div>
                {bcubeRtts.length > 2 && (
                  <div>Range: {latencyP5.toFixed(1)} – {latencyP95.toFixed(1)} ms (P5–P95)</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Reliability */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  {outageCount > 0 ? (
                    <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="text-xs text-muted-foreground">Reliability</span>
                </div>
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight">
                {periodMs > 0
                  ? `${(((periodMs - totalDowntimeMs) / periodMs) * 100).toFixed(3)}%`
                  : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground font-mono mt-1 space-y-0.5">
                <div>Uptime over {periodLabel}</div>
                {outageCount > 0 && (
                  <div>{pluralize(outageCount, "drop")}, {formatDurationMs(totalDowntimeMs)} total downtime</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Speed Distribution ──────────────────────────────── */}
      {dlSpeeds.length >= 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Speed Distribution</CardTitle>
            <CardDescription>
              How consistent are your download speeds? Based on {dlSpeeds.length} multi-connection tests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Percentile bars */}
              <div className="space-y-3">
                {(() => {
                  const planSpeed = ISP_PLAN.avgPeakDown;
                  const maxVal = Math.max(dlP95, planSpeed, 1);
                  const planPct = (planSpeed / maxVal) * 100;
                  return [
                    { label: "Worst 5%", value: dlP5, color: "bg-verdict-poor" },
                    { label: "Median", value: dlMedian, color: "bg-primary" },
                    { label: "Best 5%", value: dlP95, color: "bg-verdict-healthy" },
                  ].map((bar) => (
                    <div key={bar.label} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-16 text-right shrink-0">{bar.label}</span>
                      <div className="flex-1 h-6 bg-muted/30 rounded overflow-hidden relative">
                        <div
                          className={`h-full ${bar.color} rounded opacity-80`}
                          style={{ width: `${Math.max((bar.value / maxVal) * 100, 2)}%` }}
                        />
                        {/* Plan speed reference line */}
                        <div
                          className="absolute top-0 bottom-0 w-px bg-foreground/40 border-l border-dashed border-foreground/40"
                          style={{ left: `${planPct}%` }}
                          title={`${ISP_PLAN.provider} avg: ${planSpeed} Mbps`}
                        />
                        <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-mono font-medium">
                          {bar.value.toFixed(0)} Mbps
                        </span>
                      </div>
                    </div>
                  ));
                })()}
                {/* Plan reference legend */}
                <div className="flex items-center gap-2 ml-[76px]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-px border-t border-dashed border-foreground/40" />
                    <span className="text-[10px] text-muted-foreground">
                      {ISP_PLAN.provider} {ISP_PLAN.tier} avg ({ISP_PLAN.avgPeakDown} Mbps)
                    </span>
                  </div>
                </div>
                {hasAdjData && (
                  <div className="text-[10px] text-primary/70 ml-[76px] mt-1">
                    ISP-delivered range: {adjDlP5.toFixed(0)} – {adjDlP95.toFixed(0)} Mbps (P5–P95, WAN-adjusted)
                  </div>
                )}
              </div>

              {/* Throttle detection visual */}
              {singleDlSpeeds.length > 0 && dlSpeeds.length > 0 && (
                <div className="pt-3 border-t border-border/30">
                  <div className="text-xs text-muted-foreground mb-2 font-medium">Single vs Multi-Connection</div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-16 text-right shrink-0">Single</span>
                    <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden relative">
                      <div
                        className="h-full bg-chart-1/60 rounded"
                        style={{ width: `${Math.max((percentile(singleDlSpeeds, 50) / Math.max(dlP95, 1)) * 100, 2)}%` }}
                      />
                      <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-mono">
                        {percentile(singleDlSpeeds, 50).toFixed(0)} Mbps
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground w-16 text-right shrink-0">Multi</span>
                    <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden relative">
                      <div
                        className="h-full bg-chart-1 rounded"
                        style={{ width: `${Math.max((dlMedian / Math.max(dlP95, 1)) * 100, 2)}%` }}
                      />
                      <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-mono">
                        {dlMedian.toFixed(0)} Mbps
                      </span>
                    </div>
                  </div>
                  {hasThrottling && (
                    <div className="mt-2 text-[11px] text-verdict-poor flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3" />
                      {evidence?.throughputPolicing?.policingRatio?.toFixed(2)}x raw ratio
                      {evidence?.throughputPolicing?.adjustedPolicingRatio != null && (
                        <span className="text-muted-foreground ml-1">
                          ({evidence.throughputPolicing.adjustedPolicingRatio.toFixed(2)}x WAN-adjusted)
                        </span>
                      )}
                      {" "}— individual connections are throttled
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Network Step Comparison ─────────────────────────── */}
      {evidence?.hopComparison?.hops?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response Time by Network Step</CardTitle>
            <CardDescription>
              Average latency and consistency at each point in your network path
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {evidence.hopComparison.hops.map((hop: any, i: number) => {
                const maxRtt = Math.max(
                  ...evidence.hopComparison.hops.map((h: any) => h.meanRtt || 0),
                  1
                );
                const isUnstable = hop.stddev > THRESHOLDS.maxAcceptableStddev;
                const degradation = hopDegradation[hop.targetId];
                return (
                  <div key={hop.targetId} className="flex items-center gap-3">
                    <div className="w-36 shrink-0">
                      <div className="text-xs font-medium truncate">{hop.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                        {hop.meanRtt.toFixed(1)}ms avg
                        {degradation != null && Math.abs(degradation) > 0.5 && (
                          <span className={degradation > 2 ? "text-verdict-poor" : degradation < -1 ? "text-verdict-healthy" : ""}>
                            ({degradation > 0 ? "+" : ""}{degradation.toFixed(1)})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 h-6 bg-muted/20 rounded overflow-hidden relative">
                      <div
                        className={`h-full rounded ${isUnstable ? "bg-verdict-poor/60" : "bg-primary/50"}`}
                        style={{ width: `${Math.max((hop.meanRtt / maxRtt) * 100, 4)}%` }}
                      />
                    </div>
                    <div className="w-24 text-right shrink-0">
                      <span className={`text-[10px] font-mono ${isUnstable ? "text-verdict-poor" : "text-muted-foreground"}`}>
                        ±{hop.stddev.toFixed(1)}ms
                      </span>
                      {hop.spikes15msPct > 5 && (
                        <div className="text-[10px] text-muted-foreground/60">
                          {hop.spikes15msPct.toFixed(0)}% spikes
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Time of Day Analysis ────────────────────────────── */}
      {evidence?.timeOfDay?.hourlyLatency?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Time of Day Patterns</CardTitle>
            <CardDescription>
              How your connection performs at different hours
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Peak vs Off-Peak comparison */}
            {(peakAvgRtt != null || offPeakAvgRtt != null) && (
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-4 space-y-1">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Off-Peak (2AM – 6AM)
                  </div>
                  {offPeakAvgRtt != null && (
                    <div className="text-sm font-mono">
                      Response: <strong>{offPeakAvgRtt.toFixed(1)}ms</strong>
                    </div>
                  )}
                  {offPeakAvgSpeed != null && (
                    <div className="text-sm font-mono">
                      Speed: <strong>{offPeakAvgSpeed.toFixed(0)} Mbps</strong>
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-border p-4 space-y-1">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Peak (7PM – 11PM)
                  </div>
                  {peakAvgRtt != null ? (
                    <div className="text-sm font-mono">
                      Response: <strong>{peakAvgRtt.toFixed(1)}ms</strong>
                      {offPeakAvgRtt != null && peakAvgRtt > offPeakAvgRtt * 1.2 && (
                        <span className="text-verdict-poor text-xs ml-1">
                          +{((peakAvgRtt / offPeakAvgRtt - 1) * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground font-mono">No peak data yet</div>
                  )}
                  {peakAvgSpeed != null ? (
                    <div className="text-sm font-mono">
                      Speed: <strong>{peakAvgSpeed.toFixed(0)} Mbps</strong>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground font-mono">No peak data yet</div>
                  )}
                </div>
              </div>
            )}

            {/* Hourly bar chart */}
            <div>
              <div className="text-xs text-muted-foreground mb-2 font-medium">
                Hourly Response Time Profile
              </div>
              <div className="flex gap-0.5 items-end h-20">
                {Array.from({ length: 24 }, (_, h) => {
                  const data = evidence.timeOfDay.hourlyLatency.find((d: any) => d.hour === h);
                  const rtt = data?.avgRtt ?? 0;
                  const maxRtt = Math.max(
                    ...evidence.timeOfDay.hourlyLatency.map((d: any) => d.avgRtt || 0),
                    1
                  );
                  const height = rtt > 0 ? Math.max((rtt / maxRtt) * 100, 4) : 0;
                  const isPeak = h >= 19 && h <= 22;
                  const hasData = rtt > 0;
                  return (
                    <div
                      key={h}
                      className="flex-1 group relative"
                      title={hasData ? `${h}:00 — ${rtt.toFixed(1)}ms (${data?.samples} samples)` : `${h}:00 — No data`}
                    >
                      <div
                        className={`w-full rounded-t transition-colors ${
                          !hasData
                            ? "bg-muted/20"
                            : isPeak
                              ? "bg-chart-3/70 group-hover:bg-chart-3"
                              : "bg-primary/40 group-hover:bg-primary/60"
                        }`}
                        style={{ height: hasData ? `${height}%` : "2px" }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>23:00</span>
              </div>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <div className="h-2 w-3 rounded bg-primary/40" />
                  Off-peak
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-2 w-3 rounded bg-chart-3/70" />
                  Peak hours (7-11 PM)
                </div>
              </div>
            </div>

            {/* Hourly speed chart (if data) */}
            {evidence.timeOfDay.hourlyThroughput?.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-2 font-medium">
                  Hourly Speed Profile
                </div>
                <div className="flex gap-0.5 items-end h-16">
                  {Array.from({ length: 24 }, (_, h) => {
                    const data = evidence.timeOfDay.hourlyThroughput.find((d: any) => d.hour === h);
                    const speed = data?.avgSpeed ?? 0;
                    const maxSpeed = Math.max(
                      ...evidence.timeOfDay.hourlyThroughput.map((d: any) => d.avgSpeed || 0),
                      1
                    );
                    const height = speed > 0 ? Math.max((speed / maxSpeed) * 100, 4) : 0;
                    const isPeak = h >= 19 && h <= 22;
                    return (
                      <div
                        key={h}
                        className="flex-1 group"
                        title={speed > 0 ? `${h}:00 — ${speed.toFixed(0)} Mbps (${data?.samples} tests)` : `${h}:00 — No data`}
                      >
                        <div
                          className={`w-full rounded-t ${
                            speed === 0
                              ? "bg-muted/20"
                              : isPeak
                                ? "bg-chart-4/70"
                                : "bg-chart-1/50"
                          }`}
                          style={{ height: speed > 0 ? `${height}%` : "2px" }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>00:00</span>
                  <span>06:00</span>
                  <span>12:00</span>
                  <span>18:00</span>
                  <span>23:00</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── What the Data Says (narrative summary) ──────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Confidence</CardTitle>
          <CardDescription>
            How much data backs these conclusions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">Monitoring Since</div>
              <div className="text-sm font-mono font-medium">
                {periodStart
                  ? new Date(periodStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                  : "—"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">Total Duration</div>
              <div className="text-sm font-mono font-medium">{periodLabel}</div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">Latency Samples</div>
              <div className="text-sm font-mono font-medium">
                {((evidence?.collectionPeriod?.totalPingWindows || 0) * 50).toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {evidence?.collectionPeriod?.totalPingWindows || 0} windows × 50 pings
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">Speed Tests</div>
              <div className="text-sm font-mono font-medium">
                {evidence?.collectionPeriod?.totalThroughputTests || 0}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {dlTests.length} DL + {ulTests.length} UL (multi)
              </div>
            </div>
          </div>

          {/* Confidence level */}
          {periodMs > 0 && (
            <div className="mt-4 pt-3 border-t border-border/30">
              <div className="flex items-center gap-2">
                <div className="text-[11px] text-muted-foreground">Data Confidence:</div>
                {periodMs < 6 * 3600000 ? (
                  <Badge variant="outline" className="text-[10px] text-warning border-warning/30">Low — needs more data</Badge>
                ) : periodMs < 24 * 3600000 ? (
                  <Badge variant="outline" className="text-[10px] text-chart-3 border-chart-3/30">Moderate — building baseline</Badge>
                ) : periodMs < 7 * 24 * 3600000 ? (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Good — reliable trends</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-verdict-healthy border-verdict-healthy/30">Excellent — strong statistical basis</Badge>
                )}
              </div>
              {periodMs < 24 * 3600000 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Keep collecting for at least 24 hours to establish reliable baselines. Peak vs off-peak analysis needs data from evening hours.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Links to detailed pages ─────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { href: "/evidence", label: "Historical Data", icon: BarChart3, desc: "Raw measurements & trends" },
          { href: "/latency", label: "Latency Details", icon: Activity, desc: "Per-hop response times" },
          { href: "/throughput", label: "Speed Analysis", icon: Zap, desc: "Download & upload tests" },
          { href: "/outages", label: "Outage Log", icon: WifiOff, desc: "Connection drops" },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="hover:bg-muted/30 transition-colors cursor-pointer h-full">
              <CardContent className="pt-4 pb-4">
                <item.icon className="h-4 w-4 text-muted-foreground mb-2" />
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-[11px] text-muted-foreground">{item.desc}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
