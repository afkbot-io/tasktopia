import { expect, it } from "vitest";
import { generateWorldDecorations } from "../src/shared/world-decorations";
import type { TerrainCellDto, SurfaceCellDto } from "../src/shared/contracts";
const terrain: TerrainCellDto[] = Array.from({ length: 96 * 12 }, (_, i) => ({ x: i % 96 - 48,
  y: Math.floor(i / 96) - 6, terrain: "GRASS", variant: 0 }));
const surfaces: SurfaceCellDto[] = Array.from({ length: 96 }, (_, i) => ({ x: i - 48, y: 0, kind: "SIDEWALK", variant: 0 }));
const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
const blocked = new Set(surfaces.map(key));
const city = [{ minX: -48, minY: -6, maxX: 47, maxY: 5 }];
const lamps = (cells: TerrainCellDto[], paving = surfaces, obstacles = blocked) => generateWorldDecorations(
  42, cells, obstacles, paving, [], city, [], terrain).filter(item => item.kind.startsWith("streetlamp"));

it("lights both sides of a street predictably without occupying the walking surface", () => {
  const result = lamps(terrain);
  expect(result.length).toBeGreaterThanOrEqual(20);
  expect(result.length).toBeLessThan(40);
  expect(result.every(item => Math.abs(item.origin.y) === 1 && !blocked.has(key(item.origin)))).toBe(true);
  for (const y of [-1, 1]) {
    const xs = result.filter(item => item.origin.y === y).map(item => item.origin.x).sort((a,b) => a-b);
    expect(xs.length).toBeGreaterThan(8);
    for (let i=1;i<xs.length;i++) expect(xs[i]! - xs[i-1]!).toBe(8);
  }
});

it("preserves anchors across chunk splits and reversed traversal", () => {
  const sorted = (items: ReturnType<typeof lamps>) => items.map(item => item.id).sort();
  expect(sorted(lamps([...terrain].reverse()))).toEqual(sorted(lamps(terrain)));
  expect(sorted([...lamps(terrain.filter(c=>c.x<0)), ...lamps(terrain.filter(c=>c.x>=0))])).toEqual(sorted(lamps(terrain)));
});

it("leaves crossing approaches and occupied cells clear", () => {
  const paving = surfaces.map(c => Math.abs(c.x) <= 2 ? { ...c, kind: "CROSSWALK" as const } : c);
  const obstacles = new Set([...blocked, ...terrain.filter(c=>c.x>25).map(key)]);
  expect(lamps(terrain,paving,obstacles).every(item=>Math.abs(item.origin.x)>4 && item.origin.x<=25)).toBe(true);
});

it("lights courtyard paths as well as street sidewalks", () => {
  const paths = surfaces.map(cell => ({ ...cell, kind: "PATH" as const }));
  expect(lamps(terrain, paths).length).toBeGreaterThanOrEqual(20);
});
