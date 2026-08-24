import { describe, expect, it } from "vitest";
import { seedTerrainCellPresentation, seededFieldKind } from "../src/client/seed-terrain-presentation";

describe("network-free seed terrain presentation", () => {
  it("draws deterministic connected grass detail without wallpaper noise", () => {
    const first = seedTerrainCellPresentation(84_721, { x: 19, y: -7, terrain: "GRASS", variant: 1 });
    const second = seedTerrainCellPresentation(84_721, { x: 19, y: -7, terrain: "GRASS", variant: 1 });

    expect(second).toEqual(first);
    expect(first.accents.every((accent) => accent.x >= 1 && accent.x <= 6 && accent.y >= 1 && accent.y <= 6)).toBe(true);

    const samples = Array.from({ length: 24 * 24 }, (_, index) => seedTerrainCellPresentation(84_721, {
      x: index % 24,
      y: Math.floor(index / 24),
      terrain: "GRASS" as const,
      variant: 1,
    }));
    expect(samples.some((sample) => sample.accents.length === 0)).toBe(true);
    expect(samples.some((sample) => sample.accents.length >= 2)).toBe(true);
    expect(samples.reduce((total, sample) => total + sample.accents.length, 0) / samples.length).toBeLessThan(1.5);
    for (const sample of samples.filter((candidate) => !candidate.fieldKind)) {
      const remaining = new Set(sample.accents.map((accent) => `${accent.x},${accent.y}`));
      const clusterSizes: number[] = [];
      while (remaining.size > 0) {
        const [start] = remaining;
        const queue = [start!];
        remaining.delete(start!);
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const [x, y] = queue[cursor]!.split(",").map(Number);
          for (const neighbor of [`${x! - 1},${y}`, `${x! + 1},${y}`, `${x},${y! - 1}`, `${x},${y! + 1}`]) {
            if (remaining.delete(neighbor)) queue.push(neighbor);
          }
        }
        clusterSizes.push(queue.length);
      }
      expect(clusterSizes.length).toBeLessThanOrEqual(2);
      expect(clusterSizes.every((size) => size >= 1 && size <= 3)).toBe(true);
    }
  });

  it("builds large coherent crop fields directly from global seed coordinates", () => {
    const fieldCells = new Set<string>();
    for (let y = 0; y < 192; y += 1) for (let x = 0; x < 192; x += 1) {
      if (seededFieldKind(20260821, { x, y }, "MEADOW")) fieldCells.add(`${x},${y}`);
    }
    const componentSizes: number[] = [];
    while (fieldCells.size > 0) {
      const [start] = fieldCells;
      const queue = [start!];
      fieldCells.delete(start!);
      let size = 0;
      for (let index = 0; index < queue.length; index += 1) {
        size += 1;
        const [x, y] = queue[index]!.split(",").map(Number);
        for (const neighbor of [`${x! - 1},${y}`, `${x! + 1},${y}`, `${x},${y! - 1}`, `${x},${y! + 1}`]) {
          if (!fieldCells.delete(neighbor)) continue;
          queue.push(neighbor);
        }
      }
      componentSizes.push(size);
    }
    expect(Math.max(...componentSizes)).toBeGreaterThanOrEqual(800);

    const fieldPatterns = new Set<string>();
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
      const presentation = seedTerrainCellPresentation(20260821, { x, y, terrain: "MEADOW", variant: 0 });
      if (!presentation.fieldKind) continue;
      fieldPatterns.add(presentation.accents.map((accent) => `${accent.x},${accent.y}`).join("|"));
    }
    expect(fieldPatterns.size).toBeGreaterThan(12);
  });
});
