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
import { MultiPeerComparison, SinglePath } from "@/components/charts/traceroute-path";
import { TracerouteTopology } from "@/components/charts/traceroute-topology";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Traceroute Analysis" };

/** Max hop number to consider — matches our traceroute `-m 30` */
const MAX_HOPS = 30;

/** Parse RIPE Atlas raw_json into hop array, capped at MAX_HOPS */
function parseRipeHops(rawJson: string) {
  try {
    const data = JSON.parse(rawJson);
    const result = data.result || [];
    return result
      .filter((h: any) => h.hop <= MAX_HOPS) // drop hop 255 late-reply entries
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

  // Collect ALL peer paths per destination (every probe, every result)
  const peersByDest = new Map<string, Array<{ probeId: number; hops: any[] }>>();
  const seenPeerKeys = new Set<string>(); // dedup: probe+dest
  for (const r of ripeAtlas || []) {
    const hops = parseRipeHops(r.raw_json || "");
    if (hops.length === 0) continue;
    // Keep the most recent result per (probe, destination) pair
    const key = `${r.probe_id}:${r.destination}`;
    if (seenPeerKeys.has(key)) continue;
    seenPeerKeys.add(key);

    if (!peersByDest.has(r.destination)) {
      peersByDest.set(r.destination, []);
    }
    peersByDest.get(r.destination)!.push({ probeId: r.probe_id, hops });
  }

  // Split destinations into: shared (both us and peers) vs ours-only
  const sharedDests: string[] = [];
  const ourOnlyDests: string[] = [];
  for (const dest of ourByDest.keys()) {
    if (RIPE_SHARED_DESTINATIONS.has(dest) && peersByDest.has(dest) && peersByDest.get(dest)!.length > 0) {
      sharedDests.push(dest);
    } else {
      ourOnlyDests.push(dest);
    }
  }

  // Path stability check
  const pathChanges = new Map<string, Set<string>>();
  for (const tr of history || []) {
    if (!pathChanges.has(tr.destination)) {
      pathChanges.set(tr.destination, new Set());
    }
    pathChanges.get(tr.destination)!.add(tr.path_hash);
  }

  // Total unique probes across all destinations
  const allProbeIds = new Set<number>();
  for (const peers of peersByDest.values()) {
    for (const p of peers) {
      allProbeIds.add(p.probeId);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Traceroute Comparison</h1>
        <p className="text-sm text-muted-foreground">
          Your paths compared with {allProbeIds.size > 0 ? `${allProbeIds.size} ` : ""}
          RIPE Atlas peers on the same network, tracing to the same destinations
        </p>
      </div>

      {/* Comparison summary cards */}
      {sharedDests.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {sharedDests.map((dest) => {
            const ours = ourByDest.get(dest);
            const peers = peersByDest.get(dest) || [];
            const ourHops = (ours?.hops || []).filter((h: any) => h.ip);
            const ourRtt = ourHops.length > 0 ? ourHops[ourHops.length - 1]?.rtt_ms : null;
            const pathCount = pathChanges.get(dest)?.size || 0;

            // Aggregate peer stats
            const peerHopCounts = peers.map((p) => p.hops.filter((h: any) => h.ip).length);
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
                  <div className="text-xs text-muted-foreground font-mono">
                    {DESTINATION_LABELS[dest] || dest}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">You:</span>{" "}
                      <span className="font-mono font-semibold">{ourHops.length}</span>
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
                      <Badge variant="destructive" className="text-[10px]">{pathCount} PATHS</Badge>
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

      {/* Topology diagrams */}
      {sharedDests.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            Path Topology — your path vs. peer consensus
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sharedDests.map((dest) => {
              const ours = ourByDest.get(dest);
              const peers = peersByDest.get(dest) || [];
              return (
                <TracerouteTopology
                  key={dest}
                  destination={dest}
                  yours={ours?.hops || []}
                  peers={peers}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-peer path comparisons (detailed table) */}
      {sharedDests.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            Path Details — hop-by-hop comparison
          </h2>
          {sharedDests.map((dest) => {
            const ours = ourByDest.get(dest);
            const peers = peersByDest.get(dest) || [];
            return (
              <MultiPeerComparison
                key={dest}
                destination={dest}
                yours={ours?.hops || []}
                peers={peers}
              />
            );
          })}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting for comparison data</CardTitle>
            <CardDescription>
              Traceroutes to RIPE measurement destinations will appear after the next collection cycle.
              Peer data is collected hourly from RIPE Atlas probes.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Our-only destinations */}
      {ourOnlyDests.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            Additional Paths (no peer comparison)
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
        </div>
      )}

      {/* Path stability */}
      {pathChanges.size > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Path Stability</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Array.from(pathChanges.entries()).map(([dest, hashes]) => (
                <div key={dest} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground truncate">
                    {DESTINATION_LABELS[dest] || dest}
                  </span>
                  {hashes.size === 1 ? (
                    <Badge variant="secondary" className="text-[10px]">1 path</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">{hashes.size} paths</Badge>
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
