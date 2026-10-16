export type QueryMetricsSnapshot = {
  started: number;
  completed: number;
  failed: number;
  inFlight: number;
  /** Includes pool acquisition and server execution; these are not separated. */
  latencyMs: { samples: number; p50: number; p95: number; max: number };
};

/** Fixed memory and constant recording cost; sorting happens only on operator read. */
export class QueryMetrics {
  private started = 0;
  private completed = 0;
  private failed = 0;
  private inFlight = 0;
  private readonly latencies: number[];
  private at = 0;
  private samples = 0;

  constructor(capacity = 128) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024) throw new Error('Invalid query metrics capacity');
    this.latencies = new Array<number>(capacity).fill(0);
  }

  async measure<T>(operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    this.started++;
    this.inFlight++;
    try { return await operation(); }
    catch (error) { this.failed++; throw error; }
    finally {
      this.completed++;
      this.inFlight--;
      this.latencies[this.at] = Math.max(0, performance.now() - start);
      this.at = (this.at + 1) % this.latencies.length;
      this.samples = Math.min(this.samples + 1, this.latencies.length);
    }
  }

  snapshot(): QueryMetricsSnapshot {
    const sorted = this.latencies.slice(0, this.samples).sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
    return { started: this.started, completed: this.completed, failed: this.failed, inFlight: this.inFlight,
      latencyMs: { samples: this.samples, p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) ?? 0 } };
  }
}
