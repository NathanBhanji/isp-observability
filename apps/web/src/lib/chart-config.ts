import { type ChartConfig } from "@/components/ui/chart";
import { PING_TARGETS } from "@isp/shared";

/**
 * Per-hop chart configuration — derived from PING_TARGETS.
 * Colors map to CSS variables defined in globals.css.
 */
export const hopChartConfig = Object.fromEntries(
  PING_TARGETS.map((t) => [
    t.id,
    { label: `${t.label} (${t.ip})`, color: `var(--chart-${t.hop})` },
  ])
) satisfies ChartConfig;

export const throughputChartConfig = {
  single: {
    label: "Single Stream",
    color: "var(--chart-1)",
  },
  multi: {
    label: "4x Parallel",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig;

export const correlationChartConfig = {
  rtt: {
    label: "RTT (ms)",
    color: "var(--chart-3)",
  },
  throughput: {
    label: "Throughput (Mbps)",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;
