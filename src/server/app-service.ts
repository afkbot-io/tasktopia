import { createHash,randomUUID } from "node:crypto";
import { mkdir,unlink,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blockSlots } from "../shared/block-templates";
import { blockTaskRange } from "../shared/block-plaque";
import { isTaskParkVariant } from "../shared/task-park-catalog";
import type { CompiledBlockLayoutV1 } from "../shared/block-world";
import {
ASSET_REVISION,
BUILDING_CATALOG
} from "../shared/catalog";
import { CITY_SCENE_SCHEMA_VERSION,type CitySceneDto } from "../shared/city-scene-contract";
import { transportEndpointFromPlacementRow, readCityAirportConnections } from "./world/city-airport-connections";
import {
STATUS_PROGRESS_RANGE,
TASK_STAGE,
type ArchiveRecordDto,
type ArchiveRecordKind,
type BootstrapDto,
type BuildingEventContext,
type Cell,
type ChunkDto,
type ChunkLod,
type ChunkPayloadDto,
type ChunkPayloadV2Dto,
type ChunkTaskDto,
type CityDto,
type CityMorphology,
type CountryArchiveDto,
type CountryDto,
type DistrictArchetype,
type DistrictDto,
type DistrictStatus,
type Estimate,
type PlanCityDto,
type PlanCityPageDto,
type PlanDistrictDto,
type PlanTaskDto,
type RealtimeEvent,
type Rect,
type RoadCellDto,
type SurfaceCellDto,
type TaskAttachmentDto,
type TaskChecklistItemDto,
type TaskCommentDto,
type TaskDefectDto,
type TaskDocumentDto,
type TaskDto,
type TaskEventDto,
type TaskLinkDto,
type TaskPriority,
type TaskResolutionDto,
type TaskSearchResultDto,
type TaskStatus,
type WorkItemType,
type WorldFeatureDto
} from "../shared/contracts";
import { COUNTRY_OVERVIEW_SCHEMA_VERSION,encodeCountryTerrain,type CountryOverviewDistrictDto,type CountryOverviewDto } from "../shared/country-overview-contract";
import { countryOverviewEventImpact } from "../shared/country-overview-events";
import { greenAreaPathCells } from "../shared/green-area";
import { projectPlanetAtlas } from "../shared/planet-atlas";
import { PLANET_ATLAS_SCHEMA_VERSION,type PlanetAtlasDto } from "../shared/planet-atlas-contract";
import { compactCellRuns,compactRoadRuns,compactSurfaceRuns } from "../shared/world-cell-runs";
import { materializeChunkPayload } from "../shared/world-chunk-payload";
import { hashCoordinate,isBuildableTerrain,terrainAt } from "../shared/world-terrain";
import { findCompactCitySite } from "./world/compact-city-site";
import { freezePermanentSiteGeometry, permanentSiteBounds, readPermanentSiteFeatures } from "./world/permanent-task-sites";
import { listAccessibleCountries,registerUser,type AuthUser,type RegistrationInput } from "./auth";
import { config } from "./config";
import type { Db } from "./db";
import { isTransactionActive,now,onTransactionCommit,onTransactionRollback,transaction } from "./db";
import type { SharedWorldCache } from "./optional-redis-cache";
import { readTaskDetailRow,taskDetailRows } from "./task-detail-read";
import { blockTaskGeometry,readActiveBlockLayout,readActiveBlockLayouts,synchronizeCityBlocks,CitySceneCapacityError } from "./world/active-block-layout";
import { readCountryRoads, synchronizeCountryRoads } from "./world/intercity-road-store";
import { citySceneIntercityRoads, intercityRoadCorridors, intercityRoadRasterNetwork } from "../shared/intercity-roads";
import { projectCountryRoads } from "./world/country-road-projection";
import { rasterizeBlockRoads,BlockPlacementError,BlockReservationConflictError,UniqueBuildingConflictError } from "./world/block-layout-compiler";
import { chunkPayloadContentHash } from "./world/chunk-payload-hash";
import { buildDecorationHardHalo } from "./world/decoration-halo";
import {
buildSurfaceMap,
buildingApronCells,
buildingGapPaths,
chooseDistrictArchetype,
entranceOutside
} from "./world/city-generation";
import { buildCountryGeography,countryMacroContext,createCountryWorldProjection } from "./world/country-geography";
import { projectCountryCityMiniature,projectCountryOverview } from "./world/country-overview";
import {
boundsOf,
cellKey,
contains,
expandRect,
floorDiv,
intersects,
neighbors4,
rectangleFootprint
} from "./world/grid";

export const CHUNK_SIZE = 64;
const COUNTRY_VIEW_MARGIN = 54;
const SPRINT_COLORS = ["#52a8d8", "#dfa94b", "#9877c7", "#69ad67", "#c86f67", "#4fb49f", "#d585b4"];
// Whitelist only operations whose result is a spatial entity DTO. Documents,
// attachments, checklist items, defects and deletion receipts retain their
// original result shapes even when they contain an id or taskId.
const SPATIAL_RESULT_KINDS = new Map<string, "city" | "district" | "task">([
  ...["city.create", "city.create.v3", "city.rename.v1", "city.update.v18"].map(operation => [operation, "city"] as const),
  ...["district.create", "district.create.v3", "district.rename.v1", "district.update.v18", "district.activate.v3", "district.complete.v3"]
    .map(operation => [operation, "district"] as const),
  ...["task.create", "task.create.v3", "task.link.add.v1", "task.link.remove.v1", "task.rename.v1", "task.fields.v18",
    "task.status.v3", "task.comment.v3", "task.assign.v7", "task.dependency.add.v1", "task.dependency.remove.v1", "task.transfer.v1"]
    .map(operation => [operation, "task"] as const),
]);

type Row = Record<string, unknown>;
type GrowthDirection = DistrictDto["growthDirection"];

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

class StaleChunkBuildError extends Error {}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
    cells: [],
    lots: [],
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
    serviceRole: row.service_role as TaskDto["serviceRole"],
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

export interface WorldGenerationDispatcher {
  execute<T>(
    countryId: string,
    operation: "city.create" | "district.create" | "task.create" | "country.regenerate",
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<T>;
}

export class AppService {
  private readonly blockLayouts = new Map<string, { revision: number; promise: Promise<CompiledBlockLayoutV1 | undefined> }>();
  private readonly chunkCache = new Map<string, ChunkPayloadDto>();
  private readonly pendingChunkBuilds = new Map<string, Promise<ChunkPayloadDto>>();
  private readonly knownWorldVersions = new Map<string, number>();
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

  private async activeLayout(cityId: string): Promise<CompiledBlockLayoutV1 | undefined> {
    if (isTransactionActive()) return readActiveBlockLayout(this.db,cityId);
    const head=await this.db.prepare("SELECT revision FROM city_layouts_v1 WHERE city_id=? AND status='ACTIVE'").get<{revision:number}>(cityId);
    if(!head){this.blockLayouts.delete(cityId);return undefined;}
    const cached=this.blockLayouts.get(cityId);
    if(cached?.revision===Number(head.revision)) return cached.promise;
    const promise=readActiveBlockLayout(this.db,cityId).catch(error=>{this.blockLayouts.delete(cityId);throw error;});
    this.blockLayouts.set(cityId,{revision:Number(head.revision),promise});
    while(this.blockLayouts.size>32) this.blockLayouts.delete(this.blockLayouts.keys().next().value!);
    return promise;
  }

  private async synchronizeBlocks(countryId: string, cityId: string, reset = false): Promise<CompiledBlockLayoutV1> {
    let layout: CompiledBlockLayoutV1;
    try {
      layout = await synchronizeCityBlocks(this.db, countryId, cityId, reset);
    } catch (error) {
      if (error instanceof UniqueBuildingConflictError) throw new DomainError("INVALID_INPUT", error.message);
      if (error instanceof BlockReservationConflictError) throw new DomainError("INFRASTRUCTURE_RESERVATION_CONFLICT", error.message);
      if (error instanceof BlockPlacementError) throw new DomainError("PLACEMENT_UNAVAILABLE", "Для нового квартала нет связанной свободной площадки. Создайте другой город или пересоберите планировку.");
      if (error instanceof CitySceneCapacityError) throw new DomainError("CAPACITY_EXCEEDED", "Город достиг предела размера карты. Создайте новый город для дальнейшего строительства.");
      throw error;
    }
    this.blockLayouts.delete(cityId);
    onTransactionRollback(() => { this.blockLayouts.delete(cityId); });
    return layout;
  }

