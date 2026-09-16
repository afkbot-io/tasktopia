import type { Db } from "./db";
import { transportEndpointFromPlacementRow } from "./world/city-airport-connections";
import { selectMiniatureBuildings, miniatureRepresentative, CITY_MINIATURE_TRANSPORT_LIMIT } from "../shared/city-miniature";
import type { CountryCityMiniature } from "../shared/country-overview-contract";

/** Only cartographic block metadata, never full layouts, cells or task text.
 * Membership, building stages and transport are read in one SQL/MVCC snapshot. */
export async function readPlanetMiniatures(db: Db, userId: string) {
  const rows = await db.prepare(`SELECT city.id AS city_id, b.id, dl.district_id,
      b.origin_x+b.width/2.0 AS x, b.origin_y+b.height/2.0 AS y, placed.placements,
      CASE WHEN EXISTS(SELECT 1 FROM task_placements_v1 tp WHERE tp.layout_id=l.id AND tp.block_id=b.id
        AND b.parameters_json->'slotRoles'->>tp.slot_key IN ('AIRPORT','RAILWAY','PORT')) THEN to_jsonb(b) END AS transport_block
    FROM cities_v3 city JOIN country_members member ON member.country_id=city.country_id AND member.user_id=?
    JOIN city_layouts_v1 l ON l.city_id=city.id AND l.country_id=city.country_id AND l.status='ACTIVE'
    JOIN city_blocks_v1 b ON b.layout_id=l.id
    JOIN district_layouts_v1 dl ON dl.id=b.district_layout_id AND dl.layout_id=l.id
    JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('buildingFamily',p.building_family,'slotKey',p.slot_key,'constructionStage',p.construction_stage,'taskId',p.task_id,'role',b.parameters_json->'slotRoles'->>p.slot_key) ORDER BY p.slot_key) AS placements FROM task_placements_v1 p
      WHERE p.layout_id=l.id AND p.block_id=b.id) placed ON placed.placements IS NOT NULL
    ORDER BY city.id,b.id`).all<{city_id:string;id:string;district_id:string;x:number;y:number;placements:Array<{buildingFamily:string;slotKey:string;constructionStage:number;taskId:string;role:string|null}>|string;transport_block:Record<string,unknown>|string|null}>(userId);
  const cities=new Map<string,CountryCityMiniature["blocks"]>();
  const markers=new Map<string,CountryCityMiniature["blocks"]>();
  for(const row of rows) {
    const blocks=cities.get(row.city_id)??[];
    const placements=typeof row.placements === "string" ? JSON.parse(row.placements) as Exclude<typeof row.placements,string> : row.placements;
    const placement=miniatureRepresentative(placements);
    if(placement) blocks.push({id:row.id,districtId:row.district_id,x:Number(row.x),y:Number(row.y),family:placement.buildingFamily,stage:placement.constructionStage});
    cities.set(row.city_id,blocks);
    const block=typeof row.transport_block === "string" ? JSON.parse(row.transport_block) as Record<string,unknown> : row.transport_block;
    if(!block) continue;
    const group=markers.get(row.city_id)??[];
    for(const transport of placements) {
      if(transport.role!=="AIRPORT" && transport.role!=="RAILWAY" && transport.role!=="PORT") continue;
      const point=transportEndpointFromPlacementRow({...block,task_id:transport.taskId,slot_key:transport.slotKey,airport_city_id:row.city_id},transport.role).point;
      group.push({id:transport.taskId,districtId:row.district_id,x:point.x,y:point.y,family:transport.buildingFamily,stage:transport.constructionStage});
    }
    markers.set(row.city_id,group);
  }
  return new Map([...cities].map(([id,blocks])=>[id,[...selectMiniatureBuildings(blocks),
    ...(markers.get(id)??[]).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,CITY_MINIATURE_TRANSPORT_LIMIT)]]));
}
