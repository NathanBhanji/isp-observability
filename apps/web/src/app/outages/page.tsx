import { Metadata } from "next";
import { fetchOutageSummary, fetchOutages, timeframeToSince } from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/dashboard/kpi-card";

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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Connectivity Outages</h1>
        <p className="text-sm text-muted-foreground">
          Gateway heartbeat monitoring (5-second intervals) — outages of 15+ seconds detected
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
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
          title="Avg Duration"
          value={
            summary?.avgMs
              ? `${(summary.avgMs / 1000).toFixed(1)}s`
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
            <div className="space-y-1">
              <div className="grid grid-cols-5 gap-2 text-[11px] font-medium text-muted-foreground px-2 py-1">
                <span>Date</span>
                <span>Started</span>
                <span>Ended</span>
                <span className="text-right">Duration</span>
                <span className="text-right">Missed Pings</span>
              </div>
              {(outageList || []).map((outage: any) => (
                <div
                  key={outage.id}
                  className="grid grid-cols-5 gap-2 text-xs font-mono px-2 py-1.5 rounded hover:bg-secondary/50"
                >
                  <span className="text-muted-foreground">
                    {outage.started_at?.slice(0, 10)}
                  </span>
                  <span>
                    {outage.started_at?.slice(11, 19)}
                  </span>
                  <span className="text-muted-foreground">
                    {outage.ended_at?.slice(11, 19) || (
                      <Badge variant="destructive" className="text-[10px]">ONGOING</Badge>
                    )}
                  </span>
                  <span className="text-right">
                    {outage.duration_ms > 0
                      ? outage.duration_ms >= 60000
                        ? `${(outage.duration_ms / 60000).toFixed(1)}m`
                        : `${(outage.duration_ms / 1000).toFixed(1)}s`
                      : "—"}
                  </span>
                  <span className="text-right text-muted-foreground">
                    {outage.missed_pings}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No outages detected. Gateway connectivity has been stable.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Monitoring every 5 seconds — outages of 15+ seconds will appear here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
