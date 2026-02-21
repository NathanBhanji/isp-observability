"use client";

import React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
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
import { throughputChartConfig } from "@/lib/chart-config";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface ThroughputHistoryProps {
  data: any[];
  direction?: "download" | "upload";
}

export function ThroughputHistory({
  data,
  direction = "download",
}: ThroughputHistoryProps) {
  // Group tests by approximate time into single/multi pairs
  const pairs: { time: string; single: number; multi: number; wanTotal?: number }[] = [];

  const singleTests = data?.filter((t: any) => t.stream_count === 1) || [];
  const multiTests = data?.filter((t: any) => t.stream_count > 1) || [];

  const maxLen = Math.max(singleTests.length, multiTests.length);
  for (let i = 0; i < maxLen; i++) {
    const s = singleTests[i];
    const m = multiTests[i];
    const ts = s?.timestamp || m?.timestamp || "";
    const multiSpd = m?.speed_mbps || 0;
    const singleSpd = s?.speed_mbps || 0;
    // Only use WAN speed from the same test — never mix single WAN with multi speed
    // because single-stream WAN total can be lower than multi-stream measured speed.
    // Also clamp: WAN total must be >= measured speed (it includes the test itself).
    let wanSpeed: number | undefined;
    if (m?.wan_speed_mbps != null) {
      wanSpeed = Math.max(m.wan_speed_mbps, multiSpd);
    } else if (s?.wan_speed_mbps != null && multiSpd === 0) {
      // Only use single WAN when there's no multi test in this pair
      wanSpeed = Math.max(s.wan_speed_mbps, singleSpd);
    }
    pairs.push({
      time: ts.slice(11, 16),
      single: singleSpd,
      multi: multiSpd,
      ...(wanSpeed != null ? { wanTotal: Math.round(wanSpeed * 10) / 10 } : {}),
    });
  }

  const hasWanData = pairs.some((p) => p.wanTotal != null);

  // Compute averages for reference lines
  const singleValues = pairs.map((p) => p.single).filter((v) => v > 0);
  const multiValues = pairs.map((p) => p.multi).filter((v) => v > 0);
  const singleAvg =
    singleValues.length > 0
      ? singleValues.reduce((a, b) => a + b, 0) / singleValues.length
      : null;
  const multiAvg =
    multiValues.length > 0
      ? multiValues.reduce((a, b) => a + b, 0) / multiValues.length
      : null;

  const label = direction === "upload" ? "Upload" : "Download";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label} History</CardTitle>
        <CardDescription>
          One connection vs four simultaneous connections{hasWanData ? " vs total router traffic" : ""} — {label.toLowerCase()} speed (Mbps)
          {singleAvg != null && multiAvg != null && (
            <span className="ml-2 font-mono text-[10px]">
              avg: {singleAvg.toFixed(0)} / {multiAvg.toFixed(0)} Mbps
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={throughputChartConfig}
          className="min-h-[250px] w-full"
        >
          <AreaChart data={pairs} accessibilityLayer>
            <defs>
              <linearGradient id="fillSingle" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-single)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-single)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillMulti" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-multi)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-multi)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillWanTotal" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-wanTotal)"
                  stopOpacity={0.15}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-wanTotal)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
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
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => label}
                  formatter={(value, name, item, index) => (
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                        style={
                          {
                            "--color-bg": `var(--color-${item.dataKey})`,
                          } as React.CSSProperties
                        }
                      />
                      <span className="text-muted-foreground">
                        {throughputChartConfig[
                          item.dataKey as keyof typeof throughputChartConfig
                        ]?.label ?? name}
                      </span>
                      <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                        {Number(value).toFixed(0)} Mbps
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {/* Average reference lines */}
            {singleAvg != null && (
              <ReferenceLine
                y={singleAvg}
                stroke="var(--color-single)"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                label={{
                  value: `avg ${singleAvg.toFixed(0)}`,
                  position: "insideTopLeft",
                  fontSize: 10,
                  fill: "var(--color-single)",
                }}
              />
            )}
            {multiAvg != null && (
              <ReferenceLine
                y={multiAvg}
                stroke="var(--color-multi)"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                label={{
                  value: `avg ${multiAvg.toFixed(0)}`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "var(--color-multi)",
                }}
              />
            )}
            {hasWanData && (
              <Area
                dataKey="wanTotal"
                type="monotone"
                fill="url(#fillWanTotal)"
                stroke="var(--color-wanTotal)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                connectNulls
              />
            )}
            <Area
              dataKey="multi"
              type="monotone"
              fill="url(#fillMulti)"
              stroke="var(--color-multi)"
              strokeWidth={2}
            />
            <Area
              dataKey="single"
              type="monotone"
              fill="url(#fillSingle)"
              stroke="var(--color-single)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
