import { describe, expect, it } from "vitest";
import { CityRoadPadding } from "../src/client/city-road-padding";
import type { ChunkPayloadDto, RoadCellDto } from "../src/shared/contracts";
import { intercityRoadRasterNetwork, type IntercityRoadRoute } from "../src/shared/intercity-roads";
import { rasterizeBlockRoads } from "../src/shared/road-raster";
import { buildRoadSurfaces } from "../src/shared/road-surfaces";
import { compactRoadRuns } from "../src/shared/world-cell-runs";
import { roadMarkingAxis } from "../src/shared/road-profile";

const key = (cell: { x: number; y: number }) => `${cell.x},${cell.y}`;
const route = (start = { x: -1_000_000, y: 16 }, length = 2_000_000): IntercityRoadRoute => ({
  id: "real-road", fromCityId: "a", toCityId: "b", fromNodeId: "a:n", toNodeId: "b:n", widthCells: 3,
  geometry: { start, runs: [{ direction: "E", length }] },
});
const payload = (roads: RoadCellDto[]): ChunkPayloadDto => ({
  payloadVersion: 2, contentHash: "resident", generatorVersion: "block-v1", terrainSeed: 73,
  publishedVersion: 1, lod: "DETAIL", chunkX: 0, chunkY: 0, size: 64,
  roadRuns: compactRoadRuns(roads), surfaceRuns: [], districts: [], tasks: [], worldFeatures: [],
  decorationContext: { treeGeometryVersion: 7, lightingVersion: 1, surfaceHaloRuns: [], blockedCellRuns: [], cityBounds: [], districts: [], tasks: [] },
});

