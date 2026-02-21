"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PING_TARGETS, TARGET_LABELS } from "@isp/shared";

interface LatencyHeatmapProps {
  data: any[];
}

export function LatencyHeatmap({ data }: LatencyHeatmapProps) {
  const heatmapData = useMemo(() => {
    if (!data || data.length === 0) return null;

    // Group by timestamp, then by target
    const timeMap = new Map<string, Record<string, number>>();
    
    for (const row of data) {
      const time = row.timestamp?.slice(11, 16) || ""; // HH:MM
      if (!timeMap.has(time)) {
        timeMap.set(time, {});
      }
      const point = timeMap.get(time)!;
      // Average if multiple entries for same time/target
      if (point[row.target_id] != null) {
        point[row.target_id] = (point[row.target_id] + (row.rtt_p50 ?? 0)) / 2;
      } else {
        point[row.target_id] = row.rtt_p50 ?? 0;
      }
    }

    const times = Array.from(timeMap.keys()).sort();
    const targets = PING_TARGETS.map((t) => t.id);

    // Find global max for color scaling
    let maxRtt = 0;
    for (const vals of timeMap.values()) {
      for (const rtt of Object.values(vals)) {
        if (rtt > maxRtt) maxRtt = rtt;
      }
    }

    return { times, targets, timeMap, maxRtt };
  }, [data]);

  if (!heatmapData || heatmapData.times.length === 0) {
    return null;
  }

  const { times, targets, timeMap, maxRtt } = heatmapData;

  // Take a reasonable number of time columns (max ~120 for readability)
  const step = Math.max(1, Math.floor(times.length / 120));
  const displayTimes = times.filter((_, i) => i % step === 0);

  function getColor(rtt: number | undefined): string {
    if (rtt == null || rtt === 0) return "bg-muted/20";
    // Normalize: 0ms=cool(green), maxRtt=hot(red)
    const ratio = Math.min(rtt / Math.max(maxRtt, 1), 1);
    if (ratio < 0.15) return "bg-success/30";
    if (ratio < 0.3) return "bg-success/50";
    if (ratio < 0.5) return "bg-warning/40";
    if (ratio < 0.7) return "bg-warning/70";
    if (ratio < 0.85) return "bg-destructive/40";
    return "bg-destructive/70";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Response Time Heatmap</CardTitle>
        <CardDescription>
          Color intensity shows typical response time at each network step over time. Green = fast, red = slow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 min-h-[300px]">
          {targets.map((targetId) => {
            const label = TARGET_LABELS[targetId] || targetId;
            return (
              <div key={targetId} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-20 shrink-0 text-right font-mono truncate">
                  {label}
                </span>
                <div className="flex-1 flex gap-px">
                  {displayTimes.map((time) => {
                    const rtt = timeMap.get(time)?.[targetId];
                    return (
                      <div
                        key={time}
                        className={`h-5 flex-1 rounded-[1px] ${getColor(rtt)} transition-colors`}
                        title={`${label} @ ${time}: ${rtt != null ? `${rtt.toFixed(1)}ms` : "N/A"}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* Time axis labels */}
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0" />
            <div className="flex-1 flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>{displayTimes[0] || ""}</span>
              {displayTimes.length > 2 && (
                <span>{displayTimes[Math.floor(displayTimes.length / 2)] || ""}</span>
              )}
              <span>{displayTimes[displayTimes.length - 1] || ""}</span>
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 mt-2 justify-end">
            <span className="text-[10px] text-muted-foreground">Low</span>
            <div className="flex gap-0.5">
              <div className="w-4 h-3 rounded-[1px] bg-success/30" />
              <div className="w-4 h-3 rounded-[1px] bg-success/50" />
              <div className="w-4 h-3 rounded-[1px] bg-warning/40" />
              <div className="w-4 h-3 rounded-[1px] bg-warning/70" />
              <div className="w-4 h-3 rounded-[1px] bg-destructive/40" />
              <div className="w-4 h-3 rounded-[1px] bg-destructive/70" />
            </div>
            <span className="text-[10px] text-muted-foreground">High</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
