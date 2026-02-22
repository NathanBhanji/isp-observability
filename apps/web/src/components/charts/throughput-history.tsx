"use client";

import React, { useMemo } from "react";
import {
  Area,
  AreaChart,
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
import { useChartBrush } from "@/hooks/use-chart-brush";
import { formatTimestamp } from "@/lib/time-format";

interface ThroughputHistoryProps {
  data: any[];
  direction?: "download" | "upload";
}

export function ThroughputHistory({
  data,
  direction = "download",
}: ThroughputHistoryProps) {
  const brush = useChartBrush();

  // Group tests by approximate time into single/multi pairs
  const pairs = useMemo(() => {
    const result: { timestamp: string; time: string; single: number; multi: number; wanTotal: number }[] = [];
    const singleTests = data?.filter((t: any) => t.stream_count === 1) || [];
    const multiTests = data?.filter((t: any) => t.stream_count > 1) || [];

    const maxLen = Math.max(singleTests.length, multiTests.length);
    for (let i = 0; i < maxLen; i++) {
      const s = singleTests[i];
      const m = multiTests[i];
      const ts = s?.timestamp || m?.timestamp || "";
      const multiSpd = m?.speed_mbps || 0;
      const singleSpd = s?.speed_mbps || 0;
      let wanSpeed: number;
      if (m?.wan_speed_mbps != null) {
        wanSpeed = Math.max(m.wan_speed_mbps, multiSpd);
      } else if (s?.wan_speed_mbps != null && multiSpd === 0) {
        wanSpeed = Math.max(s.wan_speed_mbps, singleSpd);
      } else {
        wanSpeed = multiSpd || singleSpd;
      }
      result.push({
        timestamp: ts,
        time: ts.slice(11, 16),
        single: singleSpd,
        multi: multiSpd,
        wanTotal: Math.round(wanSpeed * 10) / 10,
      });
    }
    return result;
  }, [data]);

  // Compute averages for reference lines
  const { singleAvg, multiAvg } = useMemo(() => {
    const singleValues = pairs.map((p) => p.single).filter((v) => v > 0);
    const multiValues = pairs.map((p) => p.multi).filter((v) => v > 0);
    return {
      singleAvg: singleValues.length > 0
        ? singleValues.reduce((a, b) => a + b, 0) / singleValues.length
        : null,
      multiAvg: multiValues.length > 0
        ? multiValues.reduce((a, b) => a + b, 0) / multiValues.length
        : null,
    };
  }, [pairs]);

  const label = direction === "upload" ? "Upload" : "Download";
  const gradId = direction === "upload" ? "ul" : "dl";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label} History</CardTitle>
        <CardDescription>
          One connection vs four simultaneous connections vs total router traffic — {label.toLowerCase()} speed (Mbps)
          {singleAvg != null && multiAvg != null && (
            <span className="ml-2 font-mono text-[10px]">
              avg: {singleAvg.toFixed(0)} / {multiAvg.toFixed(0)} Mbps
            </span>
          )}
          <span className="ml-2 text-[10px] text-muted-foreground/60">
            Drag to zoom
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={throughputChartConfig}
          className="min-h-[250px] w-full select-none"
        >
          <AreaChart
            data={pairs}
            accessibilityLayer
            onMouseDown={brush.onMouseDown}
            onMouseMove={brush.onMouseMove}
            onMouseUp={brush.onMouseUp}
          >
            <defs>
              <linearGradient id={`fillSingle-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-single)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-single)" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id={`fillMulti-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-multi)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-multi)" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id={`fillWanTotal-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-wanTotal)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="var(--color-wanTotal)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              tickFormatter={(v) => formatTimestamp(v, pairs)}
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
                  labelFormatter={(_, payload) => {
                    const ts = payload?.[0]?.payload?.timestamp;
                    if (!ts) return "";
                    const d = new Date(ts);
                    return d.toLocaleString("en-GB", {
                      day: "numeric", month: "short",
                      hour: "2-digit", minute: "2-digit",
                    });
                  }}
                  formatter={(value, name, item) => (
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                        style={{ "--color-bg": `var(--color-${item.dataKey})` } as React.CSSProperties}
                      />
                      <span className="text-muted-foreground">
                        {throughputChartConfig[item.dataKey as keyof typeof throughputChartConfig]?.label ?? name}
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
            {brush.referenceAreaProps && (
              <ReferenceArea {...brush.referenceAreaProps} />
            )}
            <Area
              dataKey="wanTotal"
              type="monotone"
              fill={`url(#fillWanTotal-${gradId})`}
              stroke="var(--color-wanTotal)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              isAnimationActive={false}
            />
            <Area
              dataKey="multi"
              type="monotone"
              fill={`url(#fillMulti-${gradId})`}
              stroke="var(--color-multi)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              dataKey="single"
              type="monotone"
              fill={`url(#fillSingle-${gradId})`}
              stroke="var(--color-single)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
