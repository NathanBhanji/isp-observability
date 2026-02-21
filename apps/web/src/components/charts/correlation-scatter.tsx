"use client";

import { Scatter, ScatterChart, CartesianGrid, XAxis, YAxis, ZAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { correlationChartConfig } from "@/lib/chart-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TARGET_LABELS } from "@isp/shared";

interface CorrelationScatterProps {
  samples: any[];
  pearsonR: number | null;
  targetId?: string;
}

export function CorrelationScatter({
  samples,
  pearsonR,
  targetId = "bcube",
}: CorrelationScatterProps) {
  const filteredSamples = (samples || [])
    .filter((s: any) => s.target_id === targetId && s.rtt_ms != null && s.throughput_mbps > 0)
    .map((s: any) => ({
      rtt: s.rtt_ms,
      throughput: s.throughput_mbps,
    }));

  const label = TARGET_LABELS[targetId] || targetId;
  const rStr = pearsonR !== null ? pearsonR.toFixed(3) : "N/A";
  let interpretation = "";
  if (pearsonR !== null) {
    if (Math.abs(pearsonR) < 0.1) {
      interpretation =
        `Near-zero correlation at ${label}. RTT does not increase during downloads.`;
    } else if (pearsonR < -0.3) {
      interpretation =
        `Negative correlation at ${label}: higher RTT corresponds with lower throughput.`;
    } else {
      interpretation = `Weak or positive correlation at ${label} (r=${pearsonR.toFixed(3)}).`;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">RTT vs Throughput — {label}</CardTitle>
        <CardDescription>{interpretation || "Waiting for correlation data..."}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-4">
          <div className="rounded-md border border-border bg-secondary/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">Pearson r = </span>
            <span className="text-lg font-bold font-mono">{rStr}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredSamples.length} sample pairs
          </span>
        </div>
        <ChartContainer config={correlationChartConfig} className="min-h-[250px] w-full">
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
            />
            <YAxis
              dataKey="throughput"
              type="number"
              name="Throughput"
              unit="Mbps"
              tickLine={false}
              axisLine={false}
              fontSize={11}
            />
            <ZAxis range={[30, 30]} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Scatter data={filteredSamples} fill="var(--color-rtt)" fillOpacity={0.6} />
          </ScatterChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