  private async projectTasks(rows: Row[]): Promise<TaskDto[]> {
    const geometry = new Map<string, ReturnType<typeof blockSlots>[number]>();
    for (const cityId of new Set(rows.map((row) => String(row.city_id)))) {
      const layout = await this.activeLayout(cityId);
      if (layout) for (const [taskId, slot] of blockTaskGeometry(layout)) geometry.set(taskId, slot);
    }
    return rows.map((row) => {
      const slot = geometry.get(String(row.id));
      if (!slot) throw new DomainError("WORLD_REGENERATION_REQUIRED", "Геометрия города ещё не пересобрана. Требуется перегенерация мира.");
      return taskDto({ ...row, building_type: slot.buildingFamily ?? row.building_type,
        service_role: slot.serviceRole,
        visual_asset_key: row.visual_kind === "BUILDING" ? slot.buildingFamily ?? row.building_type : row.visual_asset_key,
        origin_x: slot.origin.x, origin_y: slot.origin.y,
        footprint_json: slot.footprint, entrance_x: slot.entrance.x, entrance_y: slot.entrance.y,
        access_json: slot.accessPath, access_kind: "PATH" });
    });
  }

  private async layoutsInBounds(countryId: string, bounds?: Rect): Promise<CompiledBlockLayoutV1[]> {
    const cities = bounds ? await this.citiesInBounds(countryId, bounds) : await this.listCities(countryId);
    const layouts = await Promise.all(cities.map((city) => this.activeLayout(city.id)));
    return layouts.filter((layout): layout is CompiledBlockLayoutV1 => Boolean(layout));
  }

  private sharedChunkKey(cacheKey: string, worldVersion: number): string {
    return `chunk:${cacheKey}:${worldVersion}`;
  }

