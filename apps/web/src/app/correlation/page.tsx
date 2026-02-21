import { Metadata } from "next";
import { fetchCorrelationLatest, fetchCorrelationHistory, timeframeToSince } from "@/lib/collector";
import { TARGET_LABELS } from "@isp/shared";
import { CorrelationScatter } from "@/components/charts/correlation-scatter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

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

      {/* Main scatter plot */}
      <CorrelationScatter
        samples={samples}
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
            <div className="space-y-1">
              <div className="grid grid-cols-4 gap-2 text-[11px] font-medium text-muted-foreground px-2 py-1">
                <span>Time</span>
                <span>Target</span>
                <span className="text-right">Pearson r</span>
                <span className="text-right">Session</span>
              </div>
              {(history || []).map((h: any, i: number) => (
                <div
                  key={i}
                  className="grid grid-cols-4 gap-2 text-xs font-mono px-2 py-1.5 rounded hover:bg-secondary/50"
                >
                  <span className="text-muted-foreground">
                    {h.timestamp?.slice(11, 19)}
                  </span>
                  <span>{TARGET_LABELS[h.target_id] || h.target_id}</span>
                  <span className="text-right font-semibold">
                    {h.pearson_r?.toFixed(3) ?? "N/A"}
                  </span>
                  <span className="text-right text-muted-foreground">
                    {h.session_id?.slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
