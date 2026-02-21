import { Metadata } from "next";
import { fetchLatencyLatest, fetchLatencyHistory, timeframeToSince } from "@/lib/collector";
import { PING_TARGETS, TARGET_LABELS } from "@isp/shared";
import { LatencyTimeline } from "@/components/charts/latency-timeline";
import { HopComparison } from "@/components/charts/hop-comparison";
import { LatencyHeatmap } from "@/components/charts/latency-heatmap";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Latency Analysis" };

export default async function LatencyPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const [latest, history] = await Promise.all([
    fetchLatencyLatest(),
    fetchLatencyHistory(since),
  ]);

  // Sort targets by hop order for consistent display
  const sortedTargets = [...PING_TARGETS].sort((a, b) => a.hop - b.hop);

  // Sort latest pings by hop order
  const sortedLatest = sortedTargets.map((target) =>
    (latest || []).find((p: any) => p.target_id === target.id)
  ).filter(Boolean);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Latency Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Per-hop ICMP ping monitoring across {PING_TARGETS.length} network targets
        </p>
      </div>

      {/* Metric selector tabs */}
      <Tabs defaultValue="p50">
        <TabsList>
          <TabsTrigger value="p50">P50</TabsTrigger>
          <TabsTrigger value="mean">Mean</TabsTrigger>
          <TabsTrigger value="p95">P95</TabsTrigger>
          <TabsTrigger value="p99">P99</TabsTrigger>
        </TabsList>
        <TabsContent value="p50" className="mt-4">
          <LatencyTimeline data={history || []} metric="rtt_p50" />
        </TabsContent>
        <TabsContent value="mean" className="mt-4">
          <LatencyTimeline data={history || []} metric="rtt_mean" />
        </TabsContent>
        <TabsContent value="p95" className="mt-4">
          <LatencyTimeline data={history || []} metric="rtt_p95" />
        </TabsContent>
        <TabsContent value="p99" className="mt-4">
          <LatencyTimeline data={history || []} metric="rtt_p99" />
        </TabsContent>
      </Tabs>

      {/* Latency heatmap */}
      <LatencyHeatmap data={history || []} />

      {/* Selectable hop comparison */}
      <HopComparison allHops={latest || []} />

      {/* Latest stats for all hops — sorted by hop order */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {sortedLatest.map((p: any) => {
          const isV6 = p.target_id?.includes("_v6");
          const isDown = isV6 && p.loss_pct === 100;
          return (
            <div
              key={p.target_id}
              className={`rounded-lg border border-border bg-card p-4 space-y-2 ${isDown ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{TARGET_LABELS[p.target_id] || p.target_id}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{p.target_ip}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-lg font-bold font-mono">
                  {p.rtt_p50 != null ? `${p.rtt_p50.toFixed(1)}ms` : "N/A"}
                </div>
                {isDown && (
                  <Badge variant="destructive" className="text-[10px]">
                    UNREACHABLE
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground font-mono">
                <span>min: {p.rtt_min?.toFixed(1) ?? "\u2014"}ms</span>
                <span>max: {p.rtt_max?.toFixed(1) ?? "\u2014"}ms</span>
                <span>stdev: {p.rtt_stddev?.toFixed(2) ?? "\u2014"}ms</span>
                <span>loss: {p.loss_pct?.toFixed(1) ?? "\u2014"}%</span>
                <span>jitter: {p.jitter_mean?.toFixed(2) ?? "\u2014"}ms</span>
                <span>&gt;15ms: {p.spikes_15ms ?? 0}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
