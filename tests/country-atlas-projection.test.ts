import { describe, expect, it } from "vitest";
import { intersects, manhattan } from "../src/server/world/grid";
import { projectCountryAtlas, type CountryAtlasProjectionInput } from "../src/server/world/country-atlas";
import { fitCameraScale } from "../src/client/world-camera";

function city(
  id: string,
  sourceCenter: { x: number; y: number },
  sourceVisualSizePx = { width: 800, height: 800 },
): CountryAtlasProjectionInput["cities"][number] {
  return { id, sourceCenter, sourceVisualSizePx, labelSizePx: { width: 128, height: 24 } };
}

function cityGraphIsConnected(atlas: ReturnType<typeof projectCountryAtlas>): boolean {
  if (atlas.cities.length === 0) return true;
  const reached = new Set([atlas.cities[0]!.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of atlas.connections) {
      if (reached.has(edge.fromCityId) && !reached.has(edge.toCityId)) {
        reached.add(edge.toCityId);
        changed = true;
      } else if (reached.has(edge.toCityId) && !reached.has(edge.fromCityId)) {
        reached.add(edge.fromCityId);
        changed = true;
      }
    }
  }
  return reached.size === atlas.cities.length;
}

describe("country atlas projection", () => {
  it("brings cities closer without changing their relative east/west order", () => {
    const atlas = projectCountryAtlas({
      cities: [
        city("west", { x: 0, y: 0 }),
        city("east", { x: 320, y: 0 }, { width: 1024, height: 896 }),
      ],
    });

    const west = atlas.cities.find((entry) => entry.id === "west")!;
    const east = atlas.cities.find((entry) => entry.id === "east")!;
    expect(west.scale).toBe(0.375);
    expect(east.scale).toBe(0.25);
    expect(east.atlasCenter.x).toBeGreaterThan(west.atlasCenter.x);
    expect(east.atlasCenter.x - west.atlasCenter.x).toBeLessThan(320);
    expect(intersects(west.atlasBounds, east.atlasBounds)).toBe(false);
    expect(atlas.connections.map(({ fromCityId, toCityId }) => [fromCityId, toCityId])).toEqual([["east", "west"]]);
  });

  it("uses manifest-derived visual dimensions and power-of-two scale tiers", () => {
    const atlas = projectCountryAtlas({
      cities: [
        city("compact", { x: 0, y: 0 }, { width: 480, height: 400 }),
        city("grown", { x: 320, y: 0 }, { width: 2048, height: 1536 }),
      ],
    });

    expect(atlas.cities.find((entry) => entry.id === "compact")).toMatchObject({
      scale: 0.5,
      miniatureSizePx: { width: 240, height: 200 },
    });
    expect(atlas.cities.find((entry) => entry.id === "grown")).toMatchObject({
      scale: 0.125,
      miniatureSizePx: { width: 256, height: 192 },
    });
  });

  it("projects the union of district cells as an organic city cutout", () => {
    const atlas = projectCountryAtlas({
      cities: [{
        ...city("organic", { x: 10, y: 10 }, { width: 128, height: 128 }),
        districts: [
          { id: "old-town", cells: [{ x: 6, y: 6 }, { x: 8, y: 6 }, { x: 6, y: 8 }] },
          { id: "harbor", cells: [{ x: 12, y: 12 }, { x: 14, y: 12 }] },
        ],
      }],
    });

    const projected = atlas.cities[0]!;
    const relativeMask = projected.atlasMask.map((cell) => ({
      x: cell.x - projected.atlasCenter.x,
      y: cell.y - projected.atlasCenter.y,
    }));
    expect(projected.districts.map((district) => district.id)).toEqual(["harbor", "old-town"]);
    expect(relativeMask).toEqual([
      { x: -2, y: -1 },
      { x: -1, y: -1 },
      { x: -2, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    expect(relativeMask).not.toContainEqual({ x: -1, y: 0 });

    const relativeCutout = projected.cutoutMask.map((cell) => ({
      x: cell.x - projected.atlasCenter.x,
      y: cell.y - projected.atlasCenter.y,
    }));
    expect(relativeCutout.length).toBeGreaterThan(relativeMask.length);
    expect(relativeCutout).toContainEqual({ x: -3, y: -1 });
    expect(relativeCutout).toContainEqual({ x: 4, y: 1 });
    const cutoutWidth = Math.max(...relativeCutout.map((cell) => cell.x)) - Math.min(...relativeCutout.map((cell) => cell.x)) + 1;
    const cutoutHeight = Math.max(...relativeCutout.map((cell) => cell.y)) - Math.min(...relativeCutout.map((cell) => cell.y)) + 1;
    expect(relativeCutout.length).toBeLessThan(cutoutWidth * cutoutHeight);
    expect(projected.districts.flatMap((district) => district.displayCells)).toHaveLength(projected.cutoutMask.length);
    expect(new Set(projected.districts.flatMap((district) => district.displayCells).map((cell) => `${cell.x}:${cell.y}`)).size)
      .toBe(projected.cutoutMask.length);
    for (const district of projected.districts) {
      expect(district.displayCells.length).toBeGreaterThan(district.atlasCells.length);
      expect(district.displayCells).toEqual(expect.arrayContaining(district.atlasCells));
    }
  });

  it("keeps every rendered city cutout inside the published atlas bounds", () => {
    const atlas = projectCountryAtlas({
      cities: [{
        ...city("wide-organic", { x: 0, y: 0 }, { width: 64, height: 64 }),
        districts: [{
          id: "edge-district",
          cells: Array.from({ length: 81 }, (_, index) => ({ x: index, y: index % 3 })),
        }],
      }],
    });

    const projected = atlas.cities[0]!;
    expect(projected.cutoutMask.length).toBeGreaterThan(0);
    for (const cell of projected.cutoutMask) {
      expect(cell.x, `cutout x ${cell.x}`).toBeGreaterThanOrEqual(atlas.bounds.minX);
      expect(cell.x, `cutout x ${cell.x}`).toBeLessThanOrEqual(atlas.bounds.maxX);
      expect(cell.y, `cutout y ${cell.y}`).toBeGreaterThanOrEqual(atlas.bounds.minY);
      expect(cell.y, `cutout y ${cell.y}`).toBeLessThanOrEqual(atlas.bounds.maxY);
    }
    expect(projected.labelAnchor.y).toBe(Math.min(...projected.cutoutMask.map((cell) => cell.y)));
    expect(projected.labelBounds.maxY).toBe(projected.labelAnchor.y - 1);
    expect(projected.cutoutMask).toContainEqual(projected.labelAnchor);
  });

  it("pads a tall city constellation into a full-width landscape viewport", () => {
    const atlas = projectCountryAtlas({
      cities: [
        city("north", { x: 0, y: -640 }),
        city("middle", { x: 0, y: 0 }),
        city("south", { x: 0, y: 640 }),
      ],
    });
    const width = atlas.bounds.maxX - atlas.bounds.minX + 1;
    const height = atlas.bounds.maxY - atlas.bounds.minY + 1;
    expect(width / height).toBeGreaterThanOrEqual(2);
    const renderedMinX = Math.min(...atlas.cities.flatMap((entry) => [entry.atlasBounds.minX, entry.labelBounds.minX]));
    const renderedMaxX = Math.max(...atlas.cities.flatMap((entry) => [entry.atlasBounds.maxX, entry.labelBounds.maxX]));
    expect(renderedMinX - atlas.bounds.minX).toBeGreaterThanOrEqual(16);
    expect(atlas.bounds.maxX - renderedMaxX).toBeGreaterThanOrEqual(16);
  });

  it("reserves attached labels for irregular city masks during packing", () => {
    const atlas = projectCountryAtlas({
      cities: [
        {
          ...city("asymmetric-west", { x: 0, y: 0 }, { width: 192, height: 160 }),
          districts: [{ id: "west", cells: [{ x: -32, y: -20 }, { x: -30, y: -20 }, { x: 24, y: 18 }] }],
        },
        {
          ...city("asymmetric-east", { x: 0, y: 0 }, { width: 192, height: 160 }),
          districts: [{ id: "east", cells: [{ x: 28, y: -20 }, { x: 30, y: -20 }, { x: -24, y: 18 }] }],
        },
        city("center", { x: 0, y: 0 }, { width: 192, height: 160 }),
      ],
    });
    const renderedBounds = atlas.cities.map((entry) => ({
      minX: Math.min(entry.labelBounds.minX, ...entry.cutoutMask.map((cell) => cell.x)),
      minY: Math.min(entry.labelBounds.minY, ...entry.cutoutMask.map((cell) => cell.y)),
      maxX: Math.max(entry.labelBounds.maxX, ...entry.cutoutMask.map((cell) => cell.x)),
      maxY: Math.max(entry.labelBounds.maxY, ...entry.cutoutMask.map((cell) => cell.y)),
    }));
    for (let left = 0; left < renderedBounds.length; left += 1) {
      for (let right = left + 1; right < renderedBounds.length; right += 1) {
        expect(intersects(renderedBounds[left]!, renderedBounds[right]!)).toBe(false);
      }
    }
  });

  it("samples macro terrain from the real source geography", () => {
    const atlas = projectCountryAtlas({
      terrainSampler: (cell) => ({
        terrain: cell.x < 0 ? "DEEP_WATER" : "FOREST",
        variant: Math.abs(cell.x + cell.y) % 3,
      }),
      cities: [
        city("west", { x: -240, y: 0 }),
        city("east", { x: 240, y: 0 }),
      ],
    });

    expect(atlas.macroTerrain.length).toBeGreaterThan(20);
    expect(new Set(atlas.macroTerrain.map((tile) => tile.terrain))).toEqual(new Set(["DEEP_WATER", "FOREST"]));
    for (const tile of atlas.macroTerrain) {
      expect(tile.terrain).toBe(tile.sourceCenter.x < 0 ? "DEEP_WATER" : "FOREST");
      expect(tile.variant).toBe(Math.abs(tile.sourceCenter.x + tile.sourceCenter.y) % 3);
    }
    const tileOrigins = new Set(atlas.macroTerrain.map((tile) => `${tile.atlasOrigin.x}:${tile.atlasOrigin.y}`));
    expect(tileOrigins.size).toBe(atlas.macroTerrain.length);
    expect(atlas.macroTerrain.every((tile) => tile.widthCells > 0 && tile.widthCells <= 4)).toBe(true);
    expect(atlas.macroTerrain.every((tile) => tile.heightCells > 0 && tile.heightCells <= 4)).toBe(true);
    expect(Math.min(...atlas.macroTerrain.map((tile) => tile.atlasOrigin.x))).toBe(atlas.bounds.minX);
    expect(Math.min(...atlas.macroTerrain.map((tile) => tile.atlasOrigin.y))).toBe(atlas.bounds.minY);
    expect(Math.max(...atlas.macroTerrain.map((tile) => tile.atlasOrigin.x + tile.widthCells - 1))).toBe(atlas.bounds.maxX);
    expect(Math.max(...atlas.macroTerrain.map((tile) => tile.atlasOrigin.y + tile.heightCells - 1))).toBe(atlas.bounds.maxY);
  });

  it("compresses empty space between rigid districts without changing their internal geometry", () => {
    const atlas = projectCountryAtlas({
      cities: [{
        ...city("clustered", { x: 0, y: 0 }),
        districts: [
          { id: "west", cells: [{ x: -42, y: 0 }, { x: -38, y: 0 }, { x: -42, y: 4 }] },
          { id: "east", cells: [{ x: 38, y: 0 }, { x: 42, y: 0 }, { x: 42, y: 4 }] },
        ],
      }],
    });

    const projected = atlas.cities[0]!;
    const westDistrict = projected.districts.find((district) => district.id === "west")!;
    const eastDistrict = projected.districts.find((district) => district.id === "east")!;
    const west = westDistrict.atlasCells;
    const east = eastDistrict.atlasCells;
    const normalize = (cells: typeof west) => {
      const origin = cells[0]!;
      return cells.map((cell) => ({ x: cell.x - origin.x, y: cell.y - origin.y }));
    };
    const centerX = (cells: typeof west) => (Math.min(...cells.map((cell) => cell.x)) + Math.max(...cells.map((cell) => cell.x))) / 2;

    expect(normalize(west)).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }]);
    expect(normalize(east)).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]);
    expect(westDistrict.sourceCenter).toEqual({ x: -40, y: 2 });
    expect(eastDistrict.sourceCenter).toEqual({ x: 40, y: 2 });
    expect(westDistrict.atlasCenter.x).toBeLessThan(eastDistrict.atlasCenter.x);
    expect(centerX(east) - centerX(west)).toBeLessThan(20);
    expect(Math.min(...east.map((cell) => cell.x))).toBeGreaterThan(Math.max(...west.map((cell) => cell.x)));
  });

  it("is deterministic for reordered and coincident city input", () => {
    const cities = [
      city("charlie", { x: 0, y: 0 }),
      city("alpha", { x: 0, y: 0 }),
      city("bravo", { x: 0, y: 0 }),
    ];

    const first = projectCountryAtlas({ cities });
    const second = projectCountryAtlas({ cities: [...cities].reverse() });

    expect(second).toEqual(first);
    for (let left = 0; left < first.cities.length; left += 1) {
      for (let right = left + 1; right < first.cities.length; right += 1) {
        expect(intersects(first.cities[left]!.atlasBounds, first.cities[right]!.atlasBounds)).toBe(false);
      }
    }
  });

  it("connects every city with contiguous paths that avoid unrelated miniatures", () => {
    const atlas = projectCountryAtlas({
      cities: [
        city("north", { x: 0, y: -320 }),
        city("east", { x: 320, y: 0 }),
        city("south", { x: 0, y: 320 }),
        city("west", { x: -320, y: 0 }),
      ],
    });

    expect(atlas.connections).toHaveLength(atlas.cities.length - 1);
    expect(cityGraphIsConnected(atlas)).toBe(true);
    for (const connection of atlas.connections) {
      expect(connection.path.length).toBeGreaterThan(1);
      for (let index = 1; index < connection.path.length; index += 1) {
        expect(manhattan(connection.path[index - 1]!, connection.path[index]!)).toBe(1);
      }
      const unrelated = atlas.cities.filter((entry) => entry.id !== connection.fromCityId && entry.id !== connection.toCityId);
      expect(connection.path.some((cell) => unrelated.some((entry) => (
        cell.x >= entry.atlasBounds.minX && cell.x <= entry.atlasBounds.maxX
        && cell.y >= entry.atlasBounds.minY && cell.y <= entry.atlasBounds.maxY
      )))).toBe(false);
    }
  });

  it("handles empty and one-city countries without synthetic connections", () => {
    expect(projectCountryAtlas({ cities: [] })).toEqual({
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      cities: [],
      connections: [],
      macroTerrain: [],
    });

    const atlas = projectCountryAtlas({ cities: [city("only", { x: 120, y: -80 })] });
    expect(atlas.cities).toHaveLength(1);
    expect(atlas.connections).toEqual([]);
  });

  it("fits eight labeled city miniatures into one desktop viewport", () => {
    const atlas = projectCountryAtlas({
      cities: [
        city("archive", { x: -320, y: -320 }),
        city("billing", { x: 0, y: -360 }),
        city("mobile", { x: 320, y: -320 }),
        city("crm", { x: -380, y: 0 }),
        city("capital", { x: 0, y: 0 }, { width: 1024, height: 960 }),
        city("platform", { x: 380, y: 0 }),
        city("analytics", { x: -240, y: 320 }),
        city("delivery", { x: 260, y: 340 }),
      ],
    });

    const scale = fitCameraScale({ width: 1440, height: 900 }, atlas.bounds, 8, 1, 48);
    expect(scale).toBeGreaterThanOrEqual(0.48);
    for (const projected of atlas.cities) {
      expect(projected.labelBounds.maxY).toBeLessThan(projected.atlasBounds.minY);
    }
    for (let left = 0; left < atlas.cities.length; left += 1) {
      for (let right = left + 1; right < atlas.cities.length; right += 1) {
        const a = atlas.cities[left]!;
        const b = atlas.cities[right]!;
        expect(intersects(a.labelBounds, b.atlasBounds)).toBe(false);
        expect(intersects(a.labelBounds, b.labelBounds)).toBe(false);
        expect(intersects(a.atlasBounds, b.labelBounds)).toBe(false);
      }
    }
  });

  it("balances a tall source constellation for a landscape atlas without changing axis order", () => {
    const source = [
      ["riverside", -30, 0], ["pinegate", -285, 179], ["harborview", -36, -338], ["stonebridge", -5, 355],
      ["northbank", -279, -152], ["eastmere", 344, -17], ["meadowrun", -228, 410], ["southport", -361, -527],
    ] as const;
    const atlas = projectCountryAtlas({ cities: source.map(([id, x, y]) => city(id, { x, y })) });
    const width = atlas.bounds.maxX - atlas.bounds.minX + 1;
    const height = atlas.bounds.maxY - atlas.bounds.minY + 1;

    expect(width / height).toBeGreaterThan(1.2);
    const bySourceX = [...source].sort((left, right) => left[1] - right[1]).map(([id]) => id);
    const byAtlasX = [...atlas.cities].sort((left, right) => left.atlasCenter.x - right.atlasCenter.x).map((entry) => entry.id);
    expect(byAtlasX).toEqual(bySourceX);
  });

  it("projects districts with production-scale cell collections without overflowing the call stack", () => {
    const repeatedCells = Array.from({ length: 200_000 }, (_, index) => ({
      x: index % 2,
      y: index % 3,
    }));

    const atlas = projectCountryAtlas({
      cities: [{
        ...city("large-district", { x: 0, y: 0 }, { width: 1024, height: 1024 }),
        districts: [{ id: "dense", cells: repeatedCells }],
      }],
    });

    expect(atlas.cities).toHaveLength(1);
    expect(atlas.cities[0]!.districts).toMatchObject([{ id: "dense" }]);
  });
});
