"use client";

import { useMemo } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { type ChartConfig } from "@/components/ui/chart";
import { THRESHOLDS } from "@isp/shared";
import { useChartBrush } from "@/hooks/use-chart-brush";
import { formatTimestamp } from "@/lib/time-format";

const ratioConfig = {
  ratio: {
    label: "Speed Ratio",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

interface RatioTimelineProps {
  data: any[];
}

export function RatioTimeline({ data }: RatioTimelineProps) {
  const brush = useChartBrush();

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const singleTests = data.filter((t: any) => t.stream_count === 1);
    const multiTests = data.filter((t: any) => t.stream_count > 1);

    const pairs: { timestamp: string; ratio: number; single: number; multi: number }[] = [];
    const maxLen = Math.min(singleTests.length, multiTests.length);

    for (let i = 0; i < maxLen; i++) {
      const s = singleTests[i];
      const m = multiTests[i];
      if (s?.speed_mbps > 0) {
        const ratio = m.speed_mbps / s.speed_mbps;
        pairs.push({
          timestamp: s?.timestamp || m?.timestamp || "",
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
        <CardTitle className="text-base">Speed Throttling Indicator</CardTitle>
        <CardDescription>
          Compares speed using one connection vs multiple. Values above {THRESHOLDS.policingRatio}x suggest your ISP may be limiting individual downloads. Drops to 1.0x mean the limit appears inactive.
          <span className="ml-2 text-[10px] text-muted-foreground/60">
            Drag to zoom
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={ratioConfig} className="min-h-[200px] w-full select-none">
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
            {brush.referenceAreaProps && (
              <ReferenceArea {...brush.referenceAreaProps} />
            )}
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
                />
              }
            />
            <Line
              dataKey="ratio"
              type="monotone"
              stroke="var(--color-ratio)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--color-ratio)" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
