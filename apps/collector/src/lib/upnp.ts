import dgram from "dgram";
import { ROUTER_IP } from "@isp/shared";

export interface RouterUPnPStatus {
  downstreamMaxBps: number | null;
  upstreamMaxBps: number | null;
  physicalLinkStatus: string | null;
  connectionUptimeSec: number | null;
  totalBytesReceived: number | null;
  totalBytesSent: number | null;
  externalIpViaUpnp: string | null;
  wanAccessType: string | null;
}

// ── Discovered service cache ─────────────────────────────────

interface DiscoveredServices {
  baseUrl: string;
  wanCommonControlUrl: string | null;
  wanIpConnControlUrl: string | null;
}

let cachedServices: DiscoveredServices | null = null;
let discoveryAttempted = false;

// ── SSDP Discovery ──────────────────────────────────────────

/**
 * Discover UPnP InternetGatewayDevice via SSDP M-SEARCH.
 * Returns the LOCATION URL of the device description, or null.
 */
async function ssdpDiscover(timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let resolved = false;

    const finish = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      try { socket.close(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    socket.on("error", () => finish(null));

    socket.on("message", (msg) => {
      const text = msg.toString();
      const location = text.match(/LOCATION:\s*(.+)/i)?.[1]?.trim();
      if (location && location.includes(ROUTER_IP)) {
        clearTimeout(timer);
        finish(location);
      }
    });

    const search =
      "M-SEARCH * HTTP/1.1\r\n" +
      "HOST: 239.255.255.250:1900\r\n" +
      'MAN: "ssdp:discover"\r\n' +
      "MX: 3\r\n" +
      "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n" +
      "\r\n";

    socket.bind(() => {
      socket.send(search, 1900, "239.255.255.250", (err) => {
        if (err) finish(null);
      });
    });
  });
}

/**
 * Fetch the UPnP device description XML and extract service control URLs.
 * Walks the nested device tree to find WANCommonInterfaceConfig and WANIPConnection.
 */
