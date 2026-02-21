import { Metadata } from "next";
import {
  fetchTracerouteLatest,
  fetchTracerouteHistory,
  fetchRipeAtlasLatest,
  timeframeToSince,
} from "@/lib/collector";
import {
  DESTINATION_LABELS,
  RIPE_SHARED_DESTINATIONS,
} from "@isp/shared";
import { VerdictCard, type VerdictStatus } from "@/components/dashboard/verdict-card";
import { MultiPeerComparison, SinglePath } from "@/components/charts/traceroute-path";
import { TracerouteTopology } from "@/components/charts/traceroute-topology";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Network Path" };

const MAX_HOPS = 30;

/** Home-network private IPs — gateway/LAN addresses that exist on every network.
 *  192.168.x.x and 10.x.x.x are always home-side.
 *  172.16-31.x.x is NOT excluded — ISPs commonly use it for backbone infrastructure.
 */
function isHomeNetworkIP(ip: string): boolean {
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("169.254.")) return true; // link-local
  return false;
}

function parseRipeHops(rawJson: string) {
  try {
    const data = JSON.parse(rawJson);
    const result = data.result || [];
    return result
      .filter((h: any) => h.hop <= MAX_HOPS)
      .map((h: any) => {
        const responding = (h.result || []).filter((r: any) => r.from);
        const rtts = (h.result || [])
          .filter((r: any) => r.rtt != null && r.rtt > 0)
          .map((r: any) => r.rtt as number);
        const avgRtt = rtts.length > 0 ? rtts.reduce((a: number, b: number) => a + b, 0) / rtts.length : null;
        const first = responding[0];
        return {
          hop_number: h.hop,
          ip: first?.from || null,
          hostname: null,
          rtt_ms: avgRtt,
        };
      });
  } catch {
    return [];
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default async function TraceroutePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const since = timeframeToSince(t);

  const [latest, history, ripeAtlas] = await Promise.all([
    fetchTracerouteLatest(),
    fetchTracerouteHistory(since),
    fetchRipeAtlasLatest(),
  ]);

  // Index our traceroutes by destination
  const ourByDest = new Map<string, any>();
  for (const tr of latest || []) {
    ourByDest.set(tr.destination, tr);
  }

  // Collect peer paths
  const peersByDest = new Map<string, Array<{ probeId: number; hops: any[] }>>();
  const seenPeerKeys = new Set<string>();
  for (const r of ripeAtlas || []) {
    const hops = parseRipeHops(r.raw_json || "");
    if (hops.length === 0) continue;
    const key = `${r.probe_id}:${r.destination}`;
    if (seenPeerKeys.has(key)) continue;
    seenPeerKeys.add(key);
    if (!peersByDest.has(r.destination)) peersByDest.set(r.destination, []);
    peersByDest.get(r.destination)!.push({ probeId: r.probe_id, hops });
  }

  // Split destinations
  const sharedDests: string[] = [];
  const ourOnlyDests: string[] = [];
  for (const dest of ourByDest.keys()) {
    if (RIPE_SHARED_DESTINATIONS.has(dest) && peersByDest.has(dest) && peersByDest.get(dest)!.length > 0) {
      sharedDests.push(dest);
    } else {
      ourOnlyDests.push(dest);
    }
  }

  // Path stability
  const pathChanges = new Map<string, Set<string>>();
  for (const tr of history || []) {
    if (!pathChanges.has(tr.destination)) pathChanges.set(tr.destination, new Set());
    pathChanges.get(tr.destination)!.add(tr.path_hash);
  }

  // Unique probes
  const allProbeIds = new Set<number>();
  for (const peers of peersByDest.values()) {
    for (const p of peers) allProbeIds.add(p.probeId);
  }

  // Verdict
  const hasMultiplePaths = Array.from(pathChanges.values()).some((s) => s.size > 2);
  let verdictStatus: VerdictStatus = "healthy";
  if (hasMultiplePaths) verdictStatus = "degraded";

  // Compute aggregate stats for verdict metrics — count public (non-private) hops only
  const allOurHopCounts = sharedDests.map((dest) => {
    const ours = ourByDest.get(dest);
    return (ours?.hops || []).filter((h: any) => h.ip && !isHomeNetworkIP(h.ip)).length;
  });
  const avgOurHops = allOurHopCounts.length > 0
    ? (allOurHopCounts.reduce((a: number, b: number) => a + b, 0) / allOurHopCounts.length).toFixed(0)
    : "?";

  const totalPathVariants = Array.from(pathChanges.values()).reduce((sum, s) => sum + s.size, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Network Path</h1>
        <p className="text-sm text-muted-foreground">
          The route your data takes across the internet, compared with{" "}
          {allProbeIds.size > 0 ? `${allProbeIds.size} ` : ""}
          other users on your ISP
        </p>
      </div>

      {/* Verdict */}
      <VerdictCard
        status={verdictStatus}
        headline={
          verdictStatus === "healthy"
            ? "Your network path is normal"
            : "Route changes detected"
        }
        description={
          verdictStatus === "healthy"
            ? "Your data takes a typical route with stable performance compared to other users on the same ISP."
            : `Multiple route changes detected across your monitored destinations. This may indicate ISP routing instability.`
        }
        metrics={[
          { label: "Your Avg Hops", value: avgOurHops },
          { label: "Destinations", value: String(ourByDest.size) },
          { label: "Peers", value: String(allProbeIds.size) },
        ]}
      />

      {/* Summary cards — path stability */}
      {sharedDests.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {sharedDests.map((dest) => {
            const ours = ourByDest.get(dest);
            const peers = peersByDest.get(dest) || [];
            const ourRespondingHops = (ours?.hops || []).filter((h: any) => h.ip);
            const ourPublicHops = ourRespondingHops.filter((h: any) => !isHomeNetworkIP(h.ip));
            const ourRtt = ourRespondingHops.length > 0 ? ourRespondingHops[ourRespondingHops.length - 1]?.rtt_ms : null;
            const pathCount = pathChanges.get(dest)?.size || 0;
            const peerHopCounts = peers.map((p) => p.hops.filter((h: any) => h.ip && !isHomeNetworkIP(h.ip)).length);
            const peerLastRtts = peers
              .map((p) => {
                const resp = p.hops.filter((h: any) => h.ip && h.rtt_ms != null);
                return resp.length > 0 ? resp[resp.length - 1].rtt_ms : null;
              })
              .filter((r: any): r is number => r != null);
            const medianHops = peerHopCounts.length > 0 ? median(peerHopCounts) : null;
            const medianRtt = peerLastRtts.length > 0 ? median(peerLastRtts) : null;

            return (
              <Card key={dest}>
                <CardContent className="pt-4 space-y-2">
                  <div className="text-xs font-medium">
                    {DESTINATION_LABELS[dest] || dest}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">You:</span>{" "}
                      <span className="font-mono font-semibold">{ourPublicHops.length}</span>
                      <span className="text-muted-foreground"> hops</span>
                      {ourRtt != null && (
                        <span className="font-mono text-muted-foreground"> / {ourRtt.toFixed(0)}ms</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Peers ({peers.length}):</span>{" "}
                      {medianHops != null && (
                        <>
                          <span className="font-mono font-semibold">{medianHops.toFixed(0)}</span>
                          <span className="text-muted-foreground"> hops</span>
                        </>
                      )}
                      {medianRtt != null && (
                        <span className="font-mono text-muted-foreground"> / {medianRtt.toFixed(0)}ms</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {pathCount <= 1 ? (
                      <Badge variant="secondary" className="text-[10px]">STABLE</Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">{pathCount} ROUTES</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {peers.length} peer{peers.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Tabbed topology + comparison */}
      {sharedDests.length > 0 ? (
        <Tabs defaultValue={sharedDests[0]}>
          <TabsList>
            {sharedDests.map((dest) => (
              <TabsTrigger key={dest} value={dest}>
                {DESTINATION_LABELS[dest] || dest}
              </TabsTrigger>
            ))}
          </TabsList>
          {sharedDests.map((dest) => {
            const ours = ourByDest.get(dest);
            const peers = peersByDest.get(dest) || [];
            return (
              <TabsContent key={dest} value={dest} className="mt-4 space-y-4">
                <TracerouteTopology
                  destination={dest}
                  yours={ours?.hops || []}
                  peers={peers}
                />
                <MultiPeerComparison
                  destination={dest}
                  yours={ours?.hops || []}
                  peers={peers}
                />
              </TabsContent>
            );
          })}
        </Tabs>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting for comparison data</CardTitle>
            <CardDescription>
              Traceroutes to shared destinations will appear after the next collection cycle.
              Peer data is collected hourly from independent network probes.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Our-only destinations — collapsed */}
      {ourOnlyDests.length > 0 && (
        <details>
          <summary className="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground">
            Additional Paths ({ourOnlyDests.length} destinations, no peer comparison)
          </summary>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            {ourOnlyDests.map((dest) => {
              const tr = ourByDest.get(dest);
              return (
                <SinglePath
                  key={dest}
                  destination={dest}
                  hops={tr?.hops || []}
                />
              );
            })}
          </div>
        </details>
      )}

      {/* Path stability — compact */}
      {pathChanges.size > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Route Stability</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Array.from(pathChanges.entries()).map(([dest, hashes]) => (
                <div key={dest} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground truncate">
                    {DESTINATION_LABELS[dest] || dest}
                  </span>
                  {hashes.size === 1 ? (
                    <Badge variant="secondary" className="text-[10px]">1 route</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">{hashes.size} routes</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
