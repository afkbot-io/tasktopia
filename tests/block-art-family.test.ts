import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILDING_CATALOG, type BuildingCatalogEntry } from "../src/shared/catalog";
import { blockSlots } from "../src/shared/block-templates";
import type { CityBlockV1, CompiledBlockLayoutV1 } from "../src/shared/block-world";
import { compileBlockLayout, type BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";
import { compactServiceFamily } from "../src/shared/compact-building-families";

const FIRE="compact-fire-station-v1";
const baseBlock: CityBlockV1={id:"block",districtLayoutId:"district-layout",sequence:0,kind:"RESIDENTIAL",templateKey:"residential-court",
  templateVersion:2,variant:"south",seed:1,origin:{x:-32,y:48},width:32,height:32,parameters:{},summary:{}};
const geometry=(block:CityBlockV1)=>blockSlots(block).map(({buildingFamily,serviceRole,...slot})=>{void buildingFamily;void serviceRole;return slot;});
const input=(count:number,previous?:CompiledBlockLayoutV1):BlockLayoutCompilerInput=>({countryId:"country",cityId:"city",seed:previous?.seed??17,revision:count+1,previous,
  districts:[{id:"sprint",archetype:"MIXED_URBAN",sequence:0,tasks:Array.from({length:count},(_,index)=>({id:`task-${index+1}`,taskNumber:index+1,
    buildingFamily:"compact-apartment-v1",facadeVariant:"south",constructionStage:1,visualKind:"BUILDING"}))}]});
const grow=(count:number,seed=17)=>{let layout=compileBlockLayout({...input(0),seed});for(let n=1;n<=count;n++)layout=compileBlockLayout(input(n,layout));return layout;};

describe("immutable v2 parcels and independently authored building families",()=>{
  let original:BuildingCatalogEntry[];
  beforeEach(()=>{original=[...BUILDING_CATALOG];});
  afterEach(()=>{BUILDING_CATALOG.splice(0,BUILDING_CATALOG.length,...original);});
  const registerFire=()=>{
    if(!BUILDING_CATALOG.some(entry=>entry.key===FIRE)) BUILDING_CATALOG.push({...BUILDING_CATALOG.find(entry=>entry.key==="compact-wide-v1")!,key:FIRE,serviceRole:"FIRE"});
  };

  it("applies a persisted exact-footprint alias without moving any slot, entrance or access path",()=>{
    registerFire();
    const before=geometry(baseBlock),slot=blockSlots(baseBlock).find(s=>s.kind==="BUILDING"&&s.footprintBounds.maxY-s.footprintBounds.minY+1===4)!;
    const aliased={...baseBlock,parameters:{slotFamilies:{[slot.key]:FIRE}}};
    expect(blockSlots(aliased).find(s=>s.key===slot.key)!.buildingFamily).toBe(FIRE);
    expect(geometry(aliased)).toEqual(before);
    BUILDING_CATALOG.reverse();
    BUILDING_CATALOG.push({...BUILDING_CATALOG[0]!,key:"new-unrelated-family"});
    expect(geometry(aliased)).toEqual(before);
  });

  it("rejects aliases with a different footprint, off-centre entrance, unknown family or absent slot",()=>{
    registerFire();
    const slots=blockSlots(baseBlock),square=slots.find(s=>s.footprint.length===36)!,wide=slots.find(s=>s.footprint.length===24)!;
    expect(()=>blockSlots({...baseBlock,parameters:{slotFamilies:{[square.key]:FIRE}}})).toThrow(/family|footprint/i);
    BUILDING_CATALOG.push({...BUILDING_CATALOG.find(e=>e.key===FIRE)!,key:"wrong-door",entrances:[{side:"S",offset:1}]});
    for(const [key,family] of [[wide.key,"wrong-door"],[wide.key,"missing"],["slot-999",FIRE]]) {
      expect(()=>blockSlots({...baseBlock,parameters:{slotFamilies:{[key!]:family}}})).toThrow(/family|slot/i);
    }
  });

  it("maps an explicitly requested authored family to the existing structural shape",()=>{
    registerFire(); const request=input(1); request.districts[0]!.tasks[0]!.requestedFamily=FIRE;
    const result=compileBlockLayout(request),block=result.blocks[0]!,slot=blockSlots(block)[0]!;
    expect(result.placements[0]!.buildingFamily).toBe(FIRE);
    expect(result.placements[0]!.serviceRole).toBeUndefined();
    expect(block.parameters.firstFamily).toBe("compact-wide-v1");
    expect(block.parameters.slotFamilies).toEqual({[slot.key]:FIRE});
    expect(geometry(block)).toEqual(geometry({...block,parameters:{...block.parameters,slotFamilies:undefined,firstFamily:"compact-wide-v1"}}));
  });

  it("rejects explicit service art for a different reserved role even when both footprints match",()=>{
    const before=grow(8,1),snapshot=structuredClone(before),request=input(9,before);
    const reserved=before.blocks.flatMap(block=>blockSlots(block)).find(slot=>slot.serviceRole==="EDUCATION")!;
    const base = BUILDING_CATALOG.find(entry => entry.key === reserved.buildingFamily)!;
    BUILDING_CATALOG.push({...base,key:"matching-fire-art",serviceRole:"FIRE"},
      {...base,key:"matching-education-art",serviceRole:"EDUCATION"});
    expect(base.footprint.width * base.footprint.height).toBe(reserved.footprint.length);
    request.districts[0]!.tasks[8]!.requestedFamily="matching-fire-art";
    expect(()=>compileBlockLayout(request)).toThrow(/role|роль/i);
    expect(before).toEqual(snapshot);
    request.districts[0]!.tasks[8]!.requestedFamily="matching-education-art";
    expect(compileBlockLayout(request).placements.find(p=>p.taskId==="task-9")!.serviceRole).toBe("EDUCATION");
  });

  it("uses new FIRE art on a compatible free parcel without changing the next-task threshold or old placements",()=>{
    registerFire();
    // This test exercises an accepted stored parcel plan, not a seed-specific
    // assumption that the latest catalogue happens to leave a 6×4 slot free.
    const planned = compileBlockLayout(input(0));
    planned.blocks = [0,1].map(sequence => ({ ...baseBlock, id: `wide-plan-${sequence}`,
      districtLayoutId: planned.districtLayouts[0]!.id, sequence, templateVersion: 3,
      origin: { x: sequence * 32, y: 0 }, parameters: { sitePlan: { version: 1,
        parcels: Array.from({length:9},(_,i)=>({x:3+Math.floor(i/3)*9,y:3+i%3*7,
          width:6,height:4,clearance:1,kind:"BUILDING",family:"compact-wide-v1"})) } } }));
    const before=compileBlockLayout(input(15,planned)),result=compileBlockLayout(input(16,before));
    const fire=result.placements.find(p=>p.serviceRole==="FIRE")!;
    expect(fire.taskId).toBe("task-16");expect(fire.buildingFamily).toBe(FIRE);
    const block=result.blocks.find(b=>b.id===fire.blockId)!;
    expect(blockSlots(block).find(s=>s.key===fire.slotKey)!.footprint).toHaveLength(24);
    for(const old of before.placements) expect(result.placements.find(p=>p.taskId===old.taskId)).toEqual(old);
    for(const old of before.blocks) expect(geometry(result.blocks.find(b=>b.id===old.id)!)).toEqual(geometry(old));
  });

  it("does not repaint an already assigned FIRE family when a matching asset is registered later",()=>{
    BUILDING_CATALOG.splice(0,BUILDING_CATALOG.length,...BUILDING_CATALOG.filter(e=>e.serviceRole!=="FIRE"));
    const before=grow(16),oldFire=before.placements.find(p=>p.serviceRole==="FIRE")!;
    registerFire(); const result=compileBlockLayout(input(17,before));
    expect(result.placements.find(p=>p.taskId===oldFire.taskId)).toEqual(oldFire);
    expect(oldFire.buildingFamily).not.toBe(FIRE);
  });

  it("keeps FIRE on the next task with the generic fitting family when every wide parcel is permanently occupied",()=>{
    registerFire();
    // Recorded V3 parcels define the scenario, not today's seeded shape pool:
    // sixteen usable squares plus two permanently occupied wide parcels.
    const planned=compileBlockLayout(input(0));
    planned.blocks=[0,1].map(sequence=>({...baseBlock,id:`fallback-plan-${sequence}`,
      districtLayoutId:planned.districtLayouts[0]!.id,sequence,templateVersion:3,
      origin:{x:sequence*32,y:0},parameters:{sitePlan:{version:1,
        parcels:Array.from({length:9},(_,i)=>({x:3+Math.floor(i/3)*9,y:3+i%3*9,
          width:6,height:i===8?4:6,clearance:1,kind:"BUILDING",family:i===8?"compact-wide-v1":"compact-apartment-v1"}))}}}));
    for(const block of planned.blocks) for(const slot of blockSlots(block)) {
      if(slot.kind==="BUILDING"&&slot.footprint.length===24) planned.siteMarkers.push({
        id:`old-${block.id}-${slot.key}`,blockId:block.id,slotKey:slot.key,kind:"RUINED",snapshot:{title:"Old site"},assetVariant:"brick",
      });
    }
    expect(planned.siteMarkers).toHaveLength(2);
    const before=compileBlockLayout(input(14,JSON.parse(JSON.stringify(planned)) as CompiledBlockLayoutV1));
    const occupied=new Set([...before.placements,...before.siteMarkers].map(p=>`${p.blockId}:${p.slotKey}`));
    const available=before.blocks.flatMap(block=>blockSlots(block).filter(slot=>slot.kind==="BUILDING"
      &&!occupied.has(`${block.id}:${slot.key}`)));
    expect(available).toHaveLength(2);
    expect(available.every(slot=>slot.footprint.length===36)).toBe(true);
    expect(available.every(slot=>compactServiceFamily("FIRE",slot.footprintBounds.maxX-slot.footprintBounds.minX+1,
      slot.footprintBounds.maxY-slot.footprintBounds.minY+1)===undefined)).toBe(true);
    const fifteen=compileBlockLayout(input(15,before)),result=compileBlockLayout(input(16,fifteen));
    expect(fifteen.blocks).toHaveLength(before.blocks.length);
    const fire=result.placements.find(p=>p.serviceRole==="FIRE")!;
    expect(fire.taskId).toBe("task-16");expect(fire.buildingFamily).not.toBe(FIRE);
    expect(result.blocks).toHaveLength(fifteen.blocks.length);
    expect(result.siteMarkers).toEqual(before.siteMarkers);
    for(const old of fifteen.placements) expect(result.placements.find(p=>p.taskId===old.taskId)).toEqual(old);
    for(const old of before.blocks) expect(geometry(result.blocks.find(b=>b.id===old.id)!)).toEqual(geometry(old));
  });
});