async function fetchServiceUrls(descriptionUrl: string): Promise<DiscoveredServices | null> {
  try {
    const res = await fetch(descriptionUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const xml = await res.text();

    // Extract URLBase (or derive from description URL)
    const urlBase =
      extractXmlValue(xml, "URLBase")?.replace(/\/+$/, "") ||
      descriptionUrl.replace(/\/[^/]*$/, "");

    // Find all services in the XML
    // We need WANCommonInterfaceConfig and WANIPConnection
    const wanCommon = extractControlUrl(
      xml,
      "urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1"
    );
    const wanIpConn = extractControlUrl(
      xml,
      "urn:schemas-upnp-org:service:WANIPConnection:1"
    );

    console.log(
      `[upnp] Discovered services — WANCommonIFC: ${wanCommon || "not found"}, ` +
        `WANIPConn: ${wanIpConn || "not found"}`
    );

    return {
      baseUrl: urlBase,
      wanCommonControlUrl: wanCommon,
      wanIpConnControlUrl: wanIpConn,
    };
  } catch (e) {
    console.warn("[upnp] Failed to fetch device description:", (e as Error).message);
    return null;
  }
}

/** Find the controlURL for a given serviceType in the XML. */
function extractControlUrl(xml: string, serviceType: string): string | null {
  // Find the <service> block containing this serviceType
  const serviceRegex = new RegExp(
    "<service>\\s*" +
      "<serviceType>" + escapeRegex(serviceType) + "</serviceType>" +
      "[\\s\\S]*?" +
      "<controlURL>([^<]+)</controlURL>" +
      "[\\s\\S]*?" +
      "</service>",
    "i"
  );
  const match = xml.match(serviceRegex);
  if (match) return match[1];

  // Fallback: serviceType might appear in different order within <service>
  const blocks = xml.split(/<service>/i);
  for (const block of blocks) {
    if (block.includes(serviceType)) {
      const ctrlMatch = block.match(/<controlURL>([^<]+)<\/controlURL>/i);
      if (ctrlMatch) return ctrlMatch[1];
    }
  }
  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Service discovery (with caching) ─────────────────────────

async function getServices(): Promise<DiscoveredServices | null> {
  if (cachedServices) return cachedServices;
  if (discoveryAttempted) return null; // Don't retry failed discovery every collection

  discoveryAttempted = true;

  console.log("[upnp] Running SSDP discovery...");
  const location = await ssdpDiscover();

  if (!location) {
    console.warn("[upnp] No InternetGatewayDevice found via SSDP");
    return null;
  }

  console.log(`[upnp] Found device at ${location}`);
  const services = await fetchServiceUrls(location);

  if (services) {
    cachedServices = services;
    console.log(`[upnp] Service URLs cached (base: ${services.baseUrl})`);
  }

  return services;
}

/** Allow re-discovery (e.g. after router reboot). */
export function resetUpnpCache(): void {
  cachedServices = null;
  discoveryAttempted = false;
}

// ── SOAP requests ────────────────────────────────────────────

const SOAP_TIMEOUT_MS = 8000;
const SOAP_MAX_RETRIES = 2; // Up to 3 total attempts
const SOAP_RETRY_DELAY_MS = 500;

async function soapRequest(
  baseUrl: string,
  controlPath: string,
  serviceType: string,
  action: string
): Promise<string> {
  const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}"></u:${action}>
  </s:Body>
</s:Envelope>`;

  const url = `${baseUrl}${controlPath}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= SOAP_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, SOAP_RETRY_DELAY_MS * attempt));
      }
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          SOAPAction: `"${serviceType}#${action}"`,
        },
        body,
        signal: AbortSignal.timeout(SOAP_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`UPnP SOAP ${action} error: ${response.status} (${url})`);
      }

      return await response.text();
    } catch (e) {
      lastError = e as Error;
      if (attempt < SOAP_MAX_RETRIES) {
        console.warn(`[upnp] SOAP ${action} attempt ${attempt + 1} failed, retrying: ${lastError.message}`);
      }
    }
  }

  throw lastError!;
}

