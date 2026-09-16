import type { Db } from "../db";
import type { CompiledBlockLayoutV1 } from "../../shared/block-world";
import { blockSlots } from "../../shared/block-templates";
import { BlockPlacementError } from "./block-layout-compiler";
import type { Cell, Rect, PlannedSiteDto } from "../../shared/contracts";
import { planCityRailway, type CityRailway } from "../../shared/city-railway";

export async function readCityRailway(db:Db,layout:CompiledBlockLayoutV1):Promise<CityRailway|undefined>{
  const row=await db.prepare("SELECT geometry_json FROM city_railway_corridors_v1 WHERE layout_id=?")
    .get<{geometry_json:CityRailway}>(layout.id);
  if(!row)return undefined;
  const placement=layout.placements.find(p=>p.taskId===row.geometry_json.stationId&&p.serviceRole==="RAILWAY");
  const line=placement?reconnectRailwayAccess(row.geometry_json,layout):row.geometry_json;
  return {...line,stage:placement?.constructionStage??line.stage,running:placement?.constructionStage===5};
}

/** A transferred station keeps its track and platform, but its entrance must
 * reach that platform from the new parcel. Vacant and historic parcels are
 * obstacles too, so later occupation cannot sever this reserved approach. */
function reconnectRailwayAccess(line:CityRailway,layout:CompiledBlockLayoutV1):CityRailway {
  const placement=layout.placements.find(p=>p.taskId===line.stationId&&p.serviceRole==="RAILWAY");
  if(!placement)return line;
  const station=blockSlots(layout.blocks.find(block=>block.id===placement.blockId)!).find(slot=>slot.key===placement.slotKey)!;
  const first=line.access[0];
  if(first&&station.accessPath.some(p=>p.x===first.x&&p.y===first.y))return line;
  const key=(p:Cell)=>`${p.x}:${p.y}`;
  const blocked=new Set(layout.blocks.flatMap(block=>blockSlots(block).flatMap(slot=>slot.footprint.map(key))));
  const start=station.accessPath.find(p=>!blocked.has(key(p)));
  if(!start)throw new BlockPlacementError("Нет свободного выхода от перенесённого вокзала");
  const target=key(line.platform),parents=new Map<string,Cell|undefined>([[key(start),undefined]]),queue=[start];
  const bounds={minX:Math.min(layout.bounds.minX,line.platform.x)-16,minY:Math.min(layout.bounds.minY,line.platform.y)-16,
    maxX:Math.max(layout.bounds.maxX,line.platform.x)+16,maxY:Math.max(layout.bounds.maxY,line.platform.y)+16};
  for(let head=0;head<queue.length&&head<50_000;head++){
    const point=queue[head]!;
    if(key(point)===target){
      const access:Cell[]=[];
      for(let cursor:Cell|undefined=point;cursor;cursor=parents.get(key(cursor)))access.push(cursor);
      return {...line,access:access.reverse()};
    }
    for(const [dx,dy] of [[0,1],[1,0],[-1,0],[0,-1]] as const){
      const next={x:point.x+dx,y:point.y+dy},id=key(next);
      if(next.x<bounds.minX||next.x>bounds.maxX||next.y<bounds.minY||next.y>bounds.maxY||blocked.has(id)||parents.has(id))continue;
      parents.set(id,point);queue.push(next);
    }
  }
  throw new BlockPlacementError("Новый участок вокзала не связан с существующим перроном");
}

/** Geometry import for a legacy layout is deterministic and read-only. The
 * next topology mutation freezes this old layout before allocating new land. */
