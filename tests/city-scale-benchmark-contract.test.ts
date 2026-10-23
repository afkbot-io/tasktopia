import { describe, expect, it } from "vitest";
import { cityScaleSize, cityScaleDatabase, localCityScaleUrl, distribution, cityScaleBudgets } from "../scripts/city-scale-benchmark-contract";

describe("local city-scale benchmark contract", () => {
  it("rejects remote/shared/mismatched workloads before any application writes", () => {
    expect(cityScaleSize("200")).toBe(200); expect(cityScaleSize(1000)).toBe(1000);
    expect(() => cityScaleSize(199)).toThrow(); expect(() => cityScaleSize(2000)).toThrow();
    expect(() => cityScaleDatabase("postgres://localhost/world_perf_20261016_200", 1000)).toThrow();
    expect(() => cityScaleDatabase("postgres://localhost/tasktopia_test", 200)).toThrow();
    expect(() => cityScaleDatabase("postgres://db.example/world_perf_20261016_200", 200)).toThrow();
    expect(() => cityScaleDatabase("postgres://localhost/world_perf_20261016_200?options=shared", 200)).toThrow();
    expect(() => localCityScaleUrl("https://tasktopia.online", "http:")).toThrow();
    expect(cityScaleDatabase("postgres://127.0.0.1:55436/world_perf_20261016_200", 200).pathname).toBe("/world_perf_20261016_200");
  });
  it("does not turn three loading measurements into a misleading p95", () => {
    expect(distribution([9, 3, 6])).toEqual({ count: 3, p50: 6, p95: null, max: 9 });
    expect(distribution(Array.from({ length: 20 }, (_, n) => n + 1)).p95).toBe(19);
    expect(distribution([]).p50).toBeNull(); expect(() => distribution([NaN])).toThrow();
  });
  it("keeps CPU throttling budgets separate from WebKit touch compatibility", () => {
    expect(cityScaleBudgets(1000, "iphone-chromium").coldCityMs).toBe(12000);
    expect(cityScaleBudgets(1000, "iphone-webkit").coldCityMs).toBe(3000);
    expect(cityScaleBudgets(200, "pixel-chromium").panSceneRequests).toBe(0);
  });
});
