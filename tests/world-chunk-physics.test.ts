import { describe, expect, it } from "vitest";
import type { ChunkPayloadDto, ChunkTaskDto } from "../src/shared/contracts";
import { compactCellRuns, compactSurfaceRuns } from "../src/shared/world-cell-runs";
import { materializeChunkPayload } from "../src/shared/world-chunk-payload";
import { materializeChunkPhysics } from "../src/shared/world-chunk-physics";
import { buildCityWalkNetwork } from "../src/client/city-walk-network";
import { terrainAt } from "../src/shared/world-terrain";

function fixture(seed = 42, stage: 1 | 3 | 5 = 5): ChunkPayloadDto {
  const footprint = Array.from({length: 36}, (_, i) => ({x: -40 + i % 6, y: 12 + Math.floor(i / 6)}));
  const task = {id: "home",taskNumber: 1,stage,status: stage === 5 ? "COMPLETED" : "IN_PROGRESS",
    visualKind: "BUILDING",visualAssetKey: "compact-apartment-v1",footprint,
    accessPath: [{x: -37,y: 18},{x: -37,y: 19}]} as ChunkTaskDto;
  const surfaces = Array.from({length: 64}, (_, i) => ({x: -64 + i,y: 19,kind: "SIDEWALK" as const,variant: 0}));
  surfaces.push(...Array.from({length: 6}, (_, i) => ({x: -40 + i,y: 18,kind: "SIDEWALK" as const,variant: 0})));
  return {payloadVersion: 2,contentHash: `physical-${seed}-${stage}`,generatorVersion: "block-v1",
    terrainSeed: seed,publishedVersion: 1,lod: "DETAIL",chunkX: -1,chunkY: 0,size: 64,
    roadRuns: [],surfaceRuns: compactSurfaceRuns(surfaces),districts: [],tasks: [task],worldFeatures: [],
    decorationContext: {treeGeometryVersion: 7,lightingVersion: 1,surfaceHaloRuns: [],blockedCellRuns: compactCellRuns(footprint),
      cityBounds: [{minX: -64,minY: 0,maxX: -1,maxY: 63}],districts: [],tasks: [task]}};
}

describe("compact canonical physical pages", () => {
  it("keeps authoritative geometry without retaining an offscreen dense terrain raster", () => {
    const payload = {...fixture(),size: 256,surfaceRuns: [],tasks: [],decorationContext: {...fixture().decorationContext,tasks: [],blockedCellRuns: []}};
    const physical = materializeChunkPhysics(payload);
    expect(physical.terrain).toEqual([]);
    expect(physical.decorations).toEqual([]);
    expect(physical.worldVersion).toBe(payload.publishedVersion);
  });

  it.each([1,3,5] as const)("preserves every paving furniture blocker and walking entrance at stage %s", stage => {
    for (let seed = 40; seed < 46; seed++) {
      const payload = fixture(seed,stage), dense = materializeChunkPayload(payload), physical = materializeChunkPhysics(payload);
      const furniture = (chunk: typeof dense) => chunk.decorations.filter(item => item.id.startsWith("frontage:"));
      expect(furniture(physical)).toEqual(furniture(dense));
      const walk = (chunk: typeof dense) => buildCityWalkNetwork({roads: new Map(chunk.roads.map(cell => [`${cell.x},${cell.y}`,cell])),
        surfaces: chunk.surfaces,tasks: chunk.tasks,features: chunk.worldFeatures,decorations: chunk.decorations,terrain: chunk.terrain,
        sampleTerrain:cell=>terrainAt(payload.terrainSeed,cell.x,cell.y,payload.terrainProfile).terrain});
      const before = walk(dense), after = walk(physical);
      expect([...after.walkGraph]).toEqual([...before.walkGraph]);
      expect([...after.buildingEntrances]).toEqual([...before.buildingEntrances]);
      expect([...after.activityCells]).toEqual([...before.activityCells]);
    }
  });

  it("keeps complete frontage decisions when a house and its courtyard cross the negative page seam",()=>{
    for(let seed=0;seed<24;seed++){
      const payload=fixture(seed,5),task=payload.tasks[0]!;
      task.footprint=task.footprint.map(cell=>({...cell,x:cell.x+37}));
      task.accessPath=task.accessPath.map(cell=>({...cell,x:cell.x+37}));
      const paving=[...Array.from({length:64},(_,i)=>({x:-64+i,y:19,kind:"SIDEWALK" as const,variant:0})),
        ...Array.from({length:3},(_,i)=>({x:-3+i,y:18,kind:"SIDEWALK" as const,variant:0}))];
      payload.surfaceRuns=compactSurfaceRuns(paving);
      payload.decorationContext.surfaceHaloRuns=compactSurfaceRuns([...Array.from({length:4},(_,i)=>({x:i,y:19,kind:"SIDEWALK" as const,variant:0})),
        ...Array.from({length:3},(_,i)=>({x:i,y:18,kind:"SIDEWALK" as const,variant:0}))]);
      payload.decorationContext.blockedCellRuns=compactCellRuns(task.footprint);
      const before=materializeChunkPayload(payload),after=materializeChunkPhysics(payload);
      const furniture=(chunk:typeof before)=>chunk.decorations.filter(prop=>prop.id.startsWith("frontage:"));
      expect(furniture(after),`seam furniture seed${seed}`).toEqual(furniture(before));
    }
  });
});
