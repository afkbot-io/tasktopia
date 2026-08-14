export type PerformanceMetricSnapshot = {
  samples: number;
  last: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
};

export class RollingPerformanceMetric {
  private readonly values: number[] = [];

  constructor(private readonly limit = 128) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Performance metric limit must be a positive integer");
  }

  record(value: number): PerformanceMetricSnapshot {
    if (!Number.isFinite(value) || value < 0) return this.snapshot();
    this.values.push(value);
    if (this.values.length > this.limit) this.values.shift();
    return this.snapshot();
  }

  snapshot(): PerformanceMetricSnapshot {
    if (this.values.length === 0) return { samples: 0, last: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    const sorted = [...this.values].sort((left, right) => left - right);
    const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]!;
    return {
      samples: this.values.length,
      last: this.values.at(-1)!,
      max: sorted.at(-1)!,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    };
  }
}
