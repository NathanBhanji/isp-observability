import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PING_TARGETS, DESTINATION_LABELS } from "@isp/shared";

const MONITORED_IP_SET = new Set<string>(PING_TARGETS.map((t) => t.ip));
const IP_TO_LABEL = new Map<string, string>(PING_TARGETS.map((t) => [t.ip, t.label]));

const MAX_DISPLAY_HOPS = 30;

// ── Types ────────────────────────────────────────────────────

interface Hop {
  hop_number: number;
  ip: string | null;
  hostname?: string | null;
  rtt_ms: number | null;
}

interface PeerPath {
  probeId: number;
  hops: Hop[];
}

interface MultiPeerComparisonProps {
  destination: string;
  yours: Hop[];
  peers: PeerPath[];
}

interface SinglePathProps {
  destination: string;
  hops: Hop[];
  probeId?: number;
}

// ── Helpers ──────────────────────────────────────────────────

function destLabel(ip: string): string {
  return DESTINATION_LABELS[ip] || ip;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Collapse consecutive dark (no-IP) hops into summary entries */
function collapseForSingle(hops: Hop[]): (Hop & { _collapsed?: boolean; count?: number })[] {
  const result: any[] = [];
  let darkRun = 0;
  let darkStart = 0;

  for (const hop of hops) {
    if (!hop.ip) {
      if (darkRun === 0) darkStart = hop.hop_number;
      darkRun++;
    } else {
      if (darkRun > 0) {
        result.push({ _collapsed: true, hop_number: darkStart, count: darkRun, ip: null, rtt_ms: null });
        darkRun = 0;
      }
      result.push(hop);
    }
  }
  if (darkRun > 0) {
    result.push({ _collapsed: true, hop_number: darkStart, count: darkRun, ip: null, rtt_ms: null });
  }
  return result;
}

// ── Aggregate hop data from all peers ────────────────────────

interface HopAggregate {
  /** IPs seen at this hop across all peers, with frequency and RTT stats */
  ips: Array<{
    ip: string;
    count: number;
    rtts: number[];
    medianRtt: number | null;
    probeIds: number[];
  }>;
  /** Total peers that have a responding hop at this number */
  respondingPeers: number;
  /** Total peers that have a dark hop here */
  darkPeers: number;
  /** Total peers with any entry at this hop */
  totalPeers: number;
}

function aggregatePeerHops(peers: PeerPath[], maxHop: number): Map<number, HopAggregate> {
  const agg = new Map<number, HopAggregate>();

  for (let h = 1; h <= maxHop; h++) {
    const ipMap = new Map<string, { count: number; rtts: number[]; probeIds: number[] }>();
    let responding = 0;
    let dark = 0;
    let total = 0;

    for (const peer of peers) {
      const hop = peer.hops.find((ph) => ph.hop_number === h);
      if (!hop) continue;
      total++;
      if (hop.ip) {
        responding++;
        const entry = ipMap.get(hop.ip) || { count: 0, rtts: [], probeIds: [] };
        entry.count++;
        if (hop.rtt_ms != null) entry.rtts.push(hop.rtt_ms);
        entry.probeIds.push(peer.probeId);
        ipMap.set(hop.ip, entry);
      } else {
        dark++;
      }
    }

    const ips = Array.from(ipMap.entries())
      .map(([ip, data]) => ({
        ip,
        count: data.count,
        rtts: data.rtts,
        medianRtt: data.rtts.length > 0 ? median(data.rtts) : null,
        probeIds: data.probeIds,
      }))
      .sort((a, b) => b.count - a.count); // most common first

    agg.set(h, { ips, respondingPeers: responding, darkPeers: dark, totalPeers: total });
  }

  return agg;
}

// ── Multi-Peer Comparison View ───────────────────────────────

export function MultiPeerComparison({ destination, yours, peers }: MultiPeerComparisonProps) {
  const peerCount = peers.length;
  const yoursCapped = yours.filter((h) => h.hop_number <= MAX_DISPLAY_HOPS);

  // Cap peer hops
  const peersCapped: PeerPath[] = peers.map((p) => ({
    probeId: p.probeId,
    hops: p.hops.filter((h) => h.hop_number <= MAX_DISPLAY_HOPS),
  }));

  // Max hop across all paths
  const allHopNums = [
    ...yoursCapped.map((h) => h.hop_number),
    ...peersCapped.flatMap((p) => p.hops.map((h) => h.hop_number)),
  ];
  const maxHop = Math.min(MAX_DISPLAY_HOPS, allHopNums.length > 0 ? Math.max(...allHopNums) : 0);

  const yoursMap = new Map(yoursCapped.map((h) => [h.hop_number, h]));
  const peerAgg = aggregatePeerHops(peersCapped, maxHop);

  // Your stats
  const yourResponding = yoursCapped.filter((h) => h.ip);
  const yourLastRtt = yourResponding.length > 0
    ? yourResponding[yourResponding.length - 1]?.rtt_ms : null;

  // Peer aggregate stats
  const peerHopCounts = peersCapped.map((p) => p.hops.filter((h) => h.ip).length);
  const peerLastRtts = peersCapped
    .map((p) => {
      const resp = p.hops.filter((h) => h.ip && h.rtt_ms != null);
      return resp.length > 0 ? resp[resp.length - 1].rtt_ms! : null;
    })
    .filter((r): r is number => r != null);
  const medianPeerHops = peerHopCounts.length > 0 ? median(peerHopCounts) : null;
  const medianPeerRtt = peerLastRtts.length > 0 ? median(peerLastRtts) : null;

  // IPs that appear in your path AND at least one peer's path (at any hop)
  const yourIPs = new Set(yourResponding.map((h) => h.ip!));
  const allPeerIPs = new Set<string>();
  for (const p of peersCapped) {
    for (const h of p.hops) {
      if (h.ip) allPeerIPs.add(h.ip);
    }
  }
  const sharedIPs = new Set([...yourIPs].filter((ip) => allPeerIPs.has(ip)));

  // For each shared IP, how many peers also have it?
  const sharedIPFrequency = new Map<string, number>();
  for (const ip of sharedIPs) {
    let count = 0;
    for (const p of peersCapped) {
      if (p.hops.some((h) => h.ip === ip)) count++;
    }
    sharedIPFrequency.set(ip, count);
  }

  // Build rows with dark-hop collapsing (dark = both you AND all peers are dark)
  type Row = {
    hop: number;
    yours: Hop | null;
    peerData: HopAggregate | undefined;
    allDark: boolean;
  };
  type DarkRange = { _darkRange: true; start: number; end: number; count: number };

  const rawRows: Row[] = [];
  for (let h = 1; h <= maxHop; h++) {
    const y = yoursMap.get(h) || null;
    const pd = peerAgg.get(h);
    const youDark = !y?.ip;
    const peersDark = !pd || pd.respondingPeers === 0;
    rawRows.push({ hop: h, yours: y, peerData: pd, allDark: youDark && peersDark });
  }

  const collapsed: (Row | DarkRange)[] = [];
  let darkStart = 0;
  let darkCount = 0;

  for (const row of rawRows) {
    if (row.allDark) {
      if (darkCount === 0) darkStart = row.hop;
      darkCount++;
    } else {
      if (darkCount > 0) {
        collapsed.push({ _darkRange: true, start: darkStart, end: darkStart + darkCount - 1, count: darkCount });
        darkCount = 0;
      }
      collapsed.push(row);
    }
  }
  if (darkCount > 0) {
    collapsed.push({ _darkRange: true, start: darkStart, end: darkStart + darkCount - 1, count: darkCount });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono">
            {destLabel(destination)}{" "}
            <span className="text-muted-foreground font-normal text-xs">{destination}</span>
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              {peerCount} peer{peerCount !== 1 ? "s" : ""}
            </Badge>
            {sharedIPs.size > 0 ? (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {sharedIPs.size} shared IP{sharedIPs.size !== 1 ? "s" : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px]">
                no shared IPs
              </Badge>
            )}
          </div>
        </div>
        {/* Summary stats */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground mt-1">
          <span>
            You: <strong className="text-foreground">{yourResponding.length}</strong> hops
            {yourLastRtt != null && <>, <strong className="text-foreground">{yourLastRtt.toFixed(1)}ms</strong> final</>}
          </span>
          <span>
            Peers ({peerCount}): median{" "}
            {medianPeerHops != null && <><strong className="text-foreground">{medianPeerHops.toFixed(0)}</strong> hops</>}
            {medianPeerRtt != null && <>, <strong className="text-foreground">{medianPeerRtt.toFixed(1)}ms</strong> final</>}
          </span>
          {yourLastRtt != null && medianPeerRtt != null && (
            <span>
              {"\u0394"} vs median:{" "}
              <strong className={cn(
                "text-foreground",
                Math.abs(yourLastRtt - medianPeerRtt) > 5 && "text-destructive"
              )}>
                {yourLastRtt > medianPeerRtt ? "+" : ""}{(yourLastRtt - medianPeerRtt).toFixed(1)}ms
              </strong>
            </span>
          )}
        </div>

        {/* Shared IPs summary */}
        {sharedIPs.size > 0 && (
          <div className="mt-2 rounded border border-border/50 p-2 space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground">
              IPs appearing in both your path and peer paths
            </div>
            {Array.from(sharedIPs)
              .sort((a, b) => (sharedIPFrequency.get(b) || 0) - (sharedIPFrequency.get(a) || 0))
              .map((ip) => {
                const label = IP_TO_LABEL.get(ip);
                const freq = sharedIPFrequency.get(ip) || 0;
                const pct = peerCount > 0 ? Math.round((freq / peerCount) * 100) : 0;
                const yourHop = yourResponding.find((h) => h.ip === ip);
                return (
                  <div key={ip} className="flex items-center gap-3 text-xs font-mono">
                    <span className={cn(
                      "text-foreground",
                      MONITORED_IP_SET.has(ip) && "font-semibold"
                    )}>
                      {ip}
                      {label && <span className="text-primary text-[10px] ml-1">{label}</span>}
                    </span>
                    <span className="text-muted-foreground">
                      your hop {yourHop?.hop_number}
                      {yourHop?.rtt_ms != null ? ` (${yourHop.rtt_ms.toFixed(1)}ms)` : ""}
                    </span>
                    <span className={cn(
                      "text-muted-foreground",
                      pct >= 80 && "text-primary",
                    )}>
                      {freq}/{peerCount} peers ({pct}%)
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </CardHeader>

      <CardContent>
        {/* Column headers */}
        <div className="grid grid-cols-[2rem_1fr_4rem_1fr_3rem] gap-x-2 px-1 py-1 text-[10px] font-medium text-muted-foreground border-b border-border mb-1">
          <span className="text-right">#</span>
          <span>Your Path</span>
          <span className="text-right">RTT</span>
          <span>Peer Consensus ({peerCount})</span>
          <span className="text-right">n</span>
        </div>

        {collapsed.map((item) => {
          if ("_darkRange" in item) {
            return (
              <div
                key={`dark-${item.start}`}
                className="grid grid-cols-[2rem_1fr] gap-x-2 px-1 py-0.5"
              >
                <span className="text-right text-[10px] text-muted-foreground/30 font-mono">
                  {item.count > 1 ? `${item.start}-${item.end}` : item.start}
                </span>
                <span className="text-[10px] text-muted-foreground/30 italic">
                  {item.count} dark hop{item.count > 1 ? "s" : ""} (all paths)
                </span>
              </div>
            );
          }

          const y = item.yours;
          const pd = item.peerData;
          const topIP = pd?.ips[0]; // most common peer IP at this hop
          const yourMatchesTop = y?.ip && topIP && y.ip === topIP.ip;
          const yourInPeers = y?.ip && pd?.ips.some((p) => p.ip === y!.ip);
          const yIsMonitored = y?.ip && MONITORED_IP_SET.has(y.ip);
          const yLabel = y?.ip ? IP_TO_LABEL.get(y.ip) : null;
          const topLabel = topIP?.ip ? IP_TO_LABEL.get(topIP.ip) : null;
          const topIsMonitored = topIP?.ip && MONITORED_IP_SET.has(topIP.ip);

          // How many peers have the same IP as you at this hop?
          const yourIPInPeers = y?.ip ? pd?.ips.find((p) => p.ip === y!.ip) : null;
          const matchCount = yourIPInPeers?.count || 0;

          return (
            <div
              key={`hop-${item.hop}`}
              className={cn(
                "grid grid-cols-[2rem_1fr_4rem_1fr_3rem] gap-x-2 px-1 py-1 rounded text-xs font-mono",
                yourMatchesTop && "bg-primary/5",
                !y?.ip && (!pd || pd.respondingPeers === 0) && "opacity-30",
              )}
            >
              <span className="text-right text-muted-foreground text-[11px]">
                {item.hop}
              </span>

              {/* Your IP */}
              <span className={cn(
                "truncate",
                yIsMonitored && "text-foreground font-semibold",
                yourInPeers && !yourMatchesTop && "text-primary",
                !y?.ip && "text-muted-foreground/40 italic",
              )}>
                {y?.ip || "*"}
                {yLabel && <span className="text-primary text-[10px] ml-1">{yLabel}</span>}
                {yourMatchesTop && <span className="text-primary/60 text-[10px] ml-1">=</span>}
                {yourInPeers && !yourMatchesTop && y?.ip && (
                  <span className="text-primary/60 text-[10px] ml-1">{"\u2248"}</span>
                )}
              </span>

              <span className="text-right text-muted-foreground">
                {y?.rtt_ms != null ? `${y.rtt_ms.toFixed(1)}` : "\u2014"}
              </span>

              {/* Peer consensus */}
              <div className="truncate">
                {topIP ? (
                  <span className={cn(
                    "text-muted-foreground",
                    topIsMonitored && "text-foreground font-semibold",
                  )}>
                    {topIP.ip}
                    {topLabel && <span className="text-primary text-[10px] ml-1">{topLabel}</span>}
                    <span className="text-muted-foreground/60 text-[10px] ml-1">
                      {topIP.medianRtt != null ? `${topIP.medianRtt.toFixed(1)}ms` : ""}
                    </span>
                    {pd!.ips.length > 1 && (
                      <span className="text-muted-foreground/40 text-[10px] ml-1">
                        +{pd!.ips.length - 1} other{pd!.ips.length > 2 ? "s" : ""}
                      </span>
                    )}
                  </span>
                ) : pd && pd.darkPeers > 0 ? (
                  <span className="text-muted-foreground/40 italic text-[11px]">
                    * ({pd.darkPeers} dark)
                  </span>
                ) : (
                  <span className="text-muted-foreground/40 italic text-[11px]">
                    {"\u2014"}
                  </span>
                )}
              </div>

              {/* Match count: how many peers share this IP */}
              <span className={cn(
                "text-right text-[11px]",
                matchCount > 0 && matchCount >= peerCount * 0.5 && "text-primary",
                matchCount > 0 && matchCount < peerCount * 0.5 && "text-muted-foreground",
                matchCount === 0 && "text-muted-foreground/30",
              )}>
                {y?.ip && pd ? (
                  matchCount > 0 ? `${matchCount}/${pd.totalPeers}` : `0/${pd.totalPeers}`
                ) : ""}
              </span>
            </div>
          );
        })}

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          <span><span className="text-primary">=</span> same IP as top peer consensus</span>
          <span><span className="text-primary">{"\u2248"}</span> your IP seen in some peer paths</span>
          <span><strong>n</strong> = peers matching your IP at this hop</span>
        </div>
      </CardContent>
    </Card>
  );
}


// ── Single Path View ─────────────────────────────────────────

export function SinglePath({ destination, hops, probeId }: SinglePathProps) {
  const collapsed = collapseForSingle(hops);
  const responding = hops.filter((h) => h.ip).length;
  const dark = hops.filter((h) => !h.ip).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono">
            {destLabel(destination)}{" "}
            <span className="text-muted-foreground font-normal text-xs">{destination}</span>
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {responding} hops
            </Badge>
            {dark > 0 && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {dark} dark
              </Badge>
            )}
            {probeId && (
              <Badge variant="outline" className="font-mono text-[10px]">
                probe {probeId}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-0">
          {collapsed.map((item: any, i: number) => {
            if (item._collapsed) {
              return (
                <div key={`dark-${item.hop_number}`} className="flex items-center gap-3 py-0.5">
                  <span className="w-6 text-right text-[10px] text-muted-foreground/30 font-mono">
                    {item.count > 1
                      ? `${item.hop_number}-${item.hop_number + item.count - 1}`
                      : item.hop_number}
                  </span>
                  <span className="text-[10px] text-muted-foreground/30 italic">
                    {item.count} dark hop{item.count > 1 ? "s" : ""}
                  </span>
                </div>
              );
            }

            const isMonitored = item.ip && MONITORED_IP_SET.has(item.ip);
            const hopLabel = item.ip ? IP_TO_LABEL.get(item.ip) : null;

            return (
              <div key={`hop-${item.hop_number}`} className="flex items-center gap-3 py-1">
                <span className="w-6 text-right text-xs text-muted-foreground font-mono">
                  {item.hop_number}
                </span>
                <div className="flex-1 flex items-center justify-between text-xs font-mono">
                  <span className={cn(isMonitored && "text-foreground font-semibold")}>
                    {item.ip}
                    {hopLabel && <span className="text-primary text-[10px] ml-1">{hopLabel}</span>}
                  </span>
                  {item.rtt_ms != null && (
                    <span className="text-muted-foreground">
                      {item.rtt_ms.toFixed(1)} ms
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
