import { Metadata } from "next";
import { fetchRouterLatest, fetchRouterHistory, fetchThroughputLatest, timeframeToSince } from "@/lib/collector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

  // Cross-reference: UPnP Layer 1 speed vs actual measured throughput
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

  // Compute interface throughput from consecutive readings
  const interfaceThroughput = computeInterfaceThroughput(historyArr);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Network Status</h1>
        <p className="text-sm text-muted-foreground">
          External connectivity, gateway, DNS performance, and interface counters
        </p>
      </div>

      {/* Primary status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">External IP</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-lg font-bold font-mono">
              {latest?.external_ip || "Unknown"}
            </span>
            {latest?.cf_colo && (
              <div className="mt-1">
                <Badge variant="secondary" className="text-[10px]">
                  CF Colo: {latest.cf_colo}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Default Gateway</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-lg font-bold font-mono">
              {latest?.gateway_ip || "Unknown"}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">DNS Resolve Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono">
                {latest?.dns_resolve_ms !== null && latest?.dns_resolve_ms !== undefined
                  ? `${latest.dns_resolve_ms.toFixed(1)} ms`
                  : "N/A"}
              </span>
              {latest?.dns_resolve_ms !== null && latest?.dns_resolve_ms !== undefined && (
                <Badge
                  variant={latest.dns_resolve_ms < 50 ? "secondary" : "destructive"}
                  className="text-[10px]"
                >
                  {latest.dns_resolve_ms < 10
                    ? "Cached"
                    : latest.dns_resolve_ms < 50
                      ? "Good"
                      : latest.dns_resolve_ms < 200
                        ? "Slow"
                        : "Very Slow"}
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
          <CardTitle className="text-base">Interface Counters</CardTitle>
          <CardDescription>
            Total bytes through {latest?.interface_name || "primary interface"} since boot
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-muted-foreground">Total Received</span>
              <div className="text-lg font-bold font-mono">
                {latest?.interface_rx_bytes
                  ? formatBytes(latest.interface_rx_bytes)
                  : "N/A"}
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Total Sent</span>
              <div className="text-lg font-bold font-mono">
                {latest?.interface_tx_bytes
                  ? formatBytes(latest.interface_tx_bytes)
                  : "N/A"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* UPnP Router Data (auto-discovered via SSDP) */}
      {(latest?.physical_link_status || latest?.downstream_max_bps) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">UPnP Router Status</CardTitle>
            <CardDescription>
              Auto-discovered via SSDP from the gateway&apos;s UPnP IGD service
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span className="text-xs text-muted-foreground">WAN Link</span>
                <div className="flex items-center gap-2 mt-1">
                  <div
                    className={`h-3 w-3 rounded-full ${
                      latest.physical_link_status === "Up"
                        ? "bg-success"
                        : "bg-destructive"
                    }`}
                  />
                  <span className="font-mono font-bold">
                    {latest.physical_link_status || "?"}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Layer 1 Speed (UPnP)</span>
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
                  <div className="mt-1">
                    <Badge variant="outline" className="text-[10px]">
                      Mismatch — measured {measuredMaxMbps.toFixed(0)} Mbps
                    </Badge>
                  </div>
                )}
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Connection Uptime</span>
                <div className="font-mono font-bold mt-1">
                  {latest.connection_uptime_sec
                    ? formatDuration(latest.connection_uptime_sec)
                    : "N/A"}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">WAN Bytes (UPnP)</span>
                <div className="font-mono font-bold mt-1 text-sm">
                  {latest.total_bytes_received
                    ? `${formatBytes(latest.total_bytes_received)} RX`
                    : "N/A"}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {latest.total_bytes_sent
                    ? `${formatBytes(latest.total_bytes_sent)} TX`
                    : ""}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History table */}
      {historyArr.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead className="h-8 px-2">Time</TableHead>
                  <TableHead className="h-8 px-2">External IP</TableHead>
                  <TableHead className="h-8 px-2">Gateway</TableHead>
                  <TableHead className="h-8 px-2 text-right">DNS</TableHead>
                  <TableHead className="h-8 px-2 text-right">RX Total</TableHead>
                  <TableHead className="h-8 px-2 text-right">TX Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyArr
                  .slice(-20)
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
                        <TableCell className="px-2 py-1.5">
                          {r.external_ip || "—"}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-muted-foreground">
                          {r.gateway_ip || "—"}
                        </TableCell>
                        <TableCell className={`px-2 py-1.5 text-right ${isDnsSevere ? "text-destructive font-semibold" : isDnsAnomaly ? "text-warning font-semibold" : ""}`}>
                          {dnsMs !== null && dnsMs !== undefined
                            ? `${dnsMs.toFixed(1)}ms`
                            : "—"}
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

/** Compute recent throughput rate from the last two history entries */
function computeInterfaceThroughput(
  history: any[]
): { rxRate: string; txRate: string } | null {
  if (history.length < 2) return null;

  const prev = history[history.length - 2];
  const curr = history[history.length - 1];

  if (
    !prev?.interface_rx_bytes || !curr?.interface_rx_bytes ||
    !prev?.interface_tx_bytes || !curr?.interface_tx_bytes ||
    !prev?.timestamp || !curr?.timestamp
  ) {
    return null;
  }

  const dtMs =
    new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
  if (dtMs <= 0) return null;

  const dtSec = dtMs / 1000;
  const rxRate = (curr.interface_rx_bytes - prev.interface_rx_bytes) / dtSec;
  const txRate = (curr.interface_tx_bytes - prev.interface_tx_bytes) / dtSec;

  // Negative values mean counter wrapped or interface changed
  if (rxRate < 0 || txRate < 0) return null;

  return { rxRate: formatRate(rxRate), txRate: formatRate(txRate) };
}