describe("canonical city road padding", () => {
  it("clips a million-cell run before allocation, keeps negative-coordinate seam masks and marking direction", () => {
    const padding = new CityRoadPadding({ chunkSize: 64, chunks: [], intercityRoads: [route()] }, () => true);
    const chunk = padding.get(-1, 0)!;
    expect(chunk.roads).toHaveLength(64 * 3);
    expect(chunk.roads.every(cell => cell.x >= -64 && cell.x < 0 && cell.y >= 0 && cell.y < 64)).toBe(true);
    expect(chunk.roadContext.size).toBeLessThan(300);
    expect(chunk.roads.find(cell => cell.x === -64 && cell.y === 16)?.mask).toBe(15);
    expect(chunk.roads.find(cell => cell.x === -1 && cell.y === 16)?.mask).toBe(15);
    expect(roadMarkingAxis(chunk.roadContext, { x: -1, y: 16 })).toBe("H");
  });

  it("joins the resident perimeter and canonical exit before masks, without painting resident cells twice", () => {
    const street = route({ x: 63, y: 0 }, 63);
    street.geometry.runs = [{ direction: "S", length: 63 }];
    const exit = route({ x: 63, y: 16 }, 128);
    const resident = payload(rasterizeBlockRoads(intercityRoadRasterNetwork([street]), { minX: 0, minY: 0, maxX: 63, maxY: 63 }));
    const padding = new CityRoadPadding({ chunkSize: 64, chunks: [resident], intercityRoads: [exit] }, () => true);
    expect(padding.get(0, 0)).toBeUndefined();
    const chunk = padding.get(1, 0)!;
    expect(chunk.roadContext.has("63,12")).toBe(true);
    expect(chunk.roadContext.has("64,16")).toBe(true);
    expect(chunk.roads.find(cell => cell.x === 64 && cell.y === 16)?.mask).toBe(15);
    expect(chunk.roads.every(cell => cell.x >= 64 && cell.x <= 127)).toBe(true);
    expect(chunk.surfaces.every(cell => !chunk.roadContext.has(key(cell)) || cell.kind === "CROSSWALK")).toBe(true);
  });

  it("uses the same bounded road-surface compiler as a server chunk, and respects unbuildable side terrain", () => {
    const routes = [route()];
    const dry = (cell: { x: number; y: number }) => cell.y !== 18;
    const padding = new CityRoadPadding({ chunkSize: 64, chunks: [], intercityRoads: routes }, dry);
    const chunk = padding.get(1, 0)!;
    const roads = rasterizeBlockRoads(intercityRoadRasterNetwork(routes), { minX: 60, minY: -4, maxX: 131, maxY: 67 });
    const expected = [...buildRoadSurfaces({ roads: new Map(roads.map(cell => [key(cell), cell])),
      blocked: new Set(), isSurfaceTerrain: dry, isInsideCity: () => false }).values()]
      .filter(cell => cell.x >= 64 && cell.x <= 127 && cell.y >= 0 && cell.y <= 63);
    expect(chunk.surfaces).toEqual(expected);
    expect(chunk.surfaces.some(cell => cell.y === 18)).toBe(false);
  });

  it("preserves authoritative resident surface halo instead of inventing a second crossing", () => {
    const resident = payload([]);
    resident.decorationContext.surfaceHaloRuns = [{ start: { x: 64, y: 16 }, end: { x: 64, y: 16 }, kind: "CROSSWALK" }];
    const chunk = new CityRoadPadding({ chunkSize: 64, chunks: [resident], intercityRoads: [route()] }, () => true).get(1, 0)!;
    expect(chunk.surfaceContext.get("64,16")?.kind).toBe("CROSSWALK");
    expect(chunk.surfaces.find(cell => key(cell) === "64,16")?.kind).toBe("CROSSWALK");
  });

  it("reuses only visible padding chunks and releases distant cached raster on pruning", () => {
    const padding = new CityRoadPadding({ chunkSize: 64, chunks: [], intercityRoads: [route()] }, () => true);
    const one = padding.get(1, 0);
    expect(padding.get(1, 0)).toBe(one);
    padding.get(2, 0);
    expect(padding.cachedChunks).toBe(2);
    padding.retain([[2, 0]]);
    expect(padding.cachedChunks).toBe(1);
    expect(padding.get(1, 0)).not.toBe(one);
    padding.retain([]);
    expect(padding.cachedChunks).toBe(0);
  });

  it("does not fabricate extensions where no canonical road enters the padding", () => {
    const padding = new CityRoadPadding({ chunkSize: 64, chunks: [], intercityRoads: [route({ x: 0, y: 10 }, 20)] }, () => true);
    expect(padding.get(1, 0)).toBeUndefined();
  });
});

describe("recorded intercity bridges", () => {
  it("keeps bridge deck cells in the same padding network as their approach road", () => {
    const r = {...route(), geometry:{start:{x:0,y:16},runs:[{direction:"E" as const,length:160}]},
      bridges:[{start:{x:72,y:16},runs:[{direction:"E" as const,length:24}]}]};
    const chunk = new CityRoadPadding({chunkSize:64,chunks:[],intercityRoads:[r]},()=>true).get(1,0)!;
    expect(chunk.roads.find(p=>p.x===80 && p.y===16)?.structure).toBe("BRIDGE");
    expect(chunk.roads.find(p=>p.x===112 && p.y===16)?.structure).toBe("ROAD");
  });
});

it("preserves the bridge deck and higher road class regardless of raster input order", () => {
  const geometry={start:{x:0,y:0},runs:[{direction:"E" as const,length:24}]};
  const bridge={id:"bridge",fromNodeId:"a",toNodeId:"b",roadClass:"LOCAL" as const,widthCells:3,geometry,structure:"BRIDGE" as const};
  const approach={...bridge,id:"approach",roadClass:"COLLECTOR" as const,structure:"ROAD" as const};
  for(const segments of [[bridge,approach],[approach,bridge]]) {
    const cell=rasterizeBlockRoads({schemaVersion:1,nodes:[],segments}).find(p=>p.x===8 && p.y===0)!;
    expect(cell).toMatchObject({structure:"BRIDGE",roadClass:"COLLECTOR"});
  }
});
