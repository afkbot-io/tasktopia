import { describe, expect, it } from "vitest";
import type { Cell, ChunkPayloadV2Dto, SurfaceCellDto, TerrainCellDto } from "../src/shared/contracts";
import { generateWorldDecorations } from "../src/shared/world-decorations";
import { taskParkDecorLayout } from "../src/shared/task-park";
import { compactTreeCover } from "../src/shared/compact-tree-placement";
import { greenAreaPathCells } from "../src/shared/green-area";
import { compactRoadRuns, compactSurfaceRuns, expandCellRuns } from "../src/shared/world-cell-runs";
import { encodeTerrainSample, materializeChunkPayload } from "../src/shared/world-chunk-payload";
import { buildDecorationHardHalo } from "../src/server/world/decoration-halo";
import { chunkPayloadContentHash } from "../src/server/world/chunk-payload-hash";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
const rectangle = (x: number, y: number, width: number, height: number): Cell[] =>
  Array.from({ length: width * height }, (_, i) => ({ x: x + i % width, y: y + Math.floor(i / width) }));
const furniture = (kind: string) => kind.startsWith("courtyard-");
const sizes: Record<string, [number, number]> = {
  "courtyard-picnic-table": [2, 2], "courtyard-cycle-rack": [2, 1], "courtyard-square-planter": [1, 1],
};

