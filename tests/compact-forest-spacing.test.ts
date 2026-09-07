import { describe, expect, it } from "vitest";
import { generateWorldDecorations } from "../src/shared/world-decorations";
import type { TerrainCellDto } from "../src/shared/contracts";

const terrain: TerrainCellDto[] = Array.from({ length: 64 * 64 }, (_, i) => ({
  x: i % 64 - 32, y: Math.floor(i / 64) - 32, terrain: "FOREST", variant: 0,
}));
const trees = (cells: TerrainCellDto[], blocked = new Set<string>()) =>
  generateWorldDecorations(91357, cells, blocked, [], [], [], []).filter(item => item.kind.startsWith("tree-"));

describe("compact forest visible clearance", () => {
  it("finds shoreline beyond the crown halo with a bounded seed lookup", () => {
    const coast: TerrainCellDto[] = Array.from({ length: 128 * 128 }, (_, i) => ({
      x: i % 128, y: Math.floor(i / 128), terrain: i % 128 >= 64 ? "SHALLOW_WATER" : "GRASS", variant: 0,
    }));
    const expected = trees(coast).find(item => item.kind === "tree-willow" && item.origin.x < 62 && item.origin.x >= 54);
    expect(expected).toBeDefined();
    const origin = coast.find(cell => cell.x === expected!.origin.x && cell.y === expected!.origin.y)!;
    const halo = coast.filter(cell => Math.abs(cell.x - origin.x) <= 2 && Math.abs(cell.y - origin.y) <= 2);
    let probes = 0;
    const result = generateWorldDecorations(91357, [origin], new Set(), [], [], [], [], halo, cell => {
      probes += 1; return cell.x >= 64 ? "SHALLOW_WATER" : "GRASS";
    });
    expect(result).toContainEqual(expected);
    expect(probes).toBeGreaterThan(0);
    expect(probes).toBeLessThanOrEqual(40);
  });
  it("overlaps crowns on irregular grid anchors without duplicate trunks", () => {
    const result = trees(terrain);
    expect(result.length).toBeGreaterThan(220);
    expect(result.length).toBeLessThan(2600);
    const occupied = new Set<string>();
    let neighbours = 0;
    const phases = new Set<string>();
    for (const tree of result) {
      expect(occupied.has(`${tree.origin.x},${tree.origin.y}`)).toBe(false);
      phases.add(`${Math.abs(tree.origin.x % 2)},${Math.abs(tree.origin.y % 2)}`);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (occupied.has(`${tree.origin.x + dx},${tree.origin.y + dy}`)) neighbours++;
      }
      occupied.add(`${tree.origin.x},${tree.origin.y}`);
    }
    expect(neighbours).toBeGreaterThan(result.length / 3);
    expect(phases.size).toBe(4);
  });

  it("is identical when chunks are split, reversed, or cross negative coordinates", () => {
    const ids = (items: ReturnType<typeof trees>) => items.map(item => item.id).sort();
    expect(ids(trees([...terrain].reverse()))).toEqual(ids(trees(terrain)));
    expect(ids([...trees(terrain.filter(c => c.x < 0)), ...trees(terrain.filter(c => c.x >= 0))]))
      .toEqual(ids(trees(terrain)));
  });

  it("keeps the projected crown away from reserved construction and street cells", () => {
    const blocked = new Set(Array.from({ length: 20 }, (_, i) => `0,${i - 10}`));
    for (const tree of trees(terrain, blocked)) {
      // The trunk is at the cell center; its 14px crown can reach two cells north.
      for (let dy = -2; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) {
        expect(blocked.has(`${tree.origin.x + dx},${tree.origin.y + dy}`), tree.id).toBe(false);
      }
    }
  });
});
