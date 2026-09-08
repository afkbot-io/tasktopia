import { compactCellRuns, compactSurfaceRuns } from "../src/shared/world-cell-runs";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { ChunkPayloadV2Dto } from "../src/shared/contracts";
import { encodeTerrainSample, materializeChunkPayload } from "../src/shared/world-chunk-payload";
import { terrainAt } from "../src/shared/world-terrain";

function payload(lod: "DETAIL" | "OVERVIEW"): ChunkPayloadV2Dto {
  return {
    payloadVersion: 2,
    contentHash: "test-content-hash",
    generatorVersion: "block-v1",
    terrainSeed: 84721,
    publishedVersion: 7,
    lod,
    chunkX: -1,
    chunkY: 2,
    size: 64,
    roadRuns: [],
    surfaceRuns: [],
    districts: [],
    tasks: [],
    worldFeatures: [],
    decorationContext: { treeGeometryVersion: 7, lightingVersion: 1, surfaceHaloRuns: [], blockedCellRuns: [], cityBounds: [], districts: [], tasks: [] },
  };
}

describe("published world chunk payload", () => {
  it("uses the paving halo for seam-side lamps without rendering adjacent chunks", () => {
    const compact = { ...payload("DETAIL"), terrainSeed:42, chunkX:0, chunkY:0 };
    const paving = Array.from({length:64},(_,y)=>({x:64,y,kind:"SIDEWALK" as const,variant:0}));
    compact.decorationContext.surfaceHaloRuns = compactSurfaceRuns(paving);
    // Paving belongs to the surface halo, not the hard occupancy halo.
    compact.decorationContext.blockedCellRuns = [];
    const samples = new Uint8Array(4096).fill(encodeTerrainSample({terrain:"GRASS",variant:0}));
    const chunk = materializeChunkPayload(compact,samples);
    expect(chunk.decorations.some(d=>d.kind.startsWith("streetlamp") && d.origin.x===63)).toBe(true);
    expect(chunk.decorations.every(d=>d.origin.x>=0 && d.origin.x<64 && d.origin.y>=0 && d.origin.y<64)).toBe(true);
    expect(chunk.surfaces).toEqual([]);
    expect(chunk.terrain).toHaveLength(4096);
    // This is the previous mixed representation, reconstructed only in the
    // test: keeping paving separate must not alter existing lamps or crowns.
    compact.decorationContext.blockedCellRuns = compactCellRuns(paving);
    expect(materializeChunkPayload(compact, samples).decorations).toEqual(chunk.decorations);
  });
  it("uses compact off-chunk obstacles without rendering their cells", () => {
    const compact = { ...payload("DETAIL"), terrainSeed: 84720, chunkX: 0, chunkY: 0 };
    const samples = new Uint8Array(4096).fill(encodeTerrainSample({ terrain: "FOREST", variant: 0 }));
    const first = materializeChunkPayload(compact, samples);
    const edgeTree = first.decorations.find(item => item.kind.startsWith("tree-")
      && item.origin.x === 0 && item.origin.y > 2 && item.origin.y < 62);
    expect(edgeTree).toBeDefined();
    compact.decorationContext.blockedCellRuns = compactCellRuns([{ x: -1, y: edgeTree!.origin.y }]);
    const guarded = materializeChunkPayload(compact, samples);
    expect(guarded.decorations.some(item => item.id === edgeTree!.id)).toBe(false);
    expect(guarded.terrain).toHaveLength(4096);
    expect(guarded.terrain.every(cell => cell.x >= 0 && cell.y >= 0)).toBe(true);
  });
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
      status: "PLANNED", color: "#fff", archetype: "MIXED_URBAN", cellRuns: compactCellRuns(renderCells),
    }];
    compact.decorationContext.districts = [{
      id: "cross-seam", status: "PLANNED", archetype: "MIXED_URBAN", cellRuns: compactCellRuns(ownershipCells),
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
    compact.surfaceRuns = compactSurfaceRuns(frontage);
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

  it("derives deterministic area interiors from a single persisted parent", () => {
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
    ];

    const first = materializeChunkPayload(compact);
    const second = materializeChunkPayload(compact);

    expect(first.worldFeatures.map((feature) => feature.id)).toEqual(["park"]);
    expect(first.decorations.some((decoration) => decoration.id.startsWith("area:park:"))).toBe(true);
    expect(first.decorations).toEqual(second.decorations);
  });

  it("keeps ambient trees and props outside every reserved stage-zero plot", () => {
    const compact = payload("DETAIL"); compact.chunkX=0; compact.chunkY=0;
    compact.plannedSites=[{id:"planned",origin:{x:8,y:8},width:6,height:6,kind:"BUILDING"}];
    const chunk=materializeChunkPayload(compact);
    expect(chunk.plannedSites).toEqual(compact.plannedSites);
    expect(chunk.decorations.every(d=>d.origin.x<8||d.origin.x>=14||d.origin.y<8||d.origin.y>=14)).toBe(true);
  });

  it("keeps the current decoration output deterministic across adjacent chunks without tiny scatter", () => {
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
        cellRuns: compactCellRuns(districtCells.filter((cell) => cell.x >= minX && cell.x <= maxX)),
      }];
      compact.decorationContext = {
        treeGeometryVersion: 7, lightingVersion: 1, surfaceHaloRuns: [], blockedCellRuns: [],
        cityBounds: [{ minX: 0, minY: 0, maxX: 127, maxY: 63 }],
        districts: [{
          id: "golden-district", status: "PLANNED", archetype: "MIXED_URBAN",
          cellRuns: compactCellRuns(districtCells.filter((cell) => cell.x >= minX - 1 && cell.x <= maxX + 1)),
        }],
        tasks: [],
      };
      return materializeChunkPayload(compact);
    };

    const decorations = [...build(0).decorations, ...build(1).decorations];
    const fingerprint = createHash("sha256").update(JSON.stringify(decorations)).digest("hex");

    expect(decorations.filter((item) => item.kind === "fence-vertical" && (item.origin.x === 63 || item.origin.x === 64))).toEqual([]);
    expect(decorations.some((item) => /flower|rock-|hill-rocky|hill-small|reed|shrub-patch/.test(item.kind))).toBe(false);
    // Reviewed forest policy, four boat variants and retired hill-rock sprites.
    expect(fingerprint).toBe("f221e6c201b1cd97e1c2d5e0ad8cb7de9130db4c16fb169da8aa22a065cec0b9");
  });
});
