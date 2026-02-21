"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DESTINATION_LABELS } from "@isp/shared";

interface TracerouteTopologyProps {
  destination: string;
  yours: any[];
  peers: { probeId: number; hops: any[] }[];
}

export function TracerouteTopology({ destination, yours, peers }: TracerouteTopologyProps) {
  const topology = useMemo(() => {
    if (!yours || yours.length === 0) return null;

    const maxHop = Math.max(
      ...yours.map((h: any) => h.hop_number),
      ...peers.flatMap((p) => p.hops.map((h: any) => h.hop_number))
    );

    // For each hop level, compute:
    // - Your IP + RTT
    // - Peer IP consensus (most common IP)
    // - Whether they match
    const levels: {
      hop: number;
      yourIp: string | null;
      yourRtt: number | null;
      peerIps: { ip: string; count: number }[];
      isDark: boolean;
      isShared: boolean;
    }[] = [];

    for (let h = 1; h <= maxHop; h++) {
      const yourHop = yours.find((hop: any) => hop.hop_number === h);
      const yourIp = yourHop?.ip || null;
      const yourRtt = yourHop?.rtt_ms || null;
      const isDark = !yourIp;

      // Count peer IPs at this hop
      const ipCounts = new Map<string, number>();
      for (const peer of peers) {
        const peerHop = peer.hops.find((hop: any) => hop.hop_number === h);
        if (peerHop?.ip) {
          ipCounts.set(peerHop.ip, (ipCounts.get(peerHop.ip) || 0) + 1);
        }
      }

      const peerIps = Array.from(ipCounts.entries())
        .map(([ip, count]) => ({ ip, count }))
        .sort((a, b) => b.count - a.count);

      const isShared = yourIp != null && peerIps.some((p) => p.ip === yourIp);

      levels.push({ hop: h, yourIp, yourRtt, peerIps, isDark, isShared });
    }

    return levels;
  }, [yours, peers]);

  if (!topology) return null;

  const destLabel = DESTINATION_LABELS[destination] || destination;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Path Topology — {destLabel}</CardTitle>
        <CardDescription>
          Your path (left) vs peer consensus (right). Connected nodes share the same IP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {topology.map((level) => {
            const topPeerIp = level.peerIps[0];
            return (
              <div key={level.hop} className="flex items-center gap-3 py-1">
                {/* Hop number */}
                <span className="text-[10px] font-mono text-muted-foreground w-6 text-right shrink-0">
                  {level.hop}
                </span>

                {/* Your node */}
                <div className={`flex-1 flex items-center gap-2 ${level.isDark ? "opacity-40" : ""}`}>
                  <div
                    className={`h-6 w-6 rounded-full flex items-center justify-center text-[8px] font-mono shrink-0 ${
                      level.isShared
                        ? "bg-success/20 border border-success/50"
                        : level.isDark
                          ? "bg-muted border border-border"
                          : "bg-primary/15 border border-primary/40"
                    }`}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-mono truncate">
                      {level.yourIp || "*"}
                    </span>
                    {level.yourRtt != null && (
                      <span className="text-[10px] text-muted-foreground">
                        {level.yourRtt.toFixed(1)}ms
                      </span>
                    )}
                  </div>
                </div>

                {/* Connection line */}
                <div className="w-12 flex items-center justify-center shrink-0">
                  {level.isShared ? (
                    <div className="h-px w-full bg-success/50" />
                  ) : level.yourIp && topPeerIp ? (
                    <div className="h-px w-full bg-border/50 border-dashed" />
                  ) : null}
                </div>

                {/* Peer consensus */}
                <div className="flex-1 flex items-center gap-2">
                  {topPeerIp ? (
                    <>
                      <div
                        className={`h-6 w-6 rounded-full flex items-center justify-center text-[8px] font-mono shrink-0 ${
                          level.isShared
                            ? "bg-success/20 border border-success/50"
                            : "bg-chart-5/15 border border-chart-5/40"
                        }`}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-mono truncate">
                          {topPeerIp.ip}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {topPeerIp.count}/{peers.length} peers
                          {level.peerIps.length > 1 && ` (+${level.peerIps.length - 1} other${level.peerIps.length > 2 ? "s" : ""})`}
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-success/20 border border-success/50" />
            <span className="text-[10px] text-muted-foreground">Shared hop</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-primary/15 border border-primary/40" />
            <span className="text-[10px] text-muted-foreground">Your path</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-chart-5/15 border border-chart-5/40" />
            <span className="text-[10px] text-muted-foreground">Peer consensus</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-muted border border-border" />
            <span className="text-[10px] text-muted-foreground">Dark hop</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
