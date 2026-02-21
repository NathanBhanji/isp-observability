"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { throughputChartConfig } from "@/lib/chart-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface ThroughputHistoryProps {
  data: any[];
  direction?: "download" | "upload";
}

export function ThroughputHistory({ data, direction = "download" }: ThroughputHistoryProps) {
  // Group tests by approximate time into single/multi pairs
  const pairs: { time: string; single: number; multi: number }[] = [];

  const singleTests = data?.filter((t: any) => t.stream_count === 1) || [];
  const multiTests = data?.filter((t: any) => t.stream_count > 1) || [];

  const maxLen = Math.max(singleTests.length, multiTests.length);
  for (let i = 0; i < maxLen; i++) {
    const s = singleTests[i];
    const m = multiTests[i];
    const ts = s?.timestamp || m?.timestamp || "";
    pairs.push({
      time: ts.slice(11, 16),
      single: s?.speed_mbps || 0,
      multi: m?.speed_mbps || 0,
    });
  }

  const label = direction === "upload" ? "Upload" : "Download";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label} History</CardTitle>
        <CardDescription>
          Single-stream vs 4x parallel {label.toLowerCase()} speed (Mbps)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={throughputChartConfig} className="min-h-[250px] w-full">
          <BarChart data={pairs} accessibilityLayer>
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
              tickFormatter={(v) => `${v}`}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="single" fill="var(--color-single)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="multi" fill="var(--color-multi)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
