import { describe, expect, it } from "vitest";
import { RollingPerformanceMetric } from "../src/client/rolling-performance-metric";

describe("RollingPerformanceMetric", () => {
  it("reports nearest-rank percentiles over a bounded recent window", () => {
    const metric = new RollingPerformanceMetric(5);
    for (const value of [1, 2, 3, 4, 5, 6]) metric.record(value);

    expect(metric.snapshot()).toEqual({ samples: 5, last: 6, max: 6, p50: 4, p95: 6, p99: 6 });
  });

  it("starts with a zero snapshot", () => {
    expect(new RollingPerformanceMetric().snapshot()).toEqual({
      samples: 0, last: 0, max: 0, p50: 0, p95: 0, p99: 0,
    });
  });
});
