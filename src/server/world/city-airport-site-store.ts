import type { Db } from "../db";
import type { CompiledBlockLayoutV1 } from "../../shared/block-world";
import type { Rect } from "../../shared/contracts";
import { blockSlots } from "../../shared/block-templates";
import { airportSiteReservations, planAirportSite, type AirportSitePlan } from "../../shared/airport-site";
import { isBuildableTerrain,terrainAt } from "../../shared/world-terrain";
import { parseWorldTerrainProfile } from "../../shared/world-terrain-profile";
import { BlockPlacementError } from "./block-layout-compiler";
export type CityAirportSite={taskId:string;stage:number;plan:AirportSitePlan|null;reason:"NO_AIRFIELD"|null};
/** Persisted pads outlive a demolished terminal as protected historical land. */
export async function countryAirportReservations(db:Db,countryId:string,purpose:"PARCEL"|"ROAD"="PARCEL",excludeTaskId?:string):Promise<Rect[]>{
  const rows=await db.prepare(`SELECT a.geometry_json FROM city_airport_sites_v1 a JOIN city_layouts_v1 l ON l.id=a.layout_id
    WHERE l.country_id=? AND l.status='ACTIVE' AND (?::text IS NULL OR a.task_id<>?)`).all<{geometry_json:AirportSitePlan|null}>(countryId,excludeTaskId??null,excludeTaskId??null);
  return rows.flatMap(row=>airportSiteReservations(row.geometry_json,purpose));
}
export async function readCityAirportSites(db:Db,layout:CompiledBlockLayoutV1,obstacles:readonly Rect[]=[],roads:readonly Rect[]=[],retryUnavailable=false):Promise<CityAirportSite[]>{
  const placements=layout.placements.filter(p=>p.serviceRole==="AIRPORT");if(!placements.length)return [];
  const stored=new Map((await db.prepare("SELECT task_id,geometry_json FROM city_airport_sites_v1 WHERE layout_id=?")
    .all<{task_id:string;geometry_json:AirportSitePlan|null}>(layout.id)).map(row=>[row.task_id,row.geometry_json]));
  const country=await db.prepare("SELECT terrain_profile_json FROM countries WHERE id=?").get<{terrain_profile_json:unknown}>(layout.countryId);
  const profile=parseWorldTerrainProfile(country?.terrain_profile_json);
  const slots=layout.blocks.flatMap(block=>blockSlots(block).map(slot=>({blockId:block.id,slot})));
  const own=slots.map(({slot})=>slot.footprintBounds);
  const result:CityAirportSite[]=[];
  for(const placement of placements){
    if(!retryUnavailable&&stored.has(placement.taskId)&&stored.get(placement.taskId)===null){result.push({taskId:placement.taskId,stage:placement.constructionStage,plan:null,reason:"NO_AIRFIELD"});continue;}
    const slot=slots.find(value=>value.blockId===placement.blockId&&value.slot.key===placement.slotKey)!.slot;
    const existing=stored.get(placement.taskId);
    const entrance=slot.accessPath[0];
    const unchanged=existing && entrance && existing.access[0]?.x===entrance.x && existing.access[0]?.y===entrance.y;
    const ownReservations=airportSiteReservations(existing);
    const sameRect=(a:Rect,b:Rect)=>a.minX===b.minX&&a.maxX===b.maxX&&a.minY===b.minY&&a.maxY===b.maxY;
    const occupied=[...own,...obstacles.filter(rect=>!ownReservations.some(own=>sameRect(rect,own))),...result.flatMap(site=>airportSiteReservations(site.plan))];
    const plan=unchanged?existing:entrance?planAirportSite({bounds:layout.bounds,entrance,occupied,airfieldObstacles:roads,
      existing:existing??undefined,isDry:p=>isBuildableTerrain(terrainAt(layout.seed,p.x,p.y,profile).terrain)}):null;
    if(existing&&!plan)throw new BlockPlacementError("Новый вход аэропорта не связан с сохранённым аэродромом");
    result.push({taskId:placement.taskId,stage:placement.constructionStage,plan,reason:plan?null:"NO_AIRFIELD"});
  }
  return result;
}
/** Called only by the existing authorized country/topology mutation. */
export async function freezeCityAirportSites(db:Db,layout:CompiledBlockLayoutV1,obstacles:readonly Rect[]=[],roads:readonly Rect[]=[]):Promise<void>{
  const sites=await readCityAirportSites(db,layout,obstacles,roads,true);
  for(const site of sites)await db.prepare(`INSERT INTO city_airport_sites_v1(layout_id,task_id,geometry_json) VALUES (?,?,?::jsonb)
    ON CONFLICT(layout_id,task_id) DO UPDATE SET geometry_json=CASE WHEN city_airport_sites_v1.geometry_json IS NULL THEN excluded.geometry_json
      ELSE jsonb_set(city_airport_sites_v1.geometry_json,'{access}',excluded.geometry_json->'access') END
    WHERE city_airport_sites_v1.geometry_json IS DISTINCT FROM excluded.geometry_json`).run(layout.id,site.taskId,site.plan?JSON.stringify(site.plan):null);
}