/** Extract a value from XML SOAP response by tag name */
function extractXmlValue(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}>([^<]*)</${tagName}>`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

// ── Public API ───────────────────────────────────────────────

export interface WanTrafficCounters {
  bytesReceived: number | null;
  bytesSent: number | null;
}

/** Maximum value for UPnP 32-bit unsigned counters before they wrap. */
export const UPNP_COUNTER_MAX = 4_294_967_295; // 2^32 - 1

/**
 * Compute the delta between two 32-bit unsigned counter readings,
 * handling a single wrap-around correctly. Returns null if either is null.
 */
export function counterDelta(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  if (after >= before) return after - before;
  // Counter wrapped — assume exactly one wrap
  return (UPNP_COUNTER_MAX - before) + after + 1;
}

/**
 * Lightweight fetch of just the WAN byte counters (2 SOAP calls).
 * Much faster than the full `queryRouterStatus()` which makes 5 calls.
 * Used for snapshotting traffic before/after speed tests.
 */
export async function getWanTrafficCounters(): Promise<WanTrafficCounters> {
  const result: WanTrafficCounters = { bytesReceived: null, bytesSent: null };

  const services = await getServices();
  if (!services || !services.wanCommonControlUrl) return result;

  const { baseUrl, wanCommonControlUrl } = services;
  const svc = "urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1";

  // Run both SOAP calls in parallel for speed
  const [rxResult, txResult] = await Promise.allSettled([
    soapRequest(baseUrl, wanCommonControlUrl, svc, "GetTotalBytesReceived"),
    soapRequest(baseUrl, wanCommonControlUrl, svc, "GetTotalBytesSent"),
  ]);

  if (rxResult.status === "fulfilled") {
    const rx = extractXmlValue(rxResult.value, "NewTotalBytesReceived");
    if (rx) result.bytesReceived = parseInt(rx, 10);
  } else {
    console.warn("[upnp] getWanTrafficCounters RX failed:", rxResult.reason?.message);
  }

  if (txResult.status === "fulfilled") {
    const tx = extractXmlValue(txResult.value, "NewTotalBytesSent");
    if (tx) result.bytesSent = parseInt(tx, 10);
  } else {
    console.warn("[upnp] getWanTrafficCounters TX failed:", txResult.reason?.message);
  }

  return result;
}

/**
 * Query the router's UPnP status via auto-discovered SOAP endpoints.
 * Runs SSDP discovery on first call, then caches the service URLs.
 */
export async function queryRouterStatus(): Promise<RouterUPnPStatus> {
  const result: RouterUPnPStatus = {
    downstreamMaxBps: null,
    upstreamMaxBps: null,
    physicalLinkStatus: null,
    connectionUptimeSec: null,
    totalBytesReceived: null,
    totalBytesSent: null,
    externalIpViaUpnp: null,
    wanAccessType: null,
  };

  const services = await getServices();
  if (!services) return result;

  const { baseUrl, wanCommonControlUrl, wanIpConnControlUrl } = services;

  // ── WANCommonInterfaceConfig queries ──────────────────────

  if (wanCommonControlUrl) {
    const svc = "urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1";

    try {
      const linkProps = await soapRequest(baseUrl, wanCommonControlUrl, svc, "GetCommonLinkProperties");
      const downstream = extractXmlValue(linkProps, "NewLayer1DownstreamMaxBitRate");
      const upstream = extractXmlValue(linkProps, "NewLayer1UpstreamMaxBitRate");
      const linkStatus = extractXmlValue(linkProps, "NewPhysicalLinkStatus");
      const accessType = extractXmlValue(linkProps, "NewWANAccessType");

      if (downstream) result.downstreamMaxBps = parseInt(downstream, 10);
      if (upstream) result.upstreamMaxBps = parseInt(upstream, 10);
      if (linkStatus) result.physicalLinkStatus = linkStatus;
      if (accessType) result.wanAccessType = accessType;
    } catch (e) {
      console.warn("[upnp] GetCommonLinkProperties failed:", (e as Error).message);
    }

    try {
      const bytesRx = await soapRequest(baseUrl, wanCommonControlUrl, svc, "GetTotalBytesReceived");
      const rx = extractXmlValue(bytesRx, "NewTotalBytesReceived");
      if (rx) result.totalBytesReceived = parseInt(rx, 10);
    } catch (e) {
      console.warn("[upnp] GetTotalBytesReceived failed:", (e as Error).message);
    }

    try {
      const bytesTx = await soapRequest(baseUrl, wanCommonControlUrl, svc, "GetTotalBytesSent");
      const tx = extractXmlValue(bytesTx, "NewTotalBytesSent");
      if (tx) result.totalBytesSent = parseInt(tx, 10);
    } catch (e) {
      console.warn("[upnp] GetTotalBytesSent failed:", (e as Error).message);
    }
  }

  // ── WANIPConnection queries ──────────────────────────────

  if (wanIpConnControlUrl) {
    const svc = "urn:schemas-upnp-org:service:WANIPConnection:1";

    try {
      const statusInfo = await soapRequest(baseUrl, wanIpConnControlUrl, svc, "GetStatusInfo");
      const uptime = extractXmlValue(statusInfo, "NewUptime");
      if (uptime) result.connectionUptimeSec = parseInt(uptime, 10);
    } catch (e) {
      console.warn("[upnp] GetStatusInfo failed:", (e as Error).message);
    }

    try {
      const extIp = await soapRequest(baseUrl, wanIpConnControlUrl, svc, "GetExternalIPAddress");
      const ip = extractXmlValue(extIp, "NewExternalIPAddress");
      if (ip) result.externalIpViaUpnp = ip;
    } catch (e) {
      console.warn("[upnp] GetExternalIPAddress failed:", (e as Error).message);
    }
  }

  return result;
}
