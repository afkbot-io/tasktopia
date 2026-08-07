import { createHash, randomUUID } from "node:crypto";
import { BUILDING_CATALOG, PROP_CATALOG, getBuilding, inferTaskTags, type BuildingCatalogEntry } from "../shared/catalog";
import {
  STATUS_PROGRESS_RANGE,
  TASK_STAGE,
  type BootstrapDto,
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
  type RoadCellDto,
  type SurfaceCellDto,
  type TaskDto,
  type TaskDefectDto,
  type TaskPriority,
  type TaskStatus,
  type WorkItemType,
  type WorldFeatureDto,
} from "../shared/contracts";
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
import { stampRoadCorridor } from "./world/road-geometry";
import { planComplex } from "./world/complex-planner";
import {
  ROAD_WIDTH,
  archetypeAffinity,
  buildingCompatibleWithArchetype,
  buildingZoningRole,
  buildSurfaceMap,
  chooseDistrictArchetype,
  cityMorphology,
  entranceOutside,
  findAccessPlan,
  primaryZoningRole,
} from "./world/city-generation";

export const CHUNK_SIZE = 64;
const CITY_SIZE = 100;
const CITY_SPACING = 320;
const COUNTRY_VIEW_MARGIN = 54;
const SPRINT_COLORS = ["#52a8d8", "#dfa94b", "#9877c7", "#69ad67", "#c86f67", "#4fb49f", "#d585b4"];
const ROAD_CLASS_RANK: Record<RoadCellDto["roadClass"], number> = { LOCAL: 0, COLLECTOR: 1, ARTERIAL: 2, HIGHWAY: 3 };

