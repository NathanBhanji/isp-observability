"use client";

import { Area, ComposedChart, XAxis, YAxis, ReferenceLine } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { timeOfDayChartConfig } from "@/lib/chart-config";
import { ISP_PLAN } from "@isp/shared";

interface HourlyPerformanceChartProps {
  latencyData: { hour: number; avgRtt: number; samples: number }[];
  throughputData?: { hour: number; avgSpeed: number; samples: number }[];
}

const PEAK_HOURS = [19, 20, 21, 22];
const OFF_PEAK_HOURS = [2, 3, 4, 5, 6];

const PEAK_COLOR = "hsl(35 90% 55%)";
const OFF_PEAK_COLOR = "hsl(220 60% 55%)";

function buildWindowData(
  hours: number[],
  latencyMap: Map<number, { avgRtt: number; samples: number }>,
  speedMap: Map<number, { avgSpeed: number; samples: number }>,
) {
  return hours.map((h) => {
    const lat = latencyMap.get(h);
    const spd = speedMap.get(h);
    return {
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      avgSpeed: spd?.avgSpeed ?? 0,
      speedSamples: spd?.samples ?? 0,
      avgRtt: lat?.avgRtt ?? 0,
      latencySamples: lat?.samples ?? 0,
      hasData: (spd?.samples ?? 0) > 0 || (lat?.samples ?? 0) > 0,
    };
  });
}

function WindowChart({
  title,
  color,
  data,
  dataKey,
  unit,
  samplesKey,
  domain,
  showPlanLines,
}: {
  title: string;
  color: string;
  data: ReturnType<typeof buildWindowData>;
  dataKey: "avgSpeed" | "avgRtt";
  unit: string;
  samplesKey: "speedSamples" | "latencySamples";
  domain?: [number, number];
  showPlanLines?: boolean;
}) {
  const gradientId = `fill-${title.replace(/\W/g, "")}`;

  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs text-muted-foreground mb-1.5 font-medium flex items-center gap-1.5">
        <span
          className="inline-block w-2 h-2 rounded-sm"
          style={{ background: color }}
        />
        {title}
      </div>
      <ChartContainer config={timeOfDayChartConfig} className="h-[120px] w-full">
        <ComposedChart data={data} accessibilityLayer>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            fontSize={10}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            fontSize={10}
            tickFormatter={(v: number) => `${v}${unit === "ms" ? "ms" : ""}`}
            domain={domain ?? [0, "auto"]}
            width={40}
          />
          <ChartTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              if (!d.hasData) {
                return (
                  <div className="rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                    {d.label} — No data
                  </div>
                );
              }
              const value = d[dataKey] as number;
              const samples = d[samplesKey] as number;
              return (
                <div className="rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                  <div className="font-medium">{d.label}</div>
                  <div className="font-mono">
                    <strong>
                      {unit === "ms" ? value.toFixed(1) : value.toFixed(0)} {unit}
                    </strong>
                    <span className="text-muted-foreground ml-1">
                      ({samples} {unit === "ms" ? "pings" : "tests"})
                    </span>
                  </div>
                </div>
              );
            }}
          />
          <Area
            dataKey={dataKey}
            type="monotone"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={{
              r: 3,
              fill: color,
              stroke: "hsl(var(--background))",
              strokeWidth: 1.5,
            }}
            activeDot={{
              r: 4,
              fill: color,
              stroke: "hsl(var(--background))",
              strokeWidth: 2,
            }}
          />
          {showPlanLines ? (
            <ReferenceLine
              y={ISP_PLAN.advertisedDown}
              stroke="rgba(255,255,255,0.4)"
              strokeDasharray="4 3"
              label={{ value: `Advertised ${ISP_PLAN.advertisedDown}`, position: "insideTopLeft", style: { fontSize: 8, fill: "rgba(255,255,255,0.6)" } }}
            />
          ) : null}
          {showPlanLines ? (
            <ReferenceLine
              y={ISP_PLAN.avgPeakDown}
              stroke="rgba(255,255,255,0.3)"
              strokeDasharray="4 3"
              label={{ value: `Avg Peak ${ISP_PLAN.avgPeakDown}`, position: "insideTopLeft", style: { fontSize: 8, fill: "rgba(255,255,255,0.5)" } }}
            />
          ) : null}
          {showPlanLines ? (
            <ReferenceLine
              y={ISP_PLAN.minimumDown}
              stroke="rgba(239,68,68,0.6)"
              strokeDasharray="4 3"
              label={{ value: `Min ${ISP_PLAN.minimumDown}`, position: "insideTopLeft", style: { fontSize: 8, fill: "rgba(239,68,68,0.8)" } }}
            />
          ) : null}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

export function HourlyPerformanceChart({
  latencyData,
  throughputData,
}: HourlyPerformanceChartProps) {
  const latencyMap = new Map(latencyData.map((d) => [d.hour, d]));
  const speedMap = new Map((throughputData ?? []).map((d) => [d.hour, d]));

  const hasSpeedData = (throughputData ?? []).some((d) => d.avgSpeed > 0);

  const peakData = buildWindowData(PEAK_HOURS, latencyMap, speedMap);
  const offPeakData = buildWindowData(OFF_PEAK_HOURS, latencyMap, speedMap);

  // Shared Y domain — when showing speed, include plan advertised so reference lines fit
  const allValues = [...peakData, ...offPeakData];
  const dataKey = hasSpeedData ? "avgSpeed" : "avgRtt";
  const samplesKey = hasSpeedData ? "speedSamples" : "latencySamples";
  const maxVal = Math.max(
    ...allValues.map((d) => d[dataKey]),
    hasSpeedData ? ISP_PLAN.advertisedDown : 1,
  );
  const sharedDomain: [number, number] = [0, Math.ceil(maxVal * 1.1)];

  const unit = hasSpeedData ? "Mbps" : "ms";

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2 font-medium">
        {hasSpeedData ? "Speed by Time Window" : "Latency by Time Window"}
      </div>
      <div className="flex gap-4">
        <WindowChart
          title="Peak (19:00–22:00)"
          color={PEAK_COLOR}
          data={peakData}
          dataKey={dataKey as "avgSpeed" | "avgRtt"}
          unit={unit}
          samplesKey={samplesKey as "speedSamples" | "latencySamples"}
          domain={sharedDomain}
          showPlanLines={hasSpeedData}
        />
        <WindowChart
          title="Off-Peak (02:00–06:00)"
          color={OFF_PEAK_COLOR}
          data={offPeakData}
          dataKey={dataKey as "avgSpeed" | "avgRtt"}
          unit={unit}
          samplesKey={samplesKey as "speedSamples" | "latencySamples"}
          domain={sharedDomain}
          showPlanLines={hasSpeedData}
        />
      </div>
    </div>
  );
}
