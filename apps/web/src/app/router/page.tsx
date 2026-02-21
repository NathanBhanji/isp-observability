import { Metadata } from "next";
import { fetchRouterLatest, fetchRouterHistory, fetchThroughputLatest, timeframeToSince } from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { AlertBanner } from "@/components/dashboard/alert-banner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Network Status" };

export default async function RouterPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const [latest, history, throughput] = await Promise.all([
    fetchRouterLatest(),
    fetchRouterHistory(since),
    fetchThroughputLatest(),
  ]);

  // Cross-reference UPnP vs actual
  const measuredMaxMbps = Math.max(
    throughput?.single?.speed_mbps ?? 0,
    throughput?.multi?.speed_mbps ?? 0,
  );
  const upnpReportedMbps = latest?.downstream_max_bps
    ? latest.downstream_max_bps / 1_000_000
    : null;
  const upnpSpeedMismatch =
    upnpReportedMbps !== null && measuredMaxMbps > upnpReportedMbps * 1.1;

  const historyArr = (history || []) as any[];
  const interfaceThroughput = computeInterfaceThroughput(historyArr);

  // Verdict
  const linkDown = latest?.physical_link_status && latest.physical_link_status !== "Up";
  const dnsMs = latest?.dns_resolve_ms;
  let verdictStatus: VerdictStatus = "healthy";
  if (linkDown) verdictStatus = "critical";
  else if (upnpSpeedMismatch) verdictStatus = "degraded";
  else if (dnsMs != null && dnsMs > 50) verdictStatus = "degraded";

  const verdictHeadlines: Record<VerdictStatus, string> = {
    healthy: "Your network connection is stable",
    degraded: upnpSpeedMismatch
      ? "Speed reporting mismatch detected"
      : "DNS performance is slow",
    poor: "Network issues detected",
    critical: "WAN link is down",
  };
  const verdictDescriptions: Record<VerdictStatus, string> = {
    healthy: `WAN link is up, DNS resolves in ${dnsMs?.toFixed(1) ?? "?"}ms, connection has been active for ${latest?.connection_uptime_sec ? formatDuration(latest.connection_uptime_sec) : "unknown"}.`,
    degraded: upnpSpeedMismatch
      ? `Your router reports a max speed of ${upnpReportedMbps?.toFixed(0)} Mbps, but speed tests measure ${measuredMaxMbps.toFixed(0)} Mbps. The router may be reporting incorrectly.`
      : `DNS resolution is taking ${dnsMs?.toFixed(1)}ms — this may slow down web browsing.`,
    poor: "Some network parameters are outside normal range.",
    critical: "Your WAN connection appears to be down. Check your router and ISP connection.",
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Network Status</h1>
        <p className="text-sm text-muted-foreground">
          Your home network connection status
        </p>
      </div>

      {/* Verdict */}
      <VerdictCard
        status={verdictStatus}
        headline={verdictHeadlines[verdictStatus]}
        description={verdictDescriptions[verdictStatus]}
        metrics={[
          {
            label: "Connection",
            value: latest?.physical_link_status === "Up" ? "Online" : latest?.physical_link_status || "Unknown",
          },
          {
            label: "DNS Speed",
            value: dnsMs != null ? `${dnsMs.toFixed(1)} ms` : "N/A",
            subValue: dnsMs != null ? (dnsMs < 10 ? "Cached" : dnsMs < 50 ? "Good" : "Slow") : undefined,
          },
          {
            label: "Uptime",
            value: latest?.connection_uptime_sec ? formatDuration(latest.connection_uptime_sec) : "N/A",
          },
        ]}
      />

      {/* Speed mismatch alert */}
      {upnpSpeedMismatch && (
        <AlertBanner
          severity="warning"
          title="Speed Reporting Mismatch"
          description={`Your router reports a maximum speed of ${upnpReportedMbps?.toFixed(0)}/${latest?.upstream_max_bps ? (latest.upstream_max_bps / 1_000_000).toFixed(0) : "?"} Mbps (down/up), but actual speed tests measure ${measuredMaxMbps.toFixed(0)} Mbps. This may indicate incorrect UPnP reporting.`}
        />
      )}

      {/* Primary status cards — 3 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className={`h-3 w-3 rounded-full ${latest?.physical_link_status === "Up" ? "bg-success" : "bg-destructive"}`} />
              <span className="text-lg font-bold font-mono">
                {latest?.physical_link_status === "Up" ? "Online" : latest?.physical_link_status || "Unknown"}
              </span>
            </div>
            {latest?.connection_uptime_sec && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                Up for {formatDuration(latest.connection_uptime_sec)}
              </p>
            )}
            {latest?.cf_colo && (
              <div className="mt-2">
                <Badge variant="secondary" className="text-[10px]">
                  Cloudflare: {latest.cf_colo}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">DNS Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono">
                {dnsMs != null ? `${dnsMs.toFixed(1)} ms` : "N/A"}
              </span>
              {dnsMs != null && (
                <Badge
                  variant={dnsMs < 50 ? "secondary" : "destructive"}
                  className="text-[10px]"
                >
                  {dnsMs < 10 ? "Cached" : dnsMs < 50 ? "Good" : dnsMs < 200 ? "Slow" : "Very Slow"}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Interface</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-lg font-bold font-mono">
              {latest?.interface_name || "Unknown"}
            </span>
            {interfaceThroughput && (
              <div className="mt-1 text-xs text-muted-foreground font-mono">
                {interfaceThroughput.rxRate} down / {interfaceThroughput.txRate} up
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Interface byte counters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Transferred</CardTitle>
          <CardDescription>
            Total bytes through {latest?.interface_name || "primary interface"} since boot
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-muted-foreground">Total Downloaded</span>
              <div className="text-lg font-bold font-mono">
                {latest?.interface_rx_bytes ? formatBytes(latest.interface_rx_bytes) : "N/A"}
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Total Uploaded</span>
              <div className="text-lg font-bold font-mono">
                {latest?.interface_tx_bytes ? formatBytes(latest.interface_tx_bytes) : "N/A"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* UPnP Router Data */}
      {(latest?.physical_link_status || latest?.downstream_max_bps) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Router-Reported Speeds</CardTitle>
            <CardDescription>
              Auto-discovered from your router via UPnP
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <span className="text-xs text-muted-foreground">Reported Speed</span>
                <div className="font-mono font-bold mt-1">
                  {latest.downstream_max_bps
                    ? `${(latest.downstream_max_bps / 1_000_000).toFixed(0)}`
                    : "?"}{" "}
                  / {latest.upstream_max_bps
                    ? `${(latest.upstream_max_bps / 1_000_000).toFixed(0)}`
                    : "?"}{" "}
                  <span className="text-sm font-normal text-muted-foreground">Mbps</span>
                </div>
                {upnpSpeedMismatch && (
                  <Badge variant="destructive" className="text-[10px] mt-1">
                    Mismatch — measured {measuredMaxMbps.toFixed(0)} Mbps
                  </Badge>
                )}
              </div>
              <div>
                <span className="text-xs text-muted-foreground">WAN Link</span>
                <div className="flex items-center gap-2 mt-1">
                  <div className={`h-2.5 w-2.5 rounded-full ${latest.physical_link_status === "Up" ? "bg-success" : "bg-destructive"}`} />
                  <span className="font-mono font-bold">{latest.physical_link_status || "?"}</span>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Connection Uptime</span>
                <div className="font-mono font-bold mt-1">
                  {latest.connection_uptime_sec ? formatDuration(latest.connection_uptime_sec) : "N/A"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Technical details — collapsible */}
      <details>
        <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
          Technical details (IPs, raw counters)
        </summary>
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">External IP</span>
              <div className="font-mono text-xs text-muted-foreground">{latest?.external_ip || "Unknown"}</div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Gateway IP</span>
              <div className="font-mono text-xs text-muted-foreground">{latest?.gateway_ip || "Unknown"}</div>
            </div>
          </div>
        </div>
      </details>

      {/* History table — paginated */}
      {historyArr.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent History</CardTitle>
              <span className="text-xs text-muted-foreground font-mono">{historyArr.length} entries</span>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead className="h-8 px-2">Time</TableHead>
                  <TableHead className="h-8 px-2 text-right">DNS</TableHead>
                  <TableHead className="h-8 px-2 text-right">Downloaded</TableHead>
                  <TableHead className="h-8 px-2 text-right">Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyArr
                  .slice(-10)
                  .reverse()
                  .map((r: any) => {
                    const dnsMs = r.dns_resolve_ms;
                    const isDnsAnomaly = dnsMs != null && dnsMs > 50;
                    const isDnsSevere = dnsMs != null && dnsMs > 100;
                    return (
                      <TableRow
                        key={r.id}
                        className={`text-xs font-mono ${isDnsSevere ? "bg-destructive/5" : ""}`}
                      >
                        <TableCell className="px-2 py-1.5 text-muted-foreground">
                          {r.timestamp?.slice(11, 19)}
                        </TableCell>
                        <TableCell className={`px-2 py-1.5 text-right ${isDnsSevere ? "text-destructive font-semibold" : isDnsAnomaly ? "text-warning font-semibold" : ""}`}>
                          {dnsMs !== null && dnsMs !== undefined ? `${dnsMs.toFixed(1)}ms` : "—"}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right">
                          {r.interface_rx_bytes ? formatBytes(r.interface_rx_bytes) : "—"}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right">
                          {r.interface_tx_bytes ? formatBytes(r.interface_tx_bytes) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatRate(bytesPerSec: number): string {
  const bps = bytesPerSec * 8;
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}

function computeInterfaceThroughput(history: any[]): { rxRate: string; txRate: string } | null {
  if (history.length < 2) return null;
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  if (!prev?.interface_rx_bytes || !curr?.interface_rx_bytes || !prev?.interface_tx_bytes || !curr?.interface_tx_bytes || !prev?.timestamp || !curr?.timestamp) return null;
  const dtMs = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
  if (dtMs <= 0) return null;
  const dtSec = dtMs / 1000;
  const rxRate = (curr.interface_rx_bytes - prev.interface_rx_bytes) / dtSec;
  const txRate = (curr.interface_tx_bytes - prev.interface_tx_bytes) / dtSec;
  if (rxRate < 0 || txRate < 0) return null;
  return { rxRate: formatRate(rxRate), txRate: formatRate(txRate) };
}
