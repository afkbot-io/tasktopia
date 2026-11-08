import {expect,it} from 'vitest';
import {compileBlockLayout, type BlockLayoutCompilerInput} from '../src/server/world/block-layout-compiler';
import {BUILDING_CATALOG} from '../src/shared/catalog';
import {blockSlots} from '../src/shared/block-templates';
import {LocalCityServices,LOCAL_SERVICE_THRESHOLDS,localServiceZone} from '../src/server/world/local-city-services';
import {cityDevelopment} from '../src/server/city-development-read';

const input=(count:number):BlockLayoutCompilerInput=>({countryId:'country',cityId:'city',seed:17,revision:1,localServices:'DISTRIBUTED_V1',
  districts:[{id:'one-district',sequence:0,archetype:'MIXED_URBAN',tasks:Array.from({length:count},(_,i)=>({
    id:`task-${i+1}`,taskNumber:i+1,buildingFamily:'compact-apartment-v1',facadeVariant:'south',constructionStage:5,visualKind:'BUILDING',
  }))}]});
const zone=(block:{origin:{x:number;y:number};width:number;height:number})=>
  `${Math.floor((block.origin.x+block.width/2)/128)}:${Math.floor((block.origin.y+block.height/2)/128)}`;

it('gives one large district real local services in several stable city zones',()=>{
  const result=compileBlockLayout(input(600)),blocks=new Map(result.blocks.map(b=>[b.id,b]));
  expect(result.placements).toHaveLength(600);expect(result.districtLayouts).toHaveLength(1);
  for(const role of ['EDUCATION','MEDICAL','FIRE','POLICE'] as const){
    const services=result.placements.filter(p=>p.serviceRole===role);
    expect(new Set(services.map(p=>zone(blocks.get(p.blockId)!))).size,role).toBeGreaterThanOrEqual(2);
    for(const p of services.filter(p=>(blocks.get(p.blockId)!.parameters.slotRoleTriggers as Record<string,string>|undefined)?.[p.slotKey]
      ?.startsWith('city:local-service:')))
      expect(BUILDING_CATALOG.find(b=>b.key===p.buildingFamily)?.serviceRole).toBe(role);
  }
});

it('anchors zones to world cells, checks exact local thresholds and consumes historical generations',()=>{
  const block={origin:{x:-144,y:-16},width:32,height:32},other={...block,origin:{x:-16,y:-16}};
  expect(localServiceZone(block)).toBe('-1:0');expect(localServiceZone(other)).toBe('0:0');
  for(const role of Object.keys(LOCAL_SERVICE_THRESHOLDS) as (keyof typeof LOCAL_SERVICE_THRESHOLDS)[]){
    const state=new LocalCityServices([`city:local-service:v1:-1:0:${role}:2`]);
    for(let n=0;n<LOCAL_SERVICE_THRESHOLDS[role]-1;n++)state.addBuilding(block);
    expect(state.missing(block,role)).toBe(false);state.addBuilding(block);
    expect(state.missing(block,role)).toBe(true);expect(state.missing(other,role)).toBe(false);
    expect(state.reserve(block,role)).toBe(`city:local-service:v1:-1:0:${role}:3`);
    expect(state.missing(block,role)).toBe(false);expect(()=>state.reserve(block,role)).toThrow();
    const existing=new LocalCityServices([]);existing.addRole(block,role);
    for(let n=0;n<100;n++)existing.addBuilding(block);
    expect(existing.missing(block,role)).toBe(false);
  }
});