describe("completed courtyard furniture", () => {
  it("protects the neighbour chunk interior of an origin-owned planned site without duplicating its marker", () => {
    const site = { id: "origin-owned", origin: { x: 60, y: 8 }, width: 12, height: 12, kind: "BUILDING" as const };
    const reserved = new Set(rectangle(60, 8, 12, 12).map(key));
    const payload: ChunkPayloadV2Dto = {
      payloadVersion: 2, contentHash: "reserved-interior-seam", generatorVersion: "block-v1", terrainSeed: 23,
      publishedVersion: 1, lod: "DETAIL", chunkX: 1, chunkY: 0, size: 64,
      roadRuns: [], surfaceRuns: [], districts: [], tasks: [], worldFeatures: [], plannedSites: [],
      // The only marker DTO belongs to chunk0,0 because its origin is60,8.
      decorationContext: { treeGeometryVersion: 7, lightingVersion: 1, surfaceHaloRuns: [],
        blockedCellRuns: [], cityBounds: [], districts: [], tasks: [] },
    };
    const terrain = new Uint8Array(4096).fill(encodeTerrainSample({ terrain: "FOREST", variant: 0 }));
    const baseline = materializeChunkPayload(payload, terrain);
    expect(baseline.decorations).toContainEqual(expect.objectContaining({ kind: "tree-conifer", origin: { x: 65, y: 8 } }));
    const hard = buildDecorationHardHalo({
      chunkBounds: { minX: 64, minY: 0, maxX: 127, maxY: 63 },
      surfaceScope: { minX: 60, minY: -4, maxX: 131, maxY: 67 },
      roads: [], tasks: [], features: [], reservedSites: [site],
    });
    payload.decorationContext.blockedCellRuns = hard;
    const actual = materializeChunkPayload(JSON.parse(JSON.stringify(payload)) as ChunkPayloadV2Dto, terrain);
    const crossingTrees = actual.decorations.filter(prop => prop.kind.startsWith("tree-")
      && compactTreeCover(prop.origin).some(cell => reserved.has(key(cell))));
    expect(crossingTrees).toEqual([]);
    expect(new Set(expandCellRuns(hard).map(key))).toEqual(reserved);
    expect(actual.plannedSites).toEqual([]);
    expect(actual.tasks).toEqual([]); expect(actual.worldFeatures).toEqual([]);
    expect(actual.terrain).toEqual(baseline.terrain);
    expect(actual.surfaces).toEqual(baseline.surfaces);
    expect(actual.decorations.some(prop => prop.kind.startsWith("tree-"))).toBe(true);
  });
  it.each(["MOVE", "RUIN", "FEATURE_ACCESS", "PLANNED", "ROAD", "TASK_ACCESS"] as const)(
    "protects an external %s halo over old paving through the producer and serialized materializer", kind => {
    const footprint = rectangle(60, 8, 6, 6);
    const frontage: SurfaceCellDto[] = rectangle(60, 14, 6, 1).map(c => ({ ...c, kind: "PATH", finish: "PAVERS" }));
    const payload: ChunkPayloadV2Dto = {
      payloadVersion: 2, contentHash: "halo-hard-mask", generatorVersion: "block-v1", terrainSeed: 0,
      publishedVersion: 1, lod: "DETAIL", chunkX: 0, chunkY: 0, size: 64, roadRuns: [],
      surfaceRuns: compactSurfaceRuns(frontage.filter(c => c.x < 64)), districts: [], tasks: [], worldFeatures: [],
      decorationContext: { treeGeometryVersion: 7, lightingVersion: 1,
        surfaceHaloRuns: compactSurfaceRuns(frontage.filter(c => c.x >= 64)), blockedCellRuns: [], cityBounds: [], districts: [], tasks: [{
          id: "edge-house", taskNumber: 1, visualKind: "BUILDING", stage: 5, footprint,
          // The only canonical two-cell anchor left open is x63. Its second
          // cell lies outside this chunk, where a marker may cover old paving.
          accessPath: [{ x: 60, y: 14 }, { x: 61, y: 14 }, { x: 62, y: 14 }, { x: 65, y: 14 }],
        }] },
    };
    payload.decorationContext.blockedCellRuns = buildDecorationHardHalo({
      chunkBounds: { minX: 0, minY: 0, maxX: 63, maxY: 63 },
      surfaceScope: { minX: -4, minY: -4, maxX: 67, maxY: 67 },
      roads: [], tasks: payload.decorationContext.tasks, features: [], reservedSites: [],
    });
    const terrain = new Uint8Array(4096).fill(encodeTerrainSample({ terrain: "GRASS", variant: 0 }));
    const rack = materializeChunkPayload(payload, terrain).decorations.find(p => p.kind === "courtyard-cycle-rack");
    expect(rack?.origin).toEqual({ x: 63, y: 14 });
    const obstacle = { x: 64, y: 14 };
    const haloInput = {
      chunkBounds: { minX: 0, minY: 0, maxX: 63, maxY: 63 },
      surfaceScope: { minX: -4, minY: -4, maxX: 67, maxY: 67 },
      roads: kind === "ROAD" ? [{ ...obstacle, structure: "ROAD" as const, roadClass: "LOCAL" as const, mask: 10 }] : [],
      tasks: [{ ...payload.decorationContext.tasks[0]!,
        accessPath: [...payload.decorationContext.tasks[0]!.accessPath, ...(kind === "TASK_ACCESS" ? [obstacle] : [])] }],
      features: kind === "MOVE" || kind === "RUIN"
        ? [{ footprint: [obstacle], accessPath: [] }]
        : kind === "FEATURE_ACCESS" ? [{ footprint: [{ x: 66, y: 15 }], accessPath: [obstacle] }] : [],
      reservedSites: kind === "PLANNED" ? [{ origin: obstacle, width: 6, height: 6 }] : [],
    };
    const { contentHash, ...hashInput } = payload;
    void contentHash;
    const beforeHash = chunkPayloadContentHash(hashInput);
    payload.decorationContext.blockedCellRuns = buildDecorationHardHalo(haloInput);
    const hardCells = expandCellRuns(payload.decorationContext.blockedCellRuns);
    expect(hardCells).toContainEqual(obstacle);
    expect(hardCells.every(c => (c.x < 0 || c.x > 63 || c.y < 0 || c.y > 63)
      && c.x >= -4 && c.x <= 67 && c.y >= -4 && c.y <= 67)).toBe(true);
    expect(chunkPayloadContentHash({ ...hashInput, decorationContext: payload.decorationContext })).not.toBe(beforeHash);
    const decoded = JSON.parse(JSON.stringify(payload)) as ChunkPayloadV2Dto;
    const chunk = materializeChunkPayload(decoded, terrain);
    const guarded = chunk.decorations.filter(p => furniture(p.kind));
    for (const prop of guarded) expect(rectangle(prop.origin.x, prop.origin.y, ...sizes[prop.kind]!).map(key)).not.toContain("64,14");
    expect(chunk.surfaces).toEqual(frontage.filter(c => c.x < 64));
    expect(chunk.terrain).toHaveLength(4096);
    expect(chunk.worldFeatures).toEqual([]); // Halo geometry is not a remote entity.
  });
  it("leaves safe seam paving available and clips huge reservations before expansion", () => {
    const hard = buildDecorationHardHalo({
      chunkBounds: { minX: 0, minY: 0, maxX: 63, maxY: 63 },
      surfaceScope: { minX: -4, minY: -4, maxX: 67, maxY: 67 },
      roads: [{ x: 62, y: 14 }, { x: 68, y: 14 }], tasks: [], features: [],
      reservedSites: [{ origin: { x: 67, y: 67 }, width: 1_000_000, height: 1_000_000 }],
    });
    expect(expandCellRuns(hard)).toEqual([{ x: 67, y: 67 }]);
    // In particular the safe old paving at x64,14 is not hard occupancy.
    expect(expandCellRuns(hard).map(key)).not.toContain("64,14");
  });
  it.each([
    { chunkX: 1, chunkY: 0, x: 60, y: 8 },
    { chunkX: 0, chunkY: 0, x: -4, y: 8 },
    { chunkX: 0, chunkY: 1, x: 8, y: 60 },
    { chunkX: 0, chunkY: 0, x: 8, y: -4 },
    { chunkX: 1, chunkY: 1, x: 60, y: 60 },
  ])("retains the complete clipped reserved mask across axis/corner seams: $x,$y", ({ chunkX, chunkY, x, y }) => {
    const minX = chunkX * 64, minY = chunkY * 64;
    const hard = buildDecorationHardHalo({
      chunkBounds: { minX, minY, maxX: minX + 63, maxY: minY + 63 },
      surfaceScope: { minX: minX - 4, minY: minY - 4, maxX: minX + 67, maxY: minY + 67 },
      roads: [], tasks: [], features: [],
      reservedSites: [{ origin: { x, y }, width: 12, height: 12 }],
    });
    expect(new Set(expandCellRuns(hard).map(key))).toEqual(new Set(rectangle(x, y, 12, 12).map(key)));
    expect(expandCellRuns(hard)).toHaveLength(144);
  });
  it("bounds an enormous crossing reservation to one chunk and four-cell halo", () => {
    const hard = buildDecorationHardHalo({
      chunkBounds: { minX: 0, minY: 0, maxX: 63, maxY: 63 },
      surfaceScope: { minX: -4, minY: -4, maxX: 67, maxY: 67 },
      roads: [], tasks: [], features: [],
      reservedSites: [{ origin: { x: -1_000_000, y: -1_000_000 }, width: 2_000_000, height: 2_000_000 }],
    });
    expect(expandCellRuns(hard)).toEqual(rectangle(-4, -4, 72, 72));
  });
  it("does not duplicate or relocate a long building's furniture when its frontage crosses a chunk seam", () => {
    const footprint = rectangle(60, 8, 12, 6);
    const own = new Set(footprint.map(key));
    const terrain: TerrainCellDto[] = rectangle(48, 0, 32, 24).map(c => ({ ...c, terrain: "GRASS", variant: 0 }));
    const surfaces: SurfaceCellDto[] = rectangle(59, 7, 14, 8).filter(c => !own.has(key(c)))
      .map(c => ({ ...c, kind: "PATH", finish: "PAVERS" }));
    const task = { id: "long", taskNumber: 8, visualKind: "BUILDING" as const, stage: 5 as const,
      footprint, accessPath: [{ x: 66, y: 14 }] };
    const run = (seed: number, min: number, max: number) => {
      const context = terrain.filter(c => c.x >= min - 4 && c.x < max + 4);
      return generateWorldDecorations(seed, terrain.filter(c => c.x >= min && c.x < max), new Set(own),
        surfaces.filter(c => c.x >= min - 4 && c.x < max + 4), [], [], [task], context, () => "GRASS")
        .filter(p => furniture(p.kind));
    };
    for (let seed = 0; seed < 24; seed++) {
      expect([...run(seed, 48, 64), ...run(seed, 64, 80)]).toEqual(run(seed, 48, 80));
    }
  });
  it("does not furnish a historical occupied site even when old paving remains under its marker", () => {
    const footprint = rectangle(20, 20, 6, 3);
    const frontage: SurfaceCellDto[] = rectangle(20, 23, 6, 1).map(c => ({ ...c, kind: "PATH", finish: "PAVERS" }));
    const payload: ChunkPayloadV2Dto = {
      payloadVersion: 2, contentHash: "furniture-hard-mask", generatorVersion: "block-v1", terrainSeed: 23,
      publishedVersion: 1, lod: "DETAIL", chunkX: 0, chunkY: 0, size: 64, roadRuns: [],
      surfaceRuns: compactSurfaceRuns(frontage), districts: [], tasks: [], worldFeatures: [],
      decorationContext: { treeGeometryVersion: 7, lightingVersion: 1, surfaceHaloRuns: [], blockedCellRuns: [], cityBounds: [], districts: [], tasks: [{
        id: "active", taskNumber: 1, visualKind: "BUILDING", stage: 5, footprint, accessPath: [],
      }] },
    };
    const terrain = new Uint8Array(4096).fill(encodeTerrainSample({ terrain: "GRASS", variant: 0 }));
    expect(materializeChunkPayload(payload, terrain).decorations.some(p => furniture(p.kind))).toBe(true);
    payload.worldFeatures = [{ id: "history", cityId: null, districtId: null, parentFeatureId: null,
      kind: "RUIN", assetKind: "AREA", assetKey: "ruin-building", orientation: "S", accessPath: [],
      origin: { x: 20, y: 23 }, footprint: frontage.map(({ x, y }) => ({ x, y })), developmentStage: 1,
      siteMarker: { kind: "RELOCATED", permanent: true, targetTaskId: "moved", variant: "brick",
        snapshot: { taskNumber: 7, title: "Previous site", buildingFamily: "compact-row-v1", lastStage: 5, recordedAt: "2026-09-07" } } }];
    expect(materializeChunkPayload(payload, terrain).decorations.some(p => furniture(p.kind))).toBe(false);
    payload.worldFeatures = [];
    payload.roadRuns = compactRoadRuns(frontage.map(({ x, y }) => ({ x, y, mask: 10, structure: "ROAD", roadClass: "LOCAL" })));
    expect(materializeChunkPayload(payload, terrain).decorations.some(p => furniture(p.kind))).toBe(false);
    payload.roadRuns = [];
    payload.plannedSites = [{ id: "planned", origin: { x: 20, y: 23 }, width: 6, height: 1, kind: "BUILDING" }];
    expect(materializeChunkPayload(payload, terrain).decorations.some(p => furniture(p.kind))).toBe(false);
  });
  it("reserves a bounded finished park composition before planting without moving earlier trees", () => {
    const cells = rectangle(-13, 8, 17, 17);
    const final = taskParkDecorLayout(cells, 5, "urban-pocket", 23);
    const additions = final.filter(p => furniture(p.kind));
    expect(additions.map(p => p.kind).sort()).toEqual(Object.keys(sizes).sort());
    expect(final.length).toBeLessThanOrEqual(36);
    const paths = new Set(greenAreaPathCells(cells, "urban-pocket").map(key));
    const occupied = new Set<string>();
    for (const prop of final) {
      const cover = prop.kind.startsWith("tree-") ? compactTreeCover(prop.origin)
        : rectangle(prop.origin.x, prop.origin.y, prop.width, prop.height);
      for (const cell of cover) {
        expect(paths.has(key(cell))).toBe(false);
        expect(occupied.has(key(cell))).toBe(false);
        occupied.add(key(cell));
      }
    }
    for (const stage of [1, 2, 3, 4] as const) {
      const early = taskParkDecorLayout(cells, stage, "urban-pocket", 23);
      expect(early.some(p => furniture(p.kind))).toBe(false);
      for (const tree of early.filter(p => p.kind.startsWith("tree-"))) expect(final).toContainEqual(tree);
    }
  });

  it("reserves frontage furniture before crowns and reveals it only when its own building completes", () => {
    const footprint = rectangle(10, 10, 6, 6);
    const own = new Set(footprint.map(key));
    const terrain: TerrainCellDto[] = rectangle(4, 4, 20, 20).map(c => ({ ...c, terrain: "FOREST", variant: 0 }));
    const surfaces: SurfaceCellDto[] = rectangle(8, 8, 10, 10).filter(c => !own.has(key(c)))
      .map(c => ({ ...c, kind: "PATH", finish: "PAVERS" }));
    const accessPath = [{ x: 13, y: 16 }, { x: 13, y: 17 }];
    const blocked = new Set([...footprint, ...surfaces].map(key));
    const run = (stage: 1 | 2 | 3 | 4 | 5) => generateWorldDecorations(23, terrain, blocked, surfaces, [], [], [{
      id: "building-a", taskNumber: 1, visualKind: "BUILDING", stage, footprint, accessPath,
    }]);
    const final = run(5);
    const additions = final.filter(p => furniture(p.kind));
    expect(additions).toHaveLength(1);
    expect(additions[0]!.kind).toBe("courtyard-cycle-rack");
    expect(final.filter(p => p.id.startsWith("frontage:"))).toHaveLength(2);
    const forbidden = new Set([...footprint, ...accessPath].map(key));
    const furnitureCells = new Set(additions.flatMap(p => rectangle(p.origin.x, p.origin.y, ...sizes[p.kind]!)).map(key));
    expect([...furnitureCells].some(c => forbidden.has(c))).toBe(false);
    for (const tree of final.filter(p => p.kind.startsWith("tree-"))) {
      expect(compactTreeCover(tree.origin).some(c => furnitureCells.has(key(c)))).toBe(false);
    }
    for (const stage of [1, 2, 3, 4] as const) {
      const early = run(stage);
      expect(early.some(p => furniture(p.kind))).toBe(false);
      if (stage >= 3) expect(early.filter(p => p.kind.startsWith("tree-")))
        .toEqual(final.filter(p => p.kind.startsWith("tree-")));
    }
    expect(run(5)).toEqual(final);
    expect(generateWorldDecorations(23, terrain, blocked, surfaces, [], [], []).some(p => furniture(p.kind))).toBe(false);
  });
});
