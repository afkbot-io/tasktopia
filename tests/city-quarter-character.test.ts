import {expect,it} from 'vitest';
import {compileBlockLayout,type BlockLayoutCompilerInput} from '../src/server/world/block-layout-compiler';
import {compactHomeFamily} from '../src/shared/compact-building-families';
import {BUILDING_CATALOG} from '../src/shared/catalog';
import {BUILDING_PROFILES} from '../src/shared/building-profiles';
import {blockSlots} from '../src/shared/block-templates';
import {cityNeighbourhoodKey} from '../src/shared/city-neighbourhood';

const input=(count:number):BlockLayoutCompilerInput=>({countryId:'character-country',cityId:'character-city',seed:424242,revision:1,
  localServices:'DISTRIBUTED_V1',localCharacters:'LOCAL_V1',
  districts:[{id:'one-district',sequence:0,archetype:'NEW_BUILD',tasks:Array.from({length:count},(_,i)=>({
    id:`task-${i+1}`,taskNumber:i+1,buildingFamily:'compact-apartment-v1',facadeVariant:'south',constructionStage:5,
  }))}]});
it('gives distant parts of one district three coherent persistent native building characters',()=>{
  const layout=compileBlockLayout(input(600));
  expect(new Set(layout.blocks.map(b=>b.parameters.quarterCharacter))).toEqual(new Set(['TERRACOTTA','SLATE','GARDENS']));
  const zones=new Map<string,unknown>();
  for(const block of layout.blocks){
    const zone=`${Math.floor((block.origin.x+block.width/2)/128)}:${Math.floor((block.origin.y+block.height/2)/128)}`;
    expect(block.parameters.quarterCharacterVersion).toBe(1);
    if(zones.has(zone))expect(block.parameters.quarterCharacter).toBe(zones.get(zone));
    zones.set(zone,block.parameters.quarterCharacter);
  }
  expect(layout.placements).toHaveLength(600);expect(layout.districtLayouts).toHaveLength(1);
  const families=new Map<string,Set<string>>();
  for(const placement of layout.placements){
    const entry=BUILDING_CATALOG.find(b=>b.key===placement.buildingFamily)!;
    if(placement.serviceRole||entry.category!=='HOUSE'||entry.footprint.width!==6||entry.footprint.height!==6)continue;
    const block=layout.blocks.find(b=>b.id===placement.blockId)!,character=String(block.parameters.quarterCharacter);
    const keys=families.get(character)??new Set();keys.add(entry.key);families.set(character,keys);
  }
  for(const keys of families.values())expect(keys.size).toBeGreaterThanOrEqual(2);
  expect(families.get('SLATE')!.has('compact-rust-loft-v1')).toBe(false);
  expect(families.get('TERRACOTTA')!.has('compact-modern-five-floor-v1')).toBe(false);
  expect(families.get('GARDENS')!.has('compact-rust-loft-v1')).toBe(false);
});

it('uses two or more native themed homes where possible and keeps profile/access fallbacks',()=>{
  const themes=['TERRACOTTA','SLATE','GARDENS'] as const;
  const sample=(w:number,h:number,profile:'PRIVATE'|'NEW_BUILD'|'CIVIC'|'COMMERCIAL',character:typeof themes[number])=>
    new Set(Array.from({length:24},(_,entropy)=>compactHomeFamily(w,h,entropy,new Map(),profile,undefined,character)));
  const terra=sample(6,6,'NEW_BUILD','TERRACOTTA'),slate=sample(6,6,'NEW_BUILD','SLATE'),garden=sample(6,6,'NEW_BUILD','GARDENS');
  expect(terra.has('compact-rust-loft-v1')).toBe(true);expect(terra.has('compact-modern-five-floor-v1')).toBe(false);
  expect(slate.has('compact-modern-five-floor-v1')).toBe(true);expect(slate.has('compact-rust-loft-v1')).toBe(false);
  expect(garden.has('compact-olive-five-floor-v1')).toBe(true);expect(garden.has('compact-rust-loft-v1')).toBe(false);
  for(const theme of themes){
    expect(sample(6,4,'NEW_BUILD',theme).size).toBeGreaterThanOrEqual(2);
    const privateHomes=sample(6,6,'PRIVATE',theme);expect(privateHomes.size).toBeGreaterThanOrEqual(2);
    for(const key of privateHomes)expect(BUILDING_CATALOG.find(b=>b.key===key)?.floorCount??3).toBeLessThanOrEqual(3);
    for(const profile of ['CIVIC','COMMERCIAL'] as const)
      for(const key of sample(6,6,profile,theme))expect(BUILDING_PROFILES[profile].homes as readonly string[]).toContain(key);
    expect(compactHomeFamily(12,8,3,undefined,'NEW_BUILD',undefined,theme)).toBe('compact-u-courtyard-v1');
    expect(compactHomeFamily(6,6,3,undefined,'NEW_BUILD',()=>false,theme)).toBeUndefined();
  }
});

