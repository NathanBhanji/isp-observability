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
      interpretation = `No meaningful link at ${label}. Response time doesn't seem to affect speed.`;
    } else if (abs < 0.3) {
      interpretation = `Weak link at ${label}. Minimal sign of network congestion.`;
    } else if (abs < 0.5) {
      interpretation = `Moderate link at ${label}. Some network congestion is likely.`;
    } else if (pearsonR > 0) {
      interpretation = `Strong link at ${label}. Clear network congestion detected — your connection slows down under load.`;
    } else {
      interpretation = `Unusual pattern at ${label}. Your traffic may have been rerouted.`;
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
            <span className="text-xs text-muted-foreground">Correlation: </span>
            <span className={`text-lg font-bold font-mono ${rColor}`}>{rStr}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredSamples.length} measurements
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
            name="Response Time"
            unit="ms"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            domain={[bounds.minX, bounds.maxX]}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <YAxis
            dataKey="throughput"
            type="number"
            name="Speed"
            unit=" Mbps"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            domain={[bounds.minY, bounds.maxY]}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <ZAxis range={[80, 80]} />
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
        <CardTitle className="text-base">Response Time vs Speed</CardTitle>
        <CardDescription>
          Each dot shows a response time and speed test taken at the same time — the trend line reveals whether slower responses coincide with slower speeds
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={targetId}>
          <TabsList>
            {targets.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TARGET_LABELS[t] || t}
                {corrMap[t] != null && (
                   <span className={`ml-1.5 inline-block h-2 w-2 rounded-full ${
                     Math.abs(corrMap[t]!) < 0.1 ? "bg-muted-foreground/40"
                     : Math.abs(corrMap[t]!) < 0.3 ? "bg-success"
                     : Math.abs(corrMap[t]!) < 0.5 ? "bg-warning"
                     : "bg-destructive"
                   }`} title={`r=${corrMap[t]!.toFixed(2)}`} />
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
