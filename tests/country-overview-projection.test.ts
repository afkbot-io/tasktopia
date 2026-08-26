import { describe, expect, it } from "vitest";
import { projectCountryOverview } from "../src/server/world/country-overview";

describe("compact country overview projection", () => {
  it("preserves relative distances with one uniform transform", () => {
    const projected = projectCountryOverview([
      { id: "a", sourceCenter: { x: 0, y: 0 } },
      { id: "b", sourceCenter: { x: 100, y: 0 } },
      { id: "c", sourceCenter: { x: 300, y: 0 } },
    ]);
    const a = projected.centers.get("a")!;
    const b = projected.centers.get("b")!;
    const c = projected.centers.get("c")!;

    expect((b.x - a.x) / (c.x - a.x)).toBeCloseTo(1 / 3, 1);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(projected.connections).toHaveLength(2);
  });

  it("centers a single city and creates no synthetic connection", () => {
    const projected = projectCountryOverview([{ id: "only", sourceCenter: { x: 812, y: -93 } }]);
    expect(projected.centers.get("only")).toEqual({ x: 80, y: 48 });
    expect(projected.connections).toEqual([]);
  });
});
