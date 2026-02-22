import { Hono } from "hono";
import { getDb } from "../db";
import { PING_TARGETS, TARGET_LABELS, TARGET_IPS } from "@isp/shared";
import { median } from "../lib/stats";

const evidence = new Hono();

/** Data summary for evidence report — ?since=ISO or all time */
evidence.get("/summary", (c) => {
  const since = c.req.query("since");
  const db = getDb();

  const timeFilter = (col = "timestamp") =>
    since ? `AND ${col} >= ?` : "";
  const timeParams = () => (since ? [since] : []);

  // ── Per-Hop Comparison (all monitored targets) ──────────
  let hopComparison = null;
  try {
    const hops: { targetId: string; label: string; ip: string; stddev: number; spikes15msPct: number; meanRtt: number }[] = [];

    for (const target of PING_TARGETS) {
      const row = db
        .prepare(
          `SELECT
             AVG(rtt_stddev) as avg_stddev,
             AVG(rtt_mean) as avg_mean,
             SUM(spikes_15ms) as total_spikes_15,
             SUM(samples_sent) as total_sent
           FROM ping_windows WHERE target_id = ? ${timeFilter()}`
        )
        .get(target.id, ...timeParams()) as any;

      if (row?.avg_stddev != null) {
        hops.push({
          targetId: target.id,
          label: target.label,
          ip: target.ip,
          stddev: Math.round(row.avg_stddev * 1000) / 1000,
          spikes15msPct:
            row.total_sent > 0
              ? Math.round((row.total_spikes_15 / row.total_sent) * 10000) / 100
              : 0,
          meanRtt: Math.round(row.avg_mean * 1000) / 1000,
        });
      }
    }

    if (hops.length > 0) {
      hopComparison = { hops };
    }
  } catch (e) {
    console.warn("[evidence] Hop comparison failed:", (e as Error).message);
  }

  // ── Throughput Comparison (multi-stream DL vs UL) ────────
  let throughputPolicing = null;
  try {
    const multiDlAvg = db
      .prepare(
        `SELECT AVG(speed_mbps) as avg_speed, COUNT(*) as cnt FROM throughput_tests
         WHERE stream_count > 1 AND direction = 'download' ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    const multiUlAvg = db
      .prepare(
        `SELECT AVG(speed_mbps) as avg_speed, COUNT(*) as cnt FROM throughput_tests
         WHERE stream_count > 1 AND direction = 'upload' ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    // Also fetch single-stream for context / policing ratio
    const singleDlAvg = db
      .prepare(
        `SELECT AVG(speed_mbps) as avg_speed FROM throughput_tests
         WHERE stream_count = 1 AND direction = 'download' ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    // WAN-adjusted averages: MAX(speed_mbps, wan_speed) where wan_speed = wan_delta * 8 / (duration_ms/1000) / 1e6
    const adjMultiDlAvg = db
      .prepare(
        `SELECT AVG(
           CASE
             WHEN wan_rx_delta IS NOT NULL AND duration_ms > 0
               THEN MAX(speed_mbps, (wan_rx_delta * 8.0) / (duration_ms / 1000.0) / 1000000.0)
             ELSE speed_mbps
           END
         ) as avg_speed
         FROM throughput_tests
         WHERE stream_count > 1 AND direction = 'download' ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    const adjMultiUlAvg = db
      .prepare(
        `SELECT AVG(
           CASE
             WHEN wan_tx_delta IS NOT NULL AND duration_ms > 0
               THEN MAX(speed_mbps, (wan_tx_delta * 8.0) / (duration_ms / 1000.0) / 1000000.0)
             ELSE speed_mbps
           END
         ) as avg_speed
         FROM throughput_tests
         WHERE stream_count > 1 AND direction = 'upload' ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    const adjSingleDlAvg = db
      .prepare(
        `SELECT AVG(
           CASE
             WHEN wan_rx_delta IS NOT NULL AND duration_ms > 0
               THEN MAX(speed_mbps, (wan_rx_delta * 8.0) / (duration_ms / 1000.0) / 1000000.0)
             ELSE speed_mbps
           END
         ) as avg_speed
         FROM throughput_tests
         WHERE stream_count = 1 AND direction = 'download' ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    const multiDlSpeed = multiDlAvg?.avg_speed ?? null;
    const multiUlSpeed = multiUlAvg?.avg_speed ?? null;
    const singleDlSpeed = singleDlAvg?.avg_speed ?? null;

    const adjMultiDlSpeed = adjMultiDlAvg?.avg_speed ?? null;
    const adjMultiUlSpeed = adjMultiUlAvg?.avg_speed ?? null;
    const adjSingleDlSpeed = adjSingleDlAvg?.avg_speed ?? null;

    if (multiDlSpeed != null && multiUlSpeed != null) {
      const dlUlRatio = multiUlSpeed > 0
        ? Math.round((multiDlSpeed / multiUlSpeed) * 100) / 100
        : null;

      // Single/multi policing ratio (download only) — raw
      const policingRatio = singleDlSpeed != null && singleDlSpeed > 0
        ? Math.round((multiDlSpeed / singleDlSpeed) * 100) / 100
        : null;

      // WAN-adjusted policing ratio
      const adjustedPolicingRatio = adjSingleDlSpeed != null && adjSingleDlSpeed > 0
        ? Math.round((adjMultiDlSpeed! / adjSingleDlSpeed) * 100) / 100
        : null;

      // Decay detection on latest multi-stream download
      let decayDetected = false;
      const latestTest = db
        .prepare(
          `SELECT id FROM throughput_tests
         WHERE stream_count > 1 AND direction = 'download' ${timeFilter()}
           ORDER BY id DESC LIMIT 1`
        )
        .get(...timeParams()) as any;

      if (latestTest) {
        const timeseries = db
          .prepare(
            "SELECT speed_mbps FROM throughput_timeseries WHERE test_id = ? ORDER BY second_offset ASC"
          )
          .all(latestTest.id) as any[];

        if (timeseries.length >= 5) {
          const firstThird = timeseries.slice(0, Math.ceil(timeseries.length / 3));
          const lastThird = timeseries.slice(-Math.ceil(timeseries.length / 3));
          const firstAvg =
            firstThird.reduce((s: number, r: any) => s + r.speed_mbps, 0) / firstThird.length;
          const lastAvg =
            lastThird.reduce((s: number, r: any) => s + r.speed_mbps, 0) / lastThird.length;
          decayDetected = firstAvg > lastAvg * 2;
        }
      }

      throughputPolicing = {
        multiDownloadMean: Math.round(multiDlSpeed * 100) / 100,
        multiUploadMean: Math.round(multiUlSpeed * 100) / 100,
        dlUlRatio,
        singleStreamMean: singleDlSpeed != null ? Math.round(singleDlSpeed * 100) / 100 : null,
        policingRatio,
        // WAN-adjusted fields
        adjustedMultiDownloadMean: adjMultiDlSpeed != null ? Math.round(adjMultiDlSpeed * 100) / 100 : null,
        adjustedMultiUploadMean: adjMultiUlSpeed != null ? Math.round(adjMultiUlSpeed * 100) / 100 : null,
        adjustedSingleStreamMean: adjSingleDlSpeed != null ? Math.round(adjSingleDlSpeed * 100) / 100 : null,
        adjustedPolicingRatio,
        downloadTests: multiDlAvg.cnt ?? 0,
        uploadTests: multiUlAvg.cnt ?? 0,
        decayDetected,
      };
    }
  } catch (e) {
    console.warn("[evidence] Throughput comparison failed:", (e as Error).message);
  }

  // ── Correlation ─────────────────────────────────────────
  let correlationEvidence = null;
  try {
    // Get the most recent correlation from any target
    const latest = db
      .prepare(
        `SELECT target_id, pearson_r FROM correlation_samples
         WHERE pearson_r IS NOT NULL ${timeFilter()}
         ORDER BY id DESC LIMIT 1`
      )
      .get(...timeParams()) as any;

    if (latest?.pearson_r != null) {
      const r = latest.pearson_r;
      const label = TARGET_LABELS[latest.target_id] || latest.target_id;
      let interpretation: string;
      if (Math.abs(r) < 0.1) {
        interpretation =
          `Near-zero correlation (r=${r.toFixed(3)}) between ${label} RTT and throughput. ` +
          "RTT does not increase during downloads, which is inconsistent with bufferbloat.";
      } else if (r < -0.3) {
        interpretation =
          `Negative correlation (r=${r.toFixed(3)}): higher RTT correlates with lower throughput at ${label}, ` +
          "which may indicate congestion.";
      } else {
        interpretation = `Correlation r=${r.toFixed(3)} at ${label} — further analysis needed.`;
      }

      correlationEvidence = {
        pearsonR: Math.round(r * 1000) / 1000,
        interpretation,
      };
    }
  } catch (e) {
    console.warn("[evidence] Correlation failed:", (e as Error).message);
  }

  // ── Path Analysis ───────────────────────────────────────
  let pathAnalysis = null;
  try {
    const yourTraces = db
      .prepare(
        `SELECT AVG(hop_count) as avg_hops FROM traceroutes
         WHERE destination = '8.8.8.8' ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    const peerTraces = db
      .prepare(
        `SELECT AVG(hop_count) as avg_hops, COUNT(*) as total
         FROM ripe_atlas_results WHERE 1=1 ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    // Count how many peer traceroutes matched each target
    const matchedRows = db
      .prepare(
        `SELECT matched_target_ids FROM ripe_atlas_results
         WHERE matched_target_ids != '' ${timeFilter()}`
      )
      .all(...timeParams()) as { matched_target_ids: string }[];

    const peersMatchedTargets: Record<string, number> = {};
    for (const row of matchedRows) {
      for (const tid of row.matched_target_ids.split(",")) {
        peersMatchedTargets[tid] = (peersMatchedTargets[tid] || 0) + 1;
      }
    }

    if (yourTraces?.avg_hops != null) {
      pathAnalysis = {
        yourHopCount: Math.round(yourTraces.avg_hops),
        peerMeanHopCount: peerTraces?.avg_hops ? Math.round(peerTraces.avg_hops) : 0,
        peersMatchedTargets,
      };
    }
  } catch (e) {
    console.warn("[evidence] Path analysis failed:", (e as Error).message);
  }

  // ── Packet Loss ──────────────────────────────────────────
  let packetLoss = null;
  try {
    const perTarget: Record<string, { avgLoss: number; maxLoss: number; windows: number }> = {};

    for (const target of PING_TARGETS) {
      const row = db
        .prepare(
          `SELECT AVG(loss_pct) as avg_loss, MAX(loss_pct) as max_loss, COUNT(*) as cnt
           FROM ping_windows WHERE target_id = ? ${timeFilter()}`
        )
        .get(target.id, ...timeParams()) as any;

      if (row?.cnt > 0) {
        perTarget[target.id] = {
          avgLoss: Math.round((row.avg_loss ?? 0) * 1000) / 1000,
          maxLoss: Math.round((row.max_loss ?? 0) * 1000) / 1000,
          windows: row.cnt,
        };
      }
    }

    const lossyWindows = db
      .prepare(
        `SELECT target_id, COUNT(*) as cnt FROM ping_windows
         WHERE loss_pct > 0 ${timeFilter()}
         GROUP BY target_id`
      )
      .all(...timeParams()) as any[];

    const lossyMap: Record<string, number> = {};
    for (const row of lossyWindows) {
      lossyMap[row.target_id] = row.cnt;
    }

    if (Object.keys(perTarget).length > 0) {
      packetLoss = { perTarget, lossyWindowsPerTarget: lossyMap };
    }
  } catch (e) {
    console.warn("[evidence] Packet loss failed:", (e as Error).message);
  }

  // ── Time-of-Day Analysis (uses first non-gateway target for latency) ──
  let timeOfDay = null;
  try {
    // Aggregate hourly latency across ALL targets (grouped by hour)
    const hourlyLatency = db
      .prepare(
        `SELECT
           CAST(strftime('%H', timestamp) AS INTEGER) as hour,
           AVG(rtt_mean) as avg_rtt,
           AVG(rtt_stddev) as avg_stddev,
           AVG(loss_pct) as avg_loss,
           COUNT(*) as cnt
         FROM ping_windows
         WHERE target_id != 'gateway' ${timeFilter()}
         GROUP BY hour
         ORDER BY hour`
      )
      .all(...timeParams()) as any[];

    const hourlyThroughput = db
      .prepare(
        `SELECT
           CAST(strftime('%H', timestamp) AS INTEGER) as hour,
           AVG(speed_mbps) as avg_speed,
           COUNT(*) as cnt
         FROM throughput_tests
         WHERE stream_count > 1 AND direction = 'download' ${timeFilter()}
         GROUP BY hour
         ORDER BY hour`
      )
      .all(...timeParams()) as any[];

    // Fetch every individual data point for peak / off-peak windows so we
    // can compute proper medians across all days, not averages of averages.
    const peakHoursIn = "(19, 20, 21, 22)";
    const offPeakHoursIn = "(2, 3, 4, 5, 6)";

    const rawPeakLatency = db
      .prepare(
        `SELECT rtt_mean, loss_pct FROM ping_windows
         WHERE target_id != 'gateway'
           AND CAST(strftime('%H', timestamp) AS INTEGER) IN ${peakHoursIn}
           ${timeFilter()}`)
      .all(...timeParams()) as { rtt_mean: number; loss_pct: number }[];

    const rawOffPeakLatency = db
      .prepare(
        `SELECT rtt_mean, loss_pct FROM ping_windows
         WHERE target_id != 'gateway'
           AND CAST(strftime('%H', timestamp) AS INTEGER) IN ${offPeakHoursIn}
           ${timeFilter()}`)
      .all(...timeParams()) as { rtt_mean: number; loss_pct: number }[];

    const rawPeakSpeed = db
      .prepare(
        `SELECT speed_mbps FROM throughput_tests
         WHERE stream_count > 1 AND direction = 'download'
           AND CAST(strftime('%H', timestamp) AS INTEGER) IN ${peakHoursIn}
           ${timeFilter()}`)
      .all(...timeParams()) as { speed_mbps: number }[];

    const rawOffPeakSpeed = db
      .prepare(
        `SELECT speed_mbps FROM throughput_tests
         WHERE stream_count > 1 AND direction = 'download'
           AND CAST(strftime('%H', timestamp) AS INTEGER) IN ${offPeakHoursIn}
           ${timeFilter()}`)
      .all(...timeParams()) as { speed_mbps: number }[];

    const safeMedian = (vals: number[]) => vals.length > 0 ? Math.round(median(vals) * 100) / 100 : null;

    timeOfDay = {
      hourlyLatency: hourlyLatency.map((h: any) => ({
        hour: h.hour,
        avgRtt: Math.round((h.avg_rtt ?? 0) * 100) / 100,
        avgStddev: Math.round((h.avg_stddev ?? 0) * 100) / 100,
        avgLoss: Math.round((h.avg_loss ?? 0) * 1000) / 1000,
        samples: h.cnt,
      })),
      hourlyThroughput: hourlyThroughput.map((h: any) => ({
        hour: h.hour,
        avgSpeed: Math.round((h.avg_speed ?? 0) * 100) / 100,
        samples: h.cnt,
      })),
      peak: {
        avgRtt: safeMedian(rawPeakLatency.map((r) => r.rtt_mean).filter(Boolean)),
        avgLoss: rawPeakLatency.length > 0
          ? Math.round(median(rawPeakLatency.map((r) => r.loss_pct).filter((v) => v != null)) * 1000) / 1000
          : null,
        avgSpeed: safeMedian(rawPeakSpeed.map((r) => r.speed_mbps).filter(Boolean)),
        samples: rawPeakSpeed.length,
      },
      offPeak: {
        avgRtt: safeMedian(rawOffPeakLatency.map((r) => r.rtt_mean).filter(Boolean)),
        avgLoss: rawOffPeakLatency.length > 0
          ? Math.round(median(rawOffPeakLatency.map((r) => r.loss_pct).filter((v) => v != null)) * 1000) / 1000
          : null,
        avgSpeed: safeMedian(rawOffPeakSpeed.map((r) => r.speed_mbps).filter(Boolean)),
        samples: rawOffPeakSpeed.length,
      },
    };
  } catch (e) {
    console.warn("[evidence] Time-of-day analysis failed:", (e as Error).message);
  }

  // ── Upload vs Download (multi-stream) ───────────────────
  // This section is now redundant with the throughput comparison above
  // but kept as a simpler view. Uses multi-stream data for accuracy.
  let uploadEvidence = null;
  try {
    const dlAvg = db
      .prepare(
        `SELECT AVG(speed_mbps) as avg_speed, COUNT(*) as cnt
         FROM throughput_tests
         WHERE direction = 'download' AND stream_count > 1 ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    const ulAvg = db
      .prepare(
        `SELECT AVG(speed_mbps) as avg_speed, COUNT(*) as cnt
         FROM throughput_tests
         WHERE direction = 'upload' AND stream_count > 1 ${timeFilter()}`
      )
      .get(...timeParams()) as any;

    if (dlAvg?.cnt > 0 && ulAvg?.cnt > 0) {
      uploadEvidence = {
        downloadMean: Math.round((dlAvg.avg_speed ?? 0) * 100) / 100,
        uploadMean: Math.round((ulAvg.avg_speed ?? 0) * 100) / 100,
        ratio: ulAvg.avg_speed > 0
          ? Math.round(((dlAvg.avg_speed ?? 0) / (ulAvg.avg_speed ?? 1)) * 100) / 100
          : null,
        downloadTests: dlAvg.cnt,
        uploadTests: ulAvg.cnt,
      };
    }
  } catch (e) {
    console.warn("[evidence] Upload evidence failed:", (e as Error).message);
  }

  // ── Per-Hop Latency Trending (all monitored targets via traceroute hops) ──
  let hopTrending = null;
  try {
    const perTarget: Record<string, { day: string; avgRtt: number; minRtt: number; maxRtt: number; samples: number }[]> = {};
    const degradationMs: Record<string, number> = {};
    let maxDays = 0;

    for (const target of PING_TARGETS) {
      const trend = db
        .prepare(
          `SELECT
             date(t.timestamp) as day,
             AVG(h.rtt_ms) as avg_rtt,
             MIN(h.rtt_ms) as min_rtt,
             MAX(h.rtt_ms) as max_rtt,
             COUNT(*) as samples
           FROM traceroute_hops h
           JOIN traceroutes t ON h.traceroute_id = t.id
           WHERE h.ip = ? AND h.rtt_ms IS NOT NULL
           ${since ? "AND t.timestamp >= ?" : ""}
           GROUP BY day
           ORDER BY day`
        )
        .all(target.ip, ...timeParams()) as any[];

      if (trend.length > 0) {
        perTarget[target.id] = trend.map((d: any) => ({
          day: d.day,
          avgRtt: Math.round(d.avg_rtt * 100) / 100,
          minRtt: Math.round((d.min_rtt ?? d.avg_rtt) * 100) / 100,
          maxRtt: Math.round((d.max_rtt ?? d.avg_rtt) * 100) / 100,
          samples: d.samples,
        }));
        if (trend.length > 1) {
          degradationMs[target.id] = Math.round(
            (trend[trend.length - 1].avg_rtt - trend[0].avg_rtt) * 100
          ) / 100;
        }
        maxDays = Math.max(maxDays, trend.length);
      }
    }

    if (Object.keys(perTarget).length > 0) {
      hopTrending = { perTarget, degradationMs, periodDays: maxDays };
    }
  } catch (e) {
    console.warn("[evidence] Hop trending failed:", (e as Error).message);
  }

  // ── Outage Summary ─────────────────────────────────────
  let outageSummary = null;
  try {
    const outages = db
      .prepare(
        `SELECT * FROM outages
         WHERE 1=1 ${timeFilter("started_at")}
         ORDER BY started_at DESC`
      )
      .all(...timeParams()) as any[];

    if (outages.length > 0) {
      const totalDurationMs = outages.reduce(
        (s: number, o: any) => s + (o.duration_ms ?? 0), 0
      );
      outageSummary = {
        count: outages.length,
        totalDurationMs,
        longestMs: Math.max(...outages.map((o: any) => o.duration_ms ?? 0)),
        recent: outages.slice(0, 10).map((o: any) => ({
          startedAt: o.started_at,
          endedAt: o.ended_at,
          durationMs: o.duration_ms,
          missedPings: o.missed_pings,
        })),
      };
    }
  } catch (e) {
    console.warn("[evidence] Outage summary failed:", (e as Error).message);
  }

  // ── Collection Period ──────────────────────────────────
  const periodWhere = since ? "WHERE timestamp >= ?" : "";
  const first = db
    .prepare(`SELECT MIN(timestamp) as ts FROM ping_windows ${periodWhere}`)
    .get(...timeParams()) as any;
  const last = db
    .prepare(`SELECT MAX(timestamp) as ts FROM ping_windows ${periodWhere}`)
    .get(...timeParams()) as any;
  const pingCount = db
    .prepare(`SELECT COUNT(*) as cnt FROM ping_windows ${periodWhere}`)
    .get(...timeParams()) as any;
  const throughputCount = db
    .prepare(`SELECT COUNT(*) as cnt FROM throughput_tests ${periodWhere}`)
    .get(...timeParams()) as any;

  return c.json({
    hopComparison,
    throughputPolicing,
    correlation: correlationEvidence,
    pathAnalysis,
    packetLoss,
    timeOfDay,
    uploadEvidence,
    hopTrending,
    outageSummary,
    collectionPeriod: {
      start: first?.ts || new Date().toISOString(),
      end: last?.ts || new Date().toISOString(),
      totalPingWindows: pingCount?.cnt || 0,
      totalThroughputTests: throughputCount?.cnt || 0,
    },
  });
});

export { evidence };