  private validChunkIdentity(payload: ChunkPayloadDto | undefined, chunkX: number, chunkY: number, lod: ChunkLod): payload is ChunkPayloadDto {
    return Boolean(payload
      && payload.chunkX === chunkX && payload.chunkY === chunkY && payload.lod === lod
      && payload.payloadVersion === 2 && payload.generatorVersion === "block-v1"
      && Array.isArray(payload.blockPlaques)
      && payload.decorationContext?.treeGeometryVersion === 7
      && payload.decorationContext.lightingVersion === 1
      && Array.isArray(payload.decorationContext.surfaceHaloRuns));
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
    if (countryOverviewEventImpact(event) !== "NONE") {
      for (const key of this.countryOverviewCache.keys()) if (key.includes(`:${event.countryId}:`)) this.countryOverviewCache.delete(key);
    }
    if (this.chunkInvalidationScope(event) !== "NONE") {
      for (const key of this.citySceneCache.keys()) if (key.startsWith(`${event.countryId}:`)) this.citySceneCache.delete(key);
    }
    const knownVersion = this.knownWorldVersions.get(event.countryId) ?? 0;
    if (event.worldVersion <= knownVersion) return;
    this.knownWorldVersions.set(event.countryId, event.worldVersion);
    if (this.chunkInvalidationScope(event) !== "NONE") this.blockLayouts.clear();
    this.invalidateChunkCache(event.countryId, event);

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
      task.id, task.task_number, task.title, task.visual_kind, task.status, task.progress,
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
    const layout = await this.activeLayout(String(row.city_id));
    const origin = layout ? blockTaskGeometry(layout).get(taskId)?.origin : undefined;
    if (!origin) return undefined;
    return {
      id: String(row.id),
      taskNumber: Number(row.task_number),
      title: String(row.title),
      visualKind: String(row.visual_kind ?? "BUILDING") as BuildingEventContext["visualKind"],
      status,
      progress: Number(row.progress),
      stage: TASK_STAGE[status],
      origin,
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

  /** Command identity survives renderer migrations; only its read projection changes. */
  async rehydrateGenerationResult<T>(countryId: string, operation: string, result: T): Promise<T> {
    const kind = SPATIAL_RESULT_KINDS.get(operation);
    if (!kind) return result;
    const id = result && typeof result === "object" && "id" in result ? result.id : undefined;
    if (typeof id !== "string") throw new DomainError("NOT_FOUND", "Сохранённый результат операции больше недоступен");
    if (kind === "task") return await this.getTask(countryId, id) as T;
    if (kind === "city") {
      const row = await this.db.prepare("SELECT * FROM cities_v3 WHERE id=? AND country_id=?").get<Row>(id, countryId);
      if (!row) throw new DomainError("NOT_FOUND", "Созданный город удалён");
      return cityDto(row) as T;
    }
    const row = await this.db.prepare("SELECT d.city_id FROM districts_v3 d JOIN cities_v3 c ON c.id=d.city_id WHERE d.id=? AND c.country_id=?")
      .get<Row>(id, countryId);
    if (!row) throw new DomainError("NOT_FOUND", "Созданный район удалён");
    const district = (await this.listDistricts(countryId, String(row.city_id))).find(value => value.id === id);
    if (!district) throw new DomainError("NOT_FOUND", "Созданный район удалён");
    return district as T;
  }

  private async mutate<T>(countryId: string, operation: string, idempotencyKey: string, payload: unknown, callback: () => Promise<{ data: T; eventType: string; eventPayload: Record<string, unknown> }> | { data: T; eventType: string; eventPayload: Record<string, unknown> }): Promise<T> {
    if (!idempotencyKey || idempotencyKey.length > 160) throw new DomainError("INVALID_INPUT", "Нужен корректный idempotencyKey");
    const requestHash = stableHash(payload);
    const existing = await this.db.prepare("SELECT request_hash, response_json FROM idempotency WHERE country_id = ? AND operation = ? AND idempotency_key = ?")
                      .get(countryId, operation, idempotencyKey) as Row | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) throw new DomainError("CONFLICT", "Этот idempotencyKey уже использован с другими данными");
      return this.rehydrateGenerationResult(countryId, operation, json<T>(existing.response_json));
    }
    let emitted: RealtimeEvent | undefined;
    const data = await transaction(this.db, async () => {
                                await this.db.prepare("SELECT id FROM countries WHERE id = ? FOR UPDATE").get(countryId);
                                const raced = await this.db.prepare("SELECT request_hash, response_json FROM idempotency WHERE country_id = ? AND operation = ? AND idempotency_key = ?")
                                                                                                      .get(countryId, operation, idempotencyKey) as Row | undefined;
                                if (raced) {
                                  if (raced.request_hash !== requestHash) throw new DomainError("CONFLICT", "Этот idempotencyKey уже использован с другими данными");
                                  return this.rehydrateGenerationResult(countryId, operation, json<T>(raced.response_json));
                                }
                                const result = await callback();
                                if (["city.created", "city.deleted", "district.created", "district.deleted", "task.created", "task.deleted", "task.transferred", "country.regenerated"].includes(result.eventType)) {
                                  // A newly connected remote city also needs a
                                  // fresh scene. Ordinary task changes must not
                                  // evict unrelated cities' retained canvases.
                                  const changed = await this.db.prepare(`SELECT revision FROM country_road_snapshots_v1
                                    WHERE country_id=? AND updated_at=transaction_timestamp()`).get(countryId);
                                  if (changed) result.eventPayload.groundRoadTopologyChanged = true;
                                }
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
        SELECT city.country_id, COUNT(*)::integer AS city_count,
          MIN((city.bounds_json->>'minX')::integer) AS min_x,
          MIN((city.bounds_json->>'minY')::integer) AS min_y,
          MAX((city.bounds_json->>'maxX')::integer) AS max_x,
          MAX((city.bounds_json->>'maxY')::integer) AS max_y
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
        city_stats.min_x, city_stats.min_y, city_stats.max_x, city_stats.max_y,
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
    const clusterRows = await this.db.prepare(`SELECT city.country_id,city.id,city.center_x,city.center_y,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',d.id,'center',jsonb_build_object(
        'x',site.origin_x+site.width/2,'y',site.origin_y+site.height/2)) ORDER BY d.created_at,d.id),'[]')
        FROM districts_v3 d JOIN LATERAL (
          SELECT b.origin_x,b.origin_y,b.width,b.height FROM city_layouts_v1 l
          JOIN district_layouts_v1 dl ON dl.layout_id=l.id AND dl.district_id=d.id
          JOIN city_blocks_v1 b ON b.district_layout_id=dl.id AND b.layout_id=l.id
          WHERE l.city_id=city.id AND l.country_id=city.country_id AND l.status='ACTIVE'
            AND EXISTS(SELECT 1 FROM task_placements_v1 p JOIN tasks_v3 t ON t.id=p.task_id
              WHERE p.block_id=b.id AND p.layout_id=l.id AND t.district_id=d.id)
          ORDER BY b.sequence,b.id LIMIT 1
        ) site ON true WHERE d.city_id=city.id) AS districts,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('taskId',p.task_id,'slotKey',p.slot_key,'role',b.parameters_json->'slotRoles'->>p.slot_key,'block',to_jsonb(b)) ORDER BY p.task_id),'[]')
        FROM city_layouts_v1 l JOIN city_blocks_v1 b ON b.layout_id=l.id
        JOIN task_placements_v1 p ON p.block_id=b.id AND p.layout_id=l.id
        JOIN tasks_v3 t ON t.id=p.task_id AND t.city_id=city.id AND t.status='COMPLETED'
        WHERE l.city_id=city.id AND l.country_id=city.country_id AND l.status='ACTIVE' AND p.construction_stage=5
        AND b.parameters_json->'slotRoles'->>p.slot_key IN ('AIRPORT','RAILWAY')) AS airports
      FROM cities_v3 city JOIN country_members member ON member.country_id=city.country_id
      WHERE member.user_id=? ORDER BY city.created_at,city.id`).all<Row>(userId);
    const clusters = new Map<string, PlanetAtlasDto["countries"][number]["cities"]>();
    for (const row of clusterRows) {
      const group = clusters.get(String(row.country_id)) ?? [];
      const infrastructure = json<Array<{ taskId: string; slotKey: string; role?: "AIRPORT" | "RAILWAY"; block: Row }>>(row.airports);
      const endpoints = (role: "AIRPORT" | "RAILWAY") => infrastructure.filter(item => (item.role ?? "AIRPORT") === role).map(item => ({
        taskId: item.taskId,
        center: transportEndpointFromPlacementRow({ ...item.block, task_id: item.taskId, slot_key: item.slotKey, airport_city_id: row.id }, role).point,
      }));
      group.push({id:String(row.id),center:{x:Number(row.center_x),y:Number(row.center_y)},districts:json(row.districts),airports:endpoints("AIRPORT"),stations:endpoints("RAILWAY")});
      clusters.set(String(row.country_id),group);
    }
    const countries = rows.map((row) => ({
      id: String(row.id), name: String(row.name), seed: Number(row.seed), worldVersion: Number(row.world_version),
      cityCount: Number(row.city_count), districtCount: Number(row.district_count), buildingCount: Number(row.building_count),
      unfinishedBuildingCount: Number(row.unfinished_building_count),
      progress: Math.max(0, Math.min(100, Number(row.progress))),
      cities: clusters.get(String(row.id)) ?? [],
      worldBounds: row.min_x == null ? null : {
        minX: Number(row.min_x), minY: Number(row.min_y), maxX: Number(row.max_x), maxY: Number(row.max_y),
      },
    }));
    const revisionSource = JSON.stringify(countries);
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
      worldVersion: Number(row.world_version), generatorVersion: "block-v1", createdAt: String(row.created_at),
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

  /** Atomically replace derived layouts; product rows, history and terrain seed stay intact. */
  async regenerateCountry(countryId: string, input: { confirmName: string; idempotencyKey: string }): Promise<{
    regenerated: true; countryId: string; seed: number; cities: number; districts: number; tasks: number;
  }> {
    if(this.generationDispatcher) return this.generationDispatcher.execute(countryId,"country.regenerate",input.idempotencyKey,input);
    return this.mutate(countryId,"country.regenerate.v1",input.idempotencyKey,input,async()=>{
      const country=await this.countryRow(countryId);
      if(input.confirmName.trim()!==String(country.name)) throw new DomainError("CONFIRMATION_MISMATCH","Для перегенерации укажите точное название страны");
      const cities=await this.listCities(countryId);
      const before=await this.db.prepare("SELECT t.id,t.task_number,t.status FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id WHERE c.country_id=? ORDER BY t.id").all(countryId);
      const counts=await this.db.prepare("SELECT COUNT(*) AS count FROM districts_v3 d JOIN cities_v3 c ON c.id=d.city_id WHERE c.country_id=?").get<{count:string}>(countryId);
      const rebuilt:CityDto[]=[];
      // Explicit regeneration replaces disposable routes and layouts in one
      // transaction; a failed rebuild restores both automatically.
      await this.db.prepare("DELETE FROM country_road_snapshots_v1 WHERE country_id=?").run(countryId);
      for(const city of cities) {
        const old=await readActiveBlockLayout(this.db,city.id);
        const rejected:CityDto[]=[];
        let completed=false;
        for(let attempt=0;attempt<8;attempt++) {
          const center=old && attempt===0 ? city.center : await this.nextCityCenter(countryId,Number(country.seed),[...rebuilt,...rejected]);
          await this.db.prepare("UPDATE cities_v3 SET center_x=?,center_y=? WHERE id=?").run(center.x,center.y,city.id);
          try {
            const layout=await this.synchronizeBlocks(countryId,city.id,true);
            rebuilt.push({...city,center,bounds:layout.bounds});completed=true;break;
          } catch(error) {
            if(!(error instanceof DomainError) || error.code!=="PLACEMENT_UNAVAILABLE") throw error;
            rejected.push({...city,center,bounds:{minX:center.x-2,minY:center.y-2,maxX:center.x+96,maxY:center.y+96}});
          }
        }
        if(!completed) throw new DomainError("PLACEMENT_UNAVAILABLE",`Не удалось безопасно пересобрать город «${city.name}»: нужна площадка для всех кварталов`);
      }
      const after=await this.db.prepare("SELECT t.id,t.task_number,t.status FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id WHERE c.country_id=? ORDER BY t.id").all(countryId);
      if(JSON.stringify(before)!==JSON.stringify(after)) throw new DomainError("REGENERATION_FAILED","Изменились задачи при пересборке геометрии");
      await synchronizeCountryRoads(this.db, countryId);
      await this.db.prepare("DELETE FROM world_chunk_payloads_v1 WHERE country_id=?").run(countryId);
      const data={regenerated:true as const,countryId,seed:Number(country.seed),cities:cities.length,districts:Number(counts?.count??0),tasks:after.length};
      return {data,eventType:"country.regenerated",eventPayload:data};
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

  private async roadsInBounds(countryId: string, bounds: Rect): Promise<RoadCellDto[]> {
    const [layouts, snapshot] = await Promise.all([
      this.layoutsInBounds(countryId, expandRect(bounds, 2)), readCountryRoads(this.db, countryId),
    ]);
    // Rasterize one union so masks at city exits see both sides of the join.
    // Individual raster concatenation would leave a false edge across the road.
    return rasterizeBlockRoads({ schemaVersion: 1, nodes: [], segments: [
      ...layouts.flatMap(layout => layout.roadNetwork.segments),
      ...intercityRoadRasterNetwork(snapshot?.plan.routes ?? []).segments,
    ] }, bounds);
  }

  async listDistricts(countryId: string, cityId?: string, bounds?: Rect): Promise<DistrictDto[]> {
    const rows=cityId?await this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id=d.city_id WHERE c.country_id=? AND c.id=? ORDER BY d.created_at,d.id").all<Row>(countryId,cityId):await this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id=d.city_id WHERE c.country_id=? ORDER BY d.created_at,d.id").all<Row>(countryId);
    const result=rows.map(districtDto);
    for(const currentCity of new Set(result.map(d=>d.cityId))) {
      const layout=await this.activeLayout(currentCity);
      if(!layout) continue;
      const taskBySlot=new Map(layout.placements.map(p=>[p.blockId+":"+p.slotKey,p.taskId]));
      const markers=new Set(layout.siteMarkers.map(p=>p.blockId+":"+p.slotKey));
      for(const district of result.filter(d=>d.cityId===currentCity)) {
        const dl=layout.districtLayouts.find(d=>d.districtId===district.id);
        if(!dl) continue;
        const ownedBlocks=layout.blocks.filter(b=>b.districtLayoutId===dl.id);
        district.blockPlaques = ownedBlocks.flatMap(b => {
          const numbers = Array.isArray(b.summary.taskNumbers) ? b.summary.taskNumbers.filter((n): n is number => typeof n === "number") : [];
          const label = blockTaskRange(numbers);
          return label ? [{ id: b.id, origin: { x: b.origin.x + Math.floor(b.width / 2), y: b.origin.y + 2 }, label, taskCount: numbers.length }] : [];
        });
        district.cells=ownedBlocks.flatMap(b=>{
          const minX=Math.max(b.origin.x+2,bounds?.minX??-Infinity),minY=Math.max(b.origin.y+2,bounds?.minY??-Infinity);
          const maxX=Math.min(b.origin.x+b.width-2,bounds?.maxX??Infinity),maxY=Math.min(b.origin.y+b.height-2,bounds?.maxY??Infinity);
          return minX>maxX||minY>maxY?[]:rectangleFootprint({x:minX,y:minY},maxX-minX+1,maxY-minY+1);
        });
        district.lots=ownedBlocks.flatMap(b=>blockSlots(b).map(slot=>({id:b.id+":"+slot.key,origin:slot.origin,width:slot.footprintBounds.maxX-slot.footprintBounds.minX+1,height:slot.footprintBounds.maxY-slot.footprintBounds.minY+1,slotKind:slot.kind,serviceRole:slot.serviceRole,orientation:"S" as const,taskId:taskBySlot.get(b.id+":"+slot.key)??null,vacant:!taskBySlot.has(b.id+":"+slot.key)&&!markers.has(b.id+":"+slot.key),groupId:b.id,sharedAccess:slot.accessPath})));
      }
    }
    return result;
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
    const storedSnapshot = await this.db.prepare(`SELECT payload_json FROM country_overview_snapshots_v1
      WHERE user_id = ? AND country_id = ? AND schema_version = ? AND planet_revision = ?`)
      .get<{ payload_json: CountryOverviewDto }>(userId, countryId, COUNTRY_OVERVIEW_SCHEMA_VERSION, planetAtlas.revision);
    const storedOverview = storedSnapshot?.payload_json;
    if (storedOverview?.schemaVersion === COUNTRY_OVERVIEW_SCHEMA_VERSION
      && storedOverview.countryId === countryId
      && storedOverview.geography.terrainCodes.length === storedOverview.geography.columns * storedOverview.geography.rows
      && storedOverview.geography.territoryCodes.length === storedOverview.geography.columns * storedOverview.geography.rows
      && storedOverview.cities.every((city) => city.miniature.cellSize === 8)) {
      this.countryOverviewCache.set(cacheKey, storedOverview);
      return storedOverview;
    }
    const [country, cities, districtRows] = await Promise.all([
      this.countryRow(countryId),
      this.listCities(countryId),
      this.db.prepare(`SELECT d.id, d.city_id, d.name, d.status, d.color, d.spatial_bounds_json,
        COUNT(t.id)::integer AS task_count,
        COALESCE(ROUND(AVG(t.progress)), 0)::integer AS progress
        FROM districts_v3 d
        JOIN cities_v3 c ON c.id = d.city_id
        LEFT JOIN tasks_v3 t ON t.district_id = d.id
        WHERE c.country_id = ?
        GROUP BY d.id, d.city_id, d.name, d.status, d.color, d.created_at
        ORDER BY d.created_at, d.id`).all(countryId) as Promise<Row[]>,
    ]);
    const projectedPlanet = projectPlanetAtlas(planetAtlas);
    const geography = buildCountryGeography({
      countryId,
      seed: Number(country.seed),
      macroCells: countryMacroContext(projectedPlanet, countryId),
    });
    const projection = projectCountryOverview(cities.map((city) => ({ id: city.id, sourceCenter: city.center })));
    const projectWorldPoint = createCountryWorldProjection(geography, projectedPlanet.countries.find(entry => entry.id === countryId)!);
    const cityAnchors = new Map(cities.map(city => {
      const projected = projectWorldPoint(city.center);
      if (!projected) throw new Error(`Canonical country projection is unavailable for city ${city.id}`);
      return [city.id, projected.point];
    }));
    const districtsByCity = new Map<string, CountryOverviewDistrictDto[]>();
    const layoutsByCity = new Map((await readActiveBlockLayouts(this.db,cities.map(city=>city.id))).map(layout=>[layout.cityId,layout]));
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
        territoryCodes: geography.cells.map((cell) => cell.selected ? "1" : cell.ownerCountryId ? "2" : "0").join(""),
      },
      cities: cities.map((city) => {
        const districts = districtsByCity.get(city.id) ?? [];
        return {
          id: city.id, name: city.name, status: city.status, sourceCenter: city.center, sourceBounds: city.bounds,
          atlasCenter: cityAnchors.get(city.id)!,
          progress: districts.length === 0
            ? 0
            : Math.round(districts.reduce((total, district) => total + district.progress, 0) / districts.length),
          districts,
          miniature: projectCountryCityMiniature({
            sourceBounds: city.bounds,
            layout: layoutsByCity.get(city.id) ?? null,
          }),
        };
      }),
      connections: projection.connections,
    };
    const airportCities = overviewWithoutRevision.cities.filter((city) => city.miniature.airports.length > 0);
    for (let index = 1; index < airportCities.length; index += 1) overviewWithoutRevision.connections.push({
      fromCityId: airportCities[index - 1]!.id, toCityId: airportCities[index]!.id,
    });
    const countryRoads = await readCountryRoads(this.db, countryId);
    if (!countryRoads && [...layoutsByCity.values()].some(layout => layout.blocks.length > 0)) {
      throw new DomainError("WORLD_REGENERATION_REQUIRED", "Межгородские дороги ещё не пересобраны. Требуется перегенерация мира.");
    }
    const roadProjection = projectCountryRoads({ routes: countryRoads?.plan.routes ?? [], geography,
      projectWorldPoint, cities: overviewWithoutRevision.cities });
    const geographyIndices = new Map(geography.cells.map(cell => [cell.id, cell.row * geography.grid.columns + cell.column]));
    const groundRoads: CountryOverviewDto["groundRoads"] = {
      revision: countryRoads?.revision ?? 0,
      routes: roadProjection.routes.map(route => ({ id: route.routeId, fromCityId: route.fromCityId, toCityId: route.toCityId,
        points: route.points, corridorCells: route.cellIds.map(id => geographyIndices.get(id)!) })),
      unavailable: [...countryRoads?.plan.unreachable ?? [], ...roadProjection.failures],
    };
    const overview: CountryOverviewDto = { ...overviewWithoutRevision, groundRoads, revision: stableHash({ ...overviewWithoutRevision, groundRoads }) };
    await this.db.prepare(`INSERT INTO country_overview_snapshots_v1
      (user_id, country_id, schema_version, planet_revision, payload_json, generated_at)
      VALUES (?, ?, ?, ?, ?::jsonb, now())
      ON CONFLICT (user_id, country_id) DO UPDATE SET
        schema_version = EXCLUDED.schema_version,
        planet_revision = EXCLUDED.planet_revision,
        payload_json = EXCLUDED.payload_json,
        generated_at = EXCLUDED.generated_at`).run(
      userId, countryId, COUNTRY_OVERVIEW_SCHEMA_VERSION, planetAtlas.revision, JSON.stringify(overview),
    );
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
    const layout = await this.activeLayout(cityId);
    if (!layout) throw new DomainError("WORLD_REGENERATION_REQUIRED", "Геометрия города ещё не пересобрана. Требуется перегенерация мира.");
    const city = cityDto(cityRow);
    const cacheKey = `${countryId}:${cityId}:${Number(country.world_version)}`;
    const cached = this.citySceneCache.get(cacheKey);
    if (cached) {
      this.citySceneCache.delete(cacheKey);
      this.citySceneCache.set(cacheKey, cached);
      return cached;
    }
    const groundRoadSnapshot = await readCountryRoads(this.db, countryId);
    if (!groundRoadSnapshot && layout.blocks.length > 0) {
      throw new DomainError("WORLD_REGENERATION_REQUIRED", "Межгородские дороги ещё не пересобраны. Требуется перегенерация мира.");
    }
    // The fixed 160x100 frame is an opening camera composition, not a data
    // boundary. A city scene is the atomic read model for the whole city so
    // panning never exposes unloaded space or falls back to viewport/chunk
    // endpoints.
    const sceneBounds = city.bounds;
    const minChunkX = Math.floor(sceneBounds.minX / CHUNK_SIZE);
    const minChunkY = Math.floor(sceneBounds.minY / CHUNK_SIZE);
    const maxChunkX = Math.floor(sceneBounds.maxX / CHUNK_SIZE);
    const maxChunkY = Math.floor(sceneBounds.maxY / CHUNK_SIZE);
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
    const airportConnections = await readCityAirportConnections(this.db, countryId, cityId, city.center);
    const intercityRoads = citySceneIntercityRoads(groundRoadSnapshot?.plan.routes ?? [], cityId, {
      minX: minChunkX * CHUNK_SIZE, minY: minChunkY * CHUNK_SIZE,
      maxX: (maxChunkX + 1) * CHUNK_SIZE - 1, maxY: (maxChunkY + 1) * CHUNK_SIZE - 1,
    });
    const sceneIdentity = {
      schemaVersion: CITY_SCENE_SCHEMA_VERSION,
      cityId,
      bounds: city.bounds,
      airportConnections,
      intercityRoads,
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
      airportConnections,
      intercityRoads,
    };
    this.citySceneCache.set(cacheKey, scene);
    while (this.citySceneCache.size > 8) this.citySceneCache.delete(this.citySceneCache.keys().next().value!);
    return scene;
  }

  async listTasks(countryId: string, districtId?: string): Promise<TaskDto[]> {
    const rows = districtId
      ? await this.db.prepare("SELECT t.* FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? AND t.district_id = ? ORDER BY t.created_at").all(countryId, districtId)
      : await this.db.prepare("SELECT t.* FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? ORDER BY t.created_at").all(countryId);
    return this.projectTasks(rows as Row[]);
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
    const cities=await this.citiesInBounds(countryId,bounds);
    const districts=(await Promise.all(cities.map(city=>this.listDistricts(countryId,city.id,bounds)))).flat();
    return districts.flatMap(district=>{const cells=district.cells.filter(cell=>contains(bounds,cell));return cells.length?[{...district,cells}]:[];});
  }

  private async tasksInBounds(countryId: string, bounds: Rect, includeAccess = false): Promise<TaskDto[]> {
    const rows=await this.db.prepare(`SELECT t.* FROM tasks_v3 t JOIN task_placements_v1 p ON p.task_id=t.id JOIN city_layouts_v1 l ON l.id=p.layout_id AND l.status='ACTIVE' JOIN city_blocks_v1 b ON b.id=p.block_id
      WHERE l.country_id=? AND b.origin_x-2<=? AND b.origin_x+b.width+2>=? AND b.origin_y-2<=? AND b.origin_y+b.height+2>=? ORDER BY t.task_number`).all<Row>(countryId,bounds.maxX,bounds.minX,bounds.maxY,bounds.minY);
    return (await this.projectTasks(rows)).filter(task=>task.footprint.some(cell=>contains(bounds,cell))||includeAccess&&task.accessPath.some(cell=>contains(bounds,cell)));
  }

  private async featuresInBounds(countryId: string, bounds: Rect): Promise<WorldFeatureDto[]> {
    return readPermanentSiteFeatures(this.db,countryId,bounds);
  }

  async listWorldFeatures(countryId: string): Promise<WorldFeatureDto[]> {
    return readPermanentSiteFeatures(this.db,countryId);
  }

  async getTask(countryId: string, taskId: string): Promise<TaskDto> {
    const row = await readTaskDetailRow(this.db,countryId,taskId);
    if (!row) throw new DomainError("NOT_FOUND", "Задача не найдена");
    const task = (await this.projectTasks([row]))[0]!;
    task.comments = taskDetailRows(row,"comments").map((comment) => ({
      id: String(comment.id), taskId, body: String(comment.body), actor: String(comment.actor), createdAt: String(comment.created_at),
    }));
    const accounts = taskDetailRows(row,"accounts");
    const account = (userId: unknown) => {
      if (!userId) return null;
      const user = accounts.find(account=>account.id===userId);
      return user ? { id: String(user.id), email: String(user.email), name: String(user.name) } : null;
    };
    task.creator = account(row.creator_user_id);
    task.assignee = account(row.assignee_user_id);
    task.forUser = account(row.for_user_id);
    task.dependencies = taskDetailRows(row,"dependencies").map((dep) => ({
      id: String(dep.id), taskNumber: Number(dep.task_number), title: String(dep.title), status: String(dep.status) as TaskStatus,
    }));
    task.events = taskDetailRows(row,"events").map((event) => ({
      id: Number(event.id), taskId, type: String(event.event_type) as NonNullable<TaskDto["events"]>[number]["type"],
      actor: String(event.actor_label), actorUserId: event.actor_user_id ? String(event.actor_user_id) : null,
      details: json<Record<string, unknown>>(event.details_json), createdAt: String(event.created_at),
    }));
    task.defects = taskDetailRows(row,"defects").map((defect) => ({
      id: String(defect.id), taskId, title: String(defect.title), description: String(defect.description),
      reproductionSteps: String(defect.reproduction_steps), actualResult: String(defect.actual_result), expectedResult: String(defect.expected_result),
      status: String(defect.status) as TaskDefectDto["status"], fixedAt: defect.fixed_at ? String(defect.fixed_at) : null,
      createdAt: String(defect.created_at), updatedAt: String(defect.updated_at),
    }));
    task.attachments = taskDetailRows(row,"attachments").map(attachmentDto);
    task.documents = taskDetailRows(row,"documents").map(taskDocumentDto);
    task.checklist = taskDetailRows(row,"checklist").map(taskChecklistItemDto);
    return task;
  }

  async searchTasks(countryId: string, query: string, limit = 10): Promise<TaskSearchResultDto[]> {
    const text = query.trim();
    if (text.length === 0) return [];
    const bounded = Math.max(1, Math.min(25, limit));
    const rows = /^\d{1,9}$/.test(text)
      ? await this.db.prepare(`SELECT t.id, t.task_number, t.title, t.work_item_type, t.status, t.progress, t.city_id, t.district_id,
          city.name AS city_name, city.center_x AS city_center_x, city.center_y AS city_center_y, city.bounds_json AS city_bounds_json,
          district.name AS district_name
          FROM tasks_v3 t JOIN cities_v3 city ON city.id = t.city_id JOIN districts_v3 district ON district.id = t.district_id
          WHERE city.country_id = ? AND t.task_number = ?`).all(countryId, Number(text)) as Row[]
      : await this.db.prepare(`SELECT t.id, t.task_number, t.title, t.work_item_type, t.status, t.progress, t.city_id, t.district_id,
          city.name AS city_name, city.center_x AS city_center_x, city.center_y AS city_center_y, city.bounds_json AS city_bounds_json,
          district.name AS district_name
          FROM tasks_v3 t JOIN cities_v3 city ON city.id = t.city_id JOIN districts_v3 district ON district.id = t.district_id
          WHERE city.country_id = ? AND t.title ILIKE ? ESCAPE '\\'
          ORDER BY t.updated_at DESC LIMIT ?`).all(countryId, `%${text.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`, bounded) as Row[];
    return this.projectTaskSearchRows(rows);
  }

  async resolveTask(userId: string, input: { id: string } | { number: number; countryId: string }): Promise<TaskResolutionDto> {
    const byId = "id" in input;
    const row = await this.db.prepare(`SELECT t.id,t.task_number,t.title,t.work_item_type,t.status,t.progress,t.city_id,t.district_id,
      city.country_id,city.name AS city_name,city.center_x AS city_center_x,city.center_y AS city_center_y,
      city.bounds_json AS city_bounds_json,district.name AS district_name
      FROM tasks_v3 t JOIN cities_v3 city ON city.id=t.city_id
      JOIN districts_v3 district ON district.id=t.district_id
      JOIN country_members membership ON membership.country_id=city.country_id AND membership.user_id=?
      WHERE ${byId ? "t.id=?" : "city.country_id=? AND t.task_number=?"}`)
      .get<Row>(userId, ...("id" in input ? [input.id] : [input.countryId, input.number]));
    if (!row) throw new DomainError("NOT_FOUND", "Задача не найдена");
    return { ...(await this.projectTaskSearchRows([row]))[0]!, countryId: String(row.country_id) };
  }

  private async projectTaskSearchRows(rows: Row[]): Promise<TaskSearchResultDto[]> {
    const projected = new Map<string, Cell>();
    for (const cityId of new Set(rows.map(row=>String(row.city_id)))) {
      const layout=await this.activeLayout(cityId);
      if (layout) for(const [id,slot] of blockTaskGeometry(layout)) projected.set(id,slot.origin);
    }
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
        origin: (() => {
          const origin = projected.get(String(row.id));
          if (!origin) throw new DomainError("WORLD_REGENERATION_REQUIRED", "Для задачи отсутствует активный участок");
          return origin;
        })(),
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
  private async nextCityCenter(countryId: string, seed: number, existingCities?: CityDto[]): Promise<Cell> {
    const cities = existingCities ?? await this.listCities(countryId);
    if (cities.length >= 100) throw new DomainError("CAPACITY_EXCEEDED", "В стране уже 100 городов. Создайте другую страну для дальнейшего расширения.");
    const historical = await permanentSiteBounds(this.db,countryId,true);
    const roads = intercityRoadCorridors((await readCountryRoads(this.db, countryId))?.plan.routes ?? []);
    const site = findCompactCitySite(seed, [...cities.map(city => city.bounds),...historical], roads);
    if (site) return site;
    throw new DomainError("PLACEMENT_UNAVAILABLE","Не удалось найти сухую площадку для квартальной сетки города");
  }



  async createCity(countryId: string, input: {
    name: string; description?: string; goal?: string; acceptanceCriteria?: string; deadline?: string;
    morphology?: CityMorphology; idempotencyKey: string;
  }): Promise<CityDto> {
    const name=input.name.trim();
    if(name.length<2||name.length>100) throw new DomainError("INVALID_INPUT","Название города должно содержать от 2 до 100 символов");
    if(this.generationDispatcher) return this.rehydrateGenerationResult(countryId,"city.create",await this.generationDispatcher.execute<CityDto>(countryId,"city.create",input.idempotencyKey,input));
    return this.mutate(countryId,"city.create.v3",input.idempotencyKey,input,async()=>{
      const country=await this.countryRow(countryId);
      const center=await this.nextCityCenter(countryId,Number(country.seed));
      const id=randomUUID(),createdAt=now();
      const bounds={minX:center.x-4,minY:center.y-4,maxX:center.x+36,maxY:center.y+36};
      await this.db.prepare("INSERT INTO cities_v3(id,country_id,name,description,goal,acceptance_criteria,deadline,status,center_x,center_y,bounds_json,style_id,morphology,created_at) VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?,?,'compact-cartoon',?,?)")
        .run(id,countryId,name,input.description?.trim().slice(0,8000)??"",input.goal?.trim().slice(0,4000)??"",input.acceptanceCriteria?.trim().slice(0,8000)??"",input.deadline??null,center.x,center.y,JSON.stringify(bounds),input.morphology??"BALANCED",createdAt);
      const layout=await this.synchronizeBlocks(countryId,id);
      const data=(await this.listCities(countryId)).find(city=>city.id===id)!;
      return {data,eventType:"city.created",eventPayload:{cityId:id,center,affectedBounds:layout.bounds}};
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

  private async cityPresentationBounds(_countryId: string, city: CityDto): Promise<Rect> { return city.bounds; }

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

  async deleteCity(countryId: string, input: { cityId: string; confirmName: string; idempotencyKey: string }): Promise<{ deleted: true; cityId: string; name: string; districtsDeleted: number; tasksDeleted: number; roadsDeleted: number }> {
    return await this.mutate(countryId, "city.delete.v1", input.idempotencyKey, input, async () => {
                      const row = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
                      if (!row) throw new DomainError("NOT_FOUND", "Город не найден");
                      const city = cityDto(row);
                      if (input.confirmName.trim() !== city.name) throw new DomainError("CONFIRMATION_MISMATCH", "Для удаления укажите точное текущее название города");
                      const counts = await this.db.prepare(`SELECT
                        (SELECT COUNT(*) FROM districts_v3 WHERE city_id = ?) AS districts,
                        (SELECT COUNT(*) FROM tasks_v3 WHERE city_id = ?) AS tasks`).get(city.id, city.id) as Row;
                      const layout = await this.activeLayout(city.id);
                      const roadsDeleted = layout ? rasterizeBlockRoads(layout.roadNetwork).length : 0;
                      const tasks = await this.db.prepare(`SELECT p.layout_id,p.block_id,p.slot_key,
                        jsonb_build_object('taskNumber',t.task_number,'title',t.title,'buildingFamily',t.building_type,'lastStage',p.construction_stage) AS snapshot
                        FROM tasks_v3 t JOIN task_placements_v1 p ON p.task_id=t.id
                        JOIN city_layouts_v1 l ON l.id=p.layout_id AND l.status='ACTIVE' WHERE t.city_id=?`).all<Row>(city.id);
                      await this.db.prepare("DELETE FROM tasks_v3 WHERE city_id=?").run(city.id);
                      for (const p of tasks) await this.db.prepare(`INSERT INTO site_markers_v1
                        (id,layout_id,block_id,slot_key,kind,snapshot_json,asset_variant,created_at,updated_at)
                        VALUES(?,?,?,?,'RUINED',?::jsonb,'compact-rubble',?,?)`)
                        .run(randomUUID(),p.layout_id,p.block_id,p.slot_key,JSON.stringify(p.snapshot),now(),now());
                      await freezePermanentSiteGeometry(this.db,countryId);
                      // Product children and the semantic layout are scoped to this city.
                      await this.db.prepare("DELETE FROM cities_v3 WHERE id = ?").run(city.id);
                      await synchronizeCountryRoads(this.db, countryId);
                      this.blockLayouts.delete(city.id);
                      const data = {
                        deleted: true as const, cityId: city.id, name: city.name,
                        districtsDeleted: Number(counts.districts), tasksDeleted: Number(counts.tasks), roadsDeleted,
                      };
                      return { data, eventType: "city.deleted", eventPayload: { ...data, affectedBounds: city.bounds } };
                    });
  }

  async createDistrict(countryId: string, input: {
    cityId: string; name: string; goal?: string; description?: string; deadline?: string; capacitySp?: number;
    activate?: boolean; archetype?: DistrictArchetype; idempotencyKey: string;
  }): Promise<DistrictDto> {
    const name=input.name.trim();
    if(name.length<2||name.length>100) throw new DomainError("INVALID_INPUT","Название района должно содержать от 2 до 100 символов");
    if(this.generationDispatcher) return this.rehydrateGenerationResult(countryId,"district.create",await this.generationDispatcher.execute<DistrictDto>(countryId,"district.create",input.idempotencyKey,input));
    return this.mutate(countryId,"district.create.v3",input.idempotencyKey,input,async()=>{
      const row=await this.db.prepare("SELECT * FROM cities_v3 WHERE id=? AND country_id=?").get(input.cityId,countryId) as Row|undefined;
      if(!row) throw new DomainError("NOT_FOUND","Город не найден");
      const city=cityDto(row),existing=await this.listDistricts(countryId,input.cityId);
      if(input.activate && existing.some(d=>d.status==="ACTIVE")) throw new DomainError("CONFLICT","У города уже есть активный район");
      const archetype=chooseDistrictArchetype({requested:input.archetype,name,goal:input.goal??"",morphology:city.morphology,existing,variation:hashCoordinate(Number((await this.countryRow(countryId)).seed),city.center.x,city.center.y,existing.length)});
      const id=randomUUID();
      await this.db.prepare("INSERT INTO districts_v3(id,city_id,name,goal,description,deadline,status,capacity_sp,growth_direction,archetype,color,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id,city.id,name,input.goal?.trim().slice(0,4000)??"",input.description?.trim().slice(0,8000)??"",input.deadline??null,input.activate?"ACTIVE":"PLANNED",Math.max(1,Math.round(input.capacitySp??14)),"S",archetype,SPRINT_COLORS[existing.length%SPRINT_COLORS.length],now());
      const layout=await this.synchronizeBlocks(countryId,city.id);
      const data=(await this.listDistricts(countryId,city.id)).find(d=>d.id===id)!;
      return {data,eventType:"district.created",eventPayload:{districtId:id,cityId:city.id,affectedBounds:layout.bounds}};
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
                      const data = (await this.listDistricts(countryId,String(row.city_id))).find(d=>d.id===input.districtId)!;
                      return { data, eventType: "district.renamed", eventPayload: { districtId: input.districtId, cityId: data.cityId, name, affectedBounds: json<Rect>(row.spatial_bounds_json) } };
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
      const data = (await this.listDistricts(countryId,String(updated.city_id))).find(d=>d.id===input.districtId)!;
      return { data, eventType: "district.updated", eventPayload: { districtId: data.id, cityId: data.cityId, affectedBounds: json<Rect>(row.spatial_bounds_json) } };
    });
  }

  async deleteDistrict(countryId: string, input: { districtId: string; confirmName: string; idempotencyKey: string }): Promise<{ deleted: true; districtId: string; cityId: string; name: string; tasksDeleted: number; activatedDistrictId: string | null }> {
    return this.mutate(countryId,"district.delete.v1",input.idempotencyKey,input,async()=>{
      const district=(await this.listDistricts(countryId)).find(d=>d.id===input.districtId);
      if(!district) throw new DomainError("NOT_FOUND","Район не найден");
      if(input.confirmName.trim()!==district.name) throw new DomainError("CONFIRMATION_MISMATCH","Для удаления укажите точное название района");
      const count=await this.db.prepare("SELECT count(*) AS count FROM tasks_v3 WHERE district_id=?").get<{count:string}>(district.id);
      const markers=await this.db.prepare(`SELECT p.layout_id,p.block_id,p.slot_key,
        jsonb_build_object('taskId',t.id,'taskNumber',t.task_number,'title',t.title,'buildingFamily',t.building_type,'lastStage',p.construction_stage) AS snapshot
        FROM tasks_v3 t JOIN task_placements_v1 p ON p.task_id=t.id
        JOIN city_layouts_v1 l ON l.id=p.layout_id AND l.status='ACTIVE' WHERE t.district_id=?`).all(district.id);
      await this.db.prepare("DELETE FROM tasks_v3 WHERE district_id=?").run(district.id);
      await this.db.prepare(`INSERT INTO site_markers_v1(id,layout_id,block_id,slot_key,kind,snapshot_json,asset_variant,created_at,updated_at)
        SELECT gen_random_uuid()::text,x.layout_id,x.block_id,x.slot_key,'RUINED',x.snapshot,'compact-rubble',?,?
        FROM jsonb_to_recordset(?::jsonb) AS x(layout_id text,block_id text,slot_key text,snapshot jsonb)`)
        .run(now(),now(),JSON.stringify(markers));
      await this.db.prepare("UPDATE districts_v3 SET status='ABANDONED' WHERE id=?").run(district.id);
      let activatedDistrictId:string|null=null;
      if(district.status==="ACTIVE") {
        const next=await this.db.prepare("SELECT id FROM districts_v3 WHERE city_id=? AND status='PLANNED' ORDER BY created_at,id LIMIT 1").get<{id:string}>(district.cityId);
        if(next){activatedDistrictId=next.id;await this.db.prepare("UPDATE districts_v3 SET status='ACTIVE' WHERE id=?").run(next.id);}
      }
      const layout=await this.synchronizeBlocks(countryId,district.cityId);
      const data={deleted:true as const,districtId:district.id,cityId:district.cityId,name:district.name,tasksDeleted:Number(count?.count??0),activatedDistrictId};
      return {data,eventType:"district.deleted",eventPayload:{...data,affectedBounds:unionRect(layout.bounds,district.cells.length?boundsOf(district.cells):layout.bounds)}};
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
                      const data = (await this.listDistricts(countryId,String(row.city_id))).find(d=>d.id===districtId)!;
                      const affectedBounds = previousActive && String(previousActive.id) !== districtId
                        ? unionRect(json<Rect>(row.spatial_bounds_json), json<Rect>(previousActive.spatial_bounds_json))
                        : json<Rect>(row.spatial_bounds_json);
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

                      const data = (await this.listDistricts(countryId,String(row.city_id))).find(d=>d.id===districtId)!;
                      return { data, eventType: "district.completed", eventPayload: { districtId, cityId: data.cityId, affectedBounds: json<Rect>(row.spatial_bounds_json) } };
                    });
  }

  private async listTasksForCity(cityId: string): Promise<TaskDto[]> {
    return this.projectTasks(await this.db.prepare("SELECT * FROM tasks_v3 WHERE city_id = ?").all(cityId) as Row[]);
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
    const title=input.title.trim();
    if(title.length<2||title.length>160) throw new DomainError("INVALID_INPUT","Название задачи должно содержать от 2 до 160 символов");
    if(this.generationDispatcher) return this.rehydrateGenerationResult(countryId,"task.create",await this.generationDispatcher.execute<TaskDto>(countryId,"task.create",input.idempotencyKey,input));
    return this.mutate(countryId,"task.create.v3",input.idempotencyKey,input,async()=>{
      const city=await this.db.prepare("SELECT * FROM cities_v3 WHERE id=? AND country_id=?").get(input.cityId,countryId) as Row|undefined;
      if(!city) throw new DomainError("NOT_FOUND","Город не найден");
      for(const userId of [input.creatorUserId,input.assigneeUserId,input.forUserId]) {
        if(userId&&!await this.db.prepare("SELECT 1 FROM country_members WHERE country_id=? AND user_id=?").get(countryId,userId)) throw new DomainError("ASSIGNEE_NOT_MEMBER","Участник должен состоять в правительстве страны");
      }
      if(input.assigneeRole&&input.assigneeRole.length>80) throw new DomainError("INVALID_INPUT","Роль ответственного не длиннее 80 символов");
      const district=await (input.districtId?this.db.prepare("SELECT * FROM districts_v3 WHERE id=? AND city_id=?").get(input.districtId,input.cityId):this.db.prepare("SELECT * FROM districts_v3 WHERE city_id=? AND status='ACTIVE'").get(input.cityId)) as Row|undefined;
      if(!district) throw new DomainError("NO_ACTIVE_DISTRICT","Сначала создайте или активируйте район");
      if(district.status==="COMPLETED"||district.status==="ABANDONED") throw new DomainError("DISTRICT_SEALED","В завершённый или заброшенный район нельзя добавлять задачи");
      // AUTO is governed by the preplanned slot, never keywords in task prose.
      const visualKind=input.visualKind??(input.parkVariant?"PARK":"BUILDING");
      if(visualKind==="PARK"&&input.buildingHint) throw new DomainError("INVALID_BUILDING_HINT","Для парка укажите parkVariant, а не семейство здания");
      if(visualKind==="BUILDING"&&input.buildingHint&&!BUILDING_CATALOG.some(building=>building.key===input.buildingHint)) throw new DomainError("INVALID_BUILDING_HINT","Неизвестное семейство здания в компактном каталоге");
      const parkVariant=input.parkVariant??"urban-formal";
      if(visualKind==="PARK"&&!isTaskParkVariant(parkVariant)) throw new DomainError("INVALID_INPUT","Неизвестный вариант общественного пространства");
      if(visualKind==="BUILDING"&&input.parkVariant) throw new DomainError("INVALID_INPUT","parkVariant допустим только для общественного пространства");
      const id=randomUUID(),createdAt=now();
      const taskNumber=Number((await this.db.prepare("SELECT COALESCE(MAX(t.task_number),0)+1 AS next FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id WHERE c.country_id=?").get(countryId) as Row).next);
      await this.db.prepare(`INSERT INTO tasks_v3(id,task_number,city_id,district_id,title,description,work_item_type,acceptance_criteria,system_analysis,architecture,design_system,implementation_plan,estimate,priority,status,progress,due_at,building_type,visual_kind,visual_asset_key,platform_type,creator_user_id,assignee_user_id,assignee_role,for_user_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PLANNING',0,?,?,?,?,?,?,?,?,?,?,?)`).run(id,taskNumber,input.cityId,String(district.id),title,input.description?.trim().slice(0,8000)??"",input.workItemType??"TASK",input.acceptanceCriteria?.trim().slice(0,8000)??"",input.systemAnalysis?.trim().slice(0,16000)??"",input.architecture?.trim().slice(0,16000)??"",input.designSystem?.trim().slice(0,16000)??"",input.implementationPlan?.trim().slice(0,16000)??"",input.estimate,input.priority??"NORMAL",input.dueAt??null,"compact-apartment-v1",visualKind,visualKind==="PARK"?parkVariant:"compact-apartment-v1",visualKind==="PARK"?"PARK":"STONE",input.creatorUserId??null,input.assigneeUserId??null,input.assigneeRole?.trim()??null,input.forUserId??null,createdAt,createdAt);
      await this.db.prepare("UPDATE tasks_v3 SET visual_auto=?,requested_building_family=? WHERE id=?").run(!input.visualKind&&!input.buildingHint&&!input.parkVariant,visualKind==="BUILDING"?input.buildingHint??null:null,id);
      const layout=await this.synchronizeBlocks(countryId,input.cityId);
      const creator=input.creatorUserId?await this.db.prepare("SELECT name FROM users WHERE id=?").get<{name:string}>(input.creatorUserId):undefined;
      for(const document of DEFAULT_TASK_DOCUMENTS) {
        const content=document.fileName==="system-analysis.md"?input.systemAnalysis:document.fileName==="architecture.md"?input.architecture:document.fileName==="design-system.md"?input.designSystem:input.implementationPlan;
        await this.db.prepare("INSERT INTO task_documents_v1(id,task_id,file_name,title,content,is_default,position,actor,actor_user_id,created_at,updated_at) VALUES(?,?,?,?,?,true,?,?,?,?,?)").run(randomUUID(),id,document.fileName,document.title,content?.trim().slice(0,64000)??"",document.position,creator?.name??"Система страны",input.creatorUserId??null,createdAt,createdAt);
      }
      await this.recordTaskEvent(id,"CREATED",creator?.name??"Система страны",input.creatorUserId,{status:"PLANNING",estimate:input.estimate,assigneeUserId:input.assigneeUserId??null,assigneeRole:input.assigneeRole??null,forUserId:input.forUserId??null},createdAt);
      const data=await this.getTask(countryId,id);
      return {data,eventType:"task.created",eventPayload:{taskId:id,districtId:String(district.id),cityId:input.cityId,buildingType:data.buildingType,affectedBounds:layout.bounds}};
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
    return this.mutate(countryId,"task.delete.v1",input.idempotencyKey,input,async()=>{
      const task=await this.getTask(countryId,input.taskId),building=await this.buildingEventContext(countryId,input.taskId);
      if(input.confirmTitle.trim()!==task.title) throw new DomainError("CONFIRMATION_MISMATCH","Для удаления укажите точное название задачи");
      const placement=await this.db.prepare("SELECT p.* FROM task_placements_v1 p JOIN city_layouts_v1 l ON l.id=p.layout_id AND l.status='ACTIVE' WHERE p.task_id=?").get<Row>(task.id);
      await this.db.prepare("DELETE FROM tasks_v3 WHERE id=?").run(task.id);
      if(placement) await this.db.prepare("INSERT INTO site_markers_v1(id,layout_id,block_id,slot_key,kind,snapshot_json,asset_variant,created_at,updated_at) VALUES(?,?,?,?,'RUINED',?::jsonb,'compact-rubble',?,?)")
        .run(randomUUID(),placement.layout_id,placement.block_id,placement.slot_key,JSON.stringify({taskId:task.id,taskNumber:task.taskNumber,title:task.title,buildingFamily:task.buildingType,lastStage:task.stage}),now(),now());
      const layout=await this.synchronizeBlocks(countryId,task.cityId);
      const data={deleted:true as const,taskId:task.id,districtId:task.districtId,cityId:task.cityId,title:task.title};
      return {data,eventType:"task.deleted",eventPayload:{...data,building,affectedBounds:layout.bounds}};
    });
  }

  async transferTask(countryId: string, input: { taskId: string; targetDistrictId: string; comment?: string;
    actor?: string; actorUserId?: string; idempotencyKey: string }): Promise<TaskDto> {
    return this.mutate(countryId,"task.transfer.v1",input.idempotencyKey,input,async()=>{
      const task = await this.getTask(countryId,input.taskId);
      const target = await this.db.prepare(`SELECT d.id,d.city_id,d.status FROM districts_v3 d
        JOIN cities_v3 c ON c.id=d.city_id WHERE d.id=? AND c.country_id=?`).get<Row>(input.targetDistrictId,countryId);
      if (!target) throw new DomainError("NOT_FOUND","Район не найден");
      if (target.city_id !== task.cityId) throw new DomainError("INVALID_INPUT","Перенос поддерживается только между спринтами одного проекта");
      if (target.id === task.districtId) throw new DomainError("INVALID_INPUT","Задача уже находится в этом спринте");
      if (target.status === "COMPLETED" || target.status === "ABANDONED") throw new DomainError("DISTRICT_SEALED","В завершённый или заброшенный спринт нельзя переносить задачи");
      const placement = await this.db.prepare(`SELECT p.* FROM task_placements_v1 p
        JOIN city_layouts_v1 l ON l.id=p.layout_id AND l.status='ACTIVE' WHERE p.task_id=?`).get<Row>(task.id);
      if (!placement) throw new DomainError("NOT_FOUND","Площадка задачи не найдена");
      const timestamp = now(), markerId = randomUUID();
      // Release only the live placement, never its land. The country mutation
      // transaction commits both the permanent marker and the new placement.
      await this.db.prepare("DELETE FROM task_placements_v1 WHERE task_id=?").run(task.id);
      await this.db.prepare(`INSERT INTO site_markers_v1
        (id,layout_id,block_id,slot_key,kind,target_task_id,snapshot_json,asset_variant,created_at,updated_at)
        VALUES(?,?,?,?,'RELOCATED',?,?::jsonb,'compact-relocated',?,?)`)
        .run(markerId,placement.layout_id,placement.block_id,placement.slot_key,task.id,
          JSON.stringify({taskNumber:task.taskNumber,title:task.title,buildingFamily:task.buildingType,lastStage:task.stage}),timestamp,timestamp);
      await this.db.prepare(`UPDATE tasks_v3 SET district_id=?,visual_auto=false,
        requested_building_family=CASE WHEN visual_kind='BUILDING' THEN building_type ELSE NULL END,updated_at=? WHERE id=?`)
        .run(target.id,timestamp,task.id);
      const layout = await this.synchronizeBlocks(countryId,task.cityId);
      await this.recordTaskEvent(task.id,"FIELDS_UPDATED",input.actor ?? "MCP",input.actorUserId,
        {changedFields:["districtId"],fromDistrictId:task.districtId,toDistrictId:target.id,markerId,comment:input.comment?.trim() || null},timestamp);
      const data = await this.getTask(countryId,task.id);
      return {data,eventType:"task.transferred",eventPayload:{taskId:task.id,cityId:task.cityId,
        fromDistrictId:task.districtId,toDistrictId:target.id,markerId,serviceRole:data.serviceRole,
        oldBounds:boundsOf(task.footprint),newBounds:boundsOf(data.footprint),
        affectedBounds:unionRect(layout.bounds,expandRect(boundsOf([...task.footprint,...task.accessPath]),1))}};
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
                      if (task.stage !== TASK_STAGE[input.status]) await this.synchronizeBlocks(countryId, task.cityId);
                      const data = await this.getTask(countryId, input.taskId);
                      return {
                        data,
                        eventType: "task.status_changed",
                        eventPayload: {
                          taskId: input.taskId,
                          status: input.status,
                          progress,
                          stage: data.stage,
                          serviceRole: data.serviceRole,
                          // Ordinary building progress changes only dynamic
                          // entities and can be patched over realtime without
                          // refetching or rebaking static chunk ground. A park
                          // development change still invalidates its ground.
                          groundChanged: data.visualKind === "PARK",
                          // Frontage decorations are generated from the task's
                          // access/footprint context and can land one cell into
                          // a neighbouring chunk. Invalidate that ownership halo
                          // even though ordinary building ground remains reusable.
                          affectedBounds: expandRect(boundsOf([...data.footprint, ...data.accessPath]), 1),
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
      const affectedBounds = undefined;
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
      const affectedBounds = undefined;
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
    const surfaceScope = lod === "DETAIL" ? expandRect(viewportBounds, 4) : viewportBounds;
    const [roadRows, districts, cities, tasks, features] = await Promise.all([
      this.roadsInBounds(countryId, surfaceScope),
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
      roads: roadRows,
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
    const roadRows = (bounds: Rect) => this.roadsInBounds(countryId, bounds);
    const surfaceScope = lod === "DETAIL" ? expandRect(chunkBounds, 4) : chunkBounds;
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
    const surfaceContext = lod === "OVERVIEW" ? (() => {
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
    }).values()];
    const surfaces = surfaceContext.filter(surface => contains(chunkBounds, surface));
    const decorationHalo = buildDecorationHardHalo({
      chunkBounds, surfaceScope, roads: surfaceRoads, tasks: nearbyTasks,
      features: nearbyFeatures, reservedSites: nearbyDistricts.flatMap(district => district.lots),
    });

    const content: Omit<ChunkPayloadV2Dto, "contentHash"> = {
      payloadVersion: 2,
      generatorVersion: "block-v1",
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
      plannedSites: nearbyDistricts.flatMap(d=>d.lots.filter(lot=>lot.vacant && contains(chunkBounds,lot.origin)).map(lot=>({id:lot.id,origin:lot.origin,width:lot.width,height:lot.height,kind:lot.slotKind ?? "BUILDING",serviceRole:lot.serviceRole}))),
      blockPlaques: nearbyDistricts.flatMap(d => (d.blockPlaques ?? []).filter(plaque => contains(chunkBounds, plaque.origin))),
      tasks: chunkTasks.map((task) => ({
        id: task.id, taskNumber: task.taskNumber, cityId: task.cityId, districtId: task.districtId, title: task.title,
        workItemType: task.workItemType,
        ...(lod === "DETAIL" && defectSummaryByTask.has(task.id) ? { defectSummary: defectSummaryByTask.get(task.id) } : {}),
        status: task.status, progress: task.progress, stage: task.stage,
        buildingType: task.buildingType, serviceRole: task.serviceRole, visualKind: task.visualKind, visualAssetKey: task.visualAssetKey,
        platformType: task.platformType, origin: task.origin, footprint: task.footprint, accessPath: task.accessPath,
      })),
      worldFeatures: [...worldFeatures].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      decorationContext: {
        treeGeometryVersion: 7,
        lightingVersion: 1,
        surfaceHaloRuns: compactSurfaceRuns(surfaceContext.filter(cell => !contains(chunkBounds, cell) && contains(surfaceScope, cell))),
        blockedCellRuns: decorationHalo,
        cityBounds: nearbyCities.map((city) => city.bounds)
          .sort((left, right) => left.minY - right.minY || left.minX - right.minX || left.maxY - right.maxY || left.maxX - right.maxX),
        districts: nearbyDistricts.map((district) => ({
          id: district.id,
          status: district.status,
          archetype: district.archetype,
          cellRuns: compactCellRuns(district.cells.filter((cell) => contains(surfaceScope, cell))),
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
