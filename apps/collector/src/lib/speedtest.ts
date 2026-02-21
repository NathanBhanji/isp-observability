/**
 * Ookla speedtest.net protocol implementation.
 * No CLI dependency — pure fetch-based.
 *
 * 1. Discovers nearest speedtest.net servers via their public API
 * 2. Measures latency to pick the best server
 * 3. Downloads test files (repeated 4000x4000.jpg) across N streams
 * 4. Returns results compatible with the existing DownloadResult interface
 */

import type { DownloadResult } from "./download";
import { MIN_VALID_DOWNLOAD_BYTES } from "@isp/shared";

// ── Types ────────────────────────────────────────────────────

interface SpeedtestServer {
  id: string;
  host: string;
  name: string;
  country: string;
  sponsor: string;
  url: string;
  distance: number;
  latencyMs?: number;
}

// ── Server discovery (cached per process) ────────────────────

let cachedServer: SpeedtestServer | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

const SERVER_LIST_URL =
  "https://www.speedtest.net/api/js/servers?engine=js&limit=10&https_functional=true";

async function discoverServers(): Promise<SpeedtestServer[]> {
  const res = await fetch(SERVER_LIST_URL, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Server list fetch failed: ${res.status}`);

  const raw: any[] = await res.json();
  return raw.map((s) => ({
    id: String(s.id),
    host: s.host,
    name: s.name,
    country: s.country,
    sponsor: s.sponsor,
    url: s.url,
    distance: s.distance ?? 0,
  }));
}

/**
 * Measure latency to a server by fetching a tiny resource.
 * Returns median of 3 attempts.
 */
async function measureLatency(host: string): Promise<number> {
  const url = `http://${host}/speedtest/latency.txt`;
  const times: number[] = [];

  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.body) await r.body.cancel();
      times.push(performance.now() - start);
    } catch {
      times.push(Infinity);
    }
  }

  times.sort((a, b) => a - b);
  return times[1] ?? times[0]; // median
}

/**
 * Select the best server — pick the closest 5 by distance,
 * then choose the one with lowest latency.
 */
async function selectBestServer(): Promise<SpeedtestServer> {
  // Use cache if fresh
  if (cachedServer && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedServer;
  }

  console.log("[speedtest] Discovering servers...");
  const servers = await discoverServers();

  if (servers.length === 0) {
    throw new Error("No speedtest servers found");
  }

  // Take the closest 5 by distance
  const candidates = servers
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);

  console.log(
    `[speedtest] Testing latency to ${candidates.length} servers: ` +
      candidates.map((s) => s.sponsor).join(", ")
  );

  // Measure latency to each
  await Promise.all(
    candidates.map(async (s) => {
      s.latencyMs = await measureLatency(s.host);
    })
  );

  // Pick lowest latency
  const best = candidates
    .filter((s) => s.latencyMs !== undefined && isFinite(s.latencyMs))
    .sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity))[0];

  if (!best) {
    throw new Error("All speedtest servers unreachable");
  }

  cachedServer = best;
  cacheTime = Date.now();

  console.log(
    `[speedtest] Selected: ${best.sponsor} (${best.name}, ${best.country}) ` +
      `— ${best.distance.toFixed(0)}km, ${best.latencyMs?.toFixed(0)}ms latency`
  );

  return best;
}

// ── Download test ────────────────────────────────────────────

/** Build the download URL for a given server and file size */
function downloadUrl(host: string): string {
  return `http://${host}/speedtest/random4000x4000.jpg`;
}

/**
 * Run a download test against the nearest Ookla server.
 *
 * Each stream downloads the 4000x4000 test file repeatedly for up to
 * `durationSec` seconds. This matches how the real Ookla CLI works —
 * the file is ~30MB, so multiple fetches are needed to fill the pipe.
 */
export async function runOoklaTest(
  streamCount: number = 1,
  durationSec: number = 10
): Promise<DownloadResult & { server: string; serverHost: string }> {
  const server = await selectBestServer();
  const url = downloadUrl(server.host);

  const timeseries: {
    secondOffset: number;
    bytesThisSecond: number;
    speedMbps: number;
  }[] = [];

  const start = performance.now();
  const deadline = start + durationSec * 1000;

  // Per-second byte tracking (shared across all streams)
  let currentSecond = 0;
  let bytesThisSecond = 0;
  let lastSecondMark = start;
  let totalBytes = 0;

  const flushSecond = (now: number) => {
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
  };

  // Each stream downloads files in a loop until the deadline
  const streamWork = async (): Promise<number> => {
    let bytes = 0;

    while (performance.now() < deadline) {
      try {
        const r = await fetch(url, {
          signal: AbortSignal.timeout(durationSec * 1000),
        });
        if (!r.ok || !r.body) break;

        const reader = r.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          bytes += value.byteLength;
          totalBytes += value.byteLength;
          bytesThisSecond += value.byteLength;

          const now = performance.now();
          flushSecond(now);

          if (now >= deadline) {
            // Cancel the rest of the response
            await reader.cancel();
            break;
          }
        }
      } catch {
        // Network error or timeout — stop this stream
        break;
      }
    }

    return bytes;
  };

  await Promise.all(Array.from({ length: streamCount }, () => streamWork()));

  // Flush final partial second
  if (bytesThisSecond > 0) {
    const now = performance.now();
    const elapsed = now - lastSecondMark;
    const speed =
      elapsed > 0
        ? (bytesThisSecond * 8) / (elapsed / 1000) / 1_000_000
        : 0;
    timeseries.push({
      secondOffset: currentSecond,
      bytesThisSecond,
      speedMbps: Math.round(speed * 100) / 100,
    });
  }

  const durationMs = performance.now() - start;

  if (totalBytes < MIN_VALID_DOWNLOAD_BYTES) {
    throw new Error(
      `Speedtest downloaded only ${totalBytes} bytes from ${server.sponsor} — server may be down`
    );
  }

  const speedMbps = (totalBytes * 8) / (durationMs / 1000) / 1_000_000;

  return {
    bytesDownloaded: totalBytes,
    durationMs: Math.round(durationMs),
    speedMbps: Math.round(speedMbps * 100) / 100,
    timeseries,
    server: `${server.sponsor} (${server.name})`,
    serverHost: server.host,
  };
}

