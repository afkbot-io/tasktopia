import { createHash, randomUUID } from "node:crypto";
import { BUILDING_CATALOG, getBuilding, inferTaskTags, type BuildingCatalogEntry } from "../shared/catalog";
import {
  STATUS_PROGRESS_RANGE,
  TASK_STAGE,
  type BootstrapDto,
  type Cell,
  type ChunkDto,
  type CityDto,
  type CityMorphology,
  type DistrictArchetype,
  type CountryDto,
  type DecorationDto,
  type DistrictDto,
  type DistrictStatus,
  type Estimate,
  type PlannedLotDto,
  type RealtimeEvent,
  type Rect,
  type RoadCellDto,
  type SurfaceCellDto,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
  type WorldFeatureDto,
} from "../shared/contracts";
import type { Db } from "./db";
import { now, transaction } from "./db";
import { listAccessibleCountries, type AuthUser } from "./auth";
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
// A visual 8 px cell is much smaller than the product-level "district cell"
// from the first prototype. A 26 SP district must reserve enough frontage for
// ten mixed footprints before the first task arrives; otherwise normal growth
// immediately creates long appendages and dead-end streets.
const DISTRICT_MIN_WIDTH = 28;
const DISTRICT_MIN_HEIGHT = 20;
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
  return JSON.parse(String(value)) as T;
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

