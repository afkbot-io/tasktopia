import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILDING_CATALOG,
  TASK_BUILDING_CATALOG,
  taskBuildingPlatform,
  getBuilding,
  inferTaskTags,
  type BuildingCatalogEntry,
} from "../shared/catalog";
import {
  STATUS_PROGRESS_RANGE,
  TASK_STAGE,
  type BootstrapDto,
  type BuildingEventContext,
  type ArchiveRecordDto,
  type ArchiveRecordKind,
  type Cell,
  type ChunkDto,
  type ChunkLod,
  type ChunkPayloadDto,
  type ChunkPayloadV2Dto,
  type ChunkTaskDto,
  type CityDto,
  type CityMorphology,
  type DistrictArchetype,
  type CountryDto,
  type DistrictDto,
  type DistrictStatus,
  type Estimate,
  type PlannedLotDto,
  type PlannedLotRole,
  type PlanCityDto,
  type PlanCityPageDto,
  type PlanDistrictDto,
  type PlanTaskDto,
  type RealtimeEvent,
  type Rect,
  type CountryArchiveDto,
  type RoadCellDto,
  type SurfaceCellDto,
  type TaskAttachmentDto,
  type TaskChecklistItemDto,
  type TaskDocumentDto,
  type TaskDto,
  type TaskDefectDto,
  type TaskEventDto,
  type TaskCommentDto,
  type TaskLinkDto,
  type TaskPriority,
  type TaskSearchResultDto,
  type TaskStatus,
  type WorkItemType,
  type WorldFeatureDto,
} from "../shared/contracts";
import { materializeChunkPayload } from "../shared/world-chunk-payload";
import { compactCellRuns, compactRoadRuns, compactSurfaceRuns, expandCellRuns } from "../shared/world-cell-runs";
import { ASSET_REVISION } from "../shared/catalog";
import { config } from "./config";
import type { Db } from "./db";
import { now, onTransactionCommit, onTransactionRollback, transaction } from "./db";
import { listAccessibleCountries, registerUser, type AuthUser, type RegistrationInput } from "./auth";
import {
  GRID_DIRECTIONS,
  aStarPath,
  aStarPathToAny,
  boundsOf,
  cellKey,
  connected,
  contains,
  expandRect,
  floorDiv,
  intersects,
  manhattan,
  neighbors4,
  orthogonalPath,
  rectangleFootprint,
} from "./world/grid";
import { hashCoordinate, isBuildableTerrain, isWater, terrainAt } from "../shared/world-terrain";
import { chunkPayloadContentHash } from "./world/chunk-payload-hash";
import { bridgeComponentsWithoutTwoLandPortals, roadCorridorBlockers, stampRoadCorridor } from "./world/road-geometry";
import { pairedBusStopCandidates, type TransitRoadAxis } from "./world/transit";
import { generatedGreenAreaProfile, greenAreaSizeCandidates, greenAreaTarget } from "./green-area-planner";
import { greenAreaDevelopmentStage, greenAreaPathCells } from "../shared/green-area";
import { COUNTRY_ATLAS_SCHEMA_VERSION, type CountryAtlasDto } from "../shared/country-atlas-contract";
import { COUNTRY_OVERVIEW_SCHEMA_VERSION, encodeCountryTerrain, type CountryOverviewDto, type CountryOverviewDistrictDto } from "../shared/country-overview-contract";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../shared/city-scene-contract";
import { countryAtlasEventImpact, patchCountryAtlasTaskProgress } from "../shared/country-atlas-events";
import { meanCountryAtlasProgress } from "../shared/country-atlas-progress";
import { PLANET_ATLAS_SCHEMA_VERSION, type PlanetAtlasDto } from "../shared/planet-atlas-contract";
import { projectPlanetAtlas } from "../shared/planet-atlas";
import { compactLotsAfterPlacement, nextOrganicComplexLotTarget, organicComplexLotTarget, planComplex } from "./world/complex-planner";
import { projectCountryAtlas } from "./world/country-atlas";
import { projectCountryOverview } from "./world/country-overview";
import { buildCountryGeography, snapCountryCitiesToLand } from "./world/country-geography";
import type { SharedWorldCache } from "./optional-redis-cache";
import {
  ROAD_WIDTH,
  archetypeAffinity,
  buildingLotDepthCells,
  buildingVisualReservationCells,
  buildingVisualSetbackCells,
  buildingZoningRole,
  buildingLotPlacementScore,
  buildSurfaceMap,
  buildingApronCells,
  buildingGapPaths,
  chooseDistrictArchetype,
  districtAnnexSearchBounds,
  cityMorphology,
  entranceOutside,
  findAreaAccessPath,
  findAccessPlan,
  isCompactNewBuildBuilding,
  primaryZoningRole,
  taskBuildingCompatibleWithArchetype,
} from "./world/city-generation";

export const CHUNK_SIZE = 64;
const CITY_SIZE = 100;
const CITY_SPACING = 320;
const COUNTRY_VIEW_MARGIN = 54;
const SPRINT_COLORS = ["#52a8d8", "#dfa94b", "#9877c7", "#69ad67", "#c86f67", "#4fb49f", "#d585b4"];
const COUNTRY_ATLAS_DISTRICT_COLORS = [
  "#5db8e5", "#e1ad52", "#a88adb", "#79c67b", "#e27d73", "#58c1ae", "#d990c2", "#78a5e6",
  "#e28e58", "#8f82d7", "#b7c765", "#d37bab", "#65b8c1", "#d7c15f", "#b49ad8", "#d87462",
  "#83c19a", "#82aac8", "#c99a5a", "#9a83bf", "#70b2a1", "#d88c78", "#79b5d2", "#aebb67",
  "#c37e95", "#6fbfcb", "#d6a66b", "#978fd0", "#75b777", "#c684c3", "#6ba3b3", "#cf8e55",
] as const;
const ROAD_CLASS_RANK: Record<RoadCellDto["roadClass"], number> = { LOCAL: 0, COLLECTOR: 1, ARTERIAL: 2, HIGHWAY: 3 };
const ARCHIVE_COMPOUND = { width: 42, height: 28 } as const;
const ARCHIVE_CITY_CLEARANCE = 24;
const AIRPORT_COMPOUND = { width: 44, height: 22 } as const;

function roadReachable(roads: ReadonlyMap<string, Cell>, start: Cell, target: Cell): boolean {
  const startKey = cellKey(start);
  const targetKey = cellKey(target);
  if (!roads.has(startKey) || !roads.has(targetKey)) return false;
  const queue = [start];
  const visited = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const key = cellKey(current);
    if (visited.has(key)) continue;
    if (key === targetKey) return true;
    visited.add(key);
    for (const next of neighbors4(current)) if (roads.has(cellKey(next)) && !visited.has(cellKey(next))) queue.push(next);
  }
  return false;
}

function compareCellsByDistance(target: Cell): (left: Cell, right: Cell) => number {
  return (left, right) => manhattan(left, target) - manhattan(right, target)
    || left.y - right.y
    || left.x - right.x;
}
const ARCHIVE_BUILDING_LAYOUT = [
  { assetKey: "state-archive-core", offset: { x: 13, y: 18 } },
  { assetKey: "state-archive-wing", offset: { x: 1, y: 1 } },
  { assetKey: "state-archive-vault", offset: { x: 27, y: 1 } },
  { assetKey: "state-archive-tower", offset: { x: 0, y: 18 } },
] as const;
const ARCHIVE_BUILDINGS = ARCHIVE_BUILDING_LAYOUT.map((building) => {
  const footprint = getBuilding(building.assetKey).footprint;
  return { ...building, width: footprint.width, height: footprint.height };
});
const ARCHIVE_GATE_CENTER_OFFSET_X = ARCHIVE_BUILDING_LAYOUT[0].offset.x
  + getBuilding(ARCHIVE_BUILDING_LAYOUT[0].assetKey).entrances[0]!.offset;

function rectanglePerimeterFootprint(origin: Cell, width: number, height: number): Cell[] {
  const cells: Cell[] = [];
  for (let x = 0; x < width; x += 1) {
    cells.push({ x: origin.x + x, y: origin.y });
    if (height > 1) cells.push({ x: origin.x + x, y: origin.y + height - 1 });
  }
  for (let y = 1; y < height - 1; y += 1) {
    cells.push({ x: origin.x, y: origin.y + y });
    if (width > 1) cells.push({ x: origin.x + width - 1, y: origin.y + y });
  }
  return cells;
}

type Row = Record<string, unknown>;
type GrowthDirection = DistrictDto["growthDirection"];

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export function connectReplayDistrictSegments(
  segments: readonly (readonly Cell[])[],
  cityBounds: Rect,
  foreignDistrictCells: ReadonlySet<string>,
): Cell[] {
  const first = segments[0];
  if (!first || first.length === 0) return [];
  const merged = new Map(first.map((cell) => [cellKey(cell), cell]));
  for (const segment of segments.slice(1)) {
    if (segment.length === 0) continue;
    const segmentKeys = new Set(segment.map(cellKey));
    const start = segment.reduce((best, cell) => {
      const bestDistance = Math.min(...[...merged.values()].slice(0, 64).map((target) => manhattan(best, target)));
      const cellDistance = Math.min(...[...merged.values()].slice(0, 64).map((target) => manhattan(cell, target)));
      return cellDistance < bestDistance ? cell : best;
    });
    const end = [...merged.values()].reduce((best, cell) => manhattan(cell, start) < manhattan(best, start) ? cell : best);
    const costAt = (cell: Cell) => {
      if (!contains(cityBounds, cell)) return Number.POSITIVE_INFINITY;
      const key = cellKey(cell);
      if (foreignDistrictCells.has(key) && !merged.has(key) && !segmentKeys.has(key)) return Number.POSITIVE_INFINITY;
      return merged.has(key) || segmentKeys.has(key) ? 0.05 : 1;
    };
    const corridor = [24, 64, 128]
      .map((margin) => aStarPath(start, end, costAt, margin, 0.2, false))
      .find((candidate) => candidate.length > 0);
    if (!corridor) throw new DomainError("REGENERATION_FAILED", "Не удалось соединить территории района-продолжения");
    for (const cell of [...segment, ...corridor]) merged.set(cellKey(cell), cell);
  }
  const cells = [...merged.values()];
  if (!connected(cells)) throw new DomainError("REGENERATION_FAILED", "Территория replay-района осталась несвязной");
  return cells;
}

class StaleChunkBuildError extends Error {}

export function connectorCorridorBlocked(
  key: string,
  occupied: ReadonlySet<string>,
  existingRoads: ReadonlySet<string>,
  blockedByDistrict: ReadonlySet<string>,
  foreignSoft: ReadonlySet<string>,
  allowForeign: boolean,
): boolean {
  // A road on the boundary of a completed district remains shared public
  // infrastructure. Reusing its already-paved cells must be legal; only new
  // asphalt is forbidden inside sealed territory.
  if (existingRoads.has(key)) return false;
  return occupied.has(key)
    || blockedByDistrict.has(key) && (!allowForeign || !foreignSoft.has(key));
}

/**
 * Candidate widths for a demand-driven district patch. The complex planner
 * keeps a one-cell search margin around its own V5 envelope, so the patch must
 * be at least two cells larger than the minimum complex rectangle. A fixed
 * 44-cell ceiling made 18–24-cell new-build facades impossible to grow toward
 * east/west even though the surrounding terrain was free.
 */
export function districtGrowthThicknesses(entry: BuildingCatalogEntry): number[] {
  // Mature compact neighbourhoods can contain dozens of tasks. Their first
  // 24–32-cell annex may be clipped by terrain or another city; retain larger
  // bounded fallbacks so replay can grow a second coherent frontage instead
  // of failing after the old territory is full.
  if (!entry.tags.includes("new-build")) return [24, 28, 32, 36, 40, 48];
  const minimumComplexWidth = Math.max(64, Math.min(72, entry.footprint.width * 4 + 8));
  const required = Math.ceil((minimumComplexWidth + 2) / 4) * 4;
  return [...new Set([64, 68, 72, required, required + 4])].sort((left, right) => left - right);
}

/** Keep route probes distributed across the network instead of adjacent cells. */
export function spatialRoadAnchors(cells: readonly Cell[], gridSize = 8, limit = 256): Cell[] {
  const buckets = new Set<string>();
  const selected: Cell[] = [];
  for (const cell of cells) {
    const bucket = `${Math.floor(cell.x / gridSize)}:${Math.floor(cell.y / gridSize)}`;
    if (buckets.has(bucket)) continue;
    buckets.add(bucket);
    selected.push(cell);
    if (selected.length >= limit) break;
  }
  return selected;
}

/** Keep preferred highway probes and fallback network probes on independent budgets. */
export function spatialRoadAnchorTiers(
  highways: readonly Cell[],
  fallback: readonly Cell[],
  gridSize = 8,
  limit = 256,
): Cell[][] {
  const highwayKeys = new Set(highways.map(cellKey));
  const fallbackOnly = fallback.filter((cell) => !highwayKeys.has(cellKey(cell)));
  return [spatialRoadAnchors(highways, gridSize, limit), spatialRoadAnchors(fallbackOnly, gridSize, limit)]
    .filter((tier) => tier.length > 0);
}

/**
 * A planned local street must stay in its district and may cross only water
 * that forms a complete two-shore bridge. Existing public asphalt is allowed
 * at the connection point even when it sits immediately outside the boundary.
 */
export function plannedLocalStreetCorridorsValid(
  streets: readonly Cell[][],
  districtCellKeys: ReadonlySet<string>,
  seed: number,
  existingRoads: ReadonlyMap<string, RoadCellDto>,
  terrainMemo = new Map<string, "BUILDABLE" | "WATER" | "BLOCKED">(),
): boolean {
  const corridor = streets.flatMap((segment) => stampRoadCorridor(segment, "LOCAL", ROAD_WIDTH));
  const terrainRole = (cell: Cell): "BUILDABLE" | "WATER" | "BLOCKED" => {
    const key = cellKey(cell);
    const cached = terrainMemo.get(key);
    if (cached) return cached;
    const terrain = terrainAt(seed, cell.x, cell.y).terrain;
    const role = isBuildableTerrain(terrain) ? "BUILDABLE" : isWater(terrain) ? "WATER" : "BLOCKED";
    terrainMemo.set(key, role);
    return role;
  };
  for (const cell of corridor) {
    const key = cellKey(cell);
    if (existingRoads.has(key)) continue;
    if (!districtCellKeys.has(key)) return false;
    if (terrainRole(cell) === "BLOCKED") return false;
  }
  const additions = new Map<string, RoadCellDto>();
  const newBridgeKeys: string[] = [];
  for (const cell of corridor) {
    const role = terrainRole(cell);
    const road = {
      ...cell,
      mask: 0,
      structure: role === "WATER" ? "BRIDGE" : "ROAD",
      roadClass: "LOCAL",
    } satisfies RoadCellDto;
    additions.set(cellKey(cell), road);
    if (road.structure === "BRIDGE") newBridgeKeys.push(cellKey(cell));
  }
  // Most candidates never touch water. More importantly, do not rescan the
  // entire national network for each lot proposal: only a bridge component
  // reached by a newly stamped water cell can change validity.
  if (newBridgeKeys.length === 0) return true;
  const affected = new Map<string, RoadCellDto>();
  const queue = [...newBridgeKeys];
  const visited = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor]!;
    if (visited.has(key)) continue;
    visited.add(key);
    const road = additions.get(key) ?? existingRoads.get(key);
    if (!road || road.structure !== "BRIDGE") continue;
    affected.set(key, road);
    for (const neighbor of neighbors4(road)) {
      const neighborKey = cellKey(neighbor);
      const neighborRoad = additions.get(neighborKey) ?? existingRoads.get(neighborKey);
      if (!neighborRoad) continue;
      affected.set(neighborKey, neighborRoad);
      if (neighborRoad.structure === "BRIDGE" && !visited.has(neighborKey)) queue.push(neighborKey);
    }
  }
  return bridgeComponentsWithoutTwoLandPortals(affected.values()).length === 0;
}

/** Count occupied cells in an inclusive rectangle without rescanning them. */
export function rectOccupancyCounter(cells: readonly Cell[], bounds: Rect): (rect: Rect) => number {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const stride = width + 1;
  const prefix = new Uint32Array(stride * (height + 1));
  for (const cell of cells) {
    if (!contains(bounds, cell)) continue;
    const x = cell.x - bounds.minX + 1;
    const y = cell.y - bounds.minY + 1;
    prefix[y * stride + x]! += 1;
  }
  for (let y = 1; y <= height; y += 1) {
    let rowTotal = 0;
    for (let x = 1; x <= width; x += 1) {
      rowTotal += prefix[y * stride + x]!;
      prefix[y * stride + x] = prefix[(y - 1) * stride + x]! + rowTotal;
    }
  }
  return (rect) => {
    const minX = Math.max(bounds.minX, rect.minX) - bounds.minX;
    const minY = Math.max(bounds.minY, rect.minY) - bounds.minY;
    const maxX = Math.min(bounds.maxX, rect.maxX) - bounds.minX + 1;
    const maxY = Math.min(bounds.maxY, rect.maxY) - bounds.minY + 1;
    if (minX >= maxX || minY >= maxY) return 0;
    return prefix[maxY * stride + maxX]!
      - prefix[minY * stride + maxX]!
      - prefix[maxY * stride + minX]!
      + prefix[minY * stride + minX]!;
  };
}

/** Width reserved by a readable residential frontage before later block growth. */
export function initialResidentialFrontageWidth(
  archetype: DistrictArchetype,
  complexIndex: number,
  entryWidth: number,
): number {
  if (archetype === "PRIVATE") return Math.min(72, Math.max(12, entryWidth) * 3 + 8);
  if (complexIndex !== 0) return 0;
  if (archetype === "NEW_BUILD") return Math.min(72, Math.max(12, entryWidth) * 4 + 8);
  return 0;
}

/** Surface scope required to evaluate only currently reusable district lots. */
export function districtAvailableLotBounds(district: DistrictDto): Rect | null {
  const cells = district.lots
    .filter((lot) => !lot.taskId)
    .flatMap((lot) => rectangleFootprint(lot.origin, lot.width, lot.height));
  return cells.length > 0 ? expandRect(boundsOf(cells), 8) : null;
}

/** Keep each generated park near the newest occupied street block. */
export function districtGreenSearchBounds(districtCells: Cell[], lots: PlannedLotDto[]): Rect {
  const districtBounds = boundsOf(districtCells);
  const latestGroupId = lots.map((lot) => lot.groupId).filter((value): value is string => Boolean(value)).sort().at(-1);
  const focusCells = latestGroupId
    ? lots.filter((lot) => lot.groupId === latestGroupId).flatMap((lot) => [
        ...rectangleFootprint(lot.origin, lot.width, lot.height),
        ...(lot.sharedAccess ?? []),
      ])
    : [];
  if (focusCells.length === 0) return districtBounds;
  const focused = expandRect(boundsOf(focusCells), 16);
  return {
    minX: Math.max(districtBounds.minX, focused.minX),
    minY: Math.max(districtBounds.minY, focused.minY),
    maxX: Math.min(districtBounds.maxX, focused.maxX),
    maxY: Math.min(districtBounds.maxY, focused.maxY),
  };
}

export function complexMinimumRect(entry: BuildingCatalogEntry, targetLots: number): { width: number; height: number } {
  const lotDepth = buildingLotDepthCells(entry);
  if (!entry.tags.includes("new-build")) {
    return { width: Math.max(14, entry.footprint.width + 6), height: Math.max(12, lotDepth + 6) };
  }
  // A three/four-lot retry is a genuine point complex: one frontage row plus
  // the street and its margins. Keeping the two-tier dimensions here made the
  // documented 10 → 6 → 3 retry sequence retry the same oversized rectangle.
  if (targetLots <= 4) {
    return { width: Math.max(14, entry.footprint.width + 8), height: Math.max(12, lotDepth + 7) };
  }
  if (buildingVisualSetbackCells(entry) > 0) {
    return {
      width: Math.max(14, Math.min(44, entry.footprint.width * 2 + 8)),
      height: Math.max(12, lotDepth + 7),
    };
  }
  return {
    width: Math.max(14, Math.min(44, entry.footprint.width * 2 + 8)),
    height: Math.max(12, Math.min(54, lotDepth * 2 + 9)),
  };
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stringHash(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32LE(0) / 0xffffffff;
}

function cityDto(row: Row): CityDto {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    goal: String(row.goal ?? ""),
    acceptanceCriteria: String(row.acceptance_criteria ?? ""),
    deadline: row.deadline ? String(row.deadline) : null,
    status: String(row.status) as CityDto["status"],
    center: { x: Number(row.center_x), y: Number(row.center_y) },
    bounds: json<Rect>(row.bounds_json),
    styleId: String(row.style_id),
    morphology: String(row.morphology ?? "BALANCED") as CityMorphology,
    createdAt: String(row.created_at),
  };
}

function districtDto(row: Row): DistrictDto {
  return {
    id: String(row.id),
    cityId: String(row.city_id),
    name: String(row.name),
    goal: String(row.goal),
    description: String(row.description ?? ""),
    deadline: row.deadline ? String(row.deadline) : null,
    status: String(row.status) as DistrictStatus,
    capacitySp: Number(row.capacity_sp),
    cells: json<Cell[]>(row.cells_json),
    lots: json<PlannedLotDto[]>(row.lots_json),
    growthDirection: String(row.growth_direction) as GrowthDirection,
    archetype: String(row.archetype ?? "MIXED_URBAN") as DistrictArchetype,
    color: String(row.color),
    createdAt: String(row.created_at),
  };
}

function taskDto(row: Row): TaskDto {
  const status = String(row.status) as TaskStatus;
  const origin = { x: Number(row.origin_x), y: Number(row.origin_y) };
  const buildingType = String(row.building_type);
  const entry = BUILDING_CATALOG.find((candidate) => candidate.key === buildingType);
  const configuredEntrance = entry?.entrances[0];
  const fallbackEntrance = entry && configuredEntrance
    ? entranceOutside(origin, entry, configuredEntrance.side, configuredEntrance.offset)
    : origin;
  return {
    id: String(row.id),
    taskNumber: Number(row.task_number ?? 0),
    cityId: String(row.city_id),
    districtId: String(row.district_id),
    title: String(row.title),
    description: String(row.description),
    workItemType: String(row.work_item_type ?? "TASK") as WorkItemType,
    acceptanceCriteria: String(row.acceptance_criteria ?? ""),
    systemAnalysis: String(row.system_analysis ?? ""),
    architecture: String(row.architecture ?? ""),
    designSystem: String(row.design_system ?? ""),
    implementationPlan: String(row.implementation_plan ?? ""),
    estimate: Number(row.estimate) as Estimate,
    priority: String(row.priority) as TaskPriority,
    status,
    progress: Number(row.progress),
    dueAt: row.due_at ? String(row.due_at) : null,
    buildingType,
    visualKind: String(row.visual_kind ?? "BUILDING") as TaskDto["visualKind"],
    visualAssetKey: String(row.visual_asset_key ?? buildingType),
    platformType: String(row.platform_type) as TaskDto["platformType"],
    origin,
    footprint: json<Cell[]>(row.footprint_json),
    entrance: row.entrance_x == null || row.entrance_y == null
      ? fallbackEntrance
      : { x: Number(row.entrance_x), y: Number(row.entrance_y) },
    accessPath: row.access_json ? json<Cell[]>(row.access_json) : [],
    accessKind: String(row.access_kind ?? "PATH") as TaskDto["accessKind"],
    stage: TASK_STAGE[status],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    mergeRequests: json<TaskLinkDto[]>(row.merge_requests_json ?? []),
    assigneeRole: row.assignee_role ? String(row.assignee_role) : null,
  };
}

/** Protect authored screen mass as well as temporary construction fencing. */
function taskOccupiedCells(task: TaskDto): Cell[] {
  if (task.footprint.length === 0) return task.footprint;
  // A release may remove an authored family before the one-time world replay
  // rewrites stored task rows. Preserve the saved physical footprint during
  // that narrow migration window; strict catalog lookup here would prevent
  // both the server and the regeneration CLI from starting at all.
  const entry = BUILDING_CATALOG.find((candidate) => candidate.key === task.buildingType);
  const northSetback = task.visualKind === "BUILDING" && entry ? buildingVisualSetbackCells(entry) : 0;
  const visual = task.visualKind === "BUILDING" && entry
    ? rectangleFootprint(
        { x: task.origin.x, y: task.origin.y - northSetback },
        entry.footprint.width,
        entry.footprint.height + northSetback,
      )
    : task.footprint;
  if (task.stage >= 5) return visual;
  const bounds = expandRect(boundsOf(task.footprint), 1);
  const construction = rectangleFootprint(
    { x: bounds.minX, y: bounds.minY },
    bounds.maxX - bounds.minX + 1,
    bounds.maxY - bounds.minY + 1,
  );
  return [...new Map([...visual, ...construction].map((cell) => [cellKey(cell), cell])).values()];
}

function archiveStage(recordCount: number): CountryArchiveDto["stage"] {
  if (recordCount >= 10) return 4;
  if (recordCount >= 6) return 3;
  if (recordCount >= 3) return 2;
  return 1;
}

function archiveDto(row: Row): CountryArchiveDto {
  const recordCount = Number(row.record_count ?? 0);
  return {
    id: String(row.id),
    countryId: String(row.country_id),
    name: "Государственный архив",
    stage: archiveStage(recordCount),
    recordCount,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function archiveRecordDto(row: Row): ArchiveRecordDto {
  return {
    id: String(row.id),
    archiveId: String(row.archive_id),
    countryId: String(row.country_id),
    kind: String(row.kind) as ArchiveRecordKind,
    title: String(row.title),
    body: String(row.body ?? ""),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    tags: json<string[]>(row.tags_json ?? []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function attachmentDto(row: Row): TaskAttachmentDto {
  return {
    id: String(row.id), taskId: String(row.task_id), fileName: String(row.file_name),
    mimeType: String(row.mime_type), sizeBytes: Number(row.size_bytes),
    actor: String(row.actor), createdAt: String(row.created_at),
  };
}

function taskDocumentDto(row: Row): TaskDocumentDto {
  return {
    id: String(row.id), taskId: String(row.task_id), fileName: String(row.file_name), title: String(row.title),
    content: String(row.content ?? ""), isDefault: Boolean(row.is_default), position: Number(row.position),
    actor: String(row.actor), updatedAt: String(row.updated_at),
  };
}

function taskChecklistItemDto(row: Row): TaskChecklistItemDto {
  return {
    id: String(row.id), taskId: String(row.task_id), title: String(row.title), done: Boolean(row.done),
    position: Number(row.position), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

const DEFAULT_TASK_DOCUMENTS = [
  { fileName: "system-analysis.md", title: "Системный анализ", position: 0, legacyField: "system_analysis" },
  { fileName: "architecture.md", title: "Архитектура", position: 1, legacyField: "architecture" },
  { fileName: "design-system.md", title: "Дизайн-система", position: 2, legacyField: "design_system" },
  { fileName: "implementation-plan.md", title: "План реализации", position: 3, legacyField: "implementation_plan" },
] as const;

function markdownFileName(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value.length > 82 || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(value)) {
    throw new DomainError("INVALID_INPUT", "Имя документа должно быть в kebab-case и заканчиваться на .md");
  }
  return value;
}

function normalizeLinkUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new DomainError("INVALID_INPUT", "Ссылка должна быть полным URL, например https://gitlab.example.com/repo/-/merge_requests/1");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new DomainError("INVALID_INPUT", "Допустимы только http/https-ссылки");
  return parsed.toString();
}

function sanitizeFileName(raw: string): string {
  const cleaned = raw.trim().replaceAll("\\", "/").split("/").pop()!.replaceAll(/[^\p{L}\p{N}._() -]/gu, "_").slice(0, 160);
  if (!cleaned) throw new DomainError("INVALID_INPUT", "Некорректное имя файла");
  return cleaned;
}

const DEFECT_TRANSITIONS: Record<TaskDefectDto["status"], ReadonlySet<TaskDefectDto["status"]>> = {
  OPEN: new Set(["OPEN", "IN_PROGRESS", "FIXED"]),
  IN_PROGRESS: new Set(["IN_PROGRESS", "VERIFYING"]),
  VERIFYING: new Set(["VERIFYING", "IN_PROGRESS", "FIXED"]),
  FIXED: new Set(["FIXED", "OPEN"]),
};

function featureDto(row: Row): WorldFeatureDto {
  return {
    id: String(row.id),
    cityId: row.city_id ? String(row.city_id) : null,
    districtId: row.district_id ? String(row.district_id) : null,
    parentFeatureId: row.parent_feature_id ? String(row.parent_feature_id) : null,
    kind: String(row.kind) as WorldFeatureDto["kind"],
    assetKind: String(row.asset_kind) as WorldFeatureDto["assetKind"],
    assetKey: String(row.asset_key),
    origin: { x: Number(row.origin_x), y: Number(row.origin_y) },
    footprint: json<Cell[]>(row.footprint_json),
    orientation: String(row.orientation) as WorldFeatureDto["orientation"],
    accessPath: row.access_json ? json<Cell[]>(row.access_json) : [],
    developmentStage: Math.max(1, Math.min(5, Number(row.development_stage ?? 5))) as WorldFeatureDto["developmentStage"],
  };
}

function rectForCenter(center: Cell, size = CITY_SIZE): Rect {
  const half = Math.floor(size / 2);
  return { minX: center.x - half, minY: center.y - half, maxX: center.x + size - half - 1, maxY: center.y + size - half - 1 };
}

function unionRect(a: Rect, b: Rect): Rect {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

type ChunkDefectSummary = NonNullable<ChunkTaskDto["defectSummary"]>;
type ViewportSpatialSnapshot = {
  roads: RoadCellDto[];
  districts: DistrictDto[];
  cities: CityDto[];
  tasks: TaskDto[];
  features: WorldFeatureDto[];
  defectSummaryByTask: Map<string, ChunkDefectSummary>;
};

type GenerationSpatialSnapshot = {
  bounds: Rect;
  roads: Map<string, RoadCellDto>;
  districts: DistrictDto[];
  cities: CityDto[];
  tasks: TaskDto[];
  features: WorldFeatureDto[];
};

export interface WorldGenerationDispatcher {
  execute<T>(
    countryId: string,
    operation: "city.create" | "district.create" | "task.create" | "country.regenerate",
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<T>;
}

export class AppService {
  private readonly roadCache = new Map<string, { worldVersion: number; cells: Map<string, RoadCellDto> }>();
  private readonly surfaceCache = new Map<string, { worldVersion: number; cells: Map<string, SurfaceCellDto> }>();
  private readonly chunkCache = new Map<string, ChunkPayloadDto>();
  private readonly pendingChunkBuilds = new Map<string, Promise<ChunkPayloadDto>>();
  private readonly knownWorldVersions = new Map<string, number>();
  private readonly countryAtlasCache = new Map<string, { atlas: CountryAtlasDto }>();
  private readonly countryOverviewCache = new Map<string, CountryOverviewDto>();
  private readonly citySceneCache = new Map<string, CitySceneDto>();
  // A desktop viewport can hold a few dozen chunks in two LODs. Keeping only
  // 64 entries caused one user's zoom to evict the previous level and denied
  // concurrent viewers any cache reuse. 512 remains a small bounded footprint
  // while covering several active viewports.
  private static readonly CHUNK_CACHE_LIMIT = 512;
  private static readonly PUBLISHED_CHUNK_LIMIT_PER_COUNTRY = 2048;

  constructor(
    private readonly db: Db,
    private readonly onEvent?: (event: RealtimeEvent) => void,
    private readonly uploadDir: string = config.uploadDir,
    private readonly generationDispatcher?: WorldGenerationDispatcher,
    private readonly sharedWorldCache?: SharedWorldCache,
  ) {}

  private sharedChunkKey(cacheKey: string, worldVersion: number): string {
    return `chunk:${cacheKey}:${worldVersion}`;
  }

  private validChunkIdentity(payload: ChunkPayloadDto | undefined, chunkX: number, chunkY: number, lod: ChunkLod): payload is ChunkPayloadDto {
    return Boolean(payload
      && payload.chunkX === chunkX && payload.chunkY === chunkY && payload.lod === lod
      && (payload.payloadVersion === 2 && payload.generatorVersion === "square-v8"
        || payload.payloadVersion === 1 && payload.generatorVersion === "square-v7"));
  }

  private validSharedChunk(payload: ChunkPayloadDto | undefined, chunkX: number, chunkY: number, lod: ChunkLod, worldVersion: number): payload is ChunkPayloadDto {
    return this.validChunkIdentity(payload, chunkX, chunkY, lod) && payload.publishedVersion === worldVersion;
  }

  async onboardUser(input: RegistrationInput): Promise<Awaited<ReturnType<typeof registerUser>>> {
    return transaction(this.db, async () => {
      const registered = await registerUser(this.db, input);
      if (input.cityName) {
        // The first city is part of the registration invariant: either the
        // account, country, session and city all commit, or none do. A queued
        // worker cannot observe a job inside this uncommitted transaction, so
        // onboarding intentionally uses the canonical implementation directly.
        // Every post-onboarding generation command still goes through the
        // durable dispatcher in web/MCP runtimes.
        const onboardingService = this.generationDispatcher
          ? new AppService(this.db, this.onEvent, this.uploadDir, undefined, this.sharedWorldCache)
          : this;
        await onboardingService.createCity(registered.user.countryId, {
          name: input.cityName,
          idempotencyKey: `onboarding:${registered.user.id}`,
        });
      }
      return registered;
    });
  }

  private cachedChunk(key: string): ChunkPayloadDto | undefined {
    const cached = this.chunkCache.get(key);
    if (!cached) return undefined;
    // Refresh insertion order so the bounded map behaves as an LRU. Published
    // payloads have their own content validator and survive unrelated events.
    this.chunkCache.delete(key);
    this.chunkCache.set(key, cached);
    return cached;
  }

  private storeChunk(key: string, chunk: ChunkPayloadDto): ChunkPayloadDto {
    this.chunkCache.set(key, chunk);
    while (this.chunkCache.size > AppService.CHUNK_CACHE_LIMIT) {
      const oldest = this.chunkCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.chunkCache.delete(oldest);
    }
    return chunk;
  }

  private chunkInvalidationScope(event: RealtimeEvent): "NONE" | "ALL" | Rect {
    if (event.type === "task.comment_added" || event.type === "task.assignee_changed"
      || event.type === "country.profile_updated" || event.type === "archive.record_updated") return "NONE";
    const candidate = event.payload.affectedBounds as Partial<Rect> | undefined;
    const hasBounds = candidate
      && [candidate.minX, candidate.minY, candidate.maxX, candidate.maxY].every(Number.isFinite);
    // Road and district generation can touch connectors beyond the published
    // entity envelope, so structural mutations conservatively clear this
    // country. Metadata, status and defect changes remain chunk-local.
    const boundedMutation = new Set([
      "task.status_changed", "task.fields_updated", "task.defect_created", "task.defect_updated",
      "task.renamed", "city.updated", "city.renamed", "district.updated", "district.renamed",
      "district.activated", "district.completed",
      "archive.record_created", "archive.record_deleted",
    ]).has(event.type);
    return boundedMutation && hasBounds ? candidate as Rect : "ALL";
  }

  private invalidateChunkCache(countryId: string, event: RealtimeEvent): void {
    const scope = this.chunkInvalidationScope(event);
    if (scope === "NONE") return;
    if (scope === "ALL") {
      for (const key of this.chunkCache.keys()) if (key.startsWith(`${countryId}:`)) this.chunkCache.delete(key);
      return;
    }
    const bounds = scope;
    const minChunkX = floorDiv(bounds.minX, CHUNK_SIZE);
    const maxChunkX = floorDiv(bounds.maxX, CHUNK_SIZE);
    const minChunkY = floorDiv(bounds.minY, CHUNK_SIZE);
    const maxChunkY = floorDiv(bounds.maxY, CHUNK_SIZE);
    for (const key of this.chunkCache.keys()) {
      const [keyCountry, rawX, rawY] = key.split(":");
      const chunkX = Number(rawX);
      const chunkY = Number(rawY);
      if (keyCountry === countryId && chunkX >= minChunkX && chunkX <= maxChunkX && chunkY >= minChunkY && chunkY <= maxChunkY) {
        this.chunkCache.delete(key);
      }
    }
  }

  private async invalidatePublishedChunkPayloads(countryId: string, event: RealtimeEvent): Promise<void> {
    const scope = this.chunkInvalidationScope(event);
    if (scope === "NONE") return;
    if (scope === "ALL") {
      await this.db.prepare("DELETE FROM world_chunk_payloads_v1 WHERE country_id = ?").run(countryId);
      return;
    }
    await this.db.prepare(`DELETE FROM world_chunk_payloads_v1 WHERE country_id = ?
      AND chunk_x BETWEEN ? AND ? AND chunk_y BETWEEN ? AND ?`).run(
      countryId,
      floorDiv(scope.minX, CHUNK_SIZE), floorDiv(scope.maxX, CHUNK_SIZE),
      floorDiv(scope.minY, CHUNK_SIZE), floorDiv(scope.maxY, CHUNK_SIZE),
    );
  }

  /**
   * Applies a durable event committed by another runtime. PostgreSQL remains
   * canonical; the event only advances the local version fence and evicts
   * disposable projections that could otherwise mix old roads with new tasks.
   */
  acceptExternalEvent(event: RealtimeEvent): void {
    const cachedAtlas = this.countryAtlasCache.get(event.countryId);
    if (!cachedAtlas || event.worldVersion > cachedAtlas.atlas.worldVersion) {
      const atlasImpact = countryAtlasEventImpact(event);
      if (atlasImpact === "STRUCTURE") this.countryAtlasCache.delete(event.countryId);
      else if (atlasImpact === "TASK_PROGRESS" && cachedAtlas) {
        cachedAtlas.atlas = patchCountryAtlasTaskProgress(cachedAtlas.atlas, event);
      }
    }
    if (countryAtlasEventImpact(event) !== "NONE") {
      for (const key of this.countryOverviewCache.keys()) if (key.includes(`:${event.countryId}:`)) this.countryOverviewCache.delete(key);
    }
    if (this.chunkInvalidationScope(event) !== "NONE") {
      for (const key of this.citySceneCache.keys()) if (key.startsWith(`${event.countryId}:`)) this.citySceneCache.delete(key);
    }
    const knownVersion = this.knownWorldVersions.get(event.countryId) ?? 0;
    if (event.worldVersion <= knownVersion) return;
    this.knownWorldVersions.set(event.countryId, event.worldVersion);
    this.invalidateChunkCache(event.countryId, event);
    if (this.chunkInvalidationScope(event) !== "NONE") {
      this.roadCache.delete(event.countryId);
      this.surfaceCache.delete(event.countryId);
    }
  }

  private async countryRow(countryId: string): Promise<Row> {
    const row = await this.db.prepare("SELECT * FROM countries WHERE id = ?").get(countryId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Страна не найдена");
    return row;
  }

  private async createEvent(countryId: string, type: string, payload: Record<string, unknown>): Promise<RealtimeEvent> {
    let eventPayload = payload;
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    if (type.startsWith("task.") && type !== "task.comment_added" && taskId && !payload.building) {
      const building = await this.buildingEventContext(countryId, taskId);
      if (building) eventPayload = { ...payload, building };
    }
    await this.db.prepare("UPDATE countries SET world_version = world_version + 1 WHERE id = ?").run(countryId);
    const country = await this.countryRow(countryId);
    const createdAt = now();
    const version = Number(country.world_version);
    const result = await this.db.prepare("INSERT INTO events (country_id, type, world_version, payload_json, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
                      .run(countryId, type, version, JSON.stringify(eventPayload), createdAt);
    return { id: Number(result.rows[0]?.id), countryId, type, worldVersion: version, payload: eventPayload, createdAt };
  }

  private async buildingEventContext(countryId: string, taskId: string): Promise<BuildingEventContext | undefined> {
    const row = await this.db.prepare(`SELECT
      task.id, task.task_number, task.title, task.visual_kind, task.status, task.progress, task.origin_x, task.origin_y,
      country.id AS country_id, country.name AS country_name,
      city.id AS city_id, city.name AS city_name, city.center_x AS city_center_x, city.center_y AS city_center_y, city.bounds_json AS city_bounds_json,
      district.id AS district_id, district.name AS district_name
      FROM tasks_v3 task
      JOIN cities_v3 city ON city.id = task.city_id
      JOIN countries country ON country.id = city.country_id
      JOIN districts_v3 district ON district.id = task.district_id
      WHERE task.id = ? AND city.country_id = ?`).get(taskId, countryId) as Row | undefined;
    if (!row) return undefined;
    const status = String(row.status) as TaskStatus;
    return {
      id: String(row.id),
      taskNumber: Number(row.task_number),
      title: String(row.title),
      visualKind: String(row.visual_kind ?? "BUILDING") as BuildingEventContext["visualKind"],
      status,
      progress: Number(row.progress),
      stage: TASK_STAGE[status],
      origin: { x: Number(row.origin_x), y: Number(row.origin_y) },
      country: { id: String(row.country_id), name: String(row.country_name) },
      city: {
        id: String(row.city_id),
        name: String(row.city_name),
        center: { x: Number(row.city_center_x), y: Number(row.city_center_y) },
        bounds: json<Rect>(row.city_bounds_json),
      },
      district: { id: String(row.district_id), name: String(row.district_name) },
    };
  }

  private async mutate<T>(countryId: string, operation: string, idempotencyKey: string, payload: unknown, callback: () => Promise<{ data: T; eventType: string; eventPayload: Record<string, unknown> }> | { data: T; eventType: string; eventPayload: Record<string, unknown> }): Promise<T> {
    if (!idempotencyKey || idempotencyKey.length > 160) throw new DomainError("INVALID_INPUT", "Нужен корректный idempotencyKey");
    const requestHash = stableHash(payload);
    const existing = await this.db.prepare("SELECT request_hash, response_json FROM idempotency WHERE country_id = ? AND operation = ? AND idempotency_key = ?")
                      .get(countryId, operation, idempotencyKey) as Row | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) throw new DomainError("CONFLICT", "Этот idempotencyKey уже использован с другими данными");
      return json<T>(existing.response_json);
    }
    let emitted: RealtimeEvent | undefined;
    let data: T;
    try {
      data = await transaction(this.db, async () => {
                                await this.db.prepare("SELECT id FROM countries WHERE id = ? FOR UPDATE").get(countryId);
                                const raced = await this.db.prepare("SELECT request_hash, response_json FROM idempotency WHERE country_id = ? AND operation = ? AND idempotency_key = ?")
                                                                                                      .get(countryId, operation, idempotencyKey) as Row | undefined;
                                if (raced) {
                                  if (raced.request_hash !== requestHash) throw new DomainError("CONFLICT", "Этот idempotencyKey уже использован с другими данными");
                                  return json<T>(raced.response_json);
                                }
                                const result = await callback();
                                emitted = await this.createEvent(countryId, result.eventType, result.eventPayload);
                                // Published payloads are disposable projections.
                                // Invalidate them in the same transaction as the
                                // canonical mutation so a restart cannot revive
                                // geometry that is already stale.
                                await this.invalidatePublishedChunkPayloads(countryId, emitted);
                                await this.db.prepare("INSERT INTO idempotency (country_id, operation, idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
                                                                          .run(countryId, operation, idempotencyKey, requestHash, JSON.stringify(result.data), now());
                                return result.data;
                              });
    } catch (error) {
      // Road changes may have touched the in-memory index before a later
      // invariant failed. Dropping it guarantees the next read reflects the
      // rolled-back database transaction.
      this.roadCache.delete(countryId);
      this.surfaceCache.delete(countryId);
      throw error;
    }
    onTransactionRollback(() => {
      this.roadCache.delete(countryId);
      this.surfaceCache.delete(countryId);
    });
    if (emitted) {
      const committedEvent = emitted;
      onTransactionCommit(() => {
        this.acceptExternalEvent(committedEvent);
        this.onEvent?.(committedEvent);
      });
    }
    return data;
  }

  async getBootstrap(user: AuthUser): Promise<BootstrapDto> {
    const stats = await this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM cities_v3 WHERE country_id = ?) AS cities,
      (SELECT COUNT(*) FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE c.country_id = ?) AS districts,
      (SELECT COUNT(*) FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ?) AS tasks,
      (SELECT COUNT(*) FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE c.country_id = ? AND d.status = 'ACTIVE') AS active_districts,
      (SELECT COUNT(*) FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? AND t.status <> 'COMPLETED') AS unfinished_buildings,
      (SELECT COALESCE(MAX(id), 0) FROM events WHERE country_id = ?) AS event_cursor`)
                      .get(user.countryId, user.countryId, user.countryId, user.countryId, user.countryId, user.countryId) as Row;
    const initialCityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE country_id = ? ORDER BY created_at LIMIT 1").get(user.countryId) as Row | undefined;
    const published = await this.db.prepare(`SELECT
      MIN((bounds_json->>'minX')::integer) AS min_x,
      MIN((bounds_json->>'minY')::integer) AS min_y,
      MAX((bounds_json->>'maxX')::integer) AS max_x,
      MAX((bounds_json->>'maxY')::integer) AS max_y
      FROM cities_v3 WHERE country_id = ?`).get(user.countryId) as Row;
    const viewBounds = Number(stats.cities) === 0
      ? { minX: -COUNTRY_VIEW_MARGIN, minY: -COUNTRY_VIEW_MARGIN, maxX: COUNTRY_VIEW_MARGIN - 1, maxY: COUNTRY_VIEW_MARGIN - 1 }
      : {
        minX: Number(published.min_x) - COUNTRY_VIEW_MARGIN,
        minY: Number(published.min_y) - COUNTRY_VIEW_MARGIN,
        maxX: Number(published.max_x) + COUNTRY_VIEW_MARGIN,
        maxY: Number(published.max_y) + COUNTRY_VIEW_MARGIN,
      };
    const country = await this.getCountry(user.countryId);
    const countryRow = await this.countryRow(user.countryId);
    const worldManifest: BootstrapDto["worldManifest"] = {
      terrainSeed: Number(countryRow.seed),
      generatorVersion: country.generatorVersion,
      assetRevision: ASSET_REVISION,
      worldRevision: country.worldVersion,
      chunkSize: CHUNK_SIZE,
      viewBounds,
    };
    return {
      user: { id: user.id, email: user.email, name: user.name },
      country,
      countries: await Promise.all((await listAccessibleCountries(this.db, user.id)).map(async (access) => ({
                                ...await this.getCountry(access.id), role: access.role, memberCount: access.memberCount,
                              }))),
      countryRole: user.countryRole,
      archive: await this.getArchive(user.countryId),
      initialCity: initialCityRow ? cityDto(initialCityRow) : null,
      viewBounds,
      worldManifest,
      eventCursor: Number(stats.event_cursor),
      stats: {
        cities: Number(stats.cities), districts: Number(stats.districts), tasks: Number(stats.tasks),
        activeDistricts: Number(stats.active_districts), unfinishedBuildings: Number(stats.unfinished_buildings),
      },
      chunkSize: CHUNK_SIZE,
      assetVersion: 4,
    };
  }

  async getPlanetAtlas(userId: string): Promise<PlanetAtlasDto> {
    const rows = await this.db.prepare(`
      WITH accessible AS (
        SELECT c.id, c.name, c.seed, c.world_version, c.created_at
        FROM country_members membership
        JOIN countries c ON c.id = membership.country_id
        WHERE membership.user_id = ?
      ), city_stats AS (
        SELECT city.country_id, COUNT(*)::integer AS city_count
        FROM cities_v3 city
        JOIN accessible country ON country.id = city.country_id
        GROUP BY city.country_id
      ), district_stats AS (
        SELECT city.country_id, COUNT(district.id)::integer AS district_count
        FROM cities_v3 city
        JOIN accessible country ON country.id = city.country_id
        JOIN districts_v3 district ON district.city_id = city.id
        GROUP BY city.country_id
      ), task_stats AS (
        SELECT city.country_id,
          COUNT(task.id)::integer AS building_count,
          COUNT(task.id) FILTER (WHERE task.status <> 'COMPLETED')::integer AS unfinished_building_count,
          COALESCE(ROUND(AVG(task.progress)), 0)::integer AS progress
        FROM cities_v3 city
        JOIN accessible country ON country.id = city.country_id
        JOIN tasks_v3 task ON task.city_id = city.id
        GROUP BY city.country_id
      )
      SELECT country.id, country.name, country.seed, country.world_version, country.created_at,
        COALESCE(city_stats.city_count, 0) AS city_count,
        COALESCE(district_stats.district_count, 0) AS district_count,
        COALESCE(task_stats.building_count, 0) AS building_count,
        COALESCE(task_stats.unfinished_building_count, 0) AS unfinished_building_count,
        COALESCE(task_stats.progress, 0) AS progress
      FROM accessible country
      LEFT JOIN city_stats ON city_stats.country_id = country.id
      LEFT JOIN district_stats ON district_stats.country_id = country.id
      LEFT JOIN task_stats ON task_stats.country_id = country.id
      ORDER BY country.created_at, country.id
    `).all(userId) as Row[];
    const countries = rows.map((row) => ({
      id: String(row.id), name: String(row.name), seed: Number(row.seed), worldVersion: Number(row.world_version),
      cityCount: Number(row.city_count), districtCount: Number(row.district_count), buildingCount: Number(row.building_count),
      unfinishedBuildingCount: Number(row.unfinished_building_count),
      progress: Math.max(0, Math.min(100, Number(row.progress))),
    }));
    const revisionSource = countries.map((country) => `${country.id}:${country.name}:${country.worldVersion}:${country.cityCount}:${country.districtCount}:${country.buildingCount}:${country.unfinishedBuildingCount}:${country.progress}`).join("|");
    const revision = createHash("sha256").update(revisionSource).digest("hex").slice(0, 16);
    const planetSeed = createHash("sha256").update(`tasktopia-planet:${userId}`).digest().readUInt32LE(0) & 0x7fffffff;
    return { schemaVersion: PLANET_ATLAS_SCHEMA_VERSION, planetSeed, revision, countries };
  }

  async getWorldManifest(user: AuthUser): Promise<BootstrapDto["worldManifest"]> {
    const [country, row, published] = await Promise.all([
      this.getCountry(user.countryId),
      this.countryRow(user.countryId),
      this.db.prepare(`SELECT
        MIN((bounds_json->>'minX')::integer) AS min_x,
        MIN((bounds_json->>'minY')::integer) AS min_y,
        MAX((bounds_json->>'maxX')::integer) AS max_x,
        MAX((bounds_json->>'maxY')::integer) AS max_y
        FROM cities_v3 WHERE country_id = ?`).get(user.countryId) as Promise<Row>,
    ]);
    const viewBounds = published.min_x == null
      ? { minX: -COUNTRY_VIEW_MARGIN, minY: -COUNTRY_VIEW_MARGIN, maxX: COUNTRY_VIEW_MARGIN - 1, maxY: COUNTRY_VIEW_MARGIN - 1 }
      : {
        minX: Number(published.min_x) - COUNTRY_VIEW_MARGIN,
        minY: Number(published.min_y) - COUNTRY_VIEW_MARGIN,
        maxX: Number(published.max_x) + COUNTRY_VIEW_MARGIN,
        maxY: Number(published.max_y) + COUNTRY_VIEW_MARGIN,
      };
    return {
      terrainSeed: Number(row.seed), generatorVersion: country.generatorVersion,
      assetRevision: ASSET_REVISION, worldRevision: country.worldVersion,
      chunkSize: CHUNK_SIZE, viewBounds,
    };
  }

  async getCountry(countryId: string): Promise<CountryDto> {
    const row = await this.countryRow(countryId);
    return {
      id: String(row.id), name: String(row.name), description: String(row.description ?? ""), goal: String(row.goal ?? ""),
      productContext: String(row.product_context ?? ""), successCriteria: String(row.success_criteria ?? ""), constraints: String(row.constraints ?? ""),
      worldVersion: Number(row.world_version), generatorVersion: "square-v7", createdAt: String(row.created_at),
    };
  }

  async updateCountryProfile(countryId: string, input: {
    description?: string; goal?: string; productContext?: string; successCriteria?: string; constraints?: string; idempotencyKey: string;
  }): Promise<CountryDto> {
    return this.mutate(countryId, "country.profile.v18", input.idempotencyKey, input, async () => {
      const current = await this.getCountry(countryId);
      const description = input.description === undefined ? current.description : input.description.trim().slice(0, 8000);
      const goal = input.goal === undefined ? current.goal : input.goal.trim().slice(0, 4000);
      const productContext = input.productContext === undefined ? current.productContext : input.productContext.trim().slice(0, 8000);
      const successCriteria = input.successCriteria === undefined ? current.successCriteria : input.successCriteria.trim().slice(0, 8000);
      const constraints = input.constraints === undefined ? current.constraints : input.constraints.trim().slice(0, 8000);
      await this.db.prepare(`UPDATE countries SET description = ?, goal = ?, product_context = ?, success_criteria = ?, constraints = ? WHERE id = ?`)
        .run(description, goal, productContext, successCriteria, constraints, countryId);
      const data = await this.getCountry(countryId);
      return { data, eventType: "country.profile_updated", eventPayload: { countryId } };
    });
  }

  /**
   * Rebuild all spatial data in an isolated temporary country, then copy the
   * finished geometry over in one transaction. Product identities and work
   * history never leave their original rows; a failed generation rolls back
   * without exposing a half-built world.
   */
  async regenerateCountry(countryId: string, input: { confirmName: string; idempotencyKey: string }): Promise<{
    regenerated: true; countryId: string; seed: number; cities: number; districts: number; tasks: number;
  }> {
    if (this.generationDispatcher) {
      return this.generationDispatcher.execute(countryId, "country.regenerate", input.idempotencyKey, input);
    }
    return await this.mutate(countryId, "country.regenerate.v1", input.idempotencyKey, input, async () => {
      const country = await this.countryRow(countryId);
      if (input.confirmName.trim() !== String(country.name)) {
        throw new DomainError("CONFIRMATION_MISMATCH", "Для перегенерации укажите точное текущее название страны");
      }
      const cities = await this.listCities(countryId);
      const districts = await this.listDistricts(countryId);
      const tasks = await this.listTasks(countryId);
      const oldBounds = cities.length > 0 ? cities.map((city) => city.bounds).reduce(unionRect) : undefined;
      // Regeneration must be reproducible. A new idempotency key deliberately
      // produces a new world, while the same source seed and key always replay
      // the same geometry — without a wall-clock value that makes incidents
      // impossible to reproduce in tests or production diagnostics.
      const seedBytes = createHash("sha256").update(`${country.seed}:${input.idempotencyKey}`).digest();
      let seed = seedBytes.readUInt32LE(0) & 0x7fff_ffff;
      if (seed === Number(country.seed)) seed = (seed + 1) & 0x7fff_ffff;
      const temporaryCountryId = randomUUID();
      await this.db.prepare(`INSERT INTO countries (id, user_id, name, seed, world_version, created_at)
        VALUES (?, ?, ?, ?, 1, ?)`).run(temporaryCountryId, country.user_id, `regeneration-${temporaryCountryId}`, seed, now());

      // Suppress realtime publication for the disposable build. All nested
      // operations still use the production generator and its invariants.
      const generator = new AppService(this.db);
      const cityMap = new Map<string, string>();
      const districtMap = new Map<string, string>();
      const districtSegments = new Map<string, string[]>();
      const sourceDistrictByGenerated = new Map<string, string>();
      const taskMap = new Map<string, string>();
      const districtsByCity = new Map<string, DistrictDto[]>();
      const tasksByDistrict = new Map<string, TaskDto[]>();
      for (const district of districts) districtsByCity.set(district.cityId, [...districtsByCity.get(district.cityId) ?? [], district]);
      for (const task of tasks) tasksByDistrict.set(task.districtId, [...tasksByDistrict.get(task.districtId) ?? [], task]);
      for (const city of cities) {
        const generated = await generator.createCity(temporaryCountryId, {
          name: city.name, description: city.description, goal: city.goal, acceptanceCriteria: city.acceptanceCriteria,
          deadline: city.deadline ?? undefined, morphology: city.morphology,
          idempotencyKey: `regenerate-city:${city.id}`,
        });
        cityMap.set(city.id, generated.id);
        for (const district of (districtsByCity.get(city.id) ?? []).filter((item) => item.status !== "ABANDONED")) {
          const generatedDistrict = await generator.createDistrict(temporaryCountryId, {
            cityId: generated.id, name: district.name, goal: district.goal, description: district.description,
            deadline: district.deadline ?? undefined, capacitySp: district.capacitySp,
            activate: district.status === "ACTIVE", archetype: district.archetype,
            idempotencyKey: `regenerate-district:${district.id}`,
          });
          districtMap.set(district.id, generatedDistrict.id);
          districtSegments.set(district.id, [generatedDistrict.id]);
          sourceDistrictByGenerated.set(generatedDistrict.id, district.id);
          let currentGeneratedDistrict = generatedDistrict;
          let continuation = 0;
          for (const task of tasksByDistrict.get(district.id) ?? []) {
            const createGeneratedTask = () => generator.createTask(temporaryCountryId, {
                cityId: generated.id, districtId: currentGeneratedDistrict.id, title: task.title,
                description: task.description, workItemType: task.workItemType, acceptanceCriteria: task.acceptanceCriteria,
                systemAnalysis: task.systemAnalysis, architecture: task.architecture, designSystem: task.designSystem,
                implementationPlan: task.implementationPlan, estimate: task.estimate, priority: task.priority,
                dueAt: task.dueAt ?? undefined,
                visualKind: task.visualKind,
                parkVariant: task.visualKind === "PARK" ? task.visualAssetKey : undefined,
                idempotencyKey: `regenerate-task:${task.id}`,
              });
            let generatedTask: TaskDto | undefined;
            while (!generatedTask) {
              try {
                generatedTask = await createGeneratedTask();
              } catch (error) {
                if (!(error instanceof DomainError) || error.code !== "PLACEMENT_BLOCKED" || continuation >= 8) throw error;
                continuation += 1;
                currentGeneratedDistrict = await generator.createDistrict(temporaryCountryId, {
                  cityId: generated.id,
                  name: `${district.name} · продолжение ${continuation}`,
                  goal: district.goal,
                  description: district.description,
                  deadline: district.deadline ?? undefined,
                  capacitySp: district.capacitySp,
                  activate: false,
                  archetype: district.archetype,
                  idempotencyKey: `regenerate-district:${district.id}:continuation:${continuation}`,
                });
                districtSegments.get(district.id)!.push(currentGeneratedDistrict.id);
                sourceDistrictByGenerated.set(currentGeneratedDistrict.id, district.id);
              }
            }
            taskMap.set(task.id, generatedTask.id);
          }
        }
      }

      const generatedCities = new Map((await generator.listCities(temporaryCountryId)).map((city) => [city.id, city]));
      const generatedDistricts = new Map((await generator.listDistricts(temporaryCountryId)).map((district) => [district.id, district]));
      const generatedTasks = new Map((await generator.listTasks(temporaryCountryId)).map((task) => [task.id, task]));
      const reverseTaskMap = new Map([...taskMap].map(([original, generated]) => [generated, original]));
      const originalCityByGenerated = new Map([...cityMap].map(([original, generated]) => [generated, original]));
      const originalDistrictByGenerated = new Map([...sourceDistrictByGenerated].map(([generated, original]) => [generated, original]));
      for (const city of cities) {
        const generated = generatedCities.get(cityMap.get(city.id)!);
        if (!generated) throw new DomainError("REGENERATION_FAILED", "Не удалось восстановить геометрию города");
        await this.db.prepare(`UPDATE cities_v3 SET center_x = ?, center_y = ?, bounds_json = ?, style_id = ? WHERE id = ?`)
          .run(generated.center.x, generated.center.y, JSON.stringify(generated.bounds), generated.styleId, city.id);
      }
      for (const district of districts.filter((item) => item.status !== "ABANDONED")) {
        const segments = (districtSegments.get(district.id) ?? []).map((id) => generatedDistricts.get(id)).filter((item): item is DistrictDto => Boolean(item));
        const generated = segments[0];
        if (!generated || segments.length !== districtSegments.get(district.id)?.length) {
          throw new DomainError("REGENERATION_FAILED", "Не удалось восстановить геометрию района");
        }
        const foreignDistrictCells = new Set([...generatedDistricts.values()]
          .filter((candidate) => !segments.some((segment) => segment.id === candidate.id))
          .flatMap((candidate) => candidate.cells)
          .map(cellKey));
        const generatedCity = generatedCities.get(cityMap.get(district.cityId)!);
        if (!generatedCity) throw new DomainError("REGENERATION_FAILED", "Не удалось восстановить город района");
        const cells = connectReplayDistrictSegments(segments.map((segment) => segment.cells), generatedCity.bounds, foreignDistrictCells);
        const lots = segments.flatMap((segment) => segment.lots)
          .map((lot) => ({ ...lot, taskId: lot.taskId ? reverseTaskMap.get(lot.taskId) ?? null : null }));
        await this.db.prepare(`UPDATE districts_v3 SET cells_json = ?, lots_json = ?, growth_direction = ?, color = ? WHERE id = ?`)
          .run(JSON.stringify(cells), JSON.stringify(lots), generated.growthDirection, generated.color, district.id);
      }
      for (const task of tasks) {
        const generated = generatedTasks.get(taskMap.get(task.id)!);
        if (!generated) throw new DomainError("REGENERATION_FAILED", "Не удалось восстановить геометрию задачи");
        // Geometry AND identity come from the fresh build: the replay picks
        // buildings under the new seed, so the visible model must follow the
        // re-pick instead of freezing the pre-regeneration type.
        const originalDistrictId = originalDistrictByGenerated.get(generated.districtId);
        if (!originalDistrictId) throw new DomainError("REGENERATION_FAILED", "Не удалось сопоставить район задачи");
        await this.db.prepare(`UPDATE tasks_v3 SET district_id = ?, building_type = ?, visual_kind = ?, visual_asset_key = ?, platform_type = ?, origin_x = ?, origin_y = ?, footprint_json = ?,
          entrance_x = ?, entrance_y = ?, access_json = ?, access_kind = ? WHERE id = ?`).run(
          originalDistrictId,
          generated.buildingType, generated.visualKind, generated.visualAssetKey, generated.platformType, generated.origin.x, generated.origin.y, JSON.stringify(generated.footprint),
          generated.entrance.x, generated.entrance.y, JSON.stringify(generated.accessPath), generated.accessKind, task.id,
        );
      }

      await this.db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(countryId);
      await this.db.prepare(`INSERT INTO roads_v3 (country_id, x, y, mask, structure, road_class)
        SELECT ?, x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ?`).run(countryId, temporaryCountryId);
      await this.db.prepare("DELETE FROM world_features_v6 WHERE country_id = ?").run(countryId);
      const generatedFeatures = await generator.listWorldFeatures(temporaryCountryId);
      const featureMap = new Map<string, string>();
      let pending = [...generatedFeatures];
      while (pending.length > 0) {
        const ready = pending.filter((feature) => !feature.parentFeatureId || featureMap.has(feature.parentFeatureId));
        if (ready.length === 0) throw new DomainError("REGENERATION_FAILED", "Нарушена иерархия объектов окружения");
        for (const feature of ready) {
          const copied = await this.insertWorldFeature(countryId, {
            cityId: feature.cityId ? originalCityByGenerated.get(feature.cityId) ?? null : null,
            districtId: feature.districtId ? originalDistrictByGenerated.get(feature.districtId) ?? null : null,
            parentFeatureId: feature.parentFeatureId ? featureMap.get(feature.parentFeatureId) ?? null : null,
            kind: feature.kind, assetKind: feature.assetKind, assetKey: feature.assetKey,
            origin: feature.origin, footprint: feature.footprint, orientation: feature.orientation, accessPath: feature.accessPath,
            developmentStage: feature.developmentStage,
          });
          featureMap.set(feature.id, copied.id);
        }
        const copiedIds = new Set(ready.map((feature) => feature.id));
        pending = pending.filter((feature) => !copiedIds.has(feature.id));
      }
      await this.db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(seed, countryId);
      await this.db.prepare("DELETE FROM countries WHERE id = ?").run(temporaryCountryId);
      // Bulk SQL replacement bypasses the in-memory road index. Archive sync
      // must see the freshly copied graph, otherwise it recalculates masks
      // against the previous world's roads and leaves one-way visual gaps.
      this.roadCache.delete(countryId);
      this.surfaceCache.delete(countryId);
      await this.syncCountryArchiveComplex(countryId);
      this.roadCache.delete(countryId);
      this.surfaceCache.delete(countryId);
      const rebuiltCities = await this.listCities(countryId);
      const newBounds = rebuiltCities.length > 0 ? rebuiltCities.map((city) => city.bounds).reduce(unionRect) : undefined;
      const affectedBounds = oldBounds && newBounds ? unionRect(oldBounds, newBounds) : oldBounds ?? newBounds;
      const data = { regenerated: true as const, countryId, seed, cities: cities.length, districts: districts.length, tasks: tasks.length };
      return { data, eventType: "country.regenerated", eventPayload: { ...data, ...(affectedBounds ? { affectedBounds } : {}) } };
    });
  }

  async listCities(countryId: string): Promise<CityDto[]> {
    return (await this.db.prepare("SELECT * FROM cities_v3 WHERE country_id = ? ORDER BY created_at").all(countryId) as Row[]).map(cityDto);
  }

  private async citiesInBounds(countryId: string, bounds: Rect): Promise<CityDto[]> {
    const rows = await this.db.prepare(`SELECT * FROM cities_v3 WHERE country_id = ?
      AND (bounds_json->>'minX')::integer <= ?
      AND (bounds_json->>'maxX')::integer >= ?
      AND (bounds_json->>'minY')::integer <= ?
      AND (bounds_json->>'maxY')::integer >= ?
      ORDER BY created_at`).all(countryId, bounds.maxX, bounds.minX, bounds.maxY, bounds.minY) as Row[];
    return rows.map(cityDto);
  }

  private async roadsInBounds(countryId: string, bounds: Rect): Promise<Map<string, RoadCellDto>> {
    const rows = await this.db.prepare(`SELECT x, y, mask, structure, road_class FROM roads_v3
      WHERE country_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`)
      .all(countryId, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY) as Row[];
    return new Map(rows.map((row) => {
      const road: RoadCellDto = {
        x: Number(row.x), y: Number(row.y), mask: Number(row.mask),
        structure: String(row.structure) as RoadCellDto["structure"],
        roadClass: String(row.road_class) as RoadCellDto["roadClass"],
      };
      return [cellKey(road), road];
    }));
  }

  private async loadGenerationSpatialSnapshot(countryId: string, bounds: Rect): Promise<GenerationSpatialSnapshot> {
    const [roads, districts, cities, tasks, features] = await Promise.all([
      this.roadsInBounds(countryId, bounds),
      this.districtsInBounds(countryId, bounds),
      this.citiesInBounds(countryId, bounds),
      this.tasksInBounds(countryId, bounds, true),
      this.featuresInBounds(countryId, bounds),
    ]);
    return { bounds, roads, districts, cities, tasks, features };
  }

  async listDistricts(countryId: string, cityId?: string): Promise<DistrictDto[]> {
    const rows = cityId
      ? await this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE c.country_id = ? AND d.city_id = ? ORDER BY d.created_at").all(countryId, cityId)
      : await this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE c.country_id = ? ORDER BY d.created_at").all(countryId);
    return (rows as Row[]).map(districtDto);
  }

  async getCountryAtlas(countryId: string): Promise<CountryAtlasDto> {
    const cached = this.countryAtlasCache.get(countryId);
    if (cached) return cached.atlas;
    const countrySnapshot = await this.getCountry(countryId);
    const [countryRow, country, cities, districts, tasks, features, roadMap, surfaceMap] = await Promise.all([
      this.countryRow(countryId),
      Promise.resolve(countrySnapshot),
      this.listCities(countryId),
      this.listDistricts(countryId),
      this.listTasks(countryId),
      this.listWorldFeatures(countryId),
      this.roadCells(countryId),
      this.surfaceCells(countryId),
    ]);
    const districtsByCity = new Map<string, DistrictDto[]>();
    const tasksByCity = new Map<string, TaskDto[]>();
    const tasksByDistrict = new Map<string, TaskDto[]>();
    for (const district of districts) {
      districtsByCity.set(district.cityId, [...districtsByCity.get(district.cityId) ?? [], district]);
    }
    for (const task of tasks) {
      tasksByCity.set(task.cityId, [...tasksByCity.get(task.cityId) ?? [], task]);
      tasksByDistrict.set(task.districtId, [...tasksByDistrict.get(task.districtId) ?? [], task]);
    }

    const projection = projectCountryAtlas({
      cities: cities.map((city) => ({
        id: city.id,
        sourceCenter: city.center,
        sourceVisualSizePx: {
          width: (city.bounds.maxX - city.bounds.minX + 1) * 8,
          height: (city.bounds.maxY - city.bounds.minY + 1) * 8,
        },
        labelSizePx: { width: 208, height: 48 },
        districts: (districtsByCity.get(city.id) ?? []).map((district) => ({ id: district.id, cells: district.cells })),
      })),
    });
    const cityById = new Map(cities.map((city) => [city.id, city]));
    const districtById = new Map(districts.map((district) => [district.id, district]));
    const atlasDistrictColorById = new Map(districts.map((district, index) => [
      district.id,
      COUNTRY_ATLAS_DISTRICT_COLORS[index % COUNTRY_ATLAS_DISTRICT_COLORS.length]!,
    ]));
    const districtOwnerByCell = new Map(districts.flatMap((district) => district.cells.map((cell) => [cellKey(cell), district.id] as const)));
    const roadsByCity = new Map<string, RoadCellDto[]>();
    const surfacesByCity = new Map<string, SurfaceCellDto[]>();
    for (const road of roadMap.values()) {
      const districtId = districtOwnerByCell.get(cellKey(road));
      const cityId = districtId ? districtById.get(districtId)?.cityId : undefined;
      if (cityId) {
        const cityRoads = roadsByCity.get(cityId);
        if (cityRoads) cityRoads.push(road);
        else roadsByCity.set(cityId, [road]);
      }
    }
    for (const surface of surfaceMap.values()) {
      const districtId = districtOwnerByCell.get(cellKey(surface));
      const cityId = districtId ? districtById.get(districtId)?.cityId : undefined;
      if (cityId) {
        const citySurfaces = surfacesByCity.get(cityId);
        if (citySurfaces) citySurfaces.push(surface);
        else surfacesByCity.set(cityId, [surface]);
      }
    }

    const atlas: CountryAtlasDto = {
      schemaVersion: COUNTRY_ATLAS_SCHEMA_VERSION,
      worldVersion: country.worldVersion,
      terrainSeed: Number(countryRow.seed),
      bounds: projection.bounds,
      connections: projection.connections,
      cities: projection.cities.map((projected) => {
        const city = cityById.get(projected.id)!;
        const projectedDistrictById = new Map(projected.districts.map((district) => [district.id, district]));
        const projectCell = (cell: Cell, districtId: string): Cell => {
          const district = projectedDistrictById.get(districtId);
          if (!district) {
            return {
              x: projected.atlasCenter.x + Math.round((cell.x - city.center.x) * projected.scale),
              y: projected.atlasCenter.y + Math.round((cell.y - city.center.y) * projected.scale),
            };
          }
          return {
            x: district.atlasCenter.x + Math.round((cell.x - district.sourceCenter.x) * projected.scale),
            y: district.atlasCenter.y + Math.round((cell.y - district.sourceCenter.y) * projected.scale),
          };
        };
        const projectFootprint = (cells: Cell[], districtId: string): Cell[] => [...new Map(cells.map((cell) => {
          const atlasCell = projectCell(cell, districtId);
          return [cellKey(atlasCell), atlasCell] as const;
        })).values()];
        const projectedRoads = new Map<string, CountryAtlasDto["cities"][number]["roads"][number]>();
        for (const road of roadsByCity.get(city.id) ?? []) {
          const districtId = districtOwnerByCell.get(cellKey(road));
          if (!districtId) continue;
          const atlasCell = projectCell(road, districtId);
          const projectedKey = cellKey(atlasCell);
          if (!projectedRoads.has(projectedKey)) projectedRoads.set(projectedKey, {
            sourceCell: { x: road.x, y: road.y }, atlasCell, structure: road.structure, roadClass: road.roadClass,
          });
        }
        const projectedSurfaces = new Map<string, CountryAtlasDto["cities"][number]["surfaces"][number]>();
        for (const surface of surfacesByCity.get(city.id) ?? []) {
          const districtId = districtOwnerByCell.get(cellKey(surface));
          if (!districtId) continue;
          const atlasCell = projectCell(surface, districtId);
          const projectedKey = `${cellKey(atlasCell)}:${surface.kind}`;
          if (!projectedSurfaces.has(projectedKey)) projectedSurfaces.set(projectedKey, {
            sourceCell: { x: surface.x, y: surface.y }, atlasCell, kind: surface.kind,
            ...(surface.orientation ? { orientation: surface.orientation } : {}),
            ...(surface.finish ? { finish: surface.finish } : {}),
          });
        }
        return {
          id: city.id,
          name: city.name,
          status: city.status,
          sourceCenter: city.center,
          sourceBounds: city.bounds,
          atlasCenter: projected.atlasCenter,
          atlasBounds: projected.atlasBounds,
          labelBounds: projected.labelBounds,
          labelAnchor: projected.labelAnchor,
          scale: projected.scale,
          miniatureSizePx: projected.miniatureSizePx,
          atlasMask: projected.atlasMask,
          cutoutMask: projected.cutoutMask,
          districts: projected.districts.map((district) => {
            const source = districtById.get(district.id)!;
            const districtTasks = tasksByDistrict.get(source.id) ?? [];
            return {
              id: source.id,
              name: source.name,
              status: source.status,
              color: atlasDistrictColorById.get(source.id) ?? source.color,
              progress: meanCountryAtlasProgress(districtTasks),
              sourceCenter: district.sourceCenter,
              sourceBounds: boundsOf(source.cells),
              atlasCenter: district.atlasCenter,
              atlasCells: district.atlasCells,
              displayCells: district.displayCells,
            };
          }),
          buildings: (tasksByCity.get(city.id) ?? []).map((task) => ({
            id: task.id,
            taskNumber: task.taskNumber,
            districtId: task.districtId,
            title: task.title,
            workItemType: task.workItemType,
            status: task.status,
            progress: task.progress,
            stage: task.stage,
            buildingType: task.buildingType,
            visualKind: task.visualKind,
            visualAssetKey: task.visualAssetKey,
            platformType: task.platformType,
            sourceOrigin: task.origin,
            atlasOrigin: projectCell(task.origin, task.districtId),
            atlasFootprint: projectFootprint(task.footprint, task.districtId),
          })),
          roads: [...projectedRoads.values()],
          surfaces: [...projectedSurfaces.values()],
          features: features.filter((feature) => feature.cityId === city.id).map((feature) => ({
            id: feature.id,
            kind: feature.kind,
            districtId: feature.districtId,
            assetKind: feature.assetKind,
            assetKey: feature.assetKey,
            developmentStage: feature.developmentStage,
            sourceOrigin: feature.origin,
            sourceFootprint: feature.footprint,
            atlasOrigin: projectCell(feature.origin, feature.districtId ?? ""),
            atlasFootprint: projectFootprint(feature.footprint, feature.districtId ?? ""),
          })),
        };
      }),
    };
    this.countryAtlasCache.set(countryId, { atlas });
    return atlas;
  }

  async getCountryOverview(userId: string, countryId: string): Promise<CountryOverviewDto> {
    const planetAtlas = await this.getPlanetAtlas(userId);
    const cacheKey = `${userId}:${countryId}:${planetAtlas.revision}`;
    const cached = this.countryOverviewCache.get(cacheKey);
    if (cached) {
      this.countryOverviewCache.delete(cacheKey);
      this.countryOverviewCache.set(cacheKey, cached);
      return cached;
    }
    const [country, cities, districtRows] = await Promise.all([
      this.countryRow(countryId),
      this.listCities(countryId),
      this.db.prepare(`SELECT d.id, d.city_id, d.name, d.status, d.color,
        COUNT(t.id)::integer AS task_count,
        COALESCE(ROUND(AVG(t.progress)), 0)::integer AS progress
        FROM districts_v3 d
        JOIN cities_v3 c ON c.id = d.city_id
        LEFT JOIN tasks_v3 t ON t.district_id = d.id
        WHERE c.country_id = ?
        GROUP BY d.id, d.city_id, d.name, d.status, d.color, d.created_at
        ORDER BY d.created_at, d.id`).all(countryId) as Promise<Row[]>,
    ]);
    const macroCountry = projectPlanetAtlas(planetAtlas).countries.find((candidate) => candidate.id === countryId);
    const geography = buildCountryGeography({ countryId, seed: Number(country.seed), macroCells: macroCountry?.cells ?? [] });
    const projection = projectCountryOverview(cities.map((city) => ({ id: city.id, sourceCenter: city.center })));
    const cityAnchors = snapCountryCitiesToLand(geography, cities.map((city) => ({ id: city.id, atlasCenter: projection.centers.get(city.id)! })));
    const districtsByCity = new Map<string, CountryOverviewDistrictDto[]>();
    for (const row of districtRows) {
      const district: CountryOverviewDistrictDto = {
        id: String(row.id), name: String(row.name), status: String(row.status) as CountryOverviewDistrictDto["status"],
        color: String(row.color), progress: Number(row.progress), taskCount: Number(row.task_count),
      };
      const cityId = String(row.city_id);
      districtsByCity.set(cityId, [...districtsByCity.get(cityId) ?? [], district]);
    }
    const overviewWithoutRevision = {
      schemaVersion: COUNTRY_OVERVIEW_SCHEMA_VERSION,
      countryId,
      terrainSeed: Number(country.seed),
      bounds: projection.bounds,
      geography: {
        ...geography.grid,
        terrainCodes: encodeCountryTerrain(geography.cells.map((cell) => cell.terrain)),
      },
      cities: cities.map((city) => {
        const districts = districtsByCity.get(city.id) ?? [];
        return {
          id: city.id, name: city.name, status: city.status, sourceCenter: city.center, sourceBounds: city.bounds,
          atlasCenter: cityAnchors.get(city.id) ?? projection.centers.get(city.id)!, progress: meanCountryAtlasProgress(districts), districts,
        };
      }),
      connections: projection.connections,
    };
    const overview: CountryOverviewDto = { ...overviewWithoutRevision, revision: stableHash(overviewWithoutRevision) };
    this.countryOverviewCache.set(cacheKey, overview);
    while (this.countryOverviewCache.size > 128) this.countryOverviewCache.delete(this.countryOverviewCache.keys().next().value!);
    return overview;
  }

  async getCityScene(countryId: string, cityId: string): Promise<CitySceneDto> {
    const [cityRow, country] = await Promise.all([
      this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(cityId, countryId) as Promise<Row | undefined>,
      this.countryRow(countryId),
    ]);
    if (!cityRow) throw new DomainError("NOT_FOUND", "Город не найден");
    const city = cityDto(cityRow);
    const cacheKey = `${countryId}:${cityId}:${Number(country.world_version)}`;
    const cached = this.citySceneCache.get(cacheKey);
    if (cached) {
      this.citySceneCache.delete(cacheKey);
      this.citySceneCache.set(cacheKey, cached);
      return cached;
    }
    const minChunkX = Math.floor(city.bounds.minX / CHUNK_SIZE);
    const minChunkY = Math.floor(city.bounds.minY / CHUNK_SIZE);
    const maxChunkX = Math.floor(city.bounds.maxX / CHUNK_SIZE);
    const maxChunkY = Math.floor(city.bounds.maxY / CHUNK_SIZE);
    const chunkCount = (maxChunkX - minChunkX + 1) * (maxChunkY - minChunkY + 1);
    if (chunkCount > 256) throw new DomainError("INVALID_INPUT", "Город превышает лимит единой сцены");
    const chunks = await this.getViewportPayloads(countryId, minChunkX, minChunkY, maxChunkX, maxChunkY, "DETAIL");
    const completedDistrictIds = new Set(chunks.flatMap((chunk) => chunk.districts
      .filter((district) => district.status === "COMPLETED")
      .map((district) => district.id)));
    const completedTasksByDistrict = new Map<string, Map<string, CitySceneDto["completedDistrictSnapshots"][number]["tasks"][number]>>();
    for (const chunk of chunks) for (const task of chunk.tasks) {
      if (!completedDistrictIds.has(task.districtId)) continue;
      const taskById = completedTasksByDistrict.get(task.districtId) ?? new Map();
      taskById.set(task.id, task);
      completedTasksByDistrict.set(task.districtId, taskById);
    }
    const completedDistrictSnapshots = [...completedDistrictIds].sort().map((districtId) => {
      const tasks = [...completedTasksByDistrict.get(districtId)?.values() ?? []].sort((left, right) => left.taskNumber - right.taskNumber);
      return { districtId, revision: stableHash({ districtId, tasks }), tasks };
    });
    const sceneChunks: ChunkPayloadDto[] = chunks.map((chunk) => {
      const { contentHash, ...content } = chunk;
      void contentHash;
      const compactContent = {
        ...content,
        tasks: chunk.tasks.filter((task) => !completedDistrictIds.has(task.districtId)),
      };
      return { ...compactContent, contentHash: chunkPayloadContentHash(compactContent) } as ChunkPayloadDto;
    });
    const sceneIdentity = {
      schemaVersion: CITY_SCENE_SCHEMA_VERSION,
      cityId,
      bounds: city.bounds,
      chunks: sceneChunks.map((chunk) => ({ x: chunk.chunkX, y: chunk.chunkY, hash: chunk.contentHash, version: chunk.publishedVersion })),
    };
    const scene: CitySceneDto = {
      schemaVersion: CITY_SCENE_SCHEMA_VERSION,
      sceneRevision: stableHash(sceneIdentity),
      city: { id: city.id, name: city.name, center: city.center, bounds: city.bounds },
      lod: "DETAIL",
      chunkSize: CHUNK_SIZE,
      chunks: sceneChunks,
      completedDistrictSnapshots,
    };
    this.citySceneCache.set(cacheKey, scene);
    while (this.citySceneCache.size > 8) this.citySceneCache.delete(this.citySceneCache.keys().next().value!);
    return scene;
  }

  async listTasks(countryId: string, districtId?: string): Promise<TaskDto[]> {
    const rows = districtId
      ? await this.db.prepare("SELECT t.* FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? AND t.district_id = ? ORDER BY t.created_at").all(countryId, districtId)
      : await this.db.prepare("SELECT t.* FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? ORDER BY t.created_at").all(countryId);
    return (rows as Row[]).map(taskDto);
  }

  async getDistrictWorkload(countryId: string, districtId: string): Promise<{
    districtId: string; targetSp: number; plannedSp: number; openSp: number; taskCount: number; overTargetBySp: number;
  }> {
    const row = await this.db.prepare(`SELECT d.id, d.capacity_sp,
      COUNT(t.id)::integer AS task_count,
      COALESCE(SUM(t.estimate), 0)::integer AS planned_sp,
      COALESCE(SUM(CASE WHEN t.status <> 'COMPLETED' THEN t.estimate ELSE 0 END), 0)::integer AS open_sp
      FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id
      LEFT JOIN tasks_v3 t ON t.district_id = d.id
      WHERE d.id = ? AND c.country_id = ? GROUP BY d.id, d.capacity_sp`).get(districtId, countryId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Район не найден");
    const targetSp = Number(row.capacity_sp);
    const plannedSp = Number(row.planned_sp);
    return {
      districtId, targetSp, plannedSp, openSp: Number(row.open_sp), taskCount: Number(row.task_count),
      overTargetBySp: Math.max(0, plannedSp - targetSp),
    };
  }

  async listPlanCities(countryId: string): Promise<PlanCityDto[]> {
    const rows = await this.db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM districts_v3 d WHERE d.city_id = c.id) AS district_count,
      (SELECT COUNT(*) FROM tasks_v3 t WHERE t.city_id = c.id) AS task_count
      FROM cities_v3 c WHERE c.country_id = ? ORDER BY c.created_at`).all(countryId) as Row[];
    return rows.map((row) => ({
      ...cityDto(row),
      districtCount: Number(row.district_count),
      taskCount: Number(row.task_count),
    }));
  }

  async listPlanCitiesPage(countryId: string, cursor: string | undefined, limit = 50): Promise<PlanCityPageDto> {
    let afterCreatedAt: string | undefined;
    let afterId: string | undefined;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
        if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") throw new Error("invalid cursor");
        afterCreatedAt = decoded.createdAt;
        afterId = decoded.id;
      } catch {
        throw new DomainError("INVALID_INPUT", "Некорректный cursor списка городов");
      }
    }
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await this.db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM districts_v3 d WHERE d.city_id = c.id) AS district_count,
      (SELECT COUNT(*) FROM tasks_v3 t WHERE t.city_id = c.id) AS task_count
      FROM cities_v3 c WHERE c.country_id = ?
        AND (?::timestamptz IS NULL OR c.created_at > ?::timestamptz OR (c.created_at = ?::timestamptz AND c.id > ?))
      ORDER BY c.created_at, c.id LIMIT ?`).all(
                      countryId,
                      afterCreatedAt ?? null, afterCreatedAt ?? null, afterCreatedAt ?? null, afterId ?? null,
                      boundedLimit + 1,
                    ) as Row[];
    const hasMore = rows.length > boundedLimit;
    const pageRows = rows.slice(0, boundedLimit);
    const items = pageRows.map((row) => ({
      ...cityDto(row), districtCount: Number(row.district_count), taskCount: Number(row.task_count),
    }));
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? Buffer.from(JSON.stringify({ createdAt: String(last.created_at), id: String(last.id) })).toString("base64url")
        : null,
    };
  }

  async listPlanDistricts(countryId: string, cityId: string): Promise<PlanDistrictDto[]> {
    const city = await this.db.prepare("SELECT 1 FROM cities_v3 WHERE id = ? AND country_id = ?").get(cityId, countryId);
    if (!city) throw new DomainError("NOT_FOUND", "Город не найден");
    const rows = await this.db.prepare(`SELECT d.id, d.city_id, d.name, d.goal, d.description, d.deadline, d.status, d.capacity_sp, d.archetype, d.color, d.created_at,
      (SELECT COUNT(*) FROM tasks_v3 t WHERE t.district_id = d.id) AS task_count
      FROM districts_v3 d WHERE d.city_id = ? ORDER BY d.created_at`).all(cityId) as Row[];
    return rows.map((row) => ({
      id: String(row.id), cityId: String(row.city_id), name: String(row.name), goal: String(row.goal),
      description: String(row.description), deadline: row.deadline ? String(row.deadline) : null,
      status: String(row.status) as DistrictStatus, capacitySp: Number(row.capacity_sp),
      archetype: String(row.archetype) as DistrictArchetype, color: String(row.color),
      createdAt: String(row.created_at), taskCount: Number(row.task_count),
    }));
  }

  async listPlanTasks(countryId: string, districtId: string): Promise<PlanTaskDto[]> {
    const district = await this.db.prepare(`SELECT 1 FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id
      WHERE d.id = ? AND c.country_id = ?`).get(districtId, countryId);
    if (!district) throw new DomainError("NOT_FOUND", "Район не найден");
    const rows = await this.db.prepare(`SELECT id, task_number, city_id, district_id, title, work_item_type, estimate, priority, status, progress, due_at, updated_at,
      (SELECT COUNT(*) FROM task_defects_v18 defect WHERE defect.task_id = tasks_v3.id AND defect.status <> 'FIXED') AS active_defect_count
      FROM tasks_v3 WHERE district_id = ? ORDER BY created_at`).all(districtId) as Row[];
    return rows.map((row) => {
      const status = String(row.status) as TaskStatus;
      return {
        id: String(row.id), taskNumber: Number(row.task_number), cityId: String(row.city_id), districtId: String(row.district_id), title: String(row.title),
        workItemType: String(row.work_item_type) as WorkItemType,
        estimate: Number(row.estimate) as Estimate, priority: String(row.priority) as TaskPriority,
        status, progress: Number(row.progress), dueAt: row.due_at ? String(row.due_at) : null,
        stage: TASK_STAGE[status], updatedAt: String(row.updated_at), activeDefectCount: Number(row.active_defect_count),
      };
    });
  }

  private async districtsInBounds(countryId: string, bounds: Rect): Promise<DistrictDto[]> {
    const rows = await this.db.prepare(`SELECT d.id, d.city_id, d.name, d.goal, d.description, d.deadline,
      d.status, d.capacity_sp, d.lots_json, d.growth_direction, d.archetype, d.color, d.created_at,
      projection.cell_runs_json, projection.cells_json
      FROM world_chunk_district_cells_v1 projection
      JOIN districts_v3 d ON d.id = projection.district_id
      WHERE projection.country_id = ?
        AND projection.chunk_x BETWEEN ? AND ? AND projection.chunk_y BETWEEN ? AND ?
      ORDER BY d.created_at, d.id, projection.chunk_y, projection.chunk_x`).all(
                      countryId, floorDiv(bounds.minX, CHUNK_SIZE), floorDiv(bounds.maxX, CHUNK_SIZE),
                      floorDiv(bounds.minY, CHUNK_SIZE), floorDiv(bounds.maxY, CHUNK_SIZE),
                    ) as Row[];
    const districts = new Map<string, DistrictDto>();
    for (const row of rows) {
      // Dual-read during the additive rollout. An empty compact projection can
      // only mean an older/unbackfilled row when the legacy row still has cells.
      const compactCells = expandCellRuns(json(row.cell_runs_json));
      const cells = (compactCells.length > 0 ? compactCells : json<Cell[]>(row.cells_json))
        .filter((cell) => contains(bounds, cell));
      if (cells.length === 0) continue;
      const id = String(row.id);
      const existing = districts.get(id);
      if (existing) existing.cells.push(...cells);
      else districts.set(id, districtDto({ ...row, cells_json: cells }));
    }
    return [...districts.values()];
  }

  private async tasksInBounds(countryId: string, bounds: Rect, includeAccess = false): Promise<TaskDto[]> {
    const rows = await this.db.prepare(`SELECT DISTINCT t.* FROM world_chunk_entities_v11 chunk
      JOIN tasks_v3 t ON t.id = chunk.entity_id
      WHERE chunk.country_id = ? AND chunk.entity_kind = 'TASK'
        AND chunk.chunk_x BETWEEN ? AND ? AND chunk.chunk_y BETWEEN ? AND ?
      ORDER BY t.created_at`).all(
                      countryId, floorDiv(bounds.minX, CHUNK_SIZE), floorDiv(bounds.maxX, CHUNK_SIZE),
                      floorDiv(bounds.minY, CHUNK_SIZE), floorDiv(bounds.maxY, CHUNK_SIZE),
                    ) as Row[];
    return rows.map(taskDto).filter((task) =>
      task.footprint.some((cell) => contains(bounds, cell))
      || (includeAccess && task.accessPath.some((cell) => contains(bounds, cell))),
    );
  }

  private async featuresInBounds(countryId: string, bounds: Rect): Promise<WorldFeatureDto[]> {
    const rows = await this.db.prepare(`SELECT DISTINCT f.* FROM world_chunk_entities_v11 chunk
      JOIN world_features_v6 f ON f.id = chunk.entity_id
      WHERE chunk.country_id = ? AND chunk.entity_kind = 'FEATURE'
        AND chunk.chunk_x BETWEEN ? AND ? AND chunk.chunk_y BETWEEN ? AND ?
      ORDER BY f.created_at, f.id`).all(
                      countryId, floorDiv(bounds.minX, CHUNK_SIZE), floorDiv(bounds.maxX, CHUNK_SIZE),
                      floorDiv(bounds.minY, CHUNK_SIZE), floorDiv(bounds.maxY, CHUNK_SIZE),
                    ) as Row[];
    return rows.map(featureDto).filter((feature) =>
      feature.footprint.some((cell) => contains(bounds, cell))
      || feature.accessPath.some((cell) => contains(bounds, cell)),
    );
  }

  async listWorldFeatures(countryId: string): Promise<WorldFeatureDto[]> {
    return (await this.db.prepare("SELECT * FROM world_features_v6 WHERE country_id = ? ORDER BY created_at, id").all(countryId) as Row[]).map(featureDto);
  }

  async getTask(countryId: string, taskId: string): Promise<TaskDto> {
    const row = await this.db.prepare("SELECT t.* FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? AND t.id = ?")
                      .get(countryId, taskId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Задача не найдена");
    const task = taskDto(row);
    task.comments = (await this.db.prepare("SELECT * FROM task_comments_v3 WHERE task_id = ? ORDER BY created_at").all(taskId) as Row[]).map((comment) => ({
      id: String(comment.id), taskId, body: String(comment.body), actor: String(comment.actor), createdAt: String(comment.created_at),
    }));
    const account = async (userId: unknown) => {
      if (!userId) return null;
      const user = await this.db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(String(userId)) as Row | undefined;
      return user ? { id: String(user.id), email: String(user.email), name: String(user.name) } : null;
    };
    task.creator = await account(row.creator_user_id);
    task.assignee = await account(row.assignee_user_id);
    task.forUser = await account(row.for_user_id);
    task.dependencies = (await this.db.prepare(`SELECT t.id, t.task_number, t.title, t.status
      FROM task_dependencies_v1 d JOIN tasks_v3 t ON t.id = d.depends_on_task_id
      WHERE d.task_id = ?`).all(taskId) as Row[]).map((dep) => ({
      id: String(dep.id), taskNumber: Number(dep.task_number), title: String(dep.title), status: String(dep.status) as TaskStatus,
    }));
    task.events = (await this.db.prepare("SELECT * FROM task_events_v7 WHERE task_id = ? ORDER BY id").all(taskId) as Row[]).map((event) => ({
      id: Number(event.id), taskId, type: String(event.event_type) as NonNullable<TaskDto["events"]>[number]["type"],
      actor: String(event.actor_label), actorUserId: event.actor_user_id ? String(event.actor_user_id) : null,
      details: json<Record<string, unknown>>(event.details_json), createdAt: String(event.created_at),
    }));
    task.defects = (await this.db.prepare("SELECT * FROM task_defects_v18 WHERE task_id = ? ORDER BY created_at, id").all(taskId) as Row[]).map((defect) => ({
      id: String(defect.id), taskId, title: String(defect.title), description: String(defect.description),
      reproductionSteps: String(defect.reproduction_steps), actualResult: String(defect.actual_result), expectedResult: String(defect.expected_result),
      status: String(defect.status) as TaskDefectDto["status"], fixedAt: defect.fixed_at ? String(defect.fixed_at) : null,
      createdAt: String(defect.created_at), updatedAt: String(defect.updated_at),
    }));
    task.attachments = (await this.db.prepare("SELECT * FROM task_attachments_v1 WHERE task_id = ? ORDER BY created_at, id").all(taskId) as Row[]).map(attachmentDto);
    task.documents = (await this.db.prepare("SELECT * FROM task_documents_v1 WHERE task_id = ? ORDER BY position, file_name").all(taskId) as Row[]).map(taskDocumentDto);
    task.checklist = (await this.db.prepare("SELECT * FROM task_checklist_items_v1 WHERE task_id = ? ORDER BY position, id").all(taskId) as Row[]).map(taskChecklistItemDto);
    return task;
  }

  async searchTasks(countryId: string, query: string, limit = 10): Promise<TaskSearchResultDto[]> {
    const text = query.trim();
    if (text.length === 0) return [];
    const bounded = Math.max(1, Math.min(25, limit));
    const rows = /^\d{1,9}$/.test(text)
      ? await this.db.prepare(`SELECT t.id, t.task_number, t.title, t.work_item_type, t.status, t.progress, t.city_id, t.district_id, t.origin_x, t.origin_y,
          city.name AS city_name, city.center_x AS city_center_x, city.center_y AS city_center_y, city.bounds_json AS city_bounds_json,
          district.name AS district_name
          FROM tasks_v3 t JOIN cities_v3 city ON city.id = t.city_id JOIN districts_v3 district ON district.id = t.district_id
          WHERE city.country_id = ? AND t.task_number = ?`).all(countryId, Number(text)) as Row[]
      : await this.db.prepare(`SELECT t.id, t.task_number, t.title, t.work_item_type, t.status, t.progress, t.city_id, t.district_id, t.origin_x, t.origin_y,
          city.name AS city_name, city.center_x AS city_center_x, city.center_y AS city_center_y, city.bounds_json AS city_bounds_json,
          district.name AS district_name
          FROM tasks_v3 t JOIN cities_v3 city ON city.id = t.city_id JOIN districts_v3 district ON district.id = t.district_id
          WHERE city.country_id = ? AND t.title ILIKE ? ESCAPE '\\'
          ORDER BY t.updated_at DESC LIMIT ?`).all(countryId, `%${text.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`, bounded) as Row[];
    return rows.map((row) => {
      const status = String(row.status) as TaskStatus;
      return {
        id: String(row.id), taskNumber: Number(row.task_number), title: String(row.title),
        workItemType: String(row.work_item_type ?? "TASK") as WorkItemType,
        status, progress: Number(row.progress), stage: TASK_STAGE[status],
        cityId: String(row.city_id), cityName: String(row.city_name),
        cityCenter: { x: Number(row.city_center_x), y: Number(row.city_center_y) },
        cityBounds: json<Rect>(row.city_bounds_json),
        districtId: String(row.district_id), districtName: String(row.district_name),
        origin: { x: Number(row.origin_x), y: Number(row.origin_y) },
      };
    });
  }

  async addTaskLink(countryId: string, input: {
    taskId: string; url: string; title?: string; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskDto> {
    return this.mutate(countryId, "task.link.add.v1", input.idempotencyKey, input, async () => {
      const task = await this.getTask(countryId, input.taskId);
      const url = normalizeLinkUrl(input.url);
      if (task.mergeRequests.some((link) => link.url === url)) throw new DomainError("CONFLICT", "Такая ссылка уже добавлена к задаче");
      const entry: TaskLinkDto = {
        url,
        title: input.title?.trim().slice(0, 200) || url,
        actor: input.actor ?? "MCP",
        addedAt: now(),
      };
      await this.db.prepare("UPDATE tasks_v3 SET merge_requests_json = ? , updated_at = ? WHERE id = ?")
        .run(JSON.stringify([...task.mergeRequests, entry]), entry.addedAt, task.id);
      await this.recordTaskEvent(task.id, "LINK_ADDED", input.actor ?? "MCP", input.actorUserId, { url }, entry.addedAt);
      const data = await this.getTask(countryId, task.id);
      return { data, eventType: "task.fields_updated", eventPayload: { taskId: task.id, districtId: task.districtId, changedFields: ["mergeRequests"], affectedBounds: boundsOf(task.footprint) } };
    });
  }

  async removeTaskLink(countryId: string, input: {
    taskId: string; url: string; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskDto> {
    return this.mutate(countryId, "task.link.remove.v1", input.idempotencyKey, input, async () => {
      const task = await this.getTask(countryId, input.taskId);
      const url = normalizeLinkUrl(input.url);
      const remaining = task.mergeRequests.filter((link) => link.url !== url);
      if (remaining.length === task.mergeRequests.length) throw new DomainError("NOT_FOUND", "Такой ссылки у задачи нет");
      const updatedAt = now();
      await this.db.prepare("UPDATE tasks_v3 SET merge_requests_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(remaining), updatedAt, task.id);
      await this.recordTaskEvent(task.id, "LINK_REMOVED", input.actor ?? "MCP", input.actorUserId, { url }, updatedAt);
      const data = await this.getTask(countryId, task.id);
      return { data, eventType: "task.fields_updated", eventPayload: { taskId: task.id, districtId: task.districtId, changedFields: ["mergeRequests"], affectedBounds: boundsOf(task.footprint) } };
    });
  }

  async addTaskAttachment(countryId: string, input: {
    taskId: string; fileName: string; mimeType?: string; content: Buffer; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskAttachmentDto> {
    const fileName = sanitizeFileName(input.fileName);
    if (input.content.length === 0) throw new DomainError("INVALID_INPUT", "Файл пустой");
    if (input.content.length > config.maxAttachmentBytes) {
      throw new DomainError("INVALID_INPUT", `Файл больше допустимых ${Math.floor(config.maxAttachmentBytes / 1024 / 1024)} МБ`);
    }
    return this.mutate(countryId, "task.attachment.add.v1", input.idempotencyKey, { ...input, content: undefined, fileName, sizeBytes: input.content.length }, async () => {
      const task = await this.getTask(countryId, input.taskId);
      const id = randomUUID();
      const createdAt = now();
      const relative = join(countryId, task.id, `${id}-${fileName}`);
      const absolute = join(this.uploadDir, relative);
      await mkdir(join(this.uploadDir, countryId, task.id), { recursive: true });
      await writeFile(absolute, input.content);
      await this.db.prepare(`INSERT INTO task_attachments_v1
        (id, task_id, country_id, file_name, mime_type, size_bytes, storage_path, actor, actor_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, task.id, countryId, fileName, (input.mimeType?.trim() || "application/octet-stream").slice(0, 120),
        input.content.length, relative, input.actor ?? "MCP", input.actorUserId ?? null, createdAt,
      );
      await this.recordTaskEvent(task.id, "ATTACHMENT_ADDED", input.actor ?? "MCP", input.actorUserId, { fileName, sizeBytes: input.content.length }, createdAt);
      const row = await this.db.prepare("SELECT * FROM task_attachments_v1 WHERE id = ?").get(id) as Row;
      return { data: attachmentDto(row), eventType: "task.fields_updated", eventPayload: { taskId: task.id, districtId: task.districtId, changedFields: ["attachments"], affectedBounds: boundsOf(task.footprint) } };
    });
  }

  /** Attachment row plus its absolute file location, country-checked. */
  async getTaskAttachment(countryId: string, attachmentId: string): Promise<{ attachment: TaskAttachmentDto; absolutePath: string }> {
    const row = await this.db.prepare("SELECT * FROM task_attachments_v1 WHERE id = ? AND country_id = ?").get(attachmentId, countryId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Файл не найден");
    return { attachment: attachmentDto(row), absolutePath: join(this.uploadDir, String(row.storage_path)) };
  }

  async deleteTaskAttachment(countryId: string, input: { attachmentId: string; idempotencyKey: string }): Promise<{ ok: true }> {
    return this.mutate(countryId, "task.attachment.delete.v1", input.idempotencyKey, input, async () => {
      const row = await this.db.prepare("SELECT * FROM task_attachments_v1 WHERE id = ? AND country_id = ?").get(input.attachmentId, countryId) as Row | undefined;
      if (!row) throw new DomainError("NOT_FOUND", "Файл не найден");
      await this.db.prepare("DELETE FROM task_attachments_v1 WHERE id = ?").run(input.attachmentId);
      await unlink(join(this.uploadDir, String(row.storage_path))).catch(() => undefined);
      return { data: { ok: true as const }, eventType: "task.fields_updated", eventPayload: { taskId: String(row.task_id), changedFields: ["attachments"] } };
    });
  }

  async upsertTaskDocument(countryId: string, input: {
    taskId: string; fileName: string; title?: string; content: string; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskDocumentDto> {
    const fileName = markdownFileName(input.fileName);
    const standard = DEFAULT_TASK_DOCUMENTS.find((document) => document.fileName === fileName);
    const title = (input.title ?? standard?.title ?? "").trim();
    if (title.length < 2 || title.length > 100) throw new DomainError("INVALID_INPUT", "Название документа должно содержать от 2 до 100 символов");
    if (input.content.length > 64_000) throw new DomainError("INVALID_INPUT", "Markdown-документ не должен превышать 64 000 символов");
    return this.mutate(countryId, "task.document.upsert.v1", input.idempotencyKey, { ...input, fileName }, async () => {
      const task = await this.getTask(countryId, input.taskId);
      const current = task.documents?.find((document) => document.fileName === fileName);
      const timestamp = now();
      const id = current?.id ?? randomUUID();
      const position = standard?.position ?? Math.max(4, ...(task.documents ?? []).map((document) => document.position + 1));
      await this.db.prepare(`INSERT INTO task_documents_v1
        (id, task_id, file_name, title, content, is_default, position, actor, actor_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (task_id, file_name) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content,
          actor = EXCLUDED.actor, actor_user_id = EXCLUDED.actor_user_id, updated_at = EXCLUDED.updated_at`).run(
        id, task.id, fileName, standard?.title ?? title, input.content, Boolean(standard), position,
        input.actor ?? "MCP", input.actorUserId ?? null, timestamp, timestamp,
      );
      if (standard) {
        await this.db.prepare(`UPDATE tasks_v3 SET ${standard.legacyField} = ?, updated_at = ? WHERE id = ?`).run(input.content, timestamp, task.id);
      }
      await this.recordTaskEvent(task.id, "DOCUMENT_UPDATED", input.actor ?? "MCP", input.actorUserId, { documentId: id, fileName }, timestamp);
      const row = await this.db.prepare("SELECT * FROM task_documents_v1 WHERE id = ?").get(id) as Row;
      return { data: taskDocumentDto(row), eventType: "task.fields_updated", eventPayload: { taskId: task.id, districtId: task.districtId, changedFields: ["documents"], affectedBounds: boundsOf(task.footprint) } };
    });
  }

  async deleteTaskDocument(countryId: string, input: {
    taskId: string; documentId: string; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<{ ok: true }> {
    return this.mutate(countryId, "task.document.delete.v1", input.idempotencyKey, input, async () => {
      const task = await this.getTask(countryId, input.taskId);
      const document = task.documents?.find((candidate) => candidate.id === input.documentId);
      if (!document) throw new DomainError("NOT_FOUND", "Документ задачи не найден");
      if (document.isDefault) throw new DomainError("DEFAULT_DOCUMENT", "Стандартный документ нельзя удалить; очистите его содержимое");
      await this.db.prepare("DELETE FROM task_documents_v1 WHERE id = ?").run(document.id);
      const timestamp = now();
      await this.recordTaskEvent(task.id, "DOCUMENT_DELETED", input.actor ?? "MCP", input.actorUserId, { documentId: document.id, fileName: document.fileName }, timestamp);
      return { data: { ok: true as const }, eventType: "task.fields_updated", eventPayload: { taskId: task.id, districtId: task.districtId, changedFields: ["documents"], affectedBounds: boundsOf(task.footprint) } };
    });
  }

  async replaceTaskChecklist(countryId: string, input: {
    taskId: string; items: Array<{ title: string; done?: boolean }>; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskChecklistItemDto[]> {
    if (input.items.length > 50) throw new DomainError("INVALID_INPUT", "В чек-листе может быть не более 50 пунктов");
    const items = input.items.map((item) => ({ title: item.title.trim(), done: item.done ?? false }));
    if (items.some((item) => item.title.length < 1 || item.title.length > 240)) {
      throw new DomainError("INVALID_INPUT", "Пункт чек-листа должен содержать от 1 до 240 символов");
    }
    const normalized = items.map((item) => item.title.toLocaleLowerCase("ru-RU"));
    if (new Set(normalized).size !== normalized.length) throw new DomainError("INVALID_INPUT", "Пункты чек-листа не должны повторяться");
    return this.mutate(countryId, "task.checklist.replace.v1", input.idempotencyKey, { ...input, items }, async () => {
      const task = await this.getTask(countryId, input.taskId);
      const before = (task.checklist ?? []).map(({ id, title, done, position }) => ({ id, title, done, position }));
      await this.db.prepare("DELETE FROM task_checklist_items_v1 WHERE task_id = ?").run(task.id);
      const timestamp = now();
      const result: TaskChecklistItemDto[] = [];
      for (const [position, item] of items.entries()) {
        const id = randomUUID();
        await this.db.prepare(`INSERT INTO task_checklist_items_v1
          (id, task_id, title, done, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, task.id, item.title, item.done, position, timestamp, timestamp);
        result.push({ id, taskId: task.id, title: item.title, done: item.done, position, createdAt: timestamp, updatedAt: timestamp });
      }
      await this.recordTaskEvent(task.id, "CHECKLIST_REPLACED", input.actor ?? "MCP", input.actorUserId, {
        before,
        after: result.map(({ id, title, done, position }) => ({ id, title, done, position })),
      }, timestamp);
      return { data: result, eventType: "task.fields_updated", eventPayload: { taskId: task.id, districtId: task.districtId, changedFields: ["checklist"], affectedBounds: boundsOf(task.footprint) } };
    });
  }

  async updateTaskChecklistItem(countryId: string, input: {
    taskId: string; itemId: string; title?: string; done?: boolean; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskChecklistItemDto> {
    if (input.title === undefined && input.done === undefined) throw new DomainError("INVALID_INPUT", "Передайте новое название или состояние пункта");
    const title = input.title?.trim();
    if (title !== undefined && (title.length < 1 || title.length > 240)) throw new DomainError("INVALID_INPUT", "Пункт чек-листа должен содержать от 1 до 240 символов");
    return this.mutate(countryId, "task.checklist.item.update.v1", input.idempotencyKey, input, async () => {
      const task = await this.getTask(countryId, input.taskId);
      const current = task.checklist?.find((item) => item.id === input.itemId);
      if (!current) throw new DomainError("NOT_FOUND", "Пункт чек-листа не найден");
      if (title !== undefined && task.checklist?.some((item) => item.id !== current.id && item.title.toLocaleLowerCase("ru-RU") === title.toLocaleLowerCase("ru-RU"))) {
        throw new DomainError("INVALID_INPUT", "Пункты чек-листа не должны повторяться");
      }
      const timestamp = now();
      await this.db.prepare("UPDATE task_checklist_items_v1 SET title = ?, done = ?, updated_at = ? WHERE id = ?")
        .run(title ?? current.title, input.done ?? current.done, timestamp, current.id);
      await this.recordTaskEvent(task.id, "CHECKLIST_ITEM_UPDATED", input.actor ?? "MCP", input.actorUserId, {
        itemId: current.id,
        before: { title: current.title, done: current.done },
        after: { title: title ?? current.title, done: input.done ?? current.done },
      }, timestamp);
      const row = await this.db.prepare("SELECT * FROM task_checklist_items_v1 WHERE id = ?").get(current.id) as Row;
      return { data: taskChecklistItemDto(row), eventType: "task.fields_updated", eventPayload: { taskId: task.id, districtId: task.districtId, changedFields: ["checklist"], affectedBounds: boundsOf(task.footprint) } };
    });
  }

  private async recordTaskEvent(taskId: string, type: NonNullable<TaskDto["events"]>[number]["type"], actor: string, actorUserId: string | undefined, details: Record<string, unknown>, createdAt = now()): Promise<void> {
    await this.db.prepare(`INSERT INTO task_events_v7 (task_id, actor_user_id, actor_label, event_type, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(taskId, actorUserId ?? null, actor, type, JSON.stringify(details), createdAt);
  }

  private siteScore(seed: number, center: Cell, cities: CityDto[]): number {
    const bounds = rectForCenter(center);
    if (cities.some((city) => intersects(expandRect(city.bounds, 110), bounds))) return -1_000_000;
    let buildable = 0;
    let water = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y += 10) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 10) {
        if (isBuildableTerrain(terrainAt(seed, x, y).terrain)) buildable += 1;
        else water += 1;
      }
    }
    const nationalApproach = { x: bounds.minX - COUNTRY_VIEW_MARGIN, y: center.y + 9 };
    const approachDry = [-2, -1, 0, 1, 2].every((offset) =>
      isBuildableTerrain(terrainAt(seed, nationalApproach.x, nationalApproach.y + offset).terrain));
    // A first city is only useful when its published west-edge entry begins
    // on land. Otherwise dangling-water pruning can erase the national road
    // until it appears from the middle of the city.
    return buildable * 4 - water * 8 + (approachDry ? 400 : -10_000) + hashCoordinate(seed, center.x, center.y, 417);
  }

  private async nextCityCenter(countryId: string, seed: number, existingCities?: CityDto[]): Promise<Cell> {
    const cities = existingCities ?? await this.listCities(countryId);
    const index = cities.length;
    if (index === 0) {
      const candidates: Cell[] = [];
      for (let radius = 0; radius <= 120; radius += 10) {
        for (let y = -radius; y <= radius; y += 10) {
          for (let x = -radius; x <= radius; x += 10) if (Math.max(Math.abs(x), Math.abs(y)) === radius) candidates.push({ x, y });
        }
      }
      const best = candidates.map((cell) => ({ cell, score: this.siteScore(seed, cell, cities) })).sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= -100_000) return best.cell;
      throw new DomainError("PLACEMENT_UNAVAILABLE", "Не удалось найти безопасную площадку для первого города");
    }
    const baseAngle = (index * 2.399963229728653) + hashCoordinate(seed, index, 0, 421) * 0.45;
    const ring = 1 + Math.floor((index - 1) / 6);
    for (const radialExtra of [0, 80, 160, 240, 320]) {
      const candidates: Cell[] = [];
      const distance = CITY_SPACING * ring + radialExtra;
      for (const angleOffset of [-0.36, -0.18, 0, 0.18, 0.36]) {
        const angle = baseAngle + angleOffset;
        const preferred = { x: Math.round(Math.cos(angle) * distance), y: Math.round(Math.sin(angle) * distance) };
        for (let dy = -36; dy <= 36; dy += 12) for (let dx = -36; dx <= 36; dx += 12) candidates.push({ x: preferred.x + dx, y: preferred.y + dy });
      }
      const best = candidates.map((cell) => ({ cell, score: this.siteScore(seed, cell, cities) })).sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= -100_000) return best.cell;
    }
    throw new DomainError("PLACEMENT_UNAVAILABLE", "Не удалось найти безопасную площадку для нового города");
  }

  private async roadCells(countryId: string): Promise<Map<string, RoadCellDto>> {
    let worldVersion = this.knownWorldVersions.get(countryId);
    if (worldVersion === undefined) {
      const versionRow = await this.db.prepare("SELECT world_version FROM countries WHERE id = ?").get(countryId) as Row | undefined;
      if (!versionRow) throw new DomainError("NOT_FOUND", "Страна не найдена");
      worldVersion = Number(versionRow.world_version);
      this.knownWorldVersions.set(countryId, worldVersion);
    }
    const cached = this.roadCache.get(countryId);
    if (cached?.worldVersion === worldVersion) return cached.cells;
    const rows = await this.db.prepare("SELECT x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ?").all(countryId) as Row[];
    const roads = new Map(rows.map((row) => {
      const cell: RoadCellDto = { x: Number(row.x), y: Number(row.y), mask: Number(row.mask), structure: String(row.structure) as RoadCellDto["structure"], roadClass: String(row.road_class) as RoadCellDto["roadClass"] };
      return [cellKey(cell), cell];
    }));
    this.roadCache.set(countryId, { worldVersion, cells: roads });
    return roads;
  }

  private async completedDistrictCells(countryId: string): Promise<Set<string>> {
    return new Set((await this.listDistricts(countryId))
                      .filter((district) => district.status === "COMPLETED")
                      .flatMap((district) => district.cells)
                      .map(cellKey));
  }

  private async institutionalAccessRoads(countryId: string): Promise<Set<string>> {
    return new Set((await this.listWorldFeatures(countryId))
      .filter((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA")
      .flatMap((feature) => stampRoadCorridor(feature.accessPath, "LOCAL", ROAD_WIDTH))
      .map(cellKey));
  }

  private async normalizeUrbanHighways(countryId: string, bounds: Rect, snapshot?: GenerationSpatialSnapshot): Promise<void> {
    const inset = 8;
    if (bounds.maxX - bounds.minX <= inset * 2 || bounds.maxY - bounds.minY <= inset * 2) return;
    const result = await this.db.prepare(`UPDATE roads_v3 SET road_class = 'ARTERIAL'
      WHERE country_id = ? AND road_class = 'HIGHWAY'
      AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`).run(
                      countryId,
                      bounds.minX + inset,
                      bounds.maxX - inset,
                      bounds.minY + inset,
                      bounds.maxY - inset,
                    );
    if (Number(result.changes) > 0) {
      if (snapshot) {
        for (const road of snapshot.roads.values()) {
          if (road.roadClass === "HIGHWAY"
            && road.x >= bounds.minX + inset && road.x <= bounds.maxX - inset
            && road.y >= bounds.minY + inset && road.y <= bounds.maxY - inset) road.roadClass = "ARTERIAL";
        }
      }
      this.roadCache.delete(countryId);
      this.surfaceCache.delete(countryId);
    }
  }

  private async surfaceCells(countryId: string, roadsInput?: Map<string, RoadCellDto>): Promise<Map<string, SurfaceCellDto>> {
    const roads = roadsInput ?? await this.roadCells(countryId);
    const canonicalRoads = await this.roadCells(countryId);
    const canCache = roads === canonicalRoads;
    const worldVersion = this.knownWorldVersions.get(countryId) ?? 0;
    const cached = canCache ? this.surfaceCache.get(countryId) : undefined;
    if (cached?.worldVersion === worldVersion) return cached.cells;
    const seed = Number((await this.countryRow(countryId)).seed);
    const result = buildSurfaceMap({
              roads,
              cities: await this.listCities(countryId),
              districts: await this.listDistricts(countryId),
              tasks: await this.listTasks(countryId),
              features: await this.listWorldFeatures(countryId),
              isSurfaceTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
            });
    if (canCache) this.surfaceCache.set(countryId, { worldVersion, cells: result });
    return result;
  }

  /**
   * Placement only needs pedestrian surfaces around the district being
   * edited. Building a country-wide map for every task caused large temporary
   * allocations once a country reached several cities. Keep the canonical
   * full map for chunk delivery, but use this bounded view while generating.
   */
  private async localSurfaceCells(
    countryId: string,
    scope: Rect,
    roadsInput?: Map<string, RoadCellDto>,
    districtOverrides: DistrictDto[] = [],
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<Map<string, SurfaceCellDto>> {
    const padded = expandRect(scope, 8);
    const localRoads = roadsInput
      ? new Map([...roadsInput].filter(([, road]) => contains(padded, road)))
      : new Map((await this.db.prepare(`SELECT x, y, mask, structure, road_class FROM roads_v3
          WHERE country_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`)
        .all(countryId, padded.minX, padded.maxX, padded.minY, padded.maxY) as Row[]).map((row) => {
          const road: RoadCellDto = {
            x: Number(row.x), y: Number(row.y), mask: Number(row.mask),
            structure: String(row.structure) as RoadCellDto["structure"],
            roadClass: String(row.road_class) as RoadCellDto["roadClass"],
          };
          return [cellKey(road), road];
        }));
    const overrides = new Map(districtOverrides.map((district) => [district.id, district]));
    const districts = (snapshot
      ? snapshot.districts.filter((district) => district.cells.some((cell) => contains(padded, cell)))
      : await this.districtsInBounds(countryId, padded))
              .map((district) => overrides.get(district.id) ?? district)
              .filter((district) => district.cells.length > 0);
    for (const district of districtOverrides) {
      if (!districts.some((candidate) => candidate.id === district.id) && district.cells.some((cell) => contains(padded, cell))) districts.push(district);
    }
    const tasks = snapshot
      ? snapshot.tasks.filter((task) => [...task.footprint, ...task.accessPath].some((cell) => contains(padded, cell)))
      : await this.tasksInBounds(countryId, padded, true);
    const features = snapshot
      ? snapshot.features.filter((feature) => [...feature.footprint, ...feature.accessPath].some((cell) => contains(padded, cell)))
      : await this.featuresInBounds(countryId, padded);
    const seed = Number((await this.countryRow(countryId)).seed);
    return buildSurfaceMap({
              roads: localRoads,
              cities: snapshot
                ? snapshot.cities.filter((city) => intersects(city.bounds, padded))
                : await this.citiesInBounds(countryId, padded),
              districts,
              tasks,
              features,
              isSurfaceTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
            });
  }

  private async route(
    countryId: string,
    seed: number,
    start: Cell,
    end: Cell | readonly Cell[],
    avoidBounds: Rect[] = [],
    extraReserved: Cell[] = [],
    reservationRadius = 1,
    reuseUrbanRoads = false,
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<Cell[]> {
    const targets: readonly Cell[] = Array.isArray(end) ? end : [end as Cell];
    if (targets.length === 0) throw new DomainError("ROUTE_BLOCKED", "Не указана конечная точка дороги");
    const targetKeys = new Set(targets.map(cellKey));
    const roads = snapshot?.roads ?? await this.roadCells(countryId);
    const sourceDistricts = snapshot?.districts ?? await this.listDistricts(countryId);
    const sourceTasks = snapshot?.tasks ?? await this.listTasks(countryId);
    const sourceFeatures = snapshot?.features ?? await this.listWorldFeatures(countryId);
    const sealed = new Set(sourceDistricts.filter((district) => district.status === "COMPLETED")
      .flatMap((district) => district.cells).map(cellKey));
    const reservedFootprints = [
      ...sourceTasks.flatMap((task) => [...taskOccupiedCells(task), task.entrance, ...task.accessPath]),
      ...sourceFeatures.filter((feature) => feature.kind !== "RUIN").flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
      ...sourceDistricts.flatMap((district) => district.lots.flatMap((lot) => [
                    ...rectangleFootprint(lot.origin, lot.width, lot.height),
                    ...(lot.sharedAccess ?? []),
                  ])),
      ...extraReserved,
    ];
    // A* plans a centreline but publishing can stamp a four-cell highway.
    // Reserve enough halo for the full asphalt envelope plus the pedestrian
    // anchor; a one-cell halo allowed later intercity roads to erase the only
    // sidewalk next to a park without touching its stored access cell.
    const occupied = new Set(reservedFootprints.flatMap((cell) => {
      const halo: Cell[] = [];
      for (let dy = -reservationRadius; dy <= reservationRadius; dy += 1) {
        for (let dx = -reservationRadius; dx <= reservationRadius; dx += 1) halo.push({ x: cell.x + dx, y: cell.y + dy });
      }
      return halo;
    }).map(cellKey));
    // A district can grow around an older highway and eventually contain the
    // selected branch cell. In that case the connector must be allowed to
    // leave the envelope through still-empty space. Reserved lots, buildings,
    // paths, features and sealed cells remain hard obstacles.
    const protectedBounds = avoidBounds.filter((bounds) =>
      !contains(bounds, start) && !targets.some((target) => contains(bounds, target)));
    const costAt = (cell: Cell): number => {
              const isEndpoint = cell.x === start.x && cell.y === start.y || targetKeys.has(cellKey(cell));
              const existing = roads.get(cellKey(cell));
              // An intercity route may follow an established highway out of a city
              // that later grew around it. It may not reuse local/collector streets:
              // doing so widened ordinary blocks and removed their sidewalks.
              const reusableRoad = Boolean(existing) && (reuseUrbanRoads || existing?.roadClass === "HIGHWAY");
              if (!isEndpoint && protectedBounds.some((bounds) => contains(bounds, cell)) && !reusableRoad) return Number.POSITIVE_INFINITY;
              // Reusing asphalt is cheap only when the canonical profile can
              // be stamped again without touching a committed feature. The
              // selected branch anchor is filtered separately, so an existing
              // road inside an occupied halo is never required as an escape.
              // A branch anchor is one cell within a multi-cell asphalt
              // profile. Let its centreline cross that profile and leave the
              // occupied urban halo, but never treat an entire old highway as
              // a free route: roadside stops and service areas may legitimately
              // touch it farther away and would be clipped by a new turn.
              const leavesBranchProfile = reusableRoad && manhattan(cell, start) <= ROAD_WIDTH.HIGHWAY + 1;
              if (!isEndpoint && occupied.has(cellKey(cell)) && !leavesBranchProfile) return Number.POSITIVE_INFINITY;
              if (existing) return 0.12;
              if (sealed.has(cellKey(cell))) return Number.POSITIVE_INFINITY;
              // The centerline may be free while a lateral lane still clips a
              // completed district. Reserve the same halo that the caller uses
              // for the final road profile, while allowing already-paved cells
              // inside the sealed district to remain shared infrastructure.
              for (let dy = -reservationRadius; dy <= reservationRadius; dy += 1) {
                for (let dx = -reservationRadius; dx <= reservationRadius; dx += 1) {
                  const haloKey = cellKey({ x: cell.x + dx, y: cell.y + dy });
                  if (sealed.has(haloKey) && !roads.has(haloKey)) return Number.POSITIVE_INFINITY;
                }
              }
              const terrain = terrainAt(seed, cell.x, cell.y).terrain;
              if (terrain === "DEEP_WATER") return 18;
              if (terrain === "SHALLOW_WATER") return 10;
              if (terrain === "WET_SAND") return 4;
              if (terrain === "MOUNTAIN") return 45;
              if (terrain === "HILL") return 7;
              if (terrain === "FOREST") return 3.2;
              if (terrain === "STONE") return 2.2;
              return 1;
            };
    // Established countries can force a connector around two city envelopes,
    // a completed district and the national archive at once. The normal
    // 160-cell search window keeps everyday district routing cheap, while the
    // bounded retry gives intercity links enough room to go around that whole
    // protected belt instead of failing a valid third-city placement.
    const findPath = (searchMargin: number) => targets.length === 1
      ? aStarPath(start, targets[0]!, costAt, searchMargin, 1.4, false)
      : aStarPathToAny(start, targets, costAt, searchMargin, 1.4);
    // Local complex connectors already have bounded endpoints and should not
    // explore a 320-cell-wide country corridor on every rejected candidate.
    // A 64-cell detour is ample around one urban block; intercity and wide
    // protected-envelope routes retain the broader search below.
    const initialSearchMargin = avoidBounds.length === 0 && reservationRadius <= 1 ? 64 : 160;
    let path = findPath(initialSearchMargin);
    if (path.length === 0 && (avoidBounds.length > 1 || reservationRadius >= 3)) {
      path = findPath(240);
    }
    const targetLabel = targets.length === 1
      ? `${targets[0]!.x},${targets[0]!.y}`
      : `${targets.length} целей`;
    if (path.length === 0) throw new DomainError(
      "ROUTE_BLOCKED",
      `Не удалось проложить дорогу без пересечения существующих зданий (${start.x},${start.y} → ${targetLabel})`,
    );
    return path;
  }

  private roadCorridor(path: Cell[], roadClass: RoadCellDto["roadClass"]): Cell[] {
    return stampRoadCorridor(path, roadClass, ROAD_WIDTH);
  }

  private async addRoadPath(
    countryId: string,
    seed: number,
    path: Cell[],
    roadClass: RoadCellDto["roadClass"],
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<void> {
    const roads = snapshot?.roads ?? await this.roadCells(countryId);
    const sourceDistricts = snapshot?.districts ?? await this.listDistricts(countryId);
    const sourceTasks = snapshot?.tasks ?? await this.listTasks(countryId);
    const sourceFeatures = snapshot?.features ?? await this.listWorldFeatures(countryId);
    const sealed = new Set(sourceDistricts.filter((district) => district.status === "COMPLETED")
      .flatMap((district) => district.cells).map(cellKey));
    const committedFootprints = new Set([
      ...sourceTasks.flatMap((task) => [...taskOccupiedCells(task), task.entrance, ...task.accessPath]),
      ...sourceFeatures.filter((feature) => feature.kind !== "RUIN").flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
    ].map(cellKey));
    // Never publish a partially clipped road profile. A missing lateral lane
    // becomes a visibly narrow street, a jagged turn and an ambiguous traffic
    // graph. Routing already reserves the class-specific halo; this final
    // invariant turns any missed obstacle into a retryable domain failure.
    // A branch from an existing public street necessarily replaces one or two
    // curb/sidewalk cells with a square intersection apron. Permit that tiny
    // envelope at persisted-road endpoints only; committed buildings, paths
    // and every deeper sealed cell remain immutable.
    const junctionApron = new Set<string>();
    for (const endpoint of [path[0], path.at(-1)]) {
      if (!endpoint || !roads.has(cellKey(endpoint))) continue;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        junctionApron.add(cellKey({ x: endpoint.x + dx, y: endpoint.y + dy }));
      }
    }
    const blocked = new Set([
      ...committedFootprints,
      ...[...sealed].filter((key) => !junctionApron.has(key)),
    ]);
    const blockers = roadCorridorBlockers(path, roadClass, ROAD_WIDTH, blocked, new Set(roads.keys()));
    if (blockers.length > 0) throw new DomainError(
      "ROUTE_BLOCKED",
      `Полный профиль дороги пересекает занятую клетку ${blockers[0]!.x},${blockers[0]!.y}`,
    );
    let corridor = this.roadCorridor(path, roadClass);
    if (roads.size > 0) {
      const corridorMap = new Map(corridor.map((cell) => [cellKey(cell), cell]));
      const queue = corridor.filter((cell) => roads.has(cellKey(cell)));
      const connectedToNetwork = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentKey = cellKey(current);
        if (connectedToNetwork.has(currentKey)) continue;
        connectedToNetwork.add(currentKey);
        for (const next of neighbors4(current)) {
          const candidate = corridorMap.get(cellKey(next));
          if (candidate && !connectedToNetwork.has(cellKey(candidate))) queue.push(candidate);
        }
      }
      corridor = corridor.filter((cell) => connectedToNetwork.has(cellKey(cell)));
    }
    // Prune dangling bridge tips: a corridor cap that lands on water at a path
    // end (or a lateral lane beside it) becomes a one-sided bridge with no
    // second land portal. Through-bridges keep land on both sides and survive.
    // Existing road cells are never pruned — only cells this path would add.
    let pruned = true;
    while (pruned) {
      pruned = false;
      const present = new Set([...roads.keys(), ...corridor.map(cellKey)]);
      corridor = corridor.filter((cell) => {
        if (roads.has(cellKey(cell))) return true;
        if (!isWater(terrainAt(seed, cell.x, cell.y).terrain)) return true;
        const degree = neighbors4(cell).filter((next) => present.has(cellKey(next))).length;
        if (degree <= 1) {
          pruned = true;
          return false;
        }
        return true;
      });
    }
    const publishedRoads: RoadCellDto[] = [];
    for (const cell of corridor) {
      const terrain = terrainAt(seed, cell.x, cell.y).terrain;
      const structure: RoadCellDto["structure"] = isWater(terrain) ? "BRIDGE" : "ROAD";
      const existing = roads.get(cellKey(cell));
      // A highway connector can meet an urban street but cannot upgrade it.
      const selectedClass = existing && roadClass === "HIGHWAY"
        ? existing.roadClass
        : existing && ROAD_CLASS_RANK[existing.roadClass] > ROAD_CLASS_RANK[roadClass] ? existing.roadClass : roadClass;
      const updated: RoadCellDto = { ...cell, mask: existing?.mask ?? 0, structure, roadClass: selectedClass };
      roads.set(cellKey(cell), updated);
      publishedRoads.push(updated);
    }
    if (publishedRoads.length > 0) {
      await this.db.prepare(`INSERT INTO roads_v3 (country_id, x, y, mask, structure, road_class)
        SELECT ?, input.x, input.y, input.mask, input.structure, input.road_class
        FROM jsonb_to_recordset(?::jsonb) AS input(x integer, y integer, mask integer, structure text, road_class text)
        ON CONFLICT(country_id, x, y) DO UPDATE SET
          structure = excluded.structure, road_class = excluded.road_class`)
        .run(countryId, JSON.stringify(publishedRoads.map((road) => ({
          x: road.x, y: road.y, mask: road.mask, structure: road.structure, road_class: road.roadClass,
        }))));
    }
    await this.recalculateRoadMasks(countryId, corridor, snapshot?.roads);
    // A road corridor redevelops any ruin plot it crosses.
    await this.clearRuins(countryId, corridor, snapshot);
    this.surfaceCache.delete(countryId);
  }

  /** Removes bridge caps that remain one-sided after a complete growth batch. */
  async repairDanglingBridges(countryId: string, snapshot?: GenerationSpatialSnapshot): Promise<number> {
    const roads = snapshot?.roads ?? await this.roadCells(countryId);
    const invalidKeys = new Set(bridgeComponentsWithoutTwoLandPortals(roads.values()).flatMap((component) => [...component]));
    // Every road publication already recalculates the changed corridor and
    // its neighbours. A clean bridge audit must therefore be a read-only O(n)
    // scan; rewriting every road mask here made each new complex progressively
    // slower as the country grew.
    if (invalidKeys.size === 0) return 0;
    const removed = [...invalidKeys].map((key) => roads.get(key)).filter((road): road is RoadCellDto => Boolean(road));
    await this.db.prepare(`DELETE FROM roads_v3 road USING
      jsonb_to_recordset(?::jsonb) AS target(x integer, y integer)
      WHERE road.country_id = ? AND road.x = target.x AND road.y = target.y`)
      .run(JSON.stringify(removed.map(({ x, y }) => ({ x, y }))), countryId);
    if (snapshot) for (const key of invalidKeys) snapshot.roads.delete(key);
    for (const key of invalidKeys) roads.delete(key);
    await this.recalculateRoadMasks(countryId, removed.flatMap((road) => [road, ...neighbors4(road)]), snapshot?.roads);
    this.surfaceCache.delete(countryId);
    return removed.length;
  }

  private async recalculateRoadMasks(
    countryId: string,
    affected?: Iterable<Cell>,
    roadSnapshot?: Map<string, RoadCellDto>,
  ): Promise<void> {
    const roads = roadSnapshot ?? await this.roadCells(countryId);
    const targets = affected
      ? new Map([...affected].flatMap((cell) => [cell, ...neighbors4(cell)]).map((cell) => [cellKey(cell), cell])).values()
      : roads.values();
    const updates: Array<{ x: number; y: number; mask: number }> = [];
    for (const target of targets) {
      const road = roads.get(cellKey(target));
      if (!road) continue;
      let mask = 0;
      for (const direction of GRID_DIRECTIONS) {
        if (roads.has(cellKey({ x: road.x + direction.x, y: road.y + direction.y }))) mask |= direction.bit;
      }
      road.mask = mask;
      updates.push({ x: road.x, y: road.y, mask });
    }
    if (updates.length > 0) {
      await this.db.prepare(`UPDATE roads_v3 road SET mask = input.mask
        FROM jsonb_to_recordset(?::jsonb) AS input(x integer, y integer, mask integer)
        WHERE road.country_id = ? AND road.x = input.x AND road.y = input.y`)
        .run(JSON.stringify(updates), countryId);
    }
  }

  private cityGateway(bounds: Rect, center: Cell, source: Cell): { cell: Cell; horizontalApproach: boolean } {
    const dx = source.x - center.x;
    const dy = source.y - center.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        cell: { x: dx < 0 ? bounds.minX + 4 : bounds.maxX - 4, y: center.y },
        horizontalApproach: true,
      };
    }
    return {
      cell: { x: center.x, y: dy < 0 ? bounds.minY + 4 : bounds.maxY - 4 },
      horizontalApproach: false,
    };
  }

  private cityHub(seed: number, center: Cell): Cell {
    return {
      x: center.x + Math.floor(hashCoordinate(seed, center.x, center.y, 447) * 5) - 2,
      y: center.y + Math.floor(hashCoordinate(seed, center.x, center.y, 449) * 5) - 2,
    };
  }

  private cityPortal(bounds: Rect, gateway: Cell, horizontalApproach: boolean): Cell {
    if (horizontalApproach) {
      return { x: gateway.x - bounds.minX < bounds.maxX - gateway.x ? bounds.minX - 1 : bounds.maxX + 1, y: gateway.y };
    }
    return { x: gateway.x, y: gateway.y - bounds.minY < bounds.maxY - gateway.y ? bounds.minY - 1 : bounds.maxY + 1 };
  }

  private async highwayAnchors(countryId: string, target: Cell, cities: CityDto[], snapshot?: GenerationSpatialSnapshot): Promise<Cell[]> {
    const highways = [...(snapshot?.roads ?? await this.roadCells(countryId)).values()].filter((road) => road.roadClass === "HIGHWAY");
    const originalCities = cities.map((city) => rectForCenter(city.center));
    const districtEnvelopes = (snapshot?.districts ?? await this.listDistricts(countryId)).filter((district) => district.cells.length > 0).map((district) => expandRect(boundsOf(district.cells), 3));
    const featureEnvelopes = (snapshot?.features ?? await this.listWorldFeatures(countryId))
      .filter((feature) => feature.kind !== "RUIN" && feature.footprint.length + feature.accessPath.length > 0)
      .map((feature) => expandRect(boundsOf([...feature.footprint, ...feature.accessPath]), ROAD_WIDTH.HIGHWAY));
    const rural = highways.filter((road) =>
      !originalCities.some((bounds) => contains(bounds, road))
      && !districtEnvelopes.some((bounds) => contains(bounds, road))
      && !featureEnvelopes.some((bounds) => contains(bounds, road)),
    );
    const outsideDistricts = highways.filter((road) =>
      !districtEnvelopes.some((bounds) => contains(bounds, road))
      && !featureEnvelopes.some((bounds) => contains(bounds, road)),
    );
    // The branch point must be a genuine rural highway cell. Otherwise a new
    // connector can reuse a local street and accidentally upgrade an entire
    // urban block to HIGHWAY.
    const candidates = rural.length > 0 ? rural : outsideDistricts.length > 0 ? outsideDistricts : highways;
    return [...candidates].sort(compareCellsByDistance(target));
  }

  private async roadNetworkAnchors(countryId: string, target: Cell, cities: CityDto[], snapshot?: GenerationSpatialSnapshot): Promise<Cell[]> {
    const roads = [...(snapshot?.roads ?? await this.roadCells(countryId)).values()];
    const urban = cities.map((city) => rectForCenter(city.center));
    const featureEnvelopes = (snapshot?.features ?? await this.listWorldFeatures(countryId))
      .filter((feature) => feature.assetKind === "AREA" || feature.kind === "COUNTRY_ARCHIVE")
      .map((feature) => expandRect(boundsOf([...feature.footprint, ...feature.accessPath]), 4));
    const rural = roads.filter((road) => !urban.some((bounds) => contains(bounds, road))
      && !featureEnvelopes.some((bounds) => contains(bounds, road)));
    const safe = roads.filter((road) => !featureEnvelopes.some((bounds) => contains(bounds, road)));
    const candidates = rural.length > 0 ? rural : safe.length > 0 ? safe : roads;
    return [...candidates].sort(compareCellsByDistance(target));
  }

  private async featurePlacementOpen(
    countryId: string, seed: number, footprint: Cell[], avoidBounds: Rect[] = [], snapshot?: GenerationSpatialSnapshot,
  ): Promise<boolean> {
    const roads = snapshot?.roads ?? await this.roadCells(countryId);
    const occupied = new Set([
      ...(snapshot?.tasks ?? await this.listTasks(countryId)).flatMap(taskOccupiedCells).map(cellKey),
      ...(snapshot?.features ?? await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint).map(cellKey),
    ]);
    return footprint.every((cell) => !roads.has(cellKey(cell))
      && !occupied.has(cellKey(cell))
      && !avoidBounds.some((bounds) => contains(bounds, cell))
      && isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain));
  }

  private async insertWorldFeature(
    countryId: string,
    input: Omit<WorldFeatureDto, "id" | "developmentStage"> & Partial<Pick<WorldFeatureDto, "developmentStage">>,
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<WorldFeatureDto> {
    const id = randomUUID();
    const developmentStage = input.developmentStage ?? 5;
    await this.db.prepare(`INSERT INTO world_features_v6
      (id, country_id, city_id, district_id, parent_feature_id, kind, asset_kind, asset_key, origin_x, origin_y, footprint_json, orientation, access_json, development_stage, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                              id, countryId, input.cityId, input.districtId, input.parentFeatureId, input.kind, input.assetKind, input.assetKey,
                              input.origin.x, input.origin.y, JSON.stringify(input.footprint), input.orientation,
                              JSON.stringify(input.accessPath), developmentStage, now(),
                            );
    this.surfaceCache.delete(countryId);
    const feature = { id, ...input, developmentStage };
    if (snapshot) snapshot.features.push(feature);
    return feature;
  }

  private async districtGreenAreaStage(countryId: string, districtId: string): Promise<WorldFeatureDto["developmentStage"]> {
    // District identifiers are globally unique; tasks_v3 is scoped through its
    // district/city foreign keys and intentionally has no duplicated country_id.
    await this.countryRow(countryId);
    const rows = await this.db.prepare("SELECT status FROM tasks_v3 WHERE district_id = ?").all(districtId) as Row[];
    return greenAreaDevelopmentStage(rows.map((row) => String(row.status) as TaskStatus));
  }

  /** Advance composed parks monotonically with their district's task lifecycle. */
  private async syncDistrictGreenAreaDevelopment(countryId: string, districtId: string): Promise<Cell[]> {
    const nextStage = await this.districtGreenAreaStage(countryId, districtId);
    const areas = (await this.listWorldFeatures(countryId)).filter((feature) =>
      feature.districtId === districtId && feature.assetKind === "AREA"
      && (feature.kind === "PARK" || feature.kind === "GROVE")
      && feature.developmentStage < nextStage);
    if (areas.length === 0) return [];
    for (const area of areas) {
      await this.db.prepare("UPDATE world_features_v6 SET development_stage = ? WHERE id = ?").run(nextStage, area.id);
    }
    this.surfaceCache.delete(countryId);
    return areas.flatMap((area) => area.footprint);
  }

  private async publishDistrictGreenFeature(
    countryId: string,
    city: CityDto,
    districtId: string,
    seed: number,
    districtCells: Cell[],
    reservedLots: PlannedLotDto[] = [],
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<PlannedLotDto[]> {
    const existingFeatures = snapshot?.features ?? await this.listWorldFeatures(countryId);
    const existingGreen = existingFeatures.filter((feature) => feature.cityId === city.id && (feature.kind === "PARK" || feature.kind === "GROVE"));
    const districtGreen = existingGreen.filter((feature) => feature.districtId === districtId);
    const developedTaskLots = reservedLots.filter((lot) => lot.taskId).length;
    const targetGreenAreas = greenAreaTarget(developedTaskLots);
    if (districtGreen.length >= targetGreenAreas) return reservedLots;
    // Green space follows real district workload rather than road-growth
    // timing. The first public park is mandatory and another green area is due for roughly
    // every six occupied lots. A due area may retire only speculative empty
    // pads; task-owned and demolition lots remain immutable reservations.
    // Generated parks are public world features; task-owned parks retain their
    // independent lifecycle and badge. Alternating compact parks and groves
    // keeps greenery visible without consuming the whole buildable district.
    const { kind, assetKey } = generatedGreenAreaProfile(districtGreen.length);
    const allowed = new Set(districtCells.map(cellKey));
    const roads = snapshot?.roads ?? await this.roadCells(countryId);
    const focusedBounds = districtGreenSearchBounds(districtCells, reservedLots);
    const districtBounds = boundsOf(districtCells);
    // The city's first public green area has priority over speculative empty
    // pads. Occupied buildings and demolition plots remain hard reservations;
    // intersecting virtual alternatives are retired after a site is selected.
    const hardReservedLots = reservedLots.filter((lot) => lot.taskId || lot.vacant);
    const occupied = new Set([
      ...(snapshot?.tasks ?? await this.listTasks(countryId)).flatMap(taskOccupiedCells),
      ...existingFeatures.filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint),
      ...hardReservedLots.flatMap((lot) => rectangleFootprint(lot.origin, lot.width, lot.height)),
      ...hardReservedLots.flatMap((lot) => lot.sharedAccess ?? []),
    ].map(cellKey));
    type GreenCandidate = {
      origin: Cell;
      footprint: Cell[];
      accessPath: Cell[];
      score: number;
      size: readonly [number, number];
      retainedLotCount: number;
    };
    let selected: GreenCandidate | undefined;
    const minimumRetainedLots = Math.min(3, reservedLots.length);
    const searchBounds = [focusedBounds];
    if (JSON.stringify(focusedBounds) !== JSON.stringify(districtBounds)) searchBounds.push(districtBounds);
    for (const bounds of searchBounds) {
      const surfaces = await this.localSurfaceCells(countryId, bounds, roads, [], snapshot);
      let compactFallback: GreenCandidate | undefined;
      for (const size of greenAreaSizeCandidates(assetKey)) {
        const candidates: GreenCandidate[] = [];
        for (let y = bounds.minY; y <= bounds.maxY - size[1] + 1; y += 1) {
          for (let x = bounds.minX; x <= bounds.maxX - size[0] + 1; x += 1) {
            const origin = { x, y };
            const footprint = rectangleFootprint(origin, size[0], size[1]);
            if (!footprint.every((cell) => {
              const key = cellKey(cell);
              return allowed.has(key) && !roads.has(key) && !occupied.has(key) && isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain);
            })) continue;
            const accessPath = findAreaAccessPath({
              allowed, footprint, roads, surfaces, occupied,
              isWalkableTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
            });
            if (accessPath === null) continue;
            const center = { x: x + Math.floor(size[0] / 2), y: y + Math.floor(size[1] / 2) };
            const centerDistance = manhattan(center, city.center);
            const nearExistingGreen = existingGreen.some((feature) => {
              const gb = boundsOf(feature.footprint);
              return manhattan(center, { x: Math.floor((gb.minX + gb.maxX) / 2), y: Math.floor((gb.minY + gb.maxY) / 2) }) < 14;
            });
            const reservation = new Set([...footprint, ...accessPath].map(cellKey));
            const retainedLotCount = reservedLots.filter((lot) => lot.taskId || lot.vacant || ![
              ...rectangleFootprint(lot.origin, lot.width, lot.height),
              ...(lot.sharedAccess ?? []),
            ].some((cell) => reservation.has(cellKey(cell)))).length;
            candidates.push({
              origin, footprint, accessPath, size, retainedLotCount,
              score: accessPath.length * 100 + (nearExistingGreen ? 250 : 0) + centerDistance * 0.08 + hashCoordinate(seed, x, y, 823),
            });
          }
        }
        const ranked = candidates.sort((left, right) =>
          right.retainedLotCount - left.retainedLotCount
          || left.score - right.score
          || left.origin.y - right.origin.y
          || left.origin.x - right.origin.x);
        compactFallback = ranked[0] ?? compactFallback;
        selected = ranked.find((candidate) => candidate.retainedLotCount >= minimumRetainedLots) ?? ranked[0];
        if (selected) break;
      }
      selected ??= compactFallback;
      if (selected) break;
    }
    if (!selected) {
      // A due public green area is a district invariant, not optional decor.
      // Failing the surrounding transaction is safer than committing another
      // task or street and leaving a permanently parkless district behind.
      throw new DomainError(
        "REGENERATION_FAILED",
        `Не удалось зарезервировать зелёную зону в районе ${districtId}`,
      );
    }
    const greenReservation = new Set([...selected.footprint, ...selected.accessPath].map(cellKey));
    const retainedLots = reservedLots.filter((lot) => lot.taskId || lot.vacant || ![
      ...rectangleFootprint(lot.origin, lot.width, lot.height),
      ...(lot.sharedAccess ?? []),
    ].some((cell) => greenReservation.has(cellKey(cell))));
    const area = await this.insertWorldFeature(countryId, {
                              cityId: city.id,
                              districtId,
                              parentFeatureId: null,
                              kind,
                              assetKind: "AREA",
                              assetKey,
                              origin: selected.origin,
                              footprint: selected.footprint,
                              orientation: "S",
                              accessPath: selected.accessPath,
                              developmentStage: await this.districtGreenAreaStage(countryId, districtId),
                            });
    if (snapshot) snapshot.features.push(area);
    await this.clearRuins(countryId, selected.footprint, snapshot);

    // Area interiors are a deterministic client materialization of
    // (terrainSeed, area origin/type/stage). Persisting every tree, lamp and
    // bench duplicated disposable coordinates in PostgreSQL and inflated
    // every viewport. Keep only the stateful AREA row.
    return retainedLots;
  }

  private async publishCityGatewayFeatures(
    countryId: string,
    cityId: string,
    seed: number,
    bounds: Rect,
    gateway: Cell,
    portal: Cell,
    connector: Cell[],
    horizontalApproach: boolean,
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<void> {
    const roadAxisKey = horizontalApproach ? "horizontal" : "vertical";
    const orientation: WorldFeatureDto["orientation"] = horizontalApproach
      ? portal.x < gateway.x ? "E" : "W"
      : portal.y < gateway.y ? "S" : "N";
    const sideOffsets: Cell[] = [];
    const approachOffsets = [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10, -12, 12, -14, 14, -16, 16];
    for (const distance of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
      for (const along of approachOffsets) {
        if (horizontalApproach) sideOffsets.push({ x: along, y: -distance }, { x: along, y: distance });
        else sideOffsets.push({ x: -distance, y: along }, { x: distance, y: along });
      }
    }
    const placeProp = async (kind: WorldFeatureDto["kind"], assetKey: string, anchor: Cell, size: [number, number]): Promise<void> => {
      for (const offset of sideOffsets) {
        const origin = { x: anchor.x + offset.x, y: anchor.y + offset.y };
        const footprint = rectangleFootprint(origin, size[0], size[1]);
        if (!await this.featurePlacementOpen(countryId, seed, footprint, [], snapshot)) continue;
        await this.insertWorldFeature(countryId, { cityId, districtId: null, parentFeatureId: null, kind, assetKind: "PROP", assetKey, origin, footprint, orientation, accessPath: [] }, snapshot);
        return;
      }
    };

    const placeStopPair = async (
      anchor: Cell,
      axis: TransitRoadAxis,
      roadWidth: number,
      avoidBounds: Rect[] = [],
    ): Promise<boolean> => {
      for (const pair of pairedBusStopCandidates(anchor, axis, roadWidth)) {
        if (!await this.featurePlacementOpen(countryId, seed, pair[0].footprint, avoidBounds, snapshot)) continue;
        if (!await this.featurePlacementOpen(countryId, seed, pair[1].footprint, avoidBounds, snapshot)) continue;
        for (const stop of pair) await this.insertWorldFeature(countryId, {
          cityId,
          districtId: null,
          parentFeatureId: null,
          kind: "BUS_STOP",
          assetKind: "PROP",
          assetKey: stop.assetKey,
          origin: stop.origin,
          footprint: stop.footprint,
          orientation: stop.orientation,
          accessPath: [],
        }, snapshot);
        return true;
      }
      return false;
    };

    await placeStopPair(gateway, horizontalApproach ? "HORIZONTAL" : "VERTICAL", ROAD_WIDTH.HIGHWAY);
    await placeProp("CITY_SIGN", `city-sign-${roadAxisKey}`, portal, [1, 1]);

    // A long approach receives one shared service area. It is intentionally a
    // world feature rather than a fabricated user task.
    if (connector.length < 42) return;
    const catalog = getBuilding("commercial-highway-service-plaza");
    const cityExclusion = (snapshot?.cities ?? await this.listCities(countryId)).map((city) => expandRect(city.bounds, 4));
    const middle = Math.floor(connector.length * 0.55);
    const indexes = Array.from({ length: connector.length }, (_, index) => index)
      .filter((index) => index > 5 && index < connector.length - 5)
      .sort((left, right) => Math.abs(left - middle) - Math.abs(right - middle));
    for (const index of indexes) {
      const cell = connector[index]!;
      const previous = connector[index - 1]!;
      const next = connector[index + 1]!;
      const horizontal = previous.y === cell.y && next.y === cell.y;
      const vertical = previous.x === cell.x && next.x === cell.x;
      if (!horizontal && !vertical) continue;
      for (const side of [-1, 1] as const) {
        const origin = horizontal
          ? {
              x: cell.x - Math.floor(catalog.footprint.width / 2),
              y: side < 0 ? cell.y - catalog.footprint.height - 6 : cell.y + 6,
            }
          : {
              x: side < 0 ? cell.x - catalog.footprint.width - 6 : cell.x + 6,
              y: cell.y - Math.floor(catalog.footprint.height / 2),
            };
        const footprint = rectangleFootprint(origin, catalog.footprint.width, catalog.footprint.height);
        if (!await this.featurePlacementOpen(countryId, seed, footprint, cityExclusion, snapshot)) continue;
        const entrance = horizontal
          ? { x: origin.x + Math.floor(catalog.footprint.width / 2), y: side < 0 ? origin.y + catalog.footprint.height : origin.y - 1 }
          : { x: side < 0 ? origin.x + catalog.footprint.width : origin.x - 1, y: origin.y + Math.floor(catalog.footprint.height / 2) };
        const accessWithRoad = orthogonalPath(entrance, cell, horizontal ? false : true);
        const roads = snapshot?.roads ?? await this.roadCells(countryId);
        const accessPath = accessWithRoad.filter((point) => !roads.has(cellKey(point)));
        if (accessPath.length > 8 || !await this.featurePlacementOpen(countryId, seed, accessPath, cityExclusion, snapshot)) continue;
        await this.insertWorldFeature(countryId, {
                                                  cityId: null,
                                                  districtId: null,
                                                  parentFeatureId: null,
                                                  kind: "SERVICE_STATION",
                                                  assetKind: "BUILDING",
                                                  assetKey: catalog.key,
                                                  origin,
                                                  footprint,
                                                  orientation: horizontal ? side < 0 ? "S" : "N" : side < 0 ? "E" : "W",
                                                  accessPath,
                                                }, snapshot);
        const roadsAtStation = snapshot?.roads ?? await this.roadCells(countryId);
        const stationClass = roadsAtStation.get(cellKey(cell))?.roadClass ?? "HIGHWAY";
        await placeStopPair(cell, horizontal ? "HORIZONTAL" : "VERTICAL", ROAD_WIDTH[stationClass], cityExclusion);
        for (const [assetKey, offset] of [["streetlamp", { x: -2, y: 0 }], ["trash-bin", { x: catalog.footprint.width + 1, y: 1 }]] as const) {
          const decorOrigin = { x: origin.x + offset.x, y: origin.y + offset.y };
          const decorFootprint = [decorOrigin];
          if (await this.featurePlacementOpen(countryId, seed, decorFootprint, cityExclusion, snapshot)) {
            await this.insertWorldFeature(countryId, {
                                                                      cityId: null, districtId: null, parentFeatureId: null, kind: "ROADSIDE_DECOR", assetKind: "PROP", assetKey,
                                                                      origin: decorOrigin, footprint: decorFootprint, orientation: "S", accessPath: [],
                                                                    }, snapshot);
          }
        }
        return;
      }
    }
  }

  private async syncCountryArchiveComplex(
    countryId: string,
    preferredAnchor?: Cell,
    snapshot?: GenerationSpatialSnapshot,
    blockedOrigins = new Set<string>(),
  ): Promise<Rect | undefined> {
    const archive = await this.getArchive(countryId);
    let features = (snapshot?.features ?? await this.listWorldFeatures(countryId)).filter((feature) => feature.kind === "COUNTRY_ARCHIVE");
    let compound = features.find((feature) => feature.assetKind === "AREA");
    const cities = snapshot?.cities ?? await this.listCities(countryId);
    const cityExclusions = cities.map((city) => expandRect(city.bounds, ARCHIVE_CITY_CLEARANCE));
    let relocatedBounds: Rect | undefined;
    const compoundBounds = compound ? boundsOf(compound.footprint) : undefined;
    const compoundGeometryOutdated = compoundBounds
      ? compoundBounds.maxX - compoundBounds.minX + 1 !== ARCHIVE_COMPOUND.width
        || compoundBounds.maxY - compoundBounds.minY + 1 !== ARCHIVE_COMPOUND.height
      : false;
    if (compound && (compoundGeometryOutdated || cityExclusions.some((bounds) => intersects(bounds, compoundBounds!)))) {
      relocatedBounds = boundsOf([...compound.footprint, ...compound.accessPath]);
      const oldCorridor = new Map(this.roadCorridor(compound.accessPath, "LOCAL").map((cell) => [cellKey(cell), cell]));
      const protectedCells = new Set([
        ...(snapshot?.tasks ?? await this.listTasks(countryId)).flatMap((task) => [...taskOccupiedCells(task), ...task.accessPath]),
        ...(snapshot?.features ?? await this.listWorldFeatures(countryId))
          .filter((feature) => feature.id !== compound!.id && feature.parentFeatureId !== compound!.id && feature.kind !== "COUNTRY_ARCHIVE")
          .flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
      ].map(cellKey));
      await this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?").run(compound.id);
      if (snapshot) snapshot.features = snapshot.features.filter((feature) => feature.id !== compound!.id && feature.parentFeatureId !== compound!.id);
      const roads = snapshot?.roads ?? await this.roadCells(countryId);
      const remove = this.db.prepare("DELETE FROM roads_v3 WHERE country_id = ? AND x = ? AND y = ?");
      const removed: Cell[] = [];
      // A city may grow around the once-rural archive driveway and reuse it as
      // the only connection between later blocks. It is then shared urban
      // infrastructure, not archive-owned geometry, so preserve the route.
      const absorbedByCity = [...oldCorridor.values()].some((cell) => cities.some((city) => contains(city.bounds, cell)));
      if (!absorbedByCity) {
        for (const cell of oldCorridor.values()) {
          const road = roads.get(cellKey(cell));
          if (!road || road.roadClass !== "LOCAL" || protectedCells.has(cellKey(cell))) continue;
          // Preserve the junction where the former driveway met an unrelated
          // road component; only the archive-owned leaf corridor is removed.
          if (neighbors4(cell).some((next) => roads.has(cellKey(next)) && !oldCorridor.has(cellKey(next)))) continue;
          await remove.run(countryId, cell.x, cell.y);
          roads.delete(cellKey(cell));
          removed.push(cell);
        }
      }
      if (removed.length > 0) await this.recalculateRoadMasks(countryId, removed, snapshot?.roads);
      this.surfaceCache.delete(countryId);
      features = (snapshot?.features ?? await this.listWorldFeatures(countryId)).filter((feature) => feature.kind === "COUNTRY_ARCHIVE");
      compound = undefined;
    }
    if (!compound) {
      const city = preferredAnchor ? undefined : cities[0];
      const anchor = preferredAnchor ?? city?.center;
      if (!anchor) return undefined;
      const seed = Number((await this.countryRow(countryId)).seed);
      // The archive is a separate secured national site, not another city
      // block. Keep a visible green belt between its perimeter and every city.
      const preferredCandidates = [
        { x: -116, y: -34 }, { x: 94, y: 12 }, { x: -12, y: -122 }, { x: -12, y: 110 },
        { x: -144, y: -34 }, { x: 102, y: -34 }, { x: -42, y: -130 }, { x: 28, y: 118 },
      ];
      const fallbackCandidates: Cell[] = [];
      for (let y = -52; y <= 48; y += 4) for (const x of [-136, -128, -120, -112, -104, -96, 88, 96, 104, 112, 120, 128]) fallbackCandidates.push({ x, y });
      for (let x = -52; x <= 48; x += 4) for (const y of [-126, -118, -110, -102, -94, 88, 96, 104, 112, 120]) fallbackCandidates.push({ x, y });
      fallbackCandidates.sort((left, right) => manhattan(left, { x: -104, y: 0 }) - manhattan(right, { x: -104, y: 0 }));
      const candidates = [...preferredCandidates, ...fallbackCandidates];
      const roads = snapshot?.roads ?? await this.roadCells(countryId);
      const occupied = new Set([
        ...(snapshot?.tasks ?? await this.listTasks(countryId)).flatMap(taskOccupiedCells).map(cellKey),
        ...features.flatMap((feature) => feature.footprint).map(cellKey),
      ]);
      for (const offset of candidates) {
        const origin = { x: anchor.x + offset.x, y: anchor.y + offset.y };
        if (blockedOrigins.has(cellKey(origin))) continue;
        // Persist only the campus boundary. The secured rectangle is validated
        // below, while buildings/fences own their exact cells. Keeping 136
        // perimeter cells instead of 1,176 interior points prevents an
        // unrelated national landmark from inflating every city-placement read.
        const footprint = rectanglePerimeterFootprint(origin, ARCHIVE_COMPOUND.width, ARCHIVE_COMPOUND.height);
        // Reserve the security perimeter and a four-cell south approach from
        // day one. The archive may grow, but its fence and gate must never be
        // forced onto water, an existing road or somebody else's building.
        const securedSite = rectangleFootprint({ x: origin.x - 1, y: origin.y - 1 }, ARCHIVE_COMPOUND.width + 2, ARCHIVE_COMPOUND.height + 2);
        const approach = rectangleFootprint({ x: origin.x + ARCHIVE_GATE_CENTER_OFFSET_X - 1, y: origin.y + ARCHIVE_COMPOUND.height }, 3, 4);
        if (![...securedSite, ...approach].every((cell) => !roads.has(cellKey(cell))
          && !occupied.has(cellKey(cell))
          && !cityExclusions.some((bounds) => contains(bounds, cell))
          && isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain))) continue;
        compound = await this.insertWorldFeature(countryId, {
          cityId: null, districtId: null, parentFeatureId: null,
          kind: "COUNTRY_ARCHIVE", assetKind: "AREA", assetKey: "state-archive-complex",
          origin, footprint, orientation: "S", accessPath: [],
        }, snapshot);
        break;
      }
    }
    if (!compound) return undefined;

    const seed = Number((await this.countryRow(countryId)).seed);
    if (compound.accessPath.length === 0) {
      const gateCenter = { x: compound.origin.x + ARCHIVE_GATE_CENTER_OFFSET_X, y: compound.origin.y + ARCHIVE_COMPOUND.height };
      const apron = Array.from({ length: 4 }, (_, index) => ({ x: gateCenter.x, y: gateCenter.y + index }));
      const exclusion = expandRect(boundsOf(compound.footprint), 4);
      const cityAvoid = cities.map((city) => expandRect(city.bounds, 3));
      const allRoads = [...(snapshot?.roads ?? await this.roadCells(countryId)).values()].filter((road) => !contains(exclusion, road));
      // Join the archive driveway to the rural/national network. Routing to a
      // tempting local street can otherwise cut a new road straight through
      // the city's reserved building envelope.
      const ruralRoads = allRoads.filter((road) => !cityAvoid.some((bounds) => contains(bounds, road)));
      const hasRuralTargets = ruralRoads.length > 0;
      const roads = (hasRuralTargets ? ruralRoads : allRoads)
        .sort((left, right) => {
          const classPenalty = (road: RoadCellDto) => road.roadClass === "HIGHWAY" ? 10_000 : 0;
          return manhattan(left, apron[apron.length - 1]!) + classPenalty(left)
            - manhattan(right, apron[apron.length - 1]!) - classPenalty(right);
        });
      let connector: Cell[] | undefined;
      // Search a bounded batch of road cells as one multi-goal A* problem.
      // This avoids retrying the same explored space for adjacent dead ends,
      // while advancing through every batch means a fragmented imported map
      // cannot hide a valid connection behind an arbitrary candidate cap.
      // Urban fallback targets stay single-goal so a batch can never relax
      // several protected city envelopes at once.
      const targetBatchSize = hasRuralTargets ? 64 : 1;
      for (let offset = 0; offset < roads.length; offset += targetBatchSize) {
        try {
          // Two-cell clearance protects the fence from the lateral lane of the
          // stamped two-lane driveway, not just from its A* centreline.
          const routed = await this.route(countryId, seed, apron[apron.length - 1]!, roads.slice(offset, offset + targetBatchSize), cityAvoid, [], 2, true, snapshot);
          connector = [...apron, ...routed.slice(1)];
          break;
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
        }
      }
      if (!connector) {
        // A buildable campus can still be isolated by the full two-lane road
        // profile on a regenerated mature map. Retry another deterministic
        // campus origin before rejecting the whole country replay.
        if (blockedOrigins.size < 16) {
          const blockedBounds = boundsOf([...compound.footprint, ...compound.accessPath]);
          relocatedBounds = relocatedBounds ? unionRect(relocatedBounds, blockedBounds) : blockedBounds;
          blockedOrigins.add(cellKey(compound.origin));
          await this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?").run(compound.id);
          if (snapshot) snapshot.features = snapshot.features.filter((feature) => feature.id !== compound!.id && feature.parentFeatureId !== compound!.id);
          const retriedBounds = await this.syncCountryArchiveComplex(countryId, preferredAnchor, snapshot, blockedOrigins);
          return relocatedBounds && retriedBounds ? unionRect(relocatedBounds, retriedBounds) : relocatedBounds ?? retriedBounds;
        }
        throw new DomainError("ROUTE_BLOCKED", "Не удалось соединить Государственный архив с дорожной сетью");
      }
      await this.addRoadPath(countryId, seed, connector, "LOCAL", snapshot);
      await this.db.prepare("UPDATE world_features_v6 SET access_json = ? WHERE id = ?").run(JSON.stringify(connector), compound.id);
      compound = { ...compound, accessPath: connector };
      if (snapshot) snapshot.features = snapshot.features.map((feature) => feature.id === compound!.id ? compound! : feature);
    }

    const infrastructure: Array<{ assetKey: string; origin: Cell; footprint: Cell[]; orientation: "E" | "S" }> = [];
    const addInfrastructure = (assetKey: string, origin: Cell, orientation: "E" | "S", width: number, height: number) => {
      infrastructure.push({ assetKey, origin, orientation, footprint: rectangleFootprint(origin, width, height) });
    };
    const origin = compound.origin;
    for (let offset = -1; offset <= ARCHIVE_COMPOUND.width - 1; offset += 2) {
      addInfrastructure("archive-fence-horizontal", { x: origin.x + offset, y: origin.y - 1 }, "E", 2, 1);
    }
    for (let offset = -1; offset <= ARCHIVE_COMPOUND.width - 1; offset += 2) {
      const segmentMin = offset;
      const segmentMax = offset + 1;
      const drivewayMin = ARCHIVE_GATE_CENTER_OFFSET_X - 1;
      const drivewayMax = ARCHIVE_GATE_CENTER_OFFSET_X + 1;
      if (segmentMin <= drivewayMax && segmentMax >= drivewayMin) continue;
      addInfrastructure("archive-fence-horizontal", { x: origin.x + offset, y: origin.y + ARCHIVE_COMPOUND.height }, "E", 2, 1);
    }
    for (const sideX of [origin.x - 1, origin.x + ARCHIVE_COMPOUND.width]) {
      for (let offset = 0; offset < ARCHIVE_COMPOUND.height; offset += 2) {
        addInfrastructure("archive-fence-vertical", { x: sideX, y: origin.y + offset }, "S", 1, 2);
      }
    }
    addInfrastructure("archive-security-barrier", { x: origin.x + ARCHIVE_GATE_CENTER_OFFSET_X - 1, y: origin.y + ARCHIVE_COMPOUND.height }, "E", 3, 1);

    const infrastructureKeys = new Set(infrastructure.map((item) => `${item.assetKey}:${cellKey(item.origin)}`));
    const existingInfrastructure = (snapshot?.features ?? await this.listWorldFeatures(countryId)).filter((feature) =>
      feature.parentFeatureId === compound!.id && feature.assetKind === "PROP"
      && (feature.assetKey.startsWith("archive-fence-") || feature.assetKey === "archive-security-barrier"));
    for (const feature of existingInfrastructure) {
      if (infrastructureKeys.has(`${feature.assetKey}:${cellKey(feature.origin)}`)) continue;
      await this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?").run(feature.id);
      if (snapshot) snapshot.features = snapshot.features.filter((candidate) => candidate.id !== feature.id);
    }
    const existingKeys = new Set(existingInfrastructure.map((feature) => `${feature.assetKey}:${cellKey(feature.origin)}`));
    for (const item of infrastructure) {
      if (existingKeys.has(`${item.assetKey}:${cellKey(item.origin)}`)) continue;
      await this.insertWorldFeature(countryId, {
        cityId: null, districtId: null, parentFeatureId: compound.id,
        kind: "COUNTRY_ARCHIVE", assetKind: "PROP", assetKey: item.assetKey,
        origin: item.origin, footprint: item.footprint, orientation: item.orientation, accessPath: [],
      }, snapshot);
    }

    const currentChildren = new Map(features
      .filter((feature) => feature.parentFeatureId === compound!.id && feature.assetKind === "BUILDING")
      .map((feature) => [feature.assetKey, feature]));
    const wanted = new Set(ARCHIVE_BUILDINGS.slice(0, archive.stage).map((building) => building.assetKey));
    for (const feature of currentChildren.values()) {
      if (wanted.has(feature.assetKey as (typeof ARCHIVE_BUILDINGS)[number]["assetKey"])) continue;
      await this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?").run(feature.id);
      if (snapshot) snapshot.features = snapshot.features.filter((candidate) => candidate.id !== feature.id);
    }
    for (const building of ARCHIVE_BUILDINGS.slice(0, archive.stage)) {
      if (currentChildren.has(building.assetKey)) continue;
      const origin = { x: compound.origin.x + building.offset.x, y: compound.origin.y + building.offset.y };
      await this.insertWorldFeature(countryId, {
        cityId: null, districtId: null, parentFeatureId: compound.id,
        kind: "COUNTRY_ARCHIVE", assetKind: "BUILDING", assetKey: building.assetKey,
        origin, footprint: rectangleFootprint(origin, building.width, building.height), orientation: "S", accessPath: [],
      }, snapshot);
    }
    await this.db.prepare("UPDATE country_archives_v1 SET updated_at = ? WHERE id = ?").run(now(), archive.id);
    this.surfaceCache.delete(countryId);
    const currentBounds = boundsOf([...compound.footprint, ...compound.accessPath, ...infrastructure.flatMap((item) => item.footprint)]);
    return relocatedBounds ? unionRect(relocatedBounds, currentBounds) : currentBounds;
  }

  private async syncCityAirport(
    countryId: string,
    city: CityDto,
    seed: number,
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<WorldFeatureDto | undefined> {
    let existing = (snapshot?.features ?? await this.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "AIRPORT" && feature.cityId === city.id && feature.assetKind === "AREA");
    const legacyAirportId = existing?.id;
    const connectToRoadNetwork = async (origin: Cell, footprint: Cell[], excludedFeatureId?: string): Promise<Cell[]> => {
      const site = boundsOf(footprint);
      const siteCenter = { x: Math.round((site.minX + site.maxX) / 2), y: Math.round((site.minY + site.maxY) / 2) };
      const delta = { x: city.center.x - siteCenter.x, y: city.center.y - siteCenter.y };
      const horizontal = Math.abs(delta.x) >= Math.abs(delta.y);
      const step = horizontal
        ? { x: delta.x < 0 ? -1 : 1, y: 0 }
        : { x: 0, y: delta.y < 0 ? -1 : 1 };
      const gate = horizontal
        ? { x: step.x < 0 ? site.minX : site.maxX, y: siteCenter.y }
        : { x: siteCenter.x, y: step.y < 0 ? site.minY : site.maxY };
      // The road stops at the gate's outside neighbour. Airport perimeter
      // cells remain fence/terminal-owned and never become asphalt.
      const apron = Array.from({ length: 5 }, (_, index) => ({ x: gate.x + step.x * (index + 1), y: gate.y + step.y * (index + 1) }));
      const routingSnapshot: GenerationSpatialSnapshot = snapshot
        ? { ...snapshot, features: snapshot.features.filter((feature) => feature.id !== excludedFeatureId) }
        : {
            bounds: expandRect(unionRect(city.bounds, site), 160),
            roads: await this.roadCells(countryId),
            districts: await this.listDistricts(countryId),
            cities: await this.listCities(countryId),
            tasks: await this.listTasks(countryId),
            features: (await this.listWorldFeatures(countryId)).filter((feature) => feature.id !== excludedFeatureId),
          };
      const exclusion = expandRect(site, 5);
      const cityAvoid = routingSnapshot.cities.map((candidate) => expandRect(candidate.bounds, 3));
      const allRoads = [...routingSnapshot.roads.values()].filter((road) => !contains(exclusion, road));
      // Airports join the national/rural network outside urban envelopes.
      // Routing straight to the nearest local street would reserve a long
      // divider through land that later districts need to remain connected.
      const ruralRoads = allRoads.filter((road) => !cityAvoid.some((bounds) => contains(bounds, road)));
      const hasRuralTargets = ruralRoads.length > 0;
      const roads = (hasRuralTargets ? ruralRoads : allRoads)
        .sort((left, right) => manhattan(left, apron.at(-1)!) - manhattan(right, apron.at(-1)!));
      let connector: Cell[] | undefined;
      let connectorPublished = false;
      const targetBatchSize = hasRuralTargets ? 64 : 1;
      // Most airport drives need only one square bend. Trying those bounded,
      // deterministic candidates first avoids asking A* to explore the whole
      // country. Candidate order stays stable in small worlds so airport
      // placement does not perturb established city-growth fixtures.
      // A slightly wider deterministic window is still cheap for orthogonal
      // candidates and avoids falling into the much heavier A* path on seeds
      // whose nearest rural roads sit behind the city envelope.
      for (const target of connector ? [] : roads.slice(0, 96)) {
        for (const horizontalFirst of [true, false]) {
          const direct = [...apron, ...orthogonalPath(apron.at(-1)!, target, horizontalFirst).slice(1)];
          const corridor = this.roadCorridor(direct, "LOCAL");
          if (corridor.some((cell) => contains(site, cell)
            || cityAvoid.some((bounds) => contains(bounds, cell)))) continue;
          try {
            await this.addRoadPath(countryId, seed, direct, "LOCAL", routingSnapshot);
            connector = direct;
            connectorPublished = true;
            break;
          } catch (error) {
            if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
          }
        }
        if (connector) break;
      }
      // Compatibility fallback for a fragmented mature map where neither
      // square bend is safe. Keep it last so the usual airport remains O(n).
      for (let offset = 0; !connector && offset < roads.length; offset += targetBatchSize) {
        try {
          // Keep the A* centreline far enough from the secured perimeter for
          // the complete three-cell LOCAL profile. Without this explicit site
          // exclusion a fragmented seed could loop the fallback behind its
          // own gate and stamp one lateral asphalt cell under the terminal.
          const routed = await this.route(
            countryId,
            seed,
            apron.at(-1)!,
            roads.slice(offset, offset + targetBatchSize),
            [expandRect(site, 2), ...cityAvoid],
            [],
            2,
            true,
            routingSnapshot,
          );
          connector = [...apron, ...routed.slice(1)];
          break;
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
        }
      }
      if (!connector) throw new DomainError("ROUTE_BLOCKED", `Не удалось соединить аэропорт города ${city.name} с дорожной сетью`);
      if (this.roadCorridor(connector, "LOCAL").some((cell) => contains(site, cell))) {
        throw new DomainError("ROUTE_BLOCKED", `Подъездная дорога аэропорта города ${city.name} пересекает защищённый периметр`);
      }
      if (!connectorPublished) await this.addRoadPath(countryId, seed, connector, "LOCAL", routingSnapshot);
      if (snapshot && routingSnapshot !== snapshot) snapshot.roads = routingSnapshot.roads;
      return connector;
    };
    if (existing) {
      if (existing.accessPath.length > 0) return existing;
      try {
        const connector = await connectToRoadNetwork(existing.origin, existing.footprint, existing.id);
        await this.db.prepare("UPDATE world_features_v6 SET access_json = ? WHERE id = ?").run(JSON.stringify(connector), existing.id);
        existing = { ...existing, accessPath: connector };
        if (snapshot) snapshot.features = snapshot.features.map((feature) => feature.id === existing!.id ? existing! : feature);
        return existing;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
        // Early atlas builds could persist an airport inside later city growth
        // without an access road. If that site can no longer accept a full
        // road profile, relocate the legacy feature transactionally instead
        // of keeping the world worker in a restart loop.
        await this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?").run(existing.id);
        if (snapshot) snapshot.features = snapshot.features.filter((feature) => feature.id !== existing!.id && feature.parentFeatureId !== existing!.id);
        existing = undefined;
      }
    }
    const candidates: Cell[] = [];
    const centeredX = city.center.x - Math.floor(AIRPORT_COMPOUND.width / 2);
    const centeredY = city.center.y - Math.floor(AIRPORT_COMPOUND.height / 2);
    // Keep the secured airfield outside the city's normal district expansion
    // envelope. The city camera includes the airport explicitly, while this
    // reserve prevents a nearby runway from turning every later district
    // search into an obstacle-routing problem.
    for (const distance of [64, 80, 96, 112]) candidates.push(
      { x: centeredX, y: city.bounds.maxY + distance },
      { x: city.bounds.maxX + distance, y: centeredY },
      { x: centeredX, y: city.bounds.minY - AIRPORT_COMPOUND.height - distance },
      { x: city.bounds.minX - AIRPORT_COMPOUND.width - distance, y: centeredY },
    );
    const cityExclusions = (snapshot?.cities ?? await this.listCities(countryId)).map((candidate) => expandRect(candidate.bounds, 4));
    const placementRoads = [...(snapshot?.roads ?? await this.roadCells(countryId)).values()]
      .filter((road) => !cityExclusions.some((bounds) => contains(bounds, road)));
    const distanceToNetwork = (origin: Cell) => {
      const center = { x: origin.x + Math.floor(AIRPORT_COMPOUND.width / 2), y: origin.y + Math.floor(AIRPORT_COMPOUND.height / 2) };
      return placementRoads.reduce((best, road) => Math.min(best, manhattan(center, road)), Number.POSITIVE_INFINITY);
    };
    if (placementRoads.length >= 25_000) {
      candidates.sort((left, right) => distanceToNetwork(left) - distanceToNetwork(right)
        || manhattan(left, city.center) - manhattan(right, city.center));
    }
    for (const origin of candidates) {
      const securedSite = rectangleFootprint(origin, AIRPORT_COMPOUND.width, AIRPORT_COMPOUND.height);
      if (!await this.featurePlacementOpen(countryId, seed, securedSite, cityExclusions, snapshot)) continue;
      let connector: Cell[];
      try {
        connector = await connectToRoadNetwork(origin, rectanglePerimeterFootprint(origin, AIRPORT_COMPOUND.width, AIRPORT_COMPOUND.height));
      } catch (error) {
        if (error instanceof DomainError && error.code === "ROUTE_BLOCKED") continue;
        throw error;
      }
      return this.insertWorldFeature(countryId, {
        cityId: city.id,
        districtId: null,
        parentFeatureId: null,
        kind: "AIRPORT",
        assetKind: "AREA",
        assetKey: `city-airport-terminal-${Math.abs([...city.id].reduce((total, value) => total + value.charCodeAt(0), 0)) % 5 + 1}`,
        origin,
        footprint: rectanglePerimeterFootprint(origin, AIRPORT_COMPOUND.width, AIRPORT_COMPOUND.height),
        orientation: "E",
        accessPath: connector,
      }, snapshot);
    }
    if (legacyAirportId) {
      throw new DomainError("ROUTE_BLOCKED", `Не удалось безопасно перенести аэропорт города ${city.name}`);
    }
    return undefined;
  }

  async upgradeCityAirports(): Promise<number> {
    const countries = await this.db.prepare(`SELECT country.id, country.seed
      FROM countries country
      WHERE EXISTS (SELECT 1 FROM cities_v3 city WHERE city.country_id = country.id)
      ORDER BY country.created_at, country.id`).all<{ id: string; seed: number }>();
    let upgraded = 0;
    for (const country of countries) {
      const cities = await this.listCities(country.id);
      for (const city of cities) {
        const airport = await this.db.transaction(async () => this.syncCityAirport(country.id, city, Number(country.seed)));
        if (airport) upgraded += 1;
      }
    }
    return upgraded;
  }

  async upgradeCountryArchiveInfrastructure(): Promise<number> {
    const countries = await this.db.prepare(`SELECT country.id
      FROM countries country
      WHERE EXISTS (SELECT 1 FROM cities_v3 city WHERE city.country_id = country.id)
      ORDER BY country.created_at, country.id`).all<{ id: string }>();
    let upgraded = 0;
    for (const country of countries) {
      const affectedBounds = await this.db.transaction(async () => this.syncCountryArchiveComplex(country.id));
      if (affectedBounds) upgraded += 1;
    }
    return upgraded;
  }

  async createCity(countryId: string, input: {
    name: string; description?: string; goal?: string; acceptanceCriteria?: string; deadline?: string;
    morphology?: CityMorphology; idempotencyKey: string;
  }): Promise<CityDto> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) throw new DomainError("INVALID_INPUT", "Название города должно содержать от 2 до 100 символов");
    if (this.generationDispatcher) {
      return this.generationDispatcher.execute(countryId, "city.create", input.idempotencyKey, input);
    }
    return await this.mutate(countryId, "city.create.v3", input.idempotencyKey, input, async () => {
                      const country = await this.countryRow(countryId);
                      const seed = Number(country.seed);
                      const cities = await this.listCities(countryId);
                      const center = await this.nextCityCenter(countryId, seed, cities);
                      const bounds = rectForCenter(center);
                      const id = randomUUID();
                      const createdAt = now();
                      const styleId = `style-${Math.floor(hashCoordinate(seed, center.x, center.y, 433) * 8)}`;
                      const morphology = input.morphology ?? cityMorphology(hashCoordinate(seed, center.x, center.y, 439));
                      await this.db.prepare("INSERT INTO cities_v3 (id, country_id, name, description, goal, acceptance_criteria, deadline, status, center_x, center_y, bounds_json, style_id, morphology, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)")
                                                        .run(id, countryId, name, input.description?.trim().slice(0, 8000) ?? "", input.goal?.trim().slice(0, 4000) ?? "", input.acceptanceCriteria?.trim().slice(0, 8000) ?? "", input.deadline ?? null, center.x, center.y, JSON.stringify(bounds), styleId, morphology, createdAt);
                      // City placement needs the national road graph, but it
                      // must decode it once per command rather than once per
                      // rejected anchor. The union is finite and covers every
                      // existing/new city, intercity corridor and rural civic
                      // site while retaining spatially bounded SQL reads.
                      const cityCommandBounds = expandRect(
                        cities.length > 0 ? cities.map((city) => city.bounds).reduce(unionRect, bounds) : bounds,
                        192,
                      );
                      const generationSnapshot = await this.loadGenerationSpatialSnapshot(countryId, cityCommandBounds);

                      const nearest = cities.length > 0
                        ? cities.reduce((best, city) => manhattan(city.center, center) < manhattan(best.center, center) ? city : best, cities[0]!)
                        : undefined;
                      // The first national approach begins at the published
                      // country viewport edge, so a new world never appears
                      // to have a highway materialising in the middle of it.
                      const approach = nearest?.center ?? { x: bounds.minX - COUNTRY_VIEW_MARGIN, y: center.y + 9 };
                      const gateway = this.cityGateway(bounds, center, approach);
                      const portal = this.cityPortal(bounds, gateway.cell, gateway.horizontalApproach);
                      const hub = this.cityHub(seed, center);
                      const protectedUrbanEnvelopes = [
                        ...cities.map((city) => rectForCenter(city.center)),
                        ...generationSnapshot.districts.filter((district) => district.cells.length > 0).map((district) => expandRect(boundsOf(district.cells), 3)),
                      ];
                      // A connector branches from a rural highway and routes around every
                      // existing district. The new 100x100 reservation is protected as well so
                      // the route reaches only its chosen portal.
                      const routeSourceTiers = nearest
                        ? spatialRoadAnchorTiers(
                          await this.highwayAnchors(countryId, portal, cities, generationSnapshot),
                          await this.roadNetworkAnchors(countryId, portal, cities, generationSnapshot),
                        )
                        : [[approach]];
                      let source: Cell | undefined;
                      let connector: Cell[] | undefined;
                      // Mature cities can wrap the nearest highway cells with
                      // districts, stops and park access. Probing hundreds of
                      // adjacent cells on that same blocked segment wastes the
                      // route budget while viable rural branches remain on the
                      // connected network. One anchor per 8×8 bucket keeps the
                      // bounded search broad and deterministic.
                      for (const candidate of routeSourceTiers.flat()) {
                        try {
                          const routed = await this.route(countryId, seed, candidate, portal, [...protectedUrbanEnvelopes, bounds], [], 3, false, generationSnapshot);
                          // The first-city approach point sits at the viewport edge
                          // without a terrain check. Trim its leading water cells so
                          // the highway begins at dry shoreline; interior spans stay
                          // proper two-portal bridges.
                          const publishable = nearest ? routed : (() => {
                            let startIndex = 0;
                            const dryAt = (cell: Cell) => [-2, -1, 0, 1, 2].every((offset) =>
                              isBuildableTerrain(terrainAt(seed, cell.x + offset, cell.y).terrain)
                              && isBuildableTerrain(terrainAt(seed, cell.x, cell.y + offset).terrain));
                            while (startIndex < routed.length - 1 && !dryAt(routed[startIndex]!)) startIndex += 1;
                            return routed.slice(startIndex);
                          })();
                          // A* checks the centreline; publication checks the exact
                          // three-cell profile and branch apron. A rejected profile
                          // must advance to the next anchor, not abort city creation.
                          await this.addRoadPath(countryId, seed, publishable, "HIGHWAY", generationSnapshot);
                          connector = publishable;
                          source = candidate;
                          break;
                        } catch (error) {
                          if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
                        }
                      }
                      if (!source || !connector) throw new DomainError("ROUTE_BLOCKED", "В существующем мире не найден безопасный узел для подключения нового города");
                      await this.addRoadPath(countryId, seed, orthogonalPath(portal, gateway.cell, gateway.horizontalApproach), "HIGHWAY", generationSnapshot);
                      await this.addRoadPath(countryId, seed, orthogonalPath(gateway.cell, hub, gateway.horizontalApproach), "ARTERIAL", generationSnapshot);
                      // The hub cross is stamped, not routed: trim each ray so a
                      // collector never dead-ends into water. Interior water spans
                      // stay and become proper bridges with two land portals.
                      const hubRay = (dx: number, dy: number) => {
                        const cells: Cell[] = [];
                        for (let step = 1; step <= 11; step += 1) cells.push({ x: hub.x + dx * step, y: hub.y + dy * step });
                        while (cells.length > 0 && !isBuildableTerrain(terrainAt(seed, cells.at(-1)!.x, cells.at(-1)!.y).terrain)) cells.pop();
                        return cells;
                      };
                      const hubArm = gateway.horizontalApproach
                        ? [...hubRay(0, -1).reverse(), { x: hub.x, y: hub.y }, ...hubRay(0, 1)]
                        : [...hubRay(-1, 0).reverse(), { x: hub.x, y: hub.y }, ...hubRay(1, 0)];
                      if (hubArm.length > 1) await this.addRoadPath(countryId, seed, hubArm, "COLLECTOR", generationSnapshot);
                      // A later intercity connector may briefly reuse the exit road of an
                      // existing city. Its urban portion must remain an arterial.
                      for (const existingCity of cities) await this.normalizeUrbanHighways(countryId, existingCity.bounds, generationSnapshot);
                      await this.normalizeUrbanHighways(countryId, bounds, generationSnapshot);
                      await this.publishCityGatewayFeatures(countryId, id, seed, bounds, gateway.cell, portal, connector, gateway.horizontalApproach, generationSnapshot);
                      const archiveBounds = await this.syncCountryArchiveComplex(countryId, hub, generationSnapshot);
                      await this.syncCityAirport(countryId, {
                        id, name, description: input.description?.trim().slice(0, 8000) ?? "", goal: input.goal?.trim().slice(0, 4000) ?? "",
                        acceptanceCriteria: input.acceptanceCriteria?.trim().slice(0, 8000) ?? "", deadline: input.deadline ?? null,
                        status: "ACTIVE", center, bounds, styleId, morphology, createdAt,
                      }, seed, generationSnapshot);

                      // A wide corridor can cover a one-cell water pocket on
                      // its lateral edge. That cell is technically a bridge,
                      // but has only one connected land portal and must not be
                      // persisted as an isolated bridge component. Repair at
                      // the completed city mutation boundary; the reachability
                      // assertion below then proves that pruning did not break
                      // the national network.
                      await this.repairDanglingBridges(countryId, generationSnapshot);

                      const publishedRoads = generationSnapshot.roads;
                      const centerRoad = [...publishedRoads.values()].reduce<Cell | undefined>((best, road) =>
                        !best || manhattan(road, center) < manhattan(best, center) ? road : best, undefined);
                      const networkStart = nearest ? source : connector[0];
                      if (!centerRoad || !networkStart || manhattan(centerRoad, center) > 2 || !roadReachable(publishedRoads, networkStart, centerRoad)) {
                        throw new DomainError("ROUTE_BLOCKED", "Новый город не удалось присоединить к единой дорожной сети");
                      }

                      const data: CityDto = {
                        id, name, description: input.description?.trim() ?? "", goal: input.goal?.trim() ?? "",
                        acceptanceCriteria: input.acceptanceCriteria?.trim() ?? "", deadline: input.deadline ?? null,
                        status: "ACTIVE", center, bounds, styleId, morphology, createdAt,
                      };
                      return {
                        data,
                        eventType: "city.created",
                        eventPayload: { cityId: id, center, affectedBounds: archiveBounds ? unionRect(bounds, archiveBounds) : bounds },
                      };
                    });
  }

  async renameCity(countryId: string, input: { cityId: string; name: string; idempotencyKey: string }): Promise<CityDto> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) throw new DomainError("INVALID_INPUT", "Название города должно содержать от 2 до 100 символов");
    return await this.mutate(countryId, "city.rename.v1", input.idempotencyKey, input, async () => {
                      const row = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
                      if (!row) throw new DomainError("NOT_FOUND", "Город не найден");
                      await this.db.prepare("UPDATE cities_v3 SET name = ? WHERE id = ?").run(name, input.cityId);
                      const data = cityDto({ ...row, name });
                      return {
                        data,
                        eventType: "city.renamed",
                        eventPayload: { cityId: input.cityId, name, affectedBounds: await this.cityPresentationBounds(countryId, data) },
                      };
                    });
  }

  private async cityPresentationBounds(countryId: string, city: CityDto): Promise<Rect> {
    const signs = await this.db.prepare(`SELECT footprint_json FROM world_features_v6
      WHERE country_id = ? AND city_id = ? AND kind = 'CITY_SIGN'`).all(countryId, city.id) as Row[];
    return signs.reduce<Rect>((affected, row) => {
      const cells = json<Cell[]>(row.footprint_json);
      return cells.length > 0 ? unionRect(affected, boundsOf(cells)) : affected;
    }, city.bounds);
  }

  async updateCity(countryId: string, input: {
    cityId: string; name?: string; description?: string; goal?: string; acceptanceCriteria?: string;
    deadline?: string | null; idempotencyKey: string;
  }): Promise<CityDto> {
    return this.mutate(countryId, "city.update.v18", input.idempotencyKey, input, async () => {
      const row = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
      if (!row) throw new DomainError("NOT_FOUND", "Город не найден");
      const current = cityDto(row);
      const name = input.name === undefined ? current.name : input.name.trim();
      if (name.length < 2 || name.length > 100) throw new DomainError("INVALID_INPUT", "Название города должно содержать от 2 до 100 символов");
      await this.db.prepare(`UPDATE cities_v3 SET name = ?, description = ?, goal = ?, acceptance_criteria = ?, deadline = ? WHERE id = ?`).run(
        name,
        input.description === undefined ? current.description : input.description.trim().slice(0, 8000),
        input.goal === undefined ? current.goal : input.goal.trim().slice(0, 4000),
        input.acceptanceCriteria === undefined ? current.acceptanceCriteria : input.acceptanceCriteria.trim().slice(0, 8000),
        input.deadline === undefined ? current.deadline : input.deadline,
        input.cityId,
      );
      const updated = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ?").get(input.cityId) as Row;
      const data = cityDto(updated);
      return {
        data,
        eventType: "city.updated",
        eventPayload: { cityId: data.id, affectedBounds: await this.cityPresentationBounds(countryId, data) },
      };
    });
  }

  /** Remove city-owned streets while retaining only genuine national/through
   * road components. A component is considered shared when it is still a
   * HIGHWAY or crosses at least two different sides of the deleted city. */
  private async cleanupDeletedCityRoads(countryId: string, bounds: Rect): Promise<number> {
    const roads = await this.roadCells(countryId);
    const inside = new Map([...roads].filter(([, road]) => contains(bounds, road)));
    const eligible = new Set([...inside].filter(([, road]) => road.roadClass === "ARTERIAL" || road.roadClass === "HIGHWAY").map(([key]) => key));
    const preserve = new Set<string>();
    const visited = new Set<string>();
    const boundarySide = (cell: Cell): string | undefined => {
      if (cell.x === bounds.minX) return "W";
      if (cell.x === bounds.maxX) return "E";
      if (cell.y === bounds.minY) return "N";
      if (cell.y === bounds.maxY) return "S";
      return undefined;
    };
    for (const startKey of eligible) {
      if (visited.has(startKey)) continue;
      const component: string[] = [];
      const sides = new Set<string>();
      let containsHighway = false;
      const queue = [inside.get(startKey)!];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const key = cellKey(current);
        if (visited.has(key) || !eligible.has(key)) continue;
        visited.add(key);
        component.push(key);
        if (current.roadClass === "HIGHWAY") containsHighway = true;
        const side = boundarySide(current);
        if (side && neighbors4(current).some((neighbor) => !contains(bounds, neighbor) && roads.has(cellKey(neighbor)))) sides.add(side);
        for (const next of neighbors4(current)) {
          const candidate = inside.get(cellKey(next));
          if (candidate && eligible.has(cellKey(candidate)) && !visited.has(cellKey(candidate))) queue.push(candidate);
        }
      }
      if (containsHighway || sides.size >= 2) for (const key of component) preserve.add(key);
    }
    const removed = [...inside].filter(([key]) => !preserve.has(key)).map(([, road]) => road);
    const remove = this.db.prepare("DELETE FROM roads_v3 WHERE country_id = ? AND x = ? AND y = ?");
    for (const road of removed) {
      await remove.run(countryId, road.x, road.y);
      roads.delete(cellKey(road));
    }
    await this.recalculateRoadMasks(countryId, removed);
    this.surfaceCache.delete(countryId);
    return removed.length;
  }

  async deleteCity(countryId: string, input: { cityId: string; confirmName: string; idempotencyKey: string }): Promise<{ deleted: true; cityId: string; name: string; districtsDeleted: number; tasksDeleted: number; roadsDeleted: number }> {
    return await this.mutate(countryId, "city.delete.v1", input.idempotencyKey, input, async () => {
                      const row = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
                      if (!row) throw new DomainError("NOT_FOUND", "Город не найден");
                      const city = cityDto(row);
                      if (input.confirmName.trim() !== city.name) throw new DomainError("CONFIRMATION_MISMATCH", "Для удаления укажите точное текущее название города");
                      const counts = await this.db.prepare(`SELECT
                        (SELECT COUNT(*) FROM districts_v3 WHERE city_id = ?) AS districts,
                        (SELECT COUNT(*) FROM tasks_v3 WHERE city_id = ?) AS tasks`).get(city.id, city.id) as Row;
                      // Features, districts, tasks, comments and spatial-index rows are
                      // removed by FK/trigger cascades. Only genuine shared/national road
                      // components survive the bounded cleanup.
                      await this.db.prepare("DELETE FROM cities_v3 WHERE id = ?").run(city.id);
                      const roadsDeleted = await this.cleanupDeletedCityRoads(countryId, city.bounds);
                      const data = {
                        deleted: true as const, cityId: city.id, name: city.name,
                        districtsDeleted: Number(counts.districts), tasksDeleted: Number(counts.tasks), roadsDeleted,
                      };
                      return { data, eventType: "city.deleted", eventPayload: { ...data, affectedBounds: city.bounds } };
                    });
  }

  private districtShape(origin: Cell, width: number, height: number, seed: number): Cell[] {
    // Cut whole triangular corners instead of removing random border cells. This
    // keeps every generated district four-neighbour connected while still giving
    // neighbouring districts visibly different silhouettes.
    const cuts = [509, 511, 513, 515].map((salt) => 2 + Math.floor(hashCoordinate(seed, origin.x, origin.y, salt) * 4));
    const cells: Cell[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const topLeft = x + y < cuts[0]!;
        const topRight = (width - 1 - x) + y < cuts[1]!;
        const bottomLeft = x + (height - 1 - y) < cuts[2]!;
        const bottomRight = (width - 1 - x) + (height - 1 - y) < cuts[3]!;
        if (topLeft || topRight || bottomLeft || bottomRight) continue;
        cells.push({ x: origin.x + x, y: origin.y + y });
      }
    }
    return cells;
  }

  private async overlapsDistrict(countryId: string, cells: Cell[], exceptDistrictId?: string): Promise<boolean> {
    const wanted = new Set(cells.map(cellKey));
    for (const district of await this.listDistricts(countryId)) {
      if (district.id === exceptDistrictId) continue;
      if (district.cells.some((cell) => wanted.has(cellKey(cell)))) return true;
    }
    return false;
  }

  private distanceToRoad(cell: Cell, roads: Map<string, RoadCellDto>, limit = 20): number {
    if (roads.has(cellKey(cell))) return 0;
    for (let distance = 1; distance <= limit; distance += 1) {
      for (let dx = -distance; dx <= distance; dx += 1) {
        const dy = distance - Math.abs(dx);
        if (roads.has(cellKey({ x: cell.x + dx, y: cell.y + dy }))) return distance;
        if (dy !== 0 && roads.has(cellKey({ x: cell.x + dx, y: cell.y - dy }))) return distance;
      }
    }
    return limit + 1;
  }

  private distanceToSurface(cell: Cell, surfaces: Map<string, SurfaceCellDto>, limit = 8): number {
    if (surfaces.has(cellKey(cell))) return 0;
    for (let distance = 1; distance <= limit; distance += 1) {
      for (let dx = -distance; dx <= distance; dx += 1) {
        const dy = distance - Math.abs(dx);
        if (surfaces.has(cellKey({ x: cell.x + dx, y: cell.y + dy }))) return distance;
        if (dy !== 0 && surfaces.has(cellKey({ x: cell.x + dx, y: cell.y - dy }))) return distance;
      }
    }
    return limit + 1;
  }

  /** Demolished plots whose footprint intersects the given cells are removed. */
  private async clearRuins(countryId: string, cells: Cell[], snapshot?: GenerationSpatialSnapshot): Promise<void> {
    if (cells.length === 0) return;
    const keys = new Set(cells.map(cellKey));
    const ruins = (snapshot?.features ?? await this.listWorldFeatures(countryId)).filter((feature) => feature.kind === "RUIN");
    const remove = this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?");
    for (const ruin of ruins) {
      if (ruin.footprint.some((cell) => keys.has(cellKey(cell)))) {
        await remove.run(ruin.id);
        if (snapshot) snapshot.features = snapshot.features.filter((feature) => feature.id !== ruin.id);
      }
    }
  }

  /**
   * V10 organic growth. The next complex (ЖК) is placed inside the district
   * territory directly against the existing development; when the territory is
   * full, the territory itself grows first and the complex follows. Streets are
   * published only together with the complex that needs them — a road never
   * appears ahead of demand.
   */
  private async growDistrict(
    countryId: string,
    district: DistrictDto,
    entry: BuildingCatalogEntry,
    snapshot: GenerationSpatialSnapshot,
  ): Promise<DistrictDto> {
    if (district.status === "COMPLETED") throw new DomainError("DISTRICT_SEALED", "Закрытый район больше не расширяется");
    const seed = Number((await this.countryRow(countryId)).seed);
    const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ?").get(district.cityId) as Row;
    const city = cityDto(cityRow);
    const denseGrid = city.morphology === "DENSE_CORE";
    const protectedCities = snapshot.cities
      .filter((candidate) => candidate.id !== city.id)
      .map((candidate) => expandRect(candidate.bounds, 12));
    // Capacity describes the team's planning horizon, not how much land may be
    // paved before demand exists. Publish one compact, reusable cluster at a
    // time; later tasks grow another cluster only after the existing choices
    // are exhausted or cannot fit the requested building footprint.
    // A dense core uses straight shared streets, but still publishes them only
    // as tasks consume frontage. Reserving twelve pads for the first two tasks
    // pushed asphalt above the city audit limit and recreated empty roads.
    // A dense core needs enough mixed-width frontage to absorb several large
    // facades without opening a third street cluster. Ten is the smallest
    // stable runway across the seeded 4–6 cell catalog widths; the former
    // twelve-pad reservation over-paved the first block.
    const targetLots = denseGrid ? Math.max(10, organicComplexLotTarget(district.capacitySp)) : organicComplexLotTarget(district.capacitySp);
    const complexIndex = new Set(district.lots.map((lot) => lot.groupId).filter(Boolean)).size;

    const infill = await this.tryGrowComplex(countryId, district, entry, boundsOf(district.cells), complexIndex, targetLots, seed, denseGrid, snapshot);
    if (infill) {
      // A full-width street may adopt a one-cell neutral edge even when the
      // complex is infill. Keep the city envelope authoritative in this branch
      // too; previously only annex growth expanded it.
      const expandedCity = unionRect(city.bounds, expandRect(boundsOf(infill.cells), 8));
      if (JSON.stringify(expandedCity) !== JSON.stringify(city.bounds)) {
        await this.db.prepare("UPDATE cities_v3 SET bounds_json = ? WHERE id = ?").run(JSON.stringify(expandedCity), city.id);
        snapshot.cities = snapshot.cities.map((candidate) => candidate.id === city.id
          ? { ...candidate, bounds: expandedCity }
          : candidate);
        await this.normalizeUrbanHighways(countryId, expandedCity);
      }
      return infill;
    }

    const originalBounds = boundsOf(district.cells);
    const existingKeys = new Set(district.cells.map(cellKey));
    const blockedByDistrict = new Set(
      snapshot.districts
                        .filter((candidate) => candidate.id !== district.id)
                        .flatMap((candidate) => candidate.cells)
                        .map(cellKey),
    );
    const archiveFeatures = snapshot.features.filter((feature) => feature.kind === "COUNTRY_ARCHIVE");
    const institutionalReserved = new Set([
      ...archiveFeatures.flatMap((feature) => feature.footprint).map(cellKey),
      ...archiveFeatures.filter((feature) => feature.assetKind === "AREA")
        .flatMap((feature) => stampRoadCorridor(feature.accessPath, "LOCAL", ROAD_WIDTH).map(cellKey)),
    ]);
    const directions = ([district.growthDirection, "E", "S", "W", "N"] as GrowthDirection[])
      .filter((value, index, all) => all.indexOf(value) === index);
    for (const thickness of districtGrowthThicknesses(entry)) {
      for (const direction of directions) {
        const shoulder = 4;
        let patchRect: Rect;
        if (direction === "E") patchRect = { minX: originalBounds.maxX + 1, maxX: originalBounds.maxX + thickness, minY: originalBounds.minY - shoulder, maxY: originalBounds.maxY + shoulder };
        else if (direction === "W") patchRect = { minX: originalBounds.minX - thickness, maxX: originalBounds.minX - 1, minY: originalBounds.minY - shoulder, maxY: originalBounds.maxY + shoulder };
        else if (direction === "S") patchRect = { minX: originalBounds.minX - shoulder, maxX: originalBounds.maxX + shoulder, minY: originalBounds.maxY + 1, maxY: originalBounds.maxY + thickness };
        else patchRect = { minX: originalBounds.minX - shoulder, maxX: originalBounds.maxX + shoulder, minY: originalBounds.minY - thickness, maxY: originalBounds.minY - 1 };

        const available = rectangleFootprint(
          { x: patchRect.minX, y: patchRect.minY },
          patchRect.maxX - patchRect.minX + 1,
          patchRect.maxY - patchRect.minY + 1,
        ).filter((cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain)
          && !blockedByDistrict.has(cellKey(cell)) && !institutionalReserved.has(cellKey(cell)));
        const availableKeys = new Set(available.map(cellKey));
        const queue = available.filter((cell) => neighbors4(cell).some((next) => existingKeys.has(cellKey(next))));
        const reachable = new Map<string, Cell>();
        while (queue.length > 0) {
          const current = queue.shift()!;
          const key = cellKey(current);
          if (reachable.has(key)) continue;
          reachable.set(key, current);
          for (const next of neighbors4(current)) if (availableKeys.has(cellKey(next)) && !reachable.has(cellKey(next))) queue.push(next);
        }
        const patch = [...reachable.values()];
        if (patch.length < (entry.tags.includes("new-build") ? 900 : 300)) {
          continue;
        }
        const patchBounds = boundsOf(patch);
        const expandedCity = unionRect(city.bounds, expandRect(patchBounds, 8));
        if (protectedCities.some((bounds) => intersects(bounds, expandedCity))) {
          continue;
        }
        const grown: DistrictDto = { ...district, cells: [...district.cells, ...patch], growthDirection: direction };
        // Search the fresh annex plus a bounded old-land seam. Using the union
        // with the complete historical district made the ranked candidate cap
        // spend every probe on already occupied central blocks once a city had
        // grown long, so thousands of valid annex cells were never examined.
        const grownSearchBounds = districtAnnexSearchBounds(patchBounds);
        const sited = await this.tryGrowComplex(countryId, grown, entry, grownSearchBounds, complexIndex, targetLots, seed, denseGrid, snapshot);
        if (!sited) continue;
        if (JSON.stringify(expandedCity) !== JSON.stringify(city.bounds)) {
          await this.db.prepare("UPDATE cities_v3 SET bounds_json = ? WHERE id = ?").run(JSON.stringify(expandedCity), city.id);
          snapshot.cities = snapshot.cities.map((candidate) => candidate.id === city.id
            ? { ...candidate, bounds: expandedCity }
            : candidate);
        }
        await this.normalizeUrbanHighways(countryId, expandedCity);
        return sited;
      }
    }
    throw new DomainError("PLACEMENT_BLOCKED", "Район не удалось расширить новым комплексом без пересечений");
  }

  /**
   * Site one complex inside the search bounds, connect it to the road network
   * and publish its streets. Returns the updated district or null when no
   * valid site exists there.
   */
  private async tryGrowComplex(
    countryId: string,
    district: DistrictDto,
    entry: BuildingCatalogEntry,
    searchBounds: Rect,
    complexIndex: number,
    targetLots: number,
    seed: number,
    denseGrid: boolean,
    snapshot: GenerationSpatialSnapshot,
  ): Promise<DistrictDto | null> {
    const allowed = new Set(district.cells.map(cellKey));
    const bootstrapCollector = entry.ruleIds.includes("REQUIRES_COLLECTOR")
      && !await this.districtHasCollector(district.id);
    const roads = snapshot.roads;
    const existingRoadKeys = new Set(roads.keys());
    const occupied = new Set([
      ...snapshot.tasks.flatMap((task) => [...taskOccupiedCells(task), task.entrance, ...task.accessPath]),
      ...snapshot.features.filter((feature) => feature.kind !== "RUIN")
        .flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
    ].map(cellKey));
    const blockedByDistrict = new Set(
      snapshot.districts
                        .filter((candidate) => candidate.id !== district.id)
                        .flatMap((candidate) => candidate.cells)
                        .map(cellKey),
    );
    const sealed = new Set(snapshot.districts.filter((candidate) => candidate.status === "COMPLETED")
      .flatMap((candidate) => candidate.cells).map(cellKey));
    const institutionalRoads = new Set(snapshot.features
      .filter((feature) => (feature.kind === "COUNTRY_ARCHIVE" || feature.kind === "AIRPORT") && feature.assetKind === "AREA")
      .flatMap((feature) => stampRoadCorridor(feature.accessPath, "LOCAL", ROAD_WIDTH)).map(cellKey));
    // Streets are shared infrastructure: a connector may cross a still-growing
    // neighbour's empty territory (its future complexes simply avoid the road),
    // but never a sealed district. The first pass still prefers a corridor that
    // stays on neutral ground.
    const foreignSoft = new Set([...blockedByDistrict].filter((key) => !sealed.has(key)));
    const districtRoads = [...roads.values()].filter((road) => allowed.has(cellKey(road)) && !institutionalRoads.has(cellKey(road)));
    // Completed districts seal land and buildings, not their public streets.
    // All public asphalt counts for proximity, but a new branch starts only at
    // a boundary road cell. Starting from an interior cell forces A* to test
    // thousands of impossible lateral exits through sealed land.
    const proximityRoads = [...roads.values()].filter((road) => !institutionalRoads.has(cellKey(road)));
    const safeRoads = proximityRoads.filter((road) =>
      !sealed.has(cellKey(road)) || neighbors4(road).some((cell) => !sealed.has(cellKey(cell))));
    // Infill grows directly against the district's own streets. A fresh
    // territory lobe can sit away from them, so there the complex anchors to
    // the shared road network and reaches it with a longer access road.
    const nearDistrictRoads = districtRoads.filter((road) => contains(expandRect(searchBounds, 16), road));
    const localNetworkBounds = expandRect(searchBounds, 192);
    const localSafeRoads = safeRoads.filter((road) => contains(localNetworkBounds, road));
    const localProximityRoads = proximityRoads.filter((road) => contains(localNetworkBounds, road));
    // Complex scoring and connector pairing are local operations. Feeding the
    // complete national graph into every candidate made mature countries
    // multiply thousands of rectangles by tens of thousands of remote roads.
    const anchors = nearDistrictRoads.length > 0
      ? nearDistrictRoads
      : localSafeRoads.length > 0 ? localSafeRoads : safeRoads;
    const proximityAnchors = nearDistrictRoads.length > 0
      ? nearDistrictRoads
      : localProximityRoads.length > 0 ? localProximityRoads : proximityRoads;
    // A later compact block may legitimately sit across the unbuilt half of a
    // large district territory. Limiting infill to eight cells from the first
    // street made a 10-district city box its active district after one block,
    // even though hundreds of buildable cells remained inside its boundary.
    // The connector is still demand-driven and validated below, so a wider
    // search fills reserved urban land before annexing another territory.
    // Established infill stays close to its own frontage. A fresh annex has
    // no district road inside the search window yet; its first block may sit
    // deeper in the new lobe and is connected by the validated demand-driven
    // collector below. Keeping the same 24-cell cap made every viable annex
    // candidate disappear before the connector could be planned.
    const maxAdjacency = nearDistrictRoads.length > 0 ? 24 : 96;
    if (anchors.length === 0) return null;
    const expectedRole = this.lotRoleForEntry(district.archetype, entry);
    const strictRoles = district.archetype === "NEW_BUILD" || district.archetype === "PRIVATE";
    const localStreetTerrainMemo = new Map<string, "BUILDABLE" | "WATER" | "BLOCKED">();

    // Demand-driven footprint: roughly sixty cells per planned building with a
    // seeded aspect, so complexes vary between wide slabs and compact courts.
    // The rect is capped to the search bounds — a smaller territory simply
    // hosts a smaller first complex and grows more of them later. The first
    // complex never swallows the whole territory: at most ~70% of it, so a
    // pocket park and later infill always have land left.
    const boundsWidth = searchBounds.maxX - searchBounds.minX + 1;
    const boundsHeight = searchBounds.maxY - searchBounds.minY + 1;
    const prefixStride = boundsWidth + 1;
    const prefixSize = prefixStride * (boundsHeight + 1);
    const allowedPrefix = new Int32Array(prefixSize);
    const unsuitablePrefix = new Int32Array(prefixSize);
    for (let localY = 1; localY <= boundsHeight; localY += 1) {
      for (let localX = 1; localX <= boundsWidth; localX += 1) {
        const cell = { x: searchBounds.minX + localX - 1, y: searchBounds.minY + localY - 1 };
        const index = localY * prefixStride + localX;
        const left = index - 1;
        const above = index - prefixStride;
        const diagonal = above - 1;
        allowedPrefix[index] = (allowed.has(cellKey(cell)) ? 1 : 0)
          + allowedPrefix[left]! + allowedPrefix[above]! - allowedPrefix[diagonal]!;
        unsuitablePrefix[index] = (!isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain) ? 1 : 0)
          + unsuitablePrefix[left]! + unsuitablePrefix[above]! - unsuitablePrefix[diagonal]!;
      }
    }
    const prefixRectSum = (prefix: Int32Array, rect: Rect): number => {
      const left = rect.minX - searchBounds.minX;
      const top = rect.minY - searchBounds.minY;
      const right = rect.maxX - searchBounds.minX + 1;
      const bottom = rect.maxY - searchBounds.minY + 1;
      return prefix[bottom * prefixStride + right]!
        - prefix[top * prefixStride + right]!
        - prefix[bottom * prefixStride + left]!
        + prefix[top * prefixStride + left]!;
    };
    const residentialComplex = entry.tags.some((tag) =>
      tag === "low-rise-residential" || tag === "mid-rise-residential" || tag === "high-rise-residential");
    const minimumRect = complexMinimumRect(entry, targetLots);
    // The legacy PRIVATE code now means a low+mid-rise apartment district.
    // Its first frontage must fit several 12–16-cell ЖК corps rather than the
    // removed row of compact detached houses.
    const initialFrontageWidth = initialResidentialFrontageWidth(
      district.archetype,
      complexIndex,
      entry.footprint.width,
    );
    const minimumRectWidth = Math.max(minimumRect.width, initialFrontageWidth);
    const minimumRectHeight = minimumRect.height;
    if (boundsWidth < minimumRectWidth + 2 || boundsHeight < minimumRectHeight + 2) return null;
    const territoryCap = complexIndex === 0
      ? Math.min(
        allowed.size,
        Math.max(residentialComplex ? 1_250 : 240, Math.floor(allowed.size * (denseGrid ? 0.82 : 0.8))),
      )
      : Number.POSITIVE_INFINITY;
    const area = Math.min(
      residentialComplex ? Math.max(targetLots * 120, minimumRectWidth * minimumRectHeight) : targetLots * (denseGrid ? 68 : 60),
      territoryCap,
    );
    // Dense cores need enough north/south depth for three shared frontage
    // streets. Organic districts keep the wider seeded aspect palette.
    const aspect = denseGrid
      ? 0.78 + hashCoordinate(seed, searchBounds.minX, searchBounds.minY, 941 + complexIndex) * 0.16
      : 0.7 + hashCoordinate(seed, searchBounds.minX, searchBounds.minY, 941 + complexIndex) * 0.9;
    const rectWidth = Math.max(minimumRectWidth, Math.min(residentialComplex ? 72 : 40, boundsWidth - 2, Math.round(Math.sqrt(area * aspect))));
    const rectHeight = Math.max(minimumRectHeight, Math.min(34, boundsHeight - 2, Math.round(area / rectWidth)));

    const searchCenter = {
      x: Math.floor((searchBounds.minX + searchBounds.maxX) / 2),
      y: Math.floor((searchBounds.minY + searchBounds.maxY) / 2),
    };
    const candidates: Array<{ rect: Rect; score: number }> = [];
    // Large V5 facades have a much smaller valid window between existing
    // streets and cut terrain than compact houses. A three-cell sampling step
    // could jump over that window entirely and report PLACEMENT_BLOCKED even
    // though a valid 18x14 lot was visible inside the district. Keep the cheap
    // coarse scan for compact entries and use a two-cell lattice for statement
    // buildings; the ranked cap below still bounds connector work.
    const siteStep = entry.footprint.width >= 18 || entry.footprint.height >= 14 ? 2 : 3;
    // A fresh annex can wrap around a narrow creek, rock shelf, or other
    // non-buildable cut-out. The planner validates every published lot and
    // the road publisher assigns bridge/tunnel structure where required, so
    // the coarse envelope only needs to be mostly inside the new territory.
    // Infill keeps the stricter threshold to avoid hollowing an established
    // block around old development.
    const minimumInsideRatio = nearDistrictRoads.length === 0 ? 0.75 : 0.9;
    const maximumUnsuitableRatio = nearDistrictRoads.length === 0 ? 0.25 : 0.06;
    for (let y = searchBounds.minY + 1; y + rectHeight - 1 <= searchBounds.maxY - 1; y += siteStep) {
      for (let x = searchBounds.minX + 1; x + rectWidth - 1 <= searchBounds.maxX - 1; x += siteStep) {
        const rect: Rect = { minX: x, minY: y, maxX: x + rectWidth - 1, maxY: y + rectHeight - 1 };
        // The district silhouette has cut corners, so a complex nearly as big
        // as the territory can never be fully inside it. Accept sites that are
        // mostly inside; the planner drops the few lots that fall outside.
        const cellCount = rectWidth * rectHeight;
        const insideCount = prefixRectSum(allowedPrefix, rect);
        if (insideCount / cellCount < minimumInsideRatio) continue;
        // The coarse planning rectangle may cover an existing street or a
        // neighbouring facade; individual lots and road corridors are filtered
        // against those hard obstacles below. Rejecting the whole rectangle
        // here forced one road per building in dense districts.
        const unsuitable = prefixRectSum(unsuitablePrefix, rect);
        if (unsuitable / cellCount > maximumUnsuitableRatio) continue;
        // Organic rule: the next complex grows directly against the existing
        // streets. The first complex of a district anchors to the closest road.
        const adjacency = Math.min(...proximityAnchors.map((road) => {
          const dx = Math.max(0, rect.minX - road.x, road.x - rect.maxX);
          const dy = Math.max(0, rect.minY - road.y, road.y - rect.maxY);
          return dx + dy;
        }));
        if (adjacency > maxAdjacency) continue;
        const center = { x: x + Math.floor(rectWidth / 2), y: y + Math.floor(rectHeight / 2) };
        const score = adjacency * 6 + unsuitable * 30 + manhattan(center, searchCenter) * 0.5 + hashCoordinate(seed, x, y, 953) * 4;
        candidates.push({ rect, score });
      }
    }
    // The score orders viable frontage by distance and terrain quality. A
    // bounded pool keeps task creation predictable under concurrent use while
    // still covering irregular coast/forest cut-outs that need more than the
    // former twelve probes.
    const candidateLimit = siteStep === 2 ? 512 : 256;
    for (const candidate of candidates.sort((left, right) => left.score - right.score).slice(0, candidateLimit)) {
      // Size the first frontage for the whole compatible facade family, not
      // only for whichever model happened to win the first task ranking. A
      // six-cell cottage followed by a nine-cell duplex (or a 12-cell tower
      // followed by a 14-cell tower) must reuse the same street instead of
      // discovering that every vacant bay is two cells too narrow and opening
      // a second road. Explicit statement buildings wider/deeper than the
      // common family still raise the envelope to their real footprint.
      const lotDepth = buildingLotDepthCells(entry);
      const frontageMinimumLot = district.archetype === "PRIVATE"
        ? { width: Math.max(8, entry.footprint.width), height: Math.max(5, lotDepth) }
        : district.archetype === "NEW_BUILD"
          ? { width: Math.max(14, entry.footprint.width), height: Math.max(12, lotDepth) }
          : { width: entry.footprint.width, height: lotDepth };
      const planned = planComplex({
        districtId: district.id,
        complexIndex,
        rect: candidate.rect,
        cells: district.cells,
        allowedCellKeys: allowed,
        archetype: district.archetype,
        targetLots,
        minimumLot: frontageMinimumLot,
        seed,
        denseGrid,
        // Tall frontal-top facades keep one frontage row so their northward
        // projection cannot cover the next street. Compact residential
        // buildings form the multi-row slabs and courts around those accents.
        shape: buildingVisualSetbackCells(entry) > 0 ? "COMPLEX_ROW" : undefined,
        reserveSupport: !district.lots.some((lot) => lot.role === "SUPPORT"),
      });
      const plan = {
        ...planned,
        lots: planned.lots.filter((lot) => !rectangleFootprint(lot.origin, lot.width, lot.height)
          .some((cell) => existingRoadKeys.has(cellKey(cell)) || occupied.has(cellKey(cell)))),
      };
      // Normal complexes need one occupied pad plus at least two genuine
      // alternatives; otherwise a clipped corner publishes a one-off street
      // and immediately forces another growth cycle. Small demand and large
      // statement buildings may intentionally publish a single superblock.
      const minimumPublishedLots = targetLots <= 4 || entry.footprint.width >= 18 || entry.footprint.height >= 14
        ? 1
        : Math.min(3, targetLots);
      if (plan.lots.length < minimumPublishedLots) continue;
      // Strict archetypes never sacrifice their few service slots to housing,
      // but a service building may occupy a regular lot when no service slot
      // fits it — zoning guides placement, it never deadlocks growth.
      const fitsEntry = (lots: PlannedLotDto[]) => {
        const fittingLots = lots.filter((lot) => entry.footprint.width <= lot.width && buildingLotDepthCells(entry) <= lot.height);
        const roleFitting = fittingLots.filter((lot) => lot.role === expectedRole);
        return strictRoles && expectedRole === "PRIMARY" ? roleFitting.length > 0 : fittingLots.length > 0;
      };
      if (!fitsEntry(plan.lots)) continue;
      const corridors = plan.streets.flatMap((segment) => this.roadCorridor(segment, "LOCAL"));
      if (corridors.some((cell) => occupied.has(cellKey(cell)) || blockedByDistrict.has(cellKey(cell)))) continue;
      // The planner may place a lateral lane one cell beyond a fresh annex's
      // irregular 75%-land mask. Adopt that neutral edge into the district
      // before validation instead of rejecting the complete block and running
      // another expensive search. Foreign/occupied land remains forbidden.
      const streetTerritory = corridors.filter((cell) => !existingRoadKeys.has(cellKey(cell)) && !allowed.has(cellKey(cell)));
      const streetEnvelope = expandRect(searchBounds, 1);
      if (streetTerritory.some((cell) => !contains(streetEnvelope, cell))) continue;
      const candidateAllowed = new Set(allowed);
      for (const cell of streetTerritory) candidateAllowed.add(cellKey(cell));
      if (!plannedLocalStreetCorridorsValid(plan.streets, candidateAllowed, seed, roads, localStreetTerrainMemo)) continue;
      const reserved = plan.lots.flatMap((lot) => rectangleFootprint(lot.origin, lot.width, lot.height));
      const reservedKeys = new Set(reserved.map(cellKey));
      const endpoints = plan.streets.flatMap((segment) => [segment[0]!, segment.at(-1)!]);
      const pairs = anchors.flatMap((road) => endpoints.map((endpoint) => ({ road, endpoint, distance: manhattan(road, endpoint) })))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 96)
        .map((pair) => {
          const blockers = (horizontalFirst: boolean) => this.roadCorridor(
            orthogonalPath(pair.road, pair.endpoint, horizontalFirst),
            complexIndex === 0 || bootstrapCollector ? "COLLECTOR" : "LOCAL",
          ).filter((cell) => {
            const key = cellKey(cell);
            if (existingRoadKeys.has(key)) return false;
            return occupied.has(key) || blockedByDistrict.has(key) || reservedKeys.has(key);
          }).length;
          return { ...pair, blockerScore: Math.min(blockers(true), blockers(false)) };
        })
        .sort((left, right) => left.blockerScore - right.blockerScore || left.distance - right.distance)
        .slice(0, 24);
      // Committed buildings/features and sealed districts are hard stops.
      // Planned lots are soft reservations and a growing neighbour's empty
      // territory is shared ground: the passes prefer a clean corridor, then
      // allow crossing foreign territory, and finally let the connector cut
      // through at most two corner lots — sacrificing those plots to the
      // street rather than losing the complex.
      let connector: Cell[] | null = null;
      let sacrificedLotIds = new Set<string>();
      const connectorClass = complexIndex === 0 || bootstrapCollector ? "COLLECTOR" : "LOCAL";
      for (const [allowLotClipping, allowForeign] of [[false, false], [false, true], [true, true]] as const) {
        for (const pair of pairs) {
          try {
            // Prefer one clean orthogonal connector at every distance. Besides
            // producing straight, square city streets, this avoids invoking A*
            // for dozens of obviously clear candidate pairs. A* remains the
            // obstacle fallback after the full-width corridor is validated.
            const horizontalFirst = Math.abs(pair.road.x - pair.endpoint.x) >= Math.abs(pair.road.y - pair.endpoint.y);
            let path = orthogonalPath(pair.road, pair.endpoint, horizontalFirst);
            let corridorCells = this.roadCorridor(path, connectorClass);
            const hardBlocked = (cell: Cell) => {
              const key = cellKey(cell);
              return connectorCorridorBlocked(key, occupied, existingRoadKeys, blockedByDistrict, foreignSoft, allowForeign);
            };
            const softBlocked = (cell: Cell) => hardBlocked(cell) || (!allowLotClipping && reservedKeys.has(cellKey(cell)));
            if (corridorCells.some(softBlocked)) {
              // Test both square L-bends before invoking A*. The old single
              // orientation repeatedly ran a full obstacle/database rebuild
              // even when the opposite elbow was completely clear.
              const alternate = orthogonalPath(pair.road, pair.endpoint, !horizontalFirst);
              const alternateCorridor = this.roadCorridor(alternate, connectorClass);
              if (!alternateCorridor.some(softBlocked)) {
                path = alternate;
                corridorCells = alternateCorridor;
              } else {
                path = await this.route(countryId, seed, pair.road, pair.endpoint, [], allowLotClipping ? [] : reserved, 1, true, snapshot);
                corridorCells = this.roadCorridor(path, connectorClass);
              }
            }
            if (corridorCells.some(hardBlocked)) continue;
            if (!allowLotClipping) {
              if (corridorCells.some((cell) => reservedKeys.has(cellKey(cell)))) continue;
            } else {
              const clippedKeys = new Set(corridorCells.filter((cell) => reservedKeys.has(cellKey(cell))).map(cellKey));
              const hit = clippedKeys.size === 0
                ? []
                : plan.lots.filter((lot) => rectangleFootprint(lot.origin, lot.width, lot.height).some((cell) => clippedKeys.has(cellKey(cell))));
              if (hit.length > 2) continue;
              const remainingLots = plan.lots.filter((lot) => !hit.some((dropped) => dropped.id === lot.id));
              if (remainingLots.length < minimumPublishedLots || !fitsEntry(remainingLots)) continue;
              sacrificedLotIds = new Set(hit.map((lot) => lot.id));
            }
            connector = path;
            break;
          } catch (error) {
            if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
          }
        }
        if (connector) break;
      }
      if (!connector) continue;
      const expandedDistrictCells = streetTerritory.length === 0
        ? district.cells
        : [...new Map([...district.cells, ...streetTerritory].map((cell) => [cellKey(cell), cell])).values()];
      await this.addRoadPath(countryId, seed, connector, connectorClass, snapshot);
      // Segments stick only where they meet the existing network, so streets
      // go out in reachability order: each pass publishes every segment that
      // touches a road published so far — the spine streets bridge the
      // parallel tier streets into one connected component.
      const published = new Set(snapshot.roads.keys());
      let pending = [...plan.streets];
      while (pending.length > 0) {
        const ready = pending.filter((segment) => segment.some((cell) =>
          published.has(cellKey(cell)) || neighbors4(cell).some((next) => published.has(cellKey(next)))));
        const batch = ready.length > 0 ? ready : pending;
        for (const segment of batch) {
          await this.addRoadPath(countryId, seed, segment, "LOCAL", snapshot);
          for (const cell of this.roadCorridor(segment, "LOCAL")) published.add(cellKey(cell));
        }
        pending = pending.filter((segment) => !batch.includes(segment));
      }
      await this.clearRuins(countryId, [...this.roadCorridor(connector, connectorClass), ...corridors], snapshot);
      // Reaching this point means the broad candidate pool could not use any
      // remaining speculative pad in an older complex. Keeping those virtual
      // pads after publishing another street leaves permanent empty gaps and
      // makes the district look pre-zoned instead of demand-grown. Retain
      // occupied lots and real demolition plots (`vacant`), but retire unused
      // planning alternatives as soon as development moves to a new complex.
      const committedLots = district.lots.filter((lot) => lot.taskId || lot.vacant);
      const lots = [...committedLots, ...plan.lots.filter((lot) => !sacrificedLotIds.has(lot.id))];
      await this.db.prepare("UPDATE districts_v3 SET cells_json = ?, lots_json = ?, growth_direction = ? WHERE id = ?")
                                                  .run(JSON.stringify(expandedDistrictCells), JSON.stringify(lots), district.growthDirection, district.id);
      // Green areas arrive together with the first streets: a pocket park or
      // grove is tucked into the remaining territory, away from planned lots.
      const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ?").get(district.cityId) as Row;
      const city = cityDto(cityRow);
      const greenAdjustedLots = await this.publishDistrictGreenFeature(
        countryId, city, district.id, seed, expandedDistrictCells, lots, snapshot,
      );
      if (greenAdjustedLots.length !== lots.length) {
        await this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?")
          .run(JSON.stringify(greenAdjustedLots), district.id);
      }
      // The complete complex can include several road segments; prune only
      // after they are all published so a legitimate bridge is never removed
      // halfway through construction.
      await this.repairDanglingBridges(countryId, snapshot);
      const updatedDistrict = { ...district, cells: expandedDistrictCells, lots: greenAdjustedLots };
      snapshot.districts = snapshot.districts.map((candidate) => candidate.id === district.id ? updatedDistrict : candidate);
      return updatedDistrict;
    }
    // Demand overshoots the remaining land: retry with a smaller complex down
    // to the supported three-lot floor. The failure path mutated nothing, and
    // a compact infill block beats surrendering to a full territory patch.
    const nextTarget = nextOrganicComplexLotTarget(targetLots);
    if (nextTarget != null) {
      return this.tryGrowComplex(countryId, district, entry, searchBounds, complexIndex, nextTarget, seed, denseGrid, snapshot);
    }
    return null;
  }


  private districtGrowthReserve(district: DistrictDto, depth = 16): Rect {
    const bounds = boundsOf(district.cells);
    const shoulder = 2;
    if (district.growthDirection === "E") return { minX: bounds.maxX + 1, maxX: bounds.maxX + depth, minY: bounds.minY - shoulder, maxY: bounds.maxY + shoulder };
    if (district.growthDirection === "W") return { minX: bounds.minX - depth, maxX: bounds.minX - 1, minY: bounds.minY - shoulder, maxY: bounds.maxY + shoulder };
    if (district.growthDirection === "S") return { minX: bounds.minX - shoulder, maxX: bounds.maxX + shoulder, minY: bounds.maxY + 1, maxY: bounds.maxY + depth };
    return { minX: bounds.minX - shoulder, maxX: bounds.maxX + shoulder, minY: bounds.minY - depth, maxY: bounds.minY - 1 };
  }

  private async selectDistrictSites(
    countryId: string,
    city: CityDto,
    seed: number,
    width: number,
    height: number,
    candidateValid?: (origin: Cell, cells: Cell[]) => boolean,
    rectangular = false,
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<Array<{ origin: Cell; cells: Cell[] }>> {
    const roads = snapshot?.roads ?? await this.roadCells(countryId);
    const sourceFeatures = snapshot?.features ?? await this.listWorldFeatures(countryId);
    const districts = snapshot?.districts ?? await this.listDistricts(countryId);
    const cityDistricts = districts.filter((district) => district.cityId === city.id);
    const institutionalRoads = new Set(sourceFeatures
      .filter((feature) => (feature.kind === "COUNTRY_ARCHIVE"
        || (feature.kind === "AIRPORT" && cityDistricts.length < 7)) && feature.assetKind === "AREA")
      .flatMap((feature) => stampRoadCorridor(feature.accessPath, "LOCAL", ROAD_WIDTH)).map(cellKey));
    // Institutional drives are connected for traffic, but archive and airport
    // access roads are not normal frontage. A saturated 7+ district city may
    // urbanise the city-side part of its airport connector as a last resort;
    // archive security roads remain excluded forever.
    const preferredRoads = [...roads.values()].filter((road) => road.roadClass !== "HIGHWAY"
      && !institutionalRoads.has(cellKey(road)) && contains(expandRect(city.bounds, 24), road));
    const occupiedCells = districts.flatMap((district) => district.cells);
    const occupied = new Set(occupiedCells.map(cellKey));
    const growthReservations = districts
      .filter((district) => district.status === "ACTIVE")
      .map((district) => this.districtGrowthReserve(district));
    const directionUsage = new Map<GrowthDirection, number>([["N", 0], ["E", 0], ["S", 0], ["W", 0]]);
    for (const district of cityDistricts) {
      if (district.cells.length === 0) continue;
      const districtBounds = boundsOf(district.cells);
      const districtCenter = {
        x: Math.floor((districtBounds.minX + districtBounds.maxX) / 2),
        y: Math.floor((districtBounds.minY + districtBounds.maxY) / 2),
      };
      const direction = this.outwardDirection(city, districtCenter);
      directionUsage.set(direction, (directionUsage.get(direction) ?? 0) + 1);
    }
    const cityDistrictBounds = cityDistricts
      .filter((district) => district.cells.length > 0)
      .map((district) => boundsOf(district.cells));
    const leastUsedDirectionCount = Math.min(...directionUsage.values());
    const protectedCities = (snapshot?.cities ?? await this.listCities(countryId))
              .filter((candidate) => candidate.id !== city.id)
              .map((candidate) => expandRect(candidate.bounds, 12));
    const occupiedIn = cityDistricts.length >= 4
      ? rectOccupancyCounter(occupiedCells, expandRect(city.bounds, 96))
      : undefined;
    for (const extension of [0, 32, 64, 96]) {
      const searchBounds = expandRect(city.bounds, extension);
      const candidates: Array<{ origin: Cell; cells: Cell[]; score: number; repeatedDirection: number }> = [];
      for (let y = searchBounds.minY + 5; y <= searchBounds.maxY - height - 5; y += 4) {
        for (let x = searchBounds.minX + 5; x <= searchBounds.maxX - width - 5; x += 4) {
          const origin = { x, y };
          const candidateBounds: Rect = { minX: x, minY: y, maxX: x + width - 1, maxY: y + height - 1 };
          // districtShape cuts at most five cells from a corner. Any occupied
          // cell in this inset is therefore guaranteed to survive the cut, so
          // the expensive shape/terrain scan cannot make this origin valid.
          const guaranteedInterior = {
            minX: candidateBounds.minX + 5,
            minY: candidateBounds.minY + 5,
            maxX: candidateBounds.maxX - 5,
            maxY: candidateBounds.maxY - 5,
          };
          if (occupiedIn?.(guaranteedInterior)) continue;
          if (growthReservations.some((reservation) => intersects(reservation, guaranteedInterior))) continue;
          const proposedEnvelope = unionRect(city.bounds, expandRect(candidateBounds, 8));
          if (protectedCities.some((bounds) => intersects(bounds, proposedEnvelope))) continue;
          const cells = rectangular
            ? rectangleFootprint(origin, width, height)
            : this.districtShape(origin, width, height, seed);
          if (candidateValid && !candidateValid(origin, cells)) continue;
          if (cells.some((cell) => occupied.has(cellKey(cell)))) continue;
          if (growthReservations.some((reservation) => cells.some((cell) => contains(reservation, cell)))) continue;
          const unsuitable = cells.filter((cell) => !isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain)).length;
          if (unsuitable / cells.length > 0.06) continue;
          const center = { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) };
          const frontageEndpoints = [
            { x: origin.x + 2, y: origin.y + height - 4 },
            { x: origin.x + width - 3, y: origin.y + height - 4 },
          ];
          const roadDistance = preferredRoads.length === 0
            ? 201
            : Math.min(...frontageEndpoints.flatMap((endpoint) => preferredRoads.map((road) => manhattan(endpoint, road))));
          const districtDistance = cityDistrictBounds.length === 0 ? 0 : Math.min(...cityDistrictBounds.map((other) => {
            const dx = Math.max(0, other.minX - candidateBounds.maxX - 1, candidateBounds.minX - other.maxX - 1);
            const dy = Math.max(0, other.minY - candidateBounds.maxY - 1, candidateBounds.minY - other.maxY - 1);
            return dx + dy;
          }));
          const centerDistance = manhattan(center, city.center);
          const candidateDirection = this.outwardDirection(city, center);
          const repeatedDirection = directionUsage.get(candidateDirection) ?? 0;
          // First district grows around the city hub. Later districts hug the
          // existing urban envelope, while still keeping a short connection to
          // a collector/local road. Reusing the same cardinal sector is costly:
          // a third district should form a T/blob, not extend a linear chain.
          const compactness = cityDistricts.length === 0 ? centerDistance * 2.4 : districtDistance * 38 + centerDistance * 0.18;
          const score = compactness + repeatedDirection * 180 + roadDistance * 7 + unsuitable * 30 + extension * 2 + hashCoordinate(seed, x, y, 541);
          candidates.push({ origin, cells, score, repeatedDirection });
        }
      }
      const ranked = candidates.sort((a, b) => a.score - b.score);
      // City bounds can become elongated after a district grows. If every site
      // in the current envelope repeats an already saturated direction, widen
      // the search before asking the expensive full-profile router to try many
      // equivalent sites in one line. Once a least-used sector is represented,
      // put those sites first and keep a small deterministic fallback tail.
      const balanced = ranked.filter((candidate) => candidate.repeatedDirection === leastUsedDirectionCount);
      if (balanced.length > 0 || extension === 96) {
        const candidateLimit = sourceFeatures.some((feature) => feature.kind === "AIRPORT" && feature.accessPath.length > 0) ? 32 : 16;
        const selected = [...balanced, ...ranked]
          .filter((candidate, index, all) => all.findIndex((other) =>
            other.origin.x === candidate.origin.x && other.origin.y === candidate.origin.y) === index)
          .slice(0, candidateLimit);
        if (selected.length > 0) return selected;
      }
    }
    throw new DomainError("PLACEMENT_UNAVAILABLE", "В городе и безопасных секторах расширения не осталось площадки для района");
  }

  private async connectDistrictSite(
    countryId: string,
    seed: number,
    site: { origin: Cell; cells: Cell[] },
    occupied: ReadonlySet<string>,
    existingRoads: Map<string, RoadCellDto>,
    sealedCells: ReadonlySet<string>,
    anchorRoads: RoadCellDto[],
    allowObstacleRouting: boolean,
    snapshot?: GenerationSpatialSnapshot,
  ): Promise<boolean> {
    if (anchorRoads.length === 0) return true;

    const siteBounds = boundsOf(site.cells);
    const gapTo = (road: Cell) =>
      Math.max(0, siteBounds.minX - road.x, road.x - siteBounds.maxX)
      + Math.max(0, siteBounds.minY - road.y, road.y - siteBounds.maxY);
    const rankedAnchors = [...anchorRoads]
      .sort((left, right) => gapTo(left) - gapTo(right) || left.y - right.y || left.x - right.x);
    const profileBlocked = new Set(occupied);
    const existingRoadKeys = new Set(existingRoads.keys());
    const exitCandidates = rankedAnchors.slice(0, 96).flatMap((anchor) =>
      neighbors4(anchor)
        .filter((exit) => !sealedCells.has(cellKey(exit)))
        .filter((exit) => roadCorridorBlockers(
          [anchor, exit], "COLLECTOR", ROAD_WIDTH, profileBlocked, existingRoadKeys,
        ).length === 0)
        .map((exit) => {
          const target = site.cells.reduce((best, cell) => manhattan(cell, exit) < manhattan(best, exit) ? cell : best);
          return { anchor, exit, target, distance: manhattan(exit, target) };
        }),
    ).sort((left, right) => left.distance - right.distance).slice(0, 12);

    const publish = async (stub: Cell[]) => {
      try {
        await this.addRoadPath(countryId, seed, stub, "COLLECTOR", snapshot);
        return true;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
        return false;
      }
    };

    // Prefer a cheap, full-profile square bend. Preflight sealed cells here so
    // an unsuitable territory is rejected without repeatedly rebuilding the
    // same database-backed obstacle sets inside addRoadPath.
    const blocked = new Set([...profileBlocked, ...sealedCells]);
    for (const candidate of exitCandidates) {
      const candidateBlocked = new Set(blocked);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        candidateBlocked.delete(cellKey({ x: candidate.anchor.x + dx, y: candidate.anchor.y + dy }));
      }
      for (const horizontalFirst of [true, false]) {
        const direct = [candidate.anchor, ...orthogonalPath(candidate.exit, candidate.target, horizontalFirst)];
        if (roadCorridorBlockers(direct, "COLLECTOR", ROAD_WIDTH, candidateBlocked, existingRoadKeys).length > 0) continue;
        if (await publish(direct)) return true;
      }
    }
    if (!allowObstacleRouting) return false;

    for (const candidate of exitCandidates.slice(0, 6)) {
      try {
        const tail = await this.route(countryId, seed, candidate.exit, candidate.target, [], [], 1, true, snapshot);
        let finalExistingIndex = -1;
        for (let index = 0; index < tail.length; index += 1) {
          if (existingRoadKeys.has(cellKey(tail[index]!))) finalExistingIndex = index;
        }
        const branch = finalExistingIndex >= 0 ? tail.slice(finalExistingIndex) : [candidate.anchor, ...tail];
        if (await publish(branch)) return true;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
      }
    }
    return false;
  }

  private outwardDirection(city: CityDto, center: Cell): GrowthDirection {
    const dx = center.x - city.center.x;
    const dy = center.y - city.center.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";
    return dy >= 0 ? "S" : "N";
  }

  async createDistrict(countryId: string, input: {
    cityId: string; name: string; goal?: string; description?: string; deadline?: string; capacitySp?: number;
    activate?: boolean; archetype?: DistrictArchetype; idempotencyKey: string;
  }): Promise<DistrictDto> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) throw new DomainError("INVALID_INPUT", "Название района должно содержать от 2 до 100 символов");
    if (this.generationDispatcher) {
      return this.generationDispatcher.execute(countryId, "district.create", input.idempotencyKey, input);
    }
    return await this.mutate(countryId, "district.create.v3", input.idempotencyKey, input, async () => {
                      const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
                      if (!cityRow) throw new DomainError("NOT_FOUND", "Город не найден");
                      const city = cityDto(cityRow);
                      const seed = Number((await this.countryRow(countryId)).seed);
                      const generationSnapshot = await this.loadGenerationSpatialSnapshot(
                        countryId,
                        expandRect(city.bounds, 160),
                      );
                      // The target is planning metadata, not a hard sprint gate: a two-week
                      // solo sprint and a month-long team sprint cannot share one limit.
                      const capacity = Math.max(1, Math.round(input.capacitySp ?? 14));
                      const existingDistricts = generationSnapshot.districts.filter((district) => district.cityId === city.id);
                      const archetype = chooseDistrictArchetype({
                        requested: input.archetype,
                        name,
                        goal: input.goal ?? "",
                        morphology: city.morphology,
                        existing: existingDistricts,
                        variation: hashCoordinate(seed, city.center.x, city.center.y, 533 + existingDistricts.length),
                      });
                      // V11: a district starts as pure territory — no streets, no
                      // lots. The first task grows the first complex (ЖК) inside it,
                      // so roads never appear ahead of demand. SP is advisory planning
                      // metadata, not a request to reserve an empty superblock. Start
                      // with one compact building cluster and let later tasks annex
                      // another patch only when the existing frontage is full.
                      const initialLotTarget = city.morphology === "DENSE_CORE"
                        ? Math.max(12, organicComplexLotTarget(capacity))
                        : organicComplexLotTarget(capacity);
                      const cellsPerPlannedLot = city.morphology === "DENSE_CORE" ? 72 : 84;
                      // V5 new-builds start at 12x10 cells and reach 24x16.
                      // Reserve one dense two-tier parcel up front; keeping the
                      // old cottage-sized 420–900 cell territory forced nearly
                      // every task to annex land and publish a separate road.
                      const area = Math.max(1_500, Math.min(1_800, initialLotTarget * cellsPerPlannedLot));
                      const aspects = [1, 1.6, 0.62, 1.9, 0.53] as const;
                      const aspect = city.morphology === "DENSE_CORE"
                        ? 0.85
                        : aspects[Math.floor(hashCoordinate(seed, city.center.x, city.center.y, 557 + existingDistricts.length) * aspects.length)]!;
                      const width = archetype === "NEW_BUILD"
                        ? 60
                        : archetype === "PRIVATE"
                          ? 48
                        : Math.max(42, Math.min(48, Math.round(Math.sqrt(area * aspect))));
                      const height = archetype === "NEW_BUILD"
                        // The tallest ordinary residential tower has 280px of
                        // opaque screen mass over a 16-cell physical depth. Its
                        // 19-cell northern visual setback produces a 42-cell
                        // minimum complex; keep planner margins around that
                        // real envelope instead of shrinking or clipping it.
                        ? 48
                        : Math.max(35, Math.min(42, Math.round(area / width)));
                      const id = randomUUID();
                      const existingRoads = generationSnapshot.roads;
                      const airportRoads = new Set(generationSnapshot.features
                        .filter((feature) => feature.kind === "AIRPORT" && feature.assetKind === "AREA")
                        .flatMap((feature) => stampRoadCorridor(feature.accessPath, "LOCAL", ROAD_WIDTH)).map(cellKey));
                      const occupied = new Set([
                        ...[...existingRoads.keys()].filter((key) => !airportRoads.has(key)),
                        ...generationSnapshot.tasks.flatMap(taskOccupiedCells).map(cellKey),
                        ...generationSnapshot.features.filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint).map(cellKey),
                      ]);
                      const siteCandidates = await this.selectDistrictSites(
                        countryId,
                        city,
                        seed,
                        width,
                        height,
                        (_origin, cells) => cells.every((cell) => !occupied.has(cellKey(cell))),
                        city.morphology === "DENSE_CORE",
                        generationSnapshot,
                      );
                      let site = siteCandidates[0]!;
                      // A remote site receives its access road together with the
                      // territory: a collector stub runs from the nearest street
                      // to the site edge, so the first complex can anchor later.
                      // Even a site already near the network publishes a short
                      // validated stub. A geometric two-cell gap can otherwise
                      // hide a sealed boundary corner that the first complex is
                      // unable to leave.
                      if (existingDistricts.length > 0) {
                        let connectedSite: typeof site | undefined;
                        const sealedCells = new Set(generationSnapshot.districts
                          .filter((district) => district.status === "COMPLETED").flatMap((district) => district.cells).map(cellKey));
                        const archiveRoads = new Set(generationSnapshot.features
                          .filter((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA")
                          .flatMap((feature) => stampRoadCorridor(feature.accessPath, "LOCAL", ROAD_WIDTH)).map(cellKey));
                        const safeAnchorRoads = [...existingRoads.values()].filter((road) =>
                          road.roadClass !== "HIGHWAY" && !archiveRoads.has(cellKey(road))
                          && (!sealedCells.has(cellKey(road)) || neighbors4(road).some((cell) => !sealedCells.has(cellKey(cell)))));
                        const publicAnchorRoads = safeAnchorRoads.filter((road) => !airportRoads.has(cellKey(road)));
                        // Try every compact candidate with straight square
                        // bends first. Airport drives are not normal frontage,
                        // but in a saturated one-city plan they remain a valid
                        // last-resort network branch; archive security roads
                        // are never eligible.
                        for (const anchorRoads of [publicAnchorRoads, safeAnchorRoads]) {
                          if (anchorRoads.length === 0) continue;
                          for (const allowObstacleRouting of [false, true]) {
                            for (const candidate of siteCandidates) {
                              if (await this.connectDistrictSite(
                                countryId, seed, candidate, occupied, existingRoads, sealedCells, anchorRoads,
                                allowObstacleRouting,
                                generationSnapshot,
                              )) {
                                connectedSite = candidate;
                                break;
                              }
                            }
                            if (connectedSite) break;
                          }
                          if (connectedSite) break;
                        }
                        if (!connectedSite) throw new DomainError("ROUTE_BLOCKED", `Не удалось проложить полноширинный подъезд к району ${existingDistricts.length + 1}`);
                        site = connectedSite;
                      }
                      const expandedCity = unionRect(city.bounds, expandRect(boundsOf(site.cells), 8));
                      if (JSON.stringify(expandedCity) !== JSON.stringify(city.bounds)) {
                        await this.db.prepare("UPDATE cities_v3 SET bounds_json = ? WHERE id = ?").run(JSON.stringify(expandedCity), city.id);
                      }
                      await this.normalizeUrbanHighways(countryId, expandedCity);
                      const center = { x: site.origin.x + Math.floor(width / 2), y: site.origin.y + Math.floor(height / 2) };
                      const status: DistrictStatus = input.activate ? "ACTIVE" : "PLANNED";
                      if (status === "ACTIVE" && await this.db.prepare("SELECT 1 FROM districts_v3 WHERE city_id = ? AND status = 'ACTIVE'").get(city.id)) {
                        throw new DomainError("CONFLICT", "У города уже есть активный район");
                      }
                      const createdAt = now();
                      const count = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM districts_v3 WHERE city_id = ?").get(city.id) as Row).count);
                      const color = SPRINT_COLORS[count % SPRINT_COLORS.length]!;
                      const growthDirection = this.outwardDirection(city, center);
                      await this.db.prepare("INSERT INTO districts_v3 (id, city_id, name, goal, description, deadline, status, capacity_sp, cells_json, lots_json, growth_direction, archetype, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                                                        .run(id, city.id, name, input.goal?.trim().slice(0, 4000) ?? "", input.description?.trim().slice(0, 8000) ?? "", input.deadline ?? null, status, capacity, JSON.stringify(site.cells), "[]", growthDirection, archetype, color, createdAt);
                      const data: DistrictDto = {
                        id, cityId: city.id, name, goal: input.goal?.trim() ?? "", description: input.description?.trim() ?? "",
                        deadline: input.deadline ?? null, status, capacitySp: capacity, cells: site.cells, lots: [], growthDirection, archetype, color, createdAt,
                      };
                      return { data, eventType: "district.created", eventPayload: { districtId: id, cityId: city.id, affectedBounds: boundsOf(site.cells) } };
                    });
  }

  async renameDistrict(countryId: string, input: { districtId: string; name: string; idempotencyKey: string }): Promise<DistrictDto> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) throw new DomainError("INVALID_INPUT", "Название района должно содержать от 2 до 100 символов");
    return await this.mutate(countryId, "district.rename.v1", input.idempotencyKey, input, async () => {
                      const row = await this.db.prepare(`SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id
                        WHERE d.id = ? AND c.country_id = ?`).get(input.districtId, countryId) as Row | undefined;
                      if (!row) throw new DomainError("NOT_FOUND", "Район не найден");
                      await this.db.prepare("UPDATE districts_v3 SET name = ? WHERE id = ?").run(name, input.districtId);
                      const data = districtDto({ ...row, name });
                      return { data, eventType: "district.renamed", eventPayload: { districtId: input.districtId, cityId: data.cityId, name, affectedBounds: boundsOf(data.cells) } };
                    });
  }

  async updateDistrict(countryId: string, input: {
    districtId: string; name?: string; goal?: string; description?: string; deadline?: string | null;
    capacitySp?: number; idempotencyKey: string;
  }): Promise<DistrictDto> {
    return this.mutate(countryId, "district.update.v18", input.idempotencyKey, input, async () => {
      const row = await this.db.prepare(`SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id
        WHERE d.id = ? AND c.country_id = ?`).get(input.districtId, countryId) as Row | undefined;
      if (!row) throw new DomainError("NOT_FOUND", "Район не найден");
      const current = districtDto(row);
      const name = input.name === undefined ? current.name : input.name.trim();
      if (name.length < 2 || name.length > 100) throw new DomainError("INVALID_INPUT", "Название района должно содержать от 2 до 100 символов");
      const capacitySp = input.capacitySp === undefined ? current.capacitySp : Math.max(1, Math.round(input.capacitySp));
      await this.db.prepare(`UPDATE districts_v3 SET name = ?, goal = ?, description = ?, deadline = ?, capacity_sp = ? WHERE id = ?`).run(
        name, input.goal === undefined ? current.goal : input.goal.trim().slice(0, 4000),
        input.description === undefined ? current.description : input.description.trim().slice(0, 8000),
        input.deadline === undefined ? current.deadline : input.deadline, capacitySp, input.districtId,
      );
      const updated = await this.db.prepare("SELECT * FROM districts_v3 WHERE id = ?").get(input.districtId) as Row;
      const data = districtDto(updated);
      return { data, eventType: "district.updated", eventPayload: { districtId: data.id, cityId: data.cityId, affectedBounds: boundsOf(data.cells) } };
    });
  }

  async deleteDistrict(countryId: string, input: { districtId: string; confirmName: string; idempotencyKey: string }): Promise<{ deleted: true; districtId: string; cityId: string; name: string; tasksDeleted: number; activatedDistrictId: string | null }> {
    return await this.mutate(countryId, "district.delete.v1", input.idempotencyKey, input, async () => {
                      const row = await this.db.prepare(`SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id
                        WHERE d.id = ? AND c.country_id = ?`).get(input.districtId, countryId) as Row | undefined;
                      if (!row) throw new DomainError("NOT_FOUND", "Район не найден");
                      const district = districtDto(row);
                      if (input.confirmName.trim() !== district.name) throw new DomainError("CONFIRMATION_MISMATCH", "Для удаления укажите точное текущее название района");
                      const tasksDeleted = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE district_id = ?").get(district.id) as Row).count);
                      const affectedBounds = boundsOf(district.cells);
                      // Abandonment keeps the urban fabric: streets and parks stay
                      // on the map, every building becomes a ruin plot, and the
                      // territory returns to free land that future districts can
                      // grow over.
                      const districtTasks = (await this.db.prepare("SELECT * FROM tasks_v3 WHERE district_id = ?").all(district.id) as Row[]).map(taskDto);
                      for (const task of districtTasks) {
                        await this.insertWorldFeature(countryId, {
                                                          cityId: task.cityId, districtId: task.districtId, parentFeatureId: null,
                                                          kind: "RUIN", assetKind: "AREA", assetKey: "demolished-lot",
                                                          origin: task.origin, footprint: task.footprint, orientation: "S", accessPath: [],
                                                        });
                      }
                      await this.db.prepare("DELETE FROM tasks_v3 WHERE district_id = ?").run(district.id);
                      await this.db.prepare("UPDATE districts_v3 SET status = 'ABANDONED', cells_json = '[]', lots_json = '[]' WHERE id = ?").run(district.id);
                      let activatedDistrictId: string | null = null;
                      let eventBounds = affectedBounds;
                      if (district.status === "ACTIVE") {
                        const next = await this.db.prepare("SELECT * FROM districts_v3 WHERE city_id = ? AND status = 'PLANNED' ORDER BY created_at LIMIT 1").get(district.cityId) as Row | undefined;
                        if (next) {
                          activatedDistrictId = String(next.id);
                          await this.db.prepare("UPDATE districts_v3 SET status = 'ACTIVE' WHERE id = ?").run(activatedDistrictId);
                          eventBounds = unionRect(eventBounds, boundsOf(districtDto(next).cells));
                        }
                      }
                      this.surfaceCache.delete(countryId);
                      const data = { deleted: true as const, districtId: district.id, cityId: district.cityId, name: district.name, tasksDeleted, activatedDistrictId };
                      return { data, eventType: "district.deleted", eventPayload: { ...data, affectedBounds: eventBounds } };
                    });
  }

  async activateDistrict(countryId: string, districtId: string, idempotencyKey: string): Promise<DistrictDto> {
    return await this.mutate(countryId, "district.activate.v3", idempotencyKey, { districtId }, async () => {
                      const row = await this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE d.id = ? AND c.country_id = ?").get(districtId, countryId) as Row | undefined;
                      if (!row) throw new DomainError("NOT_FOUND", "Район не найден");
                      if (row.status === "COMPLETED") throw new DomainError("DISTRICT_SEALED", "Завершённый район нельзя снова активировать");
                      if (row.status === "ABANDONED") throw new DomainError("DISTRICT_ABANDONED", "Заброшенный район нельзя активировать");
                      const previousActive = await this.db.prepare("SELECT * FROM districts_v3 WHERE city_id = ? AND status = 'ACTIVE' LIMIT 1")
                        .get(String(row.city_id)) as Row | undefined;
                      await this.db.prepare("UPDATE districts_v3 SET status = 'PLANNED' WHERE city_id = ? AND status = 'ACTIVE'").run(String(row.city_id));
                      await this.db.prepare("UPDATE districts_v3 SET status = 'ACTIVE' WHERE id = ?").run(districtId);
                      const data = districtDto({ ...row, status: "ACTIVE" });
                      const affectedBounds = previousActive && String(previousActive.id) !== districtId
                        ? unionRect(boundsOf(data.cells), boundsOf(districtDto(previousActive).cells))
                        : boundsOf(data.cells);
                      return { data, eventType: "district.activated", eventPayload: { districtId, cityId: data.cityId, affectedBounds } };
                    });
  }

  async completeDistrict(countryId: string, districtId: string, idempotencyKey: string): Promise<DistrictDto> {
    return await this.mutate(countryId, "district.complete.v3", idempotencyKey, { districtId }, async () => {
                      const row = await this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE d.id = ? AND c.country_id = ?").get(districtId, countryId) as Row | undefined;
                      if (!row) throw new DomainError("NOT_FOUND", "Район не найден");
                      if (row.status === "ABANDONED") throw new DomainError("DISTRICT_ABANDONED", "Заброшенный район нельзя завершить");
                      const unfinished = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE district_id = ? AND status <> 'COMPLETED'").get(districtId) as Row).count);
                      if (unfinished > 0) throw new DomainError("DISTRICT_HAS_OPEN_TASKS", `В районе осталось незавершённых задач: ${unfinished}`);
                      await this.db.prepare("UPDATE districts_v3 SET status = 'COMPLETED' WHERE id = ?").run(districtId);
                      this.surfaceCache.delete(countryId);
                      const data = districtDto({ ...row, status: "COMPLETED" });
                      return { data, eventType: "district.completed", eventPayload: { districtId, cityId: data.cityId, affectedBounds: boundsOf(data.cells) } };
                    });
  }

  private async districtHasCollector(districtId: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT cells_json, city_id FROM districts_v3 WHERE id = ?").get(districtId) as Row | undefined;
    if (!row) return false;
    const cells = json<Cell[]>(row.cells_json);
    if (cells.length === 0) return false;
    const bounds = expandRect(boundsOf(cells), 3);
    return Boolean(await this.db.prepare(`SELECT 1 FROM roads_v3 r JOIN cities_v3 c ON c.country_id = r.country_id
      WHERE c.id = ? AND r.x BETWEEN ? AND ? AND r.y BETWEEN ? AND ?
      AND r.road_class IN ('COLLECTOR', 'ARTERIAL', 'HIGHWAY') LIMIT 1`)
                                      .get(String(row.city_id), bounds.minX, bounds.maxX, bounds.minY, bounds.maxY));
  }

  private async buildingRulesAllow(
    entry: BuildingCatalogEntry,
    cityId: string,
    districtId: string,
    allowMissingCollector = false,
  ): Promise<boolean> {
    for (const ruleId of entry.ruleIds) {
      switch (ruleId) {
        case "STANDARD": break;
        case "REQUIRES_COLLECTOR":
          if (!allowMissingCollector && !await this.districtHasCollector(districtId)) return false;
          break;
        case "UNIQUE_SERVICE": {
          if (!entry.serviceRole) break;
          const roleExists = (await this.listTasksForCity(cityId)).some((task) => {
                                const selected = BUILDING_CATALOG.find((candidate) => candidate.key === task.buildingType);
                                return selected?.serviceRole === entry.serviceRole;
                              });
          if (roleExists) return false;
          break;
        }
        default: {
          const unsupported: never = ruleId;
          return unsupported;
        }
      }
    }
    return true;
  }

  private async entryAllowed(
    entry: BuildingCatalogEntry,
    cityId: string,
    districtId: string,
    allowMissingCollector = false,
  ): Promise<boolean> {
    if (!await this.buildingRulesAllow(entry, cityId, districtId, allowMissingCollector)) return false;
    if (entry.tags.includes("landmark")) {
      const cityLandmark = await this.db.prepare(
        "SELECT 1 FROM tasks_v3 WHERE city_id = ? AND building_type LIKE 'landmark-%' LIMIT 1",
      ).get(cityId);
      if (cityLandmark) return false;
    }
    const cityCount = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE city_id = ? AND building_type = ?").get(cityId, entry.key) as Row).count);
    const districtCount = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE district_id = ? AND building_type = ?").get(districtId, entry.key) as Row).count);
    return (!entry.maxPerCity || cityCount < entry.maxPerCity) && (!entry.maxPerDistrict || districtCount < entry.maxPerDistrict);
  }

  private async listTasksForCity(cityId: string): Promise<TaskDto[]> {
    return (await this.db.prepare("SELECT * FROM tasks_v3 WHERE city_id = ?").all(cityId) as Row[]).map(taskDto);
  }

  private async requiredServiceRole(cityId: string, districtId: string): Promise<string | undefined> {
    const tasks = await this.listTasksForCity(cityId);
    const present = new Set(tasks.map((task) => BUILDING_CATALOG.find((entry) => entry.key === task.buildingType)?.serviceRole).filter(Boolean));
    const district = (await this.listDistricts(String((await this.db.prepare("SELECT country_id FROM cities_v3 WHERE id = ?").get(cityId) as Row).country_id), cityId))
              .find((candidate) => candidate.id === districtId);
    const schedule: Array<{ role: string; threshold: number }> = [
      { role: "health-service", threshold: 10 },
      { role: "fire-service", threshold: 20 },
      { role: "police-service", threshold: 30 },
    ];
    for (const item of schedule) {
      if (present.has(item.role)) continue;
      if (!TASK_BUILDING_CATALOG.some((entry) => entry.serviceRole === item.role)) continue;
      const due = district?.archetype === "CIVIC" || tasks.length + 1 >= item.threshold;
      if (!due) continue;
      // City services arrive on schedule regardless of the task's estimate:
      // a stream of small 1-SP chores still deserves a fire station by twenty.
      for (const entry of TASK_BUILDING_CATALOG) {
        if (entry.serviceRole === item.role && await this.entryAllowed(entry, cityId, districtId)) return item.role;
      }
    }
    return undefined;
  }

  /**
   * Ranked building candidates for a task, best first. The caller walks the
   * list until one candidate actually fits the ground: a top-ranked tower that
   * has no lot wide enough must never deadlock growth when the next-ranked
   * house would fit.
   */
  private async selectBuilding(cityId: string, districtId: string, estimate: Estimate, title: string, description: string, hint?: string): Promise<BuildingCatalogEntry[]> {
    const district = (await this.db.prepare("SELECT * FROM districts_v3 WHERE id = ? AND city_id = ?").get(districtId, cityId) as Row | undefined);
    if (!district) throw new DomainError("NOT_FOUND", "Район не найден");
    const archetype = districtDto(district).archetype;
    const tags = new Set(inferTaskTags(title, description));
    if (hint) {
      const exact = TASK_BUILDING_CATALOG.find((entry) => entry.key === hint);
      if (!exact) throw new DomainError("INVALID_BUILDING_HINT", "Указанный тип здания не существует");
      if (exact.tags.includes("archive")) throw new DomainError("INVALID_BUILDING_HINT", "Корпуса Государственного архива не являются зданиями задач");
      if (!taskBuildingCompatibleWithArchetype(exact, archetype)) {
        throw new DomainError("INCOMPATIBLE_BUILDING", "Здание несовместимо с архитектурой выбранного района");
      }
      const bootstrapCollector = exact.serviceRole === "parking-service" && (tags.has("parking") || hint === "commercial-parking-lot");
      if (!await this.entryAllowed(exact, cityId, districtId, bootstrapCollector)) throw new DomainError("BUILDING_QUOTA_REACHED", "Лимит этого типа здания уже достигнут");
      return [exact];
    }
    const requiredService = await this.requiredServiceRole(cityId, districtId);
    const cityRows = await this.db.prepare("SELECT building_type FROM tasks_v3 WHERE city_id = ?").all(cityId) as Row[];
    const districtRows = await this.db.prepare("SELECT id, building_type FROM tasks_v3 WHERE district_id = ?").all(districtId) as Row[];
    const cityCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    const districtCounts = new Map<string, number>();
    for (const row of cityRows) {
      const key = String(row.building_type);
      cityCounts.set(key, (cityCounts.get(key) ?? 0) + 1);
      const entry = BUILDING_CATALOG.find((item) => item.key === key);
      if (entry) categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);
    }
    const buildingByTaskId = new Map<string, string>();
    for (const row of districtRows) {
      const key = String(row.building_type);
      districtCounts.set(key, (districtCounts.get(key) ?? 0) + 1);
      buildingByTaskId.set(String(row.id), key);
    }
    // Complex-level variety: repeating the same model inside one complex (ЖК)
    // is penalised more than repeating it somewhere else in the district, so a
    // single residential group reads as a family of related but different
    // buildings instead of cloned rows.
    const complexCounts = new Map<string, Map<string, number>>();
    for (const lot of districtDto(district).lots) {
      if (!lot.taskId || !lot.groupId) continue;
      const key = buildingByTaskId.get(lot.taskId);
      if (!key) continue;
      const group = complexCounts.get(lot.groupId) ?? new Map<string, number>();
      group.set(key, (group.get(key) ?? 0) + 1);
      complexCounts.set(lot.groupId, group);
    }
    const complexRepeat = (key: string) => Math.max(0, ...[...complexCounts.values()].map((group) => group.get(key) ?? 0));
    // The estimate no longer gates the catalog: any archetype-compatible
    // building may host a task of any size. Estimate stays as planning
    // metadata with only a soft nudge in the score below.
    const compatible: BuildingCatalogEntry[] = [];
    for (const entry of TASK_BUILDING_CATALOG) {
      const bootstrapCollector = entry.serviceRole === "parking-service" && tags.has("parking");
      if (!entry.tags.includes("archive") && await this.entryAllowed(entry, cityId, districtId, bootstrapCollector)
        && taskBuildingCompatibleWithArchetype(entry, archetype)
        && (!requiredService || entry.serviceRole === requiredService)) compatible.push(entry);
    }
    if (compatible.length === 0) throw new DomainError("NO_BUILDING_VARIANT", "В каталоге нет здания, совместимого с архитектурой района");
    const existingSupport = districtRows.filter((row) => {
      const entry = BUILDING_CATALOG.find((item) => item.key === String(row.building_type));
      return entry ? !primaryZoningRole(archetype, buildingZoningRole(entry)) : false;
    }).length;
    // New-build districts must read as one coherent residential complex even
    // after the automatic city-service schedule adds a clinic/fire/police task.
    // Two optional support plots + one required service keeps at least seven
    // of every ten tasks in the dense-residential family.
    const supportLimit = archetype === "MIXED_URBAN"
      ? Number.POSITIVE_INFINITY
      : archetype === "CIVIC" || archetype === "NEW_BUILD" ? 2 : 3;
    const wantsSupport = tags.has("commercial") || tags.has("civic") || Boolean(requiredService);
    const primaryCandidates = compatible.filter((entry) => primaryZoningRole(archetype, buildingZoningRole(entry)));
    const compactNewBuildCandidates = archetype === "NEW_BUILD"
      ? primaryCandidates.filter(isCompactNewBuildBuilding)
      : [];
    const explicitlyLargePrivateHome = archetype === "PRIVATE"
      && /(усад|вилл|особняк|помест|large home|estate|villa|mansion)/i.test(`${title} ${description}`);
    const compactPrivateCandidates = archetype === "PRIVATE" && !explicitlyLargePrivateHome
      ? primaryCandidates.filter((entry) => entry.footprint.width <= 9 && entry.footprint.height <= 6)
      : [];
    const supportCandidates = compatible.filter((entry) => !primaryZoningRole(archetype, buildingZoningRole(entry)));
    const requestedParking = tags.has("parking")
      ? compatible.filter((entry) => entry.serviceRole === "parking-service")
      : [];
    const candidates = requiredService
      ? compatible
      : requestedParking.length > 0 ? requestedParking
        : wantsSupport && existingSupport < supportLimit && supportCandidates.length > 0
        ? supportCandidates
        : compactPrivateCandidates.length > 0 ? compactPrivateCandidates
          : compactNewBuildCandidates.length > 0 ? compactNewBuildCandidates
          : primaryCandidates.length > 0 ? primaryCandidates : compatible;
    const countryId = String((await this.db.prepare("SELECT country_id FROM cities_v3 WHERE id = ?").get(cityId) as Row).country_id);
    const seed = Number((await this.countryRow(countryId)).seed);
    const taskOrdinal = cityRows.length + 1;
    return candidates.map((entry) => {
      const semanticBonus = entry.tags.filter((tag) => tags.has(tag)).length * 8;
      const morphologyBonus = archetypeAffinity(entry, archetype);
      const rarityPenalty = entry.rarity === "UNIQUE" ? 4 : entry.rarity === "RARE" ? 2 : 0;
      const explicitlyRequestedService = entry.serviceRole === "parking-service" && tags.has("parking");
      const unrelatedServicePenalty = entry.serviceRole && !requiredService && !tags.has("civic") && !explicitlyRequestedService ? 18 : 0;
      // Estimate is a soft nudge only (the gate above is gone): matching
      // sizes are mildly preferred, everything stays possible.
      const estimatePenalty = entry.estimates.includes(estimate) ? 0 : 3;
      // The V5 catalog contains statement towers as well as compact 12x10
      // apartment blocks. Unhinted work starts in the compact family so four
      // tasks can share a two-tier complex; larger footprints remain available
      // through semantic ranking and explicit hints instead of forcing one
      // road cluster per task.
      const footprintArea = entry.footprint.width * entry.footprint.height;
      const footprintPenalty = Math.max(0, footprintArea - 120) / 18;
      // Regeneration replays the same task stream under a new country seed.
      // Seeding the tie-break with that seed makes the replay genuinely
      // re-pick buildings instead of reproducing the old set in new spots.
      const seededJitter = hashCoordinate(seed, taskOrdinal, Math.floor(stringHash(entry.key) * 10_000), 887) * 5;
      const score = (cityCounts.get(entry.key) ?? 0) * 7 + (districtCounts.get(entry.key) ?? 0) * 9
        + complexRepeat(entry.key) * 12
        + (categoryCounts.get(entry.category) ?? 0) * 1.2 + rarityPenalty + unrelatedServicePenalty + estimatePenalty + footprintPenalty + seededJitter - semanticBonus - morphologyBonus
        + stringHash(`${title}:${entry.key}`) * 2;
      return { entry, score };
    }).sort((a, b) => a.score - b.score).map((ranked) => ranked.entry);
  }

  private async placementInLot(
    countryId: string,
    lot: PlannedLotDto,
    entry: BuildingCatalogEntry,
    roads: Map<string, RoadCellDto>,
    surfaces: Map<string, SurfaceCellDto>,
    occupied: Set<string>,
    districtCells?: Set<string>,
    reserveVisualSetback = true,
  ): Promise<{ origin: Cell; footprint: Cell[]; entrance: Cell; accessPath: Cell[]; accessKind: TaskDto["accessKind"] } | null> {
    const northSetback = reserveVisualSetback ? buildingVisualSetbackCells(entry) : 0;
    const requiredDepth = entry.footprint.height + northSetback;
    if (lot.taskId || entry.footprint.width > lot.width || requiredDepth > lot.height) return null;
    const seed = Number((await this.countryRow(countryId)).seed);
    // The courtyard skeleton of a block-v3 lot is published lazily (only with a
    // committed building). Project it into a local surface copy so the access
    // planner can already walk along the future path.
    const projected = new Map(surfaces);
    for (const cell of lot.sharedAccess ?? []) {
      const key = cellKey(cell);
      if (!roads.has(key) && !projected.has(key)) projected.set(key, { ...cell, kind: "PATH" });
    }
    // Access is a public path through the district, not a private path trapped
    // inside the lot rectangle. Restricting the search to the lot made a valid
    // entrance unable to walk around the platform and caused artificial growth.
    const lotCells = districtCells ?? new Set(rectangleFootprint(
      { x: lot.origin.x - 6, y: lot.origin.y - 6 }, lot.width + 12, lot.height + 12,
    ).map(cellKey));
    const candidates: Array<{ origin: Cell; footprint: Cell[]; entrance: Cell; accessPath: Cell[]; score: number }> = [];
    for (let offsetY = 0; offsetY <= lot.height - entry.footprint.height; offsetY += 1) {
      for (let offsetX = 0; offsetX <= lot.width - entry.footprint.width; offsetX += 1) {
        const origin = { x: lot.origin.x + offsetX, y: lot.origin.y + offsetY };
        if (offsetY < northSetback) continue;
        const footprint = rectangleFootprint(origin, entry.footprint.width, entry.footprint.height);
        const visualReservation = reserveVisualSetback
          ? buildingVisualReservationCells(entry, origin)
          : footprint;
        const footprintKeys = new Set(footprint.map(cellKey));
        if (visualReservation.some((cell) => occupied.has(cellKey(cell))
          || roads.has(cellKey(cell)) || projected.has(cellKey(cell)))) continue;
        const access = findAccessPlan({
          entry,
          origin,
          lotCells,
          buildingFootprint: footprintKeys,
          occupied,
          roads,
          surfaces: projected,
          isWalkableTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
          maxLength: 6,
        });
        if (!access) continue;
        // Every facade faces its street (south): prefer the building flush to
        // the sidewalk at the bottom edge of the lot. Horizontally it shares a
        // party wall with a built neighbour when possible — no stray one-cell
        // gaps between houses — and otherwise hugs the lot's left edge so a
        // free-standing row still reads as one continuous facade line.
        const bottomGap = lot.origin.y + lot.height - (origin.y + entry.footprint.height);
        const touchesWest = footprint.some((cell) => occupied.has(cellKey({ x: origin.x - 1, y: cell.y })));
        const touchesEast = footprint.some((cell) => occupied.has(cellKey({ x: origin.x + entry.footprint.width, y: cell.y })));
        const partyBonus = (touchesWest ? -25 : 0) + (touchesEast ? -25 : 0);
        candidates.push({
          origin, footprint, entrance: access.entrance, accessPath: access.path,
          score: buildingLotPlacementScore({ entry, lot, origin, accessDistance: access.distance, bottomGap, partyBonus }),
        });
      }
    }
    const selected = candidates.sort((left, right) => left.score - right.score || left.origin.y - right.origin.y || left.origin.x - right.origin.x)[0];
    const accessKind: TaskDto["accessKind"] = entry.platform === "ASPHALT"
      || entry.tags.some((tag) => ["fire-service", "police-service", "health-service"].includes(tag))
      ? "DRIVEWAY"
      : "PATH";
    return selected ? { origin: selected.origin, footprint: selected.footprint, entrance: selected.entrance, accessPath: selected.accessPath, accessKind } : null;
  }

  private lotRoleForEntry(archetype: DistrictArchetype, entry: BuildingCatalogEntry): PlannedLotRole {
    if (entry.tags.includes("new-build")) return "PRIMARY";
    return primaryZoningRole(archetype, buildingZoningRole(entry)) ? "PRIMARY" : "SUPPORT";
  }

  private async taskPlacementOptions(
    countryId: string,
    district: DistrictDto,
    entry: BuildingCatalogEntry,
    roads: Map<string, RoadCellDto>,
    surfaces: Map<string, SurfaceCellDto>,
    occupied: Set<string>,
    districtCells: Set<string>,
    reserveVisualSetback = true,
  ): Promise<Array<{
                                lot: PlannedLotDto;
                                lots: PlannedLotDto[];
                                placement: NonNullable<Awaited<ReturnType<AppService["placementInLot"]>>>;
                                order: number;
                              }>> {
    const expectedRole = this.lotRoleForEntry(district.archetype, entry);
    const occupiedPerGroup = new Map<string, number>();
    for (const lot of district.lots) if (lot.taskId && lot.groupId) occupiedPerGroup.set(lot.groupId, (occupiedPerGroup.get(lot.groupId) ?? 0) + 1);
    const requiredDepth = entry.footprint.height + (reserveVisualSetback ? buildingVisualSetbackCells(entry) : 0);
    const fitting = district.lots.filter((lot) => !lot.taskId && entry.footprint.width <= lot.width && requiredDepth <= lot.height);
    const roleCandidates = fitting.filter((lot) => lot.role === expectedRole);
    // Residential identity is a hard boundary for housing: a residential task
    // never consumes the few service slots of a strict district. A service
    // building, in turn, falls back to a regular lot when every service slot
    // is taken or unusable — zoning guides placement, it never deadlocks growth.
    const strictRoles = (district.archetype === "NEW_BUILD" || district.archetype === "PRIVATE") && expectedRole === "PRIMARY";
    const pool = strictRoles ? roleCandidates : [...roleCandidates, ...fitting.filter((lot) => lot.role !== expectedRole)];
    const candidates = pool
      .sort((left, right) => {
        const role = Number(right.role === expectedRole) - Number(left.role === expectedRole);
        if (role !== 0) return role;
        // Redevelopment first: a vacant plot left by a demolition is filled
        // before virgin land is consumed.
        const vacant = Number(right.vacant ?? false) - Number(left.vacant ?? false);
        if (vacant !== 0) return vacant;
        const groupFill = (occupiedPerGroup.get(right.groupId ?? "") ?? 0) - (occupiedPerGroup.get(left.groupId ?? "") ?? 0);
        if (groupFill !== 0) return groupFill;
        const group = String(left.groupId).localeCompare(String(right.groupId));
        if (group !== 0) return group;
        return (left.slotIndex ?? 0) - (right.slotIndex ?? 0);
      });
    const options: Awaited<ReturnType<AppService["taskPlacementOptions"]>> = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const placement = await this.placementInLot(countryId, candidates[index]!, entry, roads, surfaces, occupied, districtCells, reserveVisualSetback);
      if (placement) options.push({ lot: candidates[index]!, lots: district.lots, placement, order: index });
    }
    return options;
  }

  async createTask(countryId: string, input: {
    cityId: string;
    districtId?: string;
    title: string;
    description?: string;
    workItemType?: WorkItemType;
    acceptanceCriteria?: string;
    systemAnalysis?: string;
    architecture?: string;
    designSystem?: string;
    implementationPlan?: string;
    estimate: Estimate;
    priority?: TaskPriority;
    dueAt?: string;
    buildingHint?: string;
    visualKind?: TaskDto["visualKind"];
    parkVariant?: string;
    creatorUserId?: string;
    assigneeUserId?: string;
    assigneeRole?: string;
    forUserId?: string;
    idempotencyKey: string;
  }): Promise<TaskDto> {
    const title = input.title.trim();
    if (title.length < 2 || title.length > 160) throw new DomainError("INVALID_INPUT", "Название задачи должно содержать от 2 до 160 символов");
    if (this.generationDispatcher) {
      return this.generationDispatcher.execute(countryId, "task.create", input.idempotencyKey, input);
    }
    return await this.mutate(countryId, "task.create.v3", input.idempotencyKey, input, async () => {
                      const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
                      if (!cityRow) throw new DomainError("NOT_FOUND", "Город не найден");
                      for (const [field, userId] of [["создатель", input.creatorUserId], ["ответственный", input.assigneeUserId], ["заказчик", input.forUserId]] as const) {
                        if (userId && !await this.db.prepare("SELECT 1 FROM country_members WHERE country_id = ? AND user_id = ?").get(countryId, userId)) {
                          throw new DomainError("ASSIGNEE_NOT_MEMBER", `${field} должен состоять в правительстве страны`);
                        }
                      }
                      if (input.assigneeRole?.trim() && input.assigneeRole.length > 80) throw new DomainError("INVALID_INPUT", "Роль ответственного не длиннее 80 символов");
                      const districtRow = input.districtId
                        ? await this.db.prepare("SELECT * FROM districts_v3 WHERE id = ? AND city_id = ?").get(input.districtId, input.cityId)
                        : await this.db.prepare("SELECT * FROM districts_v3 WHERE city_id = ? AND status = 'ACTIVE'").get(input.cityId);
                      if (!districtRow) throw new DomainError("NO_ACTIVE_DISTRICT", "Сначала создайте или активируйте район");
                      let district = districtDto(districtRow as Row);
                      if (district.status === "COMPLETED") throw new DomainError("DISTRICT_SEALED", "В завершённый район нельзя добавлять задачи");
                      // One bounded command snapshot replaces the former chain
                      // of whole-country list/JSON reads inside candidate,
                      // growth, routing and green-area planning.
                      const generationSnapshot = await this.loadGenerationSpatialSnapshot(
                        countryId,
                        expandRect(cityDto(cityRow).bounds, 160),
                      );
                      const inferredTags = new Set(inferTaskTags(title, input.description ?? ""));
                      // A clearly park-shaped task must not silently turn into
                      // another facade when an agent omits the optional visual
                      // field. Explicit visualKind remains authoritative.
                      const visualKind = input.visualKind
                        ?? (input.buildingHint?.startsWith("park:")
                          || inferredTags.has("park") && !inferredTags.has("parking") ? "PARK" : "BUILDING");
                      const requestedParkVariant = input.parkVariant ?? input.buildingHint?.replace(/^park:/, "");
                      const parkVariants = new Set(["urban-formal", "urban-community", "urban-central", "urban-botanical", "urban-amusement", "urban-park"]);
                      const visualAssetKey = visualKind === "PARK" ? (requestedParkVariant || "urban-formal") : undefined;
                      if (visualKind === "PARK" && !parkVariants.has(visualAssetKey!)) {
                        throw new DomainError("INVALID_INPUT", "Неизвестный вариант парка");
                      }
                      const parkProfile: Readonly<Record<string, string>> = {
                        "urban-formal": "house-cohousing-cluster",
                        "urban-community": "house-courtyard-apartments",
                        "urban-central": "house-small-apartments",
                        "urban-botanical": "house-small-apartments",
                        "urban-amusement": "house-small-apartments",
                        "urban-park": "house-small-apartments",
                      };
                      const ranked = await this.selectBuilding(
                        input.cityId,
                        district.id,
                        input.estimate,
                        title,
                        input.description ?? "",
                        visualKind === "PARK" ? parkProfile[visualAssetKey!] : input.buildingHint,
                      );
                      let roads = generationSnapshot.roads;
                      // Neighbouring buildings are planned against permanent
                      // structure footprints, not temporary construction-site
                      // fences. The renderer may merge/overlap adjacent one-cell
                      // site envelopes while both tasks are under construction;
                      // treating that envelope as a permanent building setback
                      // made dense blocks lose roughly a quarter of their lots.
                      // Roads and world features still use taskOccupiedCells(),
                      // so they cannot cut through an active construction site.
                      const occupiedTasks = new Set(generationSnapshot.tasks.flatMap(taskOccupiedCells).map(cellKey));
                      // Walk the ranked candidates until one actually fits the
                      // ground. The favourite may be a tower with no lot wide
                      // enough; the next house down the list keeps growth alive
                      // instead of deadlocking the district.
                      const preferredCandidates = ranked.slice(0, 8);
                      // A varied large-building catalog must not deadlock a
                      // nearly full block. Keep a few compact fallbacks after
                      // the semantic favourites instead of scanning the full catalog
                      // entries (and repeatedly growing the district).
                      const compactFallbacks = ranked
                        .filter((candidate) => candidate.footprint.width <= 14
                          && buildingLotDepthCells(candidate) <= 12
                          && !preferredCandidates.includes(candidate))
                        .sort((left, right) =>
                          left.footprint.width * buildingLotDepthCells(left) - right.footprint.width * buildingLotDepthCells(right)
                          || left.footprint.width - right.footprint.width
                          || left.key.localeCompare(right.key))
                        .slice(0, 8);
                      const candidatePool = [...preferredCandidates, ...compactFallbacks];
                      const selectFromExistingLots = async () => {
                        const placementBounds = districtAvailableLotBounds(district);
                        if (!placementBounds) return undefined;
                        const surfaces = await this.localSurfaceCells(countryId, placementBounds, roads, [district], generationSnapshot);
                        const districtCellKeys = new Set(district.cells.map(cellKey));
                        for (const candidate of candidatePool) {
                          // A semantic service request may bootstrap missing
                          // collector infrastructure, but it must not occupy an
                          // old local-street lot first. Force one growth pass;
                          // tryGrowComplex publishes the collector frontage and
                          // then the normal placement contract applies.
                          if (candidate.ruleIds.includes("REQUIRES_COLLECTOR")
                            && !await this.districtHasCollector(district.id)) continue;
                          const options = await this.taskPlacementOptions(
                            countryId,
                            district,
                            candidate,
                            roads,
                            surfaces,
                            occupiedTasks,
                            districtCellKeys,
                            visualKind === "BUILDING",
                          );
                          if (options.length === 0) continue;
                          return {
                            entry: candidate,
                            selected: options.sort((a, b) => {
                              const buildingArea = candidate.footprint.width * candidate.footprint.height;
                              const wasteA = a.lot.width * a.lot.height - buildingArea;
                              const wasteB = b.lot.width * b.lot.height - buildingArea;
                              // Best-fit first: consume exact/compact frontage
                              // before a wide bay. Group order is only the
                              // tie-break, otherwise a small building can waste
                              // the one lot that a later tower needs.
                              return wasteA - wasteB || a.order - b.order || a.lot.origin.y - b.lot.origin.y || a.lot.origin.x - b.lot.origin.x;
                            })[0]!,
                          };
                        }
                        return undefined;
                      };

                      // Selection is deliberately read-only. Previously every
                      // rejected catalog candidate could grow its own complex;
                      // the task eventually fitted, but all speculative blocks
                      // stayed behind as empty streets and lots. Grow at most
                      // one semantic candidate, then re-check the whole pool.
                      let placement = await selectFromExistingLots();
                      // A terrain cut-out can reject the highest-ranked facade
                      // even when the district has room for another compatible
                      // model. `growDistrict` is atomic until a complete road +
                      // lot plan is found, so try a bounded set of distinct
                      // geometries instead of treating one blocked favourite as
                      // proof that the entire district is full.
                      const growthCandidates = candidatePool.filter((candidate, index, all) =>
                        all.findIndex((other) => other.footprint.width === candidate.footprint.width
                          && buildingLotDepthCells(other) === buildingLotDepthCells(candidate)) === index,
                      );
                      for (const growthCandidate of growthCandidates) {
                        if (placement) break;
                        try {
                          district = await this.growDistrict(countryId, district, growthCandidate, generationSnapshot);
                        } catch (error) {
                          if (!(error instanceof DomainError) || error.code !== "PLACEMENT_BLOCKED") throw error;
                          continue;
                        }
                        roads = generationSnapshot.roads;
                        placement = await selectFromExistingLots();
                      }
                      const entry = placement?.entry;
                      const selected = placement?.selected;
                      if (!selected || !entry) throw new DomainError("PLACEMENT_BLOCKED", "После расширения не появился подходящий участок для здания");
                      const id = randomUUID();
                      const createdAt = now();
                      // Per-country serial, human-facing: #1, #2, ... Assigned
                      // inside the creation transaction so concurrent creates
                      // on one country serialize and never collide.
                      const taskNumber = Number((await this.db.prepare(`SELECT COALESCE(MAX(t.task_number), 0) + 1 AS next
                        FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ?`).get(countryId) as Row).next);
                      const lots = compactLotsAfterPlacement(
                        district.lots,
                        selected.lot.id,
                        {
                          origin: selected.placement.origin,
                          width: entry.footprint.width,
                          height: entry.footprint.height,
                          northSetback: visualKind === "BUILDING" ? buildingVisualSetbackCells(entry) : 0,
                        },
                        id,
                      );
                      await this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?").run(JSON.stringify(lots), district.id);
                      // A new building redevelops any ruin plot it overlaps.
                      await this.clearRuins(countryId, selected.placement.footprint, generationSnapshot);
                      await this.db.prepare(`INSERT INTO tasks_v3
        (id, task_number, city_id, district_id, title, description, work_item_type, acceptance_criteria, system_analysis, architecture, design_system, implementation_plan, estimate, priority, status, progress, due_at, building_type, visual_kind, visual_asset_key, platform_type, origin_x, origin_y, footprint_json, entrance_x, entrance_y, access_json, access_kind, creator_user_id, assignee_user_id, assignee_role, for_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                                                        id, taskNumber, input.cityId, district.id, title, input.description?.trim().slice(0, 8000) ?? "", input.workItemType ?? "TASK",
                                                        input.acceptanceCriteria?.trim().slice(0, 8000) ?? "", input.systemAnalysis?.trim().slice(0, 16000) ?? "",
                                                        input.architecture?.trim().slice(0, 16000) ?? "", input.designSystem?.trim().slice(0, 16000) ?? "",
                                                        input.implementationPlan?.trim().slice(0, 16000) ?? "", input.estimate,
                                                        input.priority ?? "NORMAL", "PLANNING", 0, input.dueAt ?? null, entry.key, visualKind, visualAssetKey ?? entry.key, visualKind === "PARK" ? "PARK" : taskBuildingPlatform(entry),
                                                        selected.placement.origin.x, selected.placement.origin.y, JSON.stringify(selected.placement.footprint),
                                                        selected.placement.entrance.x, selected.placement.entrance.y, JSON.stringify(selected.placement.accessPath), selected.placement.accessKind,
                                                        input.creatorUserId ?? null, input.assigneeUserId ?? null, input.assigneeRole?.trim().slice(0, 80) ?? null, input.forUserId ?? null, createdAt, createdAt,
                                                      );
                      const creator = input.creatorUserId
                        ? await this.db.prepare("SELECT name FROM users WHERE id = ?").get(input.creatorUserId) as { name: string } | undefined
                        : undefined;
                      for (const document of DEFAULT_TASK_DOCUMENTS) {
                        const content = document.fileName === "system-analysis.md" ? input.systemAnalysis
                          : document.fileName === "architecture.md" ? input.architecture
                            : document.fileName === "design-system.md" ? input.designSystem
                              : input.implementationPlan;
                        await this.db.prepare(`INSERT INTO task_documents_v1
                          (id, task_id, file_name, title, content, is_default, position, actor, actor_user_id, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?)`).run(
                          randomUUID(), id, document.fileName, document.title, content?.trim().slice(0, 64_000) ?? "", document.position,
                          creator?.name ?? "Система страны", input.creatorUserId ?? null, createdAt, createdAt,
                        );
                      }
                      await this.recordTaskEvent(id, "CREATED", creator?.name ?? "Система страны", input.creatorUserId, {
                                                        status: "PLANNING", estimate: input.estimate, assigneeUserId: input.assigneeUserId ?? null, assigneeRole: input.assigneeRole?.trim() ?? null, forUserId: input.forUserId ?? null,
                                                      }, createdAt);
                      // Park cadence is task-driven, not road-growth-driven.
                      // Reconcile after the task exists so the occupied lot is
                      // protected and the sixth, twelfth, ... task can publish
                      // its next small or large green area immediately.
                      const taskCity = cityDto(cityRow);
                      const greenAdjustedLots = await this.publishDistrictGreenFeature(
                        countryId,
                        taskCity,
                        district.id,
                        Number((await this.countryRow(countryId)).seed),
                        district.cells,
                        lots,
                        generationSnapshot,
                      );
                      if (greenAdjustedLots.length !== lots.length) {
                        await this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?")
                          .run(JSON.stringify(greenAdjustedLots), district.id);
                      }
                      this.surfaceCache.delete(countryId);
                      const data = await this.getTask(countryId, id);
                      return {
                        data,
                        eventType: "task.created",
                        eventPayload: {
                          taskId: id,
                          districtId: district.id,
                          buildingType: entry.key,
                          affectedBounds: greenAdjustedLots.length !== lots.length
                            ? unionRect(boundsOf(data.footprint), boundsOf(district.cells))
                            : boundsOf(data.footprint),
                        },
                      };
                    });
  }

  async renameTask(countryId: string, input: { taskId: string; title: string; actor?: string; actorUserId?: string; idempotencyKey: string }): Promise<TaskDto> {
    const title = input.title.trim();
    if (title.length < 2 || title.length > 160) throw new DomainError("INVALID_INPUT", "Название задачи должно содержать от 2 до 160 символов");
    return await this.mutate(countryId, "task.rename.v1", input.idempotencyKey, input, async () => {
                      const task = await this.getTask(countryId, input.taskId);
                      const updatedAt = now();
                      await this.db.prepare("UPDATE tasks_v3 SET title = ?, updated_at = ? WHERE id = ?").run(title, updatedAt, input.taskId);
                      await this.recordTaskEvent(input.taskId, "TITLE_CHANGED", input.actor ?? "MCP", input.actorUserId, { from: task.title, to: title }, updatedAt);
                      const data = await this.getTask(countryId, input.taskId);
                      return { data, eventType: "task.renamed", eventPayload: { taskId: input.taskId, districtId: task.districtId, title, affectedBounds: boundsOf(data.footprint) } };
                    });
  }

  async updateTaskFields(countryId: string, input: {
    taskId: string; title?: string; description?: string; workItemType?: WorkItemType; acceptanceCriteria?: string;
    systemAnalysis?: string; architecture?: string; designSystem?: string; implementationPlan?: string;
    estimate?: Estimate; priority?: TaskPriority; dueAt?: string | null; assigneeRole?: string; forUserId?: string;
    actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskDto> {
    return this.mutate(countryId, "task.fields.v18", input.idempotencyKey, input, async () => {
      const current = await this.getTask(countryId, input.taskId);
      const title = input.title === undefined ? current.title : input.title.trim();
      if (title.length < 2 || title.length > 160) throw new DomainError("INVALID_INPUT", "Название задачи должно содержать от 2 до 160 символов");
      if (input.forUserId && !await this.db.prepare("SELECT 1 FROM country_members WHERE country_id = ? AND user_id = ?").get(countryId, input.forUserId)) {
        throw new DomainError("ASSIGNEE_NOT_MEMBER", "Заказчик должен состоять в правительстве страны");
      }
      if (input.assigneeRole?.trim() && input.assigneeRole.length > 80) throw new DomainError("INVALID_INPUT", "Роль ответственного не длиннее 80 символов");
      const updatedAt = now();
      await this.db.prepare(`UPDATE tasks_v3 SET title = ?, description = ?, work_item_type = ?, acceptance_criteria = ?,
        system_analysis = ?, architecture = ?, design_system = ?, implementation_plan = ?, estimate = ?, priority = ?, due_at = ?, assignee_role = ?, for_user_id = ?, updated_at = ?
        WHERE id = ?`).run(
        title, input.description === undefined ? current.description : input.description.trim().slice(0, 8000),
        input.workItemType ?? current.workItemType,
        input.acceptanceCriteria === undefined ? current.acceptanceCriteria : input.acceptanceCriteria.trim().slice(0, 8000),
        input.systemAnalysis === undefined ? current.systemAnalysis : input.systemAnalysis.trim().slice(0, 16000),
        input.architecture === undefined ? current.architecture : input.architecture.trim().slice(0, 16000),
        input.designSystem === undefined ? current.designSystem : input.designSystem.trim().slice(0, 16000),
        input.implementationPlan === undefined ? current.implementationPlan : input.implementationPlan.trim().slice(0, 16000),
        input.estimate ?? current.estimate, input.priority ?? current.priority,
        input.dueAt === undefined ? current.dueAt : input.dueAt,
        input.assigneeRole === undefined ? current.assigneeRole : (input.assigneeRole?.trim().slice(0, 80) ?? null),
        input.forUserId === undefined ? current.forUser?.id ?? null : (input.forUserId ?? null),
        updatedAt, input.taskId,
      );
      for (const [fileName, content] of [
        ["system-analysis.md", input.systemAnalysis], ["architecture.md", input.architecture],
        ["design-system.md", input.designSystem], ["implementation-plan.md", input.implementationPlan],
      ] as const) {
        if (content === undefined) continue;
        await this.db.prepare("UPDATE task_documents_v1 SET content = ?, actor = ?, actor_user_id = ?, updated_at = ? WHERE task_id = ? AND file_name = ?")
          .run(content.trim().slice(0, 64_000), input.actor ?? "MCP", input.actorUserId ?? null, updatedAt, input.taskId, fileName);
      }
      const changedFields = Object.keys(input).filter((field) => !["taskId", "idempotencyKey", "actor", "actorUserId"].includes(field));
      await this.recordTaskEvent(input.taskId, "FIELDS_UPDATED", input.actor ?? "MCP", input.actorUserId, { changedFields }, updatedAt);
      const data = await this.getTask(countryId, input.taskId);
      return { data, eventType: "task.fields_updated", eventPayload: { taskId: data.id, districtId: data.districtId, changedFields, affectedBounds: boundsOf(data.footprint) } };
    });
  }

  async createTaskDefect(countryId: string, input: {
    taskId: string; title: string; description?: string; reproductionSteps: string; actualResult: string; expectedResult: string;
    actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskDefectDto> {
    return this.mutate(countryId, "task.defect.create.v18", input.idempotencyKey, input, async () => {
      const task = await this.getTask(countryId, input.taskId);
      const title = input.title.trim();
      if (title.length < 2 || title.length > 160) throw new DomainError("INVALID_INPUT", "Название дефекта должно содержать от 2 до 160 символов");
      const id = randomUUID();
      const createdAt = now();
      await this.db.prepare(`INSERT INTO task_defects_v18
        (id, task_id, title, description, reproduction_steps, actual_result, expected_result, status, fixed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, ?, ?)`).run(
        id, task.id, title, input.description?.trim().slice(0, 8000) ?? "", input.reproductionSteps.trim().slice(0, 12000),
        input.actualResult.trim().slice(0, 8000), input.expectedResult.trim().slice(0, 8000), createdAt, createdAt,
      );
      await this.recordTaskEvent(task.id, "DEFECT_CREATED", input.actor ?? "MCP", input.actorUserId, { defectId: id, title }, createdAt);
      const data = (await this.getTask(countryId, task.id)).defects!.find((defect) => defect.id === id)!;
      return { data, eventType: "task.defect_created", eventPayload: { taskId: task.id, defectId: id, affectedBounds: boundsOf(task.footprint) } };
    });
  }

  async updateTaskDefect(countryId: string, input: {
    defectId: string; title?: string; description?: string; reproductionSteps?: string; actualResult?: string; expectedResult?: string;
    status?: TaskDefectDto["status"]; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskDefectDto> {
    return this.mutate(countryId, "task.defect.update.v18", input.idempotencyKey, input, async () => {
      const row = await this.db.prepare(`SELECT defect.*, task.city_id FROM task_defects_v18 defect
        JOIN tasks_v3 task ON task.id = defect.task_id JOIN cities_v3 city ON city.id = task.city_id
        WHERE defect.id = ? AND city.country_id = ?`).get(input.defectId, countryId) as Row | undefined;
      if (!row) throw new DomainError("NOT_FOUND", "Связанный дефект не найден");
      for (const [field, value] of [["шаги воспроизведения", input.reproductionSteps], ["фактический результат", input.actualResult], ["ожидаемый результат", input.expectedResult]] as const) {
        if (value !== undefined && value.trim().length === 0) throw new DomainError("INVALID_INPUT", `${field} не могут быть пустыми`);
      }
      const task = await this.getTask(countryId, String(row.task_id));
      const previousStatus = String(row.status) as TaskDefectDto["status"];
      const status = input.status ?? String(row.status) as TaskDefectDto["status"];
      if (!DEFECT_TRANSITIONS[previousStatus].has(status)) {
        throw new DomainError("INVALID_TRANSITION", `Недопустимый переход дефекта ${previousStatus} → ${status}`);
      }
      const updatedAt = now();
      const fixedAt = status === "FIXED" ? (row.fixed_at ? String(row.fixed_at) : updatedAt) : null;
      await this.db.prepare(`UPDATE task_defects_v18 SET title = ?, description = ?, reproduction_steps = ?, actual_result = ?,
        expected_result = ?, status = ?, fixed_at = ?, updated_at = ? WHERE id = ?`).run(
        input.title === undefined ? row.title : input.title.trim().slice(0, 160),
        input.description === undefined ? row.description : input.description.trim().slice(0, 8000),
        input.reproductionSteps === undefined ? row.reproduction_steps : input.reproductionSteps.trim().slice(0, 12000),
        input.actualResult === undefined ? row.actual_result : input.actualResult.trim().slice(0, 8000),
        input.expectedResult === undefined ? row.expected_result : input.expectedResult.trim().slice(0, 8000),
        status, fixedAt, updatedAt, input.defectId,
      );
      await this.recordTaskEvent(task.id, "DEFECT_UPDATED", input.actor ?? "MCP", input.actorUserId, { defectId: input.defectId, status }, updatedAt);
      const data = (await this.getTask(countryId, task.id)).defects!.find((defect) => defect.id === input.defectId)!;
      return { data, eventType: "task.defect_updated", eventPayload: { taskId: task.id, defectId: input.defectId, status, affectedBounds: boundsOf(task.footprint) } };
    });
  }

  async deleteTask(countryId: string, input: { taskId: string; confirmTitle: string; idempotencyKey: string }): Promise<{ deleted: true; taskId: string; districtId: string; cityId: string; title: string }> {
    return await this.mutate(countryId, "task.delete.v1", input.idempotencyKey, input, async () => {
                      const task = await this.getTask(countryId, input.taskId);
                      const building = await this.buildingEventContext(countryId, input.taskId);
                      if (input.confirmTitle.trim() !== task.title) throw new DomainError("CONFIRMATION_MISMATCH", "Для удаления укажите точное текущее название задачи");
                      const districtRow = await this.db.prepare("SELECT lots_json FROM districts_v3 WHERE id = ?").get(task.districtId) as Row | undefined;
                      if (districtRow) {
                        const lots = json<PlannedLotDto[]>(districtRow.lots_json).map((lot) => lot.taskId === task.id ? { ...lot, taskId: null, vacant: true } : lot);
                        await this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?").run(JSON.stringify(lots), task.districtId);
                      }
                      // Demolished buildings leave a reusable ruin plot. A park
                      // is soft landscape: deleting its task restores the parcel
                      // directly and must not fabricate a building foundation.
                      if (task.visualKind === "BUILDING") {
                        await this.insertWorldFeature(countryId, {
                          cityId: task.cityId, districtId: task.districtId, parentFeatureId: null,
                          kind: "RUIN", assetKind: "AREA", assetKey: "demolished-lot",
                          origin: task.origin, footprint: task.footprint, orientation: "S", accessPath: [],
                        });
                      }
                      await this.db.prepare("DELETE FROM tasks_v3 WHERE id = ?").run(task.id);
                      this.surfaceCache.delete(countryId);
                      const data = { deleted: true as const, taskId: task.id, districtId: task.districtId, cityId: task.cityId, title: task.title };
                      return { data, eventType: "task.deleted", eventPayload: { ...data, building, affectedBounds: boundsOf([...task.footprint, ...task.accessPath]) } };
                    });
  }

  async updateTaskStatus(countryId: string, input: { taskId: string; status: TaskStatus; progress?: number; comment?: string; actor?: string; actorUserId?: string; idempotencyKey: string }): Promise<TaskDto> {
    return await this.mutate(countryId, "task.status.v3", input.idempotencyKey, input, async () => {
                      const task = await this.getTask(countryId, input.taskId);
                      const district = await this.db.prepare("SELECT status FROM districts_v3 WHERE id = ?").get(task.districtId) as Row | undefined;
                      if (district?.status === "PLANNED" && input.status !== "PLANNING") {
                        throw new DomainError("DISTRICT_NOT_ACTIVE", "Задачу планового района нельзя начать до активации района");
                      }
                      const order: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
                      const from = order.indexOf(task.status);
                      const to = order.indexOf(input.status);
                      if (to < from && !(task.status === "TESTING" && input.status === "IN_PROGRESS" && input.comment?.trim())) {
                        throw new DomainError("INVALID_TRANSITION", "Обратный переход разрешён только из тестирования в работу с комментарием");
                      }
                      if (to > from + 1) throw new DomainError("INVALID_TRANSITION", "Нельзя пропускать стадии строительства");
                      if (input.status === "COMPLETED") {
                        const incompleteChecklist = task.checklist?.filter((item) => !item.done) ?? [];
                        if (incompleteChecklist.length > 0) {
                          throw new DomainError("CHECKLIST_INCOMPLETE", "Нельзя завершить задачу, пока в чек-листе есть невыполненные пункты");
                        }
                        const activeDefects = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM task_defects_v18 WHERE task_id = ? AND status <> 'FIXED'").get(task.id) as Row).count);
                        if (activeDefects > 0) throw new DomainError("OPEN_DEFECTS", `Задачу нельзя завершить: осталось неисправленных дефектов — ${activeDefects}`);
                      }
                      const range = STATUS_PROGRESS_RANGE[input.status];
                      const defaults: Record<TaskStatus, number> = { PLANNING: 0, STARTED: 0, IN_PROGRESS: 50, TESTING: 90, COMPLETED: 100 };
                      const progress = input.progress == null ? defaults[input.status] : Math.max(range[0], Math.min(range[1], Math.round(input.progress)));
                      const updatedAt = now();
                      await this.db.prepare("UPDATE tasks_v3 SET status = ?, progress = ?, updated_at = ? WHERE id = ?").run(input.status, progress, updatedAt, input.taskId);
                      if (input.comment?.trim()) await this.db.prepare("INSERT INTO task_comments_v3 (id, task_id, body, actor, created_at) VALUES (?, ?, ?, ?, ?)")
                                                                        .run(randomUUID(), input.taskId, input.comment.trim().slice(0, 8000), input.actor ?? "MCP client", updatedAt);
                      await this.recordTaskEvent(input.taskId, "STATUS_CHANGED", input.actor ?? "MCP", input.actorUserId, {
                                                        from: task.status, to: input.status, progress, comment: input.comment?.trim() || null,
                                                      }, updatedAt);
                      const data = await this.getTask(countryId, input.taskId);
                      const changedGreenArea = await this.syncDistrictGreenAreaDevelopment(countryId, data.districtId);
                      return {
                        data,
                        eventType: "task.status_changed",
                        eventPayload: {
                          taskId: input.taskId,
                          status: input.status,
                          progress,
                          stage: data.stage,
                          // Ordinary building progress changes only dynamic
                          // entities and can be patched over realtime without
                          // refetching or rebaking static chunk ground. A park
                          // development change still invalidates its ground.
                          groundChanged: data.visualKind === "PARK" || changedGreenArea.length > 0,
                          // Frontage decorations are generated from the task's
                          // access/footprint context and can land one cell into
                          // a neighbouring chunk. Invalidate that ownership halo
                          // even though ordinary building ground remains reusable.
                          affectedBounds: expandRect(boundsOf([...data.footprint, ...data.accessPath, ...changedGreenArea]), 1),
                        },
                      };
                    });
  }

  async addTaskComment(countryId: string, input: { taskId: string; body: string; actor?: string; actorUserId?: string; idempotencyKey: string }): Promise<TaskDto> {
    return await this.mutate(countryId, "task.comment.v3", input.idempotencyKey, input, async () => {
                      await this.getTask(countryId, input.taskId);
                      await this.db.prepare("INSERT INTO task_comments_v3 (id, task_id, body, actor, created_at) VALUES (?, ?, ?, ?, ?)")
                                                        .run(randomUUID(), input.taskId, input.body.trim().slice(0, 8000), input.actor ?? "MCP client", now());
                      await this.recordTaskEvent(input.taskId, "COMMENT_ADDED", input.actor ?? "MCP", input.actorUserId, { body: input.body.trim().slice(0, 8000) });
                      const data = await this.getTask(countryId, input.taskId);
                      return { data, eventType: "task.comment_added", eventPayload: { taskId: input.taskId, affectedBounds: boundsOf(data.footprint) } };
                    });
  }

  async assignTask(countryId: string, input: { taskId: string; assigneeUserId: string | null; assigneeRole?: string; actor?: string; actorUserId?: string; idempotencyKey: string }): Promise<TaskDto> {
    return await this.mutate(countryId, "task.assign.v7", input.idempotencyKey, input, async () => {
                      const task = await this.getTask(countryId, input.taskId);
                      if (input.assigneeUserId && !await this.db.prepare("SELECT 1 FROM country_members WHERE country_id = ? AND user_id = ?").get(countryId, input.assigneeUserId)) {
                        throw new DomainError("ASSIGNEE_NOT_MEMBER", "Ответственный должен состоять в правительстве страны");
                      }
                      if (input.assigneeRole?.trim() && input.assigneeRole.length > 80) throw new DomainError("INVALID_INPUT", "Роль ответственного не длиннее 80 символов");
                      const previous = task.assignee?.id ?? null;
                      const updatedAt = now();
                      await this.db.prepare("UPDATE tasks_v3 SET assignee_user_id = ?, assignee_role = ?, updated_at = ? WHERE id = ?")
                                                        .run(input.assigneeUserId, input.assigneeRole?.trim().slice(0, 80) ?? null, updatedAt, input.taskId);
                      await this.recordTaskEvent(input.taskId, "ASSIGNEE_CHANGED", input.actor ?? "MCP", input.actorUserId, {
                                                        fromUserId: previous, toUserId: input.assigneeUserId, assigneeRole: input.assigneeRole?.trim() ?? null,
                                                      }, updatedAt);
                      const data = await this.getTask(countryId, input.taskId);
                      return { data, eventType: "task.assignee_changed", eventPayload: { taskId: input.taskId, assigneeUserId: input.assigneeUserId, affectedBounds: boundsOf(data.footprint) } };
                    });
  }

  async addTaskDependency(countryId: string, input: { taskId: string; dependsOnTaskId: string; actor?: string; actorUserId?: string; idempotencyKey: string }): Promise<TaskDto> {
    return await this.mutate(countryId, "task.dependency.add.v1", input.idempotencyKey, input, async () => {
                      const task = await this.getTask(countryId, input.taskId);
                      const dependency = await this.getTask(countryId, input.dependsOnTaskId);
                      if (task.cityId !== dependency.cityId) throw new DomainError("INVALID_INPUT", "Связь возможна только между задачами одного города");
                      try {
                        await this.db.prepare("INSERT INTO task_dependencies_v1 (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)")
                          .run(input.taskId, input.dependsOnTaskId, now());
                      } catch (error) {
                        if (String(error).includes("UNIQUE")) throw new DomainError("CONFLICT", "Связь уже существует");
                        throw error;
                      }
                      await this.recordTaskEvent(input.taskId, "FIELDS_UPDATED", input.actor ?? "MCP", input.actorUserId, { dependsOnTaskId: input.dependsOnTaskId }, now());
                      const data = await this.getTask(countryId, input.taskId);
                      return { data, eventType: "task.fields_updated", eventPayload: { taskId: input.taskId, districtId: data.districtId, changedFields: ["dependencies"], affectedBounds: boundsOf(data.footprint) } };
                    });
  }

  async removeTaskDependency(countryId: string, input: { taskId: string; dependsOnTaskId: string; actor?: string; actorUserId?: string; idempotencyKey: string }): Promise<TaskDto> {
    return await this.mutate(countryId, "task.dependency.remove.v1", input.idempotencyKey, input, async () => {
                      await this.getTask(countryId, input.taskId);
                      await this.db.prepare("DELETE FROM task_dependencies_v1 WHERE task_id = ? AND depends_on_task_id = ?").run(input.taskId, input.dependsOnTaskId);
                      await this.recordTaskEvent(input.taskId, "FIELDS_UPDATED", input.actor ?? "MCP", input.actorUserId, { removedDependsOnTaskId: input.dependsOnTaskId }, now());
                      const data = await this.getTask(countryId, input.taskId);
                      return { data, eventType: "task.fields_updated", eventPayload: { taskId: input.taskId, districtId: data.districtId, changedFields: ["dependencies"], affectedBounds: boundsOf(data.footprint) } };
                    });
  }

  async getTaskActivity(countryId: string, taskId: string): Promise<{ events: TaskEventDto[]; comments: TaskCommentDto[]; defects: TaskDefectDto[]; attachments: TaskAttachmentDto[]; dependencies: TaskDto["dependencies"] }> {
    const task = await this.getTask(countryId, taskId);
    return {
      events: task.events ?? [],
      comments: task.comments ?? [],
      defects: task.defects ?? [],
      attachments: task.attachments ?? [],
      dependencies: task.dependencies ?? [],
    };
  }

  async getArchive(countryId: string): Promise<CountryArchiveDto> {
    const row = await this.db.prepare(`SELECT archive.*, COUNT(record.id)::int AS record_count
      FROM country_archives_v1 archive
      LEFT JOIN country_archive_records_v1 record ON record.archive_id = archive.id
      WHERE archive.country_id = ? GROUP BY archive.id`).get(countryId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Государственный архив не найден");
    return archiveDto(row);
  }

  async getArchiveRecord(countryId: string, recordId: string): Promise<ArchiveRecordDto> {
    const row = await this.db.prepare("SELECT * FROM country_archive_records_v1 WHERE id = ? AND country_id = ?")
      .get(recordId, countryId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Запись архива не найдена");
    return archiveRecordDto(row);
  }

  async listArchiveRecords(countryId: string): Promise<ArchiveRecordDto[]> {
    await this.getArchive(countryId);
    const rows = await this.db.prepare(`SELECT * FROM country_archive_records_v1
      WHERE country_id = ? ORDER BY kind, created_at, id`).all(countryId) as Row[];
    return rows.map(archiveRecordDto);
  }

  async createArchiveRecord(countryId: string, input: {
    kind: ArchiveRecordKind; title: string; body?: string; sourceUrl?: string; tags?: string[]; idempotencyKey: string;
  }): Promise<ArchiveRecordDto> {
    const title = input.title.trim();
    if (title.length < 2 || title.length > 160) throw new DomainError("INVALID_INPUT", "Название записи должно содержать от 2 до 160 символов");
    if (!["PROJECT", "REPOSITORY", "ARCHITECTURE", "CONVENTION", "ENVIRONMENT", "TEMPLATE"].includes(input.kind)) {
      throw new DomainError("INVALID_INPUT", "Неизвестный тип записи Государственного архива");
    }
    return this.mutate(countryId, "archive.record.create.v1", input.idempotencyKey, input, async () => {
      const archive = await this.getArchive(countryId);
      const id = randomUUID();
      const createdAt = now();
      const tags = (input.tags ?? []).map((tag) => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 10);
      const sourceUrl = input.sourceUrl?.trim() ? normalizeLinkUrl(input.sourceUrl) : null;
      await this.db.prepare(`INSERT INTO country_archive_records_v1
        (id, archive_id, country_id, kind, title, body, source_url, tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, archive.id, countryId, input.kind, title, input.body?.trim().slice(0, 32000) ?? "", sourceUrl,
        JSON.stringify(tags), createdAt, createdAt,
      );
      const affectedBounds = await this.syncCountryArchiveComplex(countryId);
      const data = await this.getArchiveRecord(countryId, id);
      return { data, eventType: "archive.record_created", eventPayload: { archiveId: archive.id, recordId: id, affectedBounds } };
    });
  }

  async updateArchiveRecord(countryId: string, input: {
    recordId: string; kind?: ArchiveRecordKind; title?: string; body?: string; sourceUrl?: string | null;
    tags?: string[]; idempotencyKey: string;
  }): Promise<ArchiveRecordDto> {
    return this.mutate(countryId, "archive.record.update.v1", input.idempotencyKey, input, async () => {
      const current = await this.getArchiveRecord(countryId, input.recordId);
      if (input.title !== undefined && (input.title.trim().length < 2 || input.title.trim().length > 160)) {
        throw new DomainError("INVALID_INPUT", "Название записи должно содержать от 2 до 160 символов");
      }
      const kind = input.kind ?? current.kind;
      if (!["PROJECT", "REPOSITORY", "ARCHITECTURE", "CONVENTION", "ENVIRONMENT", "TEMPLATE"].includes(kind)) {
        throw new DomainError("INVALID_INPUT", "Неизвестный тип записи Государственного архива");
      }
      const tags = input.tags === undefined ? current.tags : input.tags.map((tag) => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 10);
      const sourceUrl = input.sourceUrl === undefined ? current.sourceUrl
        : input.sourceUrl?.trim() ? normalizeLinkUrl(input.sourceUrl) : null;
      const updatedAt = now();
      await this.db.prepare(`UPDATE country_archive_records_v1
        SET kind = ?, title = ?, body = ?, source_url = ?, tags_json = ?, updated_at = ? WHERE id = ?`).run(
        kind, input.title === undefined ? current.title : input.title.trim(),
        input.body === undefined ? current.body : input.body.trim().slice(0, 32000),
        sourceUrl, JSON.stringify(tags), updatedAt, input.recordId,
      );
      const data = await this.getArchiveRecord(countryId, input.recordId);
      return { data, eventType: "archive.record_updated", eventPayload: { archiveId: data.archiveId, recordId: data.id } };
    });
  }

  async deleteArchiveRecord(countryId: string, input: {
    recordId: string; confirmTitle: string; idempotencyKey: string;
  }): Promise<{ id: string }> {
    return this.mutate(countryId, "archive.record.delete.v1", input.idempotencyKey, input, async () => {
      const current = await this.getArchiveRecord(countryId, input.recordId);
      if (current.title !== input.confirmTitle.trim()) throw new DomainError("INVALID_INPUT", "Подтверждающее название не совпадает");
      await this.db.prepare("DELETE FROM country_archive_records_v1 WHERE id = ?").run(input.recordId);
      const affectedBounds = await this.syncCountryArchiveComplex(countryId);
      return {
        data: { id: input.recordId }, eventType: "archive.record_deleted",
        eventPayload: { archiveId: current.archiveId, recordId: input.recordId, affectedBounds },
      };
    });
  }

  async getChunk(countryId: string, chunkX: number, chunkY: number, lod: ChunkLod = "DETAIL"): Promise<ChunkDto> {
    return materializeChunkPayload(await this.getChunkPayload(countryId, chunkX, chunkY, lod));
  }

  private async loadViewportSpatialSnapshot(
    countryId: string,
    viewportBounds: Rect,
    lod: ChunkLod,
  ): Promise<ViewportSpatialSnapshot> {
    const surfaceScope = lod === "DETAIL" ? expandRect(viewportBounds, 2) : viewportBounds;
    const [roadRows, districts, cities, tasks, features] = await Promise.all([
      this.db.prepare(`SELECT x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ?
        AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`).all(
        countryId, surfaceScope.minX, surfaceScope.maxX, surfaceScope.minY, surfaceScope.maxY,
      ) as Promise<Row[]>,
      this.districtsInBounds(countryId, surfaceScope),
      lod === "DETAIL" ? this.citiesInBounds(countryId, expandRect(viewportBounds, 96)) : Promise.resolve([]),
      this.tasksInBounds(countryId, surfaceScope, lod === "DETAIL"),
      this.featuresInBounds(countryId, surfaceScope),
    ]);
    const defectSummaryByTask = new Map<string, ChunkDefectSummary>();
    if (lod === "DETAIL" && tasks.length > 0) {
      const rows = await this.db.prepare(`SELECT task_id, status, COUNT(*) AS count FROM task_defects_v18
        WHERE task_id = ANY(?::text[]) AND status <> 'FIXED' GROUP BY task_id, status`)
        .all(tasks.map((task) => task.id)) as Row[];
      for (const row of rows) {
        const taskId = String(row.task_id);
        const summary = defectSummaryByTask.get(taskId) ?? { open: 0, inProgress: 0, verifying: 0, active: 0 };
        const count = Number(row.count);
        if (row.status === "OPEN") summary.open += count;
        else if (row.status === "IN_PROGRESS") summary.inProgress += count;
        else if (row.status === "VERIFYING") summary.verifying += count;
        summary.active += count;
        defectSummaryByTask.set(taskId, summary);
      }
    }
    return {
      roads: roadRows.map((row) => ({
        x: Number(row.x), y: Number(row.y), mask: Number(row.mask),
        structure: String(row.structure) as RoadCellDto["structure"],
        roadClass: String(row.road_class) as RoadCellDto["roadClass"],
      })),
      districts, cities, tasks, features, defectSummaryByTask,
    };
  }

  async getChunkPayload(
    countryId: string,
    chunkX: number,
    chunkY: number,
    lod: ChunkLod = "DETAIL",
    retryAttempt = 0,
  ): Promise<ChunkPayloadDto> {
    const country = await this.countryRow(countryId);
    const worldVersion = Number(country.world_version);
    this.knownWorldVersions.set(countryId, Math.max(worldVersion, this.knownWorldVersions.get(countryId) ?? 0));
    return this.getChunkPayloadAtVersion(countryId, chunkX, chunkY, lod, country, worldVersion, retryAttempt);
  }

  async getViewportPayloads(
    countryId: string,
    minChunkX: number,
    minChunkY: number,
    maxChunkX: number,
    maxChunkY: number,
    lod: ChunkLod = "DETAIL",
    retryAttempt = 0,
  ): Promise<ChunkPayloadDto[]> {
    const country = await this.countryRow(countryId);
    const worldVersion = Number(country.world_version);
    this.knownWorldVersions.set(countryId, Math.max(worldVersion, this.knownWorldVersions.get(countryId) ?? 0));
    const width = maxChunkX - minChunkX + 1;
    const height = maxChunkY - minChunkY + 1;
    const coordinates = Array.from({ length: width * height }, (_, index) => {
      const chunkX = minChunkX + index % width;
      const chunkY = minChunkY + Math.floor(index / width);
      return { chunkX, chunkY, cacheKey: `${countryId}:${chunkX}:${chunkY}:${lod}` };
    });
    const resolved = new Map<string, ChunkPayloadDto>();
    let unresolved = coordinates.filter(({ cacheKey }) => {
      const cached = this.cachedChunk(cacheKey);
      if (!cached || cached.publishedVersion !== worldVersion) return true;
      resolved.set(cacheKey, cached);
      return false;
    });
    if (unresolved.length > 0 && this.sharedWorldCache) {
      await Promise.all(unresolved.map(async ({ chunkX, chunkY, cacheKey }) => {
        const payload = await this.sharedWorldCache!.getChunk(this.sharedChunkKey(cacheKey, worldVersion));
        if (this.validSharedChunk(payload, chunkX, chunkY, lod, worldVersion)) {
          resolved.set(cacheKey, this.storeChunk(cacheKey, payload));
        }
      }));
      unresolved = unresolved.filter(({ cacheKey }) => !resolved.has(cacheKey));
    }
    if (unresolved.length > 0) {
      const publishedRows = await this.db.prepare(`SELECT payload_json, chunk_x, chunk_y FROM world_chunk_payloads_v1
        WHERE country_id = ? AND lod = ?
          AND chunk_x BETWEEN ? AND ? AND chunk_y BETWEEN ? AND ?`)
        .all(countryId, lod, minChunkX, maxChunkX, minChunkY, maxChunkY) as Row[];
      for (const row of publishedRows) {
        const payload = json<ChunkPayloadDto>(row.payload_json);
        const cacheKey = `${countryId}:${Number(row.chunk_x)}:${Number(row.chunk_y)}:${lod}`;
        if (this.validChunkIdentity(payload, Number(row.chunk_x), Number(row.chunk_y), lod)) {
          const current = payload.publishedVersion === worldVersion ? payload : { ...payload, publishedVersion: worldVersion };
          resolved.set(cacheKey, this.storeChunk(cacheKey, current));
          void this.sharedWorldCache?.setChunk(this.sharedChunkKey(cacheKey, worldVersion), current);
        }
      }
      for (const { cacheKey } of unresolved) if (!resolved.has(cacheKey)) this.chunkCache.delete(cacheKey);
    }
    const missing = coordinates.filter(({ cacheKey }) => !resolved.has(cacheKey));
    const locallyBuilt: Array<{ cacheKey: string; payload: ChunkPayloadDto }> = [];
    const viewportBounds: Rect = {
      minX: minChunkX * CHUNK_SIZE,
      minY: minChunkY * CHUNK_SIZE,
      maxX: (maxChunkX + 1) * CHUNK_SIZE - 1,
      maxY: (maxChunkY + 1) * CHUNK_SIZE - 1,
    };
    let spatialSnapshot: Promise<ViewportSpatialSnapshot> | undefined;
    const getSpatialSnapshot = () => spatialSnapshot ??= this.loadViewportSpatialSnapshot(countryId, viewportBounds, lod);
    try {
      for (let offset = 0; offset < missing.length; offset += 4) {
        const batch = await Promise.all(missing.slice(offset, offset + 4).map(async ({ chunkX, chunkY, cacheKey }) => {
          const build = async () => this.buildChunkPayload(
            countryId, chunkX, chunkY, lod, country, cacheKey, worldVersion, false, await getSpatialSnapshot(),
          );
          if (this.sharedWorldCache?.getOrBuildChunk) {
            // The lease owner publishes to PostgreSQL before Optional Redis is
            // allowed to expose its content blob. This makes the cache a pure
            // acceleration layer even if a mutation wins while geometry is
            // being built.
            const buildAndPublish = async () => {
              const payload = await build();
              if (!await this.publishChunkPayloads(countryId, [payload])) throw new StaleChunkBuildError();
              return payload;
            };
            const result = await this.sharedWorldCache.getOrBuildChunk(
              this.sharedChunkKey(cacheKey, worldVersion), buildAndPublish,
            );
            const payload = this.validSharedChunk(result.payload, chunkX, chunkY, lod, worldVersion)
              ? result.payload
              : await buildAndPublish();
            return { cacheKey, payload, canonicalPublished: true };
          }
          return { cacheKey, payload: await build(), canonicalPublished: false };
        }));
        for (const entry of batch) {
          resolved.set(entry.cacheKey, this.storeChunk(entry.cacheKey, entry.payload));
          if (!entry.canonicalPublished) locallyBuilt.push({ cacheKey: entry.cacheKey, payload: entry.payload });
        }
      }
    } catch (error) {
      if (error instanceof StaleChunkBuildError && retryAttempt < 2) {
        return this.getViewportPayloads(
          countryId, minChunkX, minChunkY, maxChunkX, maxChunkY, lod, retryAttempt + 1,
        );
      }
      throw error;
    }
    if (locallyBuilt.length > 0 && !await this.publishChunkPayloads(countryId, locallyBuilt.map((entry) => entry.payload))) {
      if (retryAttempt < 2) {
        return this.getViewportPayloads(
          countryId, minChunkX, minChunkY, maxChunkX, maxChunkY, lod, retryAttempt + 1,
        );
      }
      throw new StaleChunkBuildError();
    }
    for (const { cacheKey, payload } of locallyBuilt) {
      if (!this.sharedWorldCache?.getOrBuildChunk) {
        void this.sharedWorldCache?.setChunk(this.sharedChunkKey(cacheKey, worldVersion), payload);
      }
    }
    if (this.sharedWorldCache) {
      const fence = await this.db.prepare("SELECT world_version FROM countries WHERE id = ?").get(countryId) as Row | undefined;
      if (!fence || Number(fence.world_version) !== worldVersion) {
        if (retryAttempt < 2) {
          return this.getViewportPayloads(
            countryId, minChunkX, minChunkY, maxChunkX, maxChunkY, lod, retryAttempt + 1,
          );
        }
        throw new StaleChunkBuildError();
      }
    }
    return coordinates.map(({ cacheKey }) => resolved.get(cacheKey)!);
  }

  private async getChunkPayloadAtVersion(
    countryId: string,
    chunkX: number,
    chunkY: number,
    lod: ChunkLod,
    country: Row,
    worldVersion: number,
    retryAttempt = 0,
  ): Promise<ChunkPayloadDto> {
    const cacheKey = `${countryId}:${chunkX}:${chunkY}:${lod}`;
    const cached = this.cachedChunk(cacheKey);
    if (cached) {
      if (cached.publishedVersion === worldVersion) return cached;
      // Another app replica may have committed a visual mutation and deleted
      // the shared projection while this process still owns an L1 entry. Only
      // carry a payload across world versions when the authoritative row still
      // validates its content hash (metadata-only events preserve that row).
      const validation = await this.db.prepare(`SELECT content_hash FROM world_chunk_payloads_v1
        WHERE country_id = ? AND chunk_x = ? AND chunk_y = ? AND lod = ?`)
        .get(countryId, chunkX, chunkY, lod) as Row | undefined;
      if (validation?.content_hash === cached.contentHash) {
        return this.storeChunk(cacheKey, { ...cached, publishedVersion: worldVersion });
      }
      this.chunkCache.delete(cacheKey);
    }

    const shared = await this.sharedWorldCache?.getChunk(this.sharedChunkKey(cacheKey, worldVersion));
    if (this.validSharedChunk(shared, chunkX, chunkY, lod, worldVersion)) return this.storeChunk(cacheKey, shared);

    const published = await this.db.prepare(`SELECT payload_json FROM world_chunk_payloads_v1
      WHERE country_id = ? AND chunk_x = ? AND chunk_y = ? AND lod = ?`)
      .get(countryId, chunkX, chunkY, lod) as Row | undefined;
    if (published) {
      const payload = json<ChunkPayloadDto>(published.payload_json);
      if (this.validChunkIdentity(payload, chunkX, chunkY, lod)) {
        const current = payload.publishedVersion === worldVersion ? payload : { ...payload, publishedVersion: worldVersion };
        void this.sharedWorldCache?.setChunk(this.sharedChunkKey(cacheKey, worldVersion), current);
        return this.storeChunk(cacheKey, current);
      }
    }

    const pendingKey = `${cacheKey}:${worldVersion}`;
    let pending = this.pendingChunkBuilds.get(pendingKey);
    if (!pending) {
      pending = this.buildChunkPayload(countryId, chunkX, chunkY, lod, country, cacheKey, worldVersion);
      this.pendingChunkBuilds.set(pendingKey, pending);
    }
    try {
      const payload = await pending;
      void this.sharedWorldCache?.setChunk(this.sharedChunkKey(cacheKey, payload.publishedVersion), payload);
      return payload;
    } catch (error) {
      if (error instanceof StaleChunkBuildError && retryAttempt < 2) {
        return await this.getChunkPayload(countryId, chunkX, chunkY, lod, retryAttempt + 1);
      }
      throw error;
    } finally {
      if (this.pendingChunkBuilds.get(pendingKey) === pending) this.pendingChunkBuilds.delete(pendingKey);
    }
  }

  private async publishChunkPayload(countryId: string, payload: ChunkPayloadDto): Promise<boolean> {
    return this.publishChunkPayloads(countryId, [payload]);
  }

  private async publishChunkPayloads(countryId: string, payloads: readonly ChunkPayloadDto[]): Promise<boolean> {
    if (payloads.length === 0) return true;
    return transaction(this.db, async () => {
      // Serialize publication with canonical mutations. If publishing wins,
      // the later mutation deletes this row; if mutation wins, its new world
      // version prevents an old in-flight build from being persisted.
      const country = await this.db.prepare("SELECT world_version FROM countries WHERE id = ? FOR KEY SHARE")
        .get(countryId) as Row | undefined;
      if (!country || payloads.some((payload) => Number(country.world_version) !== payload.publishedVersion)) return false;
      const publishedAt = now();
      const rows = payloads.map((payload) => ({
        chunk_x: payload.chunkX,
        chunk_y: payload.chunkY,
        lod: payload.lod,
        content_hash: payload.contentHash,
        payload_json: payload,
        published_at: publishedAt,
      }));
      await this.db.prepare(`INSERT INTO world_chunk_payloads_v1
        (country_id, chunk_x, chunk_y, lod, content_hash, payload_json, published_at)
        SELECT ?, row.chunk_x, row.chunk_y, row.lod, row.content_hash, row.payload_json, row.published_at
        FROM jsonb_to_recordset(?::jsonb) AS row(
          chunk_x integer, chunk_y integer, lod text, content_hash text, payload_json jsonb, published_at timestamptz
        )
        ON CONFLICT (country_id, chunk_x, chunk_y, lod) DO UPDATE SET
          content_hash = EXCLUDED.content_hash,
          payload_json = EXCLUDED.payload_json,
          published_at = EXCLUDED.published_at`).run(countryId, JSON.stringify(rows));
      await this.db.prepare(`WITH stale AS (
        SELECT country_id, chunk_x, chunk_y, lod FROM world_chunk_payloads_v1
        WHERE country_id = ? ORDER BY published_at DESC
        OFFSET ?
      )
      DELETE FROM world_chunk_payloads_v1 AS payload USING stale
      WHERE payload.country_id = stale.country_id
        AND payload.chunk_x = stale.chunk_x AND payload.chunk_y = stale.chunk_y AND payload.lod = stale.lod`).run(
        countryId, AppService.PUBLISHED_CHUNK_LIMIT_PER_COUNTRY,
      );
      return true;
    });
  }

  private async buildChunkPayload(
    countryId: string,
    chunkX: number,
    chunkY: number,
    lod: ChunkLod,
    country: Row,
    cacheKey: string,
    worldVersion: number,
    publish = true,
    spatialSnapshot?: ViewportSpatialSnapshot,
  ): Promise<ChunkPayloadDto> {
    const seed = Number(country.seed);
    const minX = chunkX * CHUNK_SIZE;
    const minY = chunkY * CHUNK_SIZE;
    const chunkBounds = { minX, minY, maxX: minX + CHUNK_SIZE - 1, maxY: minY + CHUNK_SIZE - 1 };
    const roadRows = async (bounds: Rect) => (await this.db.prepare("SELECT x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?")
      .all(countryId, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY) as Row[]).map((row) => ({
        x: Number(row.x), y: Number(row.y), mask: Number(row.mask),
        structure: String(row.structure) as RoadCellDto["structure"],
        roadClass: String(row.road_class) as RoadCellDto["roadClass"],
      }));
    const surfaceScope = lod === "DETAIL" ? expandRect(chunkBounds, 2) : chunkBounds;
    const [surfaceRoads, nearbyDistricts, nearbyCities, nearbyTasks, nearbyFeatures] = spatialSnapshot
      ? [
          spatialSnapshot.roads.filter((road) => contains(surfaceScope, road)),
          spatialSnapshot.districts.flatMap((district) => {
            const cells = district.cells.filter((cell) => contains(surfaceScope, cell));
            return cells.length > 0 ? [{ ...district, cells }] : [];
          }),
          lod === "DETAIL"
            ? spatialSnapshot.cities.filter((city) => intersects(city.bounds, expandRect(chunkBounds, 96)))
            : [],
          spatialSnapshot.tasks.filter((task) => task.footprint.some((cell) => contains(surfaceScope, cell))
            || lod === "DETAIL" && task.accessPath.some((cell) => contains(surfaceScope, cell))),
          spatialSnapshot.features.filter((feature) => feature.footprint.some((cell) => contains(surfaceScope, cell))
            || feature.accessPath.some((cell) => contains(surfaceScope, cell))),
        ]
      : await Promise.all([
          roadRows(surfaceScope),
          this.districtsInBounds(countryId, surfaceScope),
          lod === "DETAIL" ? this.citiesInBounds(countryId, expandRect(chunkBounds, 96)) : Promise.resolve([]),
          this.tasksInBounds(countryId, surfaceScope, lod === "DETAIL"),
          this.featuresInBounds(countryId, surfaceScope),
        ]);
    const roads = surfaceRoads.filter((road) => contains(chunkBounds, road));
    const districts = nearbyDistricts.flatMap((district) => {
      const cells = district.cells.filter((cell) => contains(chunkBounds, cell));
      return cells.length === 0 ? [] : [{
        id: district.id, cityId: district.cityId, name: district.name, deadline: district.deadline,
        status: district.status, color: district.color, archetype: district.archetype, cells,
      }];
    });
    const chunkTasks = nearbyTasks.filter((task) => task.footprint.some((cell) => contains(chunkBounds, cell)));
    const defectSummaryByTask = new Map<string, ChunkDefectSummary>();
    if (spatialSnapshot) {
      for (const task of chunkTasks) {
        const summary = spatialSnapshot.defectSummaryByTask.get(task.id);
        if (summary) defectSummaryByTask.set(task.id, summary);
      }
    } else if (lod === "DETAIL" && chunkTasks.length > 0) {
      const rows = await this.db.prepare(`SELECT task_id, status, COUNT(*) AS count FROM task_defects_v18
        WHERE task_id = ANY(?::text[]) AND status <> 'FIXED' GROUP BY task_id, status`)
        .all(chunkTasks.map((task) => task.id)) as Row[];
      for (const row of rows) {
        const taskId = String(row.task_id);
        const summary = defectSummaryByTask.get(taskId) ?? { open: 0, inProgress: 0, verifying: 0, active: 0 };
        const count = Number(row.count);
        if (row.status === "OPEN") summary.open += count;
        else if (row.status === "IN_PROGRESS") summary.inProgress += count;
        else if (row.status === "VERIFYING") summary.verifying += count;
        summary.active += count;
        defectSummaryByTask.set(taskId, summary);
      }
    }
    const cityNames = new Map(nearbyCities.map((city) => [city.id, city.name]));
    const worldFeatures = lod === "OVERVIEW" ? [] : nearbyFeatures
      .filter((feature) => feature.footprint.some((cell) => contains(chunkBounds, cell))
        || feature.accessPath.some((cell) => contains(chunkBounds, cell)))
      .map((feature) => feature.kind === "CITY_SIGN" && feature.cityId
        ? { ...feature, label: cityNames.get(feature.cityId) } : feature);
    const surfaces = lod === "OVERVIEW" ? (() => {
      const roadKeys = new Set(roads.map(cellKey));
      const blockedKeys = new Set([
        ...chunkTasks.flatMap((task) => task.footprint).map(cellKey),
        ...nearbyFeatures.flatMap((feature) => feature.footprint).map(cellKey),
      ]);
      const paths = new Map<string, SurfaceCellDto>();
      const publish = (cell: Cell) => {
        const key = cellKey(cell);
        if (contains(chunkBounds, cell) && !roadKeys.has(key) && !blockedKeys.has(key)) {
          paths.set(key, { ...cell, kind: "PATH", finish: "PAVERS" });
        }
      };
      for (const road of roads) {
        for (const cell of neighbors4(road)) {
          const key = cellKey(cell);
          if (contains(chunkBounds, cell) && !roadKeys.has(key) && !blockedKeys.has(key) && !paths.has(key)) {
            paths.set(key, { ...cell, kind: "SIDEWALK" });
          }
        }
      }
      for (const district of nearbyDistricts) for (const lot of district.lots) {
        if (!lot.taskId) continue;
        for (const cell of lot.sharedAccess ?? []) publish(cell);
      }
      for (const cell of buildingGapPaths(nearbyDistricts, nearbyTasks)) publish(cell);
      for (const cell of buildingApronCells({
        tasks: nearbyTasks,
        roads: new Map(roads.map((road) => [cellKey(road), road])),
        blocked: blockedKeys,
        isSurfaceTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
      })) publish(cell);
      for (const task of nearbyTasks) if (task.visualKind === "PARK" && task.stage >= 2) {
        for (const cell of greenAreaPathCells(task.footprint, task.visualAssetKey)) {
          if (contains(chunkBounds, cell) && !roadKeys.has(cellKey(cell))) {
            paths.set(cellKey(cell), { ...cell, kind: "PATH", finish: "PAVERS" });
          }
        }
      }
      for (const task of nearbyTasks) if (task.accessKind === "PATH") {
        for (const cell of task.accessPath) publish(cell);
      }
      return [...paths.values()];
    })() : [...buildSurfaceMap({
      roads: new Map(surfaceRoads.map((road) => [cellKey(road), road])),
      cities: nearbyCities,
      districts: nearbyDistricts,
      tasks: nearbyTasks,
      features: nearbyFeatures,
      isSurfaceTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
    }).values()].filter((surface) => contains(chunkBounds, surface));

    const content: Omit<ChunkPayloadV2Dto, "contentHash"> = {
      payloadVersion: 2,
      generatorVersion: "square-v8",
      terrainSeed: seed,
      publishedVersion: worldVersion,
      lod,
      chunkX,
      chunkY,
      size: CHUNK_SIZE,
      roadRuns: compactRoadRuns([...roads].sort((left, right) => left.y - right.y || left.x - right.x)),
      surfaceRuns: compactSurfaceRuns([...surfaces].sort((left, right) => left.y - right.y || left.x - right.x)),
      districts: [...districts].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
        .map(({ cells, ...district }) => ({ ...district, cellRuns: compactCellRuns(cells) })),
      tasks: chunkTasks.map((task) => ({
        id: task.id, taskNumber: task.taskNumber, cityId: task.cityId, districtId: task.districtId, title: task.title,
        workItemType: task.workItemType,
        ...(lod === "DETAIL" && defectSummaryByTask.has(task.id) ? { defectSummary: defectSummaryByTask.get(task.id) } : {}),
        status: task.status, progress: task.progress, stage: task.stage,
        buildingType: task.buildingType, visualKind: task.visualKind, visualAssetKey: task.visualAssetKey,
        platformType: task.platformType, origin: task.origin, footprint: task.footprint, accessPath: task.accessPath,
      })),
      worldFeatures: [...worldFeatures].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      decorationContext: {
        cityBounds: nearbyCities.map((city) => city.bounds)
          .sort((left, right) => left.minY - right.minY || left.minX - right.minX || left.maxY - right.maxY || left.maxX - right.maxX),
        districts: nearbyDistricts.map((district) => ({
          id: district.id,
          status: district.status,
          archetype: district.archetype,
          cellRuns: compactCellRuns(district.cells.filter((cell) => contains(expandRect(chunkBounds, 1), cell))),
        })).filter((district) => district.cellRuns.length > 0)
          .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        tasks: lod === "DETAIL" ? nearbyTasks.map((task) => ({
          id: task.id,
          taskNumber: task.taskNumber,
          visualKind: task.visualKind,
          stage: task.stage,
          footprint: task.footprint,
          accessPath: task.accessPath,
        })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0) : [],
      },
    };
    const payload: ChunkPayloadV2Dto = { ...content, contentHash: chunkPayloadContentHash(content) };
    if ((this.knownWorldVersions.get(countryId) ?? worldVersion) !== worldVersion) throw new StaleChunkBuildError();
    if (!publish) return payload;
    if (!await this.publishChunkPayload(countryId, payload)) throw new StaleChunkBuildError();
    return this.storeChunk(cacheKey, payload);
  }

  chunkForCell(cell: Cell): { chunkX: number; chunkY: number } {
    return { chunkX: floorDiv(cell.x, CHUNK_SIZE), chunkY: floorDiv(cell.y, CHUNK_SIZE) };
  }

  async listEvents(countryId: string, afterId = 0): Promise<RealtimeEvent[]> {
    return (await this.db.prepare("SELECT * FROM events WHERE country_id = ? AND id > ? ORDER BY id LIMIT 500").all(countryId, afterId) as Row[]).map((row) => ({
      id: Number(row.id), countryId, type: String(row.type), worldVersion: Number(row.world_version), payload: json<Record<string, unknown>>(row.payload_json), createdAt: String(row.created_at),
    }));
  }
}
