import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { ChunkPayloadV1Dto } from "../src/shared/contracts";
import { encodeTerrainSample, materializeChunkPayload } from "../src/shared/world-chunk-payload";
import { terrainAt } from "../src/shared/world-terrain";

function payload(lod: "DETAIL" | "OVERVIEW"): ChunkPayloadV1Dto {
  return {
    payloadVersion: 1,
    contentHash: "test-content-hash",
    generatorVersion: "square-v7",
    terrainSeed: 84721,
    publishedVersion: 7,
    lod,
    chunkX: -1,
    chunkY: 2,
    size: 64,
    roads: [],
    surfaces: [],
    districts: [],
    tasks: [],
    worldFeatures: [],
    decorationContext: { cityBounds: [], districts: [], tasks: [] },
  };
}

describe("published world chunk payload", () => {
  it("reconstructs deterministic detail terrain without transporting terrain objects", () => {
    const compact = payload("DETAIL");
    expect(compact).not.toHaveProperty("terrain");
    expect(compact).not.toHaveProperty("decorations");

    const first = materializeChunkPayload(compact);
    const second = materializeChunkPayload(compact);

    expect(first.terrain).toHaveLength(4096);
    expect(first.terrain[0]).toEqual({ x: -64, y: 128, ...terrainAt(84721, -64, 128) });
    expect(first).toEqual(second);
    expect(first.worldVersion).toBe(7);
    expect(JSON.stringify(compact).length * 10).toBeLessThan(JSON.stringify(first).length);
  });

  it("reuses compact first-frame terrain samples without changing the materialized chunk", () => {
    const compact = payload("DETAIL");
    const samples = new Uint8Array(compact.size * compact.size);
    let index = 0;
    for (let y = compact.chunkY * compact.size; y < (compact.chunkY + 1) * compact.size; y += 1) {
      for (let x = compact.chunkX * compact.size; x < (compact.chunkX + 1) * compact.size; x += 1) {
        samples[index++] = encodeTerrainSample(terrainAt(compact.terrainSeed, x, y));
      }
    }

    expect(materializeChunkPayload(compact, samples)).toEqual(materializeChunkPayload(compact));
    expect(samples.byteLength).toBe(4096);
  });

  it("reconstructs the 4x overview sampling grid", () => {
    const chunk = materializeChunkPayload(payload("OVERVIEW"));

    expect(chunk.terrain).toHaveLength(256);
    expect(chunk.terrain.slice(0, 3).map(({ x, y }) => [x, y])).toEqual([
      [-64, 128], [-60, 128], [-56, 128],
    ]);
    expect(chunk.decorations).toEqual([]);
  });

  it("uses the district ownership halo instead of drawing a fence on a chunk seam", () => {
    const renderCells = Array.from({ length: 64 * 64 }, (_, index) => ({ x: index % 64, y: Math.floor(index / 64) }));
    const ownershipCells = Array.from({ length: 65 * 64 }, (_, index) => ({ x: index % 65, y: Math.floor(index / 65) }));
    const compact = payload("DETAIL");
    compact.terrainSeed = 8;
    compact.chunkX = 0;
    compact.chunkY = 0;
    compact.districts = [{
      id: "cross-seam", cityId: "city", name: "Cross seam", deadline: null,
      status: "PLANNED", color: "#fff", archetype: "MIXED_URBAN", cells: renderCells,
    }];
    compact.decorationContext.districts = [{
      id: "cross-seam", status: "PLANNED", archetype: "MIXED_URBAN", cells: ownershipCells,
    }];

    const chunk = materializeChunkPayload(compact);

    expect(chunk.decorations).not.toContainEqual(expect.objectContaining({ kind: "fence-vertical", origin: { x: 63, y: 62 } }));
  });

  it("keeps frontage decorations off an adjacent task access path", () => {
    const compact = payload("DETAIL");
    compact.chunkX = 0;
    compact.chunkY = 0;
    const buildingFootprint = Array.from({ length: 10 * 8 }, (_, index) => ({
      x: 20 + index % 10,
      y: 20 + Math.floor(index / 10),
    }));
    const frontage = [
      ...Array.from({ length: 10 }, (_, index) => ({ x: 20 + index, y: 19, kind: "PATH" as const, finish: "PAVERS" as const })),
      ...Array.from({ length: 10 }, (_, index) => ({ x: 20 + index, y: 28, kind: "PATH" as const, finish: "PAVERS" as const })),
    ];
    compact.surfaces = frontage;
    compact.tasks = [{
      id: "building", taskNumber: 81, cityId: "city", districtId: "district", title: "Building", workItemType: "TASK",
      status: "IN_PROGRESS", progress: 50, stage: 3, buildingType: "highrise-luxury-tower", visualKind: "BUILDING",
      visualAssetKey: "highrise-luxury-tower", platformType: "STONE", origin: { x: 20, y: 20 },
      footprint: buildingFootprint, accessPath: [],
    }];
    compact.decorationContext.tasks = [
        {
          id: "building", taskNumber: 81, visualKind: "BUILDING", stage: 3,
          footprint: buildingFootprint, accessPath: [],
        },
        {
          id: "adjacent", taskNumber: 82, visualKind: "PARK", stage: 1,
          footprint: [{ x: 40, y: 40 }], accessPath: frontage.map(({ x, y }) => ({ x, y })),
        },
    ];

    const chunk = materializeChunkPayload(compact);

    expect(chunk.decorations.filter((item) => item.id.startsWith("frontage:building:"))).toEqual([]);
  });

  it("derives area interiors from the seed and ignores legacy PARK_DECOR children", () => {
    const compact = payload("DETAIL");
    compact.chunkX = 0;
    compact.chunkY = 0;
    compact.worldFeatures = [
      {
        id: "park", cityId: "city", districtId: "district", parentFeatureId: null,
        kind: "PARK", assetKind: "AREA", assetKey: "urban-park", origin: { x: 8, y: 8 },
        footprint: Array.from({ length: 5 * 4 }, (_, index) => ({ x: 8 + index % 5, y: 8 + Math.floor(index / 5) })),
        orientation: "S", accessPath: [], developmentStage: 5,
      },
      {
        id: "legacy-tree", cityId: "city", districtId: "district", parentFeatureId: "park",
        kind: "PARK_DECOR", assetKind: "PROP", assetKey: "tree-oak", origin: { x: 8, y: 8 },
        footprint: [{ x: 8, y: 8 }], orientation: "S", accessPath: [], developmentStage: 5,
      },
    ];

    const first = materializeChunkPayload(compact);
    const second = materializeChunkPayload(compact);

    expect(first.worldFeatures.map((feature) => feature.id)).toEqual(["park"]);
    expect(first.decorations.some((decoration) => decoration.id.startsWith("area:park:"))).toBe(true);
    expect(first.decorations).toEqual(second.decorations);
  });

  it("keeps every ambient and derived decoration outside an airport interior", () => {
    const compact = payload("DETAIL");
    compact.chunkX = 0;
    compact.chunkY = 0;
    const origin = { x: 8, y: 8 };
    const width = 24;
    const height = 16;
    const perimeter = [
      ...Array.from({ length: width }, (_, index) => ({ x: origin.x + index, y: origin.y })),
      ...Array.from({ length: width }, (_, index) => ({ x: origin.x + index, y: origin.y + height - 1 })),
      ...Array.from({ length: height - 2 }, (_, index) => ({ x: origin.x, y: origin.y + index + 1 })),
      ...Array.from({ length: height - 2 }, (_, index) => ({ x: origin.x + width - 1, y: origin.y + index + 1 })),
    ];
    compact.worldFeatures = [{
      id: "airport", cityId: "city", districtId: null, parentFeatureId: null,
      kind: "AIRPORT", assetKind: "AREA", assetKey: "city-airport-terminal-1", origin,
      footprint: perimeter, orientation: "E", accessPath: [{ x: 32, y: 15 }], developmentStage: 5,
    }];

    const chunk = materializeChunkPayload(compact);

    expect(chunk.decorations.some((decoration) => decoration.id.startsWith("area:airport:"))).toBe(false);
    expect(chunk.decorations.every((decoration) => decoration.origin.x < origin.x
      || decoration.origin.x >= origin.x + width
      || decoration.origin.y < origin.y
      || decoration.origin.y >= origin.y + height)).toBe(true);
  });

  it("keeps the full decoration output compatible across two adjacent chunks", () => {
    const districtCells = Array.from({ length: 128 * 64 }, (_, index) => ({
      x: index % 128,
      y: Math.floor(index / 128),
    }));
    const build = (chunkX: 0 | 1) => {
      const compact = payload("DETAIL");
      compact.terrainSeed = 8;
      compact.chunkX = chunkX;
      compact.chunkY = 0;
      const minX = chunkX * 64;
      const maxX = minX + 63;
      compact.districts = [{
        id: "golden-district", cityId: "city", name: "Golden", deadline: null,
        status: "PLANNED", color: "#fff", archetype: "MIXED_URBAN",
        cells: districtCells.filter((cell) => cell.x >= minX && cell.x <= maxX),
      }];
      compact.decorationContext = {
        cityBounds: [{ minX: 0, minY: 0, maxX: 127, maxY: 63 }],
        districts: [{
          id: "golden-district", status: "PLANNED", archetype: "MIXED_URBAN",
          cells: districtCells.filter((cell) => cell.x >= minX - 1 && cell.x <= maxX + 1),
        }],
        tasks: [],
      };
      return materializeChunkPayload(compact);
    };

    const decorations = [...build(0).decorations, ...build(1).decorations];
    const fingerprint = createHash("sha256").update(JSON.stringify(decorations)).digest("hex");

    expect(decorations.filter((item) => item.kind === "fence-vertical" && (item.origin.x === 63 || item.origin.x === 64))).toEqual([]);
    expect(fingerprint).toBe("a0c9091f69b9c59948c18ff81bc10102093d41daca390335c5952e3cff6835f7");
  });
});
