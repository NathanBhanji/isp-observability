"use client";

import { useMemo, useState } from "react";
import { Scatter, ScatterChart, CartesianGrid, XAxis, YAxis, ZAxis, ReferenceLine } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { correlationChartConfig } from "@/lib/chart-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TARGET_LABELS } from "@isp/shared";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface CorrelationScatterProps {
  samples: any[];
  correlations?: any[];
  pearsonR: number | null;
  targetId?: string;
}

function linearRegression(data: { rtt: number; throughput: number }[]) {
  if (data.length < 2) return null;
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const d of data) {
    sumX += d.rtt;
    sumY += d.throughput;
    sumXY += d.rtt * d.throughput;
    sumX2 += d.rtt * d.rtt;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function ScatterPanel({
  samples,
  pearsonR,
  targetId,
}: {
  samples: any[];
  pearsonR: number | null;
  targetId: string;
}) {
  const filteredSamples = useMemo(() => 
    (samples || [])
      .filter((s: any) => s.target_id === targetId && s.rtt_ms != null && s.throughput_mbps > 0)
      .map((s: any) => ({
        rtt: s.rtt_ms,
        throughput: s.throughput_mbps,
      })),
    [samples, targetId]
  );

  const regression = useMemo(() => linearRegression(filteredSamples), [filteredSamples]);

  // Compute data bounds for auto-scaling
  const bounds = useMemo(() => {
    if (filteredSamples.length === 0) return { minX: 0, maxX: 20, minY: 0, maxY: 1000 };
    const rtts = filteredSamples.map((s) => s.rtt);
    const tps = filteredSamples.map((s) => s.throughput);
    const pad = 0.1;
    const minX = Math.max(0, Math.min(...rtts) * (1 - pad));
    const maxX = Math.max(...rtts) * (1 + pad);
    const minY = Math.max(0, Math.min(...tps) * (1 - pad));
    const maxY = Math.max(...tps) * (1 + pad);
    return { minX, maxX, minY, maxY };
  }, [filteredSamples]);

  // Regression line endpoints
  const regressionLine = useMemo(() => {
    if (!regression || filteredSamples.length < 2) return null;
    const x1 = bounds.minX;
    const x2 = bounds.maxX;
    const y1 = regression.slope * x1 + regression.intercept;
    const y2 = regression.slope * x2 + regression.intercept;
    return [
      { rtt: x1, throughput: Math.max(0, y1) },
      { rtt: x2, throughput: Math.max(0, y2) },
    ];
  }, [regression, filteredSamples, bounds]);

  const label = TARGET_LABELS[targetId] || targetId;
  const rStr = pearsonR !== null ? pearsonR.toFixed(3) : "N/A";
  let interpretation = "";
  if (pearsonR !== null) {
    const abs = Math.abs(pearsonR);
    if (abs < 0.1) {
      interpretation = `No meaningful correlation at ${label}. RTT is independent of throughput.`;
    } else if (abs < 0.3) {
      interpretation = `Weak correlation at ${label} (r=${rStr}). Minimal bufferbloat signal.`;
    } else if (abs < 0.5) {
      interpretation = `Moderate correlation at ${label} (r=${rStr}). Some bufferbloat likely present.`;
    } else if (pearsonR > 0) {
      interpretation = `Strong positive correlation at ${label} (r=${rStr}). Clear bufferbloat detected.`;
    } else {
      interpretation = `Strong negative correlation at ${label} (r=${rStr}). Anomalous — may indicate a route change.`;
    }
  }

  // Color the r value by strength
  const rColor = pearsonR !== null
    ? Math.abs(pearsonR) < 0.1 ? "text-muted-foreground"
      : Math.abs(pearsonR) < 0.3 ? "text-success"
      : Math.abs(pearsonR) < 0.5 ? "text-warning"
      : "text-destructive"
    : "text-muted-foreground";

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <div className="rounded-md border border-border bg-secondary/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">Pearson r = </span>
          <span className={`text-lg font-bold font-mono ${rColor}`}>{rStr}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {filteredSamples.length} sample pairs
        </span>
      </div>
      {interpretation && (
        <p className="text-xs text-muted-foreground mb-3">{interpretation}</p>
      )}
      <ChartContainer config={correlationChartConfig} className="min-h-[280px] w-full">
        <ScatterChart accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="rtt"
            type="number"
            name="RTT"
            unit="ms"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            domain={[bounds.minX, bounds.maxX]}
          />
          <YAxis
            dataKey="throughput"
            type="number"
            name="Throughput"
            unit=" Mbps"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            domain={[bounds.minY, bounds.maxY]}
          />
          <ZAxis range={[40, 40]} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Scatter data={filteredSamples} fill="var(--color-rtt)" fillOpacity={0.6} />
          {regressionLine && (
            <Scatter
              data={regressionLine}
              fill="none"
              line={{ stroke: "var(--color-throughput)", strokeWidth: 2, strokeDasharray: "6 3" }}
              lineType="joint"
              legendType="none"
              shape={({ cx, cy }: { cx?: number; cy?: number }) => (
                <circle cx={cx} cy={cy} r={0} fill="none" />
              )}
            />
          )}
        </ScatterChart>
      </ChartContainer>
    </div>
  );
}

export function CorrelationScatter({
  samples,
  correlations,
  pearsonR,
  targetId = "bcube",
}: CorrelationScatterProps) {
  const targets = ["aggregation", "bcube", "google"];
  const corrMap = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const t of targets) {
      const c = (correlations || []).find((c: any) => c.target_id === t);
      m[t] = c?.pearson_r ?? (t === targetId ? pearsonR : null);
    }
    return m;
  }, [correlations, pearsonR, targetId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">RTT vs Throughput</CardTitle>
        <CardDescription>
          Scatter plot with linear regression — each dot is a simultaneous RTT + throughput measurement
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={targetId}>
          <TabsList>
            {targets.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TARGET_LABELS[t] || t}
                {corrMap[t] != null && (
                  <span className="ml-1 text-[10px] font-mono opacity-70">
                    r={corrMap[t]!.toFixed(2)}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {targets.map((t) => (
            <TabsContent key={t} value={t} className="mt-4">
              <ScatterPanel
                samples={samples}
                pearsonR={corrMap[t]}
                targetId={t}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
