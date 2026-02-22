import { Metadata } from "next";
import {
  fetchCorrelationLatest,
  fetchCorrelationHistory,
  fetchLatencyHistory,
  fetchThroughputHistory,
  resolveTimeRange,
  filterByUntil,
} from "@/lib/collector";
import { TARGET_LABELS } from "@isp/shared";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { CongestionOverlay } from "@/components/charts/congestion-overlay";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { interpretCorrelation } from "@/lib/labels";

export const metadata: Metadata = { title: "Congestion Analysis" };

export default async function CongestionPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; from?: string; to?: string }>;
}) {
  const { t, from, to } = await searchParams;
  const { since, until } = resolveTimeRange({ t, from, to });

  const [latest, historyRaw, latencyDataRaw, throughputDataRaw, gatewayLatencyDataRaw] = await Promise.all([
    fetchCorrelationLatest(),
    fetchCorrelationHistory(since),
    fetchLatencyHistory(since, "bcube"),
    fetchThroughputHistory(since),
    fetchLatencyHistory(since, "gateway"),
  ]);
  const history = filterByUntil(historyRaw, until);
  const latencyData = filterByUntil(latencyDataRaw, until);
  const throughputData = filterByUntil(throughputDataRaw, until);
  const gatewayLatencyData = filterByUntil(gatewayLatencyDataRaw, until);

  const correlations = latest?.correlations || [];

  // Compute verdict
  const maxR = correlations.length > 0
    ? Math.max(...correlations.map((c: any) => Math.abs(c.pearson_r ?? 0)))
    : 0;

  let verdictStatus: VerdictStatus = "healthy";
  if (maxR > 0.5) verdictStatus = "critical";
  else if (maxR > 0.3) verdictStatus = "poor";
  else if (maxR > 0.1) verdictStatus = "degraded";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "Downloads don't slow down your internet",
    degraded: "Mild congestion detected during downloads",
    poor: "Downloads are causing some congestion",
    critical: "Downloads are causing significant congestion",
  };
  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: "Response times stay stable even during heavy downloads — no congestion detected.",
    degraded: "Response times increase slightly during downloads. This is a mild effect that most users won't notice.",
    poor: `Response times increase noticeably during downloads (correlation: ${maxR.toFixed(2)}). This indicates network congestion.`,
    critical: `Response times increase significantly during downloads (correlation: ${maxR.toFixed(2)}). This indicates network congestion — data queuing up and adding delay.`,
  };

  // Recent history for collapsible table
  const recentHistory = (history || []).slice(-30).reverse();

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Congestion Analysis
        </h1>
        <p className="text-sm text-muted-foreground">
          Does downloading slow down your internet?
        </p>
      </div>

      {/* Verdict */}
      <VerdictCard
        status={verdictStatus}
        headline={verdictHeadlines[verdictStatus]}
        description={verdictDescriptions[verdictStatus]}
        metrics={correlations.slice(0, 3).map((c: any) => ({
          label: TARGET_LABELS[c.target_id] || c.target_id,
          value: interpretCorrelation(c.pearson_r),
          subValue: c.pearson_r != null ? `r = ${c.pearson_r.toFixed(3)}` : undefined,
        }))}
      />

      {/* Primary visualisation: Congestion overlay */}
      <CongestionOverlay
        latencyData={latencyData || []}
        throughputData={throughputData || []}
        gatewayLatencyData={gatewayLatencyData || []}
        correlations={correlations}
      />

      {/* Session history */}
      {recentHistory.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Test History</CardTitle>
                <CardDescription>Correlation measurements over time</CardDescription>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {(history || []).length} total
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead className="h-8 px-2">Time</TableHead>
                  <TableHead className="h-8 px-2">Network Step</TableHead>
                  <TableHead className="h-8 px-2 text-right">Effect</TableHead>
                  <TableHead className="h-8 px-2 text-right">Correlation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentHistory.slice(0, 10).map((h: any, i: number) => {
                  const r = h.pearson_r;
                  const absR = r != null ? Math.abs(r) : 0;
                  const rColor = r == null ? "" 
                    : absR < 0.1 ? "text-muted-foreground"
                    : absR < 0.3 ? "text-success"
                    : absR < 0.5 ? "text-warning"
                    : "text-destructive";
                  return (
                    <TableRow key={i} className="text-xs font-mono">
                      <TableCell className="px-2 py-1.5 text-muted-foreground">
                        {h.timestamp?.slice(11, 19)}
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        {TARGET_LABELS[h.target_id] || h.target_id}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right text-[11px]">
                        {interpretCorrelation(r)}
                      </TableCell>
                      <TableCell className={`px-2 py-1.5 text-right font-semibold ${rColor}`}>
                        {h.pearson_r?.toFixed(3) ?? "N/A"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
