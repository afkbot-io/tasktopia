import { describe, expect, it } from "vitest";
import { districtDevelopmentState, planDistrictDevelopment, createDistrictDevelopmentGeometry } from "../src/client/district-development";
import type { CitySceneDto } from "../src/shared/city-scene-contract";

describe("temporary district development", () => {
  it("distinguishes sprint choice from real construction and removes finished works", () => {
    expect(districtDevelopmentState("ACTIVE", ["PLANNING"])).toBe("PREPARING");
    expect(districtDevelopmentState("ACTIVE", ["STARTED", "COMPLETED"])).toBe("BUILDING");
    expect(districtDevelopmentState("ACTIVE", ["TESTING"])).toBe("TESTING");
    expect(districtDevelopmentState("ACTIVE", ["COMPLETED"])).toBe("FINISHED");
    expect(districtDevelopmentState("PLANNED", ["IN_PROGRESS"])).toBe("PLANNED");
    expect(districtDevelopmentState("ABANDONED", ["IN_PROGRESS"])).toBe("HIDDEN");
  });
  it("keeps a public passage and every occupied cell free, including sprite overhang", () => {
    const cells = Array.from({ length: 100 }, (_, i) => ({ x: i % 10 - 5, y: Math.floor(i / 10) - 5 }));
    const blocked = new Set(cells.filter(c => c.x === 0 || c.y === 0).map(c => `${c.x},${c.y}`));
    const plan = planDistrictDevelopment(cells, blocked, "BUILDING");
    expect(plan.fences.length).toBeGreaterThan(0);
    for (const prop of [...plan.fences, ...(plan.marker ? [plan.marker] : [])]) {
      for (const cell of prop.cells) expect(blocked.has(`${cell.x},${cell.y}`)).toBe(false);
    }
    expect(planDistrictDevelopment([...cells].reverse(), blocked, "BUILDING")).toEqual(plan);
  });
  it("never invents land for an empty planned district or blocks a packed district", () => {
    expect(planDistrictDevelopment([], new Set(), "PLANNED")).toEqual({ fences: [], marker: null });
    expect(planDistrictDevelopment([{ x: 0, y: 0 }], new Set(["0,0"]), "BUILDING")).toEqual({ fences: [], marker: null });
  });
  it("sets the fence behind a paved perimeter, never on the sidewalk itself", () => {
    const cells = Array.from({ length: 100 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10) }));
    const pavement = new Set(cells.filter(c => c.x === 0 || c.y === 0 || c.x === 9 || c.y === 9).map(c => `${c.x},${c.y}`));
    const plan = planDistrictDevelopment(cells, pavement, "BUILDING");
    expect(plan.fences.length).toBeGreaterThan(0);
    for (const prop of plan.fences) for (const c of prop.cells) expect(pavement.has(`${c.x},${c.y}`)).toBe(false);
  });
  it("removes the fence when finished and keeps an explicit object ceiling", () => {
    const cells = Array.from({ length: 10_000 }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100) }));
    expect(planDistrictDevelopment(cells, new Set(), "BUILDING").fences.length).toBeLessThanOrEqual(48);
    expect(planDistrictDevelopment(cells, new Set(), "FINISHED")).toEqual({ fences: [], marker: null });
    expect(planDistrictDevelopment(cells, new Set(), "PLANNED").fences).toEqual([]);
  });
  it("plans one canonical boundary across page seams, independent of viewport", () => {
    const chunk = (start: number, end: number) => ({ tasks: [], roadRuns: [], surfaceRuns: [],
      decorationContext: { blockedCellRuns: [] },
      districts: [{ id: "d", status: "ACTIVE", cellRuns: Array.from({ length: 4 }, (_, y) => ({ start: { x: start, y }, end: { x: end, y } })) }],
    });
    const scene = { chunks: [chunk(0, 3), chunk(4, 7)], completedDistrictSnapshots: [] } as unknown as CitySceneDto;
    const geometry = createDistrictDevelopmentGeometry(scene);
    expect(geometry.districts.get("d")!.cells).toHaveLength(32);
    const plan = geometry.plan("d", "BUILDING");
    expect(plan.fences.some(p => p.kind === "fence-vertical" && (p.origin.x === 3 || p.origin.x === 4))).toBe(false);
    expect(geometry.plan("d", "BUILDING")).toBe(plan);
  });
});
