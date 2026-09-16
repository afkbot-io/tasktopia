import { expect,it } from "vitest";
import { retainCountryRenderSnapshot } from "../src/client/country-render-snapshot";
import { COUNTRY_OVERVIEW_SCHEMA_VERSION,type CountryOverviewDto } from "../src/shared/country-overview-contract";
const fixture=():CountryOverviewDto=>({schemaVersion:COUNTRY_OVERVIEW_SCHEMA_VERSION,countryId:"c",revision:"1",terrainSeed:1,
  bounds:{minX:0,minY:0,maxX:10,maxY:10},geography:{columns:1,rows:1,cellSize:8,topology:"SQUARE_4",terrainCodes:"0",territoryCodes:"1"},
  groundRoads:{revision:1,routes:[],unavailable:[]},connections:[],cities:[{id:"city",name:"Old",status:"ACTIVE",sourceCenter:{x:0,y:0},atlasCenter:{x:5,y:5},sourceBounds:{minX:0,minY:0,maxX:10,maxY:10},progress:10,districts:[],miniature:{cellSize:8,columns:1,rows:1,blocks:[{id:"b",districtId:"d",x:0,y:0,family:"compact-apartment-v1",stage:2}],airports:[],stations:[]}}]});
it("retains the running scene for progress, labels and revision changes",()=>{
  const original=fixture(),next=structuredClone(original);
  next.revision="2";next.cities[0]!.progress=30;next.cities[0]!.name="New";
  expect(retainCountryRenderSnapshot(original,next)).toBe(original);
});
it("replaces snapshots for stage, terrain, routes, geography and authorization scope",()=>{
  const original=fixture();
  for(const change of [(n:CountryOverviewDto)=>{n.countryId="other"},(n:CountryOverviewDto)=>{n.geography.terrainCodes="1"},
    (n:CountryOverviewDto)=>{n.cities[0]!.miniature.blocks[0]!.stage=3},(n:CountryOverviewDto)=>{n.cities=[]},
    (n:CountryOverviewDto)=>{n.railConnections=[{id:"r",fromStationId:"a",toStationId:"b",fromCityId:"c1",toCityId:"c2"}]},
    (n:CountryOverviewDto)=>{n.connections=[{fromCityId:"a",toCityId:"b"}]},(n:CountryOverviewDto)=>{n.cities[0]!.atlasCenter.x++}]){
    const next=structuredClone(original);change(next);expect(retainCountryRenderSnapshot(original,next)).toBe(next);
  }
});
it("refreshes sea departures and revocations without local building changes",()=>{
  const original=fixture(),connected=structuredClone(original);
  connected.seaConnections=[{id:"sea:a:b",fromPortId:"a",toPortId:"b",fromCityId:"city",toCityId:"foreign",
    points:[{x:1,y:1},{x:2,y:1}],progressRange:[0,.1]}];
  expect(retainCountryRenderSnapshot(original,connected)).toBe(connected);
  const revoked={...connected,seaConnections:[]};
  expect(retainCountryRenderSnapshot(connected,revoked)).toBe(revoked);
  const rerouted=structuredClone(connected);rerouted.seaConnections![0]!.points[1]!.x=3;
  expect(retainCountryRenderSnapshot(connected,rerouted)).toBe(rerouted);
});
