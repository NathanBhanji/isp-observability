"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface HeartbeatTimelineProps {
  /** List of outage objects with started_at, ended_at, duration_ms */
  outages: any[];
  /** Total collection period in hours (for display) */
  periodHours?: number;
  /** Start time of the monitoring period */
  since?: string;
}

export function HeartbeatTimeline({ outages, periodHours = 24, since }: HeartbeatTimelineProps) {
  const grid = useMemo(() => {
    // Create a grid of 5-minute slots over the period
    const now = new Date();
    const startTime = since ? new Date(since) : new Date(now.getTime() - periodHours * 60 * 60 * 1000);
    const totalMs = now.getTime() - startTime.getTime();
    const slotMs = 5 * 60 * 1000; // 5-minute slots
    const slotCount = Math.min(Math.ceil(totalMs / slotMs), 288); // max 24h of 5-min slots

    const slots: { time: Date; status: "ok" | "outage" | "unknown" }[] = [];

    for (let i = 0; i < slotCount; i++) {
      const slotStart = new Date(now.getTime() - (slotCount - i) * slotMs);
      const slotEnd = new Date(slotStart.getTime() + slotMs);

      // Check if any outage overlaps this slot
      const hasOutage = (outages || []).some((o: any) => {
        const oStart = new Date(o.started_at);
        const oEnd = o.ended_at ? new Date(o.ended_at) : now;
        return oStart < slotEnd && oEnd > slotStart;
      });

      slots.push({
        time: slotStart,
        status: hasOutage ? "outage" : "ok",
      });
    }

    return slots;
  }, [outages, periodHours, since]);

  // Calculate uptime percentage
  const totalSlots = grid.length;
  const outageSlots = grid.filter((s) => s.status === "outage").length;
  const uptimePct = totalSlots > 0 ? ((totalSlots - outageSlots) / totalSlots * 100) : 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Uptime Timeline</CardTitle>
            <CardDescription>
              Each square = 5 minutes. Green = healthy, red = outage detected.
            </CardDescription>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold font-mono ${uptimePct >= 99.9 ? "text-success" : uptimePct >= 99 ? "text-warning" : "text-destructive"}`}>
              {uptimePct.toFixed(2)}%
            </div>
            <div className="text-[10px] text-muted-foreground">uptime</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-[2px]">
          {grid.map((slot, i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-[2px] ${
                slot.status === "outage"
                  ? "bg-destructive"
                  : "bg-success/40"
              }`}
              title={`${slot.time.toISOString().slice(11, 16)} — ${slot.status === "outage" ? "OUTAGE" : "OK"}`}
            />
          ))}
        </div>
        {/* Time axis */}
        <div className="flex justify-between mt-2 text-[10px] text-muted-foreground font-mono">
          {grid.length > 0 && (
            <>
              <span>{grid[0].time.toISOString().slice(11, 16)}</span>
              {grid.length > 2 && (
                <span>{grid[Math.floor(grid.length / 2)].time.toISOString().slice(11, 16)}</span>
              )}
              <span>{grid[grid.length - 1].time.toISOString().slice(11, 16)}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
