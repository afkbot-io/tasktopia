import type { Db } from '../db';
import { transaction } from '../db';
import type { CompiledBlockLayoutV1 } from '../../shared/block-world';
import type { Rect, WorldFeatureDto } from '../../shared/contracts';
import { canonicalTransitStopPublicWalkway, cityTransitStopReservations, readCityTransitStopPlan as parseCityTransitStopPlan,
  type CityTransitStopPlan } from '../../shared/city-transit-stops';
import { isBuildableTerrain, terrainAt } from '../../shared/world-terrain';
import { parseWorldTerrainProfile } from '../../shared/world-terrain-profile';
import { intercityRoadCorridors, intercityRoadRasterNetwork } from '../../shared/intercity-roads';
import { countryAirportReservations } from './city-airport-site-store';
import { countryRailwayReservations } from './city-railway-store';
import { countryPortReservations } from './port-reservations';
import { permanentSiteBounds } from './permanent-task-sites';
import { readCountryRoads } from './intercity-road-store';
import { prepareCityTransitStops } from './city-transit-stop-planner';

/** Absence is legacy compatibility, whereas an empty stored plan is ready.
 * This read never invokes terrain/planning or writes infrastructure. */
export async function readCityTransitStopPlan(db: Db, countryId: string, layoutId: string): Promise<CityTransitStopPlan | undefined> {
  const row = await db.prepare(`SELECT s.plan_json FROM city_transit_stop_plans_v1 s
    JOIN city_layouts_v1 l ON l.id=s.layout_id WHERE s.layout_id=? AND l.country_id=? AND l.status='ACTIVE'`)
    .get<{ plan_json: unknown }>(layoutId,countryId);
  return row ? parseCityTransitStopPlan(row.plan_json,layoutId) : undefined;
}

/** Only trusted topology commands call this under the country lock. SQL also
 * enforces the immutable prefix against another/future writer. */
export async function saveCityTransitStopPlan(db: Db, countryId: string, value: CityTransitStopPlan): Promise<void> {
  const plan = parseCityTransitStopPlan(value,value.layoutId);
  const owner = await db.prepare(`SELECT id FROM city_layouts_v1 WHERE id=? AND country_id=? AND status='ACTIVE'`)
    .get(plan.layoutId,countryId);
  if (!owner) throw new RangeError('Transit plan does not belong to the active country layout');
  await db.prepare(`INSERT INTO city_transit_stop_plans_v1(layout_id,source_block_count,plan_json) VALUES (?,?,?::jsonb)
    ON CONFLICT(layout_id) DO UPDATE SET source_block_count=excluded.source_block_count,plan_json=excluded.plan_json,updated_at=now()
    WHERE city_transit_stop_plans_v1.plan_json IS DISTINCT FROM excluded.plan_json`)
    .run(plan.layoutId,plan.processedBlockIds.length,JSON.stringify(plan));
}

export async function countryTransitStopReservations(db: Db, countryId: string, purpose: 'PARCEL' | 'ROAD' = 'PARCEL', excludeLayoutId?: string): Promise<Rect[]> {
  return (await readCountryTransitStopPlans(db,countryId,excludeLayoutId)).flatMap(plan => cityTransitStopReservations(plan,purpose));
}
export async function readCountryTransitStopPlans(db: Db, countryId: string, excludeLayoutId?: string): Promise<CityTransitStopPlan[]> {
  const rows = await db.prepare(`SELECT s.layout_id,s.plan_json FROM city_transit_stop_plans_v1 s
    JOIN city_layouts_v1 l ON l.id=s.layout_id WHERE l.country_id=? AND l.status='ACTIVE'
    AND (?::text IS NULL OR s.layout_id<>?) ORDER BY s.layout_id`)
    .all<{ layout_id: string; plan_json: unknown }>(countryId,excludeLayoutId??null,excludeLayoutId??null);
  return rows.map(row => parseCityTransitStopPlan(row.plan_json,row.layout_id));
}

/** Preview is explicitly opt-in. Ordinary scene/viewport reads only read rows.
 * New plans exclude all future parcels, historical sites and transport pads. */
