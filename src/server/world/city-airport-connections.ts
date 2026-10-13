import { airportScheduleOffset,type TimetabledAirEdge } from "../../shared/transport-network";
import { countryAirNetwork } from "../../shared/air-network";
import { blockSlotAirportPoint } from "../../shared/airport-location";
import { blockSlots } from "../../shared/block-templates";
import type { CityBlockV1 } from "../../shared/block-world";
import { type CityAirportConnectionDto, type CityAirportEndpointDto } from "../../shared/city-scene-contract";
import type { Db, Row } from "../db";

const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;

/** The template owns the exact airport slot; the block or city center is not an endpoint. */
export function airportEndpointFromPlacementRow(row: Row): CityAirportEndpointDto {
  return transportEndpointFromPlacementRow(row, "AIRPORT");
}

export function transportEndpointFromPlacementRow(row: Row, role: "AIRPORT" | "RAILWAY" | "PORT"): CityAirportEndpointDto {
  const block: CityBlockV1 = {
    id: String(row.id), districtLayoutId: String(row.district_layout_id), sequence: Number(row.sequence),
    kind: String(row.kind) as CityBlockV1["kind"], templateKey: String(row.template_key), templateVersion: Number(row.template_version),
    variant: String(row.variant), seed: Number(row.seed), origin: { x: Number(row.origin_x), y: Number(row.origin_y) },
    width: Number(row.width), height: Number(row.height), parameters: parse(row.parameters_json), summary: parse(row.summary_json),
  };
  const slot = blockSlots(block).find(candidate => candidate.key === row.slot_key);
  if (!slot || slot.serviceRole !== role) throw new Error(`Invalid transport placement ${row.task_id}`);
  return { taskId: String(row.task_id), cityId: String(row.airport_city_id), point: blockSlotAirportPoint(slot) };
}

/** Bounded route selection over canonical airport points, independent of the viewport. */
export function connectCityAirports(cityId: string, endpoints: readonly CityAirportEndpointDto[], edges?: readonly import("../../shared/transport-network").TransportNetworkEdge[]): CityAirportConnectionDto[] {
  const pairs = countryAirNetwork(endpoints,edges).filter(({from,to})=>from.cityId===cityId||to.cityId===cityId);
  return pairs.flatMap(({ from, to }) => {
    const timing=edges?.find(edge=>edge.fromCityId===from.cityId&&edge.toCityId===to.cityId) as TimetabledAirEdge|undefined;
    const scheduleOffsetMs=timing&&Number.isFinite(timing.arrivalPhaseMs)?airportScheduleOffset(timing,from.taskId,to.taskId):undefined;
    return [
    { id: `${from.taskId}:${to.taskId}`, from, to,scheduleOffsetMs },
    { id: `${to.taskId}:${from.taskId}`, from: to, to: from,scheduleOffsetMs },
  ];}).sort((a, b) => a.id.localeCompare(b.id));
}

export async function readCityAirportConnections(db: Db, countryId: string, cityId: string): Promise<CityAirportConnectionDto[]> {
  const rows = await db.prepare(`SELECT DISTINCT ON (city.id) b.*, p.task_id, p.slot_key, t.city_id AS airport_city_id
    FROM cities_v3 city JOIN city_layouts_v1 l ON l.city_id=city.id AND l.status='ACTIVE'
    JOIN city_blocks_v1 b ON b.layout_id=l.id
    JOIN task_placements_v1 p ON p.layout_id=l.id AND p.block_id=b.id
    JOIN tasks_v3 t ON t.id=p.task_id AND t.city_id=city.id
    WHERE city.country_id=? AND l.country_id=? AND p.construction_stage=5 AND t.status='COMPLETED'
      AND b.parameters_json->'slotRoles'->>p.slot_key='AIRPORT'
    ORDER BY city.id,t.id`).all(countryId, countryId);
  const {readCountryAirportSites}=await import("./city-airport-site-store");
  const ready=new Set([...(await readCountryAirportSites(db,countryId)).values()].flatMap(sites=>sites.filter(site=>site.plan).map(site=>site.taskId)));
  const {readCountryTransportNetworks}=await import("./country-transport-network-store");
  return connectCityAirports(cityId, rows.filter(row=>ready.has(String(row.task_id))).map(airportEndpointFromPlacementRow),(await readCountryTransportNetworks(db,countryId)).AIR);
}
