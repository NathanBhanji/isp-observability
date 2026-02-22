"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { congestionOverlayConfig } from "@/lib/chart-config";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ISP_PLAN } from "@isp/shared";
import {
  joinData,
  detectCongestionEvents,
  medianOf,
  type JoinedPoint,
  type CongestionEvent,
} from "@/lib/congestion";
import { useChartBrush } from "@/hooks/use-chart-brush";
import { formatTimestamp } from "@/lib/time-format";

interface Checkpoint {
  /** Index into the event slice where animation should pause */
  revealAt: number;
  title: string;
  description: string;
}

interface CongestionOverlayProps {
  latencyData: any[];
  throughputData: any[];
  gatewayLatencyData: any[];
  correlations: any[];
}

// Data joining and congestion detection are now in @/lib/congestion.ts

// ── Generate checkpoints for animated replay of a single event ──

function generateCheckpoints(
  slice: JoinedPoint[],
  event: CongestionEvent,
  medianLatency: number,
  medianSpeed: number
): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];

  // Find indices relative to the slice
  const eventStartInSlice = slice.findIndex(
    (p) => p.idx >= event.joinedStartIdx
  );
  const eventEndInSlice = slice.findIndex((p) => p.idx > event.joinedEndIdx);

  // 1. Baseline — reveal up to just before the event starts
  if (eventStartInSlice > 2) {
    const baselinePoints = slice.slice(0, eventStartInSlice).filter((p) => p.speed != null);
    const avgSpeed =
      baselinePoints.length > 0
        ? Math.round(
            baselinePoints.reduce((s, p) => s + p.speed!, 0) /
              baselinePoints.length
          )
        : medianSpeed;
    const avgLat = slice
      .slice(0, eventStartInSlice)
      .filter((p) => p.latency != null);
    const avgLatency =
      avgLat.length > 0
        ? (
            avgLat.reduce((s, p) => s + p.latency!, 0) / avgLat.length
          ).toFixed(1)
        : medianLatency.toFixed(1);

    checkpoints.push({
      revealAt: eventStartInSlice,
      title: "Baseline — your connection at rest",
      description: `Speed sits at ~${avgSpeed} Mbps with ${avgLatency}ms response time. The router latency (blue-grey) stays flat at ~0.4ms. This is what Hyperoptic should deliver.`,
    });
  }

  // 2. Latency spike — first point where ISP latency > 2× median inside the event
  const spikePoint = slice.find(
    (p, i) =>
      i >= eventStartInSlice &&
      p.latency != null &&
      p.latency > medianLatency * 2
  );
  if (spikePoint) {
    const spikeIdx = slice.indexOf(spikePoint);
    checkpoints.push({
      revealAt: spikeIdx + 1,
      title: "ISP backbone latency spikes",
      description: `Response time jumps from ~${medianLatency.toFixed(1)}ms to ${spikePoint.latency!.toFixed(1)}ms. Meanwhile the router latency (blue-grey) stays flat — this proves the delay is inside Hyperoptic's network, not your home.`,
    });
  }

  // 3. Speed drop — first point where speed < 70% median inside the event
  const dropPoint = slice.find(
    (p, i) =>
      i >= eventStartInSlice &&
      p.speed != null &&
      p.speed < medianSpeed * 0.7
  );
  if (dropPoint) {
    const dropIdx = slice.indexOf(dropPoint);
    // Only add if it's a different checkpoint than the spike
    if (!checkpoints.length || dropIdx > checkpoints[checkpoints.length - 1].revealAt) {
      const wanNote =
        dropPoint.wanSpeedMbps != null
          ? ` The total router traffic was ${dropPoint.wanSpeedMbps.toFixed(0)} Mbps — ${dropPoint.wanSpeedMbps > dropPoint.speed! * 1.15 ? "other devices were also active, but the ISP still couldn't deliver" : "close to the measured speed, meaning no other device was competing for bandwidth"}.`
          : "";
      checkpoints.push({
        revealAt: dropIdx + 1,
        title: "Download speed collapses",
        description: `Speed drops to ${dropPoint.speed!.toFixed(0)} Mbps — ${Math.round(((medianSpeed - dropPoint.speed!) / medianSpeed) * 100)}% below your baseline.${wanNote}`,
      });
    }
  }

  // 4. Recovery / end of event
  const recoveryIdx =
    eventEndInSlice > 0 ? eventEndInSlice : slice.length;
  checkpoints.push({
    revealAt: Math.min(recoveryIdx + 3, slice.length),
    title: "Event summary",
    description: `Peak latency: ${event.peakLatency.toFixed(1)}ms. Minimum speed: ${event.minSpeed.toFixed(0)} Mbps. Duration: ${event.startTime}–${event.endTime}. The pattern — abrupt onset, sustained degradation, then recovery — is the signature of ISP congestion.`,
  });

  // Deduplicate: ensure strictly ascending revealAt
  const deduped: Checkpoint[] = [];
  for (const cp of checkpoints) {
    if (deduped.length === 0 || cp.revealAt > deduped[deduped.length - 1].revealAt) {
      deduped.push(cp);
    }
  }

  return deduped;
}

