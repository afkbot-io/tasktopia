import { createHash } from "node:crypto";
import type { Db } from "../db";
import type { Cell } from "../../shared/contracts";
import type { ProjectedPlanetAtlas } from "../../shared/planet-atlas";
import { buildPlanetRailways } from "../../shared/planet-surface-transport";
import { buildPlanetSeaRoutes } from "../../shared/planet-port-transport";
import { buildPlanetAirRoutes } from '../../shared/planet-air-transport';
import type { PlanetAirRouteDto,PlanetRailRouteDto,PlanetSeaRouteDto } from "../../shared/planet-atlas-contract";
export type PersonalTransportRenderSnapshot={schemaVersion:2;air:PlanetAirRouteDto[];rails:PlanetRailRouteDto[];ships:PlanetSeaRouteDto[]};
type Navigation={blocked:ReadonlySet<string>;coastOwners:Readonly<Record<string,readonly string[]>>};

/** Geometry survives unrelated task progress and valid network growth. Only
 * currently authorized candidate routes may reuse a stored path. A revoked
 * endpoint can never reappear through the cache. This is a derived read model,
 * like country_overview_snapshots, and does not create infrastructure/tasks. */
export async function readPersonalTransportRenderSnapshot(db:Db,userId:string,sector:number,atlas:ProjectedPlanetAtlas,navigation:Navigation):Promise<PersonalTransportRenderSnapshot>{
 const sourceHash=createHash("sha256").update(JSON.stringify({version:2,radius:atlas.hexRadius,ocean:atlas.oceanCells,
  countries:atlas.countries.map(country=>({id:country.id,networks:country.transportNetworks,cells:country.cells,
   anchors:country.cityAnchors,cities:country.cities.map(city=>({id:city.id,center:city.center,airports:city.airports,stations:city.stations,ports:city.ports}))})),
  coast:atlas.coastCells,blocked:[...navigation.blocked].sort(),owners:navigation.coastOwners})).digest("hex");
 const saved=await db.prepare("SELECT source_hash,payload_json FROM personal_transport_render_snapshots_v1 WHERE user_id=? AND sector=?")
  .get<{source_hash:string;payload_json:PersonalTransportRenderSnapshot}>(userId,sector);
 if(saved?.source_hash===sourceHash)return saved.payload_json;
 const previous=saved?.payload_json;
 const land=new Set([...atlas.countries.flatMap(country=>country.cells),...atlas.coastCells].filter(cell=>cell.terrain!=="river").map(cell=>`${cell.q},${cell.r}`));
 const ocean=new Set(atlas.oceanCells.filter(cell=>!navigation.blocked.has(`${cell.q},${cell.r}`)).map(cell=>`${cell.q},${cell.r}`));
 const cell=(point:Cell)=>({x:Math.floor(point.x/(2*atlas.hexRadius)),y:Math.floor(point.y/(2*atlas.hexRadius))});
 const dry=(point:Cell)=>{const p=cell(point);return land.has(`${p.x},${p.y}`);};
 const wet=(point:Cell)=>{const p=cell(point);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!ocean.has(`${p.x+dx},${p.y+dy}`))return false;return true;};
 function retain<T extends {id:string;points:Cell[]}>(fresh:T[],old:readonly T[]|undefined,allowed:(point:Cell)=>boolean):T[]{
  const byId=new Map(old?.map(route=>[route.id,route]));
  const same=(a:Cell|undefined,b:Cell|undefined)=>a&&b&&Math.abs(a.x-b.x)<1e-8&&Math.abs(a.y-b.y)<1e-8;
  return fresh.map(route=>{const before=byId.get(route.id);return before&&same(before.points[0],route.points[0])&&same(before.points.at(-1),route.points.at(-1))&&before.points.every(allowed)?{...route,points:before.points}:route;});
 }
 const rails=retain(buildPlanetRailways(atlas,previous?.rails),previous?.rails,dry);
 const ships=retain(buildPlanetSeaRoutes(atlas,navigation,previous?.ships),previous?.ships,wet);
 const air=buildPlanetAirRoutes(atlas,previous?.air);
 const result:PersonalTransportRenderSnapshot={schemaVersion:2,air,rails,ships};
 // readPlanetAtlas holds the viewer lock through its enclosing snapshot. The
 // source includes authorized countries, so permission changes invalidate it.
 await db.prepare(`INSERT INTO personal_transport_render_snapshots_v1(user_id,sector,source_hash,payload_json) VALUES (?,?,?,?::jsonb)
   ON CONFLICT(user_id,sector) DO UPDATE SET source_hash=excluded.source_hash,payload_json=excluded.payload_json,updated_at=transaction_timestamp()`)
  .run(userId,sector,sourceHash,JSON.stringify(result));
 return result;
}