type Row = Record<string, unknown>;
type GrowthDirection = DistrictDto["growthDirection"];

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
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
  };
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
  private static readonly CHUNK_CACHE_LIMIT = 64;

  constructor(private readonly db: Db, private readonly onEvent?: (event: RealtimeEvent) => void) {}

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
      const seedBytes = createHash("sha256").update(`${countryId}:${input.idempotencyKey}:${now()}`).digest();
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
        await this.db.prepare(`UPDATE tasks_v3 SET platform_type = ?, origin_x = ?, origin_y = ?, footprint_json = ?,
          entrance_x = ?, entrance_y = ?, access_json = ?, access_kind = ? WHERE id = ?`).run(
          generated.platformType, generated.origin.x, generated.origin.y, JSON.stringify(generated.footprint),
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
          });
          featureMap.set(feature.id, copied.id);
        }
        const copiedIds = new Set(ready.map((feature) => feature.id));
        pending = pending.filter((feature) => !copiedIds.has(feature.id));
      }
      await this.db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(seed, countryId);
      await this.db.prepare("DELETE FROM countries WHERE id = ?").run(temporaryCountryId);
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
    const rows = await this.db.prepare(`SELECT id, city_id, district_id, title, work_item_type, estimate, priority, status, progress, due_at, updated_at,
      (SELECT COUNT(*) FROM task_defects_v18 defect WHERE defect.task_id = tasks_v3.id AND defect.status <> 'FIXED') AS active_defect_count
      FROM tasks_v3 WHERE district_id = ? ORDER BY created_at`).all(districtId) as Row[];
    return rows.map((row) => {
      const status = String(row.status) as TaskStatus;
      return {
        id: String(row.id), cityId: String(row.city_id), districtId: String(row.district_id), title: String(row.title),
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
    return task;
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
    return buildable * 4 - water * 8 + hashCoordinate(seed, center.x, center.y, 417);
  }

  private async nextCityCenter(countryId: string, seed: number): Promise<Cell> {
    const cities = await this.listCities(countryId);
    const index = cities.length;
    if (index === 0) {
      const candidates: Cell[] = [];
      for (let radius = 0; radius <= 60; radius += 10) {
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
      ...(await this.listTasks(countryId)).flatMap((task) => [...task.footprint, task.entrance, ...task.accessPath]),
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
    const path = aStarPath(start, end, (cell) => {
              const isEndpoint = cell.x === start.x && cell.y === start.y || cell.x === end.x && cell.y === end.y;
              const existing = roads.get(cellKey(cell));
              // An intercity route may follow an established highway out of a city
              // that later grew around it. It may not reuse local/collector streets:
              // doing so widened ordinary blocks and removed their sidewalks.
              const reusableRoad = Boolean(existing) && (reuseUrbanRoads || existing?.roadClass === "HIGHWAY");
              if (!isEndpoint && protectedBounds.some((bounds) => contains(bounds, cell)) && !reusableRoad) return Number.POSITIVE_INFINITY;
              if (!isEndpoint && occupied.has(cellKey(cell)) && !reusableRoad) return Number.POSITIVE_INFINITY;
              if (existing) return 0.12;
              if (sealed.has(cellKey(cell))) return Number.POSITIVE_INFINITY;
              const terrain = terrainAt(seed, cell.x, cell.y).terrain;
              if (terrain === "DEEP_WATER") return 18;
              if (terrain === "SHALLOW_WATER") return 10;
              if (terrain === "WET_SAND") return 4;
              if (terrain === "MOUNTAIN") return 45;
              if (terrain === "HILL") return 7;
              if (terrain === "FOREST") return 3.2;
              if (terrain === "STONE") return 2.2;
              return 1;
            }, 160, 1.4, false);
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
      ...(await this.listTasks(countryId)).flatMap((task) => [...task.footprint, task.entrance, ...task.accessPath]),
      ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
    ].map(cellKey));
    // Pathfinding protects the road centerline. The final two/three-cell-wide
    // corridor needs its own guard because a lateral lane may otherwise spill
    // into a committed building in an adjacent district.
    let corridor = this.roadCorridor(path, roadClass).filter((cell) => {
      const key = cellKey(cell);
      return !committedFootprints.has(key) && (!sealed.has(key) || roads.has(key));
    });
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
      upsert.run(countryId, cell.x, cell.y, updated.mask, structure, selectedClass);
    }
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
    for (const target of targets) {
      const road = roads.get(cellKey(target));
      if (!road) continue;
      let mask = 0;
      for (const direction of GRID_DIRECTIONS) {
        if (roads.has(cellKey({ x: road.x + direction.x, y: road.y + direction.y }))) mask |= direction.bit;
      }
      road.mask = mask;
      update.run(mask, countryId, road.x, road.y);
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

  private async highwayAnchor(countryId: string, target: Cell, cities: CityDto[]): Promise<Cell | undefined> {
    const highways = [...(await this.roadCells(countryId)).values()].filter((road) => road.roadClass === "HIGHWAY");
    const originalCities = cities.map((city) => rectForCenter(city.center));
    const districtEnvelopes = (await this.listDistricts(countryId)).filter((district) => district.cells.length > 0).map((district) => expandRect(boundsOf(district.cells), 3));
    const rural = highways.filter((road) =>
      !originalCities.some((bounds) => contains(bounds, road))
      && !districtEnvelopes.some((bounds) => contains(bounds, road)),
    );
    const outsideDistricts = highways.filter((road) => !districtEnvelopes.some((bounds) => contains(bounds, road)));
    // The branch point must be a genuine rural highway cell. Otherwise a new
    // connector can reuse a local street and accidentally upgrade an entire
    // urban block to HIGHWAY.
    const candidates = rural.length > 0 ? rural : outsideDistricts.length > 0 ? outsideDistricts : highways;
    return candidates
      .reduce<Cell | undefined>((best, road) => !best || manhattan(road, target) < manhattan(best, target) ? road : best, undefined);
  }

  private async featurePlacementOpen(countryId: string, seed: number, footprint: Cell[], avoidBounds: Rect[] = []): Promise<boolean> {
    const roads = await this.roadCells(countryId);
    const occupied = new Set([
      ...(await this.listTasks(countryId)).flatMap((task) => task.footprint).map(cellKey),
      ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint).map(cellKey),
    ]);
    return footprint.every((cell) => !roads.has(cellKey(cell))
      && !occupied.has(cellKey(cell))
      && !avoidBounds.some((bounds) => contains(bounds, cell))
      && isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain));
  }

  private async insertWorldFeature(countryId: string, input: Omit<WorldFeatureDto, "id">): Promise<WorldFeatureDto> {
    const id = randomUUID();
    await this.db.prepare(`INSERT INTO world_features_v6
      (id, country_id, city_id, district_id, parent_feature_id, kind, asset_kind, asset_key, origin_x, origin_y, footprint_json, orientation, access_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                              id, countryId, input.cityId, input.districtId, input.parentFeatureId, input.kind, input.assetKind, input.assetKey,
                              input.origin.x, input.origin.y, JSON.stringify(input.footprint), input.orientation,
                              JSON.stringify(input.accessPath), now(),
                            );
    this.surfaceCache.delete(countryId);
    return { id, ...input };
  }

  private areaAccessPath(
    seed: number,
    allowed: Set<string>,
    footprint: Cell[],
    roads: Map<string, RoadCellDto>,
    surfaces: Map<string, SurfaceCellDto>,
    occupied: Set<string>,
  ): Cell[] | null {
    const footprintKeys = new Set(footprint.map(cellKey));
    const starts = new Map<string, Cell>();
    for (const cell of footprint) {
      for (const next of neighbors4(cell)) {
        const nextKey = cellKey(next);
        if (!footprintKeys.has(nextKey) && allowed.has(nextKey)) starts.set(nextKey, next);
      }
    }
    // Persist the actual sidewalk anchor even for a direct connection. An
    // empty path loses ownership of that cell and a later task can otherwise
    // consume the only pedestrian exit from an already published park.
    for (const start of starts.values()) if (surfaces.get(cellKey(start))?.kind === "SIDEWALK") return [start];
    const queue = [...starts.values()].map((cell) => ({ cell, path: [cell] }));
    const visited = new Set<string>();
    // A park alley may run up to eight cells: green areas legitimately sit a
    // short walk behind the frontage rows, unlike building entrances.
    const maxAlley = 8;
    while (queue.length > 0) {
      const state = queue.shift()!;
      const stateKey = cellKey(state.cell);
      if (visited.has(stateKey) || state.path.length > maxAlley) continue;
      visited.add(stateKey);
      if (roads.has(stateKey) || occupied.has(stateKey) || footprintKeys.has(stateKey) || !isBuildableTerrain(terrainAt(seed, state.cell.x, state.cell.y).terrain)) continue;
      for (const next of neighbors4(state.cell)) {
        const nextKey = cellKey(next);
        if (surfaces.get(nextKey)?.kind === "SIDEWALK") return state.path;
        if (state.path.length >= maxAlley || !allowed.has(nextKey) || surfaces.has(nextKey) || roads.has(nextKey) || footprintKeys.has(nextKey) || occupied.has(nextKey)) continue;
        queue.push({ cell: next, path: [...state.path, next] });
      }
    }
    return null;
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
  ): Promise<void> {
    const existingFeatures = await this.listWorldFeatures(countryId);
    const existingGreen = existingFeatures.filter((feature) => feature.cityId === city.id && (feature.kind === "PARK" || feature.kind === "GROVE"));
    const chance = archetype === "PRIVATE" ? 0.58 : archetype === "CIVIC" ? 0.48 : archetype === "COMMERCIAL" ? 0.24 : 0.4;
    const roll = hashCoordinate(seed, city.center.x, city.center.y, 811 + districtIndex);
    // Every city must eventually receive a public green area. Keep trying on
    // subsequent districts until one actually fits; the old `districtIndex ===
    // 1` gate permanently skipped parks when that single district had no valid
    // parcel.
    const forceFirstGreen = existingGreen.length === 0;
    if (!forceFirstGreen && roll > chance) return;

    const cityIndex = (await this.listCities(countryId)).findIndex((candidate) => candidate.id === city.id);
    const kind: Extract<WorldFeatureDto["kind"], "PARK" | "GROVE"> = (cityIndex + districtIndex + existingGreen.length) % 2 === 0 ? "GROVE" : "PARK";
    const size: readonly [number, number] = kind === "GROVE" ? [6, 5] : [5, 4];
    const allowed = new Set(districtCells.map(cellKey));
    const roads = await this.roadCells(countryId);
    const bounds = boundsOf(districtCells);
    const surfaces = await this.localSurfaceCells(countryId, bounds, roads);
    const occupied = new Set([
      ...(await this.listTasks(countryId)).flatMap((task) => task.footprint),
      ...existingFeatures.filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint),
      ...reservedLots.flatMap((lot) => rectangleFootprint(lot.origin, lot.width, lot.height)),
      ...reservedLots.flatMap((lot) => lot.sharedAccess ?? []),
    ].map(cellKey));
    const candidates: Array<{ origin: Cell; footprint: Cell[]; accessPath: Cell[]; score: number }> = [];
    for (let y = bounds.minY; y <= bounds.maxY - size[1] + 1; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX - size[0] + 1; x += 1) {
        const origin = { x, y };
        const footprint = rectangleFootprint(origin, size[0], size[1]);
        if (!footprint.every((cell) => {
          const key = cellKey(cell);
          return allowed.has(key) && !roads.has(key) && !occupied.has(key) && isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain);
        })) continue;
        const accessPath = this.areaAccessPath(seed, allowed, footprint, roads, surfaces, occupied);
        if (accessPath === null) continue;
        const centerDistance = manhattan({ x: x + Math.floor(size[0] / 2), y: y + Math.floor(size[1] / 2) }, city.center);
        candidates.push({ origin, footprint, accessPath, score: accessPath.length * 100 + centerDistance * 0.08 + hashCoordinate(seed, x, y, 823) });
      }
    }
    const selected = candidates.sort((left, right) => left.score - right.score || left.origin.y - right.origin.y || left.origin.x - right.origin.x)[0];
    if (!selected) return;
    const area = await this.insertWorldFeature(countryId, {
                              cityId: city.id,
                              districtId,
                              parentFeatureId: null,
                              kind,
                              assetKind: "AREA",
                              assetKey: kind === "GROVE" ? "urban-grove" : "urban-park",
                              origin: selected.origin,
                              footprint: selected.footprint,
                              orientation: "S",
                              accessPath: selected.accessPath,
                            });
    await this.clearRuins(countryId, selected.footprint);

    const decor = kind === "PARK"
      ? [
          ["playground-small", 1, 1, 3, 2], ["bench-horizontal", 1, 3, 2, 1],
          ["tree-flowering", 4, 0, 1, 1], ["streetlamp", 4, 3, 1, 1], ["trash-bin", 0, 3, 1, 1],
        ] as const
      : [
          ["tree-round", 1, 1, 1, 1], ["tree-conifer", 3, 1, 1, 1], ["tree-flowering", 4, 2, 1, 1],
          ["tree-round", 1, 3, 1, 1], ["picnic-table", 2, 3, 2, 2], ["bench-horizontal", 3, 0, 2, 1],
          ["streetlamp", 5, 4, 1, 1], ["trash-bin", 0, 4, 1, 1],
        ] as const;
    for (const [assetKey, offsetX, offsetY, width, height] of decor) {
      const origin = { x: selected.origin.x + offsetX, y: selected.origin.y + offsetY };
      const footprint = rectangleFootprint(origin, width, height);
      if (!footprint.every((cell) => selected.footprint.some((areaCell) => cellKey(areaCell) === cellKey(cell)))) continue;
      await this.insertWorldFeature(countryId, {
                                        cityId: city.id, districtId, parentFeatureId: area.id, kind: "PARK_DECOR", assetKind: "PROP", assetKey,
                                        origin, footprint, orientation: "S", accessPath: [],
                                      });
    }
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

    await placeProp("CITY_SIGN", `city-sign-${roadAxisKey}`, portal, [1, 1]);
    await placeProp("BUS_STOP", `bus-stop-${roadAxisKey}`, gateway, horizontalApproach ? [2, 1] : [1, 2]);

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
        const stopOrigin = horizontal
          ? { x: cell.x + 5, y: cell.y + (side < 0 ? 5 : -5) }
          : { x: cell.x + (side < 0 ? 5 : -5), y: cell.y + 5 };
        const stopFootprint = rectangleFootprint(stopOrigin, horizontal ? 2 : 1, horizontal ? 1 : 2);
        if (await this.featurePlacementOpen(countryId, seed, stopFootprint, cityExclusion)) {
          await this.insertWorldFeature(countryId, {
                                                            cityId: null, districtId: null, parentFeatureId: null, kind: "BUS_STOP", assetKind: "PROP", assetKey: `bus-stop-${horizontal ? "horizontal" : "vertical"}`,
                                                            origin: stopOrigin, footprint: stopFootprint, orientation: horizontal ? "E" : "S", accessPath: [],
                                                          });
        }
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
                      const source = nearest ? await this.highwayAnchor(countryId, portal, cities) ?? nearest.center : approach;
                      const hub = this.cityHub(seed, center);
                      const protectedUrbanEnvelopes = [
                        ...cities.map((city) => rectForCenter(city.center)),
                        ...(await this.listDistricts(countryId)).filter((district) => district.cells.length > 0).map((district) => expandRect(boundsOf(district.cells), 3)),
                      ];
                      // A connector branches from a rural highway and routes around every
                      // existing district. The new 100x100 reservation is protected as well so
                      // the route reaches only its chosen portal.
                      const connector = await this.route(countryId, seed, source, portal, [...protectedUrbanEnvelopes, bounds], [], 3);
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
                      await this.publishCityGatewayFeatures(countryId, id, seed, bounds, gateway.cell, portal, connector, gateway.horizontalApproach);

                      const data: CityDto = {
                        id, name, description: input.description?.trim() ?? "", goal: input.goal?.trim() ?? "",
                        acceptanceCriteria: input.acceptanceCriteria?.trim() ?? "", deadline: input.deadline ?? null,
                        status: "ACTIVE", center, bounds, styleId, morphology, createdAt,
                      };
                      return { data, eventType: "city.created", eventPayload: { cityId: id, center, affectedBounds: bounds } };
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
    const taskCount = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE district_id = ?").get(district.id) as Row).count);
    const targetLots = Math.max(4, Math.min(16, Math.ceil(Math.max(1, district.capacitySp - taskCount) * 1.15)));
    const complexIndex = new Set(district.lots.map((lot) => lot.groupId).filter(Boolean)).size;

    const infill = await this.tryGrowComplex(countryId, district, entry, boundsOf(district.cells), complexIndex, targetLots, seed);
    if (infill) return infill;

    const originalBounds = boundsOf(district.cells);
    const existingKeys = new Set(district.cells.map(cellKey));
    const blockedByDistrict = new Set(
      (await this.listDistricts(countryId))
                        .filter((candidate) => candidate.id !== district.id)
                        .flatMap((candidate) => candidate.cells)
                        .map(cellKey),
    );
    const directions = ([district.growthDirection, "E", "S", "W", "N"] as GrowthDirection[])
      .filter((value, index, all) => all.indexOf(value) === index);
    for (const thickness of [24, 28, 32]) {
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
        ).filter((cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain) && !blockedByDistrict.has(cellKey(cell)));
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
        if (patch.length < 300) continue;
        const patchBounds = boundsOf(patch);
        const grown: DistrictDto = { ...district, cells: [...district.cells, ...patch], growthDirection: direction };
        const sited = await this.tryGrowComplex(countryId, grown, entry, patchBounds, complexIndex, targetLots, seed);
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
  ): Promise<DistrictDto | null> {
    const allowed = new Set(district.cells.map(cellKey));
    const roads = await this.roadCells(countryId);
    const occupied = new Set([
      ...(await this.listTasks(countryId)).flatMap((task) => task.footprint),
      ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint),
    ].map(cellKey));
    const blockedByDistrict = new Set(
      (await this.listDistricts(countryId))
                        .filter((candidate) => candidate.id !== district.id)
                        .flatMap((candidate) => candidate.cells)
                        .map(cellKey),
    );
    const sealed = await this.completedDistrictCells(countryId);
    // Streets are shared infrastructure: a connector may cross a still-growing
    // neighbour's empty territory (its future complexes simply avoid the road),
    // but never a sealed district. The first pass still prefers a corridor that
    // stays on neutral ground.
    const foreignSoft = new Set([...blockedByDistrict].filter((key) => !sealed.has(key)));
    const districtRoads = [...roads.values()].filter((road) => allowed.has(cellKey(road)));
    const safeRoads = [...roads.values()].filter((road) => !sealed.has(cellKey(road)) || neighbors4(road).some((cell) => !sealed.has(cellKey(cell))));
    // Infill grows directly against the district's own streets. A fresh
    // territory lobe can sit away from them, so there the complex anchors to
    // the shared road network and reaches it with a longer access road.
    const nearDistrictRoads = districtRoads.filter((road) => contains(expandRect(searchBounds, 16), road));
    const anchors = nearDistrictRoads.length > 0 ? nearDistrictRoads : safeRoads;
    const maxAdjacency = nearDistrictRoads.length > 0 ? 8 : 24;
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
    if (boundsWidth < 14 || boundsHeight < 12) return null;
    const territoryCap = complexIndex === 0 ? Math.max(240, Math.floor(allowed.size * 0.7)) : Number.POSITIVE_INFINITY;
    const area = Math.min(targetLots * 60, territoryCap);
    const aspect = 0.7 + hashCoordinate(seed, searchBounds.minX, searchBounds.minY, 941 + complexIndex) * 0.9;
    const rectWidth = Math.max(12, Math.min(40, boundsWidth - 2, Math.round(Math.sqrt(area * aspect))));
    const rectHeight = Math.max(10, Math.min(34, boundsHeight - 2, Math.round(area / rectWidth)));

    const searchCenter = {
      x: Math.floor((searchBounds.minX + searchBounds.maxX) / 2),
      y: Math.floor((searchBounds.minY + searchBounds.maxY) / 2),
    };
    const candidates: Array<{ rect: Rect; score: number }> = [];
    for (let y = searchBounds.minY + 1; y + rectHeight - 1 <= searchBounds.maxY - 1; y += 3) {
      for (let x = searchBounds.minX + 1; x + rectWidth - 1 <= searchBounds.maxX - 1; x += 3) {
        const rect: Rect = { minX: x, minY: y, maxX: x + rectWidth - 1, maxY: y + rectHeight - 1 };
        const rectCells = rectangleFootprint({ x, y }, rectWidth, rectHeight);
        // The district silhouette has cut corners, so a complex nearly as big
        // as the territory can never be fully inside it. Accept sites that are
        // mostly inside; the planner drops the few lots that fall outside.
        const insideCount = rectCells.filter((cell) => allowed.has(cellKey(cell))).length;
        if (insideCount / rectCells.length < 0.9) continue;
        if (rectCells.some((cell) => roads.has(cellKey(cell)) || occupied.has(cellKey(cell)))) continue;
        const unsuitable = rectCells.filter((cell) => !isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain)).length;
        if (unsuitable / rectCells.length > 0.06) continue;
        // Organic rule: the next complex grows directly against the existing
        // streets. The first complex of a district anchors to the closest road.
        const adjacency = Math.min(...anchors.map((road) => {
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

    for (const candidate of candidates.sort((left, right) => left.score - right.score).slice(0, 12)) {
      const plan = planComplex({
        districtId: district.id,
        complexIndex,
        rect: candidate.rect,
        cells: district.cells,
        archetype: district.archetype,
        targetLots,
        seed,
        reserveSupport: !district.lots.some((lot) => lot.role === "SUPPORT"),
      });
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
            // Short hops stay cheap: take the orthogonal line first and only
            // pay for A* when the direct corridor clips a reservation.
            let path = pair.distance <= 4
              ? orthogonalPath(pair.road, pair.endpoint, Math.abs(pair.road.x - pair.endpoint.x) >= Math.abs(pair.road.y - pair.endpoint.y))
              : await this.route(countryId, seed, pair.road, pair.endpoint, [], allowLotClipping ? [] : reserved, 1, true);
            let corridorCells = this.roadCorridor(path, connectorClass);
            const hardBlocked = (cell: Cell) => {
              const key = cellKey(cell);
              return occupied.has(key) || (blockedByDistrict.has(key) && !allowForeign && foreignSoft.has(key))
                || (blockedByDistrict.has(key) && !foreignSoft.has(key));
            };
            const softBlocked = (cell: Cell) => hardBlocked(cell) || (!allowLotClipping && reservedKeys.has(cellKey(cell)));
            if (pair.distance <= 4 && corridorCells.some(softBlocked)) {
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
              if (!fitsEntry(plan.lots.filter((lot) => !hit.some((dropped) => dropped.id === lot.id)))) continue;
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
      const lots = [...district.lots, ...plan.lots.filter((lot) => !sacrificedLotIds.has(lot.id))];
      await this.db.prepare("UPDATE districts_v3 SET cells_json = ?, lots_json = ?, growth_direction = ? WHERE id = ?")
                                                  .run(JSON.stringify(district.cells), JSON.stringify(lots), district.growthDirection, district.id);
      // Green areas arrive together with the first streets: a pocket park or
      // grove is tucked into the remaining territory, away from planned lots.
      const cityRow = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ?").get(district.cityId) as Row;
      const districtIndex = (await this.listDistricts(countryId, district.cityId)).findIndex((item) => item.id === district.id);
      await this.publishDistrictGreenFeature(countryId, cityDto(cityRow), district.id, seed, district.cells, district.archetype, Math.max(0, districtIndex), lots);
      return { ...district, lots };
    }
    // Demand overshoots the remaining land: retry with a smaller complex
    // (16 → 9 → 5 → 3 lots). The failure path mutated nothing, and a compact
    // infill block beats surrendering to a full territory patch.
    const nextTarget = Math.floor(targetLots * 0.6);
    if (nextTarget >= 3 && nextTarget < targetLots) {
      return this.tryGrowComplex(countryId, district, entry, searchBounds, complexIndex, nextTarget, seed);
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

  private async selectDistrictSite(
    countryId: string,
    city: CityDto,
    seed: number,
    width: number,
    height: number,
    candidateValid?: (origin: Cell, cells: Cell[]) => boolean,
  ): Promise<{ origin: Cell; cells: Cell[] }> {
    const roads = await this.roadCells(countryId);
    const districts = await this.listDistricts(countryId);
    const cityDistricts = districts.filter((district) => district.cityId === city.id);
    const preferredRoads = [...roads.values()].filter((road) => road.roadClass !== "HIGHWAY" && contains(expandRect(city.bounds, 24), road));
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
          const cells = this.districtShape(origin, width, height, seed);
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
      const selected = candidates.sort((a, b) => a.score - b.score)[0];
      if (selected) return selected;
    }
    throw new DomainError("PLACEMENT_UNAVAILABLE", "В городе и безопасных секторах расширения не осталось площадки для района");
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
                      // V10: a district starts as pure territory — no streets, no
                      // lots. The first task grows the first complex (ЖК) inside it,
                      // so roads never appear ahead of demand. The territory is sized
                      // to the planned capacity (~64 cells per building) and takes a
                      // seeded aspect so districts read as varied urban shapes.
                      const area = Math.max(576, Math.min(2600, capacity * 64));
                      const aspects = [1, 1.6, 0.62, 1.9, 0.53] as const;
                      const aspect = aspects[Math.floor(hashCoordinate(seed, city.center.x, city.center.y, 557 + existingDistricts.length) * aspects.length)]!;
                      const width = Math.max(18, Math.min(44, Math.round(Math.sqrt(area * aspect))));
                      const height = Math.max(14, Math.min(36, Math.round(area / width)));
                      const id = randomUUID();
                      const existingRoads = await this.roadCells(countryId);
                      const occupied = new Set([
                        ...existingRoads.keys(),
                        ...(await this.listTasks(countryId)).flatMap((task) => task.footprint).map(cellKey),
                        ...(await this.listWorldFeatures(countryId)).filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint).map(cellKey),
                      ]);
                      const site = await this.selectDistrictSite(countryId, city, seed, width, height, (_origin, cells) =>
                                                                                cells.every((cell) => !occupied.has(cellKey(cell))));
                      // A remote site receives its access road together with the
                      // territory: a collector stub runs from the nearest street
                      // to the site edge, so the first complex can anchor later.
                      // Sites already near the network skip it — their complexes
                      // connect on their own when they grow.
                      if (existingDistricts.length > 0) {
                        const sealedCells = await this.completedDistrictCells(countryId);
                        const anchorRoads = [...existingRoads.values()].filter((road) =>
                          road.roadClass !== "HIGHWAY" && (!sealedCells.has(cellKey(road)) || neighbors4(road).some((cell) => !sealedCells.has(cellKey(cell)))));
                        if (anchorRoads.length > 0) {
                          const siteBounds = boundsOf(site.cells);
                          const gapTo = (road: Cell) =>
                            Math.max(0, siteBounds.minX - road.x, road.x - siteBounds.maxX)
                            + Math.max(0, siteBounds.minY - road.y, road.y - siteBounds.maxY);
                          const nearest = anchorRoads.reduce((best, road) => gapTo(road) < gapTo(best) ? road : best);
                          if (gapTo(nearest) > 24) {
                            const target = site.cells.reduce((best, cell) => manhattan(cell, nearest) < manhattan(best, nearest) ? cell : best);
                            const stub = await this.route(countryId, seed, nearest, target, [], [], 1, true);
                            await this.addRoadPath(countryId, seed, stub, "COLLECTOR");
                          }
                        }
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
    const cityCount = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE city_id = ? AND building_type = ?").get(cityId, entry.key) as Row).count);
    const districtCount = Number((await this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE district_id = ? AND building_type = ?").get(districtId, entry.key) as Row).count);
    return (!entry.maxPerCity || cityCount < entry.maxPerCity) && (!entry.maxPerDistrict || districtCount < entry.maxPerDistrict);
  }

  private async listTasksForCity(cityId: string): Promise<TaskDto[]> {
    return (await this.db.prepare("SELECT * FROM tasks_v3 WHERE city_id = ?").all(cityId) as Row[]).map(taskDto);
  }

  private async requiredServiceRole(cityId: string, districtId: string, estimate: Estimate): Promise<string | undefined> {
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
      const due = district?.archetype === "CIVIC" || tasks.length + 1 >= item.threshold;
      if (!due) continue;
      for (const entry of BUILDING_CATALOG) {
        if (entry.serviceRole === item.role && entry.estimates.includes(estimate) && await this.entryAllowed(entry, cityId, districtId)) return item.role;
      }
    }
    return undefined;
  }

  private async selectBuilding(cityId: string, districtId: string, estimate: Estimate, title: string, description: string, hint?: string): Promise<BuildingCatalogEntry> {
    const district = (await this.db.prepare("SELECT * FROM districts_v3 WHERE id = ? AND city_id = ?").get(districtId, cityId) as Row | undefined);
    if (!district) throw new DomainError("NOT_FOUND", "Район не найден");
    const archetype = districtDto(district).archetype;
    if (hint) {
      const exact = BUILDING_CATALOG.find((entry) => entry.key === hint && entry.estimates.includes(estimate));
      if (!exact) throw new DomainError("INVALID_BUILDING_HINT", "Указанный тип здания не подходит оценке или не существует");
      if (!await this.entryAllowed(exact, cityId, districtId)) throw new DomainError("BUILDING_QUOTA_REACHED", "Лимит этого типа здания уже достигнут");
      if (!buildingCompatibleWithArchetype(exact, archetype)) throw new DomainError("BUILDING_ZONE_CONFLICT", "Этот тип здания несовместим с архитектурой района");
      return exact;
    }
    const tags = new Set(inferTaskTags(title, description));
    const requiredService = await this.requiredServiceRole(cityId, districtId, estimate);
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
    const compatible: BuildingCatalogEntry[] = [];
    for (const entry of BUILDING_CATALOG) {
      if (entry.estimates.includes(estimate)
        && await this.entryAllowed(entry, cityId, districtId)
        && buildingCompatibleWithArchetype(entry, archetype)
        && (!requiredService || entry.serviceRole === requiredService)) compatible.push(entry);
    }
    if (compatible.length === 0) throw new DomainError("NO_BUILDING_VARIANT", "В каталоге нет здания этой оценки, совместимого с архитектурой района");
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
    const supportCandidates = compatible.filter((entry) => !primaryZoningRole(archetype, buildingZoningRole(entry)));
    const candidates = requiredService
      ? compatible
      : wantsSupport && existingSupport < supportLimit && supportCandidates.length > 0
        ? supportCandidates
        : primaryCandidates.length > 0 ? primaryCandidates : compatible;
    return candidates.map((entry) => {
      const semanticBonus = entry.tags.filter((tag) => tags.has(tag)).length * 8;
      const morphologyBonus = archetypeAffinity(entry, archetype);
      const rarityPenalty = entry.rarity === "UNIQUE" ? 4 : entry.rarity === "RARE" ? 2 : 0;
      const unrelatedServicePenalty = entry.serviceRole && !requiredService && !tags.has("civic") ? 18 : 0;
      const score = (cityCounts.get(entry.key) ?? 0) * 7 + (districtCounts.get(entry.key) ?? 0) * 9
        + complexRepeat(entry.key) * 12
        + (categoryCounts.get(entry.category) ?? 0) * 1.2 + rarityPenalty + unrelatedServicePenalty - semanticBonus - morphologyBonus
        + stringHash(`${title}:${entry.key}`) * 2;
      return { entry, score };
    }).sort((a, b) => a.score - b.score)[0]!.entry;
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
    const lotCenterX = lot.origin.x + lot.width / 2;
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
        const buildingCenterX = origin.x + entry.footprint.width / 2;
        // Every facade faces its street (south): prefer the building flush to
        // the sidewalk at the bottom edge of the lot, then centred horizontally.
        const bottomGap = lot.origin.y + lot.height - (origin.y + entry.footprint.height);
        candidates.push({
          origin, footprint, entrance: access.entrance, accessPath: access.path,
          score: access.distance * 100 + bottomGap * 30 + Math.abs(buildingCenterX - lotCenterX),
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
    creatorUserId?: string;
    assigneeUserId?: string;
    idempotencyKey: string;
  }): Promise<TaskDto> {
    const title = input.title.trim();
    if (title.length < 2 || title.length > 160) throw new DomainError("INVALID_INPUT", "Название задачи должно содержать от 2 до 160 символов");
    return await this.mutate(countryId, "task.create.v3", input.idempotencyKey, input, async () => {
                      const city = await this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
                      if (!city) throw new DomainError("NOT_FOUND", "Город не найден");
                      for (const [field, userId] of [["создатель", input.creatorUserId], ["ответственный", input.assigneeUserId]] as const) {
                        if (userId && !await this.db.prepare("SELECT 1 FROM country_members WHERE country_id = ? AND user_id = ?").get(countryId, userId)) {
                          throw new DomainError("ASSIGNEE_NOT_MEMBER", `${field} должен состоять в правительстве страны`);
                        }
                      }
                      const districtRow = input.districtId
                        ? await this.db.prepare("SELECT * FROM districts_v3 WHERE id = ? AND city_id = ?").get(input.districtId, input.cityId)
                        : await this.db.prepare("SELECT * FROM districts_v3 WHERE city_id = ? AND status = 'ACTIVE'").get(input.cityId);
                      if (!districtRow) throw new DomainError("NO_ACTIVE_DISTRICT", "Сначала создайте или активируйте район");
                      let district = districtDto(districtRow as Row);
                      if (district.status === "COMPLETED") throw new DomainError("DISTRICT_SEALED", "В завершённый район нельзя добавлять задачи");
                      const entry = await this.selectBuilding(input.cityId, district.id, input.estimate, title, input.description ?? "", input.buildingHint);
                      let roads = await this.roadCells(countryId);
                      let surfaces = await this.localSurfaceCells(countryId, boundsOf(district.cells), roads, [district]);
                      const occupiedTasks = new Set((await this.listTasks(countryId)).flatMap((task) => task.footprint).map(cellKey));
                      let districtCellKeys = new Set(district.cells.map(cellKey));
                      let options = await this.taskPlacementOptions(countryId, district, entry, roads, surfaces, occupiedTasks, districtCellKeys);
                      // Organic growth: a task that no longer fits triggers the
                      // next complex inside the territory, then territory growth.
                      for (let growth = 0; options.length === 0 && growth < 4; growth += 1) {
                        district = await this.growDistrict(countryId, district, entry);
                        roads = await this.roadCells(countryId);
                        surfaces = await this.localSurfaceCells(countryId, boundsOf(district.cells), roads, [district]);
                        districtCellKeys = new Set(district.cells.map(cellKey));
                        options = await this.taskPlacementOptions(countryId, district, entry, roads, surfaces, occupiedTasks, districtCellKeys);
                      }
                      const selected = options.sort((a, b) => {
                        if (a.order !== b.order) return a.order - b.order;
                        const wasteA = a.lot.width * a.lot.height - entry.footprint.width * entry.footprint.height;
                        const wasteB = b.lot.width * b.lot.height - entry.footprint.width * entry.footprint.height;
                        return wasteA - wasteB || a.lot.origin.y - b.lot.origin.y || a.lot.origin.x - b.lot.origin.x;
                      })[0];
                      if (!selected) throw new DomainError("PLACEMENT_BLOCKED", "После расширения не появился подходящий участок для здания");
                      const id = randomUUID();
                      const createdAt = now();
                      const lots = district.lots.map((lot) => lot.id === selected.lot.id ? { ...lot, taskId: id, vacant: false } : lot);
                      await this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?").run(JSON.stringify(lots), district.id);
                      // A new building redevelops any ruin plot it overlaps.
                      await this.clearRuins(countryId, selected.placement.footprint);
                      await this.db.prepare(`INSERT INTO tasks_v3
        (id, city_id, district_id, title, description, work_item_type, acceptance_criteria, system_analysis, architecture, design_system, implementation_plan, estimate, priority, status, progress, due_at, building_type, platform_type, origin_x, origin_y, footprint_json, entrance_x, entrance_y, access_json, access_kind, creator_user_id, assignee_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                                                        id, input.cityId, district.id, title, input.description?.trim().slice(0, 8000) ?? "", input.workItemType ?? "TASK",
                                                        input.acceptanceCriteria?.trim().slice(0, 8000) ?? "", input.systemAnalysis?.trim().slice(0, 16000) ?? "",
                                                        input.architecture?.trim().slice(0, 16000) ?? "", input.designSystem?.trim().slice(0, 16000) ?? "",
                                                        input.implementationPlan?.trim().slice(0, 16000) ?? "", input.estimate,
                                                        input.priority ?? "NORMAL", "PLANNING", 0, input.dueAt ?? null, entry.key, entry.platform,
                                                        selected.placement.origin.x, selected.placement.origin.y, JSON.stringify(selected.placement.footprint),
                                                        selected.placement.entrance.x, selected.placement.entrance.y, JSON.stringify(selected.placement.accessPath), selected.placement.accessKind,
                                                        input.creatorUserId ?? null, input.assigneeUserId ?? null, createdAt, createdAt,
                                                      );
                      const creator = input.creatorUserId
                        ? await this.db.prepare("SELECT name FROM users WHERE id = ?").get(input.creatorUserId) as { name: string } | undefined
                        : undefined;
                      await this.recordTaskEvent(id, "CREATED", creator?.name ?? "Система страны", input.creatorUserId, {
                                                        status: "PLANNING", estimate: input.estimate, assigneeUserId: input.assigneeUserId ?? null,
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
    estimate?: Estimate; priority?: TaskPriority; dueAt?: string | null; actor?: string; actorUserId?: string; idempotencyKey: string;
  }): Promise<TaskDto> {
    return this.mutate(countryId, "task.fields.v18", input.idempotencyKey, input, async () => {
      const current = await this.getTask(countryId, input.taskId);
      const title = input.title === undefined ? current.title : input.title.trim();
      if (title.length < 2 || title.length > 160) throw new DomainError("INVALID_INPUT", "Название задачи должно содержать от 2 до 160 символов");
      const updatedAt = now();
      await this.db.prepare(`UPDATE tasks_v3 SET title = ?, description = ?, work_item_type = ?, acceptance_criteria = ?,
        system_analysis = ?, architecture = ?, design_system = ?, implementation_plan = ?, estimate = ?, priority = ?, due_at = ?, updated_at = ?
        WHERE id = ?`).run(
        title, input.description === undefined ? current.description : input.description.trim().slice(0, 8000),
        input.workItemType ?? current.workItemType,
        input.acceptanceCriteria === undefined ? current.acceptanceCriteria : input.acceptanceCriteria.trim().slice(0, 8000),
        input.systemAnalysis === undefined ? current.systemAnalysis : input.systemAnalysis.trim().slice(0, 16000),
        input.architecture === undefined ? current.architecture : input.architecture.trim().slice(0, 16000),
        input.designSystem === undefined ? current.designSystem : input.designSystem.trim().slice(0, 16000),
        input.implementationPlan === undefined ? current.implementationPlan : input.implementationPlan.trim().slice(0, 16000),
        input.estimate ?? current.estimate, input.priority ?? current.priority,
        input.dueAt === undefined ? current.dueAt : input.dueAt, updatedAt, input.taskId,
      );
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
                      // Demolition leaves a ruin plot on the map. It blocks nothing
                      // and is cleared automatically when a new building, road or
                      // park redevelops the cell.
                      await this.insertWorldFeature(countryId, {
                                                        cityId: task.cityId, districtId: task.districtId, parentFeatureId: null,
                                                        kind: "RUIN", assetKind: "AREA", assetKey: "demolished-lot",
                                                        origin: task.origin, footprint: task.footprint, orientation: "S", accessPath: [],
                                                      });
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
                      return { data, eventType: "task.status_changed", eventPayload: { taskId: input.taskId, status: input.status, progress, affectedBounds: boundsOf(data.footprint) } };
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

  async assignTask(countryId: string, input: { taskId: string; assigneeUserId: string | null; actor?: string; actorUserId?: string; idempotencyKey: string }): Promise<TaskDto> {
    return await this.mutate(countryId, "task.assign.v7", input.idempotencyKey, input, async () => {
                      const task = await this.getTask(countryId, input.taskId);
                      if (input.assigneeUserId && !await this.db.prepare("SELECT 1 FROM country_members WHERE country_id = ? AND user_id = ?").get(countryId, input.assigneeUserId)) {
                        throw new DomainError("ASSIGNEE_NOT_MEMBER", "Ответственный должен состоять в правительстве страны");
                      }
                      const previous = task.assignee?.id ?? null;
                      const updatedAt = now();
                      await this.db.prepare("UPDATE tasks_v3 SET assignee_user_id = ?, updated_at = ? WHERE id = ?")
                                                        .run(input.assigneeUserId, updatedAt, input.taskId);
                      await this.recordTaskEvent(input.taskId, "ASSIGNEE_CHANGED", input.actor ?? "MCP", input.actorUserId, {
                                                        fromUserId: previous, toUserId: input.assigneeUserId,
                                                      }, updatedAt);
                      const data = await this.getTask(countryId, input.taskId);
                      return { data, eventType: "task.assignee_changed", eventPayload: { taskId: input.taskId, assigneeUserId: input.assigneeUserId, affectedBounds: boundsOf(data.footprint) } };
                    });
  }

  private decorations(
    seed: number,
    terrain: ChunkDto["terrain"],
    blocked: Set<string>,
    surfaces: SurfaceCellDto[],
    districts: DistrictDto[],
    cities: CityDto[],
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
        kind = chance < 0.01 ? "streetlamp" : residents[Math.floor(hashCoordinate(seed, cell.x, cell.y, 733) * residents.length)];
      } else if (district && district.status !== "ACTIVE" && (cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < 0.006) {
        const own = districtCellKeys.get(district.id)!;
        const edge = GRID_DIRECTIONS.findIndex((direction) => !own.has(cellKey({ x: cell.x + direction.x, y: cell.y + direction.y })));
        if (edge >= 0) kind = edge % 2 === 0 ? "fence-horizontal" : "fence-vertical";
      } else if (cell.terrain === "FOREST" && chance < 0.17) {
        if (chance < 0.055) kind = "tree-conifer";
        else if (chance < 0.125) kind = "tree-round";
        else kind = "tree-flowering";
      } else if (cell.terrain === "HILL" && chance < 0.085) {
        kind = chance < 0.035 ? "hill-rocky" : chance < 0.06 ? "hill-small" : "tree-conifer";
      } else if (cell.terrain === "MOUNTAIN" && chance < 0.075) {
        kind = chance < 0.03 ? "mountain-peak" : chance < 0.052 ? "mountain-ridge" : "rock-cluster";
      }
      else if ((cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < 0.016) {
        const variants = ["flower-white", "flower-yellow", "flower-red", "flower-purple", "bush-dark", "bush-light", "bush-berries", "rock-small"];
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
    return result;
  }

  async getChunk(countryId: string, chunkX: number, chunkY: number, lod: "DETAIL" | "OVERVIEW" = "DETAIL"): Promise<ChunkDto> {
    const country = await this.countryRow(countryId);
    const seed = Number(country.seed);
    const worldVersion = Number(country.world_version);
    const cacheKey = `${countryId}:${chunkX}:${chunkY}:${lod}`;
    const cached = this.cachedChunk(cacheKey, worldVersion);
    if (cached) return cached;
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
    const roads = await roadRows(chunkBounds);
    const surfaceScope = lod === "DETAIL" ? expandRect(chunkBounds, 2) : chunkBounds;
    const nearbyDistricts = await this.districtsInBounds(countryId, surfaceScope);
    const nearbyCities = lod === "DETAIL" ? await this.citiesInBounds(countryId, expandRect(chunkBounds, 96)) : [];
    const nearbyTasks = await this.tasksInBounds(countryId, surfaceScope, lod === "DETAIL");
    const nearbyFeatures = await this.featuresInBounds(countryId, surfaceScope);
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
      for (const task of nearbyTasks) if (task.accessKind === "PATH") for (const cell of task.accessPath) publish(cell);
      return [...paths.values()];
    })() : [...buildSurfaceMap({
                      roads: new Map((await roadRows(surfaceScope)).map((road) => [cellKey(road), road])),
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
    return this.storeChunk(cacheKey, {
      chunkX, chunkY, size: CHUNK_SIZE, terrain, roads, surfaces, districts,
      tasks: chunkTasks.map((task) => ({
        id: task.id, cityId: task.cityId, districtId: task.districtId, title: task.title,
        ...(lod === "DETAIL" && task.description ? { descriptionPreview: task.description.trim().replace(/\s+/g, " ").slice(0, 128) } : {}),
        workItemType: task.workItemType,
        ...(lod === "DETAIL" && defectSummaryByTask.has(task.id) ? { defectSummary: defectSummaryByTask.get(task.id) } : {}),
        status: task.status, progress: task.progress, stage: task.stage,
        buildingType: task.buildingType, platformType: task.platformType, origin: task.origin, footprint: task.footprint,
      })),
      worldFeatures,
      decorations: lod === "DETAIL" ? this.decorations(seed, terrain, blocked, surfaces, nearbyDistricts, nearbyCities) : [],
      worldVersion,
    });
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
