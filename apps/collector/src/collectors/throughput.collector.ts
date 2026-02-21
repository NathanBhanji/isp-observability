import { INTERVALS, MULTI_STREAM_COUNT, PING_TARGETS } from "@isp/shared";
import type { Collector } from "../scheduler";
import { getDb } from "../db";
import { runOoklaTest, runOoklaUploadTest } from "../lib/speedtest";
import { pearsonCorrelation } from "../lib/stats";
import { randomUUIDv7 } from "bun";

/**
 * Throughput collector using the Ookla speedtest.net protocol.
 *
 * Auto-discovers the nearest Ookla server, runs single + multi-stream
 * download tests, and simultaneously pings all targets so we can
 * correlate RTT spikes with throughput (bufferbloat/policing evidence).
 */
export class ThroughputCollector implements Collector {
  name = "throughput";
  interval = INTERVALS.throughput;

  async collect(): Promise<string | void> {
    const db = getDb();
    const timestamp = new Date().toISOString();
    const sessionId = randomUUIDv7();

    const insertTest = db.prepare(`
      INSERT INTO throughput_tests (
        timestamp, stream_count, bytes_transferred, duration_ms, speed_mbps, source_url, source_type, direction, idle_latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTimeseries = db.prepare(`
      INSERT INTO throughput_timeseries (test_id, second_offset, bytes_this_second, speed_mbps)
      VALUES (?, ?, ?, ?)
    `);

    const insertCorrelation = db.prepare(`
      INSERT INTO correlation_samples (session_id, timestamp, target_id, rtt_ms, throughput_mbps, pearson_r)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // Shared state for the ping loop
    const correlationTargets = PING_TARGETS.filter((t) =>
      ["aggregation", "bcube", "google"].includes(t.id)
    );
    let pinging = false;
    let currentThroughput = 0;
    const correlationSamples: {
      timestamp: string;
      targetId: string;
      rttMs: number | null;
      throughputMbps: number;
    }[] = [];

    // Ping loop — runs during downloads to capture latency under load
    const startPinging = () => {
      pinging = true;
      return (async () => {
        while (pinging) {
          const pingPromises = correlationTargets.map(async (target) => {
            try {
              const proc = Bun.spawn(["ping", "-c", "1", "-W", "1", target.ip], {
                stdout: "pipe",
                stderr: "pipe",
              });
              const stdout = await new Response(proc.stdout).text();
              await proc.exited;
              const rttMatch = stdout.match(/time=(\d+\.?\d*)\s*ms/);
              return rttMatch ? parseFloat(rttMatch[1]) : null;
            } catch {
              return null;
            }
          });

          const rtts = await Promise.all(pingPromises);
          const ts = new Date().toISOString();

          for (let i = 0; i < correlationTargets.length; i++) {
            correlationSamples.push({
              timestamp: ts,
              targetId: correlationTargets[i].id,
              rttMs: rtts[i],
              throughputMbps: currentThroughput,
            });
          }

          await new Promise((r) => setTimeout(r, 500));
        }
      })();
    };

    const stopPinging = () => {
      pinging = false;
    };

    // ── Single-stream test (with latency pings) ─────────────

    let serverLabel = "ookla";

    try {
      console.log("[throughput] Starting single-stream Ookla test (with latency probes)...");
      const singlePingSampleStart = correlationSamples.length;
      const pingPromise = startPinging();

      const single = await runOoklaTest(1);
      serverLabel = single.server;

      currentThroughput = single.speedMbps;
      stopPinging();
      await pingPromise;

      // Retroactively tag all ping samples from this test with the measured speed
      for (let i = singlePingSampleStart; i < correlationSamples.length; i++) {
        correlationSamples[i].throughputMbps = single.speedMbps;
      }

      const singleResult = insertTest.run(
        timestamp, 1, single.bytesDownloaded, single.durationMs,
        single.speedMbps, `ookla://${single.serverHost}`, "ethernet", "download",
        single.idleLatencyMs ?? null
      );
      const singleTestId = Number(singleResult.lastInsertRowid);

      db.transaction(() => {
        for (const ts of single.timeseries) {
          insertTimeseries.run(singleTestId, ts.secondOffset, ts.bytesThisSecond, ts.speedMbps);
        }
      })();

      console.log(
        `[throughput] Single-stream: ${single.speedMbps} Mbps ` +
          `(${(single.bytesDownloaded / 1024 / 1024).toFixed(1)} MB in ${(single.durationMs / 1000).toFixed(1)}s) ` +
          `via ${single.server}`
      );
    } catch (e) {
      stopPinging();
      console.error("[throughput] Single-stream test failed:", (e as Error).message);
    }

    // Short pause between tests
    await new Promise((r) => setTimeout(r, 2000));

    // ── Multi-stream test (with latency pings) ──────────────

    try {
      console.log(`[throughput] Starting ${MULTI_STREAM_COUNT}-stream Ookla test (with latency probes)...`);
      const multiPingSampleStart = correlationSamples.length;
      const pingPromise = startPinging();

      const multi = await runOoklaTest(MULTI_STREAM_COUNT);
      serverLabel = multi.server;

      currentThroughput = multi.speedMbps;
      stopPinging();
      await pingPromise;

      // Retroactively tag all ping samples from this test with the measured speed
      for (let i = multiPingSampleStart; i < correlationSamples.length; i++) {
        correlationSamples[i].throughputMbps = multi.speedMbps;
      }

      const multiTimestamp = new Date().toISOString();
      const multiResult = insertTest.run(
        multiTimestamp, MULTI_STREAM_COUNT, multi.bytesDownloaded,
        multi.durationMs, multi.speedMbps, `ookla://${multi.serverHost}`, "ethernet", "download",
        multi.idleLatencyMs ?? null
      );
      const multiTestId = Number(multiResult.lastInsertRowid);

      db.transaction(() => {
        for (const ts of multi.timeseries) {
          insertTimeseries.run(multiTestId, ts.secondOffset, ts.bytesThisSecond, ts.speedMbps);
        }
      })();

      console.log(
        `[throughput] Multi-stream (${MULTI_STREAM_COUNT}x): ${multi.speedMbps} Mbps ` +
          `(${(multi.bytesDownloaded / 1024 / 1024).toFixed(1)} MB in ${(multi.durationMs / 1000).toFixed(1)}s) ` +
          `via ${multi.server}`
      );
    } catch (e) {
      stopPinging();
      console.error("[throughput] Multi-stream test failed:", (e as Error).message);
    }

    // ── Compute + store correlation ─────────────────────────

    if (correlationSamples.length > 0) {
      for (const target of correlationTargets) {
        const targetSamples = correlationSamples.filter(
          (s) => s.targetId === target.id && s.rttMs !== null && s.throughputMbps > 0
        );

        const rtts = targetSamples.map((s) => s.rttMs!);
        const throughputs = targetSamples.map((s) => s.throughputMbps);
        const r = pearsonCorrelation(rtts, throughputs);

        db.transaction(() => {
          for (const s of targetSamples) {
            insertCorrelation.run(sessionId, s.timestamp, s.targetId, s.rttMs, s.throughputMbps, null);
          }
          if (targetSamples.length > 0) {
            db.prepare(
              `UPDATE correlation_samples SET pearson_r = ?
               WHERE session_id = ? AND target_id = ?
               AND id = (SELECT MAX(id) FROM correlation_samples WHERE session_id = ? AND target_id = ?)`
            ).run(Math.round(r * 1000) / 1000, sessionId, target.id, sessionId, target.id);
          }
        })();

        console.log(
          `[throughput/correlation] ${target.id}: r=${(Math.round(r * 1000) / 1000).toFixed(3)} ` +
            `(${targetSamples.length} samples during test)`
        );
      }
    }

    // ── Upload tests ──────────────────────────────────────
    // Short pause before upload
    await new Promise((r) => setTimeout(r, 2000));

    // Single-stream upload
    try {
      console.log("[throughput] Starting single-stream upload test...");
      const upload = await runOoklaUploadTest(1);
      const ulTimestamp = new Date().toISOString();

      const ulResult = insertTest.run(
        ulTimestamp, 1, upload.bytesUploaded, upload.durationMs,
        upload.speedMbps, `ookla://${upload.serverHost}`, "ethernet", "upload",
        upload.idleLatencyMs ?? null
      );
      const ulTestId = Number(ulResult.lastInsertRowid);

      db.transaction(() => {
        for (const ts of upload.timeseries) {
          insertTimeseries.run(ulTestId, ts.secondOffset, ts.bytesThisSecond, ts.speedMbps);
        }
      })();

      console.log(
        `[throughput] Upload single-stream: ${upload.speedMbps} Mbps ` +
          `(${(upload.bytesUploaded / 1024 / 1024).toFixed(1)} MB in ${(upload.durationMs / 1000).toFixed(1)}s)`
      );
    } catch (e) {
      console.error("[throughput] Upload single-stream failed:", (e as Error).message);
    }

    // Short pause
    await new Promise((r) => setTimeout(r, 2000));

    // Multi-stream upload
    try {
      console.log(`[throughput] Starting ${MULTI_STREAM_COUNT}-stream upload test...`);
      const uploadMulti = await runOoklaUploadTest(MULTI_STREAM_COUNT);
      const ulMultiTimestamp = new Date().toISOString();

      const ulMultiResult = insertTest.run(
        ulMultiTimestamp, MULTI_STREAM_COUNT, uploadMulti.bytesUploaded,
        uploadMulti.durationMs, uploadMulti.speedMbps, `ookla://${uploadMulti.serverHost}`,
        "ethernet", "upload",
        uploadMulti.idleLatencyMs ?? null
      );
      const ulMultiTestId = Number(ulMultiResult.lastInsertRowid);

      db.transaction(() => {
        for (const ts of uploadMulti.timeseries) {
          insertTimeseries.run(ulMultiTestId, ts.secondOffset, ts.bytesThisSecond, ts.speedMbps);
        }
      })();

      console.log(
        `[throughput] Upload multi-stream (${MULTI_STREAM_COUNT}x): ${uploadMulti.speedMbps} Mbps ` +
          `(${(uploadMulti.bytesUploaded / 1024 / 1024).toFixed(1)} MB in ${(uploadMulti.durationMs / 1000).toFixed(1)}s)`
      );
    } catch (e) {
      console.error("[throughput] Upload multi-stream failed:", (e as Error).message);
    }
  }
}
