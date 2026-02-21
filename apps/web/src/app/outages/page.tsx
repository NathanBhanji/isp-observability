import { Metadata } from "next";
import { fetchOutageSummary, fetchOutages, fetchLatencyHistory, timeframeToSince } from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    : 30 * 24 * 60 * 60 * 1000; // default 30 days
  const totalDownMs = summary?.totalDurationMs ?? 0;
  const uptimePct = periodMs > 0 ? ((periodMs - totalDownMs) / periodMs * 100) : 100;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Connectivity Outages</h1>
        <p className="text-sm text-muted-foreground">
          Gateway heartbeat monitoring (5-second intervals) — outages of 15+ seconds detected
        </p>
      </div>

      {/* Heartbeat timeline */}
      <HeartbeatTimeline
        outages={outageList || []}
        periodHours={since ? Math.max(1, (Date.now() - new Date(since).getTime()) / 3600000) : 24}
        since={since}
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
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
          title="Total Outages"
          value={String(summary?.totalOutages ?? 0)}
          badge={
            summary?.totalOutages > 0
              ? { text: "ISSUES", variant: "destructive" }
              : { text: "STABLE", variant: "secondary" }
          }
        />
        <KpiCard
          title="Total Downtime"
          value={
            summary?.totalDurationMs
              ? `${(summary.totalDurationMs / 1000).toFixed(0)}s`
              : "0s"
          }
          subtitle={
            summary?.totalDurationMs > 60000
              ? `${(summary.totalDurationMs / 60000).toFixed(1)} minutes`
              : undefined
          }
        />
        <KpiCard
          title="Longest Outage"
          value={
            summary?.longestMs
              ? `${(summary.longestMs / 1000).toFixed(1)}s`
              : "0s"
          }
        />
        <KpiCard
          title="Missed Pings"
          value={String(summary?.totalMissedPings ?? 0)}
          subtitle="Total failed heartbeats"
        />
      </div>

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
                  <TableHead className="text-right">Missed Pings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(outageList || []).map((outage: any) => (
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
                        ? outage.duration_ms >= 60000
                          ? `${(outage.duration_ms / 60000).toFixed(1)}m`
                          : `${(outage.duration_ms / 1000).toFixed(1)}s`
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
                Gateway connectivity has been stable. Monitoring every 5 seconds — outages of 15+ seconds will appear here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
