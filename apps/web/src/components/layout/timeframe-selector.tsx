"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Clock, X, ZoomIn } from "lucide-react";
import { TIMEFRAMES, DEFAULT_TIMEFRAME } from "@isp/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRange } from "@/lib/time-format";

export function TimeframeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const isCustomRange = !!from;

  const current = searchParams.get("t") || DEFAULT_TIMEFRAME;

  function onPresetChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    // Clear custom range when selecting a preset
    params.delete("from");
    params.delete("to");
    if (value === DEFAULT_TIMEFRAME) {
      params.delete("t");
    } else {
      params.set("t", value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function clearCustomRange() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Custom range mode — show the selected range with reset
  if (isCustomRange && from) {
    return (
      <div className="flex items-center gap-1.5">
        <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
        <Badge
          variant="outline"
          className="font-mono text-[11px] gap-1.5 py-0.5 px-2 border-chart-1/30 bg-chart-1/5 text-foreground"
        >
          {formatRange(from, to || new Date().toISOString())}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={clearCustomRange}
          title="Reset to default timeframe"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // Preset mode — show the dropdown
  return (
    <div className="flex items-center gap-2">
      <Clock className="h-4 w-4 text-muted-foreground" />
      <Select value={current} onValueChange={onPresetChange}>
        <SelectTrigger size="sm" className="min-w-[120px] font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {TIMEFRAMES.map((tf) => (
            <SelectItem key={tf.key} value={tf.key} className="font-mono text-xs">
              {tf.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
