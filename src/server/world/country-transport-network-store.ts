import { createHash } from "node:crypto";
import type { Db,Row } from "../db";
import { countryTransportNetwork, retainedTransportNetwork, railwayTimetable, airportTimetable, type TimetabledAirEdge, type TimetabledRailEdge } from "../../shared/transport-network";
import { transportEndpointFromPlacementRow } from "./city-airport-connections";
export type CountryTransportNetworks = {schemaVersion:1;AIR:TimetabledAirEdge[];RAIL:TimetabledRailEdge[]};
async function readyStops(db:Db,countryId:string){
  const rows=await db.prepare(`SELECT b.*,p.task_id,p.slot_key,t.city_id AS airport_city_id,
    b.parameters_json->'slotRoles'->>p.slot_key AS transport_role
    FROM cities_v3 c JOIN city_layouts_v1 l ON l.city_id=c.id AND l.country_id=c.country_id AND l.status='ACTIVE'
    JOIN city_blocks_v1 b ON b.layout_id=l.id JOIN task_placements_v1 p ON p.layout_id=l.id AND p.block_id=b.id
    JOIN tasks_v3 t ON t.id=p.task_id AND t.city_id=c.id
    LEFT JOIN city_airport_sites_v1 a ON a.layout_id=l.id AND a.task_id=p.task_id
    WHERE c.country_id=? AND t.status='COMPLETED' AND p.construction_stage=5
    AND (b.parameters_json->'slotRoles'->>p.slot_key<>'AIRPORT' OR a.task_id IS NULL OR a.geometry_json IS NOT NULL)
    AND b.parameters_json->'slotRoles'->>p.slot_key IN ('AIRPORT','RAILWAY') ORDER BY t.id`).all<Row>(countryId);
  return rows.map(row=>({role:row.transport_role,...transportEndpointFromPlacementRow(row,row.transport_role as "AIRPORT"|"RAILWAY")}));
}
export async function readCountryTransportNetworks(db:Db,countryId:string):Promise<CountryTransportNetworks>{
  const row=await db.prepare("SELECT network_json FROM country_transport_networks_v1 WHERE country_id=?").get<{network_json:CountryTransportNetworks}>(countryId);
  if(row)return {...row.network_json,AIR:airportTimetable(row.network_json.AIR,row.network_json.AIR),RAIL:railwayTimetable(row.network_json.RAIL,row.network_json.RAIL)};
  const stops=await readyStops(db,countryId);
  // Freeze historical UUID pairs without changing their currently published
  // identity. New countries use spatial selection after their first mutation.
  const legacy=(role:string)=>countryTransportNetwork(stops.filter(stop=>stop.role===role)).map(({from,to})=>({fromCityId:from.cityId,toCityId:to.cityId}));
  return {schemaVersion:1,AIR:airportTimetable(legacy("AIRPORT"),[]),RAIL:railwayTimetable(legacy("RAILWAY"),[])};
}
/** Caller holds the country mutation lock. `before` is captured before changing
 * readiness, so the first mutation of an old country preserves its old pairs. */
export async function synchronizeCountryTransportNetworks(db:Db,countryId:string,before:CountryTransportNetworks):Promise<boolean>{
  const stops=await readyStops(db,countryId);
  const AIR=airportTimetable(retainedTransportNetwork(stops.filter(stop=>stop.role==="AIRPORT"),before.AIR),before.AIR);
  const RAIL=railwayTimetable(retainedTransportNetwork(stops.filter(stop=>stop.role==="RAILWAY"),before.RAIL),before.RAIL);
  const network:CountryTransportNetworks={schemaVersion:1,AIR,RAIL},serialized=JSON.stringify(network);
  const revision=createHash("sha256").update(serialized).digest("hex").slice(0,16);
  const changed=await db.prepare(`INSERT INTO country_transport_networks_v1(country_id,network_json,revision) VALUES (?,?::jsonb,?)
    ON CONFLICT(country_id) DO UPDATE SET network_json=excluded.network_json,revision=excluded.revision,updated_at=transaction_timestamp()
    WHERE country_transport_networks_v1.revision IS DISTINCT FROM excluded.revision RETURNING country_id`).get(countryId,serialized,revision);
  return Boolean(changed);
}
