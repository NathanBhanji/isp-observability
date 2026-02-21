import { Metadata } from "next";
import { fetchEvidenceSummary, timeframeToSince } from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { THRESHOLDS, TARGET_LABELS, TARGET_IPS } from "@isp/shared";

export const metadata: Metadata = { title: "Measurement Summary" };

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural || singular + "s"}`;
}

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const evidence = await fetchEvidenceSummary(since);

  // Compute observation period in human-friendly form
  const periodStart = evidence?.collectionPeriod?.start;
  const periodEnd = evidence?.collectionPeriod?.end;
  let periodDuration = "";
  if (periodStart && periodEnd) {
    const ms = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) periodDuration = `${pluralize(days, "day")}, ${pluralize(hours, "hour")}`;
    else periodDuration = pluralize(hours, "hour");
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Measurement Summary</h1>
        <p className="text-sm text-muted-foreground">
          Collected measurements, observations, and derived findings
        </p>
      </div>

      {/* Executive summary */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-xs text-muted-foreground font-mono">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Collection period:</span>
              <span>{periodDuration || "N/A"}</span>
            </div>
            <div className="flex items-center gap-4 sm:ml-auto">
              <span>{evidence?.collectionPeriod?.totalPingWindows || 0} ping windows</span>
              <span>{evidence?.collectionPeriod?.totalThroughputTests || 0} throughput tests</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 1: Per-Hop Latency Comparison */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">1</Badge>
            <CardTitle className="text-base">Per-Hop Latency Comparison</CardTitle>
          </div>
          <CardDescription>
            Average latency metrics across all monitored hops
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.hopComparison?.hops?.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {evidence.hopComparison.hops.map((hop: any) => (
                <div key={hop.targetId} className="rounded-lg border border-border p-4 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {hop.label} ({hop.ip})
                  </div>
                  <div className="text-lg font-bold font-mono">
                    stddev {hop.stddev.toFixed(2)}ms
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-muted-foreground">
                    <span>Mean RTT: {hop.meanRtt.toFixed(2)}ms</span>
                    <span>Spikes: {hop.spikes15msPct.toFixed(1)}%</span>
                  </div>
                  {/* Visual indicator bar */}
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${hop.stddev > THRESHOLDS.maxAcceptableStddev ? "bg-destructive" : "bg-success"}`}
                      style={{ width: `${Math.min(100, (hop.stddev / 5) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Continue collecting to populate this section.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2: Throughput & Policing Evidence (merged sections 2+7) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">2</Badge>
            <CardTitle className="text-base">Throughput & Policing Evidence</CardTitle>
          </div>
          <CardDescription>
            Download vs upload performance and per-flow policing detection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.throughputPolicing ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Download (Multi)</div>
                  <div className="text-lg font-bold font-mono">
                    {(evidence.throughputPolicing.multiDownloadMean ?? 0).toFixed(0)} Mbps
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {evidence.throughputPolicing.downloadTests} tests
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Upload (Multi)</div>
                  <div className="text-lg font-bold font-mono">
                    {(evidence.throughputPolicing.multiUploadMean ?? 0).toFixed(0)} Mbps
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {evidence.throughputPolicing.uploadTests} tests
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">DL / UL Ratio</div>
                  <div className="text-lg font-bold font-mono">
                    {evidence.throughputPolicing.dlUlRatio != null
                      ? `${evidence.throughputPolicing.dlUlRatio.toFixed(2)}x`
                      : "N/A"}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Multi / Single (DL)</div>
                  <div className="text-lg font-bold font-mono">
                    {evidence.throughputPolicing.policingRatio != null
                      ? `${evidence.throughputPolicing.policingRatio.toFixed(2)}x`
                      : "N/A"}
                  </div>
                  {evidence.throughputPolicing.policingRatio != null &&
                    evidence.throughputPolicing.policingRatio > THRESHOLDS.policingRatio && (
                    <div className="text-[10px] text-destructive mt-1">
                      Above {THRESHOLDS.policingRatio}x threshold
                    </div>
                  )}
                </div>
                {evidence.throughputPolicing.singleStreamMean != null && (
                  <div className="rounded-lg border border-border p-4">
                    <div className="text-xs text-muted-foreground">Single Stream (DL)</div>
                    <div className="text-lg font-bold font-mono">
                      {evidence.throughputPolicing.singleStreamMean.toFixed(0)} Mbps
                    </div>
                  </div>
                )}
              </div>

              {/* Visual comparison bars */}
              {evidence.throughputPolicing.multiDownloadMean > 0 && evidence.throughputPolicing.multiUploadMean > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Throughput Comparison</div>
                  {[
                    { label: "DL Multi", value: evidence.throughputPolicing.multiDownloadMean, color: "bg-chart-1" },
                    { label: "DL Single", value: evidence.throughputPolicing.singleStreamMean || 0, color: "bg-chart-1/50" },
                    { label: "UL Multi", value: evidence.throughputPolicing.multiUploadMean, color: "bg-chart-4" },
                  ].filter(b => b.value > 0).map((bar) => {
                    const maxVal = Math.max(
                      evidence.throughputPolicing.multiDownloadMean,
                      evidence.throughputPolicing.multiUploadMean,
                      evidence.throughputPolicing.singleStreamMean || 0
                    );
                    return (
                      <div key={bar.label} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-16 text-right">{bar.label}</span>
                        <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                          <div
                            className={`h-full ${bar.color} rounded`}
                            style={{ width: `${(bar.value / maxVal) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono w-16">{bar.value.toFixed(0)} Mbps</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Continue collecting to populate this section.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3: RTT-Throughput Correlation */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">3</Badge>
            <CardTitle className="text-base">RTT-Throughput Correlation</CardTitle>
          </div>
          <CardDescription>
            Pearson correlation between latency and throughput during downloads
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.correlation ? (
            <>
              <div className="flex items-center gap-4">
                <div className="rounded-lg border border-border p-4 inline-block">
                  <div className="text-xs text-muted-foreground">Pearson r</div>
                  <div className={`text-2xl font-bold font-mono mt-1 ${
                    Math.abs(evidence.correlation.pearsonR ?? 0) < 0.1 ? "text-muted-foreground"
                    : Math.abs(evidence.correlation.pearsonR ?? 0) < 0.3 ? "text-success"
                    : Math.abs(evidence.correlation.pearsonR ?? 0) < 0.5 ? "text-warning"
                    : "text-destructive"
                  }`}>
                    r = {(evidence.correlation.pearsonR ?? 0).toFixed(3)}
                  </div>
                </div>
                {/* Visual gauge */}
                <div className="flex-1 space-y-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        Math.abs(evidence.correlation.pearsonR ?? 0) < 0.3 ? "bg-success"
                        : Math.abs(evidence.correlation.pearsonR ?? 0) < 0.5 ? "bg-warning"
                        : "bg-destructive"
                      }`}
                      style={{ width: `${Math.abs(evidence.correlation.pearsonR ?? 0) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>No correlation</span>
                    <span>Strong</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {evidence.correlation.interpretation}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Continue collecting to populate this section.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 4: Path Analysis */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">4</Badge>
            <CardTitle className="text-base">Path Analysis</CardTitle>
          </div>
          <CardDescription>
            Your routing path compared with RIPE Atlas peers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.pathAnalysis ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Your Avg Hop Count</div>
                  <div className="text-lg font-bold font-mono">
                    {evidence.pathAnalysis.yourHopCount}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Peer Avg Hop Count</div>
                  <div className="text-lg font-bold font-mono">
                    {evidence.pathAnalysis.peerMeanHopCount || "N/A"}
                  </div>
                </div>
              </div>
              {evidence.pathAnalysis.peersMatchedTargets &&
                Object.keys(evidence.pathAnalysis.peersMatchedTargets).length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground font-medium">
                    Monitored hops seen in peer paths:
                  </div>
                  {Object.entries(evidence.pathAnalysis.peersMatchedTargets).map(([tid, count]: [string, any]) => (
                    <div key={tid} className="flex items-center gap-2 text-sm font-mono">
                      <Badge variant="outline" className="text-[10px]">
                        {TARGET_LABELS[tid] || tid}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        seen in {count} peer traceroute{count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Continue collecting to populate this section.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 5: Packet Loss */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">5</Badge>
            <CardTitle className="text-base">Packet Loss</CardTitle>
          </div>
          <CardDescription>
            Per-target packet loss rates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.packetLoss?.perTarget ? (() => {
            const allZero = Object.values(evidence.packetLoss.perTarget).every((d: any) => d.avgLoss === 0);
            if (allZero) {
              return (
                <div className="flex items-center gap-2 py-2">
                  <Badge variant="secondary" className="text-[10px]">0% LOSS</Badge>
                  <span className="text-sm text-muted-foreground">
                    No packet loss detected on any target across all measurement windows.
                  </span>
                </div>
              );
            }
            return (
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead className="h-8 px-2">Target</TableHead>
                    <TableHead className="h-8 px-2 text-right">Avg Loss</TableHead>
                    <TableHead className="h-8 px-2 text-right">Max Loss</TableHead>
                    <TableHead className="h-8 px-2 text-right">Windows</TableHead>
                    <TableHead className="h-8 px-2 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(evidence.packetLoss.perTarget).map(([target, data]: [string, any]) => {
                    const isHigh = data.avgLoss > THRESHOLDS.maxAcceptableLoss;
                    return (
                      <TableRow key={target} className="text-xs font-mono">
                        <TableCell className="px-2 py-1.5">
                          {TARGET_LABELS[target] || target}
                        </TableCell>
                        <TableCell className={`px-2 py-1.5 text-right ${isHigh ? "text-destructive font-semibold" : ""}`}>
                          {data.avgLoss.toFixed(2)}%
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right text-muted-foreground">
                          {data.maxLoss.toFixed(1)}%
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right text-muted-foreground">
                          {data.windows}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right">
                          {isHigh ? (
                            <Badge variant="destructive" className="text-[10px]">
                              &gt;{THRESHOLDS.maxAcceptableLoss}%
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            );
          })() : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Continue collecting to populate this section.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 6: Peak vs Off-Peak */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">6</Badge>
            <CardTitle className="text-base">Peak vs Off-Peak Performance</CardTitle>
          </div>
          <CardDescription>
            Evening peak (19:00-23:00) compared with off-peak (02:00-06:00)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.timeOfDay?.peak?.avgRtt != null ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-4 space-y-2">
                  <div className="text-xs text-muted-foreground">Off-Peak (02:00 - 06:00)</div>
                  {evidence.timeOfDay.offPeak.avgRtt != null && (
                    <div className="text-sm font-mono">
                      Avg RTT: <strong>{evidence.timeOfDay.offPeak.avgRtt.toFixed(1)}ms</strong>
                    </div>
                  )}
                  {evidence.timeOfDay.offPeak.avgLoss != null && (
                    <div className="text-sm font-mono">
                      Loss: <strong>{evidence.timeOfDay.offPeak.avgLoss.toFixed(2)}%</strong>
                    </div>
                  )}
                  {evidence.timeOfDay.offPeak.avgSpeed != null && (
                    <div className="text-sm font-mono">
                      Speed: <strong>{evidence.timeOfDay.offPeak.avgSpeed.toFixed(0)} Mbps</strong>
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-border p-4 space-y-2">
                  <div className="text-xs text-muted-foreground">Peak (19:00 - 23:00)</div>
                  {evidence.timeOfDay.peak.avgRtt != null && (
                    <div className="text-sm font-mono">
                      Avg RTT: <strong>{evidence.timeOfDay.peak.avgRtt.toFixed(1)}ms</strong>
                    </div>
                  )}
                  {evidence.timeOfDay.peak.avgLoss != null && (
                    <div className="text-sm font-mono">
                      Loss: <strong>{evidence.timeOfDay.peak.avgLoss.toFixed(2)}%</strong>
                    </div>
                  )}
                  {evidence.timeOfDay.peak.avgSpeed != null && (
                    <div className="text-sm font-mono">
                      Speed: <strong>{evidence.timeOfDay.peak.avgSpeed.toFixed(0)} Mbps</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Hourly breakdown */}
              {evidence.timeOfDay.hourlyLatency?.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Hourly RTT Profile
                  </div>
                  <div className="flex gap-0.5 items-end h-16">
                    {Array.from({ length: 24 }, (_, h) => {
                      const data = evidence.timeOfDay.hourlyLatency.find((d: any) => d.hour === h);
                      const rtt = data?.avgRtt ?? 0;
                      const maxRtt = Math.max(
                        ...evidence.timeOfDay.hourlyLatency.map((d: any) => d.avgRtt || 0),
                        1
                      );
                      const height = rtt > 0 ? Math.max((rtt / maxRtt) * 100, 4) : 0;
                      const isPeak = h >= 19 && h <= 22;
                      return (
                        <div
                          key={h}
                          className="flex-1 group relative"
                          title={`${h}:00 \u2014 ${rtt.toFixed(1)}ms${data?.samples ? ` (${data.samples} samples)` : ""}`}
                        >
                          <div
                            className={`w-full rounded-t ${
                              isPeak
                                ? "bg-chart-3/70"
                                : rtt > 0
                                  ? "bg-primary/50"
                                  : "bg-muted/30"
                            }`}
                            style={{ height: `${height}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>00:00</span>
                    <span>06:00</span>
                    <span>12:00</span>
                    <span>18:00</span>
                    <span>23:00</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Requires 24+ hours of collection.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 7: Hop Latency Trending */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">7</Badge>
            <CardTitle className="text-base">Hop Latency Over Time</CardTitle>
          </div>
          <CardDescription>
            Daily average hop latency trends from traceroute data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.hopTrending ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Observation Period</div>
                  <div className="text-lg font-bold font-mono">
                    {pluralize(evidence.hopTrending.periodDays, "day")}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Targets With Data</div>
                  <div className="text-lg font-bold font-mono">
                    {Object.keys(evidence.hopTrending.perTarget).length}
                  </div>
                </div>
              </div>

              {/* Per-target trend bars */}
              {Object.entries(evidence.hopTrending.perTarget).map(([targetId, days]: [string, any]) => {
                const change = evidence.hopTrending.degradationMs?.[targetId];
                return (
                  <div key={targetId}>
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="font-medium text-muted-foreground">
                        {TARGET_LABELS[targetId] || targetId} ({TARGET_IPS[targetId] || ""})
                      </span>
                      {change != null && (
                        <span className={`font-mono ${change > 2 ? "text-destructive" : change < -1 ? "text-success" : "text-muted-foreground"}`}>
                          {change > 0 ? "+" : ""}{change.toFixed(1)}ms
                        </span>
                      )}
                    </div>
                    <div className="flex gap-0.5 items-end h-12">
                      {days.map((d: any, i: number) => {
                        const maxRtt = Math.max(
                          ...days.map((x: any) => x.maxRtt || x.avgRtt || 0),
                          1
                        );
                        const height = Math.max((d.avgRtt / maxRtt) * 100, 4);
                        return (
                          <div
                            key={i}
                            className="flex-1"
                            title={`${d.day}: ${d.avgRtt.toFixed(1)}ms (min ${d.minRtt.toFixed(1)}, max ${d.maxRtt.toFixed(1)})`}
                          >
                            <div
                              className="w-full rounded-t bg-primary/50"
                              style={{ height: `${height}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {days.length > 1 && (
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                        <span>{days[0]?.day}</span>
                        <span>{days[days.length - 1]?.day}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Requires multiple days of traceroute collection.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 8: Micro-Outages */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">8</Badge>
            <CardTitle className="text-base">Connectivity Outages</CardTitle>
          </div>
          <CardDescription>
            Gateway reachability monitored every 5 seconds
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.outageSummary ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Total Outages</div>
                  <div className={`text-lg font-bold font-mono ${evidence.outageSummary.count > 0 ? "text-destructive" : ""}`}>
                    {evidence.outageSummary.count}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Total Downtime</div>
                  <div className="text-lg font-bold font-mono">
                    {(evidence.outageSummary.totalDurationMs / 1000).toFixed(0)}s
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Longest Outage</div>
                  <div className="text-lg font-bold font-mono">
                    {(evidence.outageSummary.longestMs / 1000).toFixed(1)}s
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Missed Pings</div>
                  <div className="text-lg font-bold font-mono">
                    {evidence.outageSummary.recent.reduce((s: number, o: any) => s + (o.missedPings || 0), 0)}
                  </div>
                </div>
              </div>

              {evidence.outageSummary.recent.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Recent Outages</div>
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px]">
                        <TableHead className="h-8 px-2">Started</TableHead>
                        <TableHead className="h-8 px-2">Ended</TableHead>
                        <TableHead className="h-8 px-2 text-right">Duration</TableHead>
                        <TableHead className="h-8 px-2 text-right">Missed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {evidence.outageSummary.recent.map((o: any, i: number) => (
                        <TableRow key={i} className="text-xs font-mono">
                          <TableCell className="px-2 py-1">
                            {o.startedAt?.slice(11, 19) || "?"}
                          </TableCell>
                          <TableCell className="px-2 py-1 text-muted-foreground">
                            {o.endedAt?.slice(11, 19) || "ongoing"}
                          </TableCell>
                          <TableCell className="px-2 py-1 text-right">
                            {(o.durationMs / 1000).toFixed(1)}s
                          </TableCell>
                          <TableCell className="px-2 py-1 text-right text-muted-foreground">
                            {o.missedPings}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No outages detected. Gateway heartbeat monitoring active (5-second intervals).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
