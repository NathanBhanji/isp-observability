"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ReferenceLine } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { type ChartConfig } from "@/components/ui/chart";

const decayConfig = {
  speed: {
    label: "Speed (Mbps)",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

interface DecayPatternProps {
  data: any[];
}

export function DecayPattern({ data }: DecayPatternProps) {
  const chartData = (data || []).map((d: any) => ({
    second: d.second_offset,
    speed: d.speed_mbps,
  }));

  // Calculate average speed for reference line
  const avgSpeed = chartData.length > 0
    ? chartData.reduce((sum, d) => sum + d.speed, 0) / chartData.length
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Single-Stream Throughput Profile</CardTitle>
        <CardDescription>
          Per-second throughput during single-stream download — reveals throttling patterns, burst allowances, and rate-limiter behavior
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={decayConfig} className="min-h-[250px] w-full">
          <AreaChart data={chartData} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="second"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              tickFormatter={(v) => `${v}`}
              domain={[0, "auto"]}
            />
            {avgSpeed > 0 && (
              <ReferenceLine
                y={avgSpeed}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                label={{
                  value: `avg: ${avgSpeed.toFixed(0)} Mbps`,
                  position: "right",
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
              />
            )}
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="speed"
              type="monotone"
              fill="var(--color-speed)"
              fillOpacity={0.2}
              stroke="var(--color-speed)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