export async function previewCityTransitStops(db: Db, layout: CompiledBlockLayoutV1): Promise<CityTransitStopPlan> {
  const previous = await readCityTransitStopPlan(db,layout.countryId,layout.id);
  const processed = new Set(previous?.processedBlockIds);
  if (previous && layout.blocks.every(block => processed.has(block.id))) return previous;
  const country = await db.prepare('SELECT terrain_profile_json FROM countries WHERE id=?')
    .get<{ terrain_profile_json: unknown }>(layout.countryId);
  if (!country) throw new RangeError('Unknown transit country');
  const profile = parseWorldTerrainProfile(country.terrain_profile_json);
  const [airports,railways,ports,historical,others,stops,roads] = await Promise.all([
    countryAirportReservations(db,layout.countryId),countryRailwayReservations(db,layout.countryId),
    countryPortReservations(db,layout.countryId),permanentSiteBounds(db,layout.countryId,true),
    db.prepare(`SELECT bounds_json FROM city_layouts_v1 WHERE country_id=? AND city_id<>? AND status='ACTIVE'`)
      .all<{ bounds_json: Rect }>(layout.countryId,layout.cityId),
    countryTransitStopReservations(db,layout.countryId,'PARCEL',layout.id),readCountryRoads(db,layout.countryId),
  ]);
  return (await prepareCityTransitStops({ layout, previous,
    obstacles: [...airports,...railways,...ports,...historical,...others.map(row => row.bounds_json),...stops],
    extraRoads: intercityRoadRasterNetwork(roads?.plan.routes??[]),
    protectedRoads: intercityRoadCorridors(roads?.plan.routes??[]),
    isDry: p => isBuildableTerrain(terrainAt(layout.seed,p.x,p.y,profile).terrain),
  },{ yieldTask: () => new Promise(resolve => setImmediate(resolve)) })).plan;
}

export async function freezeCityTransitStops(db: Db, layout: CompiledBlockLayoutV1): Promise<CityTransitStopPlan> {
  return transaction(db,async () => {
    await db.prepare('SELECT id FROM countries WHERE id=? FOR UPDATE').get(layout.countryId);
    const plan = await previewCityTransitStops(db,layout);
    await saveCityTransitStopPlan(db,layout.countryId,plan);
    return plan;
  });
}

/** Called before any country topology mutation, and by the controlled upgrade
 * command. The indexed count avoids loading already-current large layouts. */
export async function freezeMissingCountryTransitStops(db: Db, countryId: string): Promise<number> {
  return transaction(db,async () => {
    await db.prepare('SELECT id FROM countries WHERE id=? FOR UPDATE').get(countryId);
    const missing = await db.prepare(`SELECT l.city_id FROM city_layouts_v1 l LEFT JOIN city_transit_stop_plans_v1 s ON s.layout_id=l.id
      WHERE l.country_id=? AND l.status='ACTIVE' AND (s.layout_id IS NULL OR s.source_block_count<
        (SELECT count(*) FROM city_blocks_v1 b WHERE b.layout_id=l.id)) ORDER BY l.city_id`).all<{ city_id: string }>(countryId);
    if (!missing.length) return 0;
    const { readActiveBlockLayouts } = await import('./active-block-layout');
    for (const layout of await readActiveBlockLayouts(db,missing.map(row => row.city_id))) await freezeCityTransitStops(db,layout);
    return missing.length;
  });
}

export function cityTransitStopFeatures(plan: CityTransitStopPlan, cityId: string): WorldFeatureDto[] {
  const facing = { N: 'W', E: 'N', S: 'E', W: 'S' } as const;
  return plan.stops.map(stop => ({ id: `${plan.layoutId}:${stop.id}`, cityId, districtId: null, parentFeatureId: null,
    kind: 'BUS_STOP', assetKind: 'PROP', assetKey: `bus-stop-${stop.heading==='E'||stop.heading==='W'?'horizontal':'vertical'}`,
    origin: { x: Math.min(...stop.shelter.map(p => p.x)), y: Math.min(...stop.shelter.map(p => p.y)) },
    footprint: stop.shelter.map(p => ({ ...p })), orientation: facing[stop.heading],
    accessPath: canonicalTransitStopPublicWalkway(stop).map(p => ({ ...p })), developmentStage: 5,
  }));
}

export async function readCityTransitStopFeatures(db: Db, countryId: string, bounds?: Rect, cityId?: string): Promise<WorldFeatureDto[]> {
  const rows = await db.prepare(`SELECT s.layout_id,s.plan_json,l.city_id FROM city_transit_stop_plans_v1 s
    JOIN city_layouts_v1 l ON l.id=s.layout_id WHERE l.country_id=? AND l.status='ACTIVE'
    AND (?::text IS NULL OR l.city_id=?)
    ${bounds ? "AND (l.bounds_json->>'minX')::integer-16<=? AND (l.bounds_json->>'maxX')::integer+16>=? AND (l.bounds_json->>'minY')::integer-16<=? AND (l.bounds_json->>'maxY')::integer+16>=?" : ''}
    ORDER BY l.city_id`).all<{ layout_id: string; plan_json: unknown; city_id: string }>(countryId,cityId??null,cityId??null,
      ...(bounds ? [bounds.maxX,bounds.minX,bounds.maxY,bounds.minY] : []));
  const features = rows.flatMap(row => cityTransitStopFeatures(parseCityTransitStopPlan(row.plan_json,row.layout_id),row.city_id));
  return bounds ? features.filter(feature => [...feature.footprint,...feature.accessPath].some(p =>
    p.x>=bounds.minX && p.x<=bounds.maxX && p.y>=bounds.minY && p.y<=bounds.maxY)) : features;
}