// ── Upload test ─────────────────────────────────────────

export interface UploadResult {
  bytesUploaded: number;
  durationMs: number;
  speedMbps: number;
  timeseries: { secondOffset: number; bytesThisSecond: number; speedMbps: number }[];
  server: string;
  serverHost: string;
}

/**
 * Build the upload URL for a given server.
 * Ookla servers accept POST to /speedtest/upload.php
 */
function uploadUrl(host: string): string {
  return `http://${host}/speedtest/upload.php`;
}

/**
 * Generate random upload payload as a Buffer.
 * Buffer extends Uint8Array with guaranteed ArrayBuffer backing.
 */
function generatePayload(bytes: number): Buffer {
  const buf = Buffer.alloc(bytes);
  crypto.getRandomValues(buf);
  return buf;
}

/**
 * Run an upload test against the nearest Ookla server.
 *
 * Each stream uploads random data via HTTP POST for up to `durationSec`
 * seconds. The Ookla upload endpoint accepts POST bodies and returns
 * a small response with the byte count received.
 */
export async function runOoklaUploadTest(
  streamCount: number = 1,
  durationSec: number = 10
): Promise<UploadResult> {
  const server = await selectBestServer();
  const url = uploadUrl(server.host);

  const timeseries: {
    secondOffset: number;
    bytesThisSecond: number;
    speedMbps: number;
  }[] = [];

  const start = performance.now();
  const deadline = start + durationSec * 1000;

  // Per-second byte tracking
  let currentSecond = 0;
  let bytesThisSecond = 0;
  let lastSecondMark = start;
  let totalBytes = 0;

  const flushSecond = (now: number) => {
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
  };

  // Each stream uploads chunks in a loop until the deadline
  // We use 1MB chunks to keep memory usage reasonable
  const CHUNK_SIZE = 1_000_000; // 1 MB

  const streamWork = async (): Promise<number> => {
    let bytes = 0;

    while (performance.now() < deadline) {
      try {
        const payload = generatePayload(CHUNK_SIZE);
        const r = await fetch(url, {
          method: "POST",
          body: payload.buffer as ArrayBuffer,
          headers: {
            "Content-Type": "application/octet-stream",
          },
          signal: AbortSignal.timeout(durationSec * 1000),
        });

        if (!r.ok) {
          // Some servers need form data instead
          if (r.body) await r.body.cancel();
          break;
        }
        if (r.body) await r.body.cancel();

        bytes += payload.byteLength;
        totalBytes += payload.byteLength;
        bytesThisSecond += payload.byteLength;

        const now = performance.now();
        flushSecond(now);

        if (now >= deadline) break;
      } catch {
        break;
      }
    }

    return bytes;
  };

  await Promise.all(Array.from({ length: streamCount }, () => streamWork()));

  // Flush final partial second
  if (bytesThisSecond > 0) {
    const now = performance.now();
    const elapsed = now - lastSecondMark;
    const speed =
      elapsed > 0
        ? (bytesThisSecond * 8) / (elapsed / 1000) / 1_000_000
        : 0;
    timeseries.push({
      secondOffset: currentSecond,
      bytesThisSecond,
      speedMbps: Math.round(speed * 100) / 100,
    });
  }

  const durationMs = performance.now() - start;

  if (totalBytes < MIN_VALID_DOWNLOAD_BYTES) {
    throw new Error(
      `Upload test transferred only ${totalBytes} bytes to ${server.sponsor} — server may not accept uploads`
    );
  }

  const speedMbps = (totalBytes * 8) / (durationMs / 1000) / 1_000_000;

  return {
    bytesUploaded: totalBytes,
    durationMs: Math.round(durationMs),
    speedMbps: Math.round(speedMbps * 100) / 100,
    timeseries,
    server: `${server.sponsor} (${server.name})`,
    serverHost: server.host,
  };
}

/** Force re-discovery on next test (e.g. after network change) */
export function resetServerCache(): void {
  cachedServer = null;
  cacheTime = 0;
}
