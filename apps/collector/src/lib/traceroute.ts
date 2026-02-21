export interface TracerouteHopResult {
  hopNumber: number;
  ip: string | null;
  hostname: string | null;
  /** Average RTT across all responding probes (matches RIPE methodology) */
  rttMs: number | null;
}

export interface TracerouteOutput {
  destination: string;
  hops: TracerouteHopResult[];
  pathHash: string;
}

const IPV4_PATTERN = /\d+\.\d+\.\d+\.\d+/;
const IPV6_PATTERN = /[0-9a-fA-F:]{2,39}/;

/**
 * Run traceroute to a destination and parse the output.
 * Uses 3 probes per hop (same as RIPE Atlas built-in measurements)
 * and averages the RTT values for consistency.
 */
export async function runTraceroute(
  destination: string,
  maxHops: number = 30,
  timeoutMs: number = 180_000
): Promise<TracerouteOutput> {
  const isV6 = destination.includes(":");
  // -I: ICMP echo (destinations reply reliably, unlike UDP port-unreachable)
  // -q 3: 3 probes per hop (matches RIPE Atlas), -w 3: 3s wait per probe
  const cmd = isV6
    ? ["traceroute6", "-n", "-I", "-q", "3", "-m", String(maxHops), "-w", "3", destination]
    : ["traceroute", "-n", "-I", "-q", "3", "-m", String(maxHops), "-w", "3", destination];

  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      proc.kill();
      reject(new Error(`Traceroute to ${destination} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs)
  );

  const stdout = await Promise.race([stdoutPromise, timeoutPromise]);
  await proc.exited;

  const hops: TracerouteHopResult[] = [];
  const lines = stdout.split("\n");
  const ipPat = isV6 ? IPV6_PATTERN.source : IPV4_PATTERN.source;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("traceroute")) continue;

    const hopMatch = trimmed.match(/^(\d+)\s+(.+)/);
    if (!hopMatch) continue;

    const hopNumber = parseInt(hopMatch[1], 10);
    const rest = hopMatch[2].trim();

    // All probes timed out
    if (/^\*\s*\*\s*\*$/.test(rest) || rest === "*") {
      hops.push({ hopNumber, ip: null, hostname: null, rttMs: null });
      continue;
    }

    // With -q 3 -n, output format is: "IP  RTT ms  RTT ms  RTT ms"
    // or mixed: "IP  RTT ms  *  RTT ms" when some probes timeout
    // First, extract the IP
    const ipMatch = rest.match(new RegExp(`^(${ipPat})`));
    if (!ipMatch) {
      // No IP found — partial dark hop
      hops.push({ hopNumber, ip: null, hostname: null, rttMs: null });
      continue;
    }

    const ip = ipMatch[1];
    const afterIp = rest.slice(ip.length);

    // Extract all RTT values from the rest of the line
    const rttMatches = [...afterIp.matchAll(/(\d+\.?\d*)\s*ms/g)];
    const rtts = rttMatches.map((m) => parseFloat(m[1]));

    // Average all responding probes (like RIPE does)
    const avgRtt = rtts.length > 0
      ? Math.round((rtts.reduce((a, b) => a + b, 0) / rtts.length) * 1000) / 1000
      : null;

    hops.push({ hopNumber, ip, hostname: null, rttMs: avgRtt });
  }

  // Path hash from responding IPs
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(hops.map((h) => h.ip || "*").join(","));
  const pathHash = hasher.digest("hex");

  return { destination, hops, pathHash };
}
