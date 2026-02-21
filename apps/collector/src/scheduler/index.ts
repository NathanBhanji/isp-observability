export interface Collector {
  name: string;
  interval: number;
  /** Return a warning string if the data collected is suspect but not an error */
  collect(): Promise<string | void>;
}

interface CollectorState {
  lastRun: string | null;
  lastError: string | null;
  lastWarning: string | null;
  runCount: number;
  errorCount: number;
}

export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private state = new Map<string, CollectorState>();
  private startedAt = new Date().toISOString();

  register(collector: Collector): void {
    this.state.set(collector.name, {
      lastRun: null,
      lastError: null,
      lastWarning: null,
      runCount: 0,
      errorCount: 0,
    });

    const run = async () => {
      const s = this.state.get(collector.name)!;
      try {
        console.log(`[scheduler] Running ${collector.name}...`);
        const warning = await collector.collect();
        s.lastRun = new Date().toISOString();
        s.runCount++;
        if (typeof warning === "string") {
          s.lastWarning = warning;
          console.warn(`[scheduler] ${collector.name} warning: ${warning}`);
        } else {
          s.lastWarning = null;
        }
        console.log(`[scheduler] ${collector.name} completed (run #${s.runCount})`);
      } catch (err) {
        s.lastError = (err as Error).message;
        s.errorCount++;
        console.error(`[scheduler] ${collector.name} failed:`, (err as Error).message);
      }
    };

    // Run immediately on registration
    run();

    // Then schedule at interval
    const timer = setInterval(run, collector.interval);
    this.timers.set(collector.name, timer);

    console.log(
      `[scheduler] Registered ${collector.name} (every ${collector.interval / 1000}s)`
    );
  }

  getHealth(): {
    uptime: number;
    startedAt: string;
    collectors: Record<string, CollectorState>;
  } {
    const uptime = Date.now() - new Date(this.startedAt).getTime();
    const collectors: Record<string, CollectorState> = {};
    for (const [name, s] of this.state) {
      collectors[name] = { ...s };
    }
    return { uptime, startedAt: this.startedAt, collectors };
  }

  stop(): void {
    for (const [name, timer] of this.timers) {
      clearInterval(timer);
      console.log(`[scheduler] Stopped ${name}`);
    }
    this.timers.clear();
  }
}
