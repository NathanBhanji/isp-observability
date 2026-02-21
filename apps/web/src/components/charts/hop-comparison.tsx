"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TARGET_LABELS, TARGET_IPS, PING_TARGETS } from "@isp/shared";

interface HopComparisonProps {
  allHops?: any[];
  hopA?: any;
  hopB?: any;
  hopAId?: string;
  hopBId?: string;
}

function getDeltaVariant(delta: number, unit: string): "destructive" | "secondary" | "outline" {
  const abs = Math.abs(delta);
  if (unit === "%" && abs > 1) return "destructive";
  if (unit === "ms" && abs > 5) return "destructive";
  if (unit === "ms" && abs > 1) return "outline";
  if (unit === "" && abs > 5) return "destructive";
  if (unit === "" && abs > 2) return "outline";
  return "secondary";
}

function getDeltaColor(delta: number, unit: string, worseBigger: boolean): string {
  const isWorse = worseBigger ? delta > 0 : delta < 0;
  if (!isWorse) return "text-success";
  const abs = Math.abs(delta);
  if (unit === "ms" && abs > 5) return "text-destructive";
  if (unit === "ms" && abs > 1) return "text-warning";
  if (unit === "%" && abs > 1) return "text-destructive";
  if (unit === "" && abs > 5) return "text-destructive";
  return "text-warning";
}

export function HopComparison({ allHops, hopA, hopB, hopAId = "aggregation", hopBId = "bcube" }: HopComparisonProps) {
  const [selectedA, setSelectedA] = useState(hopAId);
  const [selectedB, setSelectedB] = useState(hopBId);

  // If allHops is provided, use it for selection; otherwise fall back to passed-in hops
  const resolvedHopA = allHops
    ? (allHops || []).find((p: any) => p.target_id === selectedA)
    : hopA;
  const resolvedHopB = allHops
    ? (allHops || []).find((p: any) => p.target_id === selectedB)
    : hopB;

  const actualAId = allHops ? selectedA : hopAId;
  const actualBId = allHops ? selectedB : hopBId;

  if (!resolvedHopA || !resolvedHopB) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adjacent Hop Comparison</CardTitle>
          <CardDescription>Waiting for data...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const labelA = TARGET_LABELS[actualAId] || actualAId;
  const labelB = TARGET_LABELS[actualBId] || actualBId;
  const ipA = TARGET_IPS[actualAId] || "";
  const ipB = TARGET_IPS[actualBId] || "";

  const rows = [
    { metric: "Mean RTT", h2: resolvedHopA.rtt_mean, h3: resolvedHopB.rtt_mean, unit: "ms", worseBigger: true },
    { metric: "P50 RTT", h2: resolvedHopA.rtt_p50, h3: resolvedHopB.rtt_p50, unit: "ms", worseBigger: true },
    { metric: "P95 RTT", h2: resolvedHopA.rtt_p95, h3: resolvedHopB.rtt_p95, unit: "ms", worseBigger: true },
    { metric: "P99 RTT", h2: resolvedHopA.rtt_p99, h3: resolvedHopB.rtt_p99, unit: "ms", worseBigger: true },
    { metric: "Std Dev", h2: resolvedHopA.rtt_stddev, h3: resolvedHopB.rtt_stddev, unit: "ms", worseBigger: true },
    { metric: "Jitter (mean)", h2: resolvedHopA.jitter_mean, h3: resolvedHopB.jitter_mean, unit: "ms", worseBigger: true },
    { metric: "Jitter (max)", h2: resolvedHopA.jitter_max, h3: resolvedHopB.jitter_max, unit: "ms", worseBigger: true },
    { metric: "Packet Loss", h2: resolvedHopA.loss_pct, h3: resolvedHopB.loss_pct, unit: "%", worseBigger: true },
    { metric: "Spikes >10ms", h2: resolvedHopA.spikes_10ms, h3: resolvedHopB.spikes_10ms, unit: "", worseBigger: true },
    { metric: "Spikes >15ms", h2: resolvedHopA.spikes_15ms, h3: resolvedHopB.spikes_15ms, unit: "", worseBigger: true },
    { metric: "Spikes >20ms", h2: resolvedHopA.spikes_20ms, h3: resolvedHopB.spikes_20ms, unit: "", worseBigger: true },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <CardTitle className="text-base">
              Hop Comparison
            </CardTitle>
            <CardDescription>
              Side-by-side latency metrics ({ipA} vs {ipB})
            </CardDescription>
          </div>
          {allHops && (
            <div className="flex items-center gap-2">
              <Select value={selectedA} onValueChange={setSelectedA}>
                <SelectTrigger className="w-[130px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PING_TARGETS.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">vs</span>
              <Select value={selectedB} onValueChange={setSelectedB}>
                <SelectTrigger className="w-[130px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PING_TARGETS.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Metric</TableHead>
              <TableHead className="text-right">
                <span className="text-chart-2">{labelA}</span>
                <span className="text-muted-foreground text-xs ml-1">{ipA}</span>
              </TableHead>
              <TableHead className="text-right">
                <span className="text-chart-3">{labelB}</span>
                <span className="text-muted-foreground text-xs ml-1">{ipB}</span>
              </TableHead>
              <TableHead className="text-right w-[80px]">Delta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const h2Val = row.h2 ?? 0;
              const h3Val = row.h3 ?? 0;
              const delta = h3Val - h2Val;
              const isWorse = row.worseBigger ? delta > 0 : delta < 0;
              const deltaStr = delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
              const variant = getDeltaVariant(delta, row.unit);
              const color = isWorse ? getDeltaColor(delta, row.unit, row.worseBigger) : "";

              return (
                <TableRow key={row.metric}>
                  <TableCell className="font-medium text-sm">{row.metric}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {h2Val?.toFixed(2)}{row.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {h3Val?.toFixed(2)}{row.unit}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={isWorse ? variant : "secondary"}
                      className={`font-mono text-[10px] px-1.5 ${color}`}
                    >
                      {deltaStr}{row.unit}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
