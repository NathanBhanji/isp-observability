/**
 * Statistical computation helpers for RTT analysis.
 */

/** Sort numbers ascending (non-destructive) */
function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Mean of values */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Median of values */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = sorted(values);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Standard deviation (population) */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Percentile (0-100) */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = sorted(values);
  const index = (p / 100) * (s.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return s[lower];
  return s[lower] + (s[upper] - s[lower]) * (index - lower);
}

/** Jitter: consecutive inter-packet RTT deltas */
export function jitter(rtts: number[]): { mean: number; max: number } {
  if (rtts.length < 2) return { mean: 0, max: 0 };
  const deltas: number[] = [];
  for (let i = 1; i < rtts.length; i++) {
    deltas.push(Math.abs(rtts[i] - rtts[i - 1]));
  }
  return {
    mean: mean(deltas),
    max: Math.max(...deltas),
  };
}

/** Count values exceeding thresholds */
export function spikeCounts(
  values: number[],
  thresholds: readonly number[]
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const t of thresholds) {
    counts[t] = values.filter((v) => v > t).length;
  }
  return counts;
}

/** Pearson correlation coefficient between two arrays */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;

  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));

  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  if (denom === 0) return 0;
  return sumXY / denom;
}

/** Compute all RTT statistics from a set of samples */
export function computeRttStats(
  rtts: (number | null)[],
  spikeThresholds: readonly number[]
): {
  sent: number;
  received: number;
  lossPct: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  jitterMean: number | null;
  jitterMax: number | null;
  spikes: Record<number, number>;
} {
  const sent = rtts.length;
  const valid = rtts.filter((r): r is number => r !== null);
  const received = valid.length;
  const lossPct = sent > 0 ? ((sent - received) / sent) * 100 : 0;

  if (valid.length === 0) {
    const spikes: Record<number, number> = {};
    for (const t of spikeThresholds) spikes[t] = 0;
    return {
      sent,
      received,
      lossPct,
      min: null,
      max: null,
      mean: null,
      median: null,
      stddev: null,
      p50: null,
      p90: null,
      p95: null,
      p99: null,
      jitterMean: null,
      jitterMax: null,
      spikes,
    };
  }

  const j = jitter(valid);

  return {
    sent,
    received,
    lossPct: Math.round(lossPct * 100) / 100,
    min: Math.min(...valid),
    max: Math.max(...valid),
    mean: Math.round(mean(valid) * 1000) / 1000,
    median: Math.round(median(valid) * 1000) / 1000,
    stddev: Math.round(stddev(valid) * 1000) / 1000,
    p50: Math.round(percentile(valid, 50) * 1000) / 1000,
    p90: Math.round(percentile(valid, 90) * 1000) / 1000,
    p95: Math.round(percentile(valid, 95) * 1000) / 1000,
    p99: Math.round(percentile(valid, 99) * 1000) / 1000,
    jitterMean: Math.round(j.mean * 1000) / 1000,
    jitterMax: Math.round(j.max * 1000) / 1000,
    spikes: spikeCounts(valid, spikeThresholds),
  };
}
