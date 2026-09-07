import { BUILDING_CATALOG } from "../../shared/catalog";
import { TASK_STAGE, type Cell, type RoadCellDto, type TaskStatus } from "../../shared/contracts";
import { BLOCK_WORLD_GENERATOR_VERSION, type BlockSlotKind, type BlockWorldBounds, type CompiledBlockLayoutV1 } from "../../shared/block-world";
import { BLOCK_MODULE_CELLS, blockSlots, type BlockSlot } from "../../shared/block-templates";
import { auditSemanticRoadNetwork } from "../../shared/semantic-road";
import { isBuildableTerrain, terrainAt } from "../../shared/world-terrain";
import type { AppService } from "../app-service";
import type { Db } from "../db";
import { readActiveBlockLayout } from "./active-block-layout";
import { rasterizeBlockRoads } from "./block-layout-compiler";
import { overlapsDistrictSeparator, readDistrictSeparators } from "../../shared/district-separator";
import { countryRoadTopologyHash, readCountryRoads } from "./intercity-road-store";
import { planIntercityRoads } from "./intercity-road-planner";
import { permanentSiteBounds } from "./permanent-task-sites";

export type WorldAuditViolation = { code: string; message: string };
export type WorldAuditMetrics = {
  cities: number; districts: number; tasks: number; blocks: number; roadSegments: number; plannedSlots: number;
  roads: number; bridges: number; roadClasses: Record<RoadCellDto["roadClass"], number>; taskStages: Record<string, number>;
  uniqueBuildingTypes: number; uniqueBuildingTypesPerCity: Record<string, number>;
  tasksPerCity: Record<string, number>; districtsPerCity: Record<string, number>; tasksPerDistrict: Record<string, number>;
  districtCellRange: { min: number; max: number }; maximumTaskRoadDistance: number; maximumEntranceAccessLength: number;
  surfaceCells: number; worldFeatures: number; greenAreas: number; parkDecor: number; greenAreasPerCity: Record<string, number>;
  serviceRolesPerCity: Record<string, string[]>; districtArchetypes: Record<string, number>; zoningCompliance: number;
  zoningPrimarySharePerDistrict: Record<string, number>; asphaltSharePerDistrict: Record<string, number>;
  maximumResidentialAsphaltShare: number; crosswalkCells: number; roadJunctionsPerCity: Record<string, number>;
};
export type WorldAuditResult = { metrics: WorldAuditMetrics; violations: WorldAuditViolation[] };
export type BlockAuditTask = { id: string; districtId: string; constructionStage: number; kind: BlockSlotKind; buildingFamily: string };

const key = (point: Cell) => `${point.x}:${point.y}`;
const inside = (bounds: BlockWorldBounds, point: Cell) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
const neighbors = (p: Cell) => [{ x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }];
const distance = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const taskKind = (visual: string, asset: string | null): BlockSlotKind => visual !== "PARK" ? "BUILDING"
  : asset === "urban-lake" ? "WATER" : asset === "urban-parking" ? "PARKING" : "PARK";

