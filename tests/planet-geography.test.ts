import { buildCountryGeography, countryMacroContext, createCountryWorldProjection } from "../src/server/world/country-geography";
import { expect, it } from "vitest";
import { extendPersonalPlanet, importPersonalPlanet, PlanetGeographyCapacityError, visiblePersonalPlanet } from "../src/shared/planet-geography";
import { projectPlanetAtlas } from "../src/shared/planet-atlas";
import type { PlanetAtlasDto, PlanetCountryDto } from "../src/shared/planet-atlas-contract";
const country=(i:number):PlanetCountryDto=>({id:`country-${i}`,name:`Country ${i}`,seed:i+11,worldVersion:1,cityCount:1,districtCount:3,buildingCount:20,unfinishedBuildingCount:10,progress:50,
  worldBounds:{minX:-100,minY:-100,maxX:100,maxY:100},cities:[{id:`city-${i}`,center:{x:0,y:0},districts:[],airports:[]}]});
const atlas=(count:number):PlanetAtlasDto=>({schemaVersion:4,planetSeed:78441,revision:"test",countries:Array.from({length:count},(_,i)=>country(i))});
it("imports the exact previous map and appends 1→2→3→10 countries without moving existing geography",()=>{
  const first=atlas(1), old=projectPlanetAtlas(first);
  let geography=importPersonalPlanet(first);
  expect(geography.countries["country-0"]!.cells).toEqual(old.countries[0]!.cells);
  expect(geography.coastCells).toEqual(old.coastCells);
  for(const count of [2,3,10]){
    const previous=structuredClone(geography);
    geography=extendPersonalPlanet(geography,atlas(count));
    for(const [id,record] of Object.entries(previous.countries))expect(geography.countries[id]).toEqual(record);
    expect(geography.width).toBe(previous.width);expect(geography.height).toBe(previous.height);
    const cells=Object.values(geography.countries).flatMap(c=>c.cells.map(cell=>`${cell.q}:${cell.r}`));
    expect(new Set(cells).size).toBe(cells.length);
    expect(extendPersonalPlanet(geography,atlas(count))).toEqual(geography);
  }
  expect(Object.keys(geography.countries)).toHaveLength(10);
});
it("retains private reserves and ignores counters, source extent changes and lost access",()=>{
  const input=atlas(3), geography=importPersonalPlanet(input);
  const changed=structuredClone(input);
  changed.countries.splice(1,1);
  changed.countries[0]!.buildingCount=2000;changed.countries[0]!.cityCount=400;
  changed.countries[0]!.worldBounds!.maxX=50000;
  expect(extendPersonalPlanet(geography,changed)).toEqual(geography);
  expect(extendPersonalPlanet(geography,input)).toEqual(geography);
  input.countries[0]!.worldBounds!.minX=-9999;
  expect(geography.countries["country-0"]!.worldBounds!.minX).toBe(-100);
});
it("assigns new cities dry anchors without moving existing cities; capacity failure is atomic",()=>{
  const input=atlas(1), geography=importPersonalPlanet(input);
  input.countries[0]!.cities.push({id:"new-city",center:{x:9000,y:9000},districts:[],airports:[]});
  const extended=extendPersonalPlanet(geography,input), record=extended.countries["country-0"]!;
  expect(record.cities["city-0"]).toEqual(geography.countries["country-0"]!.cities["city-0"]);
  const point=record.cities["new-city"]!.point;
  expect(record.cells.some(c=>c.terrain!=="river"&&(c.q*2+1)*extended.hexRadius===point.x&&(c.r*2+1)*extended.hexRadius===point.y)).toBe(true);
  const full=structuredClone(geography);full.width=full.height=16;
  const before=JSON.stringify(full);
  expect(()=>extendPersonalPlanet(full,atlas(2))).toThrow(PlanetGeographyCapacityError);
  expect(JSON.stringify(full)).toBe(before);
});

it("renders the imported view exactly and excludes inaccessible reserves from public geometry",()=>{
  const input=atlas(3), before=projectPlanetAtlas(input), stored=importPersonalPlanet(input);
  const publicView=visiblePersonalPlanet(stored,input);
  const after=projectPlanetAtlas({...input,geography:publicView});
  expect(after.countries.map(c=>({cells:c.cells,center:c.center,anchors:c.cityAnchors,continent:c.continent})))
    .toEqual(before.countries.map(c=>({cells:c.cells,center:c.center,anchors:c.cityAnchors,continent:c.continent})));
  expect(after.coastCells).toEqual(before.coastCells);
  const limited=visiblePersonalPlanet(stored,{...input,countries:[input.countries[0]!]});
  expect(Object.keys(limited.countries)).toEqual(["country-0"]);
  expect(JSON.stringify(limited)).not.toContain("country-1");
  expect(JSON.stringify(limited)).not.toContain("country-2");
  expect(limited).not.toHaveProperty("coastOwners");
});

