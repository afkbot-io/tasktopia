import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILDING_CATALOG,
  PROP_CATALOG,
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
  type ArchiveRecordDto,
  type ArchiveRecordKind,
  type Cell,
  type ChunkDto,
  type ChunkTaskDto,
  type CityDto,
  type CityMorphology,
  type DistrictArchetype,
  type CountryDto,
  type DecorationDto,
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
import { config } from "./config";
import type { Db } from "./db";
import { now, onTransactionCommit, onTransactionRollback, transaction } from "./db";
import { listAccessibleCountries, registerUser, type AuthUser, type RegistrationInput } from "./auth";
import {
  GRID_DIRECTIONS,
  aStarPath,
  boundsOf,
  cellKey,
  contains,
  expandRect,
  floorDiv,
  intersects,
  manhattan,
  neighbors4,
  orthogonalPath,
  rectangleFootprint,
} from "./world/grid";
import { hashCoordinate, isBuildableTerrain, isWater, terrainAt } from "./world/terrain";
import { roadCorridorBlockers, stampRoadCorridor } from "./world/road-geometry";
import { pairedBusStopCandidates, type TransitRoadAxis } from "./world/transit";
import { greenAreaAccentCandidates, greenAreaAccentTarget, greenAreaSizeCandidates } from "./green-area-planner";
import { greenAreaDevelopmentStage, greenAreaPathCells } from "../shared/green-area";
import type { CountryAtlasDto } from "../shared/country-atlas-contract";
import { compactLotsAfterPlacement, organicComplexLotTarget, planComplex } from "./world/complex-planner";
import { projectCountryAtlas } from "./world/country-atlas";
import {
  ROAD_WIDTH,
  archetypeAffinity,
  buildingZoningRole,
  buildSurfaceMap,
  buildingApronCells,
  buildingGapPaths,
  chooseDistrictArchetype,
  cityMorphology,
  entranceOutside,
  findAreaAccessPath,
  findAccessPlan,
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
const ARCHIVE_COMPOUND = { width: 18, height: 12 } as const;
const ARCHIVE_CITY_CLEARANCE = 24;

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
const ARCHIVE_BUILDINGS = [
  { assetKey: "state-archive-core", offset: { x: 5, y: 6 }, width: 8, height: 5 },
  { assetKey: "state-archive-wing", offset: { x: 0, y: 1 }, width: 8, height: 4 },
  { assetKey: "state-archive-vault", offset: { x: 10, y: 1 }, width: 7, height: 5 },
  { assetKey: "state-archive-tower", offset: { x: 10, y: 6 }, width: 7, height: 5 },
] as const;

type Row = Record<string, unknown>;
type GrowthDirection = DistrictDto["growthDirection"];

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

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

export function complexMinimumRect(entry: BuildingCatalogEntry, targetLots: number): { width: number; height: number } {
  if (!entry.tags.includes("new-build")) {
    return { width: Math.max(14, entry.footprint.width + 6), height: Math.max(12, entry.footprint.height + 6) };
  }
  // A three/four-lot retry is a genuine point complex: one frontage row plus
  // the street and its margins. Keeping the two-tier dimensions here made the
  // documented 10 → 6 → 3 retry sequence retry the same oversized rectangle.
  if (targetLots <= 4) {
    return { width: Math.max(14, entry.footprint.width + 8), height: Math.max(12, entry.footprint.height + 7) };
  }
  return {
    width: Math.max(14, Math.min(44, entry.footprint.width * 2 + 8)),
    height: Math.max(12, Math.min(34, entry.footprint.height * 2 + 9)),
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

/** Temporary construction fencing occupies one cell beyond unfinished work. */
function taskOccupiedCells(task: TaskDto): Cell[] {
  if (task.stage >= 5 || task.footprint.length === 0) return task.footprint;
  const bounds = expandRect(boundsOf(task.footprint), 1);
  return rectangleFootprint(
    { x: bounds.minX, y: bounds.minY },
    bounds.maxX - bounds.minX + 1,
    bounds.maxY - bounds.minY + 1,
  );
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

export class AppService {
  private readonly roadCache = new Map<string, Map<string, RoadCellDto>>();
  private readonly surfaceCache = new Map<string, Map<string, SurfaceCellDto>>();
  private readonly chunkCache = new Map<string, ChunkDto>();
  private readonly pendingChunkBuilds = new Map<string, Promise<ChunkDto>>();
  private readonly knownWorldVersions = new Map<string, number>();
  private readonly countryAtlasCache = new Map<string, { worldVersion: number; atlas: CountryAtlasDto }>();
  // A desktop viewport can hold a few dozen chunks in two LODs. Keeping only
  // 64 entries caused one user's zoom to evict the previous level and denied
  // concurrent viewers any cache reuse. 512 remains a small bounded footprint
  // while covering several active viewports.
  private static readonly CHUNK_CACHE_LIMIT = 512;

  constructor(
    private readonly db: Db,
    private readonly onEvent?: (event: RealtimeEvent) => void,
    private readonly uploadDir: string = config.uploadDir,
  ) {}

  async onboardUser(input: RegistrationInput): Promise<Awaited<ReturnType<typeof registerUser>>> {
    return transaction(this.db, async () => {
      const registered = await registerUser(this.db, input);
      if (input.cityName) {
        await this.createCity(registered.user.countryId, {
          name: input.cityName,
          idempotencyKey: `onboarding:${registered.user.id}`,
        });
      }
      return registered;
    });
  }

  private cachedChunk(key: string, worldVersion: number): ChunkDto | undefined {
    const cached = this.chunkCache.get(key);
    if (!cached) return undefined;
    // Refresh insertion order so the bounded map behaves as an LRU. World
    // version is response metadata; geometry is invalidated separately using
    // affected bounds and can be reused across unrelated task events.
    this.chunkCache.delete(key);
    this.chunkCache.set(key, cached);
    return { ...cached, worldVersion };
  }

  private storeChunk(key: string, chunk: ChunkDto): ChunkDto {
    this.chunkCache.set(key, chunk);
    while (this.chunkCache.size > AppService.CHUNK_CACHE_LIMIT) {
      const oldest = this.chunkCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.chunkCache.delete(oldest);
    }
    return chunk;
  }

  private invalidateChunkCache(countryId: string, event: RealtimeEvent): void {
    if (event.type === "task.comment_added" || event.type === "task.assignee_changed" || event.type === "country.profile_updated") return;
    const candidate = event.payload.affectedBounds as Partial<Rect> | undefined;
    const hasBounds = candidate
      && [candidate.minX, candidate.minY, candidate.maxX, candidate.maxY].every(Number.isFinite);
    // Road and district generation can touch connectors beyond the published
    // entity envelope, so structural mutations conservatively clear this
    // country's bounded cache. Metadata, status and defect changes only alter
    // entities inside their published envelope and stay chunk-local.
    const boundedMutation = new Set([
      "task.status_changed", "task.fields_updated", "task.defect_created", "task.defect_updated",
      "city.updated", "district.updated",
    ]).has(event.type);
    if (!boundedMutation || !hasBounds) {
      for (const key of this.chunkCache.keys()) if (key.startsWith(`${countryId}:`)) this.chunkCache.delete(key);
      return;
    }
    const bounds = candidate as Rect;
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

  private async countryRow(countryId: string): Promise<Row> {
    const row = await this.db.prepare("SELECT * FROM countries WHERE id = ?").get(countryId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Страна не найдена");
    return row;
  }

  private async createEvent(countryId: string, type: string, payload: Record<string, unknown>): Promise<RealtimeEvent> {
    await this.db.prepare("UPDATE countries SET world_version = world_version + 1 WHERE id = ?").run(countryId);
    const country = await this.countryRow(countryId);
    const createdAt = now();
    const version = Number(country.world_version);
    const result = await this.db.prepare("INSERT INTO events (country_id, type, world_version, payload_json, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
                      .run(countryId, type, version, JSON.stringify(payload), createdAt);
    return { id: Number(result.rows[0]?.id), countryId, type, worldVersion: version, payload, createdAt };
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
        this.knownWorldVersions.set(countryId, Math.max(committedEvent.worldVersion, this.knownWorldVersions.get(countryId) ?? 0));
        this.invalidateChunkCache(countryId, committedEvent);
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
      (SELECT COUNT(*) FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? AND t.status <> 'COMPLETED') AS unfinished_buildings`)
                      .get(user.countryId, user.countryId, user.countryId, user.countryId, user.countryId) as Row;
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
    return {
      user: { id: user.id, email: user.email, name: user.name },
      country: await this.getCountry(user.countryId),
      countries: await Promise.all((await listAccessibleCountries(this.db, user.id)).map(async (access) => ({
                                ...await this.getCountry(access.id), role: access.role, memberCount: access.memberCount,
                              }))),
      countryRole: user.countryRole,
      archive: await this.getArchive(user.countryId),
      initialCity: initialCityRow ? cityDto(initialCityRow) : null,
      viewBounds,
      stats: {
        cities: Number(stats.cities), districts: Number(stats.districts), tasks: Number(stats.tasks),
        activeDistricts: Number(stats.active_districts), unfinishedBuildings: Number(stats.unfinished_buildings),
      },
      chunkSize: CHUNK_SIZE,
      assetVersion: 4,
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
          for (const task of tasksByDistrict.get(district.id) ?? []) {
            const generatedTask = await generator.createTask(temporaryCountryId, {
              cityId: generated.id, districtId: generatedDistrict.id, title: task.title,
              description: task.description, workItemType: task.workItemType, acceptanceCriteria: task.acceptanceCriteria,
              systemAnalysis: task.systemAnalysis, architecture: task.architecture, designSystem: task.designSystem,
              implementationPlan: task.implementationPlan, estimate: task.estimate, priority: task.priority,
              dueAt: task.dueAt ?? undefined,
              visualKind: task.visualKind,
              parkVariant: task.visualKind === "PARK" ? task.visualAssetKey : undefined,
              idempotencyKey: `regenerate-task:${task.id}`,
            });
            taskMap.set(task.id, generatedTask.id);
          }
        }
      }

      const generatedCities = new Map((await generator.listCities(temporaryCountryId)).map((city) => [city.id, city]));
      const generatedDistricts = new Map((await generator.listDistricts(temporaryCountryId)).map((district) => [district.id, district]));
      const generatedTasks = new Map((await generator.listTasks(temporaryCountryId)).map((task) => [task.id, task]));
      const reverseTaskMap = new Map([...taskMap].map(([original, generated]) => [generated, original]));
      const originalCityByGenerated = new Map([...cityMap].map(([original, generated]) => [generated, original]));
      const originalDistrictByGenerated = new Map([...districtMap].map(([original, generated]) => [generated, original]));
      for (const city of cities) {
        const generated = generatedCities.get(cityMap.get(city.id)!);
        if (!generated) throw new DomainError("REGENERATION_FAILED", "Не удалось восстановить геометрию города");
        await this.db.prepare(`UPDATE cities_v3 SET center_x = ?, center_y = ?, bounds_json = ?, style_id = ? WHERE id = ?`)
          .run(generated.center.x, generated.center.y, JSON.stringify(generated.bounds), generated.styleId, city.id);
      }
      for (const district of districts.filter((item) => item.status !== "ABANDONED")) {
        const generated = generatedDistricts.get(districtMap.get(district.id)!);
        if (!generated) throw new DomainError("REGENERATION_FAILED", "Не удалось восстановить геометрию района");
        const lots = generated.lots.map((lot) => ({ ...lot, taskId: lot.taskId ? reverseTaskMap.get(lot.taskId) ?? null : null }));
        await this.db.prepare(`UPDATE districts_v3 SET cells_json = ?, lots_json = ?, growth_direction = ?, color = ? WHERE id = ?`)
          .run(JSON.stringify(generated.cells), JSON.stringify(lots), generated.growthDirection, generated.color, district.id);
      }
      for (const task of tasks) {
        const generated = generatedTasks.get(taskMap.get(task.id)!);
        if (!generated) throw new DomainError("REGENERATION_FAILED", "Не удалось восстановить геометрию задачи");
        // Geometry AND identity come from the fresh build: the replay picks
        // buildings under the new seed, so the visible model must follow the
        // re-pick instead of freezing the pre-regeneration type.
        await this.db.prepare(`UPDATE tasks_v3 SET building_type = ?, visual_kind = ?, visual_asset_key = ?, platform_type = ?, origin_x = ?, origin_y = ?, footprint_json = ?,
          entrance_x = ?, entrance_y = ?, access_json = ?, access_kind = ? WHERE id = ?`).run(
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

  async listDistricts(countryId: string, cityId?: string): Promise<DistrictDto[]> {
    const rows = cityId
      ? await this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE c.country_id = ? AND d.city_id = ? ORDER BY d.created_at").all(countryId, cityId)
      : await this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE c.country_id = ? ORDER BY d.created_at").all(countryId);
    return (rows as Row[]).map(districtDto);
  }

  async getCountryAtlas(countryId: string): Promise<CountryAtlasDto> {
    const countrySnapshot = await this.getCountry(countryId);
    const cached = this.countryAtlasCache.get(countryId);
    if (cached?.worldVersion === countrySnapshot.worldVersion) return cached.atlas;
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
    for (const district of districts) {
      districtsByCity.set(district.cityId, [...districtsByCity.get(district.cityId) ?? [], district]);
    }
    for (const task of tasks) tasksByCity.set(task.cityId, [...tasksByCity.get(task.cityId) ?? [], task]);

    const projection = projectCountryAtlas({
      terrainSampler: (cell) => terrainAt(Number(countryRow.seed), cell.x, cell.y),
      cities: cities.map((city) => ({
        id: city.id,
        sourceCenter: city.center,
        sourceVisualSizePx: {
          width: (city.bounds.maxX - city.bounds.minX + 1) * 8,
          height: (city.bounds.maxY - city.bounds.minY + 1) * 8,
        },
        labelSizePx: { width: Math.max(208, city.name.length * 12 + 56), height: 48 },
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

    const atlas: CountryAtlasDto = {
      schemaVersion: 2,
      worldVersion: country.worldVersion,
      bounds: projection.bounds,
      macroTerrain: projection.macroTerrain,
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
        const cityDistrictIds = new Set((districtsByCity.get(city.id) ?? []).map((district) => district.id));
        return {
          id: city.id,
          name: city.name,
          status: city.status,
          sourceCenter: city.center,
          sourceBounds: city.bounds,
          atlasCenter: projected.atlasCenter,
          atlasBounds: projected.atlasBounds,
          labelBounds: projected.labelBounds,
          scale: projected.scale,
          miniatureSizePx: projected.miniatureSizePx,
          atlasMask: projected.atlasMask,
          cutoutMask: projected.cutoutMask,
          cutoutTerrain: projected.cutoutTerrain,
          districts: projected.districts.map((district) => {
            const source = districtById.get(district.id)!;
            return {
              id: source.id,
              name: source.name,
              status: source.status,
              color: atlasDistrictColorById.get(source.id) ?? source.color,
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
          roads: [...roadMap.values()].flatMap((road) => {
            const districtId = districtOwnerByCell.get(cellKey(road));
            if (!districtId || !cityDistrictIds.has(districtId)) return [];
            return [{
              sourceCell: { x: road.x, y: road.y },
              atlasCell: projectCell(road, districtId),
              structure: road.structure,
              roadClass: road.roadClass,
            }];
          }),
          surfaces: [...surfaceMap.values()].flatMap((surface) => {
            const districtId = districtOwnerByCell.get(cellKey(surface));
            if (!districtId || !cityDistrictIds.has(districtId)) return [];
            return [{
              sourceCell: { x: surface.x, y: surface.y },
              atlasCell: projectCell(surface, districtId),
              kind: surface.kind,
              ...(surface.orientation ? { orientation: surface.orientation } : {}),
              ...(surface.finish ? { finish: surface.finish } : {}),
            }];
          }),
          features: features.filter((feature) => feature.cityId === city.id).map((feature) => ({
            id: feature.id,
            districtId: feature.districtId,
            assetKind: feature.assetKind,
            assetKey: feature.assetKey,
            developmentStage: feature.developmentStage,
            sourceOrigin: feature.origin,
            atlasOrigin: projectCell(feature.origin, feature.districtId ?? ""),
            atlasFootprint: projectFootprint(feature.footprint, feature.districtId ?? ""),
          })),
        };
      }),
    };
    this.countryAtlasCache.set(countryId, { worldVersion: country.worldVersion, atlas });
    return atlas;
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
    const rows = await this.db.prepare(`SELECT DISTINCT d.* FROM world_chunk_entities_v11 chunk
      JOIN districts_v3 d ON d.id = chunk.entity_id
      WHERE chunk.country_id = ? AND chunk.entity_kind = 'DISTRICT'
        AND chunk.chunk_x BETWEEN ? AND ? AND chunk.chunk_y BETWEEN ? AND ?
      ORDER BY d.created_at`).all(
                      countryId, floorDiv(bounds.minX, CHUNK_SIZE), floorDiv(bounds.maxX, CHUNK_SIZE),
                      floorDiv(bounds.minY, CHUNK_SIZE), floorDiv(bounds.maxY, CHUNK_SIZE),
                    ) as Row[];
    return rows.map(districtDto).filter((district) => district.cells.some((cell) => contains(bounds, cell)));
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
          city.name AS city_name, district.name AS district_name
          FROM tasks_v3 t JOIN cities_v3 city ON city.id = t.city_id JOIN districts_v3 district ON district.id = t.district_id
          WHERE city.country_id = ? AND t.task_number = ?`).all(countryId, Number(text)) as Row[]
      : await this.db.prepare(`SELECT t.id, t.task_number, t.title, t.work_item_type, t.status, t.progress, t.city_id, t.district_id, t.origin_x, t.origin_y,
          city.name AS city_name, district.name AS district_name
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

  private async nextCityCenter(countryId: string, seed: number): Promise<Cell> {
    const cities = await this.listCities(countryId);
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
    const cached = this.roadCache.get(countryId);
    if (cached) return cached;
    const rows = await this.db.prepare("SELECT x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ?").all(countryId) as Row[];
    const roads = new Map(rows.map((row) => {
      const cell: RoadCellDto = { x: Number(row.x), y: Number(row.y), mask: Number(row.mask), structure: String(row.structure) as RoadCellDto["structure"], roadClass: String(row.road_class) as RoadCellDto["roadClass"] };
      return [cellKey(cell), cell];
    }));
    this.roadCache.set(countryId, roads);
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

  private async normalizeUrbanHighways(countryId: string, bounds: Rect): Promise<void> {
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
      this.roadCache.delete(countryId);
      this.surfaceCache.delete(countryId);
    }
  }

  private async surfaceCells(countryId: string, roadsInput?: Map<string, RoadCellDto>): Promise<Map<string, SurfaceCellDto>> {
    const roads = roadsInput ?? await this.roadCells(countryId);
    const canonicalRoads = await this.roadCells(countryId);
    const canCache = roads === canonicalRoads;
    const cached = canCache ? this.surfaceCache.get(countryId) : undefined;
    if (cached) return cached;
    const seed = Number((await this.countryRow(countryId)).seed);
    const result = buildSurfaceMap({
              roads,
              cities: await this.listCities(countryId),
              districts: await this.listDistricts(countryId),
              tasks: await this.listTasks(countryId),
              features: await this.listWorldFeatures(countryId),
              isSurfaceTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
            });
    if (canCache) this.surfaceCache.set(countryId, result);
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
  ): Promise<Map<string, SurfaceCellDto>> {
    const roads = roadsInput ?? await this.roadCells(countryId);
    const padded = expandRect(scope, 8);
    const localRoads = new Map([...roads].filter(([, road]) => contains(padded, road)));
    const overrides = new Map(districtOverrides.map((district) => [district.id, district]));
    const districts = (await this.listDistricts(countryId))
              .map((district) => overrides.get(district.id) ?? district)
              .filter((district) => district.cells.some((cell) => contains(padded, cell)));
    for (const district of districtOverrides) {
      if (!districts.some((candidate) => candidate.id === district.id) && district.cells.some((cell) => contains(padded, cell))) districts.push(district);
    }
    const tasks = (await this.listTasks(countryId)).filter((task) =>
              contains(padded, task.entrance)
              || task.footprint.some((cell) => contains(padded, cell))
              || task.accessPath.some((cell) => contains(padded, cell)),
            );
    const features = (await this.listWorldFeatures(countryId)).filter((feature) =>
              feature.footprint.some((cell) => contains(padded, cell))
              || feature.accessPath.some((cell) => contains(padded, cell)),
            );
    const seed = Number((await this.countryRow(countryId)).seed);
    return buildSurfaceMap({
              roads: localRoads,
              cities: (await this.listCities(countryId)).filter((city) => intersects(city.bounds, padded)),
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
    end: Cell,
    avoidBounds: Rect[] = [],
    extraReserved: Cell[] = [],
    reservationRadius = 1,
    reuseUrbanRoads = false,
  ): Promise<Cell[]> {
    const roads = await this.roadCells(countryId);
    const sealed = await this.completedDistrictCells(countryId);
    const reservedFootprints = [
      ...(await this.listTasks(countryId)).flatMap((task) => [...taskOccupiedCells(task), task.entrance, ...task.accessPath]),
      ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
      ...(await this.listDistricts(countryId)).flatMap((district) => district.lots.flatMap((lot) => [
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
    const protectedBounds = avoidBounds.filter((bounds) => !contains(bounds, start) && !contains(bounds, end));
    const costAt = (cell: Cell): number => {
              const isEndpoint = cell.x === start.x && cell.y === start.y || cell.x === end.x && cell.y === end.y;
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
    let path = aStarPath(start, end, costAt, 160, 1.4, false);
    if (path.length === 0 && (avoidBounds.length > 1 || reservationRadius >= 3)) {
      path = aStarPath(start, end, costAt, 240, 1.4, false);
    }
    if (path.length === 0) throw new DomainError(
      "ROUTE_BLOCKED",
      `Не удалось проложить дорогу без пересечения существующих зданий (${start.x},${start.y} → ${end.x},${end.y})`,
    );
    return path;
  }

  private roadCorridor(path: Cell[], roadClass: RoadCellDto["roadClass"]): Cell[] {
    return stampRoadCorridor(path, roadClass, ROAD_WIDTH);
  }

  private async addRoadPath(countryId: string, seed: number, path: Cell[], roadClass: RoadCellDto["roadClass"]): Promise<void> {
    const roads = await this.roadCells(countryId);
    const sealed = await this.completedDistrictCells(countryId);
    const committedFootprints = new Set([
      ...(await this.listTasks(countryId)).flatMap((task) => [...taskOccupiedCells(task), task.entrance, ...task.accessPath]),
      ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
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
    const upsert = this.db.prepare("INSERT INTO roads_v3 (country_id, x, y, mask, structure, road_class) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(country_id, x, y) DO UPDATE SET structure = excluded.structure, road_class = excluded.road_class");
    const writes: Array<Promise<unknown>> = [];
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
      writes.push(upsert.run(countryId, cell.x, cell.y, updated.mask, structure, selectedClass));
    }
    await Promise.all(writes);
    await this.recalculateRoadMasks(countryId, corridor);
    // A road corridor redevelops any ruin plot it crosses.
    await this.clearRuins(countryId, corridor);
    this.surfaceCache.delete(countryId);
  }

  private async recalculateRoadMasks(countryId: string, affected?: Iterable<Cell>): Promise<void> {
    const roads = await this.roadCells(countryId);
    const update = this.db.prepare("UPDATE roads_v3 SET mask = ? WHERE country_id = ? AND x = ? AND y = ?");
    const targets = affected
      ? new Map([...affected].flatMap((cell) => [cell, ...neighbors4(cell)]).map((cell) => [cellKey(cell), cell])).values()
      : roads.values();
    const writes: Array<Promise<unknown>> = [];
    for (const target of targets) {
      const road = roads.get(cellKey(target));
      if (!road) continue;
      let mask = 0;
      for (const direction of GRID_DIRECTIONS) {
        if (roads.has(cellKey({ x: road.x + direction.x, y: road.y + direction.y }))) mask |= direction.bit;
      }
      road.mask = mask;
      writes.push(update.run(mask, countryId, road.x, road.y));
    }
    await Promise.all(writes);
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

  private async highwayAnchors(countryId: string, target: Cell, cities: CityDto[]): Promise<Cell[]> {
    const highways = [...(await this.roadCells(countryId)).values()].filter((road) => road.roadClass === "HIGHWAY");
    const originalCities = cities.map((city) => rectForCenter(city.center));
    const districtEnvelopes = (await this.listDistricts(countryId)).filter((district) => district.cells.length > 0).map((district) => expandRect(boundsOf(district.cells), 3));
    const featureEnvelopes = (await this.listWorldFeatures(countryId))
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
    return [...candidates].sort((left, right) => manhattan(left, target) - manhattan(right, target));
  }

  private async roadNetworkAnchors(countryId: string, target: Cell, cities: CityDto[]): Promise<Cell[]> {
    const roads = [...(await this.roadCells(countryId)).values()];
    const urban = cities.map((city) => rectForCenter(city.center));
    const featureEnvelopes = (await this.listWorldFeatures(countryId))
      .filter((feature) => feature.assetKind === "AREA" || feature.kind === "COUNTRY_ARCHIVE")
      .map((feature) => expandRect(boundsOf([...feature.footprint, ...feature.accessPath]), 4));
    const rural = roads.filter((road) => !urban.some((bounds) => contains(bounds, road))
      && !featureEnvelopes.some((bounds) => contains(bounds, road)));
    const safe = roads.filter((road) => !featureEnvelopes.some((bounds) => contains(bounds, road)));
    const candidates = rural.length > 0 ? rural : safe.length > 0 ? safe : roads;
    return [...candidates].sort((left, right) => manhattan(left, target) - manhattan(right, target));
  }

  private async featurePlacementOpen(countryId: string, seed: number, footprint: Cell[], avoidBounds: Rect[] = []): Promise<boolean> {
    const roads = await this.roadCells(countryId);
    const occupied = new Set([
      ...(await this.listTasks(countryId)).flatMap(taskOccupiedCells).map(cellKey),
      ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint).map(cellKey),
    ]);
    return footprint.every((cell) => !roads.has(cellKey(cell))
      && !occupied.has(cellKey(cell))
      && !avoidBounds.some((bounds) => contains(bounds, cell))
      && isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain));
  }

  private async insertWorldFeature(
    countryId: string,
    input: Omit<WorldFeatureDto, "id" | "developmentStage"> & Partial<Pick<WorldFeatureDto, "developmentStage">>,
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
    return { id, ...input, developmentStage };
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
    archetype: DistrictArchetype,
    districtIndex: number,
    reservedLots: PlannedLotDto[] = [],
  ): Promise<PlannedLotDto[]> {
    const existingFeatures = await this.listWorldFeatures(countryId);
    const existingGreen = existingFeatures.filter((feature) => feature.cityId === city.id && (feature.kind === "PARK" || feature.kind === "GROVE"));
    const districtGreen = existingGreen.filter((feature) => feature.districtId === districtId);
    // One green area per district is the norm, a second appears rarely, and
    // a third never. The old roll was constant for the whole district, so
    // every new complex of a lucky district spawned another park and they
    // clustered into one pocket.
    if (districtGreen.length >= 2) return reservedLots;
    const chance = archetype === "PRIVATE" ? 0.58 : archetype === "CIVIC" ? 0.48 : archetype === "COMMERCIAL" ? 0.24 : 0.4;
    const roll = hashCoordinate(seed, city.center.x, city.center.y, 811 + districtIndex * 7 + districtGreen.length * 13 + Math.floor(reservedLots.length / 4));
    // Every city must eventually receive a public green area. Keep trying on
    // subsequent districts until one actually fits; the old `districtIndex ===
    // 1` gate permanently skipped parks when that single district had no valid
    // parcel.
    const forceFirstGreen = existingGreen.length === 0;
    if (!forceFirstGreen && (districtGreen.length >= 1 ? roll > 0.18 : roll > chance)) return reservedLots;

    const cityIndex = (await this.listCities(countryId)).findIndex((candidate) => candidate.id === city.id);
    // Unnumbered ambient greenery is always a grove. A PARK is a task-owned
    // visual kind created through task.create, so it has one lifecycle, task
    // number, card, defects and deletion semantics instead of a shadow feature.
    const kind: Extract<WorldFeatureDto["kind"], "GROVE"> = "GROVE";
    const assetKey: string = "urban-grove";
    const allowed = new Set(districtCells.map(cellKey));
    const roads = await this.roadCells(countryId);
    const bounds = boundsOf(districtCells);
    const surfaces = await this.localSurfaceCells(countryId, bounds, roads);
    // The city's first public green area has priority over speculative empty
    // pads. Occupied buildings and demolition plots remain hard reservations;
    // intersecting virtual alternatives are retired after a site is selected.
    const hardReservedLots = forceFirstGreen
      ? reservedLots.filter((lot) => lot.taskId || lot.vacant)
      : reservedLots;
    const occupied = new Set([
      ...(await this.listTasks(countryId)).flatMap(taskOccupiedCells),
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
    let compactFallback: GreenCandidate | undefined;
    const minimumRetainedLots = Math.min(3, reservedLots.length);
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
      selected = forceFirstGreen
        ? ranked.find((candidate) => candidate.retainedLotCount >= minimumRetainedLots)
        : ranked[0];
      if (selected) break;
    }
    selected ??= compactFallback;
    if (!selected) return reservedLots;
    const greenReservation = new Set([...selected.footprint, ...selected.accessPath].map(cellKey));
    const retainedLots = forceFirstGreen
      ? reservedLots.filter((lot) => lot.taskId || lot.vacant || ![
        ...rectangleFootprint(lot.origin, lot.width, lot.height),
        ...(lot.sharedAccess ?? []),
      ].some((cell) => greenReservation.has(cellKey(cell))))
      : reservedLots;
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
    await this.clearRuins(countryId, selected.footprint);

    const lampByArchetype: Record<DistrictArchetype, string> = {
      PRIVATE: "streetlamp-vintage", NEW_BUILD: "streetlamp-modern", MIXED_URBAN: "streetlamp-double",
      CIVIC: "streetlamp-solar", COMMERCIAL: "streetlamp-industrial",
    };
    const treeVariants = ["tree-birch", "tree-pine", "tree-willow", "tree-oak", "tree-apple", "tree-cherry", "tree-maple", "tree-cedar", "tree-cypress", "tree-aspen", "tree-magnolia", "tree-redwood", "tree-round", "tree-conifer"] as const;
    const primaryTree = treeVariants[(cityIndex + districtIndex) % treeVariants.length]!;
    const secondaryTree = treeVariants[(cityIndex + districtIndex + 3) % treeVariants.length]!;
    type DecorPlacement = readonly [assetKey: string, offsetX: number, offsetY: number, width: number, height: number];
    const decorByArea: Record<string, readonly (readonly DecorPlacement[])[]> = {
      "urban-formal": [
        [["fountain-large", 7, 3, 4, 4], ["park-bench-double", 3, 4, 3, 1], ["park-bench-double", 12, 5, 3, 1], ["flower-bed-horizontal", 2, 2, 2, 1], ["flower-bed-horizontal", 14, 2, 2, 1], ["flower-bed-horizontal", 2, 7, 2, 1], ["flower-bed-horizontal", 14, 7, 2, 1], [primaryTree, 1, 1, 1, 1], [secondaryTree, 16, 1, 1, 1], [secondaryTree, 1, 8, 1, 1], [primaryTree, 16, 8, 1, 1], [lampByArchetype[archetype], 6, 1, 1, 1], [lampByArchetype[archetype], 11, 8, 1, 1]],
        [["park-sculpture", 8, 3, 2, 3], ["park-flower-clock", 2, 4, 3, 2], ["park-flower-clock", 13, 4, 3, 2], ["flower-bed-vertical", 5, 1, 1, 2], ["flower-bed-vertical", 12, 7, 1, 2], [primaryTree, 1, 1, 1, 1], [secondaryTree, 16, 1, 1, 1], [secondaryTree, 1, 8, 1, 1], [primaryTree, 16, 8, 1, 1], ["park-bench-double", 3, 5, 3, 1], ["park-bench-double", 12, 4, 3, 1], [lampByArchetype[archetype], 7, 1, 1, 1], [lampByArchetype[archetype], 10, 8, 1, 1]],
      ],
      "urban-community": [
        [["playground-carousel", 2, 2, 3, 3], ["park-pond", 9, 2, 4, 3], ["park-bench-double", 6, 7, 3, 1], [primaryTree, 1, 1, 1, 1], [secondaryTree, 14, 8, 1, 1], [lampByArchetype[archetype], 7, 2, 1, 1]],
        [["park-bandstand", 6, 2, 4, 3], ["playground-swing", 1, 5, 3, 3], ["picnic-table", 12, 5, 2, 2], [primaryTree, 1, 1, 1, 1], [secondaryTree, 14, 1, 1, 1], ["trash-bin", 10, 7, 1, 1]],
      ],
      "urban-central": [
        [["fountain-large", 2, 1, 4, 4], ["park-bench-double", 0, 5, 3, 1], ["park-sculpture", 6, 3, 2, 3], [lampByArchetype[archetype], 7, 6, 1, 1], [primaryTree, 0, 0, 1, 1]],
        [["park-bandstand", 2, 1, 4, 3], ["park-flower-clock", 0, 4, 3, 2], ["park-sculpture", 6, 3, 2, 3], ["park-bench-double", 3, 5, 3, 1], [secondaryTree, 7, 0, 1, 1]],
        [["fountain-large", 0, 1, 4, 4], ["park-bandstand", 4, 0, 4, 3], ["park-flower-clock", 4, 4, 3, 2], [lampByArchetype[archetype], 7, 6, 1, 1], [primaryTree, 0, 0, 1, 1]],
      ],
      "urban-botanical": [
        [["park-pond", 0, 0, 4, 3], ["gazebo", 3, 3, 4, 3], ["topiary-spiral", 1, 4, 1, 1], [secondaryTree, 6, 0, 1, 1], [lampByArchetype[archetype], 0, 4, 1, 1]],
        [["park-pond", 3, 0, 4, 3], ["park-bandstand", 0, 3, 4, 3], ["park-flower-clock", 4, 4, 3, 2], [primaryTree, 0, 0, 1, 1]],
        [["gazebo", 0, 0, 4, 3], ["park-flower-clock", 4, 0, 3, 2], ["park-sculpture", 5, 2, 2, 3], ["park-pond", 0, 3, 4, 3], [secondaryTree, 4, 5, 1, 1]],
      ],
      "urban-amusement": [
        [["playground-carousel", 0, 0, 3, 3], ["playground-slide", 4, 0, 3, 2], ["playground-climbing", 4, 2, 3, 3], [lampByArchetype[archetype], 3, 3, 1, 1]],
        [["playground-small", 0, 0, 3, 2], ["playground-swing", 4, 0, 3, 3], ["playground-carousel", 0, 2, 3, 3], ["trash-bin", 6, 4, 1, 1]],
        [["playground-slide", 0, 0, 3, 2], ["playground-climbing", 0, 2, 3, 3], ["playground-small", 4, 0, 3, 2], ["playground-swing", 4, 2, 3, 3], [lampByArchetype[archetype], 3, 3, 1, 1]],
      ],
      "urban-park": [
        [["playground-small", 0, 0, 3, 2], ["park-bench-double", 1, 3, 3, 1], [primaryTree, 4, 0, 1, 1], [lampByArchetype[archetype], 4, 2, 1, 1], ["trash-bin", 0, 3, 1, 1]],
        [["playground-carousel", 0, 0, 3, 3], ["park-bench-double", 2, 3, 3, 1], [secondaryTree, 4, 0, 1, 1], [lampByArchetype[archetype], 4, 2, 1, 1], ["trash-bin", 0, 3, 1, 1]],
        [["playground-swing", 0, 0, 3, 3], ["park-bench-double", 2, 3, 3, 1], [primaryTree, 4, 0, 1, 1], [lampByArchetype[archetype], 4, 2, 1, 1], ["trash-bin", 0, 3, 1, 1]],
      ],
      "urban-grove": [
        [["gazebo", 1, 1, 4, 3], [primaryTree, 0, 0, 1, 1], ["tree-pine", 5, 0, 1, 1], [secondaryTree, 5, 3, 1, 1], ["park-bench-double", 0, 4, 3, 1], [lampByArchetype[archetype], 4, 4, 1, 1]],
        [["park-pond", 0, 0, 4, 3], ["picnic-table", 4, 0, 2, 2], [primaryTree, 0, 4, 1, 1], [secondaryTree, 5, 4, 1, 1], [lampByArchetype[archetype], 4, 3, 1, 1], ["trash-bin", 5, 3, 1, 1]],
        [["park-bandstand", 2, 0, 4, 3], ["park-flower-clock", 0, 3, 3, 2], [primaryTree, 0, 0, 1, 1], [secondaryTree, 5, 3, 1, 1], [lampByArchetype[archetype], 4, 4, 1, 1]],
      ],
    };
    const variants = decorByArea[assetKey] ?? decorByArea["urban-park"]!;
    const decor = variants[Math.floor(hashCoordinate(seed, selected.origin.x, selected.origin.y, 829) * variants.length)] ?? variants[0]!;
    const legacyLayoutSize: Readonly<Record<string, readonly [number, number]>> = {
      "urban-formal": [18, 10], "urban-community": [16, 10],
      "urban-central": [8, 7], "urban-botanical": [7, 6], "urban-amusement": [7, 5], "urban-grove": [6, 5], "urban-park": [5, 4],
    };
    const [layoutWidth, layoutHeight] = legacyLayoutSize[assetKey] ?? legacyLayoutSize["urban-park"]!;
    const shiftX = Math.floor((selected.size[0] - layoutWidth) / 2);
    const shiftY = Math.floor((selected.size[1] - layoutHeight) / 2);
    const occupiedDecor = new Set<string>();
    for (const [assetKey, offsetX, offsetY, width, height] of decor) {
      const origin = { x: selected.origin.x + shiftX + offsetX, y: selected.origin.y + shiftY + offsetY };
      const footprint = rectangleFootprint(origin, width, height);
      if (!footprint.every((cell) => selected.footprint.some((areaCell) => cellKey(areaCell) === cellKey(cell)))) continue;
      for (const cell of footprint) occupiedDecor.add(cellKey(cell));
      await this.insertWorldFeature(countryId, {
                                        cityId: city.id, districtId, parentFeatureId: area.id, kind: "PARK_DECOR", assetKind: "PROP", assetKey,
                                        origin, footprint, orientation: "S", accessPath: [],
                                      });
    }
    const edgeAccents = greenAreaAccentCandidates(selected.size[0], selected.size[1], assetKey)
      .sort((left, right) => hashCoordinate(seed, selected.origin.x + left.x, selected.origin.y + left.y, 839)
        - hashCoordinate(seed, selected.origin.x + right.x, selected.origin.y + right.y, 839));
    const accentTarget = greenAreaAccentTarget(selected.size[0], selected.size[1]);
    let accentIndex = 0;
    for (const offset of edgeAccents) {
      if (accentIndex >= accentTarget) break;
      const origin = { x: selected.origin.x + offset.x, y: selected.origin.y + offset.y };
      if (occupiedDecor.has(cellKey(origin))) continue;
      const formalAccents = [primaryTree, "flower-red", secondaryTree, "shrub-flowering", lampByArchetype[archetype]] as const;
      const accentKey = assetKey === "urban-formal"
        ? formalAccents[accentIndex % formalAccents.length]!
        : accentIndex % 3 === 2 ? lampByArchetype[archetype] : accentIndex % 2 === 0 ? primaryTree : secondaryTree;
      await this.insertWorldFeature(countryId, {
        cityId: city.id, districtId, parentFeatureId: area.id, kind: "PARK_DECOR", assetKind: "PROP", assetKey: accentKey,
        origin, footprint: [origin], orientation: "S", accessPath: [],
      });
      occupiedDecor.add(cellKey(origin));
      accentIndex += 1;
    }
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
        if (!await this.featurePlacementOpen(countryId, seed, footprint)) continue;
        await this.insertWorldFeature(countryId, { cityId, districtId: null, parentFeatureId: null, kind, assetKind: "PROP", assetKey, origin, footprint, orientation, accessPath: [] });
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
        if (!await this.featurePlacementOpen(countryId, seed, pair[0].footprint, avoidBounds)) continue;
        if (!await this.featurePlacementOpen(countryId, seed, pair[1].footprint, avoidBounds)) continue;
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
        });
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
    const cityExclusion = (await this.listCities(countryId)).map((city) => expandRect(city.bounds, 4));
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
        if (!await this.featurePlacementOpen(countryId, seed, footprint, cityExclusion)) continue;
        const entrance = horizontal
          ? { x: origin.x + Math.floor(catalog.footprint.width / 2), y: side < 0 ? origin.y + catalog.footprint.height : origin.y - 1 }
          : { x: side < 0 ? origin.x + catalog.footprint.width : origin.x - 1, y: origin.y + Math.floor(catalog.footprint.height / 2) };
        const accessWithRoad = orthogonalPath(entrance, cell, horizontal ? false : true);
        const roads = await this.roadCells(countryId);
        const accessPath = accessWithRoad.filter((point) => !roads.has(cellKey(point)));
        if (accessPath.length > 8 || !await this.featurePlacementOpen(countryId, seed, accessPath, cityExclusion)) continue;
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
                                                });
        const roadsAtStation = await this.roadCells(countryId);
        const stationClass = roadsAtStation.get(cellKey(cell))?.roadClass ?? "HIGHWAY";
        await placeStopPair(cell, horizontal ? "HORIZONTAL" : "VERTICAL", ROAD_WIDTH[stationClass], cityExclusion);
        for (const [assetKey, offset] of [["streetlamp", { x: -2, y: 0 }], ["trash-bin", { x: catalog.footprint.width + 1, y: 1 }]] as const) {
          const decorOrigin = { x: origin.x + offset.x, y: origin.y + offset.y };
          const decorFootprint = [decorOrigin];
          if (await this.featurePlacementOpen(countryId, seed, decorFootprint, cityExclusion)) {
            await this.insertWorldFeature(countryId, {
                                                                      cityId: null, districtId: null, parentFeatureId: null, kind: "ROADSIDE_DECOR", assetKind: "PROP", assetKey,
                                                                      origin: decorOrigin, footprint: decorFootprint, orientation: "S", accessPath: [],
                                                                    });
          }
        }
        return;
      }
    }
  }

  private async syncCountryArchiveComplex(countryId: string, preferredAnchor?: Cell): Promise<Rect | undefined> {
    const archive = await this.getArchive(countryId);
    let features = (await this.listWorldFeatures(countryId)).filter((feature) => feature.kind === "COUNTRY_ARCHIVE");
    let compound = features.find((feature) => feature.assetKind === "AREA");
    const cities = await this.listCities(countryId);
    const cityExclusions = cities.map((city) => expandRect(city.bounds, ARCHIVE_CITY_CLEARANCE));
    let relocatedBounds: Rect | undefined;
    if (compound && cityExclusions.some((bounds) => intersects(bounds, boundsOf(compound!.footprint)))) {
      relocatedBounds = boundsOf([...compound.footprint, ...compound.accessPath]);
      const oldCorridor = new Map(this.roadCorridor(compound.accessPath, "LOCAL").map((cell) => [cellKey(cell), cell]));
      const protectedCells = new Set([
        ...(await this.listTasks(countryId)).flatMap((task) => [...taskOccupiedCells(task), ...task.accessPath]),
        ...(await this.listWorldFeatures(countryId))
          .filter((feature) => feature.id !== compound!.id && feature.parentFeatureId !== compound!.id && feature.kind !== "COUNTRY_ARCHIVE")
          .flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
      ].map(cellKey));
      await this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?").run(compound.id);
      const roads = await this.roadCells(countryId);
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
      if (removed.length > 0) await this.recalculateRoadMasks(countryId, removed);
      this.surfaceCache.delete(countryId);
      features = (await this.listWorldFeatures(countryId)).filter((feature) => feature.kind === "COUNTRY_ARCHIVE");
      compound = undefined;
    }
    if (!compound) {
      const city = preferredAnchor ? undefined : (await this.listCities(countryId))[0];
      const anchor = preferredAnchor ?? city?.center;
      if (!anchor) return undefined;
      const seed = Number((await this.countryRow(countryId)).seed);
      // The archive is a separate secured national site, not another city
      // block. Keep a visible green belt between its perimeter and every city.
      const preferredCandidates = [
        { x: -112, y: 12 }, { x: 94, y: 12 }, { x: -12, y: -106 }, { x: -12, y: 94 },
        { x: -120, y: -34 }, { x: 102, y: -34 }, { x: -42, y: -114 }, { x: 28, y: 102 },
      ];
      const fallbackCandidates: Cell[] = [];
      for (let y = -52; y <= 48; y += 4) for (const x of [-136, -128, -120, -112, -104, -96, 88, 96, 104, 112, 120, 128]) fallbackCandidates.push({ x, y });
      for (let x = -52; x <= 48; x += 4) for (const y of [-126, -118, -110, -102, -94, 88, 96, 104, 112, 120]) fallbackCandidates.push({ x, y });
      fallbackCandidates.sort((left, right) => manhattan(left, { x: -104, y: 0 }) - manhattan(right, { x: -104, y: 0 }));
      const candidates = [...preferredCandidates, ...fallbackCandidates];
      const roads = await this.roadCells(countryId);
      const occupied = new Set([
        ...(await this.listTasks(countryId)).flatMap(taskOccupiedCells).map(cellKey),
        ...features.flatMap((feature) => feature.footprint).map(cellKey),
      ]);
      for (const offset of candidates) {
        const origin = { x: anchor.x + offset.x, y: anchor.y + offset.y };
        const footprint = rectangleFootprint(origin, ARCHIVE_COMPOUND.width, ARCHIVE_COMPOUND.height);
        // Reserve the security perimeter and a four-cell south approach from
        // day one. The archive may grow, but its fence and gate must never be
        // forced onto water, an existing road or somebody else's building.
        const securedSite = rectangleFootprint({ x: origin.x - 1, y: origin.y - 1 }, ARCHIVE_COMPOUND.width + 2, ARCHIVE_COMPOUND.height + 2);
        const approach = rectangleFootprint({ x: origin.x + 9, y: origin.y + ARCHIVE_COMPOUND.height }, 2, 4);
        if (![...securedSite, ...approach].every((cell) => !roads.has(cellKey(cell))
          && !occupied.has(cellKey(cell))
          && !cityExclusions.some((bounds) => contains(bounds, cell))
          && isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain))) continue;
        compound = await this.insertWorldFeature(countryId, {
          cityId: null, districtId: null, parentFeatureId: null,
          kind: "COUNTRY_ARCHIVE", assetKind: "AREA", assetKey: "state-archive-complex",
          origin, footprint, orientation: "S", accessPath: [],
        });
        break;
      }
    }
    if (!compound) return undefined;

    const seed = Number((await this.countryRow(countryId)).seed);
    if (compound.accessPath.length === 0) {
      const gateCenter = { x: compound.origin.x + 10, y: compound.origin.y + ARCHIVE_COMPOUND.height };
      const apron = Array.from({ length: 4 }, (_, index) => ({ x: gateCenter.x, y: gateCenter.y + index }));
      const exclusion = expandRect(boundsOf(compound.footprint), 4);
      const cityAvoid = (await this.listCities(countryId)).map((city) => expandRect(city.bounds, 3));
      const allRoads = [...(await this.roadCells(countryId)).values()].filter((road) => !contains(exclusion, road));
      // Join the archive driveway to the rural/national network. Routing to a
      // tempting local street can otherwise cut a new road straight through
      // the city's reserved building envelope.
      const ruralRoads = allRoads.filter((road) => !cityAvoid.some((bounds) => contains(bounds, road)));
      const roads = (ruralRoads.length > 0 ? ruralRoads : allRoads)
        .sort((left, right) => {
          const classPenalty = (road: RoadCellDto) => road.roadClass === "HIGHWAY" ? 10_000 : 0;
          return manhattan(left, apron[apron.length - 1]!) + classPenalty(left)
            - manhattan(right, apron[apron.length - 1]!) - classPenalty(right);
        });
      let connector: Cell[] | undefined;
      for (const target of roads.slice(0, 24)) {
        try {
          // Two-cell clearance protects the fence from the lateral lane of the
          // stamped two-lane driveway, not just from its A* centreline.
          const routed = await this.route(countryId, seed, apron[apron.length - 1]!, target, cityAvoid, [], 2, true);
          connector = [...apron, ...routed.slice(1)];
          break;
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
        }
      }
      if (!connector) throw new DomainError("ROUTE_BLOCKED", "Не удалось соединить Государственный архив с дорожной сетью");
      await this.addRoadPath(countryId, seed, connector, "LOCAL");
      await this.db.prepare("UPDATE world_features_v6 SET access_json = ? WHERE id = ?").run(JSON.stringify(connector), compound.id);
      compound = { ...compound, accessPath: connector };
    }

    const infrastructure: Array<{ assetKey: string; origin: Cell; footprint: Cell[]; orientation: "E" | "S" }> = [];
    const addInfrastructure = (assetKey: string, origin: Cell, orientation: "E" | "S", width: number, height: number) => {
      infrastructure.push({ assetKey, origin, orientation, footprint: rectangleFootprint(origin, width, height) });
    };
    const origin = compound.origin;
    for (let offset = -1; offset <= ARCHIVE_COMPOUND.width - 1; offset += 2) {
      addInfrastructure("archive-fence-horizontal", { x: origin.x + offset, y: origin.y - 1 }, "E", 2, 1);
    }
    for (const offset of [-1, 1, 3, 5, 7, 11, 13, 15, 17]) {
      addInfrastructure("archive-fence-horizontal", { x: origin.x + offset, y: origin.y + ARCHIVE_COMPOUND.height }, "E", 2, 1);
    }
    for (const sideX of [origin.x - 1, origin.x + ARCHIVE_COMPOUND.width]) {
      for (let offset = 0; offset < ARCHIVE_COMPOUND.height; offset += 2) {
        addInfrastructure("archive-fence-vertical", { x: sideX, y: origin.y + offset }, "S", 1, 2);
      }
    }
    addInfrastructure("archive-security-barrier", { x: origin.x + 9, y: origin.y + ARCHIVE_COMPOUND.height }, "E", 2, 1);

    const infrastructureKeys = new Set(infrastructure.map((item) => `${item.assetKey}:${cellKey(item.origin)}`));
    const existingInfrastructure = (await this.listWorldFeatures(countryId)).filter((feature) =>
      feature.parentFeatureId === compound!.id && feature.assetKind === "PROP"
      && (feature.assetKey.startsWith("archive-fence-") || feature.assetKey === "archive-security-barrier"));
    for (const feature of existingInfrastructure) {
      if (infrastructureKeys.has(`${feature.assetKey}:${cellKey(feature.origin)}`)) continue;
      await this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?").run(feature.id);
    }
    const existingKeys = new Set(existingInfrastructure.map((feature) => `${feature.assetKey}:${cellKey(feature.origin)}`));
    for (const item of infrastructure) {
      if (existingKeys.has(`${item.assetKey}:${cellKey(item.origin)}`)) continue;
      await this.insertWorldFeature(countryId, {
        cityId: null, districtId: null, parentFeatureId: compound.id,
        kind: "COUNTRY_ARCHIVE", assetKind: "PROP", assetKey: item.assetKey,
        origin: item.origin, footprint: item.footprint, orientation: item.orientation, accessPath: [],
      });
    }

    const currentChildren = new Map(features
      .filter((feature) => feature.parentFeatureId === compound!.id && feature.assetKind === "BUILDING")
      .map((feature) => [feature.assetKey, feature]));
    const wanted = new Set(ARCHIVE_BUILDINGS.slice(0, archive.stage).map((building) => building.assetKey));
    for (const feature of currentChildren.values()) {
      if (wanted.has(feature.assetKey as (typeof ARCHIVE_BUILDINGS)[number]["assetKey"])) continue;
      await this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?").run(feature.id);
    }
    for (const building of ARCHIVE_BUILDINGS.slice(0, archive.stage)) {
      if (currentChildren.has(building.assetKey)) continue;
      const origin = { x: compound.origin.x + building.offset.x, y: compound.origin.y + building.offset.y };
      await this.insertWorldFeature(countryId, {
        cityId: null, districtId: null, parentFeatureId: compound.id,
        kind: "COUNTRY_ARCHIVE", assetKind: "BUILDING", assetKey: building.assetKey,
        origin, footprint: rectangleFootprint(origin, building.width, building.height), orientation: "S", accessPath: [],
      });
    }
    await this.db.prepare("UPDATE country_archives_v1 SET updated_at = ? WHERE id = ?").run(now(), archive.id);
    this.surfaceCache.delete(countryId);
    const currentBounds = boundsOf([...compound.footprint, ...compound.accessPath, ...infrastructure.flatMap((item) => item.footprint)]);
    return relocatedBounds ? unionRect(relocatedBounds, currentBounds) : currentBounds;
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
    return await this.mutate(countryId, "city.create.v3", input.idempotencyKey, input, async () => {
                      const country = await this.countryRow(countryId);
                      const seed = Number(country.seed);
                      const cities = await this.listCities(countryId);
                      const center = await this.nextCityCenter(countryId, seed);
                      const bounds = rectForCenter(center);
                      const id = randomUUID();
                      const createdAt = now();
                      const styleId = `style-${Math.floor(hashCoordinate(seed, center.x, center.y, 433) * 8)}`;
                      const morphology = input.morphology ?? cityMorphology(hashCoordinate(seed, center.x, center.y, 439));
                      await this.db.prepare("INSERT INTO cities_v3 (id, country_id, name, description, goal, acceptance_criteria, deadline, status, center_x, center_y, bounds_json, style_id, morphology, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)")
                                                        .run(id, countryId, name, input.description?.trim().slice(0, 8000) ?? "", input.goal?.trim().slice(0, 4000) ?? "", input.acceptanceCriteria?.trim().slice(0, 8000) ?? "", input.deadline ?? null, center.x, center.y, JSON.stringify(bounds), styleId, morphology, createdAt);

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
                        ...(await this.listDistricts(countryId)).filter((district) => district.cells.length > 0).map((district) => expandRect(boundsOf(district.cells), 3)),
                      ];
                      // A connector branches from a rural highway and routes around every
                      // existing district. The new 100x100 reservation is protected as well so
                      // the route reaches only its chosen portal.
                      const sourceCandidates = nearest
                        ? [...await this.highwayAnchors(countryId, portal, cities), ...await this.roadNetworkAnchors(countryId, portal, cities)]
                        : [approach];
                      const uniqueSources = [...new Map(sourceCandidates.map((cell) => [cellKey(cell), cell])).values()];
                      let source: Cell | undefined;
                      let connector: Cell[] | undefined;
                      for (const candidate of uniqueSources.slice(0, 48)) {
                        try {
                          connector = await this.route(countryId, seed, candidate, portal, [...protectedUrbanEnvelopes, bounds], [], 3);
                          source = candidate;
                          break;
                        } catch (error) {
                          if (!(error instanceof DomainError) || error.code !== "ROUTE_BLOCKED") throw error;
                        }
                      }
                      if (!source || !connector) throw new DomainError("ROUTE_BLOCKED", "В существующем мире не найден безопасный узел для подключения нового города");
                      // The first-city approach point sits at the viewport edge
                      // without a terrain check. When that edge is water, the
                      // stamped highway would begin mid-lake — a bridge with a
                      // single land portal. Trim the leading water cells so the
                      // highway starts on the first dry shoreline; interior
                      // water spans further along stay proper two-portal bridges.
                      const dryConnector = nearest ? connector : (() => {
                        let startIndex = 0;
                        const dryAt = (cell: Cell) => [-2, -1, 0, 1, 2].every((offset) =>
                          isBuildableTerrain(terrainAt(seed, cell.x + offset, cell.y).terrain)
                          && isBuildableTerrain(terrainAt(seed, cell.x, cell.y + offset).terrain));
                        while (startIndex < connector.length - 1 && !dryAt(connector[startIndex]!)) startIndex += 1;
                        return connector.slice(startIndex);
                      })();
                      await this.addRoadPath(countryId, seed, dryConnector, "HIGHWAY");
                      await this.addRoadPath(countryId, seed, orthogonalPath(portal, gateway.cell, gateway.horizontalApproach), "HIGHWAY");
                      await this.addRoadPath(countryId, seed, orthogonalPath(gateway.cell, hub, gateway.horizontalApproach), "ARTERIAL");
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
                      if (hubArm.length > 1) await this.addRoadPath(countryId, seed, hubArm, "COLLECTOR");
                      // A later intercity connector may briefly reuse the exit road of an
                      // existing city. Its urban portion must remain an arterial.
                      for (const existingCity of cities) await this.normalizeUrbanHighways(countryId, existingCity.bounds);
                      await this.normalizeUrbanHighways(countryId, bounds);
                      await this.publishCityGatewayFeatures(countryId, id, seed, bounds, gateway.cell, portal, dryConnector, gateway.horizontalApproach);
                      const archiveBounds = await this.syncCountryArchiveComplex(countryId, hub);

                      const publishedRoads = await this.roadCells(countryId);
                      const centerRoad = [...publishedRoads.values()].reduce<Cell | undefined>((best, road) =>
                        !best || manhattan(road, center) < manhattan(best, center) ? road : best, undefined);
                      const networkStart = nearest ? source : dryConnector[0];
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
                      return { data, eventType: "city.renamed", eventPayload: { cityId: input.cityId, name, affectedBounds: data.bounds } };
                    });
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
      return { data, eventType: "city.updated", eventPayload: { cityId: data.id, affectedBounds: data.bounds } };
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
  private async clearRuins(countryId: string, cells: Cell[]): Promise<void> {
    if (cells.length === 0) return;
    const keys = new Set(cells.map(cellKey));
    const ruins = (await this.listWorldFeatures(countryId)).filter((feature) => feature.kind === "RUIN");
    const remove = this.db.prepare("DELETE FROM world_features_v6 WHERE id = ?");
    for (const ruin of ruins) {
      if (ruin.footprint.some((cell) => keys.has(cellKey(cell)))) await remove.run(ruin.id);
    }
  }

  /**
   * V10 organic growth. The next complex (ЖК) is placed inside the district
   * territory directly against the existing development; when the territory is
   * full, the territory itself grows first and the complex follows. Streets are
   * published only together with the complex that needs them — a road never
   * appears ahead of demand.
   */
  private async growDistrict(countryId: string, district: DistrictDto, entry: BuildingCatalogEntry): Promise<DistrictDto> {
    if (district.status === "COMPLETED") throw new DomainError("DISTRICT_SEALED", "Закрытый район больше не расширяется");
    const seed = Number((await this.countryRow(countryId)).seed);
    const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ?").get(district.cityId) as Row;
    const denseGrid = cityDto(cityRow).morphology === "DENSE_CORE";
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

    const infill = await this.tryGrowComplex(countryId, district, entry, boundsOf(district.cells), complexIndex, targetLots, seed, denseGrid);
    if (infill) return infill;

    const originalBounds = boundsOf(district.cells);
    const existingKeys = new Set(district.cells.map(cellKey));
    const blockedByDistrict = new Set(
      (await this.listDistricts(countryId))
                        .filter((candidate) => candidate.id !== district.id)
                        .flatMap((candidate) => candidate.cells)
                        .map(cellKey),
    );
    const archiveFeatures = (await this.listWorldFeatures(countryId)).filter((feature) => feature.kind === "COUNTRY_ARCHIVE");
    const institutionalReserved = new Set([
      ...archiveFeatures.flatMap((feature) => feature.footprint).map(cellKey),
      ...await this.institutionalAccessRoads(countryId),
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
        if (patch.length < (entry.tags.includes("new-build") ? 900 : 300)) continue;
        const patchBounds = boundsOf(patch);
        const grown: DistrictDto = { ...district, cells: [...district.cells, ...patch], growthDirection: direction };
        // A connected annex may be a narrow strip along a river or forest.
        // The next block is allowed to straddle the old/new district seam;
        // restricting the search to patchBounds alone incorrectly rejected
        // viable frontage even though the combined territory had ample room.
        const grownSearchBounds = unionRect(originalBounds, patchBounds);
        const sited = await this.tryGrowComplex(countryId, grown, entry, grownSearchBounds, complexIndex, targetLots, seed, denseGrid);
        if (!sited) continue;
        const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ?").get(district.cityId) as Row;
        const city = cityDto(cityRow);
        const expandedCity = unionRect(city.bounds, expandRect(patchBounds, 8));
        if (JSON.stringify(expandedCity) !== JSON.stringify(city.bounds)) await this.db.prepare("UPDATE cities_v3 SET bounds_json = ? WHERE id = ?").run(JSON.stringify(expandedCity), city.id);
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
    denseGrid = false,
  ): Promise<DistrictDto | null> {
    const allowed = new Set(district.cells.map(cellKey));
    const roads = await this.roadCells(countryId);
    const existingRoadKeys = new Set(roads.keys());
    const occupied = new Set([
      ...(await this.listTasks(countryId)).flatMap((task) => [...taskOccupiedCells(task), task.entrance, ...task.accessPath]),
      ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN")
        .flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
    ].map(cellKey));
    const blockedByDistrict = new Set(
      (await this.listDistricts(countryId))
                        .filter((candidate) => candidate.id !== district.id)
                        .flatMap((candidate) => candidate.cells)
                        .map(cellKey),
    );
    const sealed = await this.completedDistrictCells(countryId);
    const institutionalRoads = await this.institutionalAccessRoads(countryId);
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
    const anchors = nearDistrictRoads.length > 0 ? nearDistrictRoads : safeRoads;
    const proximityAnchors = nearDistrictRoads.length > 0 ? nearDistrictRoads : proximityRoads;
    // A later compact block may legitimately sit across the unbuilt half of a
    // large district territory. Limiting infill to eight cells from the first
    // street made a 10-district city box its active district after one block,
    // even though hundreds of buildable cells remained inside its boundary.
    // The connector is still demand-driven and validated below, so a wider
    // search fills reserved urban land before annexing another territory.
    const maxAdjacency = 24;
    if (anchors.length === 0) return null;
    const expectedRole = this.lotRoleForEntry(district.archetype, entry);
    const strictRoles = district.archetype === "NEW_BUILD" || district.archetype === "PRIVATE";

    // Demand-driven footprint: roughly sixty cells per planned building with a
    // seeded aspect, so complexes vary between wide slabs and compact courts.
    // The rect is capped to the search bounds — a smaller territory simply
    // hosts a smaller first complex and grows more of them later. The first
    // complex never swallows the whole territory: at most ~70% of it, so a
    // pocket park and later infill always have land left.
    const boundsWidth = searchBounds.maxX - searchBounds.minX + 1;
    const boundsHeight = searchBounds.maxY - searchBounds.minY + 1;
    const v5TaskBuilding = entry.tags.includes("new-build");
    const minimumRect = complexMinimumRect(entry, targetLots);
    // A private neighbourhood opens with a real frontage block: four varied
    // house bays plus reusable side strips on one shared street. Basing its
    // width only on the first small cottage made a 2+2 island and then another
    // road for the next wider house.
    const privateFrontageWidth = district.archetype === "PRIVATE" && complexIndex === 0
      ? Math.max(42, entry.footprint.width * 4 + 6)
      : 0;
    const newBuildFrontageWidth = district.archetype === "NEW_BUILD" && complexIndex === 0
      ? Math.min(72, Math.max(12, entry.footprint.width) * 4 + 8)
      : 0;
    const minimumRectWidth = Math.max(minimumRect.width, privateFrontageWidth, newBuildFrontageWidth);
    const minimumRectHeight = minimumRect.height;
    if (boundsWidth < minimumRectWidth + 2 || boundsHeight < minimumRectHeight + 2) return null;
    const territoryCap = complexIndex === 0
      ? Math.min(
        allowed.size,
        Math.max(v5TaskBuilding ? 1_250 : 240, Math.floor(allowed.size * (denseGrid ? 0.82 : 0.8))),
      )
      : Number.POSITIVE_INFINITY;
    const area = Math.min(
      v5TaskBuilding ? Math.max(targetLots * 120, minimumRectWidth * minimumRectHeight) : targetLots * (denseGrid ? 68 : 60),
      territoryCap,
    );
    // Dense cores need enough north/south depth for three shared frontage
    // streets. Organic districts keep the wider seeded aspect palette.
    const aspect = denseGrid
      ? 0.78 + hashCoordinate(seed, searchBounds.minX, searchBounds.minY, 941 + complexIndex) * 0.16
      : 0.7 + hashCoordinate(seed, searchBounds.minX, searchBounds.minY, 941 + complexIndex) * 0.9;
    const rectWidth = Math.max(minimumRectWidth, Math.min(v5TaskBuilding ? 72 : 40, boundsWidth - 2, Math.round(Math.sqrt(area * aspect))));
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
    for (let y = searchBounds.minY + 1; y + rectHeight - 1 <= searchBounds.maxY - 1; y += siteStep) {
      for (let x = searchBounds.minX + 1; x + rectWidth - 1 <= searchBounds.maxX - 1; x += siteStep) {
        const rect: Rect = { minX: x, minY: y, maxX: x + rectWidth - 1, maxY: y + rectHeight - 1 };
        const rectCells = rectangleFootprint({ x, y }, rectWidth, rectHeight);
        // The district silhouette has cut corners, so a complex nearly as big
        // as the territory can never be fully inside it. Accept sites that are
        // mostly inside; the planner drops the few lots that fall outside.
        const insideCount = rectCells.filter((cell) => allowed.has(cellKey(cell))).length;
        if (insideCount / rectCells.length < 0.9) continue;
        // The coarse planning rectangle may cover an existing street or a
        // neighbouring facade; individual lots and road corridors are filtered
        // against those hard obstacles below. Rejecting the whole rectangle
        // here forced one road per building in dense districts.
        const unsuitable = rectCells.filter((cell) => !isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain)).length;
        if (unsuitable / rectCells.length > 0.06) continue;
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
      const frontageMinimumLot = district.archetype === "PRIVATE"
        ? { width: Math.max(9, entry.footprint.width), height: Math.max(6, entry.footprint.height) }
        : district.archetype === "NEW_BUILD"
          ? { width: Math.max(14, entry.footprint.width), height: Math.max(12, entry.footprint.height) }
          : entry.footprint;
      const planned = planComplex({
        districtId: district.id,
        complexIndex,
        rect: candidate.rect,
        cells: district.cells,
        archetype: district.archetype,
        targetLots,
        minimumLot: frontageMinimumLot,
        seed,
        denseGrid,
        reserveSupport: !district.lots.some((lot) => lot.role === "SUPPORT"),
      });
      const plan = {
        ...planned,
        lots: planned.lots.filter((lot) => !rectangleFootprint(lot.origin, lot.width, lot.height)
          .some((cell) => existingRoadKeys.has(cellKey(cell)) || occupied.has(cellKey(cell)))),
      };
      // Normal complexes need one occupied pad plus at least two genuine
      // alternatives; otherwise a clipped corner publishes a one-off street
      // and immediately forces another growth cycle. The 18×16 V5 tower is a
      // deliberate superblock and may stand alone.
      const minimumPublishedLots = targetLots <= 4 || entry.footprint.width >= 18 || entry.footprint.height >= 14
        ? 1
        : Math.min(3, targetLots);
      if (plan.lots.length < minimumPublishedLots) {
        continue;
      }
      // Strict archetypes never sacrifice their few service slots to housing,
      // but a service building may occupy a regular lot when no service slot
      // fits it — zoning guides placement, it never deadlocks growth.
      const fitsEntry = (lots: PlannedLotDto[]) => {
        const fittingLots = lots.filter((lot) => entry.footprint.width <= lot.width && entry.footprint.height <= lot.height);
        const roleFitting = fittingLots.filter((lot) => lot.role === expectedRole);
        return strictRoles && expectedRole === "PRIMARY" ? roleFitting.length > 0 : fittingLots.length > 0;
      };
      if (!fitsEntry(plan.lots)) continue;
      const corridors = plan.streets.flatMap((segment) => this.roadCorridor(segment, "LOCAL"));
      if (corridors.some((cell) => occupied.has(cellKey(cell)) || blockedByDistrict.has(cellKey(cell)))) continue;
      const reserved = plan.lots.flatMap((lot) => rectangleFootprint(lot.origin, lot.width, lot.height));
      const reservedKeys = new Set(reserved.map(cellKey));
      const endpoints = plan.streets.flatMap((segment) => [segment[0]!, segment.at(-1)!]);
      const pairs = anchors.flatMap((road) => endpoints.map((endpoint) => ({ road, endpoint, distance: manhattan(road, endpoint) })))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 24);
      // Committed buildings/features and sealed districts are hard stops.
      // Planned lots are soft reservations and a growing neighbour's empty
      // territory is shared ground: the passes prefer a clean corridor, then
      // allow crossing foreign territory, and finally let the connector cut
      // through at most two corner lots — sacrificing those plots to the
      // street rather than losing the complex.
      let connector: Cell[] | null = null;
      let sacrificedLotIds = new Set<string>();
      const connectorClass = complexIndex === 0 ? "COLLECTOR" : "LOCAL";
      for (const [allowLotClipping, allowForeign] of [[false, false], [false, true], [true, true]] as const) {
        for (const pair of pairs) {
          try {
            // Prefer one clean orthogonal connector at every distance. Besides
            // producing straight, square city streets, this avoids invoking A*
            // for dozens of obviously clear candidate pairs. A* remains the
            // obstacle fallback after the full-width corridor is validated.
            let path = orthogonalPath(
              pair.road,
              pair.endpoint,
              Math.abs(pair.road.x - pair.endpoint.x) >= Math.abs(pair.road.y - pair.endpoint.y),
            );
            let corridorCells = this.roadCorridor(path, connectorClass);
            const hardBlocked = (cell: Cell) => {
              const key = cellKey(cell);
              return connectorCorridorBlocked(key, occupied, existingRoadKeys, blockedByDistrict, foreignSoft, allowForeign);
            };
            const softBlocked = (cell: Cell) => hardBlocked(cell) || (!allowLotClipping && reservedKeys.has(cellKey(cell)));
            if (corridorCells.some(softBlocked)) {
              path = await this.route(countryId, seed, pair.road, pair.endpoint, [], allowLotClipping ? [] : reserved, 1, true);
              corridorCells = this.roadCorridor(path, connectorClass);
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
      await this.addRoadPath(countryId, seed, connector, connectorClass);
      // Segments stick only where they meet the existing network, so streets
      // go out in reachability order: each pass publishes every segment that
      // touches a road published so far — the spine streets bridge the
      // parallel tier streets into one connected component.
      const published = new Set((await this.roadCells(countryId)).keys());
      let pending = [...plan.streets];
      while (pending.length > 0) {
        const ready = pending.filter((segment) => segment.some((cell) =>
          published.has(cellKey(cell)) || neighbors4(cell).some((next) => published.has(cellKey(next)))));
        const batch = ready.length > 0 ? ready : pending;
        for (const segment of batch) {
          await this.addRoadPath(countryId, seed, segment, "LOCAL");
          for (const cell of this.roadCorridor(segment, "LOCAL")) published.add(cellKey(cell));
        }
        pending = pending.filter((segment) => !batch.includes(segment));
      }
      await this.clearRuins(countryId, [...this.roadCorridor(connector, connectorClass), ...corridors]);
      // Reaching this point means the broad candidate pool could not use any
      // remaining speculative pad in an older complex. Keeping those virtual
      // pads after publishing another street leaves permanent empty gaps and
      // makes the district look pre-zoned instead of demand-grown. Retain
      // occupied lots and real demolition plots (`vacant`), but retire unused
      // planning alternatives as soon as development moves to a new complex.
      const committedLots = district.lots.filter((lot) => lot.taskId || lot.vacant);
      const lots = [...committedLots, ...plan.lots.filter((lot) => !sacrificedLotIds.has(lot.id))];
      await this.db.prepare("UPDATE districts_v3 SET cells_json = ?, lots_json = ?, growth_direction = ? WHERE id = ?")
                                                  .run(JSON.stringify(district.cells), JSON.stringify(lots), district.growthDirection, district.id);
      // Green areas arrive together with the first streets: a pocket park or
      // grove is tucked into the remaining territory, away from planned lots.
      const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ?").get(district.cityId) as Row;
      const districtIndex = (await this.listDistricts(countryId, district.cityId)).findIndex((item) => item.id === district.id);
      const city = cityDto(cityRow);
      const greenAdjustedLots = await this.publishDistrictGreenFeature(
        countryId, city, district.id, seed, district.cells, district.archetype, Math.max(0, districtIndex), lots,
      );
      if (greenAdjustedLots.length !== lots.length) {
        await this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?")
          .run(JSON.stringify(greenAdjustedLots), district.id);
      }
      return { ...district, lots: greenAdjustedLots };
    }
    // Demand overshoots the remaining land: retry with a smaller complex
    // (16 → 9 → 5 → 3 lots). The failure path mutated nothing, and a compact
    // infill block beats surrendering to a full territory patch.
    const nextTarget = Math.floor(targetLots * 0.6);
    if (nextTarget >= 3 && nextTarget < targetLots) {
      return this.tryGrowComplex(countryId, district, entry, searchBounds, complexIndex, nextTarget, seed, denseGrid);
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
  ): Promise<Array<{ origin: Cell; cells: Cell[] }>> {
    const roads = await this.roadCells(countryId);
    const institutionalRoads = await this.institutionalAccessRoads(countryId);
    const districts = await this.listDistricts(countryId);
    const cityDistricts = districts.filter((district) => district.cityId === city.id);
    // A national institution is connected for traffic, but its guarded access
    // road is not public frontage and must never attract a residential sprint.
    const preferredRoads = [...roads.values()].filter((road) => road.roadClass !== "HIGHWAY"
      && !institutionalRoads.has(cellKey(road)) && contains(expandRect(city.bounds, 24), road));
    const occupied = new Set(districts.flatMap((district) => district.cells).map(cellKey));
    const growthReservations = districts
      .filter((district) => district.status === "ACTIVE")
      .map((district) => this.districtGrowthReserve(district));
    const protectedCities = (await this.listCities(countryId))
              .filter((candidate) => candidate.id !== city.id)
              .map((candidate) => expandRect(candidate.bounds, 12));
    for (const extension of [0, 32, 64, 96]) {
      const searchBounds = expandRect(city.bounds, extension);
      const candidates: Array<{ origin: Cell; cells: Cell[]; score: number }> = [];
      for (let y = searchBounds.minY + 5; y <= searchBounds.maxY - height - 5; y += 4) {
        for (let x = searchBounds.minX + 5; x <= searchBounds.maxX - width - 5; x += 4) {
          const origin = { x, y };
          const cells = rectangular
            ? rectangleFootprint(origin, width, height)
            : this.districtShape(origin, width, height, seed);
          if (candidateValid && !candidateValid(origin, cells)) continue;
          if (cells.some((cell) => occupied.has(cellKey(cell)))) continue;
          if (growthReservations.some((reservation) => cells.some((cell) => contains(reservation, cell)))) continue;
          const proposedEnvelope = unionRect(city.bounds, expandRect(boundsOf(cells), 8));
          if (protectedCities.some((bounds) => intersects(bounds, proposedEnvelope))) continue;
          const unsuitable = cells.filter((cell) => !isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain)).length;
          if (unsuitable / cells.length > 0.06) continue;
          const center = { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) };
          const candidateBounds = boundsOf(cells);
          const frontageEndpoints = [
            { x: origin.x + 2, y: origin.y + height - 4 },
            { x: origin.x + width - 3, y: origin.y + height - 4 },
          ];
          const roadDistance = preferredRoads.length === 0
            ? 201
            : Math.min(...frontageEndpoints.flatMap((endpoint) => preferredRoads.map((road) => manhattan(endpoint, road))));
          const districtDistance = cityDistricts.length === 0 ? 0 : Math.min(...cityDistricts.map((district) => {
            if (district.cells.length === 0) return 24;
            const other = boundsOf(district.cells);
            const dx = Math.max(0, other.minX - candidateBounds.maxX - 1, candidateBounds.minX - other.maxX - 1);
            const dy = Math.max(0, other.minY - candidateBounds.maxY - 1, candidateBounds.minY - other.maxY - 1);
            return dx + dy;
          }));
          const centerDistance = manhattan(center, city.center);
          const candidateDirection = this.outwardDirection(city, center);
          const repeatedDirection = cityDistricts.filter((district) => {
            if (district.cells.length === 0) return false;
            const districtBounds = boundsOf(district.cells);
            const districtCenter = {
              x: Math.floor((districtBounds.minX + districtBounds.maxX) / 2),
              y: Math.floor((districtBounds.minY + districtBounds.maxY) / 2),
            };
            return this.outwardDirection(city, districtCenter) === candidateDirection;
          }).length;
          // First district grows around the city hub. Later districts hug the
          // existing urban envelope, while still keeping a short connection to
          // a collector/local road. Reusing the same cardinal sector is costly:
          // a third district should form a T/blob, not extend a linear chain.
          const compactness = cityDistricts.length === 0 ? centerDistance * 2.4 : districtDistance * 38 + centerDistance * 0.18;
          const score = compactness + repeatedDirection * 180 + roadDistance * 7 + unsuitable * 30 + extension * 2 + hashCoordinate(seed, x, y, 541);
          candidates.push({ origin, cells, score });
        }
      }
      const selected = candidates.sort((a, b) => a.score - b.score).slice(0, 16);
      if (selected.length > 0) return selected;
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
  ): Promise<boolean> {
    if (anchorRoads.length === 0) return true;

    const siteBounds = boundsOf(site.cells);
    const gapTo = (road: Cell) =>
      Math.max(0, siteBounds.minX - road.x, road.x - siteBounds.maxX)
      + Math.max(0, siteBounds.minY - road.y, road.y - siteBounds.maxY);
    const rankedAnchors = [...anchorRoads]
      .sort((left, right) => gapTo(left) - gapTo(right) || left.y - right.y || left.x - right.x);
    if (gapTo(rankedAnchors[0]!) <= 2) return true;

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
        await this.addRoadPath(countryId, seed, stub, "COLLECTOR");
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
        const tail = await this.route(countryId, seed, candidate.exit, candidate.target, [], [], 1, true);
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
    return await this.mutate(countryId, "district.create.v3", input.idempotencyKey, input, async () => {
                      const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
                      if (!cityRow) throw new DomainError("NOT_FOUND", "Город не найден");
                      const city = cityDto(cityRow);
                      const seed = Number((await this.countryRow(countryId)).seed);
                      // The target is planning metadata, not a hard sprint gate: a two-week
                      // solo sprint and a month-long team sprint cannot share one limit.
                      const capacity = Math.max(1, Math.round(input.capacitySp ?? 14));
                      const existingDistricts = await this.listDistricts(countryId, city.id);
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
                        // The V5 first complex needs a one-cell planner margin
                        // around a 29-cell two-tier envelope. A 27-cell initial
                        // territory could be selected successfully but could
                        // never publish its first road/building on rough seeds.
                        ? Math.max(31, Math.min(34, Math.round(area / width)))
                        : Math.max(35, Math.min(42, Math.round(area / width)));
                      const id = randomUUID();
                      const existingRoads = await this.roadCells(countryId);
                      const occupied = new Set([
                        ...existingRoads.keys(),
                        ...(await this.listTasks(countryId)).flatMap(taskOccupiedCells).map(cellKey),
                        ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint).map(cellKey),
                      ]);
                      const siteCandidates = await this.selectDistrictSites(
                        countryId,
                        city,
                        seed,
                        width,
                        height,
                        (_origin, cells) => cells.every((cell) => !occupied.has(cellKey(cell))),
                        city.morphology === "DENSE_CORE",
                      );
                      let site = siteCandidates[0]!;
                      // A remote site receives its access road together with the
                      // territory: a collector stub runs from the nearest street
                      // to the site edge, so the first complex can anchor later.
                      // Sites already near the network skip it — their complexes
                      // connect on their own when they grow.
                      if (existingDistricts.length > 0) {
                        let connectedSite: typeof site | undefined;
                        const sealedCells = await this.completedDistrictCells(countryId);
                        const institutionalRoads = await this.institutionalAccessRoads(countryId);
                        const anchorRoads = [...existingRoads.values()].filter((road) =>
                          road.roadClass !== "HIGHWAY" && !institutionalRoads.has(cellKey(road))
                          && (!sealedCells.has(cellKey(road)) || neighbors4(road).some((cell) => !sealedCells.has(cellKey(cell)))));
                        // Try every compact candidate with straight square
                        // bends first. Only when none works do we pay for A*.
                        for (const allowObstacleRouting of [false, true]) {
                          for (const candidate of siteCandidates) {
                            if (await this.connectDistrictSite(
                              countryId, seed, candidate, occupied, existingRoads, sealedCells, anchorRoads,
                              allowObstacleRouting,
                            )) {
                              connectedSite = candidate;
                              break;
                            }
                          }
                          if (connectedSite) break;
                        }
                        if (!connectedSite) throw new DomainError("ROUTE_BLOCKED", "Не удалось проложить полноширинный подъезд к району");
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
                      await this.db.prepare("UPDATE districts_v3 SET status = 'PLANNED' WHERE city_id = ? AND status = 'ACTIVE'").run(String(row.city_id));
                      await this.db.prepare("UPDATE districts_v3 SET status = 'ACTIVE' WHERE id = ?").run(districtId);
                      const data = districtDto({ ...row, status: "ACTIVE" });
                      return { data, eventType: "district.activated", eventPayload: { districtId, cityId: data.cityId, affectedBounds: boundsOf(data.cells) } };
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

  private async buildingRulesAllow(entry: BuildingCatalogEntry, cityId: string, districtId: string): Promise<boolean> {
    for (const ruleId of entry.ruleIds) {
      switch (ruleId) {
        case "STANDARD": break;
        case "REQUIRES_COLLECTOR":
          if (!await this.districtHasCollector(districtId)) return false;
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

  private async entryAllowed(entry: BuildingCatalogEntry, cityId: string, districtId: string): Promise<boolean> {
    if (!await this.buildingRulesAllow(entry, cityId, districtId)) return false;
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
    if (hint) {
      const exact = TASK_BUILDING_CATALOG.find((entry) => entry.key === hint);
      if (!exact) throw new DomainError("INVALID_BUILDING_HINT", "Указанный тип здания не существует");
      if (exact.tags.includes("archive")) throw new DomainError("INVALID_BUILDING_HINT", "Корпуса Государственного архива не являются зданиями задач");
      if (!taskBuildingCompatibleWithArchetype(exact, archetype)) {
        throw new DomainError("INCOMPATIBLE_BUILDING", "Здание несовместимо с архитектурой выбранного района");
      }
      if (!await this.entryAllowed(exact, cityId, districtId)) throw new DomainError("BUILDING_QUOTA_REACHED", "Лимит этого типа здания уже достигнут");
      return [exact];
    }
    const tags = new Set(inferTaskTags(title, description));
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
      if (!entry.tags.includes("archive") && await this.entryAllowed(entry, cityId, districtId)
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
      ? primaryCandidates.filter((entry) => entry.footprint.width <= 14 && entry.footprint.height <= 12)
      : [];
    const supportCandidates = compatible.filter((entry) => !primaryZoningRole(archetype, buildingZoningRole(entry)));
    const candidates = requiredService
      ? compatible
      : wantsSupport && existingSupport < supportLimit && supportCandidates.length > 0
        ? supportCandidates
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
  ): Promise<{ origin: Cell; footprint: Cell[]; entrance: Cell; accessPath: Cell[]; accessKind: TaskDto["accessKind"] } | null> {
    if (lot.taskId || entry.footprint.width > lot.width || entry.footprint.height > lot.height) return null;
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
        const footprint = rectangleFootprint(origin, entry.footprint.width, entry.footprint.height);
        const footprintKeys = new Set(footprint.map(cellKey));
        if (footprint.some((cell) => roads.has(cellKey(cell)) || projected.has(cellKey(cell)) || occupied.has(cellKey(cell)))) continue;
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
        const edgePenalty = (origin.x - lot.origin.x) * 2;
        candidates.push({
          origin, footprint, entrance: access.entrance, accessPath: access.path,
          score: access.distance * 100 + bottomGap * 30 + partyBonus + edgePenalty,
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
  ): Promise<Array<{
                                lot: PlannedLotDto;
                                lots: PlannedLotDto[];
                                placement: NonNullable<Awaited<ReturnType<AppService["placementInLot"]>>>;
                                order: number;
                              }>> {
    const expectedRole = this.lotRoleForEntry(district.archetype, entry);
    const occupiedPerGroup = new Map<string, number>();
    for (const lot of district.lots) if (lot.taskId && lot.groupId) occupiedPerGroup.set(lot.groupId, (occupiedPerGroup.get(lot.groupId) ?? 0) + 1);
    const fitting = district.lots.filter((lot) => !lot.taskId && entry.footprint.width <= lot.width && entry.footprint.height <= lot.height);
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
      const placement = await this.placementInLot(countryId, candidates[index]!, entry, roads, surfaces, occupied, districtCells);
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
    return await this.mutate(countryId, "task.create.v3", input.idempotencyKey, input, async () => {
                      const city = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
                      if (!city) throw new DomainError("NOT_FOUND", "Город не найден");
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
                      const visualKind = input.visualKind ?? (input.buildingHint?.startsWith("park:") ? "PARK" : "BUILDING");
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
                      let roads = await this.roadCells(countryId);
                      // Neighbouring buildings are planned against permanent
                      // structure footprints, not temporary construction-site
                      // fences. The renderer may merge/overlap adjacent one-cell
                      // site envelopes while both tasks are under construction;
                      // treating that envelope as a permanent building setback
                      // made dense blocks lose roughly a quarter of their lots.
                      // Roads and world features still use taskOccupiedCells(),
                      // so they cannot cut through an active construction site.
                      const occupiedTasks = new Set((await this.listTasks(countryId)).flatMap((task) => task.footprint).map(cellKey));
                      // Walk the ranked candidates until one actually fits the
                      // ground. The favourite may be a tower with no lot wide
                      // enough; the next house down the list keeps growth alive
                      // instead of deadlocking the district.
                      const preferredCandidates = ranked.slice(0, 8);
                      // A varied large-building catalog must not deadlock a
                      // nearly full block. Keep a few compact fallbacks after
                      // the semantic favourites instead of scanning all 193
                      // entries (and repeatedly growing the district).
                      const compactFallbacks = ranked
                        .filter((candidate) => candidate.footprint.width <= 14 && candidate.footprint.height <= 12 && !preferredCandidates.includes(candidate))
                        .sort((left, right) =>
                          left.footprint.width * left.footprint.height - right.footprint.width * right.footprint.height
                          || left.footprint.width - right.footprint.width
                          || left.key.localeCompare(right.key))
                        .slice(0, 8);
                      const candidatePool = [...preferredCandidates, ...compactFallbacks];
                      const selectFromExistingLots = async () => {
                        const surfaces = await this.localSurfaceCells(countryId, boundsOf(district.cells), roads, [district]);
                        const districtCellKeys = new Set(district.cells.map(cellKey));
                        for (const candidate of candidatePool) {
                          const options = await this.taskPlacementOptions(
                            countryId,
                            district,
                            candidate,
                            roads,
                            surfaces,
                            occupiedTasks,
                            districtCellKeys,
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
                          && other.footprint.height === candidate.footprint.height) === index,
                      );
                      for (const growthCandidate of growthCandidates) {
                        if (placement) break;
                        try {
                          district = await this.growDistrict(countryId, district, growthCandidate);
                        } catch (error) {
                          if (!(error instanceof DomainError) || error.code !== "PLACEMENT_BLOCKED") throw error;
                          continue;
                        }
                        roads = await this.roadCells(countryId);
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
                        },
                        id,
                      );
                      await this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?").run(JSON.stringify(lots), district.id);
                      // A new building redevelops any ruin plot it overlaps.
                      await this.clearRuins(countryId, selected.placement.footprint);
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
                      this.surfaceCache.delete(countryId);
                      const data = await this.getTask(countryId, id);
                      return { data, eventType: "task.created", eventPayload: { taskId: id, districtId: district.id, buildingType: entry.key, affectedBounds: boundsOf(data.footprint) } };
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
                      return { data, eventType: "task.deleted", eventPayload: { ...data, affectedBounds: boundsOf([...task.footprint, ...task.accessPath]) } };
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
                          affectedBounds: boundsOf([...data.footprint, ...changedGreenArea]),
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

  private decorations(
    seed: number,
    terrain: ChunkDto["terrain"],
    blocked: Set<string>,
    surfaces: SurfaceCellDto[],
    districts: DistrictDto[],
    cities: CityDto[],
    tasks: TaskDto[],
  ): DecorationDto[] {
    const result: DecorationDto[] = [];
    const ambientCounts = { boats: 0, fishers: 0, residents: 0 };
    const occupied = new Set(blocked);
    const terrainByCell = new Map(terrain.map((cell) => [cellKey(cell), cell]));
    const surfaceKeys = new Set(surfaces.map(cellKey));
    const districtByCell = new Map(districts.flatMap((district) => district.cells.map((cell) => [cellKey(cell), district] as const)));
    const districtCellKeys = new Map(districts.map((district) => [district.id, new Set(district.cells.map(cellKey))]));
    const cityRanges = new Map([24, 72, 96].map((margin) => [margin, cities.map((city) => expandRect(city.bounds, margin))]));
    const closeToCity = (cell: Cell, margin = 72) => (cityRanges.get(margin) ?? []).some((bounds) => contains(bounds, cell));
    const adjacentToSurface = (cell: Cell) => neighbors4(cell).some((neighbor) => surfaceKeys.has(cellKey(neighbor)));
    const closeToBlocked = (cell: Cell, distance: number) => {
      for (let dy = -distance; dy <= distance; dy += 1) for (let dx = -distance; dx <= distance; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) <= distance && blocked.has(cellKey({ x: cell.x + dx, y: cell.y + dy }))) return true;
      }
      return false;
    };
    const waterDirection = (cell: Cell): "north" | "east" | "south" | "west" | undefined => {
      const names = ["north", "east", "south", "west"] as const;
      for (let distance = 1; distance <= 4; distance += 1) {
        for (let index = 0; index < GRID_DIRECTIONS.length; index += 1) {
          const direction = GRID_DIRECTIONS[index]!;
          const nearby = terrainByCell.get(cellKey({ x: cell.x + direction.x * distance, y: cell.y + direction.y * distance }));
          if (nearby && isWater(nearby.terrain)) return names[index];
        }
      }
      return undefined;
    };
    for (const cell of terrain) {
      if (occupied.has(cellKey(cell))) continue;
      const chance = hashCoordinate(seed, cell.x, cell.y, 701);
      let kind: string | undefined;
      let clearance = 0;
      const district = districtByCell.get(cellKey(cell));
      const shoreDirection = (cell.terrain === "SAND" || cell.terrain === "WET_SAND") && closeToCity(cell) ? waterDirection(cell) : undefined;
      if (cell.terrain === "DEEP_WATER" && closeToCity(cell, 96) && ambientCounts.boats < 3 && chance < 0.0005) {
        const horizontal = hashCoordinate(seed, cell.x, cell.y, 719) < 0.5;
        kind = `boat-${horizontal ? "horizontal" : "vertical"}-${hashCoordinate(seed, cell.x, cell.y, 727) < 0.5 ? "a" : "b"}`;
      } else if (shoreDirection && !closeToBlocked(cell, 1) && ambientCounts.fishers < 2 && chance < 0.0028) {
        kind = `fisher-${shoreDirection}`;
      } else if ((cell.terrain === "GRASS" || cell.terrain === "MEADOW") && closeToCity(cell, 24) && adjacentToSurface(cell) && ambientCounts.residents < 4 && chance < 0.014) {
        const residents = ["resident-reader", "resident-box", "resident-sweeper", "resident-phone", "resident-worker", "resident-wave"];
        const lampByArchetype: Record<DistrictArchetype, string> = {
          PRIVATE: "streetlamp-vintage", NEW_BUILD: "streetlamp-modern", MIXED_URBAN: "streetlamp-double",
          CIVIC: "streetlamp-solar", COMMERCIAL: "streetlamp-industrial",
        };
        kind = chance < 0.01 ? lampByArchetype[district?.archetype ?? "MIXED_URBAN"] : residents[Math.floor(hashCoordinate(seed, cell.x, cell.y, 733) * residents.length)];
      } else if (district && district.status !== "ACTIVE" && (cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < 0.006) {
        const own = districtCellKeys.get(district.id)!;
        const edge = GRID_DIRECTIONS.findIndex((direction) => !own.has(cellKey({ x: cell.x + direction.x, y: cell.y + direction.y })));
        if (edge >= 0) kind = edge % 2 === 0 ? "fence-horizontal" : "fence-vertical";
      } else if (cell.terrain === "FOREST" && chance < 0.17) {
        const forestTrees = ["tree-conifer", "tree-round", "tree-birch", "tree-pine", "tree-oak", "tree-cherry", "tree-maple", "tree-cedar", "tree-aspen", "tree-redwood", "tree-deadwood"];
        kind = forestTrees[Math.floor(hashCoordinate(seed, cell.x, cell.y, 739) * forestTrees.length)];
      } else if (cell.terrain === "HILL" && chance < 0.085) {
        kind = chance < 0.035 ? "hill-rocky" : chance < 0.06 ? "hill-small" : "tree-pine";
      } else if (cell.terrain === "MOUNTAIN" && chance < 0.075) {
        kind = chance < 0.03 ? "mountain-peak" : chance < 0.052 ? "mountain-ridge" : "rock-cluster";
      }
      else if ((cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < 0.016) {
        const variants = ["flower-white", "flower-yellow", "flower-red", "flower-purple", "bush-dark", "bush-light", "bush-berries", "shrub-hazel", "shrub-fern", "shrub-flowering", "shrub-dry", "shrub-juniper", "rock-small"];
        kind = variants[Math.floor(hashCoordinate(seed, cell.x, cell.y, 709) * variants.length)];
      } else if (cell.terrain === "STONE" && chance < 0.035) kind = chance < 0.017 ? "rock-small" : "rock-cluster";
      else if (cell.terrain === "SHALLOW_WATER" && chance < 0.02) kind = chance < 0.01 ? "reed-green" : "reed-cattail";
      if (kind) {
        const prop = PROP_CATALOG[kind];
        if (!prop) continue;
        const footprint = rectangleFootprint(cell, prop.footprint.width, prop.footprint.height);
        const ownDistrict = district ? districtCellKeys.get(district.id) : undefined;
        const footprintValid = footprint.every((part) => {
          const terrainCell = terrainByCell.get(cellKey(part));
          if (!terrainCell || occupied.has(cellKey(part))) return false;
          if (kind!.startsWith("boat-") && terrainCell.terrain !== "DEEP_WATER") return false;
          if (kind!.startsWith("fisher-") && terrainCell.terrain !== "SAND" && terrainCell.terrain !== "WET_SAND") return false;
          if (kind!.startsWith("fence-") && !ownDistrict?.has(cellKey(part))) return false;
          return true;
        });
        if (!footprintValid) continue;
        const landform = kind.startsWith("hill-") || kind.startsWith("mountain-");
        clearance = landform ? 2 : clearance;
        let available = true;
        for (const part of footprint) {
          for (let dy = -clearance; dy <= clearance && available; dy += 1) {
            for (let dx = -clearance; dx <= clearance; dx += 1) {
              if (occupied.has(cellKey({ x: part.x + dx, y: part.y + dy }))) { available = false; break; }
              if (landform && (dx !== 0 || dy !== 0) && hashCoordinate(seed, part.x + dx, part.y + dy, 701) < chance) { available = false; break; }
            }
          }
          if (!available) break;
        }
        if (!available) continue;
        result.push({ id: `${kind}:${cell.x}:${cell.y}`, kind, origin: { x: cell.x, y: cell.y } });
        if (kind.startsWith("boat-")) ambientCounts.boats += 1;
        else if (kind.startsWith("fisher-")) ambientCounts.fishers += 1;
        else if (kind.startsWith("resident-")) ambientCounts.residents += 1;
        for (const part of footprint) {
          for (let dy = -clearance; dy <= clearance; dy += 1) {
            for (let dx = -clearance; dx <= clearance; dx += 1) occupied.add(cellKey({ x: part.x + dx, y: part.y + dy }));
          }
        }
      }
    }
    // Sparse frontage trees make large paved parcels feel inhabited without
    // turning every sidewalk cell into an obstacle. Selection is stable per
    // task, stays off its access route and keeps four cells between trunks.
    const taskAccess = new Set(tasks.flatMap((task) => task.accessPath).map(cellKey));
    const streetTrees = ["tree-oak", "tree-maple", "tree-round", "tree-aspen", "tree-birch", "tree-apple", "tree-cherry", "tree-magnolia"];
    const streetTreeCells: Cell[] = [];
    for (const task of tasks) {
      if (task.visualKind !== "BUILDING" || task.stage < 3 || task.footprint.length < 80) continue;
      const own = new Set(task.footprint.map(cellKey));
      const candidates = [...new Map(task.footprint.flatMap(neighbors4).map((cell) => [cellKey(cell), cell])).values()]
        .filter((cell) => !own.has(cellKey(cell)) && surfaceKeys.has(cellKey(cell)) && !taskAccess.has(cellKey(cell))
          && terrainByCell.has(cellKey(cell)))
        .sort((left, right) => hashCoordinate(seed + task.taskNumber, left.x, left.y, 751)
          - hashCoordinate(seed + task.taskNumber, right.x, right.y, 751));
      const target = task.footprint.length >= 150 ? 2 : 1;
      let placed = 0;
      for (const cell of candidates) {
        if (placed >= target) break;
        if (streetTreeCells.some((tree) => manhattan(tree, cell) < 4)) continue;
        const kind = streetTrees[Math.floor(hashCoordinate(seed + task.taskNumber, cell.x, cell.y, 757) * streetTrees.length)]!;
        result.push({ id: `street-tree:${task.id}:${cell.x}:${cell.y}`, kind, origin: cell });
        streetTreeCells.push(cell);
        placed += 1;
      }
    }
    return result;
  }

  async getChunk(countryId: string, chunkX: number, chunkY: number, lod: "DETAIL" | "OVERVIEW" = "DETAIL"): Promise<ChunkDto> {
    const country = await this.countryRow(countryId);
    const worldVersion = Number(country.world_version);
    this.knownWorldVersions.set(countryId, Math.max(worldVersion, this.knownWorldVersions.get(countryId) ?? 0));
    const cacheKey = `${countryId}:${chunkX}:${chunkY}:${lod}`;
    const cached = this.cachedChunk(cacheKey, worldVersion);
    if (cached) return cached;
    const pendingKey = `${cacheKey}:${worldVersion}`;
    let pending = this.pendingChunkBuilds.get(pendingKey);
    if (!pending) {
      pending = this.buildChunk(countryId, chunkX, chunkY, lod, country, cacheKey, worldVersion);
      this.pendingChunkBuilds.set(pendingKey, pending);
    }
    try {
      return { ...await pending, worldVersion };
    } finally {
      if (this.pendingChunkBuilds.get(pendingKey) === pending) this.pendingChunkBuilds.delete(pendingKey);
    }
  }

  private async buildChunk(
    countryId: string,
    chunkX: number,
    chunkY: number,
    lod: "DETAIL" | "OVERVIEW",
    country: Row,
    cacheKey: string,
    worldVersion: number,
  ): Promise<ChunkDto> {
    const seed = Number(country.seed);
    const minX = chunkX * CHUNK_SIZE;
    const minY = chunkY * CHUNK_SIZE;
    const chunkBounds = { minX, minY, maxX: minX + CHUNK_SIZE - 1, maxY: minY + CHUNK_SIZE - 1 };
    const terrain: ChunkDto["terrain"] = [];
    const terrainStep = lod === "OVERVIEW" ? 4 : 1;
    for (let y = chunkBounds.minY; y <= chunkBounds.maxY; y += terrainStep) {
      for (let x = chunkBounds.minX; x <= chunkBounds.maxX; x += terrainStep) terrain.push({ x, y, ...terrainAt(seed, x, y) });
    }
    const roadRows = async (bounds: Rect) => (await this.db.prepare("SELECT x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?")
                      .all(countryId, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY) as Row[]).map((row) => ({
      x: Number(row.x), y: Number(row.y), mask: Number(row.mask), structure: String(row.structure) as RoadCellDto["structure"], roadClass: String(row.road_class) as RoadCellDto["roadClass"],
    }));
    const surfaceScope = lod === "DETAIL" ? expandRect(chunkBounds, 2) : chunkBounds;
    const [surfaceRoads, nearbyDistricts, nearbyCities, nearbyTasks, nearbyFeatures] = await Promise.all([
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
    const defectSummaryByTask = new Map<string, NonNullable<ChunkTaskDto["defectSummary"]>>();
    if (lod === "DETAIL" && chunkTasks.length > 0) {
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
      .filter((feature) => feature.footprint.some((cell) => contains(chunkBounds, cell)) || feature.accessPath.some((cell) => contains(chunkBounds, cell)))
      .map((feature) => feature.kind === "CITY_SIGN" && feature.cityId ? { ...feature, label: cityNames.get(feature.cityId) } : feature);
    const surfaces = lod === "OVERVIEW" ? (() => {
      const roadKeys = new Set(roads.map(cellKey));
      const blockedKeys = new Set([
        ...chunkTasks.flatMap((task) => task.footprint).map(cellKey),
        ...nearbyFeatures.flatMap((feature) => feature.footprint).map(cellKey),
      ]);
      const paths = new Map<string, SurfaceCellDto>();
      const publish = (cell: Cell) => {
        const key = cellKey(cell);
        if (contains(chunkBounds, cell) && !roadKeys.has(key) && !blockedKeys.has(key)) paths.set(key, { ...cell, kind: "PATH", finish: "PAVERS" });
      };
      // The pedestrian layer follows the streets: every road edge carries a
      // sidewalk in the overview too, so frontage access stays visible at the
      // zoomed-out level even when no extra footpath was needed.
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
          if (contains(chunkBounds, cell) && !roadKeys.has(cellKey(cell))) paths.set(cellKey(cell), { ...cell, kind: "PATH", finish: "PAVERS" });
        }
      }
      for (const task of nearbyTasks) if (task.accessKind === "PATH") for (const cell of task.accessPath) publish(cell);
      return [...paths.values()];
    })() : [...buildSurfaceMap({
                      roads: new Map(surfaceRoads.map((road) => [cellKey(road), road])),
                      cities: nearbyCities,
                      districts: nearbyDistricts,
                      tasks: nearbyTasks,
                      features: nearbyFeatures,
                      isSurfaceTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
                    }).values()].filter((surface) => contains(chunkBounds, surface));
    const blocked = new Set<string>([
      ...roads.map(cellKey),
      ...surfaces.map(cellKey),
      ...chunkTasks.flatMap((task) => task.footprint).map(cellKey),
      ...worldFeatures.flatMap((feature) => feature.footprint).map(cellKey),
    ]);
    const chunk: ChunkDto = {
      chunkX, chunkY, size: CHUNK_SIZE, terrain, roads, surfaces, districts,
      tasks: chunkTasks.map((task) => ({
        id: task.id, taskNumber: task.taskNumber, cityId: task.cityId, districtId: task.districtId, title: task.title,
        workItemType: task.workItemType,
        ...(lod === "DETAIL" && defectSummaryByTask.has(task.id) ? { defectSummary: defectSummaryByTask.get(task.id) } : {}),
        status: task.status, progress: task.progress, stage: task.stage,
        buildingType: task.buildingType, visualKind: task.visualKind, visualAssetKey: task.visualAssetKey,
        platformType: task.platformType, origin: task.origin, footprint: task.footprint,
      })),
      worldFeatures,
      decorations: lod === "DETAIL" ? this.decorations(seed, terrain, blocked, surfaces, nearbyDistricts, nearbyCities, nearbyTasks) : [],
      worldVersion,
    };
    // A mutation can commit while a cold chunk is being assembled. Its newer
    // request has a different single-flight key; do not let this older result
    // repopulate the invalidated cache afterwards.
    if ((this.knownWorldVersions.get(countryId) ?? worldVersion) !== worldVersion) return chunk;
    return this.storeChunk(cacheKey, chunk);
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
