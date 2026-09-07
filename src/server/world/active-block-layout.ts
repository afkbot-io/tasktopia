import type { BlockServiceRole, CompiledBlockLayoutV1, ConstructionStage } from "../../shared/block-world";
import { blockSlots } from "../../shared/block-templates";
import { isTaskParkVariant, selectTaskParkVariant, taskParkSize } from "../../shared/task-park-catalog";
import { TASK_STAGE, type Rect, type TaskStatus } from "../../shared/contracts";
import { compileBlockLayout, type BlockLayoutCompilerInput } from "./block-layout-compiler";
import { persistReadyBlockLayout, activateBlockLayout } from "./block-layout-store";
import { now, transaction, type Db } from "../db";
import { isBuildableTerrain, terrainAt } from "../../shared/world-terrain";
import { freezePermanentSiteGeometry, permanentSiteBounds } from "./permanent-task-sites";
import { readCountryRoads, synchronizeCountryRoads } from "./intercity-road-store";
import { intercityRoadCorridors } from "../../shared/intercity-roads";

type Row = Record<string, unknown>;
export class CitySceneCapacityError extends Error {}
const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;

/** Read semantic rows once per city revision; raster cells are never persisted. */
export async function readActiveBlockLayout(db: Db, cityId: string): Promise<CompiledBlockLayoutV1 | undefined> {
  return (await readActiveBlockLayouts(db,[cityId]))[0];
}

/** COUNTRY projects all requested semantic layouts in one SQL/MVCC snapshot. */
export async function readActiveBlockLayouts(db: Db, cityIds: readonly string[]): Promise<CompiledBlockLayoutV1[]> {
  if (cityIds.length === 0) return [];
  // One statement gives all child rows the same MVCC snapshot, including a
  // concurrent placement/road update committed by another application replica.
  const rows = await db.prepare(`SELECT l.*,
    (SELECT COALESCE(jsonb_agg(d ORDER BY sequence),'[]') FROM district_layouts_v1 d WHERE d.layout_id=l.id) AS districts,
    (SELECT COALESCE(jsonb_agg(b ORDER BY sequence,id),'[]') FROM city_blocks_v1 b WHERE b.layout_id=l.id) AS blocks,
    (SELECT COALESCE(jsonb_agg(p ORDER BY task_id),'[]') FROM task_placements_v1 p WHERE p.layout_id=l.id) AS placements,
    (SELECT COALESCE(jsonb_agg(m ORDER BY id),'[]') FROM site_markers_v1 m WHERE m.layout_id=l.id) AS markers,
    (SELECT to_jsonb(r) FROM road_networks_v1 r WHERE r.layout_id=l.id) AS road
    FROM city_layouts_v1 l WHERE city_id=ANY(?::text[]) AND status='ACTIVE' ORDER BY city_id`).all<Row>(cityIds);
  return rows.map(activeBlockLayoutFromRow);
}

function activeBlockLayoutFromRow(row: Row): CompiledBlockLayoutV1 {
  const cityId = String(row.city_id);
  const id = String(row.id);
  const districts=parse<Row[]>(row.districts),blocks=parse<Row[]>(row.blocks),placements=parse<Row[]>(row.placements),markers=parse<Row[]>(row.markers);
  const road=parse<Row|undefined>(row.road);
  const rolesByBlock = new Map(blocks.map((block) => [String(block.id), parse<{ slotRoles?: Record<string, BlockServiceRole> }>(block.parameters_json).slotRoles ?? {}]));
  if (!road) throw new Error(`Active city layout ${id} has no road network`);
  return {
    id, countryId: String(row.country_id), cityId, generatorVersion: "block-v1",
    seed: Number(row.seed), revision: Number(row.revision), status: "READY",
    bounds: parse(row.bounds_json), checksum: String(row.checksum),
    districtLayouts: districts.map((d) => ({ id: String(d.id), districtId: String(d.district_id), sequence: Number(d.sequence), archetype: String(d.archetype), bounds: parse(d.bounds_json) })),
    blocks: blocks.map((b) => ({
      id: String(b.id), districtLayoutId: String(b.district_layout_id), sequence: Number(b.sequence),
      kind: String(b.kind) as CompiledBlockLayoutV1["blocks"][number]["kind"], templateKey: String(b.template_key),
      templateVersion: Number(b.template_version), variant: String(b.variant), seed: Number(b.seed),
      origin: { x: Number(b.origin_x), y: Number(b.origin_y) }, width: Number(b.width), height: Number(b.height),
      parameters: parse(b.parameters_json), summary: parse(b.summary_json),
    })),
    placements: placements.map((p) => {
      const serviceRole = rolesByBlock.get(String(p.block_id))?.[String(p.slot_key)];
      return { taskId: String(p.task_id), blockId: String(p.block_id), slotKey: String(p.slot_key), buildingFamily: String(p.building_family),
        facadeVariant: String(p.facade_variant), constructionStage: Number(p.construction_stage) as 1 | 2 | 3 | 4 | 5,
        ...(serviceRole ? { serviceRole } : {}) };
    }),
    siteMarkers: markers.map((m) => ({ id: String(m.id), blockId: String(m.block_id), slotKey: String(m.slot_key), kind: String(m.kind) as "RUINED" | "RELOCATED", targetTaskId: m.target_task_id ? String(m.target_task_id) : undefined, snapshot: parse(m.snapshot_json), assetVariant: String(m.asset_variant) })),
    roadNetwork: { id: String(road.id), checksum: String(road.checksum), schemaVersion: 1, nodes: parse(road.nodes_json), segments: parse(road.segments_json) },
  };
}

