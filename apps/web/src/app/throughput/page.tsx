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
import {
  adjustedSpeed,
  adjustedMedian,
  verdictSoftening,
  type ThroughputTest,
} from "@/lib/throughput-utils";

export const metadata: Metadata = { title: "Speed Tests" };

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

  // Enrich history with WAN speed (total router throughput during each test)
  // For download tests: wan_rx_delta → total download throughput at router
  // For upload tests: wan_tx_delta → total upload throughput at router
  const enrichedHistory = (history || []).map((t: any) => {
    const wanDelta = t.direction === "upload" ? t.wan_tx_delta : t.wan_rx_delta;
    const wanSpeedMbps = wanDelta != null && t.duration_ms > 0
      ? (wanDelta * 8) / (t.duration_ms / 1000) / 1_000_000
      : null;
    return { ...t, wan_speed_mbps: wanSpeedMbps };
  });

  // Split history
  const downloadHistory = enrichedHistory.filter((t: any) => !t.direction || t.direction === "download");
  const uploadHistory = enrichedHistory.filter((t: any) => t.direction === "upload");

  // ── Historical stats (these drive the verdict) ─────────────
  function medianOf(arr: number[]): number | null {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  const dlMultiSpeeds = downloadHistory.filter((t: any) => t.stream_count > 1).map((t: any) => t.speed_mbps);
  const dlSingleSpeeds = downloadHistory.filter((t: any) => t.stream_count === 1).map((t: any) => t.speed_mbps);
  const ulMultiSpeeds = uploadHistory.filter((t: any) => t.stream_count > 1).map((t: any) => t.speed_mbps);
  const ulSingleSpeeds = uploadHistory.filter((t: any) => t.stream_count === 1).map((t: any) => t.speed_mbps);

  const dlMultiMedian = medianOf(dlMultiSpeeds);
  const dlSingleMedian = medianOf(dlSingleSpeeds);
  const ulMultiMedian = medianOf(ulMultiSpeeds);
  const ulSingleMedian = medianOf(ulSingleSpeeds);

  // WAN-adjusted medians (what the ISP actually delivered to the router)
  const dlMultiTestsArr = downloadHistory.filter((t: any) => t.stream_count > 1) as ThroughputTest[];
  const ulMultiTestsArr = uploadHistory.filter((t: any) => t.stream_count > 1) as ThroughputTest[];
  const adjDlMultiMedian = adjustedMedian(dlMultiTestsArr);
  const adjUlMultiMedian = adjustedMedian(ulMultiTestsArr);

  // Historical throttle ratios — raw (for policing evidence)
  const dlRatios: number[] = [];
  const dlSingleTests = downloadHistory.filter((t: any) => t.stream_count === 1);
  const dlMultiTests = downloadHistory.filter((t: any) => t.stream_count > 1);
  for (let i = 0; i < Math.min(dlSingleTests.length, dlMultiTests.length); i++) {
    if (dlSingleTests[i].speed_mbps > 0) {
      dlRatios.push(dlMultiTests[i].speed_mbps / dlSingleTests[i].speed_mbps);
    }
  }
  const medianDlRatio = medianOf(dlRatios);
  const isHistDlThrottled = medianDlRatio != null && medianDlRatio > THRESHOLDS.policingRatio;

  // WAN-adjusted throttle ratios (full context)
  const adjDlRatios: number[] = [];
  const dlSingleTestsCast = dlSingleTests as ThroughputTest[];
  const dlMultiTestsCast = dlMultiTests as ThroughputTest[];
  for (let i = 0; i < Math.min(dlSingleTestsCast.length, dlMultiTestsCast.length); i++) {
    const adjSingle = adjustedSpeed(dlSingleTestsCast[i]);
    if (adjSingle > 0) {
      adjDlRatios.push(adjustedSpeed(dlMultiTestsCast[i]) / adjSingle);
    }
  }
  const medianAdjDlRatio = medianOf(adjDlRatios);

  const ulRatios: number[] = [];
  const ulSingleTests = uploadHistory.filter((t: any) => t.stream_count === 1);
  const ulMultiTests = uploadHistory.filter((t: any) => t.stream_count > 1);
  for (let i = 0; i < Math.min(ulSingleTests.length, ulMultiTests.length); i++) {
    if (ulSingleTests[i].speed_mbps > 0) {
      ulRatios.push(ulMultiTests[i].speed_mbps / ulSingleTests[i].speed_mbps);
    }
  }
  const medianUlRatio = medianOf(ulRatios);
  const isHistUlThrottled = medianUlRatio != null && medianUlRatio > THRESHOLDS.policingRatio;

  const totalTests = downloadHistory.length + uploadHistory.length;

  // ── Plan comparison (use WAN-adjusted medians) ─────────────
  // Adjusted values reflect what ISP delivered; raw values reflect what this device got
  const dlPlanPctAdj = adjDlMultiMedian != null ? (adjDlMultiMedian / ISP_PLAN.avgPeakDown) * 100 : null;
  const ulPlanPctAdj = adjUlMultiMedian != null ? (adjUlMultiMedian / ISP_PLAN.avgPeakUp) * 100 : null;
  const dlPlanPctRaw = dlMultiMedian != null ? (dlMultiMedian / ISP_PLAN.avgPeakDown) * 100 : null;
  const ulPlanPctRaw = ulMultiMedian != null ? (ulMultiMedian / ISP_PLAN.avgPeakUp) * 100 : null;
  // Use adjusted for "below minimum" since it reflects true ISP delivery
  const dlBelowMinimumAdj = adjDlMultiMedian != null && adjDlMultiMedian < ISP_PLAN.minimumDown;
  const ulBelowMinimumAdj = adjUlMultiMedian != null && adjUlMultiMedian < ISP_PLAN.minimumUp;
  const dlBelowMinimumRaw = dlMultiMedian != null && dlMultiMedian < ISP_PLAN.minimumDown;

  // Verdict softening: raw speed triggered bad verdict but ISP delivered enough?
  const dlSoftening = verdictSoftening(
    dlMultiMedian, adjDlMultiMedian, ISP_PLAN.minimumDown, "the speed test"
  );

  // ── Verdict driven by HISTORICAL data (WAN-adjusted) ───────
  let verdictStatus: VerdictStatus = "healthy";
  if (isHistDlThrottled && medianDlRatio! > 2.0) verdictStatus = "critical";
  else if (dlBelowMinimumAdj) verdictStatus = "critical";
  else if (dlBelowMinimumRaw && dlSoftening.shouldSoften) verdictStatus = "degraded"; // softened from critical
  else if (isHistDlThrottled || isHistUlThrottled) verdictStatus = "poor";
  else if (dlPlanPctAdj != null && dlPlanPctAdj < 60) verdictStatus = "poor";
  else if (dlSingleMedian != null && dlSingleMedian < THRESHOLDS.minSingleStreamMbps) verdictStatus = "degraded";
  else if (dlPlanPctAdj != null && dlPlanPctAdj < 80) verdictStatus = "degraded";

  // Use adjusted plan % for display when available, raw as fallback
  const dlPlanPct = dlPlanPctAdj ?? dlPlanPctRaw;
  const ulPlanPct = ulPlanPctAdj ?? ulPlanPctRaw;

  const hasWanData = adjDlMultiMedian != null && adjDlMultiMedian !== dlMultiMedian;
  const planContext = dlPlanPct != null
    ? ` You're getting ${dlPlanPct.toFixed(0)}% of ${ISP_PLAN.provider}'s published ${ISP_PLAN.avgPeakDown} Mbps average for the ${ISP_PLAN.tier} plan.`
    : "";
  const ulPlanContext = ulPlanPct != null
    ? ` Upload: ${ulPlanPct.toFixed(0)}% of plan (${(adjUlMultiMedian ?? ulMultiMedian)?.toFixed(0)} of ${ISP_PLAN.avgPeakUp} Mbps).`
    : "";
  const wanContext = dlSoftening.backgroundNote
    ? ` ${dlSoftening.backgroundNote}.`
    : "";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "Your internet speed is consistently good",
    degraded: dlSoftening.shouldSoften
      ? "Other devices are using your bandwidth"
      : "Speeds are below what your plan should deliver",
    poor: "Your ISP is throttling your speed",
    critical: dlBelowMinimumAdj ? "Speeds are critically below your plan" : "Persistent speed throttling detected",
  };
  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: `Median download: ${(adjDlMultiMedian ?? dlMultiMedian)?.toFixed(0) ?? "?"} Mbps, upload: ${(adjUlMultiMedian ?? ulMultiMedian)?.toFixed(0) ?? "?"} Mbps across ${totalTests} tests.${planContext} No throttling detected.`,
    degraded: dlSoftening.shouldSoften
      ? `Your ISP delivered ${adjDlMultiMedian?.toFixed(0)} Mbps to the router, but household traffic reduced your measured speed to ${dlMultiMedian?.toFixed(0)} Mbps.${planContext}`
      : `Median download: ${(adjDlMultiMedian ?? dlMultiMedian)?.toFixed(0) ?? "?"} Mbps across ${dlMultiSpeeds.length} tests.${planContext}${ulPlanContext}`,
    poor: isHistDlThrottled
      ? `Median single-connection speed is ${dlSingleMedian?.toFixed(0) ?? "?"} Mbps vs ${dlMultiMedian?.toFixed(0) ?? "?"} Mbps multi (${medianDlRatio?.toFixed(2)}x raw${medianAdjDlRatio != null ? `, ${medianAdjDlRatio.toFixed(2)}x adjusted` : ""}) across ${dlRatios.length} paired tests.${planContext} Your ISP is limiting individual connections.`
      : `Median download: ${(adjDlMultiMedian ?? dlMultiMedian)?.toFixed(0) ?? "?"} Mbps — significantly below the ${ISP_PLAN.avgPeakDown} Mbps average your ${ISP_PLAN.tier} plan should deliver.${ulPlanContext}`,
    critical: dlBelowMinimumAdj
      ? `Median download is only ${(adjDlMultiMedian ?? dlMultiMedian)?.toFixed(0)} Mbps — below the ${ISP_PLAN.minimumDown} Mbps minimum threshold for your ${ISP_PLAN.tier} plan. Under Ofcom's code, you may be entitled to exit your contract penalty-free.${planContext}`
      : `Persistent throttling: median ${dlSingleMedian?.toFixed(0) ?? "?"} Mbps single vs ${dlMultiMedian?.toFixed(0) ?? "?"} Mbps multi (${medianDlRatio?.toFixed(2)}x) across ${dlRatios.length} paired tests.${planContext}`,
  };

  // ── Background traffic analysis ─────────────────────────────
  // Compute background bytes for tests that have WAN counter data
  function backgroundBytes(test: any): { bgBytes: number; direction: string } | null {
    if (test.wan_rx_delta == null && test.wan_tx_delta == null) return null;
    if (test.direction === "download" && test.wan_rx_delta != null) {
      return { bgBytes: Math.max(0, test.wan_rx_delta - test.bytes_transferred), direction: "rx" };
    }
    if (test.direction === "upload" && test.wan_tx_delta != null) {
      return { bgBytes: Math.max(0, test.wan_tx_delta - test.bytes_transferred), direction: "tx" };
    }
    return null;
  }

  // Flag: how many tests had >5 MB background traffic (significant)
  const BG_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MB
  const testsWithBgData = (history || []).filter((t: any) => t.wan_rx_delta != null || t.wan_tx_delta != null);
  const testsWithSignificantBg = testsWithBgData.filter((t: any) => {
    const bg = backgroundBytes(t);
    return bg && bg.bgBytes > BG_THRESHOLD_BYTES;
  });
  const bgPct = testsWithBgData.length > 0
    ? Math.round((testsWithSignificantBg.length / testsWithBgData.length) * 100)
    : null;

  // Recent tests for the paginated table — limit to last 20
  const recentTests = (history || []).slice(-20).reverse();

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Speed Tests</h1>
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
              subValue: hasWanData && adjDlMultiMedian != null
                ? `ISP: ${adjDlMultiMedian.toFixed(0)} Mbps`
                : latestDlMulti != null ? `Latest: ${latestDlMulti.toFixed(0)}` : undefined,
            },
            {
              label: "Median UL",
              value: ulMultiMedian != null ? `${ulMultiMedian.toFixed(0)} Mbps` : "N/A",
              subValue: adjUlMultiMedian != null && adjUlMultiMedian !== ulMultiMedian
                ? `ISP: ${adjUlMultiMedian.toFixed(0)} Mbps`
                : latestUlMulti != null ? `Latest: ${latestUlMulti.toFixed(0)}` : undefined,
            },
            ...(dlPlanPct != null ? [{
              label: "Plan",
              value: `${dlPlanPct.toFixed(0)}%`,
              subValue: `of ${ISP_PLAN.avgPeakDown} Mbps`,
            }] : []),
            ...(medianDlRatio != null ? [{
              label: "Throttle",
              value: `${medianDlRatio.toFixed(2)}x`,
              subValue: medianAdjDlRatio != null
                ? `Adjusted: ${medianAdjDlRatio.toFixed(2)}x`
                : isHistDlThrottled ? "Confirmed" : "Normal",
            }] : []),
          ]}
        />

        {(() => {
          const alerts: AlertItem[] = [];
          if (isHistDlThrottled) alerts.push({
            severity: "critical",
            title: "Speed Throttling Detected",
            description: `Across ${dlRatios.length} paired tests, single-connection downloads reach only ${dlSingleMedian?.toFixed(0)} Mbps while multi-connection achieves ${dlMultiMedian?.toFixed(0)} Mbps (${medianDlRatio?.toFixed(2)}x raw ratio${medianAdjDlRatio != null ? `, ${medianAdjDlRatio.toFixed(2)}x WAN-adjusted` : ""}). Persistent pattern.`,
            action: "View evidence",
            actionHref: "/",
            items: [
              "Contact your ISP and reference this evidence",
              "Streaming services using single connections will be affected",
            ],
          });
          if (dlBelowMinimumAdj) alerts.push({
            severity: "critical",
            title: `Below ${ISP_PLAN.provider} Minimum`,
            description: `Median ${(adjDlMultiMedian ?? dlMultiMedian)?.toFixed(0)} Mbps${hasWanData ? " (ISP-delivered)" : ""} is below the ${ISP_PLAN.minimumDown} Mbps minimum for your ${ISP_PLAN.tier} plan (${dlPlanPct?.toFixed(0)}% of ${ISP_PLAN.avgPeakDown} Mbps published avg). Under Ofcom's code, you may exit your contract penalty-free.`,
            action: "Your rights",
            actionHref: "https://www.ofcom.org.uk/phones-and-broadband/broadband-and-mobile-coverage/broadband-speeds/broadband-speeds",
            items: [
              `Contact ${ISP_PLAN.provider} with this data`,
              "Request a formal speed investigation",
            ],
          });
          if (dlBelowMinimumRaw && dlSoftening.shouldSoften) alerts.push({
            severity: "info",
            title: "Household Traffic Reducing Your Speed",
            description: dlSoftening.backgroundNote!,
            items: [
              "Your ISP is delivering adequate speed to the router",
              "Other devices on your network are consuming bandwidth during tests",
            ],
          });
          if (isHistUlThrottled && !isHistDlThrottled) alerts.push({
            severity: "warning",
            title: "Upload Throttling Detected",
            description: `Upload single-connection median ${ulSingleMedian?.toFixed(0)} Mbps vs ${ulMultiMedian?.toFixed(0)} Mbps multi (${medianUlRatio?.toFixed(2)}x ratio across ${ulRatios.length} tests).`,
          });
          if (bgPct != null && bgPct > 30 && !dlSoftening.shouldSoften) alerts.push({
            severity: "info",
            title: "Other Devices Active During Tests",
            description: `${bgPct}% of recent tests (${testsWithSignificantBg.length} of ${testsWithBgData.length}) had significant household traffic (>5 MB) running simultaneously. Measured speeds may be lower than your actual connection capacity.`,
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
                <TableHead className="text-right">Other Traffic</TableHead>
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
                  <TableCell className="text-right font-mono text-xs">
                    {(() => {
                      const bg = backgroundBytes(test);
                      if (!bg) return <span className="text-muted-foreground/50">{"\u2014"}</span>;
                      const mbBg = bg.bgBytes / 1024 / 1024;
                      if (mbBg < 1) return <span className="text-muted-foreground">{"<1 MB"}</span>;
                      const isHigh = bg.bgBytes > BG_THRESHOLD_BYTES;
                      return (
                        <span className={isHigh ? "text-amber-400" : "text-muted-foreground"}>
                          {mbBg.toFixed(0)} MB
                        </span>
                      );
                    })()}
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
