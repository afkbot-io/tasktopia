import {expect,it} from "vitest";
import {projectForeignRail} from "../src/server/world/country-foreign-rail";
import type {CountryGeography} from "../src/server/world/country-geography";
it("keeps only the contiguous visible land segment and its fraction of the complete trip",()=>{
 const geography={grid:{columns:4,rows:1,cellSize:4,topology:"SQUARE_4"},cells:Array.from({length:4},(_,i)=>({id:`c${i}`,column:i,row:0,x:i*4,y:0,terrain:"grass",land:true,macroCellId:`m${i}`,selected:true,ownerCountryId:"a",coast:false}))} as unknown as CountryGeography;
 const macro=Array.from({length:8},(_,i)=>({id:`m${i}`,q:i,r:0}));
 const points=macro.map(c=>({x:(c.q+.5)*8,y:4}));
 expect(projectForeignRail(points,macro,geography,4,true)).toEqual({points:[{x:2,y:2},{x:6,y:2},{x:10,y:2},{x:14,y:2}],progressRange:[0,3/7]});
 const wet=structuredClone(geography);wet.cells[2]!.land=false;
 expect(projectForeignRail(points,macro,wet,4,true)?.points).toEqual([{x:2,y:2},{x:6,y:2}]);
 expect(projectForeignRail([...points].reverse(),macro,geography,4,false)?.progressRange).toEqual([4/7,1]);
 expect(projectForeignRail(points,macro,geography,4,false)).toBeNull();
});

it("projects real shared-land international routes without water crossings or invented destinations",async()=>{
 const {transportAtlasFixture}=await import("./fixtures/atlas-transport");
 const {projectPlanetAtlas}=await import("../src/shared/planet-atlas");
 const {buildPlanetRailways}=await import("../src/shared/planet-surface-transport");
 const {buildCountryGeography,countryMacroContext}=await import("../src/server/world/country-geography");
 const atlas=projectPlanetAtlas(transportAtlasFixture());
 const routes=buildPlanetRailways(atlas).filter(r=>r.fromCountryId!==r.toCountryId);
 expect(routes.length).toBeGreaterThan(0);
 let checked=0;
 for(const route of routes){
  const geography=buildCountryGeography({countryId:route.fromCountryId,seed:1,macroCells:countryMacroContext(atlas,route.fromCountryId)});
  const result=projectForeignRail(route.points,[...atlas.countries.flatMap(c=>c.cells),...atlas.coastCells],geography,atlas.hexRadius,true);
  if(!result)continue;
  checked++;
  for(let i=0;i<result.points.length;i++){
   const p=result.points[i]!,cell=geography.cells.find(c=>c.column===Math.floor(p.x/4)&&c.row===Math.floor(p.y/4));
   expect(cell?.land).toBe(true);
   if(i){const old=result.points[i-1]!;expect(p.x===old.x||p.y===old.y).toBe(true);}
  }
  expect(result.progressRange[0]).toBe(0);
 }
 expect(checked).toBeGreaterThan(0);
});
