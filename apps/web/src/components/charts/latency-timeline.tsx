"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { hopChartConfig } from "@/lib/chart-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PING_TARGETS } from "@isp/shared";

interface LatencyTimelineProps {
  data: any[];
  metric?: "rtt_mean" | "rtt_p50" | "rtt_p95" | "rtt_p99";
  title?: string;
  description?: string;
}

export function LatencyTimeline({
  data,
  metric = "rtt_p50",
  title = "Per-Hop Latency",
  description = "RTT over time for each monitored hop",
}: LatencyTimelineProps) {
  // Transform data: group by timestamp, create one row per time point with all hops
  const timeMap = new Map<string, any>();

  for (const row of data) {
    const time = row.timestamp?.slice(11, 19) || ""; // HH:MM:SS
    if (!timeMap.has(row.timestamp)) {
      timeMap.set(row.timestamp, { time, timestamp: row.timestamp });
    }
    const point = timeMap.get(row.timestamp)!;
    point[row.target_id] = row[metric];
  }

  const chartData = Array.from(timeMap.values()).sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp)
  );

  const metricLabel =
    metric === "rtt_mean"
      ? "Mean"
      : metric === "rtt_p50"
        ? "P50"
        : metric === "rtt_p95"
          ? "P95"
          : "P99";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {description} ({metricLabel} RTT in ms)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={hopChartConfig} className="min-h-[300px] w-full">
          <AreaChart data={chartData} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => v.slice(0, 5)}
              fontSize={11}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              tickFormatter={(v) => `${v}ms`}
            />
            <ChartTooltip
              content={<ChartTooltipContent indicator="line" />}
            />
            <ChartLegend content={<ChartLegendContent />} />
            {PING_TARGETS.map((target) => (
              <Area
                key={target.id}
                dataKey={target.id}
                type="monotone"
                fill={`var(--color-${target.id})`}
                fillOpacity={0.1}
                stroke={`var(--color-${target.id})`}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
