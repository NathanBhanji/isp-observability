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