export function railwayForLayout(layout:CompiledBlockLayoutV1,roads:readonly Rect[]=[],preserveEastCoast=false):CityRailway|undefined{
  if(!layout.placements.some(p=>p.serviceRole==="RAILWAY"))return undefined;
  const slots=new Map(layout.blocks.flatMap(block=>blockSlots(block).map(slot=>[`${block.id}:${slot.key}`,slot] as const)));
  const occupied=new Set(layout.placements.map(p=>`${p.blockId}:${p.slotKey}`));
  const tasks=layout.placements.map(placement=>{
    const slot=slots.get(`${placement.blockId}:${placement.slotKey}`)!;
    return {id:placement.taskId,serviceRole:placement.serviceRole,footprint:slot.footprint,accessPath:slot.accessPath,
      stage:placement.constructionStage,status:placement.constructionStage===5?"COMPLETED" as const:"IN_PROGRESS" as const};
  });
  const sites:PlannedSiteDto[]=[...slots].filter(([key])=>!occupied.has(key)).map(([id,slot])=>({
    id,kind:"BUILDING",origin:{x:slot.footprintBounds.minX,y:slot.footprintBounds.minY},
    width:slot.footprintBounds.maxX-slot.footprintBounds.minX+1,height:slot.footprintBounds.maxY-slot.footprintBounds.minY+1,
  }));
  const near=roads.filter(rect=>rect.minX<=layout.bounds.maxX+256&&rect.maxX>=layout.bounds.minX-256
    &&rect.minY<=layout.bounds.maxY+256&&rect.maxY>=layout.bounds.minY-256);
  return planCityRailway(layout.bounds,tasks,sites,near,preserveEastCoast);
}

/** Caller holds the country/topology lock. A conflict keeps the first geometry;
 * a task stage change never updates coordinates or reruns the search. */
export async function freezeCityRailway(db:Db,layout:CompiledBlockLayoutV1,roads:readonly Rect[]=[]):Promise<CityRailway|undefined>{
  const stored=await readCityRailway(db,layout);
  if(stored){
    // Persist the new approach inside the same topology transaction. Keep all
    // other corridor geometry, and avoid writes on ordinary stage/readiness changes.
    await db.prepare(`UPDATE city_railway_corridors_v1 SET geometry_json=jsonb_set(geometry_json,'{access}',?::jsonb)
      WHERE layout_id=? AND geometry_json->'access' IS DISTINCT FROM ?::jsonb`)
      .run(JSON.stringify(stored.access),layout.id,JSON.stringify(stored.access));
    return stored;
  }
  // Only first placement chooses a landward corridor. Stored tracks above are
  // immutable; the new coastal profile must not cut off every future pier.
  if(!layout.placements.some(p=>p.serviceRole==="RAILWAY"))return undefined;
  const country=await db.prepare("SELECT terrain_profile_json FROM countries WHERE id=?").get<{terrain_profile_json:{kind?:string}|null}>(layout.countryId);
  const planned=railwayForLayout(layout,roads,country?.terrain_profile_json?.kind==="EAST_COAST");if(!planned)return undefined;
  await db.prepare(`INSERT INTO city_railway_corridors_v1(layout_id,geometry_json) VALUES (?,?::jsonb)
    ON CONFLICT(layout_id) DO NOTHING`).run(layout.id,JSON.stringify(planned));
  return readCityRailway(db,layout);
}

export function cityRailwayReservations(line:CityRailway|undefined):Rect[]{
  if(!line)return [];
  const track=line.axis==="horizontal"
    ? {minX:line.from.x,maxX:line.to.x,minY:line.from.y-2,maxY:line.from.y+3}
    : {minX:line.from.x-2,maxX:line.from.x+3,minY:line.from.y,maxY:line.to.y};
  return [track,...line.access.map(p=>({minX:p.x-1,maxX:p.x+1,minY:p.y-1,maxY:p.y+1}))];
}

export async function countryRailwayReservations(db:Db,countryId:string,excludeLayoutId?:string):Promise<Rect[]>{
  const rows=await db.prepare(`SELECT r.geometry_json FROM city_railway_corridors_v1 r
    JOIN city_layouts_v1 l ON l.id=r.layout_id WHERE l.country_id=? AND l.status='ACTIVE' AND (?::text IS NULL OR l.id<>?)`)
    .all<{geometry_json:CityRailway}>(countryId,excludeLayoutId??null,excludeLayoutId??null);
  return rows.flatMap(row=>cityRailwayReservations(row.geometry_json));
}
