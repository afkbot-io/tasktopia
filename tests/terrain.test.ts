import { describe, expect, it } from "vitest";
import { terrainAt } from "../src/server/world/terrain";

describe("deterministic square terrain", () => {
  it("is independent of request order and exposes the core biome families", () => {
    const seed = 424_242;
    const coordinates = Array.from({ length: 160 }, (_, index) => ({ x: index * 3 - 240, y: (index * 47) % 320 - 160 }));
    const forward = coordinates.map((cell) => terrainAt(seed, cell.x, cell.y));
    const reverse = [...coordinates].reverse().map((cell) => terrainAt(seed, cell.x, cell.y)).reverse();
    expect(reverse).toEqual(forward);

    const kinds = new Set<string>();
    for (let y = -300; y <= 300; y += 3) for (let x = -360; x <= 360; x += 3) kinds.add(terrainAt(seed, x, y).terrain);
    for (const required of ["GRASS", "MEADOW", "FOREST", "HILL", "MOUNTAIN", "SAND", "WET_SAND", "SHALLOW_WATER", "DEEP_WATER"]) {
      expect(kinds.has(required), required).toBe(true);
    }
  });
});
