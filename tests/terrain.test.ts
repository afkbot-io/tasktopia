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

  it("selects materially different but bounded hydrology between world seeds", () => {
    const masks = new Set<string>();
    for (const seed of [17, 41, 83, 127, 251, 509, 1021, 2053]) {
      let water = 0;
      let total = 0;
      let signature = "";
      for (let y = -220; y <= 220; y += 8) {
        for (let x = -260; x <= 260; x += 8) {
          const wet = terrainAt(seed, x, y).terrain.endsWith("WATER");
          water += Number(wet); total += 1;
          if ((x + 260) % 40 === 0 && (y + 220) % 40 === 0) signature += wet ? "1" : "0";
        }
      }
      expect(water / total).toBeGreaterThan(0.015);
      expect(water / total).toBeLessThan(0.42);
      masks.add(signature);
    }
    expect(masks.size).toBeGreaterThanOrEqual(6);
  });

  it("keeps terrain identical across an arbitrary chunk seam", () => {
    const seed = 509;
    const direct = Array.from({ length: 97 }, (_, index) => terrainAt(seed, 32, index - 48));
    const fromLeftChunk = Array.from({ length: 97 }, (_, index) => terrainAt(seed, 31 + 1, index - 48));
    expect(fromLeftChunk).toEqual(direct);
  });
});