/** Validate the semantic layout directly, independent of cache rows or screenshots. */
export function auditBlockLayout(layout: CompiledBlockLayoutV1, tasks?: readonly BlockAuditTask[], canBuild?: (point: Cell) => boolean): WorldAuditViolation[] {
  const violations: WorldAuditViolation[] = [];
  const fail = (code: string, message: string) => violations.push({ code, message });
  if (layout.generatorVersion !== BLOCK_WORLD_GENERATOR_VERSION) fail("WORLD_REGENERATION_REQUIRED", `${layout.cityId}: unsupported layout generator`);
  try { auditSemanticRoadNetwork(layout.roadNetwork); }
  catch (error) { fail("ROAD_NETWORK_INVALID", `${layout.cityId}: ${error instanceof Error ? error.message : String(error)}`); return violations; }
  const roadCells = rasterizeBlockRoads(layout.roadNetwork);
  const roads = new Set(roadCells.map(key));
  try {
    for (const separator of readDistrictSeparators(layout.blocks)) {
      if (layout.blocks.some(block => overlapsDistrictSeparator(block, separator))) fail("DISTRICT_SEPARATOR_OCCUPIED", layout.cityId);
      const b = separator.bounds;
      for (let i = 0; i <= BLOCK_MODULE_CELLS; i++) {
        const points = separator.axis === "H" ? [{ x: b.minX + i, y: b.minY }, { x: b.minX + i, y: b.maxY }]
          : [{ x: b.minX, y: b.minY + i }, { x: b.maxX, y: b.minY + i }];
        if (points.some(point => !roads.has(key(point)))) { fail("DISTRICT_SEPARATOR_DISCONNECTED", layout.cityId); break; }
      }
    }
  } catch (error) { fail("DISTRICT_SEPARATOR_INVALID", `${layout.cityId}: ${String(error)}`); }
  if (roadCells.some((cell) => !inside(layout.bounds, cell))) fail("ROAD_OUTSIDE_CITY", layout.cityId);
  if (canBuild) {
    const invalid = roadCells.find((cell) => !canBuild(cell));
    if (invalid) fail("ROAD_ON_UNBUILDABLE_TERRAIN", `${layout.cityId}: road ${key(invalid)} crosses unbuildable terrain`);
  }
  const districts = new Map(layout.districtLayouts.map((district) => [district.id, district]));
  if (districts.size !== layout.districtLayouts.length) fail("DUPLICATE_DISTRICT_LAYOUT", layout.cityId);
  const blockIds = new Set<string>(); const modules = new Map<string, string>();
  const slots = new Map<string, { slot: BlockSlot; districtId: string }>();
  const buildingCells = new Set<string>();
  for (const block of layout.blocks) {
    if (blockIds.has(block.id)) fail("DUPLICATE_BLOCK", block.id); blockIds.add(block.id);
    const district = districts.get(block.districtLayoutId);
    if (!district) { fail("BLOCK_DISTRICT_MISSING", block.id); continue; }
    if (!Number.isSafeInteger(block.origin.x) || !Number.isSafeInteger(block.origin.y)) fail("BLOCK_GRID_MISALIGNED", block.id);
    if ((block.origin.x - district.bounds.minX) % BLOCK_MODULE_CELLS !== 0
      || (block.origin.y - district.bounds.minY) % BLOCK_MODULE_CELLS !== 0) fail("BLOCK_GRID_MISALIGNED", block.id);
    const rectangle = { minX: block.origin.x, minY: block.origin.y, maxX: block.origin.x + block.width, maxY: block.origin.y + block.height };
    for (const corner of [{ x: rectangle.minX, y: rectangle.minY }, { x: rectangle.maxX, y: rectangle.maxY }]) {
      if (!inside(district.bounds, corner)) fail("BLOCK_OUTSIDE_DISTRICT", block.id);
      if (!inside(layout.bounds, corner)) fail("BLOCK_OUTSIDE_CITY", block.id);
    }
    let planned: BlockSlot[];
    try { planned = blockSlots(block); }
    catch (error) { fail("BLOCK_TEMPLATE_INVALID", `${block.id}: ${String(error)}`); continue; }
    for (let y = block.origin.y; y < block.origin.y + block.height; y += BLOCK_MODULE_CELLS) {
      for (let x = block.origin.x; x < block.origin.x + block.width; x += BLOCK_MODULE_CELLS) {
        const owner = modules.get(`${x}:${y}`);
        if (owner) fail("BLOCK_OVERLAP", `${block.id} intersects ${owner}`);
        modules.set(`${x}:${y}`, block.id);
      }
    }
    for (const slot of planned) {
      slots.set(`${block.id}:${slot.key}`, { slot, districtId: district.districtId });
      for (const point of slot.footprint) buildingCells.add(key(point));
      let invalidTerrain: Cell | undefined;
      let roadOverlap: Cell | undefined;
      for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y += 1) for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x += 1) {
        const point = { x, y };
        if (roads.has(key(point))) roadOverlap = point;
        if (canBuild && !canBuild(point)) invalidTerrain = point;
      }
      if (roadOverlap) fail("SITE_ROAD_OVERLAP", `${block.id}/${slot.key}: ${key(roadOverlap)}`);
      if (invalidTerrain) fail("SITE_ON_UNBUILDABLE_TERRAIN", `${block.id}/${slot.key}: ${key(invalidTerrain)}`);
    }
  }
  for (const [identity, { slot }] of slots) {
    if (slot.accessPath.length === 0 || distance(slot.entrance, slot.accessPath[0]!) !== 1) fail("TASK_ACCESS_MISALIGNED", identity);
    for (let i = 1; i < slot.accessPath.length; i += 1) {
      if (distance(slot.accessPath[i - 1]!, slot.accessPath[i]!) !== 1) fail("TASK_ACCESS_DISCONNECTED", identity);
    }
    for (const point of slot.accessPath) {
      if (buildingCells.has(key(point))) fail("TASK_ACCESS_CROSSES_BUILDING", identity);
      if (roads.has(key(point))) fail("TASK_ACCESS_CROSSES_ROAD", identity);
      if (canBuild && !canBuild(point)) fail("TASK_ACCESS_UNBUILDABLE", identity);
    }
    const end = slot.accessPath.at(-1);
    if (!end || !neighbors(end).some((point) => roads.has(key(point)))) fail("TASK_ENTRANCE_UNREACHABLE", identity);
  }
  const occupied = new Set<string>(); const placedTasks = new Set<string>(); const expected = new Map(tasks?.map((task) => [task.id, task]));
  for (const placement of layout.placements) {
    const identity = `${placement.blockId}:${placement.slotKey}`;
    if (occupied.has(identity)) fail("SLOT_OCCUPANCY_CONFLICT", identity); occupied.add(identity);
    if (placedTasks.has(placement.taskId)) fail("DUPLICATE_TASK_PLACEMENT", placement.taskId); placedTasks.add(placement.taskId);
    const resolved = slots.get(identity);
    if (!resolved) { fail("TASK_SLOT_MISSING", placement.taskId); continue; }
    if (!Number.isInteger(placement.constructionStage) || placement.constructionStage < 1 || placement.constructionStage > 5) fail("TASK_STAGE_INVALID", placement.taskId);
    const task = expected.get(placement.taskId);
    if (tasks && !task) fail("PLACEMENT_TASK_MISSING", placement.taskId);
    if (task) {
      if (task.districtId !== resolved.districtId) fail("TASK_DISTRICT_MISMATCH", task.id);
      if (task.kind !== resolved.slot.kind) fail("TASK_SLOT_KIND_MISMATCH", task.id);
      if (task.constructionStage !== placement.constructionStage) fail("TASK_STAGE_MISMATCH", task.id);
      if (task.buildingFamily !== placement.buildingFamily) fail("TASK_BUILDING_MISMATCH", task.id);
    }
  }
  for (const task of tasks ?? []) if (!placedTasks.has(task.id)) fail("TASK_PLACEMENT_MISSING", task.id);
  for (const marker of layout.siteMarkers) {
    const identity = `${marker.blockId}:${marker.slotKey}`;
    if (!slots.has(identity)) fail("MARKER_SLOT_MISSING", marker.id);
    if (occupied.has(identity)) fail("SLOT_OCCUPANCY_CONFLICT", identity); occupied.add(identity);
    if (marker.kind === "RUINED" && marker.targetTaskId) fail("RUIN_TARGET_INVALID", marker.id);
    // A relocated marker may outlive its removed target; the DB nulls its FK.
    if (marker.kind === "RELOCATED" && marker.targetTaskId && tasks && !expected.has(marker.targetTaskId)) fail("RELOCATION_TARGET_MISSING", marker.id);
  }
  const chunks = (Math.floor(layout.bounds.maxX / 64) - Math.floor(layout.bounds.minX / 64) + 1)
    * (Math.floor(layout.bounds.maxY / 64) - Math.floor(layout.bounds.minY / 64) + 1);
  if (chunks > 256) fail("CITY_SCENE_LIMIT_EXCEEDED", `${layout.cityId}: ${chunks} chunks`);
  return violations;
}

