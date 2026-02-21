import { Metadata } from "next";
import { fetchCorrelationLatest, fetchCorrelationHistory, timeframeToSince } from "@/lib/collector";
import { TARGET_LABELS } from "@isp/shared";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { CorrelationScatter } from "@/components/charts/correlation-scatter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { interpretCorrelation } from "@/lib/labels";

export const metadata: Metadata = { title: "Speed vs. Responsiveness" };

export default async function CorrelationPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const [latest, history] = await Promise.all([
    fetchCorrelationLatest(),
    fetchCorrelationHistory(since),
  ]);

  const samples = latest?.samples || [];
  const correlations = latest?.correlations || [];

  const primaryCorr = correlations.find((c: any) => c.target_id === "bcube")
    || correlations[0];
  const primaryTarget = primaryCorr?.target_id || "bcube";
  const pearsonR = primaryCorr?.pearson_r ?? null;

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

  // Paginate history to last 30 entries, show 10 at a time
  const recentHistory = (history || []).slice(-30).reverse();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Speed vs. Responsiveness
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

      {/* Main scatter plot */}
      <CorrelationScatter
        samples={samples}
        correlations={correlations}
        pearsonR={pearsonR}
        targetId={primaryTarget}
      />

      {/* Correlation summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {["aggregation", "bcube", "google"].map((targetId) => {
          const corr = correlations.find((c: any) => c.target_id === targetId);
          const r = corr?.pearson_r;
          const label = TARGET_LABELS[targetId] || targetId;
          const absR = r != null ? Math.abs(r) : 0;

          return (
            <Card key={targetId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="text-lg font-semibold">
                    {interpretCorrelation(r)}
                  </div>
                </div>
                {/* Visual gauge */}
                {r != null && (
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          absR < 0.1 ? "bg-muted-foreground/30"
                          : absR < 0.3 ? "bg-success"
                          : absR < 0.5 ? "bg-warning"
                          : "bg-destructive"
                        }`}
                        style={{ width: `${Math.max(absR * 100, 5)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      r = {r.toFixed(3)}
                    </p>
                  </div>
                )}
                {r == null && (
                  <p className="text-xs text-muted-foreground mt-1">Waiting for data...</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Explanation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What does this measure?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            If response times increase during downloads (positive correlation), it may indicate
            <strong> network congestion</strong> — data queuing up in your network, adding delay
            proportional to download speed. A strong effect (r &gt; 0.5) means your network is getting overwhelmed under load.
          </p>
          <p>
            If response times stay the same during downloads (r near 0), your speed limit
            is not caused by congestion — your ISP may be actively rate-limiting traffic instead.
          </p>
        </CardContent>
      </Card>

      {/* Session history — paginated */}
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