function featureDto(row: Row): WorldFeatureDto {
  return {
    id: String(row.id),
    cityId: row.city_id ? String(row.city_id) : null,
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

  constructor(private readonly db: Db, private readonly onEvent?: (event: RealtimeEvent) => void) {}

  private countryRow(countryId: string): Row {
    const row = this.db.prepare("SELECT * FROM countries WHERE id = ?").get(countryId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Страна не найдена");
    return row;
  }

  private createEvent(countryId: string, type: string, payload: Record<string, unknown>): RealtimeEvent {
    this.db.prepare("UPDATE countries SET world_version = world_version + 1 WHERE id = ?").run(countryId);
    const country = this.countryRow(countryId);
    const createdAt = now();
    const version = Number(country.world_version);
    const result = this.db.prepare("INSERT INTO events (country_id, type, world_version, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(countryId, type, version, JSON.stringify(payload), createdAt);
    return { id: Number(result.lastInsertRowid), countryId, type, worldVersion: version, payload, createdAt };
  }

  private mutate<T>(countryId: string, operation: string, idempotencyKey: string, payload: unknown, callback: () => { data: T; eventType: string; eventPayload: Record<string, unknown> }): T {
    if (!idempotencyKey || idempotencyKey.length > 160) throw new DomainError("INVALID_INPUT", "Нужен корректный idempotencyKey");
    const requestHash = stableHash(payload);
    const existing = this.db.prepare("SELECT request_hash, response_json FROM idempotency WHERE country_id = ? AND operation = ? AND idempotency_key = ?")
      .get(countryId, operation, idempotencyKey) as Row | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) throw new DomainError("CONFLICT", "Этот idempotencyKey уже использован с другими данными");
      return json<T>(existing.response_json);
    }
    let emitted: RealtimeEvent | undefined;
    let data: T;
    try {
      data = transaction(this.db, () => {
        const raced = this.db.prepare("SELECT request_hash, response_json FROM idempotency WHERE country_id = ? AND operation = ? AND idempotency_key = ?")
          .get(countryId, operation, idempotencyKey) as Row | undefined;
        if (raced) {
          if (raced.request_hash !== requestHash) throw new DomainError("CONFLICT", "Этот idempotencyKey уже использован с другими данными");
          return json<T>(raced.response_json);
        }
        const result = callback();
        emitted = this.createEvent(countryId, result.eventType, result.eventPayload);
        this.db.prepare("INSERT INTO idempotency (country_id, operation, idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(countryId, operation, idempotencyKey, requestHash, JSON.stringify(result.data), now());
        return result.data;
      });
    } catch (error) {
      // Road changes may have touched the in-memory index before a later
      // invariant failed. Dropping it guarantees the next read reflects the
      // rolled-back SQLite transaction.
      this.roadCache.delete(countryId);
      this.surfaceCache.delete(countryId);
      throw error;
    }
    if (emitted) this.onEvent?.(emitted);
    return data;
  }

  getBootstrap(user: AuthUser): BootstrapDto {
    return {
      user: { id: user.id, email: user.email, name: user.name },
      country: this.getCountry(user.countryId),
      countries: listAccessibleCountries(this.db, user.id).map((access) => ({
        ...this.getCountry(access.id), role: access.role, memberCount: access.memberCount,
      })),
      countryRole: user.countryRole,
      cities: this.listCities(user.countryId),
      districts: this.listDistricts(user.countryId),
      tasks: this.listTasks(user.countryId),
      chunkSize: CHUNK_SIZE,
      assetVersion: 4,
    };
  }

  getCountry(countryId: string): CountryDto {
    const row = this.countryRow(countryId);
    return { id: String(row.id), name: String(row.name), worldVersion: Number(row.world_version), generatorVersion: "square-v7", createdAt: String(row.created_at) };
  }

  listCities(countryId: string): CityDto[] {
    return (this.db.prepare("SELECT * FROM cities_v3 WHERE country_id = ? ORDER BY created_at").all(countryId) as Row[]).map(cityDto);
  }

  listDistricts(countryId: string, cityId?: string): DistrictDto[] {
    const rows = cityId
      ? this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE c.country_id = ? AND d.city_id = ? ORDER BY d.created_at").all(countryId, cityId)
      : this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE c.country_id = ? ORDER BY d.created_at").all(countryId);
    return (rows as Row[]).map(districtDto);
  }

  listTasks(countryId: string, districtId?: string): TaskDto[] {
    const rows = districtId
      ? this.db.prepare("SELECT t.* FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? AND t.district_id = ? ORDER BY t.created_at").all(countryId, districtId)
      : this.db.prepare("SELECT t.* FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? ORDER BY t.created_at").all(countryId);
    return (rows as Row[]).map(taskDto);
  }

  listWorldFeatures(countryId: string): WorldFeatureDto[] {
    return (this.db.prepare("SELECT * FROM world_features_v6 WHERE country_id = ? ORDER BY created_at, id").all(countryId) as Row[]).map(featureDto);
  }

  getTask(countryId: string, taskId: string): TaskDto {
    const row = this.db.prepare("SELECT t.* FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id WHERE c.country_id = ? AND t.id = ?")
      .get(countryId, taskId) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Задача не найдена");
    const task = taskDto(row);
    task.comments = (this.db.prepare("SELECT * FROM task_comments_v3 WHERE task_id = ? ORDER BY created_at").all(taskId) as Row[]).map((comment) => ({
      id: String(comment.id), taskId, body: String(comment.body), actor: String(comment.actor), createdAt: String(comment.created_at),
    }));
    const account = (userId: unknown) => {
      if (!userId) return null;
      const user = this.db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(String(userId)) as Row | undefined;
      return user ? { id: String(user.id), email: String(user.email), name: String(user.name) } : null;
    };
    task.creator = account(row.creator_user_id);
    task.assignee = account(row.assignee_user_id);
    task.events = (this.db.prepare("SELECT * FROM task_events_v7 WHERE task_id = ? ORDER BY id").all(taskId) as Row[]).map((event) => ({
      id: Number(event.id), taskId, type: String(event.event_type) as NonNullable<TaskDto["events"]>[number]["type"],
      actor: String(event.actor_label), actorUserId: event.actor_user_id ? String(event.actor_user_id) : null,
      details: json<Record<string, unknown>>(event.details_json), createdAt: String(event.created_at),
    }));
    return task;
  }

  private recordTaskEvent(taskId: string, type: NonNullable<TaskDto["events"]>[number]["type"], actor: string, actorUserId: string | undefined, details: Record<string, unknown>, createdAt = now()): void {
    this.db.prepare(`INSERT INTO task_events_v7 (task_id, actor_user_id, actor_label, event_type, details_json, created_at)
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

  private nextCityCenter(countryId: string, seed: number): Cell {
    const cities = this.listCities(countryId);
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

  private roadCells(countryId: string): Map<string, RoadCellDto> {
    const cached = this.roadCache.get(countryId);
    if (cached) return cached;
    const rows = this.db.prepare("SELECT x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ?").all(countryId) as Row[];
    const roads = new Map(rows.map((row) => {
      const cell: RoadCellDto = { x: Number(row.x), y: Number(row.y), mask: Number(row.mask), structure: String(row.structure) as RoadCellDto["structure"], roadClass: String(row.road_class) as RoadCellDto["roadClass"] };
      return [cellKey(cell), cell];
    }));
    this.roadCache.set(countryId, roads);
    return roads;
  }

  private completedDistrictCells(countryId: string): Set<string> {
    return new Set(this.listDistricts(countryId)
      .filter((district) => district.status === "COMPLETED")
      .flatMap((district) => district.cells)
      .map(cellKey));
  }

  private surfaceCells(countryId: string, roads = this.roadCells(countryId)): Map<string, SurfaceCellDto> {
    const canonicalRoads = this.roadCells(countryId);
    const canCache = roads === canonicalRoads;
    const cached = canCache ? this.surfaceCache.get(countryId) : undefined;
    if (cached) return cached;
    const seed = Number(this.countryRow(countryId).seed);
    const result = buildSurfaceMap({
      roads,
      cities: this.listCities(countryId),
      districts: this.listDistricts(countryId),
      tasks: this.listTasks(countryId),
      features: this.listWorldFeatures(countryId),
      isSurfaceTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
    });
    if (canCache) this.surfaceCache.set(countryId, result);
    return result;
  }

  private route(countryId: string, seed: number, start: Cell, end: Cell, avoidBounds: Rect[] = []): Cell[] {
    const roads = this.roadCells(countryId);
    const sealed = this.completedDistrictCells(countryId);
    const reservedFootprints = [
      ...this.listTasks(countryId).flatMap((task) => [...task.footprint, task.entrance, ...task.accessPath]),
      ...this.listWorldFeatures(countryId).flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
    ];
    const occupied = new Set(reservedFootprints.flatMap((cell) => {
      const halo: Cell[] = [];
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) halo.push({ x: cell.x + dx, y: cell.y + dy });
      return halo;
    }).map(cellKey));
    const path = aStarPath(start, end, (cell) => {
      const isEndpoint = cell.x === start.x && cell.y === start.y || cell.x === end.x && cell.y === end.y;
      const existing = roads.has(cellKey(cell));
      if (!isEndpoint && avoidBounds.some((bounds) => contains(bounds, cell))) return Number.POSITIVE_INFINITY;
      if (existing) return 0.12;
      if (sealed.has(cellKey(cell))) return Number.POSITIVE_INFINITY;
      if (occupied.has(cellKey(cell))) return Number.POSITIVE_INFINITY;
      const terrain = terrainAt(seed, cell.x, cell.y).terrain;
      if (terrain === "DEEP_WATER") return 18;
      if (terrain === "SHALLOW_WATER") return 10;
      if (terrain === "WET_SAND") return 4;
      if (terrain === "MOUNTAIN") return 45;
      if (terrain === "HILL") return 7;
      if (terrain === "FOREST") return 3.2;
      if (terrain === "STONE") return 2.2;
      return 1;
    }, 64, 1.4, false);
    if (path.length === 0) throw new DomainError(
      "ROUTE_BLOCKED",
      `Не удалось проложить дорогу без пересечения существующих зданий (${start.x},${start.y} → ${end.x},${end.y})`,
    );
    return path;
  }

  private roadCorridor(path: Cell[], roadClass: RoadCellDto["roadClass"]): Cell[] {
    return stampRoadCorridor(path, roadClass, ROAD_WIDTH);
  }

  private addRoadPath(countryId: string, seed: number, path: Cell[], roadClass: RoadCellDto["roadClass"]): void {
    const roads = this.roadCells(countryId);
    const sealed = this.completedDistrictCells(countryId);
    const committedFootprints = new Set([
      ...this.listTasks(countryId).flatMap((task) => [...task.footprint, task.entrance, ...task.accessPath]),
      ...this.listWorldFeatures(countryId).flatMap((feature) => [...feature.footprint, ...feature.accessPath]),
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
    const upsert = this.db.prepare("INSERT INTO roads_v3 (country_id, x, y, mask, structure, road_class) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(country_id, x, y) DO UPDATE SET structure = excluded.structure, road_class = excluded.road_class");
    for (const cell of corridor) {
      const terrain = terrainAt(seed, cell.x, cell.y).terrain;
      const structure: RoadCellDto["structure"] = isWater(terrain) ? "BRIDGE" : "ROAD";
      const existing = roads.get(cellKey(cell));
      const selectedClass = existing && ROAD_CLASS_RANK[existing.roadClass] > ROAD_CLASS_RANK[roadClass] ? existing.roadClass : roadClass;
      const updated: RoadCellDto = { ...cell, mask: existing?.mask ?? 0, structure, roadClass: selectedClass };
      roads.set(cellKey(cell), updated);
      upsert.run(countryId, cell.x, cell.y, updated.mask, structure, selectedClass);
    }
    this.recalculateRoadMasks(countryId, corridor);
    this.surfaceCache.delete(countryId);
  }

  private recalculateRoadMasks(countryId: string, affected?: Iterable<Cell>): void {
    const roads = this.roadCells(countryId);
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

  private highwayAnchor(countryId: string, target: Cell, cities: CityDto[]): Cell | undefined {
    const highways = [...this.roadCells(countryId).values()].filter((road) => road.roadClass === "HIGHWAY");
    const originalCities = cities.map((city) => rectForCenter(city.center));
    const districtEnvelopes = this.listDistricts(countryId).map((district) => expandRect(boundsOf(district.cells), 3));
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

  private districtStreetPlan(
    origin: Cell,
    width: number,
    height: number,
    seed: number,
    capacity: number,
    archetype: DistrictArchetype,
  ): { main: Cell[]; branches: Cell[][] } {
    const horizontal = width >= height;
    // Streets are generated as a compact, legible block skeleton. Earlier
    // one-sided branches produced long hooks once a second district connected
    // to them. Full cross streets make real T/+ intersections, keep every lot
    // close to a sidewalk and leave cars a continuous network.
    const lateralOffset = Math.floor(hashCoordinate(seed, origin.x, origin.y, 551) * 3) - 1;
    const branchCount = archetype === "PRIVATE" && capacity < 24 ? 1 : 2;
    if (horizontal) {
      const mainY = Math.max(origin.y + 4, Math.min(origin.y + height - 5, origin.y + Math.floor(height / 2) + lateralOffset));
      const main = orthogonalPath({ x: origin.x + 1, y: mainY }, { x: origin.x + width - 2, y: mainY }, true);
      const branches: Cell[][] = [];
      for (let index = 0; index < branchCount; index += 1) {
        const ratio = branchCount === 1 ? 0.52 : index === 0 ? 0.34 : 0.68;
        const x = origin.x + Math.floor(width * ratio);
        branches.push(orthogonalPath({ x, y: origin.y + 1 }, { x, y: origin.y + height - 2 }, false));
      }
      return { main, branches };
    }
    const mainX = Math.max(origin.x + 4, Math.min(origin.x + width - 5, origin.x + Math.floor(width / 2) + lateralOffset));
    const main = orthogonalPath({ x: mainX, y: origin.y + 1 }, { x: mainX, y: origin.y + height - 2 }, false);
    const branches: Cell[][] = [];
    for (let index = 0; index < branchCount; index += 1) {
      const ratio = branchCount === 1 ? 0.52 : index === 0 ? 0.34 : 0.68;
      const y = origin.y + Math.floor(height * ratio);
      branches.push(orthogonalPath({ x: origin.x + 1, y }, { x: origin.x + width - 2, y }, true));
    }
    return { main, branches };
  }

  private featurePlacementOpen(countryId: string, seed: number, footprint: Cell[], avoidBounds: Rect[] = []): boolean {
    const roads = this.roadCells(countryId);
    const occupied = new Set([
      ...this.listTasks(countryId).flatMap((task) => task.footprint).map(cellKey),
      ...this.listWorldFeatures(countryId).flatMap((feature) => feature.footprint).map(cellKey),
    ]);
    return footprint.every((cell) => !roads.has(cellKey(cell))
      && !occupied.has(cellKey(cell))
      && !avoidBounds.some((bounds) => contains(bounds, cell))
      && isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain));
  }

  private insertWorldFeature(countryId: string, input: Omit<WorldFeatureDto, "id">): WorldFeatureDto {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO world_features_v6
      (id, country_id, city_id, kind, asset_kind, asset_key, origin_x, origin_y, footprint_json, orientation, access_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, countryId, input.cityId, input.kind, input.assetKind, input.assetKey,
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
    for (const start of starts.values()) if (surfaces.get(cellKey(start))?.kind === "SIDEWALK") return [];
    const queue = [...starts.values()].map((cell) => ({ cell, path: [cell] }));
    const visited = new Set<string>();
    while (queue.length > 0) {
      const state = queue.shift()!;
      const stateKey = cellKey(state.cell);
      if (visited.has(stateKey) || state.path.length > 4) continue;
      visited.add(stateKey);
      if (roads.has(stateKey) || occupied.has(stateKey) || footprintKeys.has(stateKey) || !isBuildableTerrain(terrainAt(seed, state.cell.x, state.cell.y).terrain)) continue;
      for (const next of neighbors4(state.cell)) {
        const nextKey = cellKey(next);
        if (surfaces.get(nextKey)?.kind === "SIDEWALK") return state.path;
        if (state.path.length >= 4 || !allowed.has(nextKey) || surfaces.has(nextKey) || roads.has(nextKey) || footprintKeys.has(nextKey) || occupied.has(nextKey)) continue;
        queue.push({ cell: next, path: [...state.path, next] });
      }
    }
    return null;
  }

  private publishDistrictGreenFeature(
    countryId: string,
    city: CityDto,
    seed: number,
    districtCells: Cell[],
    archetype: DistrictArchetype,
    districtIndex: number,
  ): void {
    const existingFeatures = this.listWorldFeatures(countryId);
    const existingGreen = existingFeatures.filter((feature) => feature.cityId === city.id && (feature.kind === "PARK" || feature.kind === "GROVE"));
    const chance = archetype === "PRIVATE" ? 0.58 : archetype === "CIVIC" ? 0.48 : archetype === "COMMERCIAL" ? 0.24 : 0.4;
    const roll = hashCoordinate(seed, city.center.x, city.center.y, 811 + districtIndex);
    const forceFirstGreen = districtIndex === 1 && existingGreen.length === 0;
    if (!forceFirstGreen && roll > chance) return;

    const cityIndex = this.listCities(countryId).findIndex((candidate) => candidate.id === city.id);
    const kind: Extract<WorldFeatureDto["kind"], "PARK" | "GROVE"> = (cityIndex + districtIndex + existingGreen.length) % 2 === 0 ? "GROVE" : "PARK";
    const size: readonly [number, number] = kind === "GROVE" ? [6, 5] : [5, 4];
    const allowed = new Set(districtCells.map(cellKey));
    const roads = this.roadCells(countryId);
    const surfaces = this.surfaceCells(countryId, roads);
    const occupied = new Set([
      ...this.listTasks(countryId).flatMap((task) => task.footprint),
      ...existingFeatures.flatMap((feature) => feature.footprint),
    ].map(cellKey));
    const bounds = boundsOf(districtCells);
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
    this.insertWorldFeature(countryId, {
      cityId: city.id,
      kind,
      assetKind: "AREA",
      assetKey: kind === "GROVE" ? "urban-grove" : "urban-park",
      origin: selected.origin,
      footprint: selected.footprint,
      orientation: "S",
      accessPath: selected.accessPath,
    });

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
      this.insertWorldFeature(countryId, {
        cityId: city.id, kind: "PARK_DECOR", assetKind: "PROP", assetKey,
        origin, footprint, orientation: "S", accessPath: [],
      });
    }
  }

  private publishCityGatewayFeatures(
    countryId: string,
    cityId: string,
    seed: number,
    bounds: Rect,
    gateway: Cell,
    portal: Cell,
    connector: Cell[],
    horizontalApproach: boolean,
  ): void {
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
    const placeProp = (kind: WorldFeatureDto["kind"], assetKey: string, anchor: Cell, size: [number, number]): void => {
      for (const offset of sideOffsets) {
        const origin = { x: anchor.x + offset.x, y: anchor.y + offset.y };
        const footprint = rectangleFootprint(origin, size[0], size[1]);
        if (!this.featurePlacementOpen(countryId, seed, footprint)) continue;
        this.insertWorldFeature(countryId, { cityId, kind, assetKind: "PROP", assetKey, origin, footprint, orientation, accessPath: [] });
        return;
      }
    };

    placeProp("CITY_SIGN", `city-sign-${roadAxisKey}`, portal, [1, 1]);
    placeProp("BUS_STOP", `bus-stop-${roadAxisKey}`, gateway, horizontalApproach ? [2, 1] : [1, 2]);

    // A long approach receives one shared service area. It is intentionally a
    // world feature rather than a fabricated user task.
    if (connector.length < 42) return;
    const catalog = getBuilding("commercial-highway-service-plaza");
    const cityExclusion = this.listCities(countryId).map((city) => expandRect(city.bounds, 4));
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
        if (!this.featurePlacementOpen(countryId, seed, footprint, cityExclusion)) continue;
        const entrance = horizontal
          ? { x: origin.x + Math.floor(catalog.footprint.width / 2), y: side < 0 ? origin.y + catalog.footprint.height : origin.y - 1 }
          : { x: side < 0 ? origin.x + catalog.footprint.width : origin.x - 1, y: origin.y + Math.floor(catalog.footprint.height / 2) };
        const accessWithRoad = orthogonalPath(entrance, cell, horizontal ? false : true);
        const roads = this.roadCells(countryId);
        const accessPath = accessWithRoad.filter((point) => !roads.has(cellKey(point)));
        if (accessPath.length > 8 || !this.featurePlacementOpen(countryId, seed, accessPath, cityExclusion)) continue;
        this.insertWorldFeature(countryId, {
          cityId: null,
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
        if (this.featurePlacementOpen(countryId, seed, stopFootprint, cityExclusion)) {
          this.insertWorldFeature(countryId, {
            cityId: null, kind: "BUS_STOP", assetKind: "PROP", assetKey: `bus-stop-${horizontal ? "horizontal" : "vertical"}`,
            origin: stopOrigin, footprint: stopFootprint, orientation: horizontal ? "E" : "S", accessPath: [],
          });
        }
        for (const [assetKey, offset] of [["streetlamp", { x: -2, y: 0 }], ["trash-bin", { x: catalog.footprint.width + 1, y: 1 }]] as const) {
          const decorOrigin = { x: origin.x + offset.x, y: origin.y + offset.y };
          const decorFootprint = [decorOrigin];
          if (this.featurePlacementOpen(countryId, seed, decorFootprint, cityExclusion)) {
            this.insertWorldFeature(countryId, {
              cityId: null, kind: "ROADSIDE_DECOR", assetKind: "PROP", assetKey,
              origin: decorOrigin, footprint: decorFootprint, orientation: "S", accessPath: [],
            });
          }
        }
        return;
      }
    }
  }

  createCity(countryId: string, input: { name: string; description?: string; morphology?: CityMorphology; idempotencyKey: string }): CityDto {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) throw new DomainError("INVALID_INPUT", "Название города должно содержать от 2 до 100 символов");
    return this.mutate(countryId, "city.create.v3", input.idempotencyKey, input, () => {
      const country = this.countryRow(countryId);
      const seed = Number(country.seed);
      const cities = this.listCities(countryId);
      const center = this.nextCityCenter(countryId, seed);
      const bounds = rectForCenter(center);
      const id = randomUUID();
      const createdAt = now();
      const styleId = `style-${Math.floor(hashCoordinate(seed, center.x, center.y, 433) * 8)}`;
      const morphology = input.morphology ?? cityMorphology(hashCoordinate(seed, center.x, center.y, 439));
      this.db.prepare("INSERT INTO cities_v3 (id, country_id, name, description, status, center_x, center_y, bounds_json, style_id, morphology, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)")
        .run(id, countryId, name, input.description?.trim().slice(0, 4000) ?? "", center.x, center.y, JSON.stringify(bounds), styleId, morphology, createdAt);

      const nearest = cities.length > 0
        ? cities.reduce((best, city) => manhattan(city.center, center) < manhattan(best.center, center) ? city : best, cities[0]!)
        : undefined;
      const approach = nearest?.center ?? { x: bounds.minX - 54, y: center.y + 9 };
      const gateway = this.cityGateway(bounds, center, approach);
      const portal = this.cityPortal(bounds, gateway.cell, gateway.horizontalApproach);
      const source = nearest ? this.highwayAnchor(countryId, portal, cities) ?? nearest.center : approach;
      const hub = this.cityHub(seed, center);
      const protectedUrbanEnvelopes = [
        ...cities.map((city) => rectForCenter(city.center)),
        ...this.listDistricts(countryId).map((district) => expandRect(boundsOf(district.cells), 3)),
      ];
      // A connector branches from a rural highway and routes around every
      // existing district. The new 100x100 reservation is protected as well so
      // the route reaches only its chosen portal.
      const connector = this.route(countryId, seed, source, portal, [...protectedUrbanEnvelopes, bounds]);
      this.addRoadPath(countryId, seed, connector, "HIGHWAY");
      this.addRoadPath(countryId, seed, orthogonalPath(portal, gateway.cell, gateway.horizontalApproach), "HIGHWAY");
      this.addRoadPath(countryId, seed, orthogonalPath(gateway.cell, hub, gateway.horizontalApproach), "ARTERIAL");
      const hubArm = gateway.horizontalApproach
        ? orthogonalPath({ x: hub.x, y: hub.y - 11 }, { x: hub.x, y: hub.y + 11 }, false)
        : orthogonalPath({ x: hub.x - 11, y: hub.y }, { x: hub.x + 11, y: hub.y }, true);
      this.addRoadPath(countryId, seed, hubArm, "COLLECTOR");
      this.publishCityGatewayFeatures(countryId, id, seed, bounds, gateway.cell, portal, connector, gateway.horizontalApproach);

      const data: CityDto = { id, name, description: input.description?.trim() ?? "", status: "ACTIVE", center, bounds, styleId, morphology, createdAt };
      return { data, eventType: "city.created", eventPayload: { cityId: id, center, affectedBounds: bounds } };
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

  private overlapsDistrict(countryId: string, cells: Cell[], exceptDistrictId?: string): boolean {
    const wanted = new Set(cells.map(cellKey));
    for (const district of this.listDistricts(countryId)) {
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

  private planLots(
    cells: Cell[],
    roads: Map<string, RoadCellDto>,
    surfaces: Map<string, SurfaceCellDto>,
    existing: PlannedLotDto[] = [],
    preferredSizes: ReadonlyArray<readonly [number, number]> = [],
    lotLimit = 64,
    archetype: DistrictArchetype = "MIXED_URBAN",
  ): PlannedLotDto[] {
    const allowed = new Set(cells.map(cellKey));
    const occupied = new Set<string>();
    for (const lot of existing) for (const cell of rectangleFootprint(lot.origin, lot.width, lot.height)) occupied.add(cellKey(cell));
    const lots = [...existing];
    const bounds = boundsOf(cells);
    const defaultSizes = archetype === "NEW_BUILD"
      ? [[7, 6], [6, 5], [5, 5], [5, 4], [4, 4], [4, 3]] as const
      : archetype === "PRIVATE"
        ? [[5, 4], [4, 4], [4, 3], [3, 3], [3, 2], [2, 2]] as const
        : archetype === "COMMERCIAL" || archetype === "CIVIC"
          ? [[8, 6], [7, 5], [6, 5], [6, 4], [5, 4], [4, 3], [3, 2]] as const
          : [[7, 5], [6, 5], [6, 4], [5, 4], [4, 3], [3, 3], [3, 2], [2, 2]] as const;
    const sizes = [...preferredSizes, ...defaultSizes]
      .filter(([width, height], index, all) => all.findIndex(([otherWidth, otherHeight]) => width === otherWidth && height === otherHeight) === index);
    let added = true;
    // A district may contain many one-point tasks. Keep a generous inventory of
    // differently sized plots; the SP limit remains the product-level capacity
    // guard, while this limit only protects the planning loop from malformed data.
    while (added && lots.length < lotLimit) {
      added = false;
      for (const [width, height] of sizes) {
        let placed = false;
        for (let y = bounds.minY; y <= bounds.maxY - height + 1 && !placed; y += 1) {
          for (let x = bounds.minX; x <= bounds.maxX - width + 1 && !placed; x += 1) {
            const footprint = rectangleFootprint({ x, y }, width, height);
            if (!footprint.every((cell) => allowed.has(cellKey(cell)) && !roads.has(cellKey(cell)) && !surfaces.has(cellKey(cell)) && !occupied.has(cellKey(cell)))) continue;
            const access = footprint.some((cell) => this.distanceToSurface(cell, surfaces, 6) <= 6);
            if (!access) continue;
            const lot: PlannedLotDto = { id: randomUUID(), origin: { x, y }, width, height, taskId: null };
            lots.push(lot);
            for (const cell of footprint) occupied.add(cellKey(cell));
            placed = true;
            added = true;
          }
        }
      }
    }
    return lots;
  }

  private replanDistrictLots(countryId: string, district: DistrictDto, entry: BuildingCatalogEntry): DistrictDto {
    const committed = district.lots.filter((lot) => lot.taskId);
    const preferred = [
      [entry.footprint.width, entry.footprint.height],
      [entry.footprint.width + 1, entry.footprint.height],
      [entry.footprint.width, entry.footprint.height + 1],
    ] as const;
    const roads = this.roadCells(countryId);
    const lots = this.planLots(district.cells, roads, this.surfaceCells(countryId, roads), committed, preferred, Math.max(96, committed.length + 48), district.archetype);
    this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?").run(JSON.stringify(lots), district.id);
    return { ...district, lots };
  }

  private districtGrowthReserve(district: DistrictDto, depth = 16): Rect {
    const bounds = boundsOf(district.cells);
    const shoulder = 2;
    if (district.growthDirection === "E") return { minX: bounds.maxX + 1, maxX: bounds.maxX + depth, minY: bounds.minY - shoulder, maxY: bounds.maxY + shoulder };
    if (district.growthDirection === "W") return { minX: bounds.minX - depth, maxX: bounds.minX - 1, minY: bounds.minY - shoulder, maxY: bounds.maxY + shoulder };
    if (district.growthDirection === "S") return { minX: bounds.minX - shoulder, maxX: bounds.maxX + shoulder, minY: bounds.maxY + 1, maxY: bounds.maxY + depth };
    return { minX: bounds.minX - shoulder, maxX: bounds.maxX + shoulder, minY: bounds.minY - depth, maxY: bounds.minY - 1 };
  }

  private selectDistrictSite(countryId: string, city: CityDto, seed: number, width: number, height: number): { origin: Cell; cells: Cell[] } {
    const roads = this.roadCells(countryId);
    const districts = this.listDistricts(countryId);
    const cityDistricts = districts.filter((district) => district.cityId === city.id);
    const preferredRoads = [...roads.values()].filter((road) => road.roadClass !== "HIGHWAY" && contains(expandRect(city.bounds, 24), road));
    const preferredRoadMap = new Map(preferredRoads.map((road) => [cellKey(road), road]));
    const occupied = new Set(districts.flatMap((district) => district.cells).map(cellKey));
    const growthReservations = districts
      .filter((district) => district.status === "ACTIVE")
      .map((district) => this.districtGrowthReserve(district));
    const protectedCities = this.listCities(countryId)
      .filter((candidate) => candidate.id !== city.id)
      .map((candidate) => expandRect(candidate.bounds, 12));
    for (const extension of [0, 32, 64, 96]) {
      const searchBounds = expandRect(city.bounds, extension);
      const candidates: Array<{ origin: Cell; cells: Cell[]; score: number }> = [];
      for (let y = searchBounds.minY + 5; y <= searchBounds.maxY - height - 5; y += 4) {
        for (let x = searchBounds.minX + 5; x <= searchBounds.maxX - width - 5; x += 4) {
          const origin = { x, y };
          const cells = this.districtShape(origin, width, height, seed);
          if (cells.some((cell) => occupied.has(cellKey(cell)))) continue;
          if (growthReservations.some((reservation) => cells.some((cell) => contains(reservation, cell)))) continue;
          const proposedEnvelope = unionRect(city.bounds, expandRect(boundsOf(cells), 8));
          if (protectedCities.some((bounds) => intersects(bounds, proposedEnvelope))) continue;
          const unsuitable = cells.filter((cell) => !isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain)).length;
          if (unsuitable / cells.length > 0.06) continue;
          const center = { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) };
          const candidateBounds = boundsOf(cells);
          const roadDistance = this.distanceToRoad(center, preferredRoadMap, 200);
          const districtDistance = cityDistricts.length === 0 ? 0 : Math.min(...cityDistricts.map((district) => {
            const other = boundsOf(district.cells);
            const dx = Math.max(0, other.minX - candidateBounds.maxX - 1, candidateBounds.minX - other.maxX - 1);
            const dy = Math.max(0, other.minY - candidateBounds.maxY - 1, candidateBounds.minY - other.maxY - 1);
            return dx + dy;
          }));
          const centerDistance = manhattan(center, city.center);
          const candidateDirection = this.outwardDirection(city, center);
          const repeatedDirection = cityDistricts.filter((district) => {
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

  createDistrict(countryId: string, input: { cityId: string; name: string; goal?: string; capacitySp?: number; activate?: boolean; archetype?: DistrictArchetype; idempotencyKey: string }): DistrictDto {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) throw new DomainError("INVALID_INPUT", "Название района должно содержать от 2 до 100 символов");
    return this.mutate(countryId, "district.create.v3", input.idempotencyKey, input, () => {
      const cityRow = this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
      if (!cityRow) throw new DomainError("NOT_FOUND", "Город не найден");
      const city = cityDto(cityRow);
      const seed = Number(this.countryRow(countryId).seed);
      const capacity = Math.max(1, Math.min(26, input.capacitySp ?? 14));
      const existingDistricts = this.listDistricts(countryId, city.id);
      const archetype = chooseDistrictArchetype({
        requested: input.archetype,
        name,
        goal: input.goal ?? "",
        morphology: city.morphology,
        existing: existingDistricts,
        variation: hashCoordinate(seed, city.center.x, city.center.y, 533 + existingDistricts.length),
      });
      const districtExtra = archetype === "NEW_BUILD" || archetype === "CIVIC" ? 5 : archetype === "COMMERCIAL" ? 3 : 0;
      const width = DISTRICT_MIN_WIDTH + Math.floor(capacity / 10) * 2 + districtExtra;
      const height = DISTRICT_MIN_HEIGHT + Math.floor(capacity / 18) * 2 + Math.floor(districtExtra / 2);
      const site = this.selectDistrictSite(countryId, city, seed, width, height);
      const expandedCity = unionRect(city.bounds, expandRect(boundsOf(site.cells), 8));
      if (JSON.stringify(expandedCity) !== JSON.stringify(city.bounds)) {
        this.db.prepare("UPDATE cities_v3 SET bounds_json = ? WHERE id = ?").run(JSON.stringify(expandedCity), city.id);
      }
      const center = { x: site.origin.x + Math.floor(width / 2), y: site.origin.y + Math.floor(height / 2) };
      const roadsBefore = this.roadCells(countryId);
      const sealed = this.completedDistrictCells(countryId);
      const safeAnchors = [...roadsBefore.values()].filter((road) => !sealed.has(cellKey(road)) || neighbors4(road).some((cell) => !sealed.has(cellKey(cell))));
      const nearestRoad = safeAnchors.reduce<Cell | undefined>((best, road) => !best || manhattan(road, center) < manhattan(best, center) ? road : best, undefined);
      const streets = this.districtStreetPlan(site.origin, width, height, seed, capacity, archetype);
      const streetSegments = [streets.main, ...streets.branches];
      let connectedSegment = 0;
      if (nearestRoad) {
        const endpoints = streetSegments.flatMap((segment, segmentIndex) => [
          { entrance: segment[0]!, segmentIndex },
          { entrance: segment.at(-1)!, segmentIndex },
        ]);
        const pair = safeAnchors.flatMap((road) => endpoints.map(({ entrance, segmentIndex }) => ({ road, entrance, segmentIndex, distance: manhattan(road, entrance) })))
          .sort((left, right) => left.distance - right.distance)[0];
        if (pair) {
          connectedSegment = pair.segmentIndex;
          this.addRoadPath(countryId, seed, this.route(countryId, seed, pair.road, pair.entrance), "COLLECTOR");
        }
      }
      const publicationOrder = [streetSegments[connectedSegment]!, ...streetSegments.filter((_, index) => index !== connectedSegment)];
      for (const segment of publicationOrder) this.addRoadPath(countryId, seed, segment, "LOCAL");
      const roads = this.roadCells(countryId);
      this.publishDistrictGreenFeature(countryId, city, seed, site.cells, archetype, existingDistricts.length);
      const lots = this.planLots(site.cells, roads, this.surfaceCells(countryId, roads), [], [], 64, archetype);
      if (lots.length < 3) throw new DomainError("PLACEMENT_UNAVAILABLE", "Район не образовал достаточно доступных участков");
      const status: DistrictStatus = input.activate ? "ACTIVE" : "PLANNED";
      if (status === "ACTIVE" && this.db.prepare("SELECT 1 FROM districts_v3 WHERE city_id = ? AND status = 'ACTIVE'").get(city.id)) {
        throw new DomainError("CONFLICT", "У города уже есть активный район");
      }
      const id = randomUUID();
      const createdAt = now();
      const count = Number((this.db.prepare("SELECT COUNT(*) AS count FROM districts_v3 WHERE city_id = ?").get(city.id) as Row).count);
      const color = SPRINT_COLORS[count % SPRINT_COLORS.length]!;
      const growthDirection = this.outwardDirection(city, center);
      this.db.prepare("INSERT INTO districts_v3 (id, city_id, name, goal, status, capacity_sp, cells_json, lots_json, growth_direction, archetype, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, city.id, name, input.goal?.trim().slice(0, 2000) ?? "", status, capacity, JSON.stringify(site.cells), JSON.stringify(lots), growthDirection, archetype, color, createdAt);
      const data: DistrictDto = { id, cityId: city.id, name, goal: input.goal?.trim() ?? "", status, capacitySp: capacity, cells: site.cells, lots, growthDirection, archetype, color, createdAt };
      return { data, eventType: "district.created", eventPayload: { districtId: id, cityId: city.id, affectedBounds: boundsOf(site.cells) } };
    });
  }

  activateDistrict(countryId: string, districtId: string, idempotencyKey: string): DistrictDto {
    return this.mutate(countryId, "district.activate.v3", idempotencyKey, { districtId }, () => {
      const row = this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE d.id = ? AND c.country_id = ?").get(districtId, countryId) as Row | undefined;
      if (!row) throw new DomainError("NOT_FOUND", "Район не найден");
      if (row.status === "COMPLETED") throw new DomainError("DISTRICT_SEALED", "Завершённый район нельзя снова активировать");
      this.db.prepare("UPDATE districts_v3 SET status = 'PLANNED' WHERE city_id = ? AND status = 'ACTIVE'").run(String(row.city_id));
      this.db.prepare("UPDATE districts_v3 SET status = 'ACTIVE' WHERE id = ?").run(districtId);
      const data = districtDto({ ...row, status: "ACTIVE" });
      return { data, eventType: "district.activated", eventPayload: { districtId, cityId: data.cityId } };
    });
  }

  completeDistrict(countryId: string, districtId: string, idempotencyKey: string): DistrictDto {
    return this.mutate(countryId, "district.complete.v3", idempotencyKey, { districtId }, () => {
      const row = this.db.prepare("SELECT d.* FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id WHERE d.id = ? AND c.country_id = ?").get(districtId, countryId) as Row | undefined;
      if (!row) throw new DomainError("NOT_FOUND", "Район не найден");
      const unfinished = Number((this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE district_id = ? AND status <> 'COMPLETED'").get(districtId) as Row).count);
      if (unfinished > 0) throw new DomainError("DISTRICT_HAS_OPEN_TASKS", `В районе осталось незавершённых задач: ${unfinished}`);
      this.db.prepare("UPDATE districts_v3 SET status = 'COMPLETED' WHERE id = ?").run(districtId);
      this.surfaceCache.delete(countryId);
      const data = districtDto({ ...row, status: "COMPLETED" });
      return { data, eventType: "district.completed", eventPayload: { districtId, cityId: data.cityId } };
    });
  }

  private districtHasCollector(districtId: string): boolean {
    const row = this.db.prepare("SELECT cells_json, city_id FROM districts_v3 WHERE id = ?").get(districtId) as Row | undefined;
    if (!row) return false;
    const bounds = expandRect(boundsOf(json<Cell[]>(row.cells_json)), 3);
    return Boolean(this.db.prepare(`SELECT 1 FROM roads_v3 r JOIN cities_v3 c ON c.country_id = r.country_id
      WHERE c.id = ? AND r.x BETWEEN ? AND ? AND r.y BETWEEN ? AND ?
      AND r.road_class IN ('COLLECTOR', 'ARTERIAL', 'HIGHWAY') LIMIT 1`)
      .get(String(row.city_id), bounds.minX, bounds.maxX, bounds.minY, bounds.maxY));
  }

  private buildingRulesAllow(entry: BuildingCatalogEntry, cityId: string, districtId: string): boolean {
    for (const ruleId of entry.ruleIds) {
      switch (ruleId) {
        case "STANDARD": break;
        case "REQUIRES_COLLECTOR":
          if (!this.districtHasCollector(districtId)) return false;
          break;
        case "UNIQUE_SERVICE": {
          if (!entry.serviceRole) break;
          const roleExists = this.listTasksForCity(cityId).some((task) => {
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

  private entryAllowed(entry: BuildingCatalogEntry, cityId: string, districtId: string): boolean {
    if (!this.buildingRulesAllow(entry, cityId, districtId)) return false;
    const cityCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE city_id = ? AND building_type = ?").get(cityId, entry.key) as Row).count);
    const districtCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM tasks_v3 WHERE district_id = ? AND building_type = ?").get(districtId, entry.key) as Row).count);
    return (!entry.maxPerCity || cityCount < entry.maxPerCity) && (!entry.maxPerDistrict || districtCount < entry.maxPerDistrict);
  }

  private listTasksForCity(cityId: string): TaskDto[] {
    return (this.db.prepare("SELECT * FROM tasks_v3 WHERE city_id = ?").all(cityId) as Row[]).map(taskDto);
  }

  private requiredServiceRole(cityId: string, districtId: string, estimate: Estimate): string | undefined {
    const tasks = this.listTasksForCity(cityId);
    const present = new Set(tasks.map((task) => BUILDING_CATALOG.find((entry) => entry.key === task.buildingType)?.serviceRole).filter(Boolean));
    const district = this.listDistricts(String((this.db.prepare("SELECT country_id FROM cities_v3 WHERE id = ?").get(cityId) as Row).country_id), cityId)
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
      if (BUILDING_CATALOG.some((entry) => entry.serviceRole === item.role && entry.estimates.includes(estimate) && this.entryAllowed(entry, cityId, districtId))) return item.role;
    }
    return undefined;
  }

  private selectBuilding(cityId: string, districtId: string, estimate: Estimate, title: string, description: string, hint?: string): BuildingCatalogEntry {
    const district = (this.db.prepare("SELECT * FROM districts_v3 WHERE id = ? AND city_id = ?").get(districtId, cityId) as Row | undefined);
    if (!district) throw new DomainError("NOT_FOUND", "Район не найден");
    const archetype = districtDto(district).archetype;
    if (hint) {
      const exact = BUILDING_CATALOG.find((entry) => entry.key === hint && entry.estimates.includes(estimate));
      if (!exact) throw new DomainError("INVALID_BUILDING_HINT", "Указанный тип здания не подходит оценке или не существует");
      if (!this.entryAllowed(exact, cityId, districtId)) throw new DomainError("BUILDING_QUOTA_REACHED", "Лимит этого типа здания уже достигнут");
      if (!buildingCompatibleWithArchetype(exact, archetype)) throw new DomainError("BUILDING_ZONE_CONFLICT", "Этот тип здания несовместим с архитектурой района");
      return exact;
    }
    const tags = new Set(inferTaskTags(title, description));
    const requiredService = this.requiredServiceRole(cityId, districtId, estimate);
    const cityRows = this.db.prepare("SELECT building_type FROM tasks_v3 WHERE city_id = ?").all(cityId) as Row[];
    const districtRows = this.db.prepare("SELECT building_type FROM tasks_v3 WHERE district_id = ?").all(districtId) as Row[];
    const cityCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    const districtCounts = new Map<string, number>();
    for (const row of cityRows) {
      const key = String(row.building_type);
      cityCounts.set(key, (cityCounts.get(key) ?? 0) + 1);
      const entry = BUILDING_CATALOG.find((item) => item.key === key);
      if (entry) categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);
    }
    for (const row of districtRows) {
      const key = String(row.building_type);
      districtCounts.set(key, (districtCounts.get(key) ?? 0) + 1);
    }
    const compatible = BUILDING_CATALOG.filter((entry) => entry.estimates.includes(estimate)
      && this.entryAllowed(entry, cityId, districtId)
      && buildingCompatibleWithArchetype(entry, archetype)
      && (!requiredService || entry.serviceRole === requiredService));
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
        + (categoryCounts.get(entry.category) ?? 0) * 1.2 + rarityPenalty + unrelatedServicePenalty - semanticBonus - morphologyBonus
        + stringHash(`${title}:${entry.key}`) * 2;
      return { entry, score };
    }).sort((a, b) => a.score - b.score)[0]!.entry;
  }

  private placementInLot(
    countryId: string,
    lot: PlannedLotDto,
    entry: BuildingCatalogEntry,
    roads: Map<string, RoadCellDto>,
    surfaces: Map<string, SurfaceCellDto>,
    occupied: Set<string>,
    districtCells?: Set<string>,
  ): { origin: Cell; footprint: Cell[]; entrance: Cell; accessPath: Cell[]; accessKind: TaskDto["accessKind"] } | null {
    if (lot.taskId || entry.footprint.width > lot.width || entry.footprint.height > lot.height) return null;
    const seed = Number(this.countryRow(countryId).seed);
    const lotCenter = { x: lot.origin.x + lot.width / 2, y: lot.origin.y + lot.height / 2 };
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
        if (footprint.some((cell) => roads.has(cellKey(cell)) || surfaces.has(cellKey(cell)) || occupied.has(cellKey(cell)))) continue;
        const access = findAccessPlan({
          entry,
          origin,
          lotCells,
          buildingFootprint: footprintKeys,
          occupied,
          roads,
          surfaces,
          isWalkableTerrain: (cell) => isBuildableTerrain(terrainAt(seed, cell.x, cell.y).terrain),
          maxLength: 6,
        });
        if (!access) continue;
        const buildingCenter = {
          x: origin.x + entry.footprint.width / 2,
          y: origin.y + entry.footprint.height / 2,
        };
        const centering = Math.abs(buildingCenter.x - lotCenter.x) + Math.abs(buildingCenter.y - lotCenter.y);
        candidates.push({ origin, footprint, entrance: access.entrance, accessPath: access.path, score: access.distance * 100 + centering });
      }
    }
    const selected = candidates.sort((left, right) => left.score - right.score || left.origin.y - right.origin.y || left.origin.x - right.origin.x)[0];
    const accessKind: TaskDto["accessKind"] = entry.platform === "ASPHALT"
      || entry.tags.some((tag) => ["fire-service", "police-service", "health-service"].includes(tag))
      ? "DRIVEWAY"
      : "PATH";
    return selected ? { origin: selected.origin, footprint: selected.footprint, entrance: selected.entrance, accessPath: selected.accessPath, accessKind } : null;
  }

  private expandDistrict(countryId: string, district: DistrictDto, entry: BuildingCatalogEntry): DistrictDto {
    if (district.status === "COMPLETED") throw new DomainError("DISTRICT_SEALED", "Закрытый район больше не расширяется");
    const seed = Number(this.countryRow(countryId).seed);
    const originalBounds = boundsOf(district.cells);
    const existingKeys = new Set(district.cells.map(cellKey));
    const blockedByDistrict = new Set(
      this.listDistricts(countryId)
        .filter((candidate) => candidate.id !== district.id)
        .flatMap((candidate) => candidate.cells)
        .map(cellKey),
    );
    const directions = ([district.growthDirection, "E", "S", "W", "N"] as GrowthDirection[])
      .filter((value, index, all) => all.indexOf(value) === index);
    for (const thickness of [10, 14, 18]) {
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
        if (patch.length < 48) continue;
        const updatedCells = [...district.cells, ...patch];
        const patchBounds = boundsOf(patch);
        const patchCenter = { x: Math.floor((patchBounds.minX + patchBounds.maxX) / 2), y: Math.floor((patchBounds.minY + patchBounds.maxY) / 2) };
        const roadsBefore = this.roadCells(countryId);
        const horizontal = patchBounds.maxX - patchBounds.minX >= patchBounds.maxY - patchBounds.minY;
        const spine = horizontal
          ? orthogonalPath({ x: patchBounds.minX + 1, y: patchCenter.y }, { x: patchBounds.maxX - 1, y: patchCenter.y }, true)
          : orthogonalPath({ x: patchCenter.x, y: patchBounds.minY + 1 }, { x: patchCenter.x, y: patchBounds.maxY - 1 }, false);
        const districtRoads = [...roadsBefore.values()].filter((road) => existingKeys.has(cellKey(road)));
        const sealed = this.completedDistrictCells(countryId);
        const safeRoads = [...roadsBefore.values()].filter((road) => !sealed.has(cellKey(road)) || neighbors4(road).some((cell) => !sealed.has(cellKey(cell))));
        const nearest = (districtRoads.length > 0 ? districtRoads : safeRoads)
          .reduce<Cell | undefined>((best, road) => !best || manhattan(road, patchCenter) < manhattan(best, patchCenter) ? road : best, undefined);
        const spineEntrance = nearest
          ? [spine[0]!, spine.at(-1)!].sort((a, b) => manhattan(a, nearest) - manhattan(b, nearest))[0]!
          : spine[0]!;
        let connector: Cell[] = [];
        if (nearest) {
          try {
            connector = this.route(countryId, seed, nearest, spineEntrance);
          } catch (error) {
            if (error instanceof DomainError && error.code === "ROUTE_BLOCKED") continue;
            throw error;
          }
        }
        const projectedRoads = new Map(roadsBefore);
        for (const cell of [...this.roadCorridor(connector, "LOCAL"), ...this.roadCorridor(spine, "LOCAL")]) {
          projectedRoads.set(cellKey(cell), { ...cell, mask: 0, structure: "ROAD", roadClass: "LOCAL" });
        }
        const projectedSurfaces = this.surfaceCells(countryId, projectedRoads);
        const occupiedTasks = new Set(this.listTasks(countryId).flatMap((task) => task.footprint).map(cellKey));
        const committed = district.lots.filter((lot) => lot.taskId);
        const preferred = [
          [entry.footprint.width, entry.footprint.height],
          [entry.footprint.width + 1, entry.footprint.height],
          [entry.footprint.width, entry.footprint.height + 1],
        ] as const;
        const lots = this.planLots(updatedCells, projectedRoads, projectedSurfaces, committed, preferred, Math.max(96, committed.length + 48), district.archetype);
        const updatedCellKeys = new Set(updatedCells.map(cellKey));
        if (!lots.some((lot) => !lot.taskId && this.placementInLot(countryId, lot, entry, projectedRoads, projectedSurfaces, occupiedTasks, updatedCellKeys))) continue;
        if (nearest) this.addRoadPath(countryId, seed, connector, "LOCAL");
        this.addRoadPath(countryId, seed, spine, "LOCAL");
        this.db.prepare("UPDATE districts_v3 SET cells_json = ?, lots_json = ?, growth_direction = ? WHERE id = ?")
          .run(JSON.stringify(updatedCells), JSON.stringify(lots), direction, district.id);
        const cityRow = this.db.prepare("SELECT * FROM cities_v3 WHERE id = ?").get(district.cityId) as Row;
        const city = cityDto(cityRow);
        const expandedCity = unionRect(city.bounds, expandRect(patchBounds, 8));
        if (JSON.stringify(expandedCity) !== JSON.stringify(city.bounds)) this.db.prepare("UPDATE cities_v3 SET bounds_json = ? WHERE id = ?").run(JSON.stringify(expandedCity), city.id);
        return { ...district, cells: updatedCells, lots, growthDirection: direction };
      }
    }
    throw new DomainError("PLACEMENT_BLOCKED", "Район не удалось расширить без пересечения воды или соседнего района");
  }

  createTask(countryId: string, input: {
    cityId: string;
    districtId?: string;
    title: string;
    description?: string;
    estimate: Estimate;
    priority?: TaskPriority;
    dueAt?: string;
    buildingHint?: string;
    creatorUserId?: string;
    assigneeUserId?: string;
    idempotencyKey: string;
  }): TaskDto {
    const title = input.title.trim();
    if (title.length < 2 || title.length > 160) throw new DomainError("INVALID_INPUT", "Название задачи должно содержать от 2 до 160 символов");
    return this.mutate(countryId, "task.create.v3", input.idempotencyKey, input, () => {
      const city = this.db.prepare("SELECT * FROM cities_v3 WHERE id = ? AND country_id = ?").get(input.cityId, countryId) as Row | undefined;
      if (!city) throw new DomainError("NOT_FOUND", "Город не найден");
      for (const [field, userId] of [["создатель", input.creatorUserId], ["ответственный", input.assigneeUserId]] as const) {
        if (userId && !this.db.prepare("SELECT 1 FROM country_members WHERE country_id = ? AND user_id = ?").get(countryId, userId)) {
          throw new DomainError("ASSIGNEE_NOT_MEMBER", `${field} должен состоять в палате страны`);
        }
      }
      const districtRow = input.districtId
        ? this.db.prepare("SELECT * FROM districts_v3 WHERE id = ? AND city_id = ?").get(input.districtId, input.cityId)
        : this.db.prepare("SELECT * FROM districts_v3 WHERE city_id = ? AND status = 'ACTIVE'").get(input.cityId);
      if (!districtRow) throw new DomainError("NO_ACTIVE_DISTRICT", "Сначала создайте или активируйте район");
      let district = districtDto(districtRow as Row);
      if (district.status === "COMPLETED") throw new DomainError("DISTRICT_SEALED", "В завершённый район нельзя добавлять задачи");
      const plannedSp = Number((this.db.prepare("SELECT COALESCE(SUM(estimate), 0) AS total FROM tasks_v3 WHERE district_id = ?").get(district.id) as Row).total);
      if (plannedSp + input.estimate > district.capacitySp) throw new DomainError("CAPACITY_EXCEEDED", `Район превышает вместимость ${district.capacitySp} SP`);
      const entry = this.selectBuilding(input.cityId, district.id, input.estimate, title, input.description ?? "", input.buildingHint);
      let roads = this.roadCells(countryId);
      let surfaces = this.surfaceCells(countryId, roads);
      const occupiedTasks = new Set(this.listTasks(countryId).flatMap((task) => task.footprint).map(cellKey));
      let districtCellKeys = new Set(district.cells.map(cellKey));
      let options = district.lots.map((lot) => ({ lot, placement: this.placementInLot(countryId, lot, entry, roads, surfaces, occupiedTasks, districtCellKeys) })).filter((option) => option.placement !== null);
      if (options.length === 0) {
        district = this.replanDistrictLots(countryId, district, entry);
        roads = this.roadCells(countryId);
        surfaces = this.surfaceCells(countryId, roads);
        districtCellKeys = new Set(district.cells.map(cellKey));
        options = district.lots.map((lot) => ({ lot, placement: this.placementInLot(countryId, lot, entry, roads, surfaces, occupiedTasks, districtCellKeys) })).filter((option) => option.placement !== null);
      }
      for (let expansion = 0; options.length === 0 && expansion < 4; expansion += 1) {
        district = this.expandDistrict(countryId, district, entry);
        roads = this.roadCells(countryId);
        surfaces = this.surfaceCells(countryId, roads);
        districtCellKeys = new Set(district.cells.map(cellKey));
        options = district.lots.map((lot) => ({ lot, placement: this.placementInLot(countryId, lot, entry, roads, surfaces, occupiedTasks, districtCellKeys) })).filter((option) => option.placement !== null);
      }
      const selected = options.sort((a, b) => {
        const wasteA = a.lot.width * a.lot.height - entry.footprint.width * entry.footprint.height;
        const wasteB = b.lot.width * b.lot.height - entry.footprint.width * entry.footprint.height;
        return wasteA - wasteB || a.lot.origin.y - b.lot.origin.y || a.lot.origin.x - b.lot.origin.x;
      })[0];
      if (!selected?.placement) throw new DomainError("PLACEMENT_BLOCKED", "После расширения не появился подходящий участок для здания");
      const id = randomUUID();
      const createdAt = now();
      const lots = district.lots.map((lot) => lot.id === selected.lot.id ? { ...lot, taskId: id } : lot);
      this.db.prepare("UPDATE districts_v3 SET lots_json = ? WHERE id = ?").run(JSON.stringify(lots), district.id);
      this.db.prepare(`INSERT INTO tasks_v3
        (id, city_id, district_id, title, description, estimate, priority, status, progress, due_at, building_type, platform_type, origin_x, origin_y, footprint_json, entrance_x, entrance_y, access_json, access_kind, creator_user_id, assignee_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.cityId, district.id, title, input.description?.trim().slice(0, 8000) ?? "", input.estimate,
        input.priority ?? "NORMAL", "PLANNING", 0, input.dueAt ?? null, entry.key, entry.platform,
        selected.placement.origin.x, selected.placement.origin.y, JSON.stringify(selected.placement.footprint),
        selected.placement.entrance.x, selected.placement.entrance.y, JSON.stringify(selected.placement.accessPath), selected.placement.accessKind,
        input.creatorUserId ?? null, input.assigneeUserId ?? null, createdAt, createdAt,
      );
      const creator = input.creatorUserId
        ? this.db.prepare("SELECT name FROM users WHERE id = ?").get(input.creatorUserId) as { name: string } | undefined
        : undefined;
      this.recordTaskEvent(id, "CREATED", creator?.name ?? "Система страны", input.creatorUserId, {
        status: "PLANNING", estimate: input.estimate, assigneeUserId: input.assigneeUserId ?? null,
      }, createdAt);
      this.surfaceCache.delete(countryId);
      const data = this.getTask(countryId, id);
      return { data, eventType: "task.created", eventPayload: { taskId: id, districtId: district.id, buildingType: entry.key, affectedBounds: boundsOf(data.footprint) } };
    });
  }

  updateTaskStatus(countryId: string, input: { taskId: string; status: TaskStatus; progress?: number; comment?: string; actor?: string; actorUserId?: string; idempotencyKey: string }): TaskDto {
    return this.mutate(countryId, "task.status.v3", input.idempotencyKey, input, () => {
      const task = this.getTask(countryId, input.taskId);
      const district = this.db.prepare("SELECT status FROM districts_v3 WHERE id = ?").get(task.districtId) as Row | undefined;
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
      const range = STATUS_PROGRESS_RANGE[input.status];
      const defaults: Record<TaskStatus, number> = { PLANNING: 0, STARTED: 0, IN_PROGRESS: 50, TESTING: 90, COMPLETED: 100 };
      const progress = input.progress == null ? defaults[input.status] : Math.max(range[0], Math.min(range[1], Math.round(input.progress)));
      const updatedAt = now();
      this.db.prepare("UPDATE tasks_v3 SET status = ?, progress = ?, updated_at = ? WHERE id = ?").run(input.status, progress, updatedAt, input.taskId);
      if (input.comment?.trim()) this.db.prepare("INSERT INTO task_comments_v3 (id, task_id, body, actor, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), input.taskId, input.comment.trim().slice(0, 8000), input.actor ?? "MCP client", updatedAt);
      this.recordTaskEvent(input.taskId, "STATUS_CHANGED", input.actor ?? "MCP", input.actorUserId, {
        from: task.status, to: input.status, progress, comment: input.comment?.trim() || null,
      }, updatedAt);
      const data = this.getTask(countryId, input.taskId);
      return { data, eventType: "task.status_changed", eventPayload: { taskId: input.taskId, status: input.status, progress } };
    });
  }

  addTaskComment(countryId: string, input: { taskId: string; body: string; actor?: string; actorUserId?: string; idempotencyKey: string }): TaskDto {
    return this.mutate(countryId, "task.comment.v3", input.idempotencyKey, input, () => {
      this.getTask(countryId, input.taskId);
      this.db.prepare("INSERT INTO task_comments_v3 (id, task_id, body, actor, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), input.taskId, input.body.trim().slice(0, 8000), input.actor ?? "MCP client", now());
      this.recordTaskEvent(input.taskId, "COMMENT_ADDED", input.actor ?? "MCP", input.actorUserId, { body: input.body.trim().slice(0, 8000) });
      const data = this.getTask(countryId, input.taskId);
      return { data, eventType: "task.comment_added", eventPayload: { taskId: input.taskId } };
    });
  }

  assignTask(countryId: string, input: { taskId: string; assigneeUserId: string | null; actor?: string; actorUserId?: string; idempotencyKey: string }): TaskDto {
    return this.mutate(countryId, "task.assign.v7", input.idempotencyKey, input, () => {
      const task = this.getTask(countryId, input.taskId);
      if (input.assigneeUserId && !this.db.prepare("SELECT 1 FROM country_members WHERE country_id = ? AND user_id = ?").get(countryId, input.assigneeUserId)) {
        throw new DomainError("ASSIGNEE_NOT_MEMBER", "Ответственный должен состоять в палате страны");
      }
      const previous = task.assignee?.id ?? null;
      const updatedAt = now();
      this.db.prepare("UPDATE tasks_v3 SET assignee_user_id = ?, updated_at = ? WHERE id = ?")
        .run(input.assigneeUserId, updatedAt, input.taskId);
      this.recordTaskEvent(input.taskId, "ASSIGNEE_CHANGED", input.actor ?? "MCP", input.actorUserId, {
        fromUserId: previous, toUserId: input.assigneeUserId,
      }, updatedAt);
      const data = this.getTask(countryId, input.taskId);
      return { data, eventType: "task.assignee_changed", eventPayload: { taskId: input.taskId, assigneeUserId: input.assigneeUserId } };
    });
  }

  private decorations(seed: number, terrain: ChunkDto["terrain"], blocked: Set<string>): DecorationDto[] {
    const result: DecorationDto[] = [];
    const occupied = new Set(blocked);
    for (const cell of terrain) {
      if (occupied.has(cellKey(cell))) continue;
      const chance = hashCoordinate(seed, cell.x, cell.y, 701);
      let kind: string | undefined;
      if (cell.terrain === "FOREST" && chance < 0.17) {
        if (chance < 0.055) kind = "tree-conifer";
        else if (chance < 0.125) kind = "tree-round";
        else kind = "tree-flowering";
      } else if (cell.terrain === "HILL" && chance < 0.085) {
        kind = chance < 0.035 ? "hill-rocky" : chance < 0.06 ? "hill-small" : "tree-conifer";
      } else if (cell.terrain === "MOUNTAIN" && chance < 0.075) {
        kind = chance < 0.03 ? "mountain-peak" : chance < 0.052 ? "mountain-ridge" : "rock-cluster";
      }
      else if ((cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < 0.012) {
        const variants = ["flower-white", "flower-yellow", "flower-red", "flower-purple", "bush-light", "rock-small"];
        kind = variants[Math.floor(hashCoordinate(seed, cell.x, cell.y, 709) * variants.length)];
      } else if (cell.terrain === "STONE" && chance < 0.035) kind = chance < 0.017 ? "rock-small" : "rock-cluster";
      else if (cell.terrain === "SHALLOW_WATER" && chance < 0.02) kind = chance < 0.01 ? "reed-green" : "reed-cattail";
      if (kind) {
        const landform = kind.startsWith("hill-") || kind.startsWith("mountain-");
        const clearance = landform ? 2 : 0;
        let available = true;
        for (let dy = -clearance; dy <= clearance && available; dy += 1) {
          for (let dx = -clearance; dx <= clearance; dx += 1) {
            if (occupied.has(cellKey({ x: cell.x + dx, y: cell.y + dy }))) { available = false; break; }
            if (landform && (dx !== 0 || dy !== 0) && hashCoordinate(seed, cell.x + dx, cell.y + dy, 701) < chance) { available = false; break; }
          }
        }
        if (!available) continue;
        result.push({ id: `${kind}:${cell.x}:${cell.y}`, kind, origin: { x: cell.x, y: cell.y } });
        for (let dy = -clearance; dy <= clearance; dy += 1) {
          for (let dx = -clearance; dx <= clearance; dx += 1) occupied.add(cellKey({ x: cell.x + dx, y: cell.y + dy }));
        }
      }
    }
    return result;
  }

  getChunk(countryId: string, chunkX: number, chunkY: number): ChunkDto {
    const country = this.countryRow(countryId);
    const seed = Number(country.seed);
    const minX = chunkX * CHUNK_SIZE;
    const minY = chunkY * CHUNK_SIZE;
    const chunkBounds = { minX, minY, maxX: minX + CHUNK_SIZE - 1, maxY: minY + CHUNK_SIZE - 1 };
    const terrain: ChunkDto["terrain"] = [];
    for (let y = chunkBounds.minY; y <= chunkBounds.maxY; y += 1) {
      for (let x = chunkBounds.minX; x <= chunkBounds.maxX; x += 1) terrain.push({ x, y, ...terrainAt(seed, x, y) });
    }
    const roads = (this.db.prepare("SELECT x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?")
      .all(countryId, chunkBounds.minX, chunkBounds.maxX, chunkBounds.minY, chunkBounds.maxY) as Row[]).map((row) => ({
      x: Number(row.x), y: Number(row.y), mask: Number(row.mask), structure: String(row.structure) as RoadCellDto["structure"], roadClass: String(row.road_class) as RoadCellDto["roadClass"],
    }));
    const cities = this.listCities(countryId).filter((city) => intersects(city.bounds, chunkBounds));
    const districts = this.listDistricts(countryId).filter((district) => district.cells.some((cell) => contains(chunkBounds, cell)));
    const tasks = this.listTasks(countryId).filter((task) => task.footprint.some((cell) => contains(chunkBounds, cell)));
    const worldFeatures = this.listWorldFeatures(countryId).filter((feature) => feature.footprint.some((cell) => contains(chunkBounds, cell)) || feature.accessPath.some((cell) => contains(chunkBounds, cell)));
    const surfaces = [...this.surfaceCells(countryId).values()].filter((surface) => contains(chunkBounds, surface));
    const blocked = new Set<string>([
      ...roads.map(cellKey),
      ...surfaces.map(cellKey),
      ...tasks.flatMap((task) => task.footprint).map(cellKey),
      ...worldFeatures.flatMap((feature) => feature.footprint).map(cellKey),
    ]);
    return {
      chunkX, chunkY, size: CHUNK_SIZE, terrain, roads, surfaces, cities, districts, tasks, worldFeatures,
      decorations: this.decorations(seed, terrain, blocked),
      worldVersion: Number(country.world_version),
    };
  }

  chunkForCell(cell: Cell): { chunkX: number; chunkY: number } {
    return { chunkX: floorDiv(cell.x, CHUNK_SIZE), chunkY: floorDiv(cell.y, CHUNK_SIZE) };
  }

  listEvents(countryId: string, afterId = 0): RealtimeEvent[] {
    return (this.db.prepare("SELECT * FROM events WHERE country_id = ? AND id > ? ORDER BY id LIMIT 500").all(countryId, afterId) as Row[]).map((row) => ({
      id: Number(row.id), countryId, type: String(row.type), worldVersion: Number(row.world_version), payload: json<Record<string, unknown>>(row.payload_json), createdAt: String(row.created_at),
    }));
  }
}