type CityRow = { id: string; name: string; bounds_json: BlockWorldBounds };
type DistrictRow = { id: string; city_id: string; name: string; archetype: string; status: string };
type TaskRow = { id: string; city_id: string; district_id: string; status: TaskStatus; building_type: string; visual_kind: string; visual_asset_key: string | null };

/** Audit only canonical layouts and product records; never old spatial tables. */
export async function auditWorld(db: Db, _service: AppService, countryId: string): Promise<WorldAuditResult> {
  const [cities, districts, tasks] = await Promise.all([
    db.prepare("SELECT id,name,bounds_json FROM cities_v3 WHERE country_id=? ORDER BY created_at,id").all<CityRow>(countryId),
    db.prepare("SELECT d.id,d.city_id,d.name,d.archetype,d.status FROM districts_v3 d JOIN cities_v3 c ON c.id=d.city_id WHERE c.country_id=? ORDER BY d.created_at,d.id").all<DistrictRow>(countryId),
    db.prepare("SELECT t.id,t.city_id,t.district_id,t.status,t.building_type,t.visual_kind,t.visual_asset_key FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id WHERE c.country_id=? ORDER BY t.task_number,t.id").all<TaskRow>(countryId),
  ]);
  const metrics: WorldAuditMetrics = {
    cities: cities.length, districts: districts.length, tasks: tasks.length, blocks: 0, roadSegments: 0, plannedSlots: 0,
    roads: 0, bridges: 0, roadClasses: { LOCAL: 0, COLLECTOR: 0, ARTERIAL: 0, HIGHWAY: 0 },
    taskStages: Object.fromEntries([1, 2, 3, 4, 5].map((stage) => [String(stage), tasks.filter((t) => TASK_STAGE[t.status] === stage).length])),
    uniqueBuildingTypes: new Set(tasks.map((t) => t.building_type)).size,
    uniqueBuildingTypesPerCity: {}, tasksPerCity: {}, districtsPerCity: {}, tasksPerDistrict: {},
    districtCellRange: { min: 0, max: 0 }, maximumTaskRoadDistance: 0, maximumEntranceAccessLength: 0,
    surfaceCells: 0, worldFeatures: 0, greenAreas: tasks.filter((t) => t.visual_kind === "PARK").length, parkDecor: 0,
    greenAreasPerCity: {}, serviceRolesPerCity: {}, districtArchetypes: {}, zoningCompliance: 1,
    zoningPrimarySharePerDistrict: {}, asphaltSharePerDistrict: {}, maximumResidentialAsphaltShare: 0, crosswalkCells: 0, roadJunctionsPerCity: {},
  };
  const violations: WorldAuditViolation[] = []; const districtSizes: number[] = []; const layouts: CompiledBlockLayoutV1[] = [];
  for (const district of districts) {
    const districtTasks = tasks.filter((t) => t.district_id === district.id);
    metrics.tasksPerDistrict[district.name] = districtTasks.length;
    metrics.districtArchetypes[district.archetype] = (metrics.districtArchetypes[district.archetype] ?? 0) + 1;
    // activateDistrict demotes the previous active sprint to PLANNED without
    // resetting its tasks. PLANNED means currently inactive, not never started;
    // stage mutations are guarded by the command, while retained progress is valid.
    if (district.status === "COMPLETED" && districtTasks.some((t) => t.status !== "COMPLETED")) violations.push({ code: "COMPLETED_DISTRICT_HAS_OPEN_TASKS", message: district.name });
  }
  for (const city of cities) {
    const cityTasks = tasks.filter((t) => t.city_id === city.id);
    metrics.tasksPerCity[city.name] = cityTasks.length;
    metrics.districtsPerCity[city.name] = districts.filter((d) => d.city_id === city.id).length;
    metrics.uniqueBuildingTypesPerCity[city.name] = new Set(cityTasks.map((t) => t.building_type)).size;
    metrics.greenAreasPerCity[city.name] = cityTasks.filter((t) => t.visual_kind === "PARK").length;
    metrics.serviceRolesPerCity[city.name] = [...new Set(cityTasks.map((t) => BUILDING_CATALOG.find((b) => b.key === t.building_type)?.serviceRole).filter((r): r is string => Boolean(r)))];
    let layout: CompiledBlockLayoutV1 | undefined;
    try { layout = await readActiveBlockLayout(db, city.id); }
    catch (error) { violations.push({ code: "ACTIVE_LAYOUT_INVALID", message: `${city.name}: ${String(error)}` }); continue; }
    if (!layout) { violations.push({ code: "WORLD_REGENERATION_REQUIRED", message: `${city.name}: no active block-v1 layout` }); continue; }
    layouts.push(layout);
    const expectations = cityTasks.map((t) => ({ id: t.id, districtId: t.district_id, constructionStage: TASK_STAGE[t.status],
      kind: taskKind(t.visual_kind, t.visual_asset_key), buildingFamily: t.building_type }));
    violations.push(...auditBlockLayout(layout, expectations, (point) => isBuildableTerrain(terrainAt(layout.seed, point.x, point.y).terrain)));
    const roads = rasterizeBlockRoads(layout.roadNetwork); const roadKeys = new Set(roads.map(key));
    metrics.roads += roads.length; metrics.blocks += layout.blocks.length; metrics.roadSegments += layout.roadNetwork.segments.length;
    metrics.worldFeatures += layout.siteMarkers.length;
    for (const road of roads) metrics.roadClasses[road.roadClass] += 1;
    metrics.roadJunctionsPerCity[city.name] = layout.roadNetwork.nodes.filter((node) => node.kind === "JUNCTION").length;
    const surfaceKeys = new Set<string>();
    for (const road of roads) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const cell = { x: road.x + dx, y: road.y + dy }; if (!roadKeys.has(key(cell))) surfaceKeys.add(key(cell));
    }
    const occupied = new Set([...layout.placements.map((p) => `${p.blockId}:${p.slotKey}`), ...layout.siteMarkers.map((m) => `${m.blockId}:${m.slotKey}`)]);
    for (const block of layout.blocks) for (const slot of blockSlots(block)) {
      if (!occupied.has(`${block.id}:${slot.key}`)) metrics.plannedSlots += 1;
      for (const cell of slot.accessPath) surfaceKeys.add(key(cell));
      metrics.maximumEntranceAccessLength = Math.max(metrics.maximumEntranceAccessLength, slot.accessPath.length);
      metrics.maximumTaskRoadDistance = Math.max(metrics.maximumTaskRoadDistance, Math.min(slot.origin.x - block.origin.x - 1, block.origin.x + block.width - slot.footprintBounds.maxX - 1));
    }
    metrics.surfaceCells += surfaceKeys.size;
    for (const d of layout.districtLayouts) {
      const district = districts.find((entry) => entry.id === d.districtId);
      if (!district) { violations.push({ code: "LAYOUT_DISTRICT_MISSING", message: d.districtId }); continue; }
      const owned = layout.blocks.filter((b) => b.districtLayoutId === d.id);
      const area = owned.reduce((sum, b) => sum + b.width * b.height, 0); districtSizes.push(area);
      const asphalt = roads.filter((r) => owned.some((b) => r.x >= b.origin.x && r.x < b.origin.x + b.width && r.y >= b.origin.y && r.y < b.origin.y + b.height)).length;
      metrics.asphaltSharePerDistrict[district.name] = area > 0 ? asphalt / area : 0;
      metrics.zoningPrimarySharePerDistrict[district.name] = 1;
      metrics.maximumResidentialAsphaltShare = Math.max(metrics.maximumResidentialAsphaltShare, area > 0 ? asphalt / area : 0);
    }
  }
  for (let a = 0; a < layouts.length; a += 1) for (let b = a + 1; b < layouts.length; b += 1) {
    const left = layouts[a]!; const right = layouts[b]!;
    if (left.bounds.minX <= right.bounds.maxX && left.bounds.maxX >= right.bounds.minX
      && left.bounds.minY <= right.bounds.maxY && left.bounds.maxY >= right.bounds.minY) violations.push({ code: "CITY_OVERLAP", message: `${left.cityId} intersects ${right.cityId}` });
  }
  const snapshot = await readCountryRoads(db, countryId);
  const country = await db.prepare("SELECT seed FROM countries WHERE id=?").get<{ seed: number }>(countryId);
  if (!snapshot && layouts.some(layout => layout.blocks.length > 0)) {
    violations.push({ code: "COUNTRY_ROADS_REGENERATION_REQUIRED", message: countryId });
  } else if (snapshot && country) {
    if (snapshot.topologyHash !== countryRoadTopologyHash(Number(country.seed), layouts.map(layout => ({ city_id: layout.cityId, checksum: layout.roadNetwork.checksum })))) {
      violations.push({ code: "COUNTRY_ROADS_STALE", message: countryId });
    }
    try {
      const validated = planIntercityRoads({ countryId, seed: Number(country.seed), validateOnly: true,
        cities: layouts.filter(layout => layout.blocks.length > 0).map(layout => ({ id: layout.cityId, nodes: layout.roadNetwork.nodes, blocks: layout.blocks })),
        protectedSites: await permanentSiteBounds(db, countryId, true), previous: snapshot.plan });
      if (JSON.stringify(validated.components) !== JSON.stringify(snapshot.plan.components)) throw new Error("Stored road components differ from actual connectivity");
    } catch (error) { violations.push({ code: "COUNTRY_ROADS_INVALID", message: `${countryId}: ${String(error)}` }); }
  }
  metrics.districtCellRange = { min: districtSizes.length ? Math.min(...districtSizes) : 0, max: districtSizes.length ? Math.max(...districtSizes) : 0 };
  metrics.zoningCompliance = tasks.length ? 1 - Math.min(tasks.length, violations.filter((v) => v.code === "TASK_SLOT_KIND_MISMATCH").length) / tasks.length : 1;
  return { metrics, violations };
}
