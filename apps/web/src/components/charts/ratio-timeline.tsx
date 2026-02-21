"use client";

import { useMemo } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis, ReferenceLine } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { type ChartConfig } from "@/components/ui/chart";
import { THRESHOLDS } from "@isp/shared";

const ratioConfig = {
  ratio: {
    label: "Multi/Single Ratio",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

interface RatioTimelineProps {
  data: any[];
}

export function RatioTimeline({ data }: RatioTimelineProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Group by approximate time — pair single and multi tests
    const singleTests = data.filter((t: any) => t.stream_count === 1);
    const multiTests = data.filter((t: any) => t.stream_count > 1);

    const pairs: { time: string; ratio: number; single: number; multi: number }[] = [];
    const maxLen = Math.min(singleTests.length, multiTests.length);

    for (let i = 0; i < maxLen; i++) {
      const s = singleTests[i];
      const m = multiTests[i];
      if (s?.speed_mbps > 0) {
        const ratio = m.speed_mbps / s.speed_mbps;
        pairs.push({
          time: (s?.timestamp || m?.timestamp || "").slice(11, 16),
          ratio: Math.round(ratio * 100) / 100,
          single: s.speed_mbps,
          multi: m.speed_mbps,
        });
      }
    }

    return pairs;
  }, [data]);

  if (chartData.length < 2) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Policing Ratio Over Time</CardTitle>
        <CardDescription>
          Multi/Single stream ratio — values above {THRESHOLDS.policingRatio}x suggest per-flow policing. Dips toward 1.0x indicate the policer disengaged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={ratioConfig} className="min-h-[200px] w-full">
          <LineChart data={chartData} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              tickFormatter={(v) => `${v}x`}
              domain={[0, "auto"]}
            />
            <ReferenceLine
              y={THRESHOLDS.policingRatio}
              stroke="var(--destructive)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{
                value: `${THRESHOLDS.policingRatio}x threshold`,
                position: "right",
                fill: "var(--destructive)",
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={1}
              stroke="var(--muted-foreground)"
              strokeDasharray="2 2"
              strokeOpacity={0.3}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="ratio"
              type="monotone"
              stroke="var(--color-ratio)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--color-ratio)" }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
