"use client";

import { useMemo } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  ReferenceArea,
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
import { useChartBrush } from "@/hooks/use-chart-brush";
import { formatTimestamp } from "@/lib/time-format";

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
  const brush = useChartBrush();

  // Transform data: group by timestamp, create one row per time point with all hops
  const chartData = useMemo(() => {
    const timeMap = new Map<string, any>();
    for (const row of data) {
      if (!timeMap.has(row.timestamp)) {
        timeMap.set(row.timestamp, { timestamp: row.timestamp });
      }
      const point = timeMap.get(row.timestamp)!;
      point[row.target_id] = row[metric];
    }
    return Array.from(timeMap.values()).sort(
      (a, b) => a.timestamp.localeCompare(b.timestamp)
    );
  }, [data, metric]);

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
          <span className="ml-2 text-[10px] text-muted-foreground/60">
            Drag to zoom
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={hopChartConfig} className="min-h-[300px] w-full select-none">
          <LineChart
            data={chartData}
            accessibilityLayer
            onMouseDown={brush.onMouseDown}
            onMouseMove={brush.onMouseMove}
            onMouseUp={brush.onMouseUp}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatTimestamp(v, chartData)}
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
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) => {
                    const ts = payload?.[0]?.payload?.timestamp;
                    if (!ts) return "";
                    const d = new Date(ts);
                    return d.toLocaleString("en-GB", {
                      day: "numeric", month: "short",
                      hour: "2-digit", minute: "2-digit",
                    });
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {brush.referenceAreaProps && (
              <ReferenceArea {...brush.referenceAreaProps} />
            )}
            {PING_TARGETS.map((target) => (
              <Line
                key={target.id}
                dataKey={target.id}
                type="monotone"
                stroke={`var(--color-${target.id})`}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
