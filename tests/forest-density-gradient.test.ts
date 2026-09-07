import { expect, it } from "vitest";
import { generateWorldDecorations } from "../src/shared/world-decorations";
import type { TerrainCellDto } from "../src/shared/contracts";
it("contains dense canopy patches as well as sparse woodland without overlapping trunks", () => {
  const terrain: TerrainCellDto[] = Array.from({ length: 128 * 128 }, (_, i) => ({ x: i % 128, y: Math.floor(i / 128), terrain: "FOREST", variant: 0 }));
  const trees = generateWorldDecorations(91357, terrain, new Set(), [], [], [], []);
  const counts = Array.from({ length: 64 }, () => 0);
  for (const tree of trees) counts[Math.floor(tree.origin.y / 16) * 8 + Math.floor(tree.origin.x / 16)]!++;
  expect(Math.max(...counts)).toBeGreaterThan(100);
  expect(Math.min(...counts)).toBeLessThan(40);
  expect(Math.max(...counts) / Math.min(...counts)).toBeGreaterThan(3);
  expect(trees.length).toBeGreaterThan(2200);
});