/** One readiness projection for every map level. Persisted pads take the cheap
 * path. Legacy pads are derived read-only with country-wide reservations;
 * only the explicit migration/country mutation may freeze them. */
export async function readCountryAirportSites(db:Db,countryId:string):Promise<Map<string,CityAirportSite[]>>{
 const rows=await db.prepare(`SELECT l.city_id,p.task_id,p.construction_stage,a.task_id AS persisted,a.geometry_json
   FROM city_layouts_v1 l JOIN task_placements_v1 p ON p.layout_id=l.id JOIN city_blocks_v1 b ON b.id=p.block_id
   LEFT JOIN city_airport_sites_v1 a ON a.layout_id=l.id AND a.task_id=p.task_id
   WHERE l.country_id=? AND l.status='ACTIVE' AND b.parameters_json->'slotRoles'->>p.slot_key='AIRPORT' ORDER BY l.city_id,p.task_id`)
   .all<{city_id:string;task_id:string;construction_stage:number;persisted:string|null;geometry_json:AirportSitePlan|null}>(countryId);
 const result=new Map<string,CityAirportSite[]>();
 for(const row of rows)if(row.persisted){const group=result.get(row.city_id)??[];group.push({taskId:row.task_id,stage:row.construction_stage,plan:row.geometry_json,reason:row.geometry_json?null:"NO_AIRFIELD"});result.set(row.city_id,group);}
 const missing=[...new Set(rows.filter(row=>!row.persisted).map(row=>row.city_id))];if(!missing.length)return result;
 const [{readActiveBlockLayouts},{countryPortReservations},{countryRailwayReservations},{permanentSiteBounds},{readCountryRoads},{intercityRoadCorridors}]=await Promise.all([
  import("./active-block-layout"),import("./port-reservations"),import("./city-railway-store"),import("./permanent-task-sites"),import("./intercity-road-store"),import("../../shared/intercity-roads")]);
 const [layouts,bounds,ports,rails,historical,pads,roadSnapshot]=await Promise.all([
  readActiveBlockLayouts(db,missing),db.prepare("SELECT city_id,bounds_json FROM city_layouts_v1 WHERE country_id=? AND status='ACTIVE'").all<{city_id:string;bounds_json:Rect}>(countryId),
  countryPortReservations(db,countryId),countryRailwayReservations(db,countryId),permanentSiteBounds(db,countryId,true),countryAirportReservations(db,countryId),readCountryRoads(db,countryId)]);
 for(const layout of layouts){
  const sites=await readCityAirportSites(db,layout,[...ports,...rails,...historical,...pads,...bounds.filter(row=>row.city_id!==layout.cityId).map(row=>row.bounds_json)],intercityRoadCorridors(roadSnapshot?.plan.routes??[]));
  result.set(layout.cityId,sites);for(const site of sites)pads.push(...airportSiteReservations(site.plan));
 }
 return result;
}

/** Exact country lock, no world regeneration or movement of existing parcels. */
export async function freezeMissingCountryAirports(db:Db,countryId:string):Promise<void>{
 const {transaction}=await import("../db");
 await transaction(db,async()=>{
  await db.prepare("SELECT id FROM countries WHERE id=? FOR UPDATE").get(countryId);
  const sites=await readCountryAirportSites(db,countryId);
  const layouts=await db.prepare("SELECT id,city_id FROM city_layouts_v1 WHERE country_id=? AND status='ACTIVE'").all<{id:string;city_id:string}>(countryId);
  for(const layout of layouts)for(const site of sites.get(layout.city_id)??[])await db.prepare(`INSERT INTO city_airport_sites_v1(layout_id,task_id,geometry_json) VALUES (?,?,?::jsonb) ON CONFLICT DO NOTHING`)
    .run(layout.id,site.taskId,site.plan?JSON.stringify(site.plan):null);
 });
}
