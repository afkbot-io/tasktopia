import { describe, expect, it, vi } from "vitest";
import { createGroundTerrainSampler } from "../src/client/ground-terrain-sampler";
import { atlasTerrainConnectionMask, atlasTerrainKindFromWorld } from "../src/shared/atlas-scene";
import { terrainAt } from "../src/shared/world-terrain";
import type { ChunkDto } from "../src/shared/contracts";

function chunk(seed: number, chunkX: number, chunkY: number, size: number): Pick<ChunkDto, "chunkX" | "chunkY" | "size" | "terrain"> {
  const terrain = [];
  for (let y = chunkY * size; y < (chunkY + 1) * size; y++) {
    for (let x = chunkX * size; x < (chunkX + 1) * size; x++) terrain.push({ x, y, ...terrainAt(seed, x, y) });
  }
  return { chunkX, chunkY, size, terrain: terrain.reverse() };
}

describe("ground texture authoritative terrain sampler", () => {
  it("reuses already materialized cells and evaluates each external border coordinate only once", () => {
    const input = chunk(84721, -2, -1, 8);
    const original = structuredClone(input);
    const source = vi.fn((x: number, y: number) => atlasTerrainKindFromWorld(terrainAt(84721, x, y).terrain));
    const sample = createGroundTerrainSampler(input, source);
    for (let pass = 0; pass < 3; pass++) for (const cell of input.terrain) {
      const kind = atlasTerrainKindFromWorld(cell.terrain);
      expect(sample(cell.x, cell.y)).toBe(kind);
      atlasTerrainConnectionMask(kind, cell.x, cell.y, sample);
    }
    expect(source).toHaveBeenCalledTimes(4 * input.size);
    for (const [x, y] of source.mock.calls) {
      expect(x < -16 || x >= -8 || y < -8 || y >= 0).toBe(true);
    }
    expect(input).toEqual(original);
  });
  it.each([84721, 424242])("preserves all original tile connection masks across negative coordinates and adjacent chunk seams (seed %i)", seed => {
    const source = (x: number, y: number) => atlasTerrainKindFromWorld(terrainAt(seed, x, y).terrain);
    for (const chunkX of [-2, -1, 0]) for (const chunkY of [-1, 0]) {
      const input = chunk(seed, chunkX, chunkY, 8);
      const sample = createGroundTerrainSampler(input, source);
      for (const cell of input.terrain) {
        const kind = atlasTerrainKindFromWorld(cell.terrain);
        expect(atlasTerrainConnectionMask(kind, cell.x, cell.y, sample)).toBe(atlasTerrainConnectionMask(kind, cell.x, cell.y, source));
      }
    }
  });
  it("falls back for holes instead of assuming the materialized array is row-ordered or complete", () => {
    const input = chunk(84721, 0, 0, 4);
    const removed = input.terrain.pop()!;
    const source = vi.fn((x: number, y: number) => atlasTerrainKindFromWorld(terrainAt(84721, x, y).terrain));
    const sample = createGroundTerrainSampler(input, source);
    expect(sample(removed.x, removed.y)).toBe(source(removed.x, removed.y));
    source.mockClear();
    sample(removed.x, removed.y);
    expect(source).not.toHaveBeenCalled();
  });
});
