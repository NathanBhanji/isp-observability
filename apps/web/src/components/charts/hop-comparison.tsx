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
import { TARGET_LABELS, TARGET_IPS } from "@isp/shared";

interface HopComparisonProps {
  hopA: any;
  hopB: any;
  hopAId?: string;
  hopBId?: string;
}

export function HopComparison({ hopA, hopB, hopAId = "aggregation", hopBId = "bcube" }: HopComparisonProps) {
  if (!hopA || !hopB) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adjacent Hop Comparison</CardTitle>
          <CardDescription>Waiting for data...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const labelA = TARGET_LABELS[hopAId] || hopAId;
  const labelB = TARGET_LABELS[hopBId] || hopBId;
  const ipA = TARGET_IPS[hopAId] || "";
  const ipB = TARGET_IPS[hopBId] || "";

  const rows = [
    { metric: "Mean RTT", h2: hopA.rtt_mean, h3: hopB.rtt_mean, unit: "ms", worseBigger: true },
    { metric: "P50 RTT", h2: hopA.rtt_p50, h3: hopB.rtt_p50, unit: "ms", worseBigger: true },
    { metric: "P95 RTT", h2: hopA.rtt_p95, h3: hopB.rtt_p95, unit: "ms", worseBigger: true },
    { metric: "P99 RTT", h2: hopA.rtt_p99, h3: hopB.rtt_p99, unit: "ms", worseBigger: true },
    { metric: "Std Dev", h2: hopA.rtt_stddev, h3: hopB.rtt_stddev, unit: "ms", worseBigger: true },
    { metric: "Jitter (mean)", h2: hopA.jitter_mean, h3: hopB.jitter_mean, unit: "ms", worseBigger: true },
    { metric: "Jitter (max)", h2: hopA.jitter_max, h3: hopB.jitter_max, unit: "ms", worseBigger: true },
    { metric: "Packet Loss", h2: hopA.loss_pct, h3: hopB.loss_pct, unit: "%", worseBigger: true },
    { metric: "Spikes >10ms", h2: hopA.spikes_10ms, h3: hopB.spikes_10ms, unit: "", worseBigger: true },
    { metric: "Spikes >15ms", h2: hopA.spikes_15ms, h3: hopB.spikes_15ms, unit: "", worseBigger: true },
    { metric: "Spikes >20ms", h2: hopA.spikes_20ms, h3: hopB.spikes_20ms, unit: "", worseBigger: true },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {labelA} vs {labelB} Comparison
        </CardTitle>
        <CardDescription>
          Side-by-side latency metrics for adjacent hops ({ipA} vs {ipB})
        </CardDescription>
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
                      variant={isWorse ? "destructive" : "secondary"}
                      className="font-mono text-[10px] px-1.5"
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
