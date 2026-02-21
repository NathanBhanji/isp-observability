/**
 * Network diagnostics that work on both macOS and Linux (including Docker).
 * Replaces the UPnP-based router collector which required specific router firmware support.
 */

export interface NetworkDiagnostics {
  externalIp: string | null;
  gatewayIp: string | null;
  dnsResolveMs: number | null;
  interfaceName: string | null;
  interfaceRxBytes: number | null;
  interfaceTxBytes: number | null;
  /** Cloudflare colo code — useful for ISP routing evidence */
  cfColo: string | null;
  /** AS number seen by Cloudflare */
  cfAsn: string | null;
}

/**
 * Gather network diagnostics from multiple sources.
 * Every step is independent and failure-tolerant.
 */
export async function getNetworkDiagnostics(): Promise<NetworkDiagnostics> {
  const [cfTrace, gateway, dns, iface] = await Promise.all([
    getCloudflareTrace(),
    getGatewayIp(),
    measureDnsResolve(),
    getInterfaceStats(),
  ]);

  return {
    externalIp: cfTrace.ip,
    gatewayIp: gateway,
    dnsResolveMs: dns,
    interfaceName: iface.name,
    interfaceRxBytes: iface.rxBytes,
    interfaceTxBytes: iface.txBytes,
    cfColo: cfTrace.colo,
    cfAsn: cfTrace.asn,
  };
}

// ── External IP via Cloudflare trace ──────────────────────────

async function getCloudflareTrace(): Promise<{
  ip: string | null;
  colo: string | null;
  asn: string | null;
}> {
  try {
    const res = await fetch("https://1.1.1.1/cdn-cgi/trace", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ip: null, colo: null, asn: null };
    const text = await res.text();

    const ip = text.match(/ip=(.+)/)?.[1]?.trim() ?? null;
    const colo = text.match(/colo=(.+)/)?.[1]?.trim() ?? null;
    // The trace doesn't include ASN directly, but we can get it from headers
    // or a separate lookup. For now, extract what's available.
    const asn = null;

    return { ip, colo, asn };
  } catch {
    return { ip: null, colo: null, asn: null };
  }
}

// ── Default gateway ──────────────────────────────────────────

async function getGatewayIp(): Promise<string | null> {
  try {
    if (process.platform === "darwin") {
      const proc = Bun.spawn(["route", "-n", "get", "default"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      const match = out.match(/gateway:\s*(\S+)/);
      return match ? match[1] : null;
    } else {
      // Linux: parse `ip route`
      const proc = Bun.spawn(["ip", "route", "show", "default"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      // Format: "default via 192.168.1.1 dev eth0 ..."
      const match = out.match(/default via (\S+)/);
      return match ? match[1] : null;
    }
  } catch {
    return null;
  }
}

// ── DNS resolution timing ────────────────────────────────────

async function measureDnsResolve(): Promise<number | null> {
  try {
    const start = performance.now();
    // Resolve a well-known hostname to measure DNS performance
    const proc = Bun.spawn(
      process.platform === "darwin"
        ? ["dscacheutil", "-q", "host", "-a", "name", "www.google.com"]
        : ["getent", "hosts", "www.google.com"],
      { stdout: "pipe", stderr: "pipe" }
    );
    await new Response(proc.stdout).text();
    await proc.exited;
    const elapsed = performance.now() - start;
    return Math.round(elapsed * 100) / 100;
  } catch {
    return null;
  }
}

// ── Network interface byte counters ──────────────────────────

async function getInterfaceStats(): Promise<{
  name: string | null;
  rxBytes: number | null;
  txBytes: number | null;
}> {
  const empty = { name: null, rxBytes: null, txBytes: null };

  try {
    if (process.platform === "linux") {
      return getInterfaceStatsLinux();
    } else if (process.platform === "darwin") {
      return getInterfaceStatsMacOS();
    }
    return empty;
  } catch {
    return empty;
  }
}

async function getInterfaceStatsLinux(): Promise<{
  name: string | null;
  rxBytes: number | null;
  txBytes: number | null;
}> {
  // Find the default route interface
  const routeProc = Bun.spawn(["ip", "route", "show", "default"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const routeOut = await new Response(routeProc.stdout).text();
  await routeProc.exited;

  const devMatch = routeOut.match(/dev\s+(\S+)/);
  const iface = devMatch ? devMatch[1] : "eth0";

  // Read byte counters from /proc/net/dev
  const file = Bun.file("/proc/net/dev");
  const content = await file.text();
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${iface}:`)) {
      // Format: iface: rx_bytes rx_packets ... tx_bytes tx_packets ...
      const parts = trimmed.split(/\s+/);
      const rxBytes = parseInt(parts[1], 10);
      const txBytes = parseInt(parts[9], 10);
      return {
        name: iface,
        rxBytes: isNaN(rxBytes) ? null : rxBytes,
        txBytes: isNaN(txBytes) ? null : txBytes,
      };
    }
  }

  return { name: iface, rxBytes: null, txBytes: null };
}

async function getInterfaceStatsMacOS(): Promise<{
  name: string | null;
  rxBytes: number | null;
  txBytes: number | null;
}> {
  // Use netstat -ib to get interface byte counters
  const proc = Bun.spawn(["netstat", "-ib"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  // Find en0 (primary interface)
  const lines = out.split("\n");
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    // netstat -ib columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
    if (parts[0] === "en0" && parts.length >= 11) {
      // Skip the link-level line, look for the IP line
      if (parts[2] && (parts[2].includes(".") || parts[2].includes(":"))) {
        continue; // This is a network/address line, skip
      }
      const rxBytes = parseInt(parts[6], 10);
      const txBytes = parseInt(parts[9], 10);
      if (!isNaN(rxBytes) && !isNaN(txBytes)) {
        return { name: "en0", rxBytes, txBytes };
      }
    }
  }

  return { name: "en0", rxBytes: null, txBytes: null };
}
