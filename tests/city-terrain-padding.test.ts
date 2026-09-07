import { describe, expect, it, vi } from "vitest";
import { CityTerrainPadding } from "../src/client/city-terrain-padding";
import { createGroundTerrainSampler } from "../src/client/ground-terrain-sampler";
import { atlasTerrainConnectionMask, atlasTerrainKindFromWorld, atlasTerrainTile } from "../src/shared/atlas-scene";
import { terrainAt } from "../src/shared/world-terrain";
import { cameraTerrainPadding } from "../src/client/camera-terrain-padding";

describe("CITY exterior material source", () => {
  it("captures only visible native cells and mask neighbours, then reuses every sample in the queued full chunk", () => {
    const source = vi.fn((x: number, y: number) => terrainAt(1, x, y));
    const cache = new CityTerrainPadding(1, 8, [], source);
    const fragment = cache.getPartial(-1, 0, [{ x: -8, y: 0 }, { x: -7, y: 0 }])!;
    expect(fragment.terrain).toHaveLength(2); expect(source).toHaveBeenCalledTimes(8);
    for (const cell of fragment.terrain) expect(atlasTerrainConnectionMask(atlasTerrainKindFromWorld(cell.terrain), cell.x, cell.y, fragment.kindAt))
      .toBe(atlasTerrainConnectionMask(atlasTerrainKindFromWorld(cell.terrain), cell.x, cell.y, (x, y) => atlasTerrainKindFromWorld(terrainAt(1, x, y).terrain)));
    cache.getPartial(-1, 0, [{ x: -8, y: 0 }, { x: -7, y: 0 }]); expect(source).toHaveBeenCalledTimes(8);
    cache.get(-1, 0); expect(source).toHaveBeenCalledTimes(64 + 4 * 8);
    expect(new Set(source.mock.calls.map(([x, y]) => `${x},${y}`)).size).toBe(source.mock.calls.length);
    cache.retain([]); expect(cache.cachedChunks).toBe(0);
  });
  it("prewarms only one local ring, preserving every visible chunk and excluding the resident city", () => {
    const position = { x: 512, y: 256 }, screen = { width: 1536, height: 512 };
    const bounds = { minX: 0, minY: 0, maxX: 63, maxY: 63 };
    const visible = cameraTerrainPadding(position, 1, screen, bounds, 8, 64);
    const warm = cameraTerrainPadding(position, 1, screen, bounds, 8, 64, 1);
    for (const coordinate of visible) expect(warm).toContainEqual(coordinate);
    expect(warm).not.toContainEqual([0, 0]); expect(warm).toHaveLength(19);
    expect(() => cameraTerrainPadding(position, 1, screen, bounds, 8, 64, 2)).toThrow(/halo/);
  });
  it("captures the exact native seed terrain and its one-cell mask halo once, never resident entities", () => {
    const source = vi.fn((x: number, y: number) => terrainAt(1, x, y));
    const cache = new CityTerrainPadding(1, 64, [{ chunkX: 3, chunkY: 4 }], source);
    expect(cache.get(3, 4)).toBeUndefined(); expect(source).not.toHaveBeenCalled();
    const material = cache.get(2, 5)!;
    expect(Object.keys(material.chunk).sort()).toEqual(["chunkX", "chunkY", "size", "terrain"]);
    expect(material.chunk.terrain).toHaveLength(4096);
    expect(source).toHaveBeenCalledTimes(4096 + 4 * 64);
    expect(new Set(source.mock.calls.map(([x, y]) => `${x},${y}`)).size).toBe(source.mock.calls.length);
    for (const cell of material.chunk.terrain) expect(cell).toEqual({ x: cell.x, y: cell.y, ...terrainAt(1, cell.x, cell.y) });
    source.mockClear();
    expect(cache.get(2, 5)).toBe(material);
    for (const cell of material.chunk.terrain) {
      const kind = atlasTerrainKindFromWorld(cell.terrain);
      atlasTerrainConnectionMask(kind, cell.x, cell.y, material.kindAt);
    }
    expect(source).not.toHaveBeenCalled();
  });
  it.each([1, 424242])("uses identical atlas family, variant and masks at every padding boundary (seed %i)", seed => {
    const cache = new CityTerrainPadding(seed, 16, []);
    const reference = (x: number, y: number) => atlasTerrainKindFromWorld(terrainAt(seed, x, y).terrain);
    for (const [x, y] of [[-2, -1], [-1, -1], [0, -1], [2, 5]] as const) {
      const material = cache.get(x, y)!;
      // This is the existing resident renderer's public material sampler.
      const residentSampler = createGroundTerrainSampler(material.chunk, reference);
      for (const cell of material.chunk.terrain) {
        const kind = atlasTerrainKindFromWorld(cell.terrain);
        expect(atlasTerrainTile(kind, "city", cell.x, cell.y,
          atlasTerrainConnectionMask(kind, cell.x, cell.y, material.kindAt))).toEqual(
          atlasTerrainTile(kind, "city", cell.x, cell.y,
            atlasTerrainConnectionMask(kind, cell.x, cell.y, residentSampler)));
      }
    }
  });
  it("prunes unneeded sources and rejects unbounded chunk allocations", () => {
    expect(() => new CityTerrainPadding(1, 65, [])).toThrow(/size/i);
    const cache = new CityTerrainPadding(1, 8, []);
    const first = cache.get(-1, 0), retained = cache.get(0, 0);
    cache.retain([[0, 0]]); expect(cache.cachedChunks).toBe(1);
    expect(cache.get(0, 0)).toBe(retained); expect(cache.get(-1, 0)).not.toBe(first);
    cache.retain([]); expect(cache.cachedChunks).toBe(0);
  });
});