it('preserves old occupied art, parcels, entrances and roads through append and deterministic reload',()=>{
  const before=compileBlockLayout(input(350)),snapshot=structuredClone(before);
  const request={...input(450),revision:2,previous:before},after=compileBlockLayout(request);
  expect(before).toEqual(snapshot);
  const oldBlocks=new Map(snapshot.blocks.map(b=>[b.id,b])),newBlocks=new Map(after.blocks.map(b=>[b.id,b]));
  for(const old of snapshot.placements){
    expect(after.placements.find(p=>p.taskId===old.taskId)).toEqual(old);
    const oldSlot=blockSlots(oldBlocks.get(old.blockId)!).find(s=>s.key===old.slotKey);
    const newSlot=blockSlots(newBlocks.get(old.blockId)!).find(s=>s.key===old.slotKey);
    expect(newSlot).toEqual(oldSlot);
  }
  for(const old of snapshot.blocks){
    const next=newBlocks.get(old.id)!;expect(next.origin).toEqual(old.origin);
    expect(next.parameters.sitePlan).toEqual(old.parameters.sitePlan);
  }
  for(const old of before.roadNetwork.segments)expect(after.roadNetwork.segments).toContainEqual(old);
  const replay=compileBlockLayout({...request,revision:3,previous:after,
    districts:request.districts.map(d=>({...d,tasks:[...d.tasks].reverse()}))});
  expect(replay.blocks).toEqual(after.blocks);expect(replay.placements).toEqual(after.placements);
  expect(replay.roadNetwork).toEqual(after.roadNetwork);
  const development=cityDevelopment(after);
  for(const service of development.services.filter(s=>s.trigger?.startsWith('city:local-service:'))){
    expect(service.state).toBe('READY');expect(after.placements.find(p=>p.taskId===service.taskId)?.serviceRole).toBe(service.role);
  }
});

it('keeps local service demand pending when no real matching service art can fit',()=>{
  const original=[...BUILDING_CATALOG];
  try{
    BUILDING_CATALOG.splice(0,BUILDING_CATALOG.length,...original.filter(b=>!b.serviceRole||!Object.hasOwn(LOCAL_SERVICE_THRESHOLDS,b.serviceRole)));
    const layout=compileBlockLayout(input(600));
    expect(layout.placements).toHaveLength(600);
    expect(layout.blocks.flatMap(b=>Object.values(b.parameters.slotRoleTriggers as Record<string,string>??{}))
      .filter(t=>t.startsWith('city:local-service:'))).toEqual([]);
  }finally{BUILDING_CATALOG.splice(0,BUILDING_CATALOG.length,...original);}
});

it('replaces a demolished local service on a future parcel with a new durable generation',()=>{
  const before=compileBlockLayout(input(600)),lastZone=zone(before.blocks.at(-1)!);
  const blocks=new Map(before.blocks.map(b=>[b.id,b]));
  const removed=before.placements.find(p=>p.serviceRole==='EDUCATION'&&zone(blocks.get(p.blockId)!)===lastZone)!;
  expect(removed).toBeDefined();
  const historical=structuredClone(before);
  historical.siteMarkers.push({id:'closed-school',blockId:removed.blockId,slotKey:removed.slotKey,kind:'RUINED',
    snapshot:{buildingFamily:removed.buildingFamily},assetVariant:'ruin'});
  const request=input(650);request.districts[0]!.tasks=request.districts[0]!.tasks.filter(t=>t.id!==removed.taskId);
  const after=compileBlockLayout({...request,revision:2,previous:historical});
  const replacement=after.placements.find(p=>p.serviceRole==='EDUCATION'&&p.taskId!==removed.taskId
    &&zone(after.blocks.find(b=>b.id===p.blockId)!)===lastZone)!;
  expect(replacement).toBeDefined();
  const block=after.blocks.find(b=>b.id===replacement.blockId)!;
  expect((block.parameters.slotRoleTriggers as Record<string,string>)[replacement.slotKey])
    .toBe(`city:local-service:v1:${lastZone}:EDUCATION:2`);
  expect(after.placements.some(p=>p.blockId===removed.blockId&&p.slotKey===removed.slotKey)).toBe(false);
  expect(after.siteMarkers).toEqual(historical.siteMarkers);
  expect(after.placements.filter(p=>p.serviceRole==='EDUCATION'&&zone(after.blocks.find(b=>b.id===p.blockId)!)===lastZone)).toHaveLength(1);
});