/** Update only changed semantic rows; empty slots stay in the template. */
async function saveActiveDelta(db: Db, previous: CompiledBlockLayoutV1, layout: CompiledBlockLayoutV1, timestamp: string): Promise<void> {
  const oldDistricts = new Map(previous.districtLayouts.map((value) => [value.id, value]));
  const oldBlocks = new Map(previous.blocks.map((value) => [value.id, value]));
  const oldPlacements = new Map(previous.placements.map((value) => [value.taskId, value]));
  for (const d of layout.districtLayouts) {
    if (JSON.stringify(oldDistricts.get(d.id)) === JSON.stringify(d)) continue;
    await db.prepare(`INSERT INTO district_layouts_v1 (id,layout_id,district_id,sequence,archetype,bounds_json,created_at)
      VALUES (?,?,?,?,?,?::jsonb,?) ON CONFLICT(id) DO UPDATE SET bounds_json=excluded.bounds_json,archetype=excluded.archetype`)
      .run(d.id, layout.id, d.districtId, d.sequence, d.archetype, JSON.stringify(d.bounds), timestamp);
  }
  for (const b of layout.blocks) {
    if (JSON.stringify(oldBlocks.get(b.id)) === JSON.stringify(b)) continue;
    await db.prepare(`INSERT INTO city_blocks_v1 (id,layout_id,district_layout_id,sequence,kind,template_key,template_version,variant,seed,origin_x,origin_y,width,height,parameters_json,summary_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?) ON CONFLICT(id) DO UPDATE SET summary_json=excluded.summary_json,parameters_json=excluded.parameters_json`)
      .run(b.id,layout.id,b.districtLayoutId,b.sequence,b.kind,b.templateKey,b.templateVersion,b.variant,b.seed,b.origin.x,b.origin.y,b.width,b.height,JSON.stringify(b.parameters),JSON.stringify(b.summary),timestamp);
  }
  for (const p of layout.placements) {
    if (JSON.stringify(oldPlacements.get(p.taskId)) === JSON.stringify(p)) continue;
    await db.prepare(`INSERT INTO task_placements_v1 (task_id,layout_id,block_id,slot_key,building_family,facade_variant,construction_stage,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(layout_id,task_id) DO UPDATE SET block_id=excluded.block_id,slot_key=excluded.slot_key,building_family=excluded.building_family,construction_stage=excluded.construction_stage,updated_at=excluded.updated_at`)
      .run(p.taskId,layout.id,p.blockId,p.slotKey,p.buildingFamily,p.facadeVariant,p.constructionStage,timestamp,timestamp);
  }
  if (previous.roadNetwork.checksum !== layout.roadNetwork.checksum) {
    await db.prepare("UPDATE road_networks_v1 SET nodes_json=?::jsonb,segments_json=?::jsonb,checksum=? WHERE layout_id=?")
      .run(JSON.stringify(layout.roadNetwork.nodes),JSON.stringify(layout.roadNetwork.segments),layout.roadNetwork.checksum,layout.id);
  }
  await db.prepare("UPDATE city_layouts_v1 SET revision=?,bounds_json=?::jsonb,checksum=?,updated_at=? WHERE id=? AND status='ACTIVE'")
    .run(layout.revision,JSON.stringify(layout.bounds),layout.checksum,timestamp,layout.id);
}

