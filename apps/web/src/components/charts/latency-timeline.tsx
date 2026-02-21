"use client";

import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
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
  title = "Response Time Over Time",
  description = "Response time for each step your traffic passes through",
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
      ? "Average"
      : metric === "rtt_p50"
        ? "Typical"
        : metric === "rtt_p95"
          ? "Slow (95th)"
          : "Worst (99th)";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {description} ({metricLabel} in ms)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={hopChartConfig} className="min-h-[300px] w-full">
          <LineChart data={chartData} accessibilityLayer>
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
              domain={[0, "auto"]}
            />
            <ChartTooltip
              content={<ChartTooltipContent indicator="line" />}
            />
            <ChartLegend content={<ChartLegendContent />} />
            {PING_TARGETS.map((target) => (
              <Line
                key={target.id}
                dataKey={target.id}
                type="monotone"
                stroke={`var(--color-${target.id})`}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