it('keeps themed assignment independent of catalogue enumeration order',()=>{
  const original=[...BUILDING_CATALOG];
  const choices=()=>Array.from({length:8},(_,n)=>compactHomeFamily(6,4,n,undefined,'NEW_BUILD',undefined,'TERRACOTTA'));
  const before=choices();
  try{BUILDING_CATALOG.reverse();expect(choices()).toEqual(before);}
  finally{BUILDING_CATALOG.splice(0,BUILDING_CATALOG.length,...original);}
});

it('does not retrofit old blocks or change occupied art/access on growth, reload and profile changes',()=>{
  const legacyInput=input(150);delete legacyInput.localCharacters;
  const legacy=compileBlockLayout(legacyInput),snapshot=structuredClone(legacy);
  const current=compileBlockLayout({...input(300),revision:2,previous:legacy});
  const changed=input(450);changed.districts[0]!.archetype='PRIVATE';
  const grown=compileBlockLayout({...changed,revision:3,previous:current});
  expect(legacy).toEqual(snapshot);
  for(const old of current.blocks){
    const now=grown.blocks.find(b=>b.id===old.id)!;
    expect(now.parameters.sitePlan).toEqual(old.parameters.sitePlan);
    expect(now.parameters.quarterCharacter).toBe(old.parameters.quarterCharacter);
    expect(now.parameters.quarterCharacterVersion).toBe(old.parameters.quarterCharacterVersion);
    expect(now.parameters.buildingProfile).toBe(old.parameters.buildingProfile);
  }
  for(const old of current.placements){
    expect(grown.placements.find(p=>p.taskId===old.taskId)).toEqual(old);
    expect(blockSlots(grown.blocks.find(b=>b.id===old.blockId)!).find(s=>s.key===old.slotKey))
      .toEqual(blockSlots(current.blocks.find(b=>b.id===old.blockId)!).find(s=>s.key===old.slotKey));
  }
  for(const old of snapshot.blocks)expect(grown.blocks.find(b=>b.id===old.id)!.parameters.quarterCharacter).toBeUndefined();
  expect(grown.blocks.some(b=>b.parameters.buildingProfile==='PRIVATE'&&b.parameters.quarterCharacterVersion===1)).toBe(true);
  const replay=compileBlockLayout({...changed,revision:4,previous:grown,
    districts:changed.districts.map(d=>({...d,tasks:[...d.tasks].reverse()}))});
  expect(replay.blocks).toEqual(grown.blocks);expect(replay.placements).toEqual(grown.placements);
});

it('balances a fresh neighbourhood locally instead of repeating one home to offset distant legacy usage',()=>{
  const original=input(600);delete original.localCharacters;original.districts[0]!.archetype='PRIVATE';
  const legacy=compileBlockLayout(original),oldZones=new Set(legacy.blocks.map(cityNeighbourhoodKey));
  const result=compileBlockLayout({...input(1000),revision:2,previous:legacy});
  const blocks=new Map(result.blocks.map(b=>[b.id,b])),areas=new Map<string,string[]>();
  for(const placement of result.placements){
    const block=blocks.get(placement.blockId)!,zone=cityNeighbourhoodKey(block),entry=BUILDING_CATALOG.find(b=>b.key===placement.buildingFamily)!;
    if(oldZones.has(zone)||placement.serviceRole||entry.category!=='HOUSE'||entry.footprint.width!==6||entry.footprint.height!==4)continue;
    const keys=areas.get(zone)??[];keys.push(entry.key);areas.set(zone,keys);
  }
  const populated=[...areas.values()].filter(keys=>keys.length>=3);expect(populated.length).toBeGreaterThanOrEqual(1);
  for(const keys of populated)expect(new Set(keys).size,JSON.stringify(keys)).toBeGreaterThanOrEqual(2);
});
