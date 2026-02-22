"use client";

import { useMemo, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface HeartbeatTimelineProps {
  /** List of outage objects with started_at, ended_at, duration_ms */
  outages: any[];
  /** Total collection period in hours (for display) */
  periodHours?: number;
  /** Start time of the monitoring period */
  since?: string;
  /** Earliest outage timestamp — used for "All time" slot sizing */
  earliestAt?: string;
}

// ── Adaptive slot configuration ──────────────────────────────
// Returns { slotMs, maxSlots } based on the total period being displayed.
function getSlotConfig(totalMs: number): { slotMs: number; maxSlots: number } {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  if (totalMs <= HOUR) {
    // 1h → 1-min slots (max 60)
    return { slotMs: 60_000, maxSlots: 60 };
  }
  if (totalMs <= 6 * HOUR) {
    // 6h → 5-min slots (max 72)
    return { slotMs: 5 * 60_000, maxSlots: 72 };
  }
  if (totalMs <= DAY) {
    // 24h → 5-min slots (max 288)
    return { slotMs: 5 * 60_000, maxSlots: 288 };
  }
  if (totalMs <= 7 * DAY) {
    // 7d → 1-hour slots (max 168)
    return { slotMs: HOUR, maxSlots: 168 };
  }
  if (totalMs <= 30 * DAY) {
    // 30d → 4-hour slots (max 180)
    return { slotMs: 4 * HOUR, maxSlots: 180 };
  }
  // >30d → 6-hour slots, uncapped (based on actual range)
  return { slotMs: 6 * HOUR, maxSlots: Math.ceil(totalMs / (6 * HOUR)) };
}

// ── Human-readable slot size label ───────────────────────────
function slotLabel(slotMs: number): string {
  const mins = slotMs / 60_000;
  if (mins < 60) return `${mins} min`;
  const hrs = mins / 60;
  return `${hrs} ${hrs === 1 ? "hour" : "hours"}`;
}

// ── Format a Date for tooltip / axis label ───────────────────
function formatTime(d: Date, includeDate: boolean): string {
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (!includeDate) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date} ${time}`;
}

export function HeartbeatTimeline({
  outages,
  periodHours = 24,
  since,
  earliestAt,
}: HeartbeatTimelineProps) {
  const router = useRouter();

  // ── Auto-refresh every 30s ──────────────────────────────────
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      router.refresh(); // re-fetch server data
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);

  // ── Compute grid ────────────────────────────────────────────
  const { grid, slotMs, showDate } = useMemo(() => {
    const now = new Date();

    // Determine start time:
    // - Named timeframe: use `since`
    // - All time with outages: use `earliestAt`
    // - All time, no outages: fall back to 24h
    let startTime: Date;
    if (since) {
      startTime = new Date(since);
    } else if (earliestAt) {
      startTime = new Date(earliestAt);
    } else {
      startTime = new Date(now.getTime() - periodHours * 60 * 60 * 1000);
    }

    const totalMs = now.getTime() - startTime.getTime();
    const { slotMs: computedSlotMs, maxSlots } = getSlotConfig(totalMs);
    const slotCount = Math.min(Math.ceil(totalMs / computedSlotMs), maxSlots);

    // Whether to include date in labels (multi-day views)
    const multiDay = totalMs > 24 * 3_600_000;

    const slots: { time: Date; status: "ok" | "outage" | "unknown" }[] = [];

    for (let i = 0; i < slotCount; i++) {
      const slotStart = new Date(now.getTime() - (slotCount - i) * computedSlotMs);
      const slotEnd = new Date(slotStart.getTime() + computedSlotMs);

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

    return { grid: slots, slotMs: computedSlotMs, showDate: multiDay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outages, periodHours, since, earliestAt, tick]);

  // ── Uptime percentage ───────────────────────────────────────
  const totalSlots = grid.length;
  const outageSlots = grid.filter((s) => s.status === "outage").length;
  const uptimePct = totalSlots > 0 ? ((totalSlots - outageSlots) / totalSlots) * 100 : 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Uptime Timeline</CardTitle>
            <CardDescription>
              Each square = {slotLabel(slotMs)}. Green = healthy, red = outage detected.
            </CardDescription>
          </div>
          <div className="text-right">
            <div
              className={`text-2xl font-bold font-mono ${
                uptimePct >= 99.9
                  ? "text-success"
                  : uptimePct >= 99
                    ? "text-warning"
                    : "text-destructive"
              }`}
            >
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
                slot.status === "outage" ? "bg-destructive" : "bg-success/40"
              }`}
              title={`${formatTime(slot.time, showDate)} — ${slot.status === "outage" ? "OUTAGE" : "OK"}`}
            />
          ))}
        </div>
        {/* Time axis — local time */}
        <div className="flex justify-between mt-2 text-[10px] text-muted-foreground font-mono">
          {grid.length > 0 && (
            <>
              <span>{formatTime(grid[0].time, showDate)}</span>
              {grid.length > 2 && (
                <span>{formatTime(grid[Math.floor(grid.length / 2)].time, showDate)}</span>
              )}
              <span>{formatTime(grid[grid.length - 1].time, showDate)}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
