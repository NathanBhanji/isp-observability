import { type ChartConfig } from "@/components/ui/chart";
import { PING_TARGETS } from "@isp/shared";

/**
 * Per-hop chart configuration — derived from PING_TARGETS.
 * Colors map to CSS variables defined in globals.css.
 */
export const hopChartConfig = Object.fromEntries(
  PING_TARGETS.map((t) => [
    t.id,
    { label: t.label, color: `var(--chart-${t.hop})` },
  ])
) satisfies ChartConfig;

export const throughputChartConfig = {
  single: {
    label: "Single Connection",
    color: "var(--chart-1)",
  },
  multi: {
    label: "Multiple Connections",
    color: "var(--chart-4)",
  },
  wanTotal: {
    label: "Total Router Traffic",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

export const correlationChartConfig = {
  rtt: {
    label: "Response Time (ms)",
    color: "var(--chart-3)",
  },
  throughput: {
    label: "Download Speed (Mbps)",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export const timeOfDayChartConfig = {
  avgSpeed: {
    label: "Avg Speed (Mbps)",
    color: "var(--chart-1)",
  },
  avgRtt: {
    label: "Avg Response Time (ms)",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

export const congestionOverlayConfig = {
  speed: {
    label: "Download Speed (Mbps)",
    color: "hsl(160 60% 45%)",       // teal
  },
  latency: {
    label: "ISP Backbone Response (ms)",
    color: "hsl(35 90% 55%)",        // amber
  },
  routerLatency: {
    label: "Router Response (ms)",
    color: "hsl(220 15% 55%)",       // blue-grey
  },
  wanSpeed: {
    label: "Total Router Traffic (Mbps)",
    color: "hsl(270 50% 60%)",       // purple
  },
} satisfies ChartConfig;
