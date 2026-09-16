import { expect,it } from "vitest";
import { createTestDb } from "../src/server/db";
import { coastalPortPair } from "./fixtures/coastal-ports";
import { projectPlanetAtlas } from "../src/shared/planet-atlas";
import { buildPlanetSeaRoutes } from "../src/shared/planet-port-transport";
it("exposes one actual voyage in planet, country and city and removes it after access revocation",async()=>{
  const db=await createTestDb();
  try{
    const {user,service,ports}=await coastalPortPair(db);
    const atlas=await service.getPlanetAtlas(user.id);
    for(const site of ports)expect(atlas.countries.find(c=>c.id===site.countryId)!.cities[0]!.miniature)
      .toEqual(expect.arrayContaining([expect.objectContaining({id:site.port.id,family:"compact-port-v1",stage:5})]));
    const routes=buildPlanetSeaRoutes(projectPlanetAtlas(atlas));
    expect(routes).toHaveLength(1);
    for(const {countryId,city,port} of ports){
      const country=await service.getCountryOverview(user.id,countryId);
      expect(country.cities[0]!.miniature.transport).toEqual(expect.arrayContaining([expect.objectContaining({taskId:port.id,family:"compact-port-v1",stage:5})]));
      expect(country.cities[0]!.miniature.stations).toEqual([]);
      expect(country.seaConnections).toHaveLength(1);expect(country.seaConnections![0]!.id).toBe(routes[0]!.id);
      const scene=await service.getCitySceneForUser(user.id,countryId,city.id);
      expect(scene.seaConnections).toHaveLength(1);expect(scene.seaConnections![0]!.id).toBe(routes[0]!.id);
      const development=await service.getCityDevelopment(user.id,countryId,city.id);
      expect(development.transport!.find(item=>item.kind==="SEA")).toMatchObject({state:"CONNECTED",routes:[{id:routes[0]!.id,travelMs:120000,dwellMs:24000}]});
      const local=scene.ports!.find(p=>p.taskId===port.id)!;
      const path=scene.seaConnections![0]!.points;
      expect(path.some(p=>p.x===local.plan.berth.x+.5&&p.y===local.plan.berth.y+.5)).toBe(true);
      expect(path.every(p=>p.x<=scene.city.bounds.maxX&&p.y<=scene.city.bounds.maxY)).toBe(true);
    }
    const saved=(await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?").get<{geography_json:import("../src/shared/planet-geography").PersonalPlanetGeography}>(user.id))!.geography_json;
    const reserved=structuredClone(saved),record=reserved.countries[ports[0]!.countryId]!;
    const rows=Math.round(reserved.height/(reserved.hexRadius*2)-1.5);
    reserved.countries["inaccessible-reserve"]={...record,continent:99,cities:{},cells:Array.from({length:rows},(_,r)=>({q:22,r,id:`private-${r}`,terrain:"grass"}))};
    await db.prepare("UPDATE personal_planet_geography_v1 SET geography_json=?::jsonb WHERE user_id=?").run(JSON.stringify(reserved),user.id);
    const blocked=await service.getPlanetAtlas(user.id);
    expect(JSON.stringify(blocked)).not.toContain("inaccessible-reserve");
    expect(JSON.stringify(blocked)).not.toContain("private-");
    expect(buildPlanetSeaRoutes(projectPlanetAtlas(blocked))).toEqual([]);
    expect((await service.getCountryOverview(user.id,ports[0]!.countryId)).seaConnections).toEqual([]);
    await db.prepare("UPDATE personal_planet_geography_v1 SET geography_json=?::jsonb WHERE user_id=?").run(JSON.stringify(saved),user.id);
    const first=ports[0]!,second=ports[1]!;
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(second.countryId,user.id);
    expect(buildPlanetSeaRoutes(projectPlanetAtlas(await service.getPlanetAtlas(user.id)))).toEqual([]);
    expect((await service.getCitySceneForUser(user.id,first.countryId,first.city.id)).seaConnections).toEqual([]);
    await expect(service.getCitySceneForUser(user.id,second.countryId,second.city.id)).rejects.toThrow(/доступ/);
  }finally{await db.close();}
});
