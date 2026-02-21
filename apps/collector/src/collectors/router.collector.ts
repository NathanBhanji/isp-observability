import { INTERVALS } from "@isp/shared";
import type { Collector } from "../scheduler";
import { getDb } from "../db";
import { getNetworkDiagnostics } from "../lib/network-diagnostics";
import { queryRouterStatus } from "../lib/upnp";

export class RouterCollector implements Collector {
  name = "router";
  interval = INTERVALS.router;

  async collect(): Promise<string | void> {
    const db = getDb();
    const timestamp = new Date().toISOString();

    // Gather network diagnostics (always works — macOS + Linux)
    const diag = await getNetworkDiagnostics();

    // UPnP via auto-discovered SSDP endpoints (caches after first discovery)
    const upnp = await queryRouterStatus();

    db.prepare(`
      INSERT INTO router_status (
        timestamp, downstream_max_bps, upstream_max_bps,
        physical_link_status, connection_uptime_sec,
        total_bytes_received, total_bytes_sent,
        external_ip, gateway_ip, dns_resolve_ms,
        interface_name, interface_rx_bytes, interface_tx_bytes,
        cf_colo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      timestamp,
      upnp.downstreamMaxBps,
      upnp.upstreamMaxBps,
      upnp.physicalLinkStatus,
      upnp.connectionUptimeSec,
      upnp.totalBytesReceived,
      upnp.totalBytesSent,
      diag.externalIp,
      diag.gatewayIp,
      diag.dnsResolveMs,
      diag.interfaceName,
      diag.interfaceRxBytes,
      diag.interfaceTxBytes,
      diag.cfColo,
    );

    const upnpStr = upnp.physicalLinkStatus
      ? ` Link: ${upnp.physicalLinkStatus} ${upnp.downstreamMaxBps ? (upnp.downstreamMaxBps / 1_000_000).toFixed(0) + "Mbps" : ""}`
      : "";

    console.log(
      `[router] IP: ${diag.externalIp || "?"} ` +
        `GW: ${diag.gatewayIp || "?"} ` +
        `DNS: ${diag.dnsResolveMs !== null ? diag.dnsResolveMs.toFixed(1) + "ms" : "?"} ` +
        `Colo: ${diag.cfColo || "?"}` +
        upnpStr
    );

    // Warn if we couldn't get the external IP
    if (!diag.externalIp) {
      return "Could not determine external IP — check internet connectivity";
    }
  }
}
