import { Metadata } from "next";
import { fetchCorrelationLatest, fetchCorrelationHistory, timeframeToSince } from "@/lib/collector";
import { TARGET_LABELS } from "@isp/shared";
import { CorrelationScatter } from "@/components/charts/correlation-scatter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Throughput-Latency Correlation" };

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

  // Use the first available correlation for the scatter plot
  const primaryCorr = correlations.find((c: any) => c.target_id === "bcube")
    || correlations[0];
  const primaryTarget = primaryCorr?.target_id || "bcube";
  const pearsonR = primaryCorr?.pearson_r ?? null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Throughput-Latency Correlation
        </h1>
        <p className="text-sm text-muted-foreground">
          Simultaneous RTT and throughput measurement during active downloads
        </p>
      </div>

      {/* Main scatter plot — now shows all 3 hops as tabs */}
      <CorrelationScatter
        samples={samples}
        correlations={correlations}
        pearsonR={pearsonR}
        targetId={primaryTarget}
      />

      {/* Correlation values for all monitored hops */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {["aggregation", "bcube", "google"].map((targetId) => {
          const corr = correlations.find((c: any) => c.target_id === targetId);
          const r = corr?.pearson_r;
          const label = TARGET_LABELS[targetId] || targetId;

          return (
            <Card key={targetId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">
                  {r != null ? r.toFixed(3) : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {r != null
                    ? Math.abs(r) < 0.1
                      ? "No correlation"
                      : r < -0.3
                        ? "Negative correlation"
                        : "Weak correlation"
                    : "Waiting for data..."}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Explanation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">About This Measurement</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            If RTT increases during downloads (positive correlation), it may indicate
            bufferbloat — packets queuing in a buffer, adding latency proportional to
            throughput. A typical buffered link shows r &gt; 0.5.
          </p>
          <p>
            If RTT is independent of throughput (r near 0), the throughput constraint
            is likely not caused by congestion — packets are not queuing at the bottleneck.
          </p>
          <p>
            We measure this by pinging each hop while simultaneously downloading, then
            computing the Pearson correlation between the RTT and throughput time series.
          </p>
        </CardContent>
      </Card>

      {/* Session history */}
      {(history || []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session History</CardTitle>
            <CardDescription>Correlation values over time</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead className="h-8 px-2">Time</TableHead>
                  <TableHead className="h-8 px-2">Target</TableHead>
                  <TableHead className="h-8 px-2 text-right">Pearson r</TableHead>
                  <TableHead className="h-8 px-2 text-right">Session</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history || []).map((h: any, i: number) => {
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
                      <TableCell className={`px-2 py-1.5 text-right font-semibold ${rColor}`}>
                        {h.pearson_r?.toFixed(3) ?? "N/A"}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right text-muted-foreground">
                        {h.session_id?.slice(0, 8)}
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
