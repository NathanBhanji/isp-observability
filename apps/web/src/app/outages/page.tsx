import { Metadata } from "next";
import { fetchOutageSummary, fetchOutages, fetchCollectorStatus, fetchLatencyLatest, resolveTimeRange } from "@/lib/collector";
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
  searchParams: Promise<{ t?: string; from?: string; to?: string }>;
}) {
  const { t, from, to } = await searchParams;
  const { since } = resolveTimeRange({ t, from, to });

  const [summary, outageList, collectorStatus, latencyLatest] = await Promise.all([
    fetchOutageSummary(since),
    fetchOutages(since),
    fetchCollectorStatus(),
    fetchLatencyLatest(),
  ]);

  // Calculate uptime percentage
  // For "All time", use the earliest outage timestamp if available;
  // otherwise fall back to 30 days so the green grid still renders.
  const periodMs = since
    ? Date.now() - new Date(since).getTime()
    : summary?.earliestAt
      ? Date.now() - new Date(summary.earliestAt).getTime()
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
        periodHours={Math.max(1, periodMs / 3600000)}
        since={since}
        earliestAt={summary?.earliestAt ?? undefined}
      />

      {/* Monitoring Activity — proof the system is actively checking */}
      <MonitoringStatus collectorStatus={collectorStatus} latencyLatest={latencyLatest} />

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

// ── Monitoring Status Card ────────────────────────────────────
// Shows proof that the heartbeat system is actively monitoring.
// Without this, "no outages" is indistinguishable from "collector is off."

function MonitoringStatus({
  collectorStatus,
  latencyLatest,
}: {
  collectorStatus: any;
  latencyLatest: any[] | null;
}) {
  const heartbeat = collectorStatus?.collectors?.heartbeat;
  const ping = collectorStatus?.collectors?.ping;
  const uptimeSec = collectorStatus?.uptime
    ? Math.floor(collectorStatus.uptime / 1000)
    : null;

  // Latest ping timestamp from any target
  const latestPingTs = latencyLatest?.reduce((latest: string | null, row: any) => {
    if (!row.timestamp) return latest;
    if (!latest || row.timestamp > latest) return row.timestamp;
    return latest;
  }, null);

  // Determine if monitoring is actually running
  const isHeartbeatActive = heartbeat?.lastRun != null;
  const isPingActive = latestPingTs != null;
  const isActive = isHeartbeatActive || isPingActive;

  // How long ago was the last heartbeat check?
  const heartbeatAgo = heartbeat?.lastRun
    ? formatRelative(new Date(heartbeat.lastRun))
    : null;
  const pingAgo = latestPingTs
    ? formatRelative(new Date(latestPingTs))
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Monitoring Activity</CardTitle>
            {isActive ? (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-success/15 text-success border-success/30">
                ACTIVE
              </Badge>
            ) : collectorStatus ? (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                STALE
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                UNREACHABLE
              </Badge>
            )}
          </div>
          {uptimeSec != null && (
            <span className="text-[10px] text-muted-foreground font-mono">
              Collector uptime: {formatUptimeDuration(uptimeSec)}
            </span>
          )}
        </div>
        <CardDescription>
          How we know your connection is being monitored
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {/* Heartbeat checker */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Connectivity Checker
            </div>
            <div className="font-mono font-medium">
              {heartbeatAgo ?? "No data"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              last check
            </div>
          </div>

          {/* Heartbeat run count */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Checks Performed
            </div>
            <div className="font-mono font-medium">
              {heartbeat?.runCount != null
                ? heartbeat.runCount.toLocaleString()
                : "--"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              every 5 seconds
            </div>
          </div>

          {/* Latest ping measurement */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Latest Ping
            </div>
            <div className="font-mono font-medium">
              {pingAgo ?? "No data"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              ICMP latency check
            </div>
          </div>

          {/* Ping run count */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Ping Windows
            </div>
            <div className="font-mono font-medium">
              {ping?.runCount != null
                ? ping.runCount.toLocaleString()
                : "--"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              every 60 seconds
            </div>
          </div>
        </div>

        {/* Error/warning row — only show if something is wrong */}
        {(heartbeat?.errorCount > 0 || heartbeat?.lastError || heartbeat?.lastWarning) && (
          <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
            {heartbeat.errorCount > 0 && (
              <span className="text-destructive font-mono mr-4">
                {heartbeat.errorCount} error{heartbeat.errorCount > 1 ? "s" : ""}
              </span>
            )}
            {heartbeat.lastWarning && (
              <span className="text-warning font-mono">
                Warning: {heartbeat.lastWarning}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Formatting helpers ───────────────────────────────────────

/** Format a date as a relative time string (e.g. "3s ago", "2m ago") */
function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "just now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Format uptime in seconds to a human-readable string */
function formatUptimeDuration(totalSec: number): string {
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
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
