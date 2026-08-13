import { describe, expect, it } from "vitest";
import {
  CONSTRUCTION_DETAIL_SPECS,
  constructionPadDepth,
  constructionStageLayout,
} from "../src/shared/construction-stage";

describe("composable construction stages", () => {
  it("uses a five-cell pad for a deep tower and a smaller pad for compact buildings", () => {
    expect(constructionPadDepth({ width: 18, height: 16 })).toBe(5);
    expect(constructionPadDepth({ width: 6, height: 9 })).toBe(4);
    expect(constructionPadDepth({ width: 4, height: 4 })).toBe(3);
  });

  it("fills the exact building width and projected depth for stages one and two", () => {
    for (const stage of [1, 2]) {
      const layout = constructionStageLayout({ width: 18, height: 16 }, 9, stage, 42);
      const baseCells = layout.site.filter((tile) =>
        tile.key === "construction-foundation"
          || tile.key === "construction-foundation-alt"
          || tile.key.startsWith("construction-earth"),
      );
      expect(new Set(baseCells.map(({ x, y }) => `${x},${y}`)).size).toBe(18 * 5);
      expect(Math.min(...baseCells.map(({ x }) => x))).toBe(0);
      expect(Math.max(...baseCells.map(({ x }) => x))).toBe(17);
      expect(Math.min(...baseCells.map(({ y }) => y))).toBe(-5);
      expect(Math.max(...baseCells.map(({ y }) => y))).toBe(-1);
    }
  });

  it("keeps the fence one cell outside the pad and opens a two-cell south gate", () => {
    const layout = constructionStageLayout({ width: 14, height: 12 }, 7, 2);
    const rearCoordinates = new Set(layout.rearFence.map(({ x, y }) => `${x},${y}`));
    const frontCoordinates = new Set(layout.frontFence.filter(({ key }) => key === "construction-fence").map(({ x, y }) => `${x},${y}`));
    expect(rearCoordinates).toContain("-1,-6");
    expect(rearCoordinates).toContain("14,-6");
    expect(frontCoordinates).not.toContain("6,0");
    expect(frontCoordinates).not.toContain("7,0");
    expect(layout.frontFence.filter(({ key }) => key === "construction-gate")).toHaveLength(2);
  });

  it("removes the temporary site from the completed stage", () => {
    const layout = constructionStageLayout({ width: 14, height: 12 }, 7, 5);
    expect(layout.site).toEqual([]);
    expect(layout.rearFence).toEqual([]);
    expect(layout.frontFence).toEqual([]);
  });

  it("publishes the planning kit and an expanded foundation kit", () => {
    expect(CONSTRUCTION_DETAIL_SPECS.filter((detail) => detail.stage === 1)).toHaveLength(10);
    expect(CONSTRUCTION_DETAIL_SPECS.filter((detail) => detail.stage === 2).length).toBeGreaterThanOrEqual(13);
    expect(new Set(CONSTRUCTION_DETAIL_SPECS.map((detail) => detail.key))).toHaveLength(CONSTRUCTION_DETAIL_SPECS.length);
  });

  it("creates a stable but seed-dependent site composition", () => {
    const first = constructionStageLayout({ width: 14, height: 12 }, 7, 1, 42);
    const repeated = constructionStageLayout({ width: 14, height: 12 }, 7, 1, 42);
    const another = constructionStageLayout({ width: 14, height: 12 }, 7, 1, 43);
    expect(first.details).toEqual(repeated.details);
    expect(first.details).not.toEqual(another.details);
  });

  it("uses a restrained number of details that still scales with the site", () => {
    const tower = constructionStageLayout({ width: 18, height: 16 }, 9, 1, 77);
    const house = constructionStageLayout({ width: 4, height: 4 }, 2, 1, 77);
    expect(tower.details.length).toBeGreaterThanOrEqual(5);
    expect(tower.details.length).toBeLessThanOrEqual(7);
    expect(house.details.length).toBeGreaterThanOrEqual(2);
    expect(house.details.length).toBeLessThanOrEqual(3);
  });

  it("gives cranes and heavy vehicles a city-scale footprint", () => {
    const cranes = CONSTRUCTION_DETAIL_SPECS.filter((detail) => detail.group === "CRANE");
    expect(cranes.length).toBeGreaterThanOrEqual(2);
    for (const crane of cranes) {
      expect(crane.footprint.width).toBeGreaterThanOrEqual(4);
      expect(crane.footprint.height).toBeGreaterThanOrEqual(3);
      expect(crane.canvas.width).toBeGreaterThanOrEqual(64);
      expect(crane.canvas.height).toBeGreaterThanOrEqual(64);
    }
    const vehicles = CONSTRUCTION_DETAIL_SPECS.filter((detail) => detail.group === "VEHICLE");
    expect(vehicles.length).toBeGreaterThanOrEqual(3);
    for (const vehicle of vehicles) {
      expect(vehicle.footprint.width).toBeGreaterThanOrEqual(4);
      expect(vehicle.canvas.width).toBeGreaterThanOrEqual(32);
      expect(vehicle.canvas.height).toBeGreaterThanOrEqual(16);
    }
  });

  it("never crowds one site with several cranes or heavy vehicles", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const layout = constructionStageLayout({ width: 18, height: 16 }, 9, 2, seed);
      const specs = layout.details.map((detail) => CONSTRUCTION_DETAIL_SPECS.find((candidate) => candidate.key === detail.key)!);
      expect(specs.filter((detail) => detail.group === "CRANE").length).toBeLessThanOrEqual(1);
      expect(specs.filter((detail) => detail.group === "VEHICLE").length).toBeLessThanOrEqual(1);
    }
  });

  it("varies repeated buildings while preserving stable per-task composition", () => {
    const signatures = new Set<string>();
    for (let taskNumber = 1; taskNumber <= 8; taskNumber += 1) {
      const first = constructionStageLayout({ width: 14, height: 12 }, 7, 2, taskNumber);
      const repeated = constructionStageLayout({ width: 14, height: 12 }, 7, 2, taskNumber);
      expect(first.details).toEqual(repeated.details);
      signatures.add(JSON.stringify(first.details));
    }
    expect(signatures.size).toBeGreaterThanOrEqual(6);
  });

  it("uses at least four planning-ground variants and two foundation variants", () => {
    const plan = constructionStageLayout({ width: 18, height: 16 }, 9, 1, 71);
    const foundation = constructionStageLayout({ width: 18, height: 16 }, 9, 2, 71);
    expect(new Set(plan.site.filter((tile) => tile.key.startsWith("construction-earth-")).map((tile) => tile.key)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(foundation.site.filter((tile) => tile.key === "construction-foundation" || tile.key === "construction-foundation-alt").map((tile) => tile.key)).size).toBeGreaterThanOrEqual(2);
  });

  it("keeps details inside the pad, mutually disjoint and away from the gate corridor", () => {
    for (const stage of [1, 2]) {
      const width = 14;
      const entrance = 7;
      const layout = constructionStageLayout({ width, height: 12 }, entrance, stage, 19);
      const occupied = new Set<string>();
      for (const detail of layout.details) {
        const spec = CONSTRUCTION_DETAIL_SPECS.find((candidate) => candidate.key === detail.key)!;
        expect(spec.stage).toBe(stage);
        for (let y = detail.y; y < detail.y + spec.footprint.height; y += 1) {
          for (let x = detail.x; x < detail.x + spec.footprint.width; x += 1) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(width);
            expect(y).toBeGreaterThanOrEqual(-layout.padDepth);
            expect(y).toBeLessThan(0);
            const coordinate = `${x},${y}`;
            expect(occupied.has(coordinate), `${detail.key} overlaps ${coordinate}`).toBe(false);
            occupied.add(coordinate);
          }
        }
      }
      for (const x of [entrance - 1, entrance]) {
        expect(occupied.has(`${x},-1`)).toBe(false);
        expect(occupied.has(`${x},-2`)).toBe(false);
      }
    }
  });

  it("can select every authored detail across seeded large sites", () => {
    const seen = new Set<string>();
    for (const stage of [1, 2]) {
      for (let seed = 0; seed < 160; seed += 1) {
        for (const detail of constructionStageLayout({ width: 18, height: 16 }, 9, stage, seed).details) {
          seen.add(detail.key);
        }
      }
    }
    expect(seen).toEqual(new Set(CONSTRUCTION_DETAIL_SPECS.map((detail) => detail.key)));
  });
});
