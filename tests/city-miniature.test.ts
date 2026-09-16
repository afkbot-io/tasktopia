import { expect, it } from "vitest";
import { BUILDING_CATALOG } from "../src/shared/catalog";
import { miniatureBuildingArt, miniatureTransportMarkers, selectMiniatureBuildings, miniatureRepresentative } from "../src/shared/city-miniature";
const families=BUILDING_CATALOG.filter(b=>!b.serviceRole).map(b=>b.key);
it("bounds empty, small and large cities without changing the selected identities on reorder",()=>{
  for(const size of [0,1,100,2000]) {
    const blocks=Array.from({length:size},(_,i)=>({id:`b-${String(i).padStart(4,"0")}`,districtId:"d",x:i,y:0,family:families[i%families.length]!}));
    const selected=selectMiniatureBuildings(blocks);
    expect(selected.length).toBe(Math.min(12,size));
    expect(selectMiniatureBuildings([...blocks].reverse())).toEqual(selected);
    expect(new Set(selected.map(b=>b.family)).size).toBe(Math.min(12,size,families.length));
  }
});
it("keeps every family within its envelope and monotonic across twenty zoom values",()=>{
  for(const family of families) {
    let previous={width:0,height:0};
    for(let i=0;i<20;i++) {
      const zoom=.5+i*.2,art=miniatureBuildingArt(family,zoom);
      expect(art.width).toBeGreaterThanOrEqual(previous.width);
      expect(art.height).toBeGreaterThanOrEqual(previous.height);
      expect(Math.max(art.width,art.height)).toBeLessThanOrEqual(Math.round(10*zoom));
      expect(Math.abs(art.width/art.nativeWidth-art.height/art.nativeHeight)).toBeLessThanOrEqual(1/art.nativeWidth+1/art.nativeHeight);
      previous=art;
    }
  }
});
it("caps visual infrastructure without modifying the real route endpoints",()=>{
  const miniature={airports:Array.from({length:5},(_,i)=>({taskId:`a${i}`,x:i,y:0})),stations:[{taskId:"s",x:0,y:0}]};
  expect(miniatureTransportMarkers(miniature)).toHaveLength(3);
  expect(miniature.airports).toHaveLength(5);
  expect(miniature.stations).toHaveLength(1);
});

it("uses construction art without changing the screen envelope between stages",()=>{
  const family="compact-airport-v1";
  const art=Array.from({length:5},(_,index)=>miniatureBuildingArt(family,2,10,index+1));
  expect(new Set(art.map(a=>a.url)).size).toBe(5);
  expect(new Set(art.map(a=>`${a.width}:${a.height}`)).size).toBe(1);
  const construction={transport:[{taskId:"a",family,stage:3,x:0,y:0}],airports:[],stations:[]};
  expect(miniatureTransportMarkers(construction)).toEqual(construction.transport);
  expect(construction.airports).toEqual([]);
});

it("keeps a rare landmark ahead of ordinary housing regardless of slot and progress",()=>{
  const landmark=BUILDING_CATALOG.find(b=>b.maxPerCity===1&&!b.serviceRole)!;
  const home=BUILDING_CATALOG.find(b=>b.rarity==="COMMON"&&!b.serviceRole)!;
  expect(landmark).toBeDefined(); expect(home).toBeDefined();
  const placements=[{slotKey:"a",buildingFamily:home.key,constructionStage:5},{slotKey:"z",buildingFamily:landmark.key,constructionStage:1}];
  expect(miniatureRepresentative(placements)?.slotKey).toBe("z");
  expect(miniatureRepresentative([...placements].reverse())?.slotKey).toBe("z");
  placements[1]!.constructionStage=5;
  expect(miniatureRepresentative(placements)?.slotKey).toBe("z");
  expect(miniatureRepresentative([{slotKey:"a",buildingFamily:"compact-airport-v1"}])).toBeUndefined();
});
