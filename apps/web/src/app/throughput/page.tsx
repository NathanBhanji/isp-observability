import { Metadata } from "next";
import {
  fetchThroughputLatest,
  fetchThroughputHistory,
  fetchThroughputTimeseries,
  timeframeToSince,
} from "@/lib/collector";
import { THRESHOLDS } from "@isp/shared";
import { ThroughputHistory } from "@/components/charts/throughput-history";
import { DecayPattern } from "@/components/charts/decay-pattern";
import { RatioTimeline } from "@/components/charts/ratio-timeline";
import { KpiCard } from "@/components/dashboard/kpi-card";
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

  // Download stats
  const ratio = latest?.download?.ratio ?? latest?.ratio;
  const isPolicied = ratio != null && ratio > THRESHOLDS.policingRatio;

  // Upload stats
  const latestUploadSingle = latest?.upload?.single;
  const latestUploadMulti = latest?.upload?.multi;
  const ulRatio = latest?.upload?.ratio;
  const isUlPolicied = ulRatio != null && ulRatio > THRESHOLDS.policingRatio;

  // Server latency
  const dlLatency = singleDlTest?.idle_latency_ms;
  const ulLatency = latestUploadSingle?.idle_latency_ms;

  // Split history into download and upload
  const downloadHistory = (history || []).filter((t: any) => !t.direction || t.direction === "download");
  const uploadHistory = (history || []).filter((t: any) => t.direction === "upload");

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Throughput Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Single vs multi-stream tests to detect per-flow policing (download + upload)
        </p>
      </div>

      {/* Download KPI Row */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Download</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <KpiCard
            title="Single Stream"
            value={
              latest?.single?.speed_mbps != null
                ? `${latest.single.speed_mbps.toFixed(0)} Mbps`
                : "N/A"
            }
            subtitle={
              latest?.single?.duration_ms
                ? `${(latest.single.duration_ms / 1000).toFixed(1)}s duration`
                : undefined
            }
            metric="Latest"
          />
          <KpiCard
            title="Multi Stream (4x)"
            value={
              latest?.multi?.speed_mbps != null
                ? `${latest.multi.speed_mbps.toFixed(0)} Mbps`
                : "N/A"
            }
            subtitle={
              latest?.multi?.duration_ms
                ? `${(latest.multi.duration_ms / 1000).toFixed(1)}s duration`
                : undefined
            }
            metric="Latest"
          />
          <KpiCard
            title="Multi/Single Ratio"
            value={ratio != null ? `${ratio.toFixed(2)}x` : "N/A"}
            badge={
              isPolicied
                ? { text: "PER-FLOW POLICING", variant: "destructive" }
                : ratio != null
                  ? { text: "NORMAL", variant: "secondary" }
                  : undefined
            }
          />
          {dlLatency != null && (
            <KpiCard
              title="Server Latency"
              value={`${dlLatency.toFixed(1)}ms`}
              subtitle="Idle RTT to test server"
              metric="Pre-test"
            />
          )}
          <KpiCard
            title="Download Tests"
            value={String(downloadHistory.length)}
            subtitle={`${downloadHistory.filter((t: any) => t.stream_count === 1).length} single / ${downloadHistory.filter((t: any) => t.stream_count > 1).length} multi`}
          />
        </div>
      </div>

      {/* Upload KPI Row */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Upload</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <KpiCard
            title="Single Stream"
            value={
              latestUploadSingle?.speed_mbps != null
                ? `${latestUploadSingle.speed_mbps.toFixed(0)} Mbps`
                : "N/A"
            }
            subtitle={
              latestUploadSingle?.duration_ms
                ? `${(latestUploadSingle.duration_ms / 1000).toFixed(1)}s duration`
                : undefined
            }
            metric="Latest"
          />
          <KpiCard
            title="Multi Stream (4x)"
            value={
              latestUploadMulti?.speed_mbps != null
                ? `${latestUploadMulti.speed_mbps.toFixed(0)} Mbps`
                : "N/A"
            }
            subtitle={
              latestUploadMulti?.duration_ms
                ? `${(latestUploadMulti.duration_ms / 1000).toFixed(1)}s duration`
                : undefined
            }
            metric="Latest"
          />
          <KpiCard
            title="UL Multi/Single Ratio"
            value={ulRatio != null ? `${ulRatio.toFixed(2)}x` : "N/A"}
            badge={
              isUlPolicied
                ? { text: "UL POLICING", variant: "destructive" }
                : ulRatio != null
                  ? { text: "NORMAL", variant: "secondary" }
                  : undefined
            }
          />
          {ulLatency != null && (
            <KpiCard
              title="Server Latency"
              value={`${ulLatency.toFixed(1)}ms`}
              subtitle="Idle RTT to test server"
              metric="Pre-test"
            />
          )}
          <KpiCard
            title="Upload Tests"
            value={String(uploadHistory.length)}
            subtitle={`${uploadHistory.filter((t: any) => t.stream_count === 1).length} single / ${uploadHistory.filter((t: any) => t.stream_count > 1).length} multi`}
          />
        </div>
      </div>

      {/* Evidence Card */}
      {isPolicied && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="h-2 w-2 rounded-full bg-destructive mt-1.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Per-Flow Policing Detected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  4-stream download achieves {ratio?.toFixed(2)}x the speed of single-stream
                  (threshold: {THRESHOLDS.policingRatio}x). This indicates your ISP is applying
                  per-flow rate limiting, not a genuine bandwidth constraint.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ThroughputHistory data={downloadHistory} direction="download" />
        <ThroughputHistory data={uploadHistory} direction="upload" />
      </div>

      {/* Policing Ratio Over Time + Throughput Profile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RatioTimeline data={downloadHistory} />
        <DecayPattern data={timeseries || []} />
      </div>

      {/* Recent tests table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Tests</CardTitle>
          <CardDescription>Last 30 speed tests (download + upload)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Dir</TableHead>
                <TableHead>Streams</TableHead>
                <TableHead className="text-right">Speed</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Transferred</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history || [])
                .slice(-30)
                .reverse()
                .map((test: any) => (
                  <TableRow key={test.id}>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {test.timestamp?.slice(11, 19)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={test.direction === "upload" ? "outline" : "secondary"}
                        className="text-[10px] px-1"
                      >
                        {test.direction === "upload" ? "UL" : "DL"}
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
                      {((test.bytes_transferred ?? test.bytes_downloaded) / 1024 / 1024).toFixed(1)} MB
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
