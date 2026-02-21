/**
 * WAN-adjusted speed helpers.
 *
 * These functions compute what the ISP actually delivered to the router
 * (via UPnP WAN counters) vs what the speed test measured on this device.
 * The difference is "background traffic" from other household devices.
 */

// ── Types ────────────────────────────────────────────────────────

export interface ThroughputTest {
  speed_mbps: number;
  duration_ms: number;
  direction: "download" | "upload";
  bytes_transferred: number;
  wan_rx_delta?: number | null;
  wan_tx_delta?: number | null;
  stream_count?: number;
  [key: string]: unknown;
}

// ── Core helpers ─────────────────────────────────────────────────

/**
 * Compute total WAN throughput (Mbps) during a test from UPnP counters.
 * Uses wan_rx_delta for downloads, wan_tx_delta for uploads.
 * Returns null if no WAN data is available.
 */
export function wanSpeedMbps(test: ThroughputTest): number | null {
  const wanDelta =
    test.direction === "upload" ? test.wan_tx_delta : test.wan_rx_delta;
  if (wanDelta == null || !test.duration_ms || test.duration_ms <= 0)
    return null;
  return (wanDelta * 8) / (test.duration_ms / 1000) / 1_000_000;
}

/**
 * Adjusted speed: what the ISP actually delivered.
 * Returns max(measured, wan_total) since the WAN counters capture ALL
 * traffic including the speed test itself. Falls back to measured speed
 * if no WAN data is available.
 */
export function adjustedSpeed(test: ThroughputTest): number {
  const wan = wanSpeedMbps(test);
  if (wan == null) return test.speed_mbps;
  return Math.max(test.speed_mbps, wan);
}

/**
 * Background traffic in Mbps from other household devices.
 * = WAN total - measured speed, clamped to 0.
 */
export function backgroundMbps(test: ThroughputTest): number {
  const wan = wanSpeedMbps(test);
  if (wan == null) return 0;
  return Math.max(0, wan - test.speed_mbps);
}

/**
 * Check if a test had significant background traffic.
 * @param thresholdMB — bytes threshold in MB (default 5 MB)
 */
export function hasSignificantBackground(
  test: ThroughputTest,
  thresholdMB = 5
): boolean {
  const wanDelta =
    test.direction === "upload" ? test.wan_tx_delta : test.wan_rx_delta;
  if (wanDelta == null) return false;
  const bgBytes = Math.max(0, wanDelta - test.bytes_transferred);
  return bgBytes > thresholdMB * 1024 * 1024;
}

// ── Aggregation helpers ──────────────────────────────────────────

/**
 * Compute the median of an array of numbers.
 * Returns null for empty arrays.
 */
export function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute adjusted median speed from a list of tests.
 * Uses adjustedSpeed() on each test, then takes the median.
 */
export function adjustedMedian(tests: ThroughputTest[]): number | null {
  if (tests.length === 0) return null;
  return median(tests.map(adjustedSpeed));
}

/**
 * Determine if a verdict should be softened based on WAN-adjusted speeds.
 *
 * Returns { shouldSoften, adjustedValue, backgroundNote } where:
 * - shouldSoften: true if raw speed triggered a bad verdict but adjusted is OK
 * - adjustedValue: the adjusted speed (for display)
 * - backgroundNote: human-readable explanation of household traffic impact
 */
export function verdictSoftening(
  rawSpeed: number | null,
  adjustedSpd: number | null,
  threshold: number,
  label: string
): {
  shouldSoften: boolean;
  adjustedValue: number | null;
  backgroundNote: string | null;
} {
  if (rawSpeed == null || adjustedSpd == null) {
    return { shouldSoften: false, adjustedValue: adjustedSpd, backgroundNote: null };
  }

  const rawBelow = rawSpeed < threshold;
  const adjustedAbove = adjustedSpd >= threshold;

  if (rawBelow && adjustedAbove) {
    const bgMbps = adjustedSpd - rawSpeed;
    return {
      shouldSoften: true,
      adjustedValue: adjustedSpd,
      backgroundNote: `Your ISP delivered ${adjustedSpd.toFixed(0)} Mbps to the router, but ~${bgMbps.toFixed(0)} Mbps was used by other devices — leaving ${rawSpeed.toFixed(0)} Mbps for ${label}`,
    };
  }

  if (rawBelow && !adjustedAbove) {
    return {
      shouldSoften: false,
      adjustedValue: adjustedSpd,
      backgroundNote:
        adjustedSpd > rawSpeed
          ? `ISP delivered ${adjustedSpd.toFixed(0)} Mbps (still below ${threshold} Mbps threshold even accounting for household traffic)`
          : null,
    };
  }

  return { shouldSoften: false, adjustedValue: adjustedSpd, backgroundNote: null };
}
