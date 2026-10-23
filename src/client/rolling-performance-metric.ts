export type PerformanceMetricSnapshot = {
  samples: number;
  last: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
};

export class RollingPerformanceMetric {
  private readonly values: number[];
  private cursor = 0;
  private count = 0;
  private last = 0;
  private cached: PerformanceMetricSnapshot | undefined;

  constructor(private readonly limit = 128) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Performance metric limit must be a positive integer");
    this.values = new Array<number>(limit);
  }

  record(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.limit;
    this.count = Math.min(this.limit, this.count + 1);
    this.last = value;
    this.cached = undefined;
  }

  snapshot(): PerformanceMetricSnapshot {
    if (this.cached) return this.cached;
    if (this.count === 0) return { samples: 0, last: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    const sorted = this.values.slice(0, this.count).sort((left, right) => left - right);
    const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]!;
    return this.cached = {
      samples: this.count,
      last: this.last,
      max: sorted.at(-1)!,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    };
  }
}
