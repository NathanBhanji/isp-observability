import { Metadata } from "next";
import { fetchLatencyLatest, fetchLatencyHistory, timeframeToSince } from "@/lib/collector";
import { PING_TARGETS, THRESHOLDS, TARGET_LABELS } from "@isp/shared";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
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

  const sortedTargets = [...PING_TARGETS].sort((a, b) => a.hop - b.hop);
  const sortedLatest = sortedTargets.map((target) =>
    (latest || []).find((p: any) => p.target_id === target.id)
  ).filter(Boolean);

  // Primary hop for verdict (ISP Backbone)
  const hop3 = sortedLatest.find((p: any) => p.target_id === "bcube");
  const rtt = hop3?.rtt_p50;
  const loss = hop3?.loss_pct ?? 0;
  const stddev = hop3?.rtt_stddev ?? 0;

  // Compute verdict
  let verdictStatus: VerdictStatus = "healthy";
  if ((rtt && rtt > 60) || loss > 3) verdictStatus = "critical";
  else if ((rtt && rtt > 30) || loss > 1) verdictStatus = "poor";
  else if ((rtt && rtt > 15) || stddev > THRESHOLDS.maxAcceptableStddev) verdictStatus = "degraded";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "Your response times are excellent",
    degraded: "Response times are slightly elevated",
    poor: "Your response times are slow",
    critical: "Response times are critically slow",
  };
  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: `Median response time is ${rtt?.toFixed(1) ?? "?"}ms with high consistency.`,
    degraded: `Median response time is ${rtt?.toFixed(1) ?? "?"}ms — this may cause occasional sluggishness.`,
    poor: `Median response time is ${rtt?.toFixed(1) ?? "?"}ms — this can cause noticeable lag in video calls and gaming.`,
    critical: `Median response time is ${rtt?.toFixed(1) ?? "?"}ms with ${loss.toFixed(1)}% packet loss — your connection quality is severely impacted.`,
  };

  // Group hops for bottom cards: Internal (Gateway), ISP (aggregation + bcube), External (google + cloudflare)
  const hopGroups = [
    { label: "Home Router", ids: ["gateway"], icon: "🏠" },
    { label: "ISP Network", ids: ["aggregation", "bcube"], icon: "🏢" },
    { label: "External", ids: ["google", "cloudflare"], icon: "🌐" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Latency Analysis</h1>
        <p className="text-sm text-muted-foreground">
          How fast your internet responds to requests across {PING_TARGETS.length} network steps
        </p>
      </div>

      {/* Verdict */}
      <VerdictCard
        status={verdictStatus}
        headline={verdictHeadlines[verdictStatus]}
        description={verdictDescriptions[verdictStatus]}
        metrics={[
          {
            label: "Typical",
            value: rtt != null ? `${rtt.toFixed(1)} ms` : "N/A",
            subValue: "Median response",
          },
          {
            label: "Slow",
            value: hop3?.rtt_p95 != null ? `${hop3.rtt_p95.toFixed(1)} ms` : "N/A",
            subValue: "95th percentile",
          },
          {
            label: "Consistency",
            value: stddev != null ? `${stddev.toFixed(2)} ms` : "N/A",
            subValue: stddev > THRESHOLDS.maxAcceptableStddev ? "Unstable" : "Stable",
          },
        ]}
      />

      {/* Metric selector tabs — relabeled */}
      <Tabs defaultValue="p50">
        <TabsList>
          <TabsTrigger value="p50">Typical</TabsTrigger>
          <TabsTrigger value="mean">Average</TabsTrigger>
          <TabsTrigger value="p95">Slow</TabsTrigger>
          <TabsTrigger value="p99">Worst Case</TabsTrigger>
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

      {/* Latency heatmap — enlarged */}
      <LatencyHeatmap data={history || []} />

      {/* Selectable hop comparison */}
      <HopComparison allHops={latest || []} />

      {/* Bottom stats — 3 groups instead of 5 individual cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {hopGroups.map((group) => {
          const hops = group.ids.map((id) => sortedLatest.find((p: any) => p.target_id === id)).filter(Boolean);
          if (hops.length === 0) return null;

          return (
            <div key={group.label} className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="text-xs font-medium">{group.label}</div>
              {hops.map((p: any) => {
                const isV6 = p.target_id?.includes("_v6");
                const isDown = isV6 && p.loss_pct === 100;
                return (
                  <div key={p.target_id} className={`space-y-1 ${isDown ? "opacity-50" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        {TARGET_LABELS[p.target_id] || p.target_id}
                      </span>
                      <span className="text-sm font-bold font-mono">
                        {p.rtt_p50 != null ? `${p.rtt_p50.toFixed(1)}ms` : "N/A"}
                      </span>
                    </div>
                    <details className="group">
                      <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">
                        Technical details
                      </summary>
                      <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground font-mono mt-1 pl-2 border-l border-border/50">
                        <span>min: {p.rtt_min?.toFixed(1) ?? "\u2014"}ms</span>
                        <span>max: {p.rtt_max?.toFixed(1) ?? "\u2014"}ms</span>
                        <span>stddev: {p.rtt_stddev?.toFixed(2) ?? "\u2014"}ms</span>
                        <span>loss: {p.loss_pct?.toFixed(1) ?? "\u2014"}%</span>
                        <span>jitter: {p.jitter_mean?.toFixed(2) ?? "\u2014"}ms</span>
                        <span>&gt;15ms: {p.spikes_15ms ?? 0}</span>
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
