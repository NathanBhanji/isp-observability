import {
  fetchLatencyLatest,
  fetchLatencyHistory,
  fetchThroughputLatest,
  fetchThroughputHistory,
  fetchCollectorStatus,
  fetchRouterLatest,
  fetchOutageSummary,
  fetchEvidenceSummary,
  timeframeToSince,
} from "@/lib/collector";
import Link from "next/link";
import { PING_TARGETS, THRESHOLDS, TIMEFRAMES, DEFAULT_TIMEFRAME, TARGET_LABELS, ISP_PLAN } from "@isp/shared";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { AlertBanner } from "@/components/dashboard/alert-banner";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusBar } from "@/components/dashboard/status-bar";
import { LatencyTimeline } from "@/components/charts/latency-timeline";
import { ThroughputHistory } from "@/components/charts/throughput-history";
import { Sparkline } from "@/components/charts/sparkline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);
  const tfLabel = TIMEFRAMES.find((f) => f.key === (t || DEFAULT_TIMEFRAME))?.label ?? "All time";

  const [latestPings, latencyHistory, throughputLatest, throughputHistory, status, router, outageSummary, evidence] =
    await Promise.all([
      fetchLatencyLatest(),
      fetchLatencyHistory(since),
      fetchThroughputLatest(),
      fetchThroughputHistory(since),
      fetchCollectorStatus(),
      fetchRouterLatest(),
      fetchOutageSummary(since),
      fetchEvidenceSummary(since),
    ]);

   // Use the third target (ISP Backbone) for the primary response time KPI
  const hop3 = (latestPings || []).find((p: any) => p.target_id === PING_TARGETS[2].id);

  // Throughput — raw measured speeds
  const multiDlSpeed = throughputLatest?.download?.multi?.speed_mbps ?? throughputLatest?.multi?.speed_mbps;
  const singleDlSpeed = throughputLatest?.download?.single?.speed_mbps ?? throughputLatest?.single?.speed_mbps;
  const ratio = throughputLatest?.download?.ratio ?? throughputLatest?.ratio;
  const multiUlSpeed = throughputLatest?.upload?.multi?.speed_mbps ?? null;
  const isPolicied = ratio != null && ratio > THRESHOLDS.policingRatio;

  // WAN-adjusted speeds (what ISP actually delivered to router)
  const adjMultiDlSpeed = throughputLatest?.download?.multi?.adjusted_speed_mbps ?? multiDlSpeed;
  const adjSingleDlSpeed = throughputLatest?.download?.single?.adjusted_speed_mbps ?? singleDlSpeed;
  const adjRatio = throughputLatest?.download?.adjustedRatio ?? ratio;
  const adjMultiUlSpeed = throughputLatest?.upload?.multi?.adjusted_speed_mbps ?? multiUlSpeed;
  const hasWanData = adjMultiDlSpeed != null && adjMultiDlSpeed !== multiDlSpeed;

  // Use adjusted speed for plan % and "below plan" badge
  const effectiveDlSpeed = adjMultiDlSpeed ?? multiDlSpeed;

  // Outages
  const outageCount = outageSummary?.totalOutages ?? 0;
  const periodMs = since ? Date.now() - new Date(since).getTime() : 30 * 24 * 60 * 60 * 1000;
  const totalDownMs = outageSummary?.totalDurationMs ?? 0;
  const uptimePct = periodMs > 0 ? ((periodMs - totalDownMs) / periodMs * 100) : 100;

  // Compute verdict
  const rtt = hop3?.rtt_p50;
  const loss = hop3?.loss_pct ?? 0;
  let verdictStatus: VerdictStatus = "healthy";
  if (outageCount > 2 || loss > 3 || isPolicied) verdictStatus = "critical";
  else if (loss > 1 || (rtt && rtt > 30) || (ratio && ratio > THRESHOLDS.policingRatio)) verdictStatus = "poor";
  else if ((rtt && rtt > 15) || (hop3?.rtt_stddev && hop3.rtt_stddev > THRESHOLDS.maxAcceptableStddev)) verdictStatus = "degraded";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "Your internet is performing well",
    degraded: "Your internet has minor issues",
    poor: "Your internet performance is degraded",
    critical: "Your internet has serious problems",
  };
  const dlPlanPct = effectiveDlSpeed != null ? (effectiveDlSpeed / ISP_PLAN.avgPeakDown * 100).toFixed(0) : null;
  const wanNote = hasWanData ? ` (ISP delivered ${adjMultiDlSpeed?.toFixed(0)} Mbps to router)` : "";
  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: `Speed, latency, and stability are all within normal range.${dlPlanPct ? ` Currently ${dlPlanPct}% of your ${ISP_PLAN.tier} plan.` : ""}`,
    degraded: "Response times are slightly elevated. This may cause occasional slowness in video calls or gaming.",
    poor: isPolicied
      ? `Your ISP appears to be throttling individual download connections (${ratio?.toFixed(2)}x raw${adjRatio != null && adjRatio !== ratio ? `, ${adjRatio.toFixed(2)}x adjusted` : ""}).${dlPlanPct ? ` Currently ${dlPlanPct}% of your ${ISP_PLAN.tier} plan.` : ""} See the Throughput page for details.`
      : "Some performance metrics are outside normal range. Check the details below.",
    critical: isPolicied
      ? `Speed throttling detected${outageCount > 0 ? ` and ${outageCount} connectivity drop${outageCount > 1 ? "s" : ""}` : ""}.${dlPlanPct ? ` Currently ${dlPlanPct}% of your ${ISP_PLAN.tier} plan.` : ""}${wanNote}`
      : `${outageCount} connectivity drop${outageCount > 1 ? "s" : ""} detected in the selected time period.`,
  };

  // Build sparkline data
  const sparklines: Record<string, { value: number }[]> = {};
  const chartColors: Record<string, string> = {};
  for (const target of PING_TARGETS) {
    chartColors[target.id] = `var(--chart-${target.hop})`;
    sparklines[target.id] = (latencyHistory || [])
      .filter((r: any) => r.target_id === target.id)
      .map((r: any) => ({ value: r.rtt_p50 || 0 }));
  }

  return (
    <div className="flex flex-col">
      <StatusBar collectorStatus={status} />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Your internet performance overview
          </p>
        </div>

        {/* Verdict */}
        <VerdictCard
          status={verdictStatus}
          headline={verdictHeadlines[verdictStatus]}
          description={verdictDescriptions[verdictStatus]}
          metrics={[
            {
              label: "Download",
              value: multiDlSpeed != null ? `${multiDlSpeed.toFixed(0)} Mbps` : "N/A",
              subValue: hasWanData
                ? `ISP: ${adjMultiDlSpeed?.toFixed(0)} Mbps`
                : singleDlSpeed != null ? `Single: ${singleDlSpeed.toFixed(0)} Mbps` : undefined,
            },
            {
              label: "Response Time",
              value: rtt != null ? `${rtt.toFixed(1)} ms` : "N/A",
              subValue: "Median to ISP Backbone",
            },
            {
              label: "Uptime",
              value: `${uptimePct.toFixed(uptimePct >= 99.99 ? 3 : 1)}%`,
              subValue: outageCount > 0 ? `${outageCount} drop${outageCount > 1 ? "s" : ""}` : "No drops",
            },
          ]}
        />

        {/* Alert Banner — throttling */}
        {isPolicied && (
          <AlertBanner
            severity="critical"
            title="Speed Throttling Detected"
            description={`Single connections are capped at ${singleDlSpeed?.toFixed(0)} Mbps, but ${
              multiDlSpeed?.toFixed(0)
            } Mbps is achievable with multiple connections (${ratio?.toFixed(2)}x raw ratio${adjRatio != null && adjRatio !== ratio ? `, ${adjRatio.toFixed(2)}x WAN-adjusted` : ""}).`}
            action="View detailed evidence"
            actionHref="/evidence"
            items={[
              "Your ISP is limiting individual connection speeds",
              "This affects single-threaded downloads and some video streaming",
            ]}
          />
        )}

        {/* KPI Cards — 3 max */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="Speed"
            value={multiDlSpeed != null ? `${multiDlSpeed.toFixed(0)} Mbps` : "N/A"}
            subtitle={effectiveDlSpeed != null
              ? `${(effectiveDlSpeed / ISP_PLAN.avgPeakDown * 100).toFixed(0)}% of ${ISP_PLAN.tier} plan${adjMultiUlSpeed != null ? ` · Upload: ${(adjMultiUlSpeed ?? multiUlSpeed)?.toFixed(0)} Mbps` : multiUlSpeed != null ? ` · Upload: ${multiUlSpeed.toFixed(0)} Mbps` : ""}`
              : "Download (multi-stream)"}
            badge={
              isPolicied
                ? { text: "THROTTLED", variant: "destructive" }
                : effectiveDlSpeed != null && effectiveDlSpeed < ISP_PLAN.minimumDown
                  ? { text: "BELOW PLAN", variant: "destructive" }
                  : hasWanData && multiDlSpeed != null && multiDlSpeed < ISP_PLAN.minimumDown
                    ? { text: "HOME TRAFFIC", variant: "outline" }
                    : multiDlSpeed != null
                      ? { text: "OK", variant: "secondary" }
                      : undefined
            }
          />
          <KpiCard
            title="Response Time"
            value={rtt != null ? `${rtt.toFixed(1)} ms` : "N/A"}
            subtitle={`Consistency: ${hop3?.rtt_stddev?.toFixed(2) ?? "?"}ms`}
            badge={
              hop3?.rtt_stddev > THRESHOLDS.maxAcceptableStddev
                ? { text: "UNSTABLE", variant: "destructive" }
                : { text: "STABLE", variant: "secondary" }
            }
          />
          <KpiCard
            title="Packet Loss"
            value={loss != null ? `${loss.toFixed(1)}%` : "N/A"}
            subtitle={`${hop3?.spikes_15ms || 0} latency spikes`}
            badge={
              loss > THRESHOLDS.maxAcceptableLoss
                ? { text: "HIGH", variant: "destructive" }
                : { text: "OK", variant: "secondary" }
            }
          />
        </div>

        {/* Per-hop sparklines */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Response Time by Network Step ({tfLabel})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {PING_TARGETS.map((target) => {
                const latest = (latestPings || []).find((p: any) => p.target_id === target.id);
                return (
                  <div key={target.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{target.label}</span>
                      <span className="text-xs font-mono font-semibold">
                        {latest?.rtt_p50 != null ? `${latest.rtt_p50.toFixed(1)}ms` : "\u2014"}
                      </span>
                    </div>
                    <Sparkline
                      data={sparklines[target.id]?.length > 0 ? sparklines[target.id] : [{ value: 0 }]}
                      color={chartColors[target.id]}
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LatencyTimeline data={latencyHistory || []} />
          <ThroughputHistory
            data={(throughputHistory || []).filter((t: any) => !t.direction || t.direction === "download")}
          />
        </div>

        {/* Historical Context — link to Insights */}
        {evidence?.collectionPeriod?.totalPingWindows > 0 && (() => {
          const hasHistThrottling = evidence?.throughputPolicing?.policingRatio > THRESHOLDS.policingRatio;
          const hasHistOutages = evidence?.outageSummary?.count > 0;
          const degradingHops = Object.entries(evidence?.hopTrending?.degradationMs || {})
            .filter(([, d]) => (d as number) > 2);
          const insights: string[] = [];
          if (hasHistThrottling) insights.push(`Upload/download throttling detected (${evidence.throughputPolicing.policingRatio.toFixed(2)}x ratio)`);
          if (hasHistOutages) insights.push(`${evidence.outageSummary.count} connectivity drop${evidence.outageSummary.count > 1 ? "s" : ""} recorded`);
          if (degradingHops.length > 0) insights.push(`Latency increasing on ${degradingHops.length} network step${degradingHops.length > 1 ? "s" : ""}`);
          if (insights.length === 0) insights.push("No issues detected in historical data");

          return (
            <Card className="border-info/20 bg-info/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Historical Context</div>
                    <ul className="space-y-0.5">
                      {insights.map((insight, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <span className="text-muted-foreground/50">&#8226;</span>
                          {insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Link
                    href="/insights"
                    className="text-xs text-primary hover:underline whitespace-nowrap shrink-0"
                  >
                    View Insights →
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Network Status — simplified */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Connection Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">WAN Link</span>
              <Badge variant={router?.physical_link_status === "Up" ? "secondary" : "destructive"}>
                {router?.physical_link_status || "Unknown"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">DNS Speed</span>
              <span className="text-xs font-mono">
                {router?.dns_resolve_ms != null
                  ? `${router.dns_resolve_ms.toFixed(1)} ms`
                  : "N/A"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Connection Uptime</span>
              <span className="text-xs font-mono">
                {router?.connection_uptime_sec
                  ? formatUptime(router.connection_uptime_sec)
                  : "N/A"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