it("keeps COUNTRY and PLANET city anchors fixed when another city expands the world extent",()=>{
  const input=atlas(1), stored=importPersonalPlanet(input);
  const project=(source:PlanetAtlasDto, geometry:ReturnType<typeof importPersonalPlanet>)=>{
    const planet=projectPlanetAtlas({...source,geography:visiblePersonalPlanet(geometry,source)});
    const selected=planet.countries[0]!;
    const grid=buildCountryGeography({countryId:selected.id,seed:selected.seed,macroCells:countryMacroContext(planet,selected.id)});
    return { planet:selected, point:createCountryWorldProjection(grid,selected)(source.countries[0]!.cities[0]!.center) };
  };
  const before=project(input,stored);
  const changed=structuredClone(input);
  changed.countries[0]!.worldBounds!.maxX=90000;
  changed.countries[0]!.cities.push({id:"new-city",center:{x:89000,y:10},districts:[],airports:[]});
  const after=project(changed,extendPersonalPlanet(stored,changed));
  expect(before.point).not.toBeNull();
  expect(after.point).toEqual(before.point);
  expect(after.planet.cityAnchors["city-0"]).toEqual(before.planet.cityAnchors["city-0"]);
});
it.each([1,7,42,424242,999999])("has room for ten countries without changing the imported frame (seed %s)",(seed)=>{
  const source={...atlas(1),planetSeed:seed};
  const first=importPersonalPlanet(source);
  const next=extendPersonalPlanet(first,{...atlas(10),planetSeed:seed});
  expect(Object.keys(next.countries)).toHaveLength(10);
  expect(next.countries["country-0"]).toEqual(first.countries["country-0"]);
});
it("opens a new area on a full map without moving old countries or mixing coastlines",()=>{
  const input=atlas(1), stored=importPersonalPlanet(input);
  const occupied=stored.countries["country-0"]!;
  occupied.cells=Array.from({length:92*92},(_,i)=>({q:i%92,r:Math.floor(i/92),id:`country-0:full-${i}`,terrain:"grass" as const}));
  const before=structuredClone(stored);
  const source=atlas(2), extended=extendPersonalPlanet(stored,source);
  expect(extended.countries["country-0"]).toEqual(before.countries["country-0"]);
  expect(extended.countries["country-1"]!.sector).toBe(1);
  expect([extended.width,extended.height]).toEqual([stored.width,stored.height]);
  const publicAtlas={...source,geography:visiblePersonalPlanet(extended,source)};
  expect(projectPlanetAtlas(publicAtlas,0).countries.map(c=>c.id)).toEqual(["country-0"]);
  const second=projectPlanetAtlas(publicAtlas,1);
  expect(second.countries.map(c=>c.id)).toEqual(["country-1"]);
  expect(second.coastCells.every(c=>c.sector===1)).toBe(true);
  expect(extendPersonalPlanet(extended,source)).toEqual(extended);
});

it("subdivides a full country's dry cells for new city anchors without moving old anchors or coastlines",()=>{
  const source=atlas(1),first=importPersonalPlanet(source),record=first.countries["country-0"]!;
  const cell=record.cells.find(c=>c.terrain!=="river")!;
  record.cells=[cell];record.cities["city-0"]!.point={x:(cell.q*2+1)*first.hexRadius,y:(cell.r*2+1)*first.hexRadius};
  let previous=first;
  for(const count of [20,80]){
    source.countries[0]!.cities=[source.countries[0]!.cities[0]!,...Array.from({length:count},(_,i)=>({id:`extra-${i}`,center:{x:1000,y:1000},districts:[],airports:[]}))];
    const next=extendPersonalPlanet(previous,source),anchors=next.countries["country-0"]!.cities;
    for(const [id,old] of Object.entries(previous.countries["country-0"]!.cities))expect(anchors[id]).toEqual(old);
    const points=Object.values(anchors).map(a=>a.point);
    expect(new Set(points.map(p=>`${p.x},${p.y}`)).size).toBe(count+1);
    for(const p of points){expect(Math.floor(p.x/(first.hexRadius*2))).toBe(cell.q);expect(Math.floor(p.y/(first.hexRadius*2))).toBe(cell.r);}
    expect(next.coastCells).toEqual(first.coastCells);expect(next.countries["country-0"]!.cells).toEqual([cell]);
    expect(extendPersonalPlanet(next,source)).toEqual(next);previous=next;
  }
});

it("establishes an empty country's first local extent once while keeping its land and later anchors fixed",()=>{
  const empty=atlas(1);empty.countries[0]!.cities=[];empty.countries[0]!.worldBounds=null;
  const original=importPersonalPlanet(empty),first=extendPersonalPlanet(original,atlas(1));
  expect(first.countries["country-0"]!.worldBounds).toEqual(country(0).worldBounds);
  expect(first.countries["country-0"]!.cells).toEqual(original.countries["country-0"]!.cells);
  expect(first.countries["country-0"]!.center).toEqual(original.countries["country-0"]!.center);
  const more=atlas(1);more.countries[0]!.worldBounds={minX:-9999,minY:-9999,maxX:9999,maxY:9999};
  more.countries[0]!.cities.push({...more.countries[0]!.cities[0]!,id:"second-city",center:{x:200,y:300}});
  const second=extendPersonalPlanet(first,more);
  expect(second.countries["country-0"]!.worldBounds).toEqual(first.countries["country-0"]!.worldBounds);
  expect(second.countries["country-0"]!.cities["city-0"]).toEqual(first.countries["country-0"]!.cities["city-0"]);
  expect(original.countries["country-0"]!.worldBounds).toBeNull();
});
