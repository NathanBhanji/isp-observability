"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * Hook that adds drag-to-select time range functionality to any Recharts chart.
 *
 * Usage:
 *   const brush = useChartBrush();
 *
 *   <AreaChart onMouseDown={brush.onMouseDown} onMouseMove={brush.onMouseMove} onMouseUp={brush.onMouseUp}>
 *     {brush.referenceAreaProps && <ReferenceArea {...brush.referenceAreaProps} />}
 *   </AreaChart>
 *
 * The chart data MUST include a `timestamp` field (ISO string) alongside whatever
 * dataKey is used for the x-axis. The hook reads `timestamp` from the active payload
 * to set `?from=` and `?to=` URL params on drag completion.
 */
export function useChartBrush(timestampKey = "timestamp") {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
  const isDragging = useRef(false);

  const onMouseDown = useCallback(
    (e: any) => {
      if (!e?.activePayload?.[0]?.payload?.[timestampKey]) return;
      const ts = e.activePayload[0].payload[timestampKey];
      isDragging.current = true;
      setRefAreaLeft(ts);
      setRefAreaRight(null);
    },
    [timestampKey]
  );

  const onMouseMove = useCallback(
    (e: any) => {
      if (!isDragging.current) return;
      if (!e?.activePayload?.[0]?.payload?.[timestampKey]) return;
      setRefAreaRight(e.activePayload[0].payload[timestampKey]);
    },
    [timestampKey]
  );

  const onMouseUp = useCallback(() => {
    if (!isDragging.current) {
      return;
    }
    isDragging.current = false;

    if (!refAreaLeft || !refAreaRight) {
      setRefAreaLeft(null);
      setRefAreaRight(null);
      return;
    }

    // Ensure left < right (user may drag right-to-left)
    const [from, to] =
      refAreaLeft < refAreaRight
        ? [refAreaLeft, refAreaRight]
        : [refAreaRight, refAreaLeft];

    // Ignore tiny drags (same point)
    if (from === to) {
      setRefAreaLeft(null);
      setRefAreaRight(null);
      return;
    }

    // Navigate with from/to params, removing any preset timeframe
    const params = new URLSearchParams(searchParams.toString());
    params.delete("t");
    params.set("from", from);
    params.set("to", to);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });

    // Reset local state
    setRefAreaLeft(null);
    setRefAreaRight(null);
  }, [refAreaLeft, refAreaRight, router, pathname, searchParams]);

  // Props to spread onto a <ReferenceArea> while dragging
  const referenceAreaProps =
    refAreaLeft && refAreaRight
      ? {
          x1: refAreaLeft < refAreaRight ? refAreaLeft : refAreaRight,
          x2: refAreaLeft < refAreaRight ? refAreaRight : refAreaLeft,
          strokeOpacity: 0.3,
          fill: "hsl(var(--chart-1))",
          fillOpacity: 0.15,
          // Use the timestamp key as the x-axis reference
          xAxisId: undefined as number | undefined,
        }
      : null;

  return {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    referenceAreaProps,
    isSelecting: isDragging.current,
  };
}
