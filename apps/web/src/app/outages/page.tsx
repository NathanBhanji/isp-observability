import { Metadata } from "next";
import { fetchOutageSummary, fetchOutages, timeframeToSince } from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { HeartbeatTimeline } from "@/components/charts/heartbeat-timeline";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Connectivity Outages" };

export default async function OutagesPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const [summary, outageList] = await Promise.all([
    fetchOutageSummary(since),
    fetchOutages(since),
  ]);

  // Calculate uptime percentage
  const periodMs = since
    ? Date.now() - new Date(since).getTime()
    : 30 * 24 * 60 * 60 * 1000;
  const totalDownMs = summary?.totalDurationMs ?? 0;
  const uptimePct = periodMs > 0 ? ((periodMs - totalDownMs) / periodMs * 100) : 100;
  const outageCount = summary?.totalOutages ?? 0;
  const longestMs = summary?.longestMs ?? 0;

  // Verdict
  let verdictStatus: VerdictStatus = "healthy";
  if (outageCount > 3 || longestMs > 60000) verdictStatus = "critical";
  else if (outageCount > 0) verdictStatus = "degraded";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "Your connection has been stable",
    degraded: "Connection drops detected",
    poor: "Multiple connection drops detected",
    critical: "Frequent connection drops detected",
  };
  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: `No connectivity drops detected. Uptime: ${uptimePct.toFixed(3)}% over the selected period.`,
    degraded: `${outageCount} connectivity drop${outageCount > 1 ? "s" : ""} detected. Total downtime: ${formatDuration(totalDownMs)}.`,
    poor: `${outageCount} drops totaling ${formatDuration(totalDownMs)} of downtime.`,
    critical: `${outageCount} drops totaling ${formatDuration(totalDownMs)} of downtime. Longest drop: ${formatDuration(longestMs)}.`,
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Connection Stability</h1>
        <p className="text-sm text-muted-foreground">
          Connection stability and downtime tracking
        </p>
      </div>

      {/* Verdict */}
      <VerdictCard
        status={verdictStatus}
        headline={verdictHeadlines[verdictStatus]}
        description={verdictDescriptions[verdictStatus]}
        metrics={[
          {
            label: "Uptime",
            value: `${uptimePct.toFixed(uptimePct >= 99.99 ? 3 : 1)}%`,
          },
          {
            label: "Total Drops",
            value: String(outageCount),
            subValue: outageCount > 0 ? `${formatDuration(totalDownMs)} total` : "None",
          },
          ...(longestMs > 0 ? [{
            label: "Longest Drop",
            value: formatDuration(longestMs),
          }] : []),
        ]}
      />

      {/* Heartbeat timeline */}
      <HeartbeatTimeline
        outages={outageList || []}
        periodHours={since ? Math.max(1, (Date.now() - new Date(since).getTime()) / 3600000) : 24}
        since={since}
      />

      {/* KPI Cards — only show when there are actual outages */}
      {outageCount > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="Uptime"
            value={`${uptimePct.toFixed(3)}%`}
            badge={
              uptimePct >= 99.9
                ? { text: "EXCELLENT", variant: "secondary" }
                : uptimePct >= 99
                  ? { text: "GOOD", variant: "secondary" }
                  : { text: "DEGRADED", variant: "destructive" }
            }
          />
          <KpiCard
            title="Total Downtime"
            value={formatDuration(totalDownMs)}
            subtitle={`Across ${outageCount} drop${outageCount > 1 ? "s" : ""}`}
          />
          <KpiCard
            title="Longest Drop"
            value={formatDuration(longestMs)}
          />
        </div>
      )}

      {/* Outage List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outage History</CardTitle>
          <CardDescription>
            All detected connectivity drops ({(outageList || []).length} total)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(outageList || []).length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Ended</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Failed Checks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(outageList || []).slice(0, 20).map((outage: any) => (
                  <TableRow key={outage.id}>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {outage.started_at?.slice(0, 10)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {outage.started_at?.slice(11, 19)}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {outage.ended_at?.slice(11, 19) || (
                        <Badge variant="destructive" className="text-[10px]">ONGOING</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {outage.duration_ms > 0
                        ? formatDuration(outage.duration_ms)
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono text-xs">
                      {outage.missed_pings}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-8 text-center">
              <div className="text-4xl mb-3 text-success">&#x2714;</div>
              <p className="text-sm font-medium">
                No outages detected
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Your connection has been stable. Monitoring every 5 seconds — outages of 15+ seconds will appear here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}