// ── Definitions ──────────────────────────────────────────────

const DEFINITIONS = [
  {
    term: "Pearson r",
    definition:
      'A number from \u20131 to +1 measuring how strongly two things move together. r = 0.6 means "when speed goes up, latency reliably goes up too."',
  },
  {
    term: "Congestion",
    definition:
      "When data packets queue up waiting to be sent, adding delay. Like a traffic jam on a motorway.",
  },
  {
    term: "Total Router Traffic",
    definition:
      "The total data flowing through your router\u2019s WAN port during each speed test, including all devices on your home network. If this is close to the measured speed, no other device was competing.",
  },
  {
    term: "Router Latency",
    definition:
      "Response time to your home router (~0.4ms). If this stays flat while ISP latency spikes, the problem is beyond your home network.",
  },
  {
    term: "ISP Backbone",
    definition:
      "Hyperoptic\u2019s wider network infrastructure beyond your local neighbourhood node.",
  },
  {
    term: "Bufferbloat",
    definition:
      "When a router\u2019s buffer fills up during congestion, adding hundreds of ms of queuing delay.",
  },
];

// ── Animation speed constant ─────────────────────────────────

const REVEAL_INTERVAL_MS = 120; // ms per data point during animation
const CHECKPOINT_PAUSE_MS = 5000; // auto-resume after 5s at each checkpoint

// medianOf is imported from @/lib/congestion

// ── Event Replay Tab (animated) ──────────────────────────────

