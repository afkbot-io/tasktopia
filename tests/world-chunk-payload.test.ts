import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { ChunkPayloadV1Dto } from "../src/shared/contracts";
import { materializeChunkPayload } from "../src/shared/world-chunk-payload";
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
    expect(fingerprint).toBe("12f7292bb21f2269432c28fe4b4fd06bbaa041a2b94cf8a7f583b3a414329034");
  });
});
