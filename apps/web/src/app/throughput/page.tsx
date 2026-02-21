import { Metadata } from "next";
import {
  fetchThroughputLatest,
  fetchThroughputHistory,
  fetchThroughputTimeseries,
  timeframeToSince,
} from "@/lib/collector";
import { THRESHOLDS, ISP_PLAN } from "@isp/shared";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { AlertGroup, type AlertItem } from "@/components/dashboard/alert-banner";
import { ThroughputHistory } from "@/components/charts/throughput-history";
import { DecayPattern } from "@/components/charts/decay-pattern";
import { RatioTimeline } from "@/components/charts/ratio-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Throughput Analysis" };

export default async function ThroughputPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const [latest, history] = await Promise.all([
    fetchThroughputLatest(),
    fetchThroughputHistory(since),
  ]);

  // Get timeseries for the latest single-stream download test
  const singleDlTest = latest?.download?.single || latest?.single;
  const singleTestId = singleDlTest?.id;
  const timeseries = singleTestId
    ? await fetchThroughputTimeseries(singleTestId)
    : null;

  // Latest stats (shown as secondary context under historical medians)
  const latestDlMulti = latest?.download?.multi?.speed_mbps ?? latest?.multi?.speed_mbps;
  const latestUlMulti = latest?.upload?.multi?.speed_mbps;

  // Split history
  const downloadHistory = (history || []).filter((t: any) => !t.direction || t.direction === "download");
  const uploadHistory = (history || []).filter((t: any) => t.direction === "upload");

  // ── Historical stats (these drive the verdict) ─────────────
  function median(arr: number[]): number | null {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  const dlMultiSpeeds = downloadHistory.filter((t: any) => t.stream_count > 1).map((t: any) => t.speed_mbps);
  const dlSingleSpeeds = downloadHistory.filter((t: any) => t.stream_count === 1).map((t: any) => t.speed_mbps);
  const ulMultiSpeeds = uploadHistory.filter((t: any) => t.stream_count > 1).map((t: any) => t.speed_mbps);
  const ulSingleSpeeds = uploadHistory.filter((t: any) => t.stream_count === 1).map((t: any) => t.speed_mbps);

  const dlMultiMedian = median(dlMultiSpeeds);
  const dlSingleMedian = median(dlSingleSpeeds);
  const ulMultiMedian = median(ulMultiSpeeds);
  const ulSingleMedian = median(ulSingleSpeeds);

  // Historical throttle ratios — these are what matter
  const dlRatios: number[] = [];
  const dlSingleTests = downloadHistory.filter((t: any) => t.stream_count === 1);
  const dlMultiTests = downloadHistory.filter((t: any) => t.stream_count > 1);
  for (let i = 0; i < Math.min(dlSingleTests.length, dlMultiTests.length); i++) {
    if (dlSingleTests[i].speed_mbps > 0) {
      dlRatios.push(dlMultiTests[i].speed_mbps / dlSingleTests[i].speed_mbps);
    }
  }
  const medianDlRatio = median(dlRatios);
  const isHistDlThrottled = medianDlRatio != null && medianDlRatio > THRESHOLDS.policingRatio;

  const ulRatios: number[] = [];
  const ulSingleTests = uploadHistory.filter((t: any) => t.stream_count === 1);
  const ulMultiTests = uploadHistory.filter((t: any) => t.stream_count > 1);
  for (let i = 0; i < Math.min(ulSingleTests.length, ulMultiTests.length); i++) {
    if (ulSingleTests[i].speed_mbps > 0) {
      ulRatios.push(ulMultiTests[i].speed_mbps / ulSingleTests[i].speed_mbps);
    }
  }
  const medianUlRatio = median(ulRatios);
  const isHistUlThrottled = medianUlRatio != null && medianUlRatio > THRESHOLDS.policingRatio;

  const totalTests = downloadHistory.length + uploadHistory.length;

  // ── Plan comparison ────────────────────────────────────────
  const dlPlanPct = dlMultiMedian != null ? (dlMultiMedian / ISP_PLAN.avgPeakDown) * 100 : null;
  const ulPlanPct = ulMultiMedian != null ? (ulMultiMedian / ISP_PLAN.avgPeakUp) * 100 : null;
  const dlBelowMinimum = dlMultiMedian != null && dlMultiMedian < ISP_PLAN.minimumDown;
  const ulBelowMinimum = ulMultiMedian != null && ulMultiMedian < ISP_PLAN.minimumUp;

  // ── Verdict driven by HISTORICAL data ──────────────────────
  let verdictStatus: VerdictStatus = "healthy";
  if (isHistDlThrottled && medianDlRatio! > 2.0) verdictStatus = "critical";
  else if (dlBelowMinimum) verdictStatus = "critical";
  else if (isHistDlThrottled || isHistUlThrottled) verdictStatus = "poor";
  else if (dlPlanPct != null && dlPlanPct < 60) verdictStatus = "poor";
  else if (dlSingleMedian != null && dlSingleMedian < THRESHOLDS.minSingleStreamMbps) verdictStatus = "degraded";
  else if (dlPlanPct != null && dlPlanPct < 80) verdictStatus = "degraded";

  const planContext = dlPlanPct != null
    ? ` You're getting ${dlPlanPct.toFixed(0)}% of ${ISP_PLAN.provider}'s published ${ISP_PLAN.avgPeakDown} Mbps average for the ${ISP_PLAN.tier} plan.`
    : "";
  const ulPlanContext = ulPlanPct != null
    ? ` Upload: ${ulPlanPct.toFixed(0)}% of plan (${ulMultiMedian?.toFixed(0)} of ${ISP_PLAN.avgPeakUp} Mbps).`
    : "";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "Your internet speed is consistently good",
    degraded: "Speeds are below what your plan should deliver",
    poor: "Your ISP is throttling your speed",
    critical: dlBelowMinimum ? "Speeds are critically below your plan" : "Persistent speed throttling detected",
  };
  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: `Median download: ${dlMultiMedian?.toFixed(0) ?? "?"} Mbps, upload: ${ulMultiMedian?.toFixed(0) ?? "?"} Mbps across ${totalTests} tests.${planContext} No throttling detected.`,
    degraded: `Median download: ${dlMultiMedian?.toFixed(0) ?? "?"} Mbps across ${dlMultiSpeeds.length} tests.${planContext}${ulPlanContext}`,
    poor: isHistDlThrottled
      ? `Median single-connection speed is ${dlSingleMedian?.toFixed(0) ?? "?"} Mbps vs ${dlMultiMedian?.toFixed(0) ?? "?"} Mbps multi (${medianDlRatio?.toFixed(2)}x) across ${dlRatios.length} paired tests.${planContext} Your ISP is limiting individual connections.`
      : `Median download: ${dlMultiMedian?.toFixed(0) ?? "?"} Mbps — significantly below the ${ISP_PLAN.avgPeakDown} Mbps average your ${ISP_PLAN.tier} plan should deliver.${ulPlanContext}`,
    critical: dlBelowMinimum
      ? `Median download is only ${dlMultiMedian?.toFixed(0)} Mbps — below the ${ISP_PLAN.minimumDown} Mbps minimum threshold for your ${ISP_PLAN.tier} plan. Under Ofcom's code, you may be entitled to exit your contract penalty-free.${planContext}`
      : `Persistent throttling: median ${dlSingleMedian?.toFixed(0) ?? "?"} Mbps single vs ${dlMultiMedian?.toFixed(0) ?? "?"} Mbps multi (${medianDlRatio?.toFixed(2)}x) across ${dlRatios.length} paired tests.${planContext}`,
  };

  // Recent tests for the paginated table — limit to last 20
  const recentTests = (history || []).slice(-20).reverse();

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Speed Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Download and upload speed testing, including throttle detection
        </p>
      </div>

      {/* Verdict + Alerts — grouped tight */}
      <div className="space-y-2">
        <VerdictCard
          status={verdictStatus}
          headline={verdictHeadlines[verdictStatus]}
          description={verdictDescriptions[verdictStatus]}
          metrics={[
            {
              label: "Median DL",
              value: dlMultiMedian != null ? `${dlMultiMedian.toFixed(0)} Mbps` : "N/A",
              subValue: latestDlMulti != null ? `Latest: ${latestDlMulti.toFixed(0)}` : undefined,
            },
            {
              label: "Median UL",
              value: ulMultiMedian != null ? `${ulMultiMedian.toFixed(0)} Mbps` : "N/A",
              subValue: latestUlMulti != null ? `Latest: ${latestUlMulti.toFixed(0)}` : undefined,
            },
            ...(dlPlanPct != null ? [{
              label: "Plan",
              value: `${dlPlanPct.toFixed(0)}%`,
              subValue: `of ${ISP_PLAN.avgPeakDown} Mbps`,
            }] : []),
            ...(medianDlRatio != null ? [{
              label: "Throttle",
              value: `${medianDlRatio.toFixed(2)}x`,
              subValue: isHistDlThrottled ? "Confirmed" : "Normal",
            }] : []),
          ]}
        />

        {(() => {
          const alerts: AlertItem[] = [];
          if (isHistDlThrottled) alerts.push({
            severity: "critical",
            title: "Speed Throttling Detected",
            description: `Across ${dlRatios.length} paired tests, single-connection downloads reach only ${dlSingleMedian?.toFixed(0)} Mbps while multi-connection achieves ${dlMultiMedian?.toFixed(0)} Mbps (${medianDlRatio?.toFixed(2)}x ratio). Persistent pattern.`,
            action: "View evidence",
            actionHref: "/evidence",
            items: [
              "Contact your ISP and reference this evidence",
              "Streaming services using single connections will be affected",
            ],
          });
          if (dlBelowMinimum) alerts.push({
            severity: "critical",
            title: `Below ${ISP_PLAN.provider} Minimum`,
            description: `Median ${dlMultiMedian?.toFixed(0)} Mbps is below the ${ISP_PLAN.minimumDown} Mbps minimum for your ${ISP_PLAN.tier} plan (${dlPlanPct?.toFixed(0)}% of ${ISP_PLAN.avgPeakDown} Mbps published avg). Under Ofcom's code, you may exit your contract penalty-free.`,
            action: "Your rights",
            actionHref: "https://www.ofcom.org.uk/phones-and-broadband/broadband-and-mobile-coverage/broadband-speeds/broadband-speeds",
            items: [
              `Contact ${ISP_PLAN.provider} with this data`,
              "Request a formal speed investigation",
            ],
          });
          if (isHistUlThrottled && !isHistDlThrottled) alerts.push({
            severity: "warning",
            title: "Upload Throttling Detected",
            description: `Upload single-connection median ${ulSingleMedian?.toFixed(0)} Mbps vs ${ulMultiMedian?.toFixed(0)} Mbps multi (${medianUlRatio?.toFixed(2)}x ratio across ${ulRatios.length} tests).`,
          });
          return <AlertGroup alerts={alerts} />;
        })()}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ThroughputHistory data={downloadHistory} direction="download" />
        <ThroughputHistory data={uploadHistory} direction="upload" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RatioTimeline data={downloadHistory} />
        <DecayPattern data={timeseries || []} />
      </div>

      {/* Recent tests — paginated at 10 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Tests</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last {recentTests.length} speed tests
              </p>
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {(history || []).length} total
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Connections</TableHead>
                <TableHead className="text-right">Speed</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentTests.slice(0, 10).map((test: any) => (
                <TableRow key={test.id}>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {test.timestamp?.slice(11, 19)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={test.direction === "upload" ? "outline" : "secondary"}
                      className="text-[10px] px-1"
                    >
                      {test.direction === "upload" ? "Upload" : "Download"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] px-1">
                      {test.stream_count}x
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold font-mono text-xs">
                    {test.speed_mbps?.toFixed(0)} Mbps
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground font-mono text-xs">
                    {test.idle_latency_ms != null
                      ? `${test.idle_latency_ms.toFixed(1)}ms`
                      : "\u2014"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground font-mono text-xs">
                    {(test.duration_ms / 1000).toFixed(1)}s
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
