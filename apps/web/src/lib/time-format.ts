/**
 * Smart timestamp formatting for chart x-axes.
 * Shows time-only (HH:MM) when data is within one day,
 * adds date prefix (Feb 20 10:30) when spanning multiple days.
 */

/**
 * Format a timestamp for chart axis ticks.
 * Automatically adapts based on the date range of the dataset.
 */
export function formatTimestamp(
  ts: string,
  data: { timestamp: string }[]
): string {
  if (!ts) return "";
  const d = new Date(ts);
  const spansMultipleDays = checkMultipleDays(data);

  if (spansMultipleDays) {
    const month = d.toLocaleString("en-GB", { month: "short" });
    const day = d.getDate();
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${month} ${day} ${time}`;
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Format a timestamp for tooltip labels — always includes date + time. */
export function formatTimestampFull(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format ISO timestamp range for display in the timeframe selector. */
export function formatRange(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  const sameDay =
    f.getFullYear() === t.getFullYear() &&
    f.getMonth() === t.getMonth() &&
    f.getDate() === t.getDate();

  const fmtTime = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const fmtDate = (d: Date) =>
    `${d.toLocaleString("en-GB", { month: "short" })} ${d.getDate()}`;

  if (sameDay) {
    return `${fmtDate(f)}, ${fmtTime(f)} – ${fmtTime(t)}`;
  }
  return `${fmtDate(f)} ${fmtTime(f)} – ${fmtDate(t)} ${fmtTime(t)}`;
}

// ── Internal ───────────────────────────────────────────────────

let _cachedKey: string | undefined;
let _cachedResult = false;

function checkMultipleDays(data: { timestamp: string }[]): boolean {
  if (!data || data.length < 2) return false;
  // Simple cache: if first+last timestamps haven't changed, reuse result
  const key = `${data[0]?.timestamp}|${data[data.length - 1]?.timestamp}`;
  if (key === _cachedKey) return _cachedResult;

  const first = new Date(data[0].timestamp);
  const last = new Date(data[data.length - 1].timestamp);
  _cachedResult =
    first.getFullYear() !== last.getFullYear() ||
    first.getMonth() !== last.getMonth() ||
    first.getDate() !== last.getDate();
  _cachedKey = key;
  return _cachedResult;
}
