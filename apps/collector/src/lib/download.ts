import { MULTI_STREAM_COUNT, MIN_VALID_DOWNLOAD_BYTES } from "@isp/shared";

/** Fallback download URL — no longer primary; Ookla speedtest is used instead */
const FALLBACK_DOWNLOAD_URL = "https://speed.cloudflare.com/__down?bytes=50000000";

export interface DownloadResult {
  bytesDownloaded: number;
  durationMs: number;
  speedMbps: number;
  timeseries: { secondOffset: number; bytesThisSecond: number; speedMbps: number }[];
  idleLatencyMs?: number | null;
}

/**
 * Download a file while recording per-second throughput.
 */
async function downloadWithTimeseries(url: string): Promise<DownloadResult> {
  const timeseries: { secondOffset: number; bytesThisSecond: number; speedMbps: number }[] = [];
  let totalBytes = 0;
  let bytesThisSecond = 0;
  let currentSecond = 0;

  const start = performance.now();
  let lastSecondMark = start;

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    bytesThisSecond += value.byteLength;

    const now = performance.now();
    const elapsed = now - lastSecondMark;

    if (elapsed >= 1000) {
      const speed = (bytesThisSecond * 8) / (elapsed / 1000) / 1_000_000;
      timeseries.push({
        secondOffset: currentSecond,
        bytesThisSecond,
        speedMbps: Math.round(speed * 100) / 100,
      });
      currentSecond++;
      bytesThisSecond = 0;
      lastSecondMark = now;
    }
  }

  // Flush remaining bytes
  if (bytesThisSecond > 0) {
    const elapsed = performance.now() - lastSecondMark;
    const speed = elapsed > 0 ? (bytesThisSecond * 8) / (elapsed / 1000) / 1_000_000 : 0;
    timeseries.push({
      secondOffset: currentSecond,
      bytesThisSecond,
      speedMbps: Math.round(speed * 100) / 100,
    });
  }

  const durationMs = performance.now() - start;

  // Reject suspiciously small downloads (broken URLs, placeholder pages, etc.)
  if (totalBytes < MIN_VALID_DOWNLOAD_BYTES) {
    throw new Error(
      `Download too small: ${totalBytes} bytes (minimum ${MIN_VALID_DOWNLOAD_BYTES}). ` +
        `Test file at ${url} may be broken or replaced.`
    );
  }

  const speedMbps = (totalBytes * 8) / (durationMs / 1000) / 1_000_000;

  return {
    bytesDownloaded: totalBytes,
    durationMs: Math.round(durationMs),
    speedMbps: Math.round(speedMbps * 100) / 100,
    timeseries,
  };
}

/**
 * Run a single-stream throughput test.
 */
export async function runSingleStreamTest(
  url: string = FALLBACK_DOWNLOAD_URL
): Promise<DownloadResult> {
  return downloadWithTimeseries(url);
}

/**
 * Run a multi-stream throughput test (parallel downloads).
 */
export async function runMultiStreamTest(
  url: string = FALLBACK_DOWNLOAD_URL,
  streamCount: number = MULTI_STREAM_COUNT
): Promise<DownloadResult> {
  const start = performance.now();

  // Run parallel downloads
  const results = await Promise.all(
    Array.from({ length: streamCount }, () => downloadWithTimeseries(url))
  );

  const durationMs = performance.now() - start;
  const totalBytes = results.reduce((sum, r) => sum + r.bytesDownloaded, 0);
  const speedMbps = (totalBytes * 8) / (durationMs / 1000) / 1_000_000;

  // Merge timeseries: sum bytes per second offset across all streams
  const mergedMap = new Map<number, number>();
  for (const result of results) {
    for (const ts of result.timeseries) {
      mergedMap.set(ts.secondOffset, (mergedMap.get(ts.secondOffset) || 0) + ts.bytesThisSecond);
    }
  }

  const timeseries = Array.from(mergedMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([secondOffset, bytes]) => ({
      secondOffset,
      bytesThisSecond: bytes,
      speedMbps: Math.round((bytes * 8) / 1_000_000 * 100) / 100,
    }));

  return {
    bytesDownloaded: totalBytes,
    durationMs: Math.round(durationMs),
    speedMbps: Math.round(speedMbps * 100) / 100,
    timeseries,
  };
}