export async function synchronizeCityBlocks(db: Db, countryId: string, cityId: string, reset = false): Promise<CompiledBlockLayoutV1> {
  return transaction(db, async () => {
    // Match the application mutation lock order even for direct CLI/test calls.
    await db.prepare("SELECT id FROM countries WHERE id=? FOR UPDATE").get(countryId);
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`block-city:${cityId}`);
    const city = await db.prepare("SELECT c.*,country.seed FROM cities_v3 c JOIN countries country ON country.id=c.country_id WHERE c.id=? AND c.country_id=?").get<Row>(cityId,countryId);
    if (!city) throw new Error("Unknown city for block layout");
    const old = await readActiveBlockLayout(db,cityId);
    await freezePermanentSiteGeometry(db,countryId);
    const historicalBounds = await permanentSiteBounds(db,countryId,true);
    const otherCities = await db.prepare("SELECT bounds_json FROM city_layouts_v1 WHERE country_id=? AND city_id<>? AND status='ACTIVE'").all<Row>(countryId,cityId);
    const otherBounds = otherCities.map(row=>parse<Rect>(row.bounds_json));
    const roadCorridors = intercityRoadCorridors((await readCountryRoads(db, countryId))?.plan.routes ?? []);
    // A rebuild cannot erase occupied historical parcels. Their block/street
    // topology remains fixed; only disposable projections are regenerated.
    const previous = reset && !old?.siteMarkers.length ? undefined : old;
    const districts = await db.prepare("SELECT id,archetype,created_at FROM districts_v3 WHERE city_id=? ORDER BY created_at,id").all<Row>(cityId);
    const tasks = await db.prepare("SELECT id,district_id,task_number,status,visual_kind,visual_asset_key,visual_auto,building_type,requested_building_family,service_role,service_trigger,service_role_assigned FROM tasks_v3 WHERE city_id=? ORDER BY task_number,id").all<Row>(cityId);
    const existingSequence = new Map(previous?.districtLayouts.map((d) => [d.districtId,d.sequence]));
    const byDistrict = new Map<string, Row[]>();
    for (const task of tasks) {
      const id = String(task.district_id);
      const group = byDistrict.get(id) ?? [];
      group.push(task); byDistrict.set(id, group);
    }
    const terrain = new Map<string, boolean>();
    let nextSequence = Math.max(-1,...existingSequence.values()) + 1;
    const input: BlockLayoutCompilerInput = {
      countryId,cityId,seed:Number(city.seed),revision:(old?.revision ?? 0)+1,
      origin:{x:Number(city.center_x),y:Number(city.center_y)},previous,
      canPlaceBlock: (bounds) => {
        if ([...otherBounds,...historicalBounds].some(other=>blockBoundsIntersect(bounds,other))) return false;
        // Compiler envelopes include two clearance cells. The block interior
        // starts three cells inside its perimeter, hence envelope +5. An old
        // road may become a shared perimeter; it may never become a parcel.
        const interior = { minX: bounds.minX + 5, minY: bounds.minY + 5, maxX: bounds.maxX - 5, maxY: bounds.maxY - 5 };
        if (interior.minX <= interior.maxX && interior.minY <= interior.maxY
          && roadCorridors.some(road => blockBoundsIntersect(interior, road))) return false;
        for (let y=bounds.minY;y<=bounds.maxY;y++) for(let x=bounds.minX;x<=bounds.maxX;x++) {
          const key = `${x},${y}`;
          let dry = terrain.get(key);
          if (dry === undefined) { dry = isBuildableTerrain(terrainAt(Number(city.seed),x,y).terrain); terrain.set(key,dry); }
          if (!dry) return false;
        }
        return true;
      },
      districts:districts.map((d) => ({id:String(d.id),archetype:String(d.archetype),sequence:existingSequence.get(String(d.id)) ?? nextSequence++,
        tasks:(byDistrict.get(String(d.id)) ?? []).map((t) => ({
          id:String(t.id),taskNumber:Number(t.task_number),buildingFamily:String(t.building_type),facadeVariant:"south",autoVisualKind:Boolean(t.visual_auto),
          requestedFamily:t.requested_building_family ? String(t.requested_building_family) : undefined,
          serviceRole: t.service_role ? String(t.service_role) as BlockServiceRole : undefined,
          serviceTrigger: t.service_trigger ? String(t.service_trigger) : undefined,
          serviceRoleAssigned: Boolean(t.service_role_assigned),
          constructionStage:TASK_STAGE[String(t.status) as TaskStatus] as ConstructionStage,
          parkSize: t.visual_kind === "PARK" ? taskParkSize(String(t.visual_asset_key)) : undefined,
          visualKind: t.visual_kind === "PARK" ? (t.visual_asset_key === "urban-lake" ? "WATER" : t.visual_asset_key === "urban-parking" ? "PARKING" : "PARK") : "BUILDING",
        })),
      })),
    };
    const layout = compileBlockLayout(input);
    const chunkColumns=Math.floor(layout.bounds.maxX/64)-Math.floor(layout.bounds.minX/64)+1;
    const chunkRows=Math.floor(layout.bounds.maxY/64)-Math.floor(layout.bounds.minY/64)+1;
    if(chunkColumns*chunkRows>256) throw new CitySceneCapacityError("City scene capacity exceeded; create a new city before adding another block");
    // Breaking regeneration replaces only derived geometry inside this same
    // transaction. Product/task rows and their dependent records are untouched.
    if (reset && !previous) await db.prepare("DELETE FROM city_layouts_v1 WHERE city_id=?").run(cityId);
    if (previous) await saveActiveDelta(db,previous,layout,now());
    else { await persistReadyBlockLayout(db,layout,now()); await activateBlockLayout(db,layout.id,now()); }
    await db.prepare(`UPDATE tasks_v3 t SET service_role=b.parameters_json->'slotRoles'->>p.slot_key,
      service_trigger=b.parameters_json->'slotRoleTriggers'->>p.slot_key,service_role_assigned=true
      FROM task_placements_v1 p JOIN city_blocks_v1 b ON b.id=p.block_id WHERE p.layout_id=? AND t.id=p.task_id
      AND NOT t.service_role_assigned`).run(layout.id);
    // The slot determines the authored family. Update only actual changes,
    // preserving user task fields and avoiding an O(tasks) write loop.
    await db.prepare(`UPDATE tasks_v3 t SET building_type=p.building_family,
      visual_asset_key=CASE WHEN t.visual_kind='BUILDING' THEN p.building_family ELSE t.visual_asset_key END
      FROM task_placements_v1 p WHERE p.layout_id=? AND p.task_id=t.id
      AND (t.building_type IS DISTINCT FROM p.building_family OR
        (t.visual_kind='BUILDING' AND t.visual_asset_key IS DISTINCT FROM p.building_family))`).run(layout.id);
    const slots = blockTaskGeometry(layout);
    const byId = new Map(tasks.map(task=>[String(task.id),task]));
    for (const placement of layout.placements) {
      const task = byId.get(placement.taskId)!;
      const slot = slots.get(placement.taskId)!;
      if (!task.visual_auto) continue;
      const kind = slot.kind === 'BUILDING' ? 'BUILDING' : 'PARK';
      const existingPark = task.visual_kind === 'PARK' && isTaskParkVariant(String(task.visual_asset_key)) ? String(task.visual_asset_key) : undefined;
      const asset = kind === 'BUILDING' ? placement.buildingFamily : slot.kind === 'WATER' ? 'urban-lake' : slot.kind === 'PARKING' ? 'urban-parking'
        : existingPark ?? selectTaskParkVariant(Number(task.task_number) ^ Number(city.seed),
          slot.footprintBounds.maxX-slot.footprintBounds.minX+1, slot.footprintBounds.maxY-slot.footprintBounds.minY+1);
      if (task.visual_kind !== kind || task.visual_asset_key !== asset) await db.prepare(
        "UPDATE tasks_v3 SET visual_kind=?,visual_asset_key=?,platform_type=? WHERE id=?"
      ).run(kind,asset,kind==='BUILDING'?'STONE':'PARK',placement.taskId);
    }
    await db.prepare("UPDATE cities_v3 SET bounds_json=?::jsonb WHERE id=?").run(JSON.stringify(layout.bounds),cityId);
    for (const d of layout.districtLayouts) {
      await db.prepare("UPDATE districts_v3 SET spatial_bounds_json=?::jsonb WHERE id=?").run(JSON.stringify(d.bounds),d.districtId);
    }
    // A country-wide rebuild refreshes once after all cities. Normal task stage
    // updates do not pay for country routing or rewrite its snapshot.
    if (!reset && (!old || old.roadNetwork.checksum !== layout.roadNetwork.checksum)) await synchronizeCountryRoads(db, countryId);
    return layout;
  });
}

export function blockTaskGeometry(layout: CompiledBlockLayoutV1): Map<string, ReturnType<typeof blockSlots>[number]> {
  const slots = new Map(layout.blocks.flatMap((block) => blockSlots(block).map((slot) => [`${block.id}:${slot.key}`,slot] as const)));
  return new Map(layout.placements.map((placement) => {
    const slot = slots.get(`${placement.blockId}:${placement.slotKey}`);
    if (!slot) throw new Error(`Invalid active block slot: ${placement.taskId}`);
    return [placement.taskId,slot];
  }));
}

export const blockBoundsIntersect = (a: Rect,b: Rect): boolean => a.minX<=b.maxX && a.maxX>=b.minX && a.minY<=b.maxY && a.maxY>=b.minY;
