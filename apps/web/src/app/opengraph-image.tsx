import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "ISP Observatory — 24-hour speed overview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

const COLLECTOR_URL = process.env.COLLECTOR_URL || "http://localhost:4000";

const PEAK_START = 19;
const PEAK_END = 23;
const PLAN_SPEED = 1000;
const MIN_SPEED = 500;

interface HourlyPoint {
  hour: number;
  avgSpeed: number;
  samples: number;
}

function barColor(hour: number, speed: number): string {
  if (speed < MIN_SPEED) return "#ef4444";
  if (hour >= PEAK_START && hour < PEAK_END) return "#f59e0b";
  return "#a78bfa";
}

export default async function OgImage() {
  let hourlyData: HourlyPoint[] = [];
  let medianDl = 0;
  let medianUl = 0;

  try {
    const res = await fetch(`${COLLECTOR_URL}/api/evidence/summary`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const evidence = await res.json();
      hourlyData = evidence?.timeOfDay?.hourlyThroughput ?? [];
      const tp = evidence?.throughputPolicing;
      if (tp?.adjustedMultiDownloadMean) medianDl = Math.round(tp.adjustedMultiDownloadMean);
      if (tp?.adjustedMultiUploadMean) medianUl = Math.round(tp.adjustedMultiUploadMean);
    }
  } catch {
    // render with empty data
  }

  const hourMap = new Map(hourlyData.map((h) => [h.hour, h]));
  const hours = Array.from({ length: 24 }, (_, i) => {
    const d = hourMap.get(i);
    return { hour: i, speed: d?.avgSpeed ?? 0, tests: d?.samples ?? 0 };
  });

  const maxSpeed = Math.max(PLAN_SPEED, ...hours.map((h) => h.speed));
  const chartHeight = 300;
  const planY = (1 - PLAN_SPEED / maxSpeed) * chartHeight;
  const minY = (1 - MIN_SPEED / maxSpeed) * chartHeight;

  const pills: { label: string; value: string; unit: string; color: string }[] = [];
  if (medianDl > 0) pills.push({ label: "DL", value: String(medianDl), unit: "Mbps", color: "#a78bfa" });
  if (medianUl > 0) pills.push({ label: "UL", value: String(medianUl), unit: "Mbps", color: "#38bdf8" });
  pills.push({ label: "Plan", value: "1G", unit: "Hyperoptic", color: "#fafafa" });

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", backgroundColor: "#0a0a0a", padding: "48px 56px", fontFamily: "system-ui, sans-serif" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "#a78bfa", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#0a0a0a", display: "flex" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "32px", fontWeight: 700, color: "#fafafa", lineHeight: 1.1 }}>ISP Observatory</span>
              <span style={{ fontSize: "16px", color: "#71717a", marginTop: "2px" }}>isp.bhanji.dev</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            {pills.map((p) => (
              <div key={p.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: "#18181b", borderRadius: "12px", padding: "8px 20px", border: "1px solid #27272a" }}>
                <span style={{ fontSize: "13px", color: "#71717a" }}>{p.label}</span>
                <span style={{ fontSize: "24px", fontWeight: 700, color: p.color }}>{p.value}</span>
                <span style={{ fontSize: "11px", color: "#52525b" }}>{p.unit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Chart subtitle */}
        <span style={{ fontSize: "14px", color: "#71717a", marginBottom: "12px", marginTop: "16px" }}>
          Average download speed by hour
        </span>

        {/* Chart */}
        <div style={{ display: "flex", flex: 1, position: "relative" }}>
          {/* 1000 Mbps line */}
          <div style={{ position: "absolute", top: `${planY}px`, left: 0, right: 0, height: "1px", borderTop: "1px dashed rgba(255,255,255,0.15)", display: "flex" }} />
          <span style={{ position: "absolute", top: `${planY - 14}px`, right: "4px", fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>{`${PLAN_SPEED} Mbps`}</span>
          {/* 500 Mbps line */}
          <div style={{ position: "absolute", top: `${minY}px`, left: 0, right: 0, height: "1px", borderTop: "1px dashed rgba(239,68,68,0.35)", display: "flex" }} />
          <span style={{ position: "absolute", top: `${minY - 14}px`, right: "4px", fontSize: "11px", color: "rgba(239,68,68,0.5)" }}>{`${MIN_SPEED} Mbps min`}</span>

          {/* Bars */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", flex: 1, height: `${chartHeight}px` }}>
            {hours.map((h) => {
              const barH = h.speed > 0 ? Math.max((h.speed / maxSpeed) * chartHeight, 4) : 4;
              return (
                <div key={h.hour} style={{ display: "flex", flex: 1, height: "100%", alignItems: "flex-end" }}>
                  <div style={{ width: "100%", height: `${barH}px`, backgroundColor: h.speed > 0 ? barColor(h.hour, h.speed) : "rgba(255,255,255,0.05)", borderRadius: "4px 4px 0 0", opacity: h.speed > 0 ? 1 : 0.3, display: "flex" }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Hour labels */}
        <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
          {hours.map((h) => (
            <div key={h.hour} style={{ flex: 1, display: "flex", justifyContent: "center", fontSize: "11px", color: h.hour >= PEAK_START && h.hour < PEAK_END ? "#f59e0b" : "#3f3f46" }}>
              <span>{h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}</span>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "24px", marginTop: "12px", fontSize: "12px", color: "#52525b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "#a78bfa", display: "flex" }} />
            <span>Off-peak</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "#f59e0b", display: "flex" }} />
            <span>Peak (19:00-23:00)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "#ef4444", display: "flex" }} />
            <span>{`Below minimum (${MIN_SPEED} Mbps)`}</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