function EventReplayTab({
  event,
  eventIndex,
  allData,
  medianLatency,
  medianSpeed,
  isFullscreen,
}: {
  event: CongestionEvent;
  eventIndex: number;
  allData: JoinedPoint[];
  medianLatency: number;
  medianSpeed: number;
  isFullscreen: boolean;
}) {
  // Compute the data slice for this event: ±30 points
  const PAD = 30;
  const sliceStart = Math.max(0, event.joinedStartIdx - PAD);
  const sliceEnd = Math.min(allData.length, event.joinedEndIdx + PAD + 1);
  const eventSlice = useMemo(
    () =>
      allData.slice(sliceStart, sliceEnd).map((p, i) => ({
        ...p,
        sliceIdx: i,
      })),
    [allData, sliceStart, sliceEnd]
  );

  const checkpoints = useMemo(
    () => generateCheckpoints(eventSlice, event, medianLatency, medianSpeed),
    [eventSlice, event, medianLatency, medianSpeed]
  );

  const [revealedCount, setRevealedCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeCheckpoint, setActiveCheckpoint] = useState<number>(-1);
  const [isPausedAtCheckpoint, setIsPausedAtCheckpoint] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    };
  }, []);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || isPausedAtCheckpoint) return;

    intervalRef.current = setInterval(() => {
      setRevealedCount((prev) => {
        const next = prev + 1;
        if (next >= eventSlice.length) {
          setIsPlaying(false);
          if (intervalRef.current) clearInterval(intervalRef.current);
          return eventSlice.length;
        }

        // Check if we hit a checkpoint
        const cpIdx = checkpoints.findIndex((cp) => cp.revealAt === next);
        if (cpIdx >= 0) {
          setActiveCheckpoint(cpIdx);
          setIsPausedAtCheckpoint(true);
          if (intervalRef.current) clearInterval(intervalRef.current);

          // Auto-resume after CHECKPOINT_PAUSE_MS
          checkpointTimerRef.current = setTimeout(() => {
            setIsPausedAtCheckpoint(false);
          }, CHECKPOINT_PAUSE_MS);
        }

        return next;
      });
    }, REVEAL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, isPausedAtCheckpoint, eventSlice.length, checkpoints]);

  // When unpaused from checkpoint, resume playing
  useEffect(() => {
    if (!isPausedAtCheckpoint && isPlaying && revealedCount < eventSlice.length) {
      // Force re-trigger animation loop by toggling
    }
  }, [isPausedAtCheckpoint]);

  const handlePlay = useCallback(() => {
    if (revealedCount >= eventSlice.length) {
      // Restart
      setRevealedCount(0);
      setActiveCheckpoint(-1);
      setIsPausedAtCheckpoint(false);
    }
    setIsPlaying(true);
  }, [revealedCount, eventSlice.length]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    setIsPausedAtCheckpoint(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
  }, []);

  const handleRestart = useCallback(() => {
    setRevealedCount(0);
    setActiveCheckpoint(-1);
    setIsPausedAtCheckpoint(false);
    setIsPlaying(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
  }, []);

  const handleContinue = useCallback(() => {
    setIsPausedAtCheckpoint(false);
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
  }, []);

  const handleJumpToCheckpoint = useCallback(
    (cpIdx: number) => {
      const cp = checkpoints[cpIdx];
      if (!cp) return;
      setRevealedCount(cp.revealAt);
      setActiveCheckpoint(cpIdx);
      setIsPausedAtCheckpoint(false);
      setIsPlaying(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    },
    [checkpoints]
  );

  const handleShowAll = useCallback(() => {
    setRevealedCount(eventSlice.length);
    setActiveCheckpoint(-1);
    setIsPausedAtCheckpoint(false);
    setIsPlaying(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
  }, [eventSlice.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Space") {
        e.preventDefault();
        if (isPlaying) handlePause();
        else handlePlay();
      }
      if (e.key === "r" || e.key === "R") handleRestart();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isPlaying, handlePause, handlePlay, handleRestart]);

  // Visible data for the chart
  const visibleData = eventSlice.slice(0, Math.max(revealedCount, 1));

  // Compute domains for this slice (full slice, not just revealed — axes shouldn't move)
  const speedDomain = useMemo(() => {
    const speeds = eventSlice
      .filter((p) => p.speed != null)
      .map((p) => p.speed!);
    const wanSpeeds = eventSlice
      .filter((p) => p.wanSpeedMbps != null)
      .map((p) => p.wanSpeedMbps!);
    const allSpeeds = [...speeds, ...wanSpeeds];
    if (allSpeeds.length === 0) return [0, 1100];
    return [
      0,
      Math.max(ISP_PLAN.advertisedDown * 1.1, Math.max(...allSpeeds) * 1.1),
    ];
  }, [eventSlice]);

  const latencyDomain = useMemo(() => {
    const lats = eventSlice
      .filter((p) => p.latency != null)
      .map((p) => p.latency!);
    if (lats.length === 0) return [0, 20];
    return [0, Math.max(...lats) * 1.2];
  }, [eventSlice]);

  // Event shading indices relative to slice
  const eventStartInSlice = eventSlice.findIndex(
    (p) => p.idx >= event.joinedStartIdx
  );
  const eventEndInSlice =
    eventSlice.findIndex((p) => p.idx > event.joinedEndIdx) - 1;

  const progress = Math.round((revealedCount / eventSlice.length) * 100);
  const isComplete = revealedCount >= eventSlice.length;
  const currentCheckpoint =
    activeCheckpoint >= 0 ? checkpoints[activeCheckpoint] : null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {!isPlaying ? (
          <Button variant="outline" size="sm" onClick={handlePlay} className="h-7 px-3 text-xs">
            {isComplete ? "Replay" : revealedCount === 0 ? "Play" : "Resume"}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={handlePause} className="h-7 px-3 text-xs">
            Pause
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRestart}
          disabled={revealedCount === 0}
          className="h-7 px-2 text-xs"
        >
          Restart
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleShowAll}
          disabled={isComplete}
          className="h-7 px-2 text-xs text-muted-foreground"
        >
          Skip to end
        </Button>

        {/* Checkpoint dots */}
        <div className="flex items-center gap-1 ml-2">
          {checkpoints.map((cp, i) => (
            <button
              key={i}
              onClick={() => handleJumpToCheckpoint(i)}
              title={cp.title}
              className={`h-2 rounded-full transition-all ${
                i === activeCheckpoint
                  ? "w-5 bg-primary"
                  : i < activeCheckpoint || (isComplete && i <= checkpoints.length - 1)
                    ? "w-2 bg-primary/50"
                    : "w-2 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Progress */}
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">
          {progress}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Legend */}
      <Legend hasEvents />

      {/* Chart */}
      <ChartContainer
        config={congestionOverlayConfig}
        className={isFullscreen ? "flex-1 min-h-[400px] w-full" : "min-h-[320px] w-full"}
      >
        <ComposedChart data={visibleData} accessibilityLayer>
          <defs>
            <linearGradient id={`fillSpeed-${eventIndex}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(160 60% 45%)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="hsl(160 60% 45%)" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id={`fillLatency-${eventIndex}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(35 90% 55%)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="hsl(35 90% 55%)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id={`fillWan-${eventIndex}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(270 50% 60%)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="hsl(270 50% 60%)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="sliceIdx"
            type="number"
            domain={[0, eventSlice.length - 1]}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={11}
            tick={{ fill: "hsl(0 0% 65%)" }}
            tickFormatter={(idx: number) => eventSlice[idx]?.time ?? ""}
          />
          <YAxis
            yAxisId="speed"
            orientation="left"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tick={{ fill: "hsl(160 50% 60%)" }}
            tickFormatter={(v: number) => `${v} Mbps`}
            domain={speedDomain}
            width={80}
            label={{
              value: "Download Speed",
              angle: -90,
              position: "insideLeft",
              offset: 10,
              fontSize: 11,
              fill: "hsl(160 50% 60%)",
              fontWeight: 500,
            }}
          />
          <YAxis
            yAxisId="latency"
            orientation="right"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tick={{ fill: "hsl(35 80% 60%)" }}
            tickFormatter={(v: number) => `${v} ms`}
            domain={latencyDomain}
            width={70}
            label={{
              value: "Response Time",
              angle: 90,
              position: "insideRight",
              offset: 10,
              fontSize: 11,
              fill: "hsl(35 80% 60%)",
              fontWeight: 500,
            }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => {
                  if (name === "speed")
                    return (
                      <span>
                        <span className="text-muted-foreground">Speed: </span>
                        <span className="font-mono font-medium">
                          {Number(value).toFixed(0)} Mbps
                        </span>
                      </span>
                    );
                  if (name === "latency")
                    return (
                      <span>
                        <span className="text-muted-foreground">ISP Response: </span>
                        <span className="font-mono font-medium">
                          {Number(value).toFixed(1)} ms
                        </span>
                      </span>
                    );
                  if (name === "routerLatency")
                    return (
                      <span>
                        <span className="text-muted-foreground">Router: </span>
                        <span className="font-mono font-medium">
                          {Number(value).toFixed(2)} ms
                        </span>
                      </span>
                    );
                  if (name === "wanSpeedMbps")
                    return (
                      <span>
                        <span className="text-muted-foreground">Router Traffic: </span>
                        <span className="font-mono font-medium">
                          {Number(value).toFixed(0)} Mbps
                        </span>
                      </span>
                    );
                  return String(value);
                }}
              />
            }
          />

          {/* Reference lines */}
          <ReferenceLine
            yAxisId="speed"
            y={ISP_PLAN.advertisedDown}
            stroke="hsl(0 0% 100% / 0.3)"
            strokeDasharray="4 4"
            label={{
              value: `Plan: ${ISP_PLAN.advertisedDown} Mbps`,
              position: "insideTopLeft",
              fontSize: 10,
              fill: "hsl(0 0% 100% / 0.5)",
            }}
          />
          <ReferenceLine
            yAxisId="speed"
            y={ISP_PLAN.minimumDown}
            stroke="hsl(0 70% 50% / 0.4)"
            strokeDasharray="4 4"
            label={{
              value: `Min: ${ISP_PLAN.minimumDown} Mbps`,
              position: "insideBottomLeft",
              fontSize: 10,
              fill: "hsl(0 70% 50% / 0.6)",
            }}
          />

          {/* Congestion event shading — only show when revealed */}
          {eventStartInSlice >= 0 &&
            revealedCount > eventStartInSlice && (
              <ReferenceArea
                yAxisId="speed"
                x1={eventStartInSlice}
                x2={Math.min(
                  eventEndInSlice >= 0 ? eventEndInSlice : eventSlice.length - 1,
                  revealedCount - 1
                )}
                fill="hsl(0 70% 50%)"
                fillOpacity={0.08}
                stroke="hsl(0 70% 50% / 0.3)"
                strokeDasharray="3 3"
              />
            )}

          {/* Total router traffic (purple dashed — behind speed) */}
          <Area
            yAxisId="speed"
            dataKey="wanSpeedMbps"
            type="monotone"
            fill={`url(#fillWan-${eventIndex})`}
            stroke="hsl(270 50% 60%)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            connectNulls
            name="wanSpeedMbps"
          />

          {/* Download speed */}
          <Area
            yAxisId="speed"
            dataKey="speed"
            type="monotone"
            fill={`url(#fillSpeed-${eventIndex})`}
            stroke="hsl(160 60% 45%)"
            strokeWidth={2.5}
            dot={false}
            connectNulls
            name="speed"
          />

          {/* ISP backbone latency */}
          <Area
            yAxisId="latency"
            dataKey="latency"
            type="monotone"
            fill={`url(#fillLatency-${eventIndex})`}
            stroke="hsl(35 90% 55%)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            name="latency"
          />

          {/* Router latency (thin line, no fill) */}
          <Line
            yAxisId="latency"
            dataKey="routerLatency"
            type="monotone"
            stroke="hsl(220 15% 55%)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            name="routerLatency"
          />
        </ComposedChart>
      </ChartContainer>

      {/* Checkpoint callout */}
      {currentCheckpoint && (
        <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{currentCheckpoint.title}</h4>
            {isPausedAtCheckpoint && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleContinue}
                className="h-6 px-2 text-[11px]"
              >
                Continue
              </Button>
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {currentCheckpoint.description}
          </p>
        </div>
      )}

      {/* Final summary when fully revealed and no checkpoint active */}
      {isComplete && !currentCheckpoint && (
        <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-1">
          <h4 className="text-sm font-semibold">Event complete</h4>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Peak latency: {event.peakLatency.toFixed(1)}ms. Minimum speed:{" "}
            {event.minSpeed.toFixed(0)} Mbps. Window: {event.startTime}–
            {event.endTime}. Click <strong>Replay</strong> to watch again, or
            use the checkpoint dots to jump to a specific moment.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Legend component ─────────────────────────────────────────

function Legend({ hasEvents }: { hasEvents: boolean }) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-5 rounded-sm border-t-2"
          style={{
            background: "hsl(160 60% 45% / 0.25)",
            borderColor: "hsl(160 60% 45%)",
          }}
        />
        <span className="text-[hsl(160_50%_60%)]">Download Speed</span>
        <span className="text-muted-foreground/60">(left, Mbps)</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-5 rounded-sm border-t-2 border-dashed"
          style={{
            background: "hsl(270 50% 60% / 0.12)",
            borderColor: "hsl(270 50% 60%)",
          }}
        />
        <span className="text-[hsl(270_50%_60%)]">Router Traffic</span>
        <span className="text-muted-foreground/60">(left, Mbps)</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-5 rounded-sm border-t-2"
          style={{
            background: "hsl(35 90% 55% / 0.2)",
            borderColor: "hsl(35 90% 55%)",
          }}
        />
        <span className="text-[hsl(35_80%_60%)]">ISP Response</span>
        <span className="text-muted-foreground/60">(right, ms)</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-5 rounded"
          style={{ background: "hsl(220 15% 55%)" }}
        />
        <span className="text-[hsl(220_15%_55%)]">Router Latency</span>
        <span className="text-muted-foreground/60">(right, ms)</span>
      </span>
      {hasEvents && (
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-5 rounded-sm border border-destructive/30"
            style={{ background: "hsl(0 70% 50% / 0.15)" }}
          />
          Congestion Event
        </span>
      )}
    </div>
  );
}

// ── Overview Tab (static full chart) ─────────────────────────

function OverviewTab({
  data,
  events,
  isFullscreen,
}: {
  data: JoinedPoint[];
  events: CongestionEvent[];
  isFullscreen: boolean;
}) {
  const brush = useChartBrush();
  const speedDomain = useMemo(() => {
    const speeds = data.filter((p) => p.speed != null).map((p) => p.speed!);
    const wanSpeeds = data
      .filter((p) => p.wanSpeedMbps != null)
      .map((p) => p.wanSpeedMbps!);
    const allSpeeds = [...speeds, ...wanSpeeds];
    if (allSpeeds.length === 0) return [0, 1100];
    return [
      0,
      Math.max(ISP_PLAN.advertisedDown * 1.1, Math.max(...allSpeeds) * 1.1),
    ];
  }, [data]);

  const latencyDomain = useMemo(() => {
    const lats = data.filter((p) => p.latency != null).map((p) => p.latency!);
    if (lats.length === 0) return [0, 20];
    return [0, Math.max(...lats) * 1.2];
  }, [data]);

  // Pad events for overview visibility — resolve to timestamps for the x-axis
  const paddedEvents = useMemo(() => {
    const maxIdx = data.length - 1;
    const PAD = 5;
    return events.map((ev) => {
      const startIdx = Math.max(0, ev.joinedStartIdx - PAD);
      const endIdx = Math.min(maxIdx, ev.joinedEndIdx + PAD);
      return {
        ...ev,
        startTimestamp: data[startIdx]?.timestamp ?? "",
        endTimestamp: data[endIdx]?.timestamp ?? "",
      };
    });
  }, [events, data]);

  return (
    <div className="space-y-4">
      <Legend hasEvents={events.length > 0} />
      <ChartContainer
        config={congestionOverlayConfig}
        className={
          isFullscreen ? "flex-1 min-h-[400px] w-full select-none" : "min-h-[320px] w-full select-none"
        }
      >
        <ComposedChart
          data={data}
          accessibilityLayer
          onMouseDown={brush.onMouseDown}
          onMouseMove={brush.onMouseMove}
          onMouseUp={brush.onMouseUp}
        >
          <defs>
            <linearGradient id="fillSpeed-ov" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(160 60% 45%)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="hsl(160 60% 45%)" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="fillLatency-ov" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(35 90% 55%)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="hsl(35 90% 55%)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="fillWan-ov" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(270 50% 60%)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="hsl(270 50% 60%)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={11}
            tick={{ fill: "hsl(0 0% 65%)" }}
            tickFormatter={(v) => formatTimestamp(v, data)}
          />
          <YAxis
            yAxisId="speed"
            orientation="left"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tick={{ fill: "hsl(160 50% 60%)" }}
            tickFormatter={(v: number) => `${v} Mbps`}
            domain={speedDomain}
            width={80}
            label={{
              value: "Download Speed",
              angle: -90,
              position: "insideLeft",
              offset: 10,
              fontSize: 11,
              fill: "hsl(160 50% 60%)",
              fontWeight: 500,
            }}
          />
          <YAxis
            yAxisId="latency"
            orientation="right"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tick={{ fill: "hsl(35 80% 60%)" }}
            tickFormatter={(v: number) => `${v} ms`}
            domain={latencyDomain}
            width={70}
            label={{
              value: "Response Time",
              angle: 90,
              position: "insideRight",
              offset: 10,
              fontSize: 11,
              fill: "hsl(35 80% 60%)",
              fontWeight: 500,
            }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const ts = payload?.[0]?.payload?.timestamp;
                  if (!ts) return "";
                  const d = new Date(ts);
                  return d.toLocaleString("en-GB", {
                    day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit",
                  });
                }}
                formatter={(value, name) => {
                  if (name === "speed")
                    return (
                      <span>
                        <span className="text-muted-foreground">Speed: </span>
                        <span className="font-mono font-medium">
                          {Number(value).toFixed(0)} Mbps
                        </span>
                      </span>
                    );
                  if (name === "latency")
                    return (
                      <span>
                        <span className="text-muted-foreground">ISP Response: </span>
                        <span className="font-mono font-medium">
                          {Number(value).toFixed(1)} ms
                        </span>
                      </span>
                    );
                  if (name === "routerLatency")
                    return (
                      <span>
                        <span className="text-muted-foreground">Router: </span>
                        <span className="font-mono font-medium">
                          {Number(value).toFixed(2)} ms
                        </span>
                      </span>
                    );
                  if (name === "wanSpeedMbps")
                    return (
                      <span>
                        <span className="text-muted-foreground">Router Traffic: </span>
                        <span className="font-mono font-medium">
                          {Number(value).toFixed(0)} Mbps
                        </span>
                      </span>
                    );
                  return String(value);
                }}
              />
            }
          />
          <ReferenceLine
            yAxisId="speed"
            y={ISP_PLAN.advertisedDown}
            stroke="hsl(0 0% 100% / 0.3)"
            strokeDasharray="4 4"
            label={{
              value: `Plan: ${ISP_PLAN.advertisedDown} Mbps`,
              position: "insideTopLeft",
              fontSize: 10,
              fill: "hsl(0 0% 100% / 0.5)",
            }}
          />
          <ReferenceLine
            yAxisId="speed"
            y={ISP_PLAN.minimumDown}
            stroke="hsl(0 70% 50% / 0.4)"
            strokeDasharray="4 4"
            label={{
              value: `Min: ${ISP_PLAN.minimumDown} Mbps`,
              position: "insideBottomLeft",
              fontSize: 10,
              fill: "hsl(0 70% 50% / 0.6)",
            }}
          />

          {paddedEvents.map((ev, i) =>
            ev.startTimestamp && ev.endTimestamp ? (
              <ReferenceArea
                key={`congestion-${i}`}
                yAxisId="speed"
                x1={ev.startTimestamp}
                x2={ev.endTimestamp}
                fill="hsl(0 70% 50%)"
                fillOpacity={0.08}
                stroke="hsl(0 70% 50% / 0.3)"
                strokeDasharray="3 3"
              />
            ) : null
          )}

          {brush.referenceAreaProps && (
            <ReferenceArea yAxisId="speed" {...brush.referenceAreaProps} />
          )}

          <Area
            yAxisId="speed"
            dataKey="wanSpeedMbps"
            type="monotone"
            fill="url(#fillWan-ov)"
            stroke="hsl(270 50% 60%)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            connectNulls
            name="wanSpeedMbps"
            isAnimationActive={false}
          />
          <Area
            yAxisId="speed"
            dataKey="speed"
            type="monotone"
            fill="url(#fillSpeed-ov)"
            stroke="hsl(160 60% 45%)"
            strokeWidth={2.5}
            dot={false}
            connectNulls
            name="speed"
            isAnimationActive={false}
          />
          <Area
            yAxisId="latency"
            dataKey="latency"
            type="monotone"
            fill="url(#fillLatency-ov)"
            stroke="hsl(35 90% 55%)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            name="latency"
            isAnimationActive={false}
          />
          <Line
            yAxisId="latency"
            dataKey="routerLatency"
            type="monotone"
            stroke="hsl(220 15% 55%)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            name="routerLatency"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

export function CongestionOverlay({
  latencyData,
  throughputData,
  gatewayLatencyData,
  correlations,
}: CongestionOverlayProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDefinitions, setShowDefinitions] = useState(false);

  // Join data
  const joined = useMemo(
    () => joinData(latencyData, throughputData, gatewayLatencyData),
    [latencyData, throughputData, gatewayLatencyData]
  );

  // Detect congestion events
  const events = useMemo(() => detectCongestionEvents(joined), [joined]);

  // Compute medians for checkpoint generation
  const { medianLatency, medianSpeed } = useMemo(() => {
    const pointsWithBoth = joined.filter(
      (p) => p.speed != null && p.latency != null
    );
    return {
      medianLatency: medianOf(
        pointsWithBoth.map((p) => p.latency!).filter(Boolean)
      ),
      medianSpeed: medianOf(
        pointsWithBoth.map((p) => p.speed!).filter(Boolean)
      ),
    };
  }, [joined]);

  // Default to first event tab if events exist, else overview
  const defaultTab = events.length > 0 ? "event-0" : "overview";

  // ESC to exit fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    if (isFullscreen) {
      document.addEventListener("keydown", handler);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  if (joined.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Congestion Analysis</CardTitle>
          <CardDescription>
            Waiting for speed and latency data to arrive...
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This chart needs both speed tests and latency measurements from the
            ISP Backbone. Data should appear within a few minutes.
          </p>
        </CardContent>
      </Card>
    );
  }

  const definitions = (
    <details className="group" open={showDefinitions}>
      <summary
        className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
        onClick={(e) => {
          e.preventDefault();
          setShowDefinitions((v) => !v);
        }}
      >
        {showDefinitions ? "Hide" : "Show"} definitions
      </summary>
      {showDefinitions && (
        <div className="mt-3 space-y-2.5 text-[13px]">
          {DEFINITIONS.map((d) => (
            <div key={d.term}>
              <dt className="font-medium text-foreground">{d.term}</dt>
              <dd className="text-muted-foreground leading-relaxed mt-0.5">
                {d.definition}
              </dd>
            </div>
          ))}
        </div>
      )}
    </details>
  );

  const tabsContent = (
    <Tabs defaultValue={defaultTab}>
      <TabsList className="mb-4">
        {events.map((ev, i) => (
          <TabsTrigger key={`event-${i}`} value={`event-${i}`}>
            Event {i + 1}: {ev.startTime}–{ev.endTime}
          </TabsTrigger>
        ))}
        <TabsTrigger value="overview">Overview</TabsTrigger>
      </TabsList>

      {events.map((ev, i) => (
        <TabsContent key={`event-${i}`} value={`event-${i}`}>
          <EventReplayTab
            event={ev}
            eventIndex={i}
            allData={joined}
            medianLatency={medianLatency}
            medianSpeed={medianSpeed}
            isFullscreen={isFullscreen}
          />
        </TabsContent>
      ))}

      <TabsContent value="overview">
        <OverviewTab
          data={joined}
          events={events}
          isFullscreen={isFullscreen}
        />
      </TabsContent>
    </Tabs>
  );

  // Fullscreen layout
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-auto">
        <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Congestion Analysis</h2>
            <p className="text-xs text-muted-foreground">
              Speed and response time overlaid on a shared timeline
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen(false)}
            className="text-xs"
          >
            Exit fullscreen{" "}
            <span className="text-muted-foreground ml-1 font-mono">ESC</span>
          </Button>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-auto">
          <div className="flex-1 flex flex-col p-6 gap-4 min-w-0">
            {tabsContent}
          </div>

          {/* Definitions sidebar */}
          <div className="lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-border p-6 overflow-auto">
            <h3 className="text-sm font-semibold mb-3">Definitions</h3>
            <dl className="space-y-3 text-[13px]">
              {DEFINITIONS.map((d) => (
                <div key={d.term}>
                  <dt className="font-medium text-foreground">{d.term}</dt>
                  <dd className="text-muted-foreground leading-relaxed mt-0.5">
                    {d.definition}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    );
  }

  // Normal card layout
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Congestion Analysis</CardTitle>
            <CardDescription>
              Speed and response time overlaid on a shared timeline
              {events.length > 0 && (
                <span className="ml-2 text-destructive font-medium">
                  {events.length} congestion event
                  {events.length > 1 ? "s" : ""} detected
                </span>
              )}
              <span className="ml-2 text-[10px] text-muted-foreground/60">
                Drag to zoom (overview tab)
              </span>
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen(true)}
            className="text-xs shrink-0"
          >
            Fullscreen
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {tabsContent}
        <div className="pt-2 border-t border-border">{definitions}</div>
      </CardContent>
    </Card>
  );
}
