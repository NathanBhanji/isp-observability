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
import { adjustedSpeed, type ThroughputTest } from "@/lib/throughput-utils";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { interpretCorrelation, HOP_LABELS, formatDurationMs } from "@/lib/labels";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Database,
} from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = { title: "Evidence — Historical Analysis" };

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

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const [evidence, throughputHistory, latencyHistory] = await Promise.all([
    fetchEvidenceSummary(since),
    fetchThroughputHistory(since),
    fetchLatencyHistory(since),
  ]);

  // Period
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

  // Verdict — use adjusted values when available
  const hasThrottling = evidence?.throughputPolicing?.policingRatio > THRESHOLDS.policingRatio;
  const adjPolicingRatio = evidence?.throughputPolicing?.adjustedPolicingRatio;
  const adjMultiDlMean = evidence?.throughputPolicing?.adjustedMultiDownloadMean;
  const adjMultiUlMean = evidence?.throughputPolicing?.adjustedMultiUploadMean;
  const rawMultiDlMean = evidence?.throughputPolicing?.multiDownloadMean;
  const hasWanContext = adjMultiDlMean != null && adjMultiDlMean !== rawMultiDlMean;
  const hasHighLoss = evidence?.packetLoss?.perTarget &&
    Object.values(evidence.packetLoss.perTarget).some((t: any) => t.avgLoss > THRESHOLDS.maxAcceptableLoss);
  const hasOutages = evidence?.outageSummary?.count > 0;

  let verdictStatus: VerdictStatus = "healthy";
  if (hasThrottling && hasOutages) verdictStatus = "critical";
  else if (hasThrottling || hasHighLoss) verdictStatus = "poor";
  else if (hasOutages) verdictStatus = "degraded";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "No issues found in historical measurements",
    degraded: "Minor issues detected in measurement history",
    poor: "Evidence of ISP performance problems in collected data",
    critical: "Multiple problems confirmed by measurement data",
  };
  const wanAdjNote = hasWanContext
    ? ` WAN-adjusted ratio: ${adjPolicingRatio?.toFixed(2)}x.`
    : "";
  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: `All metrics within normal range across ${periodLabel} of data collection.${hasWanContext ? ` ISP delivered avg ${adjMultiDlMean?.toFixed(0)} Mbps (accounting for household traffic).` : ""}`,
    degraded: `Some connectivity issues found over ${periodLabel}.`,
    poor: hasThrottling
      ? `Speed throttling confirmed — ${evidence?.throughputPolicing?.policingRatio?.toFixed(2)}x raw difference between single and multi-connection speeds across ${evidence?.throughputPolicing?.downloadTests || 0} tests.${wanAdjNote}`
      : `Elevated packet loss detected on some network paths.`,
    critical: `Speed throttling (${evidence?.throughputPolicing?.policingRatio?.toFixed(2)}x raw${adjPolicingRatio != null ? `, ${adjPolicingRatio.toFixed(2)}x adjusted` : ""}) and ${evidence?.outageSummary?.count} connectivity drop${evidence?.outageSummary?.count > 1 ? "s" : ""} confirmed in measurement data.`,
  };

  // Compute throughput percentiles from history
  const dlMulti = (throughputHistory || []).filter((t: any) => t.direction === "download" && t.stream_count === 4);
  const dlSingle = (throughputHistory || []).filter((t: any) => t.direction === "download" && t.stream_count === 1);
  const ulMulti = (throughputHistory || []).filter((t: any) => t.direction === "upload" && t.stream_count === 4);
  const ulSingle = (throughputHistory || []).filter((t: any) => t.direction === "upload" && t.stream_count === 1);

  const dlMultiSpeeds = dlMulti.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);
  const dlSingleSpeeds = dlSingle.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);
  const ulMultiSpeeds = ulMulti.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);
  const ulSingleSpeeds = ulSingle.map((t: any) => t.speed_mbps).sort((a: number, b: number) => a - b);

  // WAN-adjusted speeds
  const adjDlMultiSpeeds = (dlMulti as ThroughputTest[]).map(adjustedSpeed).sort((a, b) => a - b);
  const adjUlMultiSpeeds = (ulMulti as ThroughputTest[]).map(adjustedSpeed).sort((a, b) => a - b);
  const hasAdjData = adjDlMultiSpeeds.length > 0 &&
    adjDlMultiSpeeds.some((v, i) => Math.abs(v - dlMultiSpeeds[i]) > 0.1);

  // Compute per-target latency stats
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

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Historical Evidence</h1>
          <p className="text-sm text-muted-foreground">
            Raw measurement data and statistical analysis over time
          </p>
        </div>
        <Link href="/insights" className="text-xs text-primary hover:underline flex items-center gap-1">
          View Insights <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Verdict */}
      <VerdictCard
        status={verdictStatus}
        headline={verdictHeadlines[verdictStatus]}
        description={verdictDescriptions[verdictStatus]}
        metrics={[
          { label: "Period", value: periodLabel },
          { label: "Ping Windows", value: String(evidence?.collectionPeriod?.totalPingWindows || 0) },
          { label: "Speed Tests", value: String(evidence?.collectionPeriod?.totalThroughputTests || 0) },
        ]}
      />

      {/* ── 1: Latency Statistics ─────────────────────────── */}
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
                    <TableCell className="px-2 py-2 font-sans text-xs font-medium">
                      {s.label}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right text-verdict-healthy">
                      {s.p5.toFixed(1)}ms
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right font-semibold">
                      {s.p50.toFixed(1)}ms
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right text-muted-foreground">
                      {s.p95.toFixed(1)}ms
                    </TableCell>
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
                    <TableCell className="px-2 py-2 text-right text-muted-foreground">
                      {s.count}
                    </TableCell>
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
                    {/* P5-P95 range */}
                    <div
                      className="absolute h-full bg-muted/30 rounded"
                      style={{
                        left: `${(s.p5 / maxP95) * 100}%`,
                        width: `${Math.max(((s.p95 - s.p5) / maxP95) * 100, 1)}%`,
                      }}
                    />
                    {/* P50 marker */}
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
              Shaded area = P5–P95 range, marker = P50 median
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 2: Throughput Statistics ──────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">SPEED</Badge>
            <CardTitle className="text-base">Speed Test Statistics</CardTitle>
          </div>
          <CardDescription>
            Statistical breakdown of all speed tests during the monitoring period
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
                    { label: "P5 (worst)", pMulti: 5, pSingle: 5 },
                    { label: "P25", pMulti: 25, pSingle: 25 },
                    { label: "Median", pMulti: 50, pSingle: 50 },
                    { label: "P75", pMulti: 75, pSingle: 75 },
                    { label: "P95 (best)", pMulti: 95, pSingle: 95 },
                  ].map((row) => (
                    <TableRow key={row.label} className="text-xs font-mono">
                      <TableCell className="px-2 py-1 font-sans text-muted-foreground">{row.label}</TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        {dlMultiSpeeds.length > 0 ? `${percentile(dlMultiSpeeds, row.pMulti).toFixed(0)} Mbps` : "—"}
                      </TableCell>
                      {hasAdjData && (
                        <TableCell className="px-2 py-1 text-right text-primary/70">
                          {adjDlMultiSpeeds.length > 0 ? `${percentile(adjDlMultiSpeeds, row.pMulti).toFixed(0)} Mbps` : "—"}
                        </TableCell>
                      )}
                      <TableCell className="px-2 py-1 text-right text-muted-foreground">
                        {dlSingleSpeeds.length > 0 ? `${percentile(dlSingleSpeeds, row.pSingle).toFixed(0)} Mbps` : "—"}
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
                        {ulMultiSpeeds.length > 0 ? `${percentile(ulMultiSpeeds, row.p).toFixed(0)} Mbps` : "—"}
                      </TableCell>
                      {hasAdjData && (
                        <TableCell className="px-2 py-1 text-right text-primary/70">
                          {adjUlMultiSpeeds.length > 0 ? `${percentile(adjUlMultiSpeeds, row.p).toFixed(0)} Mbps` : "—"}
                        </TableCell>
                      )}
                      <TableCell className="px-2 py-1 text-right text-muted-foreground">
                        {ulSingleSpeeds.length > 0 ? `${percentile(ulSingleSpeeds, row.p).toFixed(0)} Mbps` : "—"}
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

          {/* Speed comparison bars */}
          {(dlMultiSpeeds.length > 0 || ulMultiSpeeds.length > 0) && (
            <div className="mt-4 pt-4 border-t border-border/30 space-y-2">
              <div className="text-[11px] text-muted-foreground mb-2">Visual Comparison (Median)</div>
              {[
                { label: "DL Multi", value: percentile(dlMultiSpeeds, 50), color: "bg-chart-1" },
                ...(hasAdjData ? [{ label: "DL Adjusted", value: percentile(adjDlMultiSpeeds, 50), color: "bg-chart-1 opacity-60 border border-dashed border-primary/40" }] : []),
                { label: "DL Single", value: percentile(dlSingleSpeeds, 50), color: "bg-chart-1/50" },
                { label: "UL Multi", value: percentile(ulMultiSpeeds, 50), color: "bg-chart-4" },
                ...(hasAdjData ? [{ label: "UL Adjusted", value: percentile(adjUlMultiSpeeds, 50), color: "bg-chart-4 opacity-60 border border-dashed border-chart-4/40" }] : []),
                { label: "UL Single", value: percentile(ulSingleSpeeds, 50), color: "bg-chart-4/50" },
              ].filter((b) => b.value > 0).map((bar) => {
                const maxVal = Math.max(
                  percentile(dlMultiSpeeds, 50),
                  ...(hasAdjData ? [percentile(adjDlMultiSpeeds, 50)] : []),
                  percentile(dlSingleSpeeds, 50),
                  percentile(ulMultiSpeeds, 50),
                  percentile(ulSingleSpeeds, 50),
                  1
                );
                return (
                  <div key={bar.label} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-16 text-right shrink-0">{bar.label}</span>
                    <div className="flex-1 h-4 bg-muted/20 rounded overflow-hidden">
                      <div
                        className={`h-full ${bar.color} rounded`}
                        style={{ width: `${Math.max((bar.value / maxVal) * 100, 2)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono w-14 text-right shrink-0">{bar.value.toFixed(0)} Mbps</span>
                  </div>
                );
              })}
              {hasAdjData && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  &quot;Adjusted&quot; = total router throughput (UPnP), accounting for other household devices
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 3: Packet Loss Analysis ──────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">LOSS</Badge>
            <CardTitle className="text-base">Packet Loss Analysis</CardTitle>
          </div>
          <CardDescription>
            Data delivery reliability per network step
          </CardDescription>
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
                          <TableCell className="px-2 py-1.5 text-right text-muted-foreground">
                            {lossyCount}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right text-muted-foreground">
                            {data.windows}
                          </TableCell>
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

      {/* ── 4: Correlation / Bufferbloat ─────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">CORRELATION</Badge>
            <CardTitle className="text-base">Congestion Under Load</CardTitle>
          </div>
          <CardDescription>
            Does downloading at full speed cause your internet to feel slow?
          </CardDescription>
        </CardHeader>
        <CardContent>
          {evidence?.correlation ? (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Effect Level</div>
                  <div className={`text-lg font-bold mt-1 ${
                    Math.abs(evidence.correlation.pearsonR ?? 0) < 0.1 ? "text-muted-foreground"
                    : Math.abs(evidence.correlation.pearsonR ?? 0) < 0.3 ? "text-verdict-healthy"
                    : Math.abs(evidence.correlation.pearsonR ?? 0) < 0.5 ? "text-warning"
                    : "text-destructive"
                  }`}>
                    {interpretCorrelation(evidence.correlation.pearsonR)}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-1">
                    Pearson r = {(evidence.correlation.pearsonR ?? 0).toFixed(3)}
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        Math.abs(evidence.correlation.pearsonR ?? 0) < 0.3 ? "bg-verdict-healthy"
                        : Math.abs(evidence.correlation.pearsonR ?? 0) < 0.5 ? "bg-warning"
                        : "bg-destructive"
                      }`}
                      style={{ width: `${Math.min(Math.abs(evidence.correlation.pearsonR ?? 0) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>No effect (0.0)</span>
                    <span>Strong (1.0)</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{evidence.correlation.interpretation}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data — correlation analysis runs during speed tests.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 5: Peak vs Off-Peak ──────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">TIME-OF-DAY</Badge>
            <CardTitle className="text-base">Peak vs Off-Peak Performance</CardTitle>
          </div>
          <CardDescription>
            Evening peak (19:00–23:00) compared with off-peak (02:00–06:00)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.timeOfDay?.peak?.avgRtt != null || evidence?.timeOfDay?.offPeak?.avgRtt != null ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-4 space-y-2">
                  <div className="text-xs text-muted-foreground font-medium">Off-Peak (02:00 – 06:00)</div>
                  {evidence.timeOfDay.offPeak?.avgRtt != null && (
                    <div className="text-sm font-mono">Response: <strong>{evidence.timeOfDay.offPeak.avgRtt.toFixed(1)}ms</strong></div>
                  )}
                  {evidence.timeOfDay.offPeak?.avgSpeed != null && (
                    <div className="text-sm font-mono">Speed: <strong>{evidence.timeOfDay.offPeak.avgSpeed.toFixed(0)} Mbps</strong></div>
                  )}
                  {evidence.timeOfDay.offPeak?.avgLoss != null && (
                    <div className="text-sm font-mono">Loss: <strong>{evidence.timeOfDay.offPeak.avgLoss.toFixed(2)}%</strong></div>
                  )}
                </div>
                <div className="rounded-lg border border-border p-4 space-y-2">
                  <div className="text-xs text-muted-foreground font-medium">Peak (19:00 – 23:00)</div>
                  {evidence.timeOfDay.peak?.avgRtt != null ? (
                    <div className="text-sm font-mono">
                      Response: <strong>{evidence.timeOfDay.peak.avgRtt.toFixed(1)}ms</strong>
                      {evidence.timeOfDay.offPeak?.avgRtt != null && evidence.timeOfDay.peak.avgRtt > evidence.timeOfDay.offPeak.avgRtt * 1.2 && (
                        <Badge variant="outline" className="ml-2 text-[10px] text-verdict-poor border-verdict-poor/30">
                          +{((evidence.timeOfDay.peak.avgRtt / evidence.timeOfDay.offPeak.avgRtt - 1) * 100).toFixed(0)}%
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No peak data yet</div>
                  )}
                  {evidence.timeOfDay.peak?.avgSpeed != null ? (
                    <div className="text-sm font-mono">Speed: <strong>{evidence.timeOfDay.peak.avgSpeed.toFixed(0)} Mbps</strong></div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No peak speed data</div>
                  )}
                  {evidence.timeOfDay.peak?.avgLoss != null && (
                    <div className="text-sm font-mono">Loss: <strong>{evidence.timeOfDay.peak.avgLoss.toFixed(2)}%</strong></div>
                  )}
                </div>
              </div>

              {/* Hourly chart */}
              {evidence.timeOfDay.hourlyLatency?.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-2 font-medium">Hourly Response Time Profile</div>
                  <div className="flex gap-0.5 items-end h-20">
                    {Array.from({ length: 24 }, (_, h) => {
                      const data = evidence.timeOfDay.hourlyLatency.find((d: any) => d.hour === h);
                      const rtt = data?.avgRtt ?? 0;
                      const maxRtt = Math.max(...evidence.timeOfDay.hourlyLatency.map((d: any) => d.avgRtt || 0), 1);
                      const height = rtt > 0 ? Math.max((rtt / maxRtt) * 100, 4) : 0;
                      const isPeak = h >= 19 && h <= 22;
                      return (
                        <div key={h} className="flex-1 group relative"
                          title={rtt > 0 ? `${h}:00 — ${rtt.toFixed(1)}ms (${data?.samples} samples)` : `${h}:00 — No data`}>
                          <div
                            className={`w-full rounded-t ${!rtt ? "bg-muted/20" : isPeak ? "bg-chart-3/70 group-hover:bg-chart-3" : "bg-primary/40 group-hover:bg-primary/60"}`}
                            style={{ height: rtt > 0 ? `${height}%` : "2px" }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Requires 24+ hours of collection across different times of day.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 6: Path Analysis ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">PATH</Badge>
            <CardTitle className="text-base">Path Analysis</CardTitle>
          </div>
          <CardDescription>
            Your network route compared with other users on your ISP
          </CardDescription>
        </CardHeader>
        <CardContent>
          {evidence?.pathAnalysis ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Your Avg Hops</div>
                  <div className="text-lg font-bold font-mono">{evidence.pathAnalysis.yourHopCount}</div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Peer Avg Hops</div>
                  <div className="text-lg font-bold font-mono">{evidence.pathAnalysis.peerMeanHopCount || "N/A"}</div>
                </div>
              </div>
              {evidence.pathAnalysis.peersMatchedTargets &&
                Object.keys(evidence.pathAnalysis.peersMatchedTargets).length > 0 && (
                <div className="space-y-1 text-xs">
                  <div className="text-muted-foreground font-medium">Your hops seen in peer paths:</div>
                  {Object.entries(evidence.pathAnalysis.peersMatchedTargets).map(([tid, count]: [string, any]) => (
                    <div key={tid} className="flex items-center gap-2 font-mono">
                      <Badge variant="outline" className="text-[10px]">{TARGET_LABELS[tid] || tid}</Badge>
                      <span className="text-muted-foreground">in {count} peer traceroute{count !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Insufficient data.</p>
          )}
        </CardContent>
      </Card>

      {/* ── 7: Hop Trending ──────────────────────────────── */}
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

      {/* ── 8: Outage History ────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">OUTAGES</Badge>
            <CardTitle className="text-base">Connectivity Drops</CardTitle>
          </div>
          <CardDescription>
            Connection stability monitored every 5 seconds
          </CardDescription>
        </CardHeader>
        <CardContent>
          {evidence?.outageSummary ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Total Drops</div>
                  <div className={`text-lg font-bold font-mono ${evidence.outageSummary.count > 0 ? "text-destructive" : ""}`}>
                    {evidence.outageSummary.count}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Total Downtime</div>
                  <div className="text-lg font-bold font-mono">
                    {formatDurationMs(evidence.outageSummary.totalDurationMs || 0)}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Longest</div>
                  <div className="text-lg font-bold font-mono">
                    {formatDurationMs(evidence.outageSummary.longestMs || 0)}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] text-muted-foreground">Uptime</div>
                  <div className="text-lg font-bold font-mono">
                    {periodMs > 0
                      ? `${(((periodMs - (evidence.outageSummary.totalDurationMs || 0)) / periodMs) * 100).toFixed(3)}%`
                      : "—"}
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
                        <TableCell className="px-2 py-1.5 text-right">
                          {formatDurationMs(o.durationMs || 0)}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right text-muted-foreground">
                          {o.missedPings}
                        </TableCell>
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

      {/* ── Data Collection Footer ───────────────────────── */}
      <Card className="border-muted/50 bg-muted/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            <span>
              Data collected from{" "}
              {periodStart ? new Date(periodStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}{" "}
              to{" "}
              {periodEnd ? new Date(periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}{" "}
              ({periodLabel}).
              Includes {(evidence?.collectionPeriod?.totalPingWindows || 0) * 50} individual ping measurements and {evidence?.collectionPeriod?.totalThroughputTests || 0} speed tests.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
