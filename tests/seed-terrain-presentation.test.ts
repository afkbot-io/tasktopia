import { describe, expect, it } from "vitest";
import { seedTerrainCellPresentation } from "../src/client/seed-terrain-presentation";

describe("network-free seed terrain presentation", () => {
  it("draws deterministic pixel texture on grass without waiting for PNG assets", () => {
    const first = seedTerrainCellPresentation(84_721, { x: 19, y: -7, terrain: "GRASS", variant: 1 });
    const second = seedTerrainCellPresentation(84_721, { x: 19, y: -7, terrain: "GRASS", variant: 1 });

    expect(second).toEqual(first);
    expect(first.accents.length).toBeGreaterThanOrEqual(2);
    expect(new Set([first.fill, ...first.accents.map((accent) => accent.color)]).size).toBeGreaterThan(1);
    expect(first.accents.every((accent) => accent.x >= 1 && accent.x <= 6 && accent.y >= 1 && accent.y <= 6)).toBe(true);
  });
});
