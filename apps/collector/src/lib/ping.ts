import { PINGS_PER_WINDOW, PING_INTERVAL_SEC } from "@isp/shared";

export interface PingResult {
  seq: number;
  rttMs: number | null;
  timestamp: string;
}

/**
 * Run ICMP ping against a target and parse individual RTTs.
 * Uses the system `ping` command. Supports both IPv4 and IPv6.
 */
export async function runPing(
  targetIp: string,
  count: number = PINGS_PER_WINDOW,
  intervalSec: number = PING_INTERVAL_SEC
): Promise<PingResult[]> {
  const results: PingResult[] = [];
  const isV6 = targetIp.includes(":");

  // Use ping6 or ping -6 for IPv6 targets
  const cmd = isV6
    ? ["ping6", "-c", String(count), "-i", String(intervalSec), targetIp]
    : ["ping", "-c", String(count), "-i", String(intervalSec), targetIp];

  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  // Parse each line for RTT: "64 bytes from X: icmp_seq=N ttl=T time=X.XXX ms"
  const rttRegex = /icmp_seq=(\d+)\s.*?time=(\d+\.?\d*)\s*ms/g;
  let match: RegExpExecArray | null;
  const receivedSeqs = new Set<number>();

  while ((match = rttRegex.exec(stdout)) !== null) {
    const seq = parseInt(match[1], 10);
    const rtt = parseFloat(match[2]);
    receivedSeqs.add(seq);
    results.push({
      seq,
      rttMs: rtt,
      timestamp: new Date().toISOString(),
    });
  }

  // Fill in lost packets
  for (let seq = 0; seq < count; seq++) {
    // ping on macOS starts seq at 0, Linux at 1
    if (!receivedSeqs.has(seq) && !receivedSeqs.has(seq + 1)) {
      const actualSeq = receivedSeqs.size > 0 && Math.min(...receivedSeqs) === 1 ? seq + 1 : seq;
      if (!receivedSeqs.has(actualSeq)) {
        results.push({
          seq: actualSeq,
          rttMs: null,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  return results.sort((a, b) => a.seq - b.seq);
}
