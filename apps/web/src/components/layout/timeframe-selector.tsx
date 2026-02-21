"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Clock } from "lucide-react";
import { TIMEFRAMES, DEFAULT_TIMEFRAME } from "@isp/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TimeframeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = searchParams.get("t") || DEFAULT_TIMEFRAME;

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === DEFAULT_TIMEFRAME) {
      params.delete("t");
    } else {
      params.set("t", value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <Clock className="h-4 w-4 text-muted-foreground" />
      <Select value={current} onValueChange={onChange}>
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
