import { Metadata } from "next";
import { fetchEvidenceSummary, timeframeToSince } from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { THRESHOLDS, TARGET_LABELS, TARGET_IPS } from "@isp/shared";

export const metadata: Metadata = { title: "Evidence Report" };

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const evidence = await fetchEvidenceSummary(since);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Evidence Report</h1>
        <p className="text-sm text-muted-foreground">
          Collected measurements and observations
        </p>
      </div>

      {/* Collection period */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
            <span>Collection period:</span>
            <span>{evidence?.collectionPeriod?.start?.slice(0, 19) || "N/A"}</span>
            <span>to</span>
            <span>{evidence?.collectionPeriod?.end?.slice(0, 19) || "N/A"}</span>
            <span className="ml-auto">
              {evidence?.collectionPeriod?.totalPingWindows || 0} ping windows,{" "}
              {evidence?.collectionPeriod?.totalThroughputTests || 0} throughput tests
            </span>
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
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {evidence.hopComparison.hops.map((hop: any) => (
                  <div key={hop.targetId} className="rounded-lg border border-border p-4 space-y-2">
                    <div className="text-xs text-muted-foreground">
                      {hop.label} ({hop.ip})
                    </div>
                    <div className="text-lg font-bold font-mono">
                      stddev {hop.stddev.toFixed(2)}ms
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {hop.spikes15msPct.toFixed(1)}% spikes &gt;15ms
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">
                      Mean RTT: {hop.meanRtt.toFixed(2)}ms
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Continue collecting to populate this section.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2: Throughput — Multi-Stream DL vs UL */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">2</Badge>
            <CardTitle className="text-base">Multi-Stream Throughput</CardTitle>
          </div>
          <CardDescription>
            Parallel ({4}-stream) download vs upload — representative of actual link capacity
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.throughputPolicing ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                      ? `${evidence.throughputPolicing.dlUlRatio.toFixed(1)}x`
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
                  {evidence.throughputPolicing.decayDetected && (
                    <div className="text-[10px] text-muted-foreground mt-1">Decay pattern observed</div>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Multi-stream download averages{" "}
                <strong className="text-foreground">
                  {(evidence.throughputPolicing.multiDownloadMean ?? 0).toFixed(0)} Mbps
                </strong>
                , upload averages{" "}
                <strong className="text-foreground">
                  {(evidence.throughputPolicing.multiUploadMean ?? 0).toFixed(0)} Mbps
                </strong>
                .
                {evidence.throughputPolicing.policingRatio != null &&
                  evidence.throughputPolicing.policingRatio > THRESHOLDS.policingRatio
                  ? ` Multi/single download ratio of ${evidence.throughputPolicing.policingRatio.toFixed(2)}x exceeds the ${THRESHOLDS.policingRatio}x threshold, which may indicate per-flow rate limiting.`
                  : evidence.throughputPolicing.singleStreamMean != null
                    ? ` Single-stream download: ${evidence.throughputPolicing.singleStreamMean.toFixed(0)} Mbps.`
                    : ""}
              </p>
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
              <div className="rounded-lg border border-border p-4 inline-block">
                <div className="text-xs text-muted-foreground">Pearson r</div>
                <div className="text-2xl font-bold font-mono mt-1">
                  r = {(evidence.correlation.pearsonR ?? 0).toFixed(3)}
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
          {evidence?.packetLoss?.perTarget ? (
            <div className="space-y-1">
              <div className="grid grid-cols-5 gap-2 text-[11px] font-medium text-muted-foreground px-2 py-1">
                <span>Target</span>
                <span className="text-right">Avg Loss</span>
                <span className="text-right">Max Loss</span>
                <span className="text-right">Windows</span>
                <span className="text-right">Status</span>
              </div>
              {Object.entries(evidence.packetLoss.perTarget).map(([target, data]: [string, any]) => {
                const isHigh = data.avgLoss > THRESHOLDS.maxAcceptableLoss;
                return (
                  <div
                    key={target}
                    className="grid grid-cols-5 gap-2 text-xs font-mono px-2 py-1.5 rounded hover:bg-secondary/50"
                  >
                    <span>{TARGET_LABELS[target] || target}</span>
                    <span className={`text-right ${isHigh ? "text-destructive font-semibold" : ""}`}>
                      {data.avgLoss.toFixed(2)}%
                    </span>
                    <span className="text-right text-muted-foreground">
                      {data.maxLoss.toFixed(1)}%
                    </span>
                    <span className="text-right text-muted-foreground">
                      {data.windows}
                    </span>
                    <span className="text-right">
                      {isHigh ? (
                        <Badge variant="destructive" className="text-[10px]">
                          &gt;{THRESHOLDS.maxAcceptableLoss}%
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">OK</Badge>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
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

      {/* 7: Upload vs Download */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">7</Badge>
            <CardTitle className="text-base">Upload vs Download</CardTitle>
          </div>
          <CardDescription>
            Multi-stream upload and download throughput comparison
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.uploadEvidence ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Download Mean</div>
                  <div className="text-lg font-bold font-mono">
                    {evidence.uploadEvidence.downloadMean.toFixed(0)} Mbps
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {evidence.uploadEvidence.downloadTests} tests
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">Upload Mean</div>
                  <div className="text-lg font-bold font-mono">
                    {evidence.uploadEvidence.uploadMean.toFixed(0)} Mbps
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {evidence.uploadEvidence.uploadTests} tests
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">DL / UL Ratio</div>
                  <div className="text-lg font-bold font-mono">
                    {evidence.uploadEvidence.ratio != null
                      ? `${evidence.uploadEvidence.ratio.toFixed(1)}x`
                      : "N/A"}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data. Upload testing results will appear after the next collection cycle.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 8: Hop Latency Trending */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">8</Badge>
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
                    {evidence.hopTrending.periodDays} days
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

      {/* 9: Micro-Outages */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">9</Badge>
            <CardTitle className="text-base">Connectivity Outages</CardTitle>
          </div>
          <CardDescription>
            Gateway reachability monitored every 5 seconds
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence?.outageSummary ? (
            <>
              <div className="grid grid-cols-4 gap-4">
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
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Recent Outages</div>
                  <div className="grid grid-cols-4 gap-2 text-[11px] font-medium text-muted-foreground px-2 py-1">
                    <span>Started</span>
                    <span>Ended</span>
                    <span className="text-right">Duration</span>
                    <span className="text-right">Missed</span>
                  </div>
                  {evidence.outageSummary.recent.map((o: any, i: number) => (
                    <div key={i} className="grid grid-cols-4 gap-2 text-xs font-mono px-2 py-1 rounded hover:bg-secondary/50">
                      <span>{o.startedAt?.slice(11, 19) || "?"}</span>
                      <span className="text-muted-foreground">{o.endedAt?.slice(11, 19) || "ongoing"}</span>
                      <span className="text-right">{(o.durationMs / 1000).toFixed(1)}s</span>
                      <span className="text-right text-muted-foreground">{o.missedPings}</span>
                    </div>
                  ))}
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
