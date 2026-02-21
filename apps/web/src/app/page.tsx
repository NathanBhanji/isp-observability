import {
  fetchLatencyLatest,
  fetchLatencyHistory,
  fetchThroughputLatest,
  fetchThroughputHistory,
  fetchCollectorStatus,
  fetchRouterLatest,
  fetchOutageSummary,
  timeframeToSince,
} from "@/lib/collector";
import { PING_TARGETS, THRESHOLDS, TIMEFRAMES, DEFAULT_TIMEFRAME, TARGET_LABELS } from "@isp/shared";
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

  const [latestPings, latencyHistory, throughputLatest, throughputHistory, status, router, outageSummary] =
    await Promise.all([
      fetchLatencyLatest(),
      fetchLatencyHistory(since),
      fetchThroughputLatest(),
      fetchThroughputHistory(since),
      fetchCollectorStatus(),
      fetchRouterLatest(),
      fetchOutageSummary(since),
    ]);

  // Use the third target (hop 3) for the primary RTT KPI
  const hop3 = (latestPings || []).find((p: any) => p.target_id === PING_TARGETS[2].id);

  // Throughput (direction-filtered by route)
  const singleDlSpeed = throughputLatest?.download?.single?.speed_mbps ?? throughputLatest?.single?.speed_mbps;
  const multiDlSpeed = throughputLatest?.download?.multi?.speed_mbps ?? throughputLatest?.multi?.speed_mbps;
  const ratio = throughputLatest?.download?.ratio ?? throughputLatest?.ratio;

  // Upload speeds (multi-stream primary)
  const multiUlSpeed = throughputLatest?.upload?.multi?.speed_mbps ?? null;
  const singleUlSpeed = throughputLatest?.upload?.single?.speed_mbps ?? null;

  // Server latency from speed test
  const serverLatency = throughputLatest?.download?.single?.idle_latency_ms
    ?? throughputLatest?.single?.idle_latency_ms
    ?? null;

  // Build sparkline data per target
  const targets = PING_TARGETS.map((t) => t.id);
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
            Real-time ISP performance overview
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard
            title={`${TARGET_LABELS[PING_TARGETS[2].id]} P50 RTT`}
            value={hop3?.rtt_p50 != null ? `${hop3.rtt_p50.toFixed(1)}ms` : "N/A"}
            subtitle={`stddev ${hop3?.rtt_stddev?.toFixed(2) || "?"}ms`}
            metric="Latest"
            badge={
              hop3?.rtt_stddev > THRESHOLDS.maxAcceptableStddev
                ? { text: "UNSTABLE", variant: "destructive" }
                : { text: "OK", variant: "secondary" }
            }
          />
          <KpiCard
            title="Packet Loss"
            value={hop3?.loss_pct != null ? `${hop3.loss_pct.toFixed(1)}%` : "N/A"}
            subtitle={`${hop3?.spikes_15ms || 0} spikes >15ms`}
            metric="Latest"
            badge={
              hop3?.loss_pct > THRESHOLDS.maxAcceptableLoss
                ? { text: "HIGH", variant: "destructive" }
                : { text: "OK", variant: "secondary" }
            }
          />
          <KpiCard
            title="Multi/Single Ratio"
            value={ratio != null ? `${ratio.toFixed(2)}x` : "N/A"}
            subtitle="Multi / Single stream download"
            metric="Latest"
            badge={
              ratio != null && ratio > THRESHOLDS.policingRatio
                ? { text: "NOTABLE", variant: "warning" }
                : ratio != null
                  ? { text: "NORMAL", variant: "secondary" }
                  : undefined
            }
          />
        </div>

        {/* Speed + Outages Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Download"
            value={multiDlSpeed != null ? `${multiDlSpeed.toFixed(0)} Mbps` : "N/A"}
            subtitle={singleDlSpeed != null ? `Single: ${singleDlSpeed.toFixed(0)} Mbps` : "Multi-stream"}
            metric="Multi-stream"
            badge={
              multiDlSpeed != null && singleDlSpeed != null && singleDlSpeed < THRESHOLDS.minSingleStreamMbps
                ? { text: "BELOW THRESHOLD", variant: "destructive" }
                : multiDlSpeed != null
                  ? { text: "OK", variant: "secondary" }
                  : undefined
            }
          />
          <KpiCard
            title="Upload"
            value={multiUlSpeed != null ? `${multiUlSpeed.toFixed(0)} Mbps` : singleUlSpeed != null ? `${singleUlSpeed.toFixed(0)} Mbps` : "N/A"}
            subtitle={multiUlSpeed != null && singleUlSpeed != null ? `Single: ${singleUlSpeed.toFixed(0)} Mbps` : "Multi-stream"}
            metric="Multi-stream"
            badge={
              multiUlSpeed != null
                ? { text: "OK", variant: "secondary" }
                : undefined
            }
          />
          {serverLatency != null && (
            <KpiCard
              title="Server Latency"
              value={`${serverLatency.toFixed(1)}ms`}
              subtitle="Idle RTT to Ookla test server"
              metric="Pre-test"
              badge={
                serverLatency < 10
                  ? { text: "EXCELLENT", variant: "secondary" }
                  : serverLatency < 30
                    ? { text: "GOOD", variant: "secondary" }
                    : { text: "HIGH", variant: "warning" }
              }
            />
          )}
          <KpiCard
            title="Outages"
            value={String(outageSummary?.totalOutages ?? 0)}
            subtitle={
              outageSummary?.totalDurationMs
                ? `${(outageSummary.totalDurationMs / 1000).toFixed(0)}s total downtime`
                : "No downtime detected"
            }
            badge={
              outageSummary?.totalOutages > 0
                ? { text: "DROPS DETECTED", variant: "destructive" }
                : { text: "STABLE", variant: "secondary" }
            }
          />
        </div>

        {/* Per-hop sparklines */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Per-Hop P50 Latency ({tfLabel})</CardTitle>
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

        {/* Infrastructure Row */}
        <div className="grid grid-cols-1 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Network Status
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
                <span className="text-xs text-muted-foreground">External IP</span>
                <span className="text-xs font-mono">
                  {router?.external_ip || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Gateway</span>
                <span className="text-xs font-mono">
                  {router?.gateway_ip || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">DNS</span>
                <span className="text-xs font-mono">
                  {router?.dns_resolve_ms != null
                    ? `${router.dns_resolve_ms.toFixed(1)} ms`
                    : "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Uptime</span>
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
