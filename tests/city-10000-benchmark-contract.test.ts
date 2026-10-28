import { describe, expect, it } from "vitest";
import { assertCity10000Scene, city10000Budgets, city10000Database, city10000FixtureRows, city10000Metric, city10000Size } from "../scripts/city-10000-contract";
import type { CitySceneDto } from "../src/shared/city-scene-contract";

describe("single-city 10000 benchmark safety policy", () => {
  it("accepts exactly 10000 tasks, rather than silently measuring the old smaller workload", () => {
    expect(city10000Size("10000")).toBe(10000);
    for (const size of [undefined, 0, 1000, 9999, 10001, NaN]) expect(() => city10000Size(size)).toThrow();
  });

  it("never inherits assigned infrastructure from the one real service-created template task", () => {
    const rows = city10000FixtureRows("owner");
    expect(rows).toHaveLength(9999);
    expect(new Set(rows.map(row => row.id)).size).toBe(9999);
    for (const row of rows) expect(Object.assign({ service_role_assigned: true, service_role: "AIRPORT", service_trigger: "reserved" }, row))
      .toMatchObject({ service_role_assigned: false, service_role: null, service_trigger: null });
  });

  it("requires its own loopback database and rejects shared, remote and options-based targets", () => {
    expect(city10000Database("postgres://127.0.0.1:55437/city_10000_20261028_test").pathname)
      .toBe("/city_10000_20261028_test");
    for (const uri of ["postgres://db.example/city_10000_20261028_test", "postgres://localhost/tasktopia_test",
      "postgres://localhost/mcp_scale_20261028", "postgres://localhost/world_perf_20261016_1000",
      "postgres://localhost/city_10000_20261028_test?options=shared", "postgres://localhost/city_10000_20261028_test#fragment"])
      expect(() => city10000Database(uri)).toThrow();
  });

  it("keeps the declared 10000 workload SLO separate from the old 1000-task budget", () => {
    expect(city10000Budgets("desktop")).toMatchObject({ coldCityMs: 5000, inputP95Ms: 100, frameP95Ms: 20, cardMs: 1000 });
    expect(city10000Budgets("tall").coldCityMs).toBe(5000);
    expect(city10000Budgets("mobile")).toMatchObject({ coldCityMs: 30000, inputP95Ms: 200, frameP95Ms: 34, cardMs: 2000 });
    expect(city10000Budgets("mobile").rawSceneBytes).toBe(48 * 1024 * 1024);
  });

  it("rejects missing or nonfinite samples instead of producing a ghost PASS", () => {
    expect(() => city10000Metric([], 3)).toThrow();
    expect(() => city10000Metric([1, 2], 3)).toThrow();
    expect(() => city10000Metric([1, NaN, 3], 3)).toThrow();
    expect(() => city10000Metric([1, -1, 3], 3)).toThrow();
    expect(city10000Metric([9, 3, 6], 3)).toEqual({ count: 3, p50: 6, p95: null, max: 9 });
    expect(city10000Metric(Array.from({ length: 20 }, (_, n) => n + 1), 20).p95).toBe(19);
  });

  // Synthetic data exercises only the evidence validator, never native geometry.
  const scene = () => ({ city: { id: "owned-city" }, completedDistrictSnapshots: [],
    chunks: Array.from({ length: 257 }, (_, n) => ({ chunkX: n, chunkY: 0,
      tasks: n ? [] : Array.from({ length: 10000 }, (_, i) => ({ id: `task-${i + 1}`, taskNumber: i + 1, districtId: "one" })) })) }) as unknown as CitySceneDto;
  it("requires all 10000 identities in one city and real evidence exceeding the old scene limit", () => {
    expect(() => assertCity10000Scene(scene(), "owned-city", 4096)).not.toThrow();
    const smaller = scene(); smaller.chunks.pop();
    expect(() => assertCity10000Scene(smaller, "owned-city", 4096)).toThrow();
    const missingTask = scene(); missingTask.chunks[0]!.tasks.pop();
    expect(() => assertCity10000Scene(missingTask, "owned-city", 4096)).toThrow();
    expect(() => assertCity10000Scene(scene(), "foreign-city", 4096)).toThrow();
    expect(() => assertCity10000Scene(scene(), "owned-city", Infinity)).toThrow();
    const duplicate = scene(); duplicate.chunks[1]!.chunkX = 0;
    expect(() => assertCity10000Scene(duplicate, "owned-city", 4096)).toThrow();
  });
});
