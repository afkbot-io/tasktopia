import { afterEach, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { readPersonalTransportRenderSnapshot } from "../src/server/world/personal-transport-render-snapshot";
import { projectPlanetAtlas } from "../src/shared/planet-atlas";
import { transportAtlasFixture } from "./fixtures/atlas-transport";
let db:Db|undefined;
afterEach(async()=>db?.close());
function navigationFor(atlas:ReturnType<typeof projectPlanetAtlas>) {
 const coastOwners:Record<string,string[]>={};
 for(const coast of atlas.coastCells){
  const distances=atlas.countries.map(country=>({id:country.id,distance:Math.min(...country.cells.map(cell=>Math.abs(cell.q-coast.q)+Math.abs(cell.r-coast.r)))}));
  const min=Math.min(...distances.map(entry=>entry.distance));coastOwners[coast.id]=distances.filter(entry=>entry.distance===min).map(entry=>entry.id);
 }
 return {blocked:new Set<string>(),coastOwners};
}
it("reuses a viewer snapshot after unrelated progress, preserves valid paths on growth and removes revoked endpoints",async()=>{
 db=await createTestDb();
 const {user}=await registerUser(db,{email:"transport-cache@example.test",name:"Cache",password:"password123"});
 const dto=transportAtlasFixture(),atlas=projectPlanetAtlas(dto),navigation=navigationFor(atlas);
 const first=await readPersonalTransportRenderSnapshot(db,user.id,0,atlas,navigation);
 expect(first.rails.length).toBeGreaterThan(0);expect(first.ships).toHaveLength(1);
 const authoritative=projectPlanetAtlas({...dto,airRoutes:first.air});
 expect(authoritative.routes.map(route=>({id:route.id,scheduleOffsetMs:route.scheduleOffsetMs}))).toEqual(first.air.map(route=>({id:route.id,scheduleOffsetMs:route.scheduleOffsetMs})));
 const stamp=async()=>db!.prepare("SELECT updated_at::text AS stamp FROM personal_transport_render_snapshots_v1 WHERE user_id=? AND sector=0").get<{stamp:string}>(user.id);
 const before=await stamp();
 for(const country of atlas.countries){country.worldVersion++;country.progress++;country.buildingCount++;}
 expect(await readPersonalTransportRenderSnapshot(db,user.id,0,atlas,navigation)).toEqual(first);
 expect(await stamp()).toEqual(before);
 // Add dry space away from the retained line. The source hash changes, but
 // a still-valid route retains every point and its published departure slot.
 const grown=structuredClone(atlas),cell=grown.countries[0]!.cells[0]!;
 grown.countries[0]!.cells.push({...cell,id:"growth",q:cell.q-5});
 const afterGrowth=await readPersonalTransportRenderSnapshot(db,user.id,0,grown,navigation);
 for(const old of first.rails){const route=afterGrowth.rails.find(route=>route.id===old.id);if(route)expect(route).toEqual(old);}
 const revoked=first.ships[0]!.toCountryId;
 const authorized=projectPlanetAtlas({...dto,countries:dto.countries.filter(country=>country.id!==revoked)});
 const afterRevoke=await readPersonalTransportRenderSnapshot(db,user.id,0,authorized,navigation);
 for(const route of [...afterRevoke.air,...afterRevoke.rails,...afterRevoke.ships])expect([route.fromCountryId,route.toCountryId]).not.toContain(revoked);
 for(const route of projectPlanetAtlas({...dto,countries:dto.countries.filter(country=>country.id!==revoked),airRoutes:first.air}).routes)expect([route.fromCountryId,route.toCountryId]).not.toContain(revoked);
 const removed=structuredClone(dto);for(const country of removed.countries)for(const city of country.cities){city.stations=[];city.ports=[];}
 expect(await readPersonalTransportRenderSnapshot(db,user.id,0,projectPlanetAtlas(removed),navigation)).toMatchObject({rails:[],ships:[]});
},30_000);
it('retains valid foreign airport and railway endpoints when new projects open terminals',async()=>{
 db=await createTestDb();const {user}=await registerUser(db,{email:'transport-growth@example.test',name:'Growth',password:'password123'});
 const atlas=projectPlanetAtlas(transportAtlasFixture()),navigation=navigationFor(atlas);
 const first=await readPersonalTransportRenderSnapshot(db,user.id,0,atlas,navigation);
 const foreignRails=first.rails.filter(route=>route.fromCountryId!==route.toCountryId);
 expect(foreignRails.length).toBeGreaterThan(0);
 const grown=structuredClone(atlas);
 for(const [index,country] of grown.countries.entries()){
  const old=country.cities.at(-1)!,id=`${old.id}x`,airportId=`000-new-airport-${index}`;
  country.cities.push({...old,id,airports:[{taskId:airportId,center:old.center}],stations:[{taskId:`station-new-${index}`,center:old.center}],ports:[],districts:[]});
  country.airports.push({...country.airports.at(-1)!,id:airportId,cityIndex:country.cities.length-1});
 }
 const next=await readPersonalTransportRenderSnapshot(db,user.id,0,grown,navigation);
 for(const route of foreignRails)expect(next.rails.some(next=>next.id===route.id),route.id).toBe(true);
 const beforeAir=first.air;
 expect(beforeAir).toBeDefined();
 const foreignAir=beforeAir.filter(route=>route.fromCountryId!==route.toCountryId);expect(foreignAir.length).toBeGreaterThan(0);
 for(const route of foreignAir)expect(next.air).toContainEqual(route);
},30_000);
it("invalidates a water corridor when a private reserved cell is blocked, without exposing its owner",async()=>{
 db=await createTestDb();const {user}=await registerUser(db,{email:"transport-water-cache@example.test",name:"Cache",password:"password123"});
 const atlas=projectPlanetAtlas(transportAtlasFixture()),navigation=navigationFor(atlas);
 const first=await readPersonalTransportRenderSnapshot(db,user.id,0,atlas,navigation),ship=first.ships[0]!;
 const point=ship.points[Math.floor(ship.points.length/2)]!,id=`${Math.floor(point.x/(2*atlas.hexRadius))},${Math.floor(point.y/(2*atlas.hexRadius))}`;
 const next=await readPersonalTransportRenderSnapshot(db,user.id,0,atlas,{...navigation,blocked:new Set([id])});
 for(const route of next.ships)for(const point of route.points)expect(`${Math.floor(point.x/(2*atlas.hexRadius))},${Math.floor(point.y/(2*atlas.hexRadius))}`).not.toBe(id);
 expect(JSON.stringify(next)).not.toContain("coastOwners");
},30_000);
