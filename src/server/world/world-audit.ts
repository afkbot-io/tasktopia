import { BUILDING_CATALOG } from "../../shared/catalog";
import { greenAreaPathCells } from "../../shared/green-area";
import type { Cell, CityDto, RoadCellDto, SurfaceCellDto, TaskDto } from "../../shared/contracts";
import { CHUNK_SIZE, type AppService } from "../app-service";
import type { Db } from "../db";
import { GRID_DIRECTIONS, cellKey, connected, contains, floorDiv, intersects, manhattan, neighbors4 } from "./grid";
import { isWater, terrainAt } from "../../shared/world-terrain";
import {
  buildingZoningRole,
  primaryZoningRole,
  taskBuildingCompatibleWithArchetype,
} from "./city-generation";

type RoadRow = RoadCellDto;

export type WorldAuditViolation = {
  code: string;
  message: string;
};

export type WorldAuditMetrics = {
  cities: number;
  districts: number;
  tasks: number;
  roads: number;
  bridges: number;
  roadClasses: Record<RoadCellDto["roadClass"], number>;
  taskStages: Record<string, number>;
  uniqueBuildingTypes: number;
  uniqueBuildingTypesPerCity: Record<string, number>;
  tasksPerCity: Record<string, number>;
  districtsPerCity: Record<string, number>;
  tasksPerDistrict: Record<string, number>;
  districtCellRange: { min: number; max: number };
  maximumTaskRoadDistance: number;
  maximumEntranceAccessLength: number;
  surfaceCells: number;
  worldFeatures: number;
  greenAreas: number;
  parkDecor: number;
  greenAreasPerCity: Record<string, number>;
  serviceRolesPerCity: Record<string, string[]>;
  districtArchetypes: Record<string, number>;
  zoningCompliance: number;
  zoningPrimarySharePerDistrict: Record<string, number>;
  asphaltSharePerDistrict: Record<string, number>;
  maximumResidentialAsphaltShare: number;
  crosswalkCells: number;
  roadJunctionsPerCity: Record<string, number>;
};

export type WorldAuditResult = {
  metrics: WorldAuditMetrics;
  violations: WorldAuditViolation[];
};

function addViolation(violations: WorldAuditViolation[], code: string, message: string): void {
  violations.push({ code, message });
}

function distanceToRoad(footprint: TaskDto["footprint"], roads: Set<string>, limit = 2): number {
  for (let distance = 0; distance <= limit; distance += 1) {
    for (const cell of footprint) {
      for (let dx = -distance; dx <= distance; dx += 1) {
        const dy = distance - Math.abs(dx);
        if (roads.has(cellKey({ x: cell.x + dx, y: cell.y + dy }))) return distance;
        if (dy !== 0 && roads.has(cellKey({ x: cell.x + dx, y: cell.y - dy }))) return distance;
      }
    }
  }
  return limit + 1;
}

function countRoadJunctions(city: CityDto, roadMap: Map<string, RoadRow>): number {
  // Roads are three cells wide, so counting every degree-3/4 cell turns an
  // ordinary straight avenue into hundreds of false "junctions". Instead,
  // locate compact zones where perpendicular traffic and at least two road
  // classes meet, then collapse every contiguous zone to one junction.
  const candidates = new Set<string>();
  for (const road of roadMap.values()) {
    if (!contains(city.bounds, road)) continue;
    const neighbors = GRID_DIRECTIONS
      .map((direction) => ({ direction, road: roadMap.get(cellKey({ x: road.x + direction.x, y: road.y + direction.y })) }))
      .filter((entry): entry is { direction: (typeof GRID_DIRECTIONS)[number]; road: RoadRow } => Boolean(entry.road));
    const hasHorizontal = neighbors.some(({ direction }) => direction.x !== 0);
    const hasVertical = neighbors.some(({ direction }) => direction.y !== 0);
    const classes = new Set([road.roadClass, ...neighbors.map((entry) => entry.road.roadClass)]);
    if (hasHorizontal && hasVertical && classes.size >= 2) candidates.add(cellKey(road));
  }

  let components = 0;
  while (candidates.size > 0) {
    components += 1;
    const start = candidates.values().next().value as string;
    candidates.delete(start);
    const queue = [start];
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = queue[index]!.split(",").map(Number);
      for (const direction of GRID_DIRECTIONS) {
        const key = cellKey({ x: x! + direction.x, y: y! + direction.y });
        if (!candidates.delete(key)) continue;
        queue.push(key);
      }
    }
  }
  return components;
}

export async function auditWorld(db: Db, service: AppService, countryId: string): Promise<WorldAuditResult> {
  const violations: WorldAuditViolation[] = [];
  const cities = await service.listCities(countryId);
  const districts = await service.listDistricts(countryId);
  const tasks = await service.listTasks(countryId);
  const seed = Number((await db.prepare("SELECT seed FROM countries WHERE id = ?").get<{ seed: number }>(countryId))?.seed);
  const roadRows = await db.prepare("SELECT x, y, mask, structure, road_class FROM roads_v3 WHERE country_id = ?").all(countryId);
  const roads: RoadRow[] = roadRows.map((row) => ({
    x: Number(row.x), y: Number(row.y), mask: Number(row.mask),
    structure: String(row.structure) as RoadRow["structure"], roadClass: String(row.road_class) as RoadRow["roadClass"],
  }));
  const roadMap = new Map(roads.map((road) => [cellKey(road), road]));
  const roadKeys = new Set(roadMap.keys());
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const districtById = new Map(districts.map((district) => [district.id, district]));
  const districtCells = new Map(districts.map((district) => [district.id, new Set(district.cells.map(cellKey))]));
  const worldFeatures = await service.listWorldFeatures(countryId);
  const relevantChunks = new Set<string>();
  for (const task of tasks) for (const cell of [task.entrance, ...task.accessPath]) relevantChunks.add(`${floorDiv(cell.x, CHUNK_SIZE)},${floorDiv(cell.y, CHUNK_SIZE)}`);
  for (const feature of worldFeatures) for (const cell of [...feature.footprint, ...feature.accessPath]) relevantChunks.add(`${floorDiv(cell.x, CHUNK_SIZE)},${floorDiv(cell.y, CHUNK_SIZE)}`);
  const surfaceMap = new Map<string, SurfaceCellDto>();
  for (const chunk of relevantChunks) {
    const [chunkX, chunkY] = chunk.split(",").map(Number);
    for (const surface of (await service.getChunk(countryId, chunkX!, chunkY!)).surfaces) surfaceMap.set(cellKey(surface), surface);
  }
  const surfaceKeys = new Set(surfaceMap.keys());

  // A country without any road yet is empty land, not a disconnected network.
  if (roads.length > 0 && !connected(roads)) addViolation(violations, "ROAD_NETWORK_DISCONNECTED", "Глобальная дорожная сеть состоит из нескольких компонентов");

  const occupiedDistrictCells = new Map<string, string>();
  for (const district of districts) {
    // An abandoned district owns no land: its ruins are validated as features.
    if (district.status === "ABANDONED") continue;
    const city = cityById.get(district.cityId);
    if (!city) {
      addViolation(violations, "DISTRICT_CITY_MISSING", `Район ${district.name} не имеет города`);
      continue;
    }
    if (!connected(district.cells)) addViolation(violations, "DISTRICT_DISCONNECTED", `Район ${district.name} не четырёхсвязен`);
    for (const cell of district.cells) {
      const key = cellKey(cell);
      if (!contains(city.bounds, cell)) addViolation(violations, "DISTRICT_OUTSIDE_CITY", `${district.name}: клетка ${key} вне city bounds`);
      const owner = occupiedDistrictCells.get(key);
      if (owner && owner !== district.id) addViolation(violations, "DISTRICT_OVERLAP", `${district.name}: клетка ${key} уже занята другим районом`);
      occupiedDistrictCells.set(key, district.id);
    }
    const districtTasks = tasks.filter((task) => task.districtId === district.id);
    // Territory-only districts legitimately have no street until the first
    // complex grows. A road is required only once something is built.
    const hasDevelopment = districtTasks.length > 0 || district.lots.some((lot) => lot.taskId);
    if (hasDevelopment && !district.cells.some((cell) => distanceToRoad([cell], roadKeys, 2) <= 2)) {
      addViolation(violations, "DISTRICT_WITHOUT_ROAD", `Район ${district.name} не подключён к дороге`);
    }
    if (district.status === "PLANNED" && districtTasks.some((task) => task.status !== "PLANNING")) {
      addViolation(violations, "PLANNED_DISTRICT_HAS_STARTED_TASKS", `${district.name}: в плановом районе есть начатые задачи`);
    }
    if (district.status === "COMPLETED" && districtTasks.some((task) => task.status !== "COMPLETED")) {
      addViolation(violations, "COMPLETED_DISTRICT_HAS_OPEN_TASKS", `${district.name}: закрыт раньше завершения всех задач`);
    }
  }

  for (let left = 0; left < cities.length; left += 1) {
    for (let right = left + 1; right < cities.length; right += 1) {
      if (intersects(cities[left]!.bounds, cities[right]!.bounds)) {
        addViolation(violations, "CITY_OVERLAP", `${cities[left]!.name} пересекается с ${cities[right]!.name}`);
      }
    }
  }

  const occupiedTaskCells = new Map<string, string>();
  let maximumTaskRoadDistance = 0;
  let maximumEntranceAccessLength = 0;
  for (const task of tasks) {
    const district = districtById.get(task.districtId);
    const city = cityById.get(task.cityId);
    if (!district || !city) {
      addViolation(violations, "TASK_PARENT_MISSING", `${task.title}: отсутствует город или район`);
      continue;
    }
    const building = BUILDING_CATALOG.find((entry) => entry.key === task.buildingType);
    if (!building) {
      addViolation(violations, "TASK_BUILDING_UNKNOWN", `${task.title}: неизвестный тип ${task.buildingType}`);
    } else if (!taskBuildingCompatibleWithArchetype(building, district.archetype)) {
      addViolation(violations, "ZONING_INCOMPATIBLE", `${task.title}: ${building.label} несовместим с районом ${district.archetype}`);
    }
    const allowed = districtCells.get(district.id)!;
    for (const cell of task.footprint) {
      const key = cellKey(cell);
      if (!allowed.has(key)) addViolation(violations, "TASK_OUTSIDE_DISTRICT", `${task.title}: клетка ${key} вне района`);
      if (!contains(city.bounds, cell)) addViolation(violations, "TASK_OUTSIDE_CITY", `${task.title}: клетка ${key} вне города`);
      const owner = occupiedTaskCells.get(key);
      if (owner && owner !== task.id) addViolation(violations, "TASK_OVERLAP", `${task.title}: клетка ${key} занята другой задачей`);
      occupiedTaskCells.set(key, task.id);
      if (roadKeys.has(key)) addViolation(violations, "TASK_ROAD_OVERLAP", `${task.title}: дорога проходит через ${key}`);
    }
    const roadDistance = distanceToRoad(task.footprint, roadKeys, 8);
    maximumTaskRoadDistance = Math.max(maximumTaskRoadDistance, roadDistance);
    maximumEntranceAccessLength = Math.max(maximumEntranceAccessLength, task.accessPath.length);
    if (task.accessPath.length > 6) addViolation(violations, "TASK_ACCESS_TOO_LONG", `${task.title}: подход длиннее шести клеток`);
    const accessCells = task.accessPath.length > 0 ? task.accessPath : [task.entrance];
    if (task.accessPath.length > 0 && cellKey(task.accessPath[0]!) !== cellKey(task.entrance)) {
      addViolation(violations, "TASK_ACCESS_MISALIGNED", `${task.title}: путь не начинается у входа`);
    }
    for (let index = 1; index < accessCells.length; index += 1) {
      const previous = accessCells[index - 1]!;
      const current = accessCells[index]!;
      if (Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y) !== 1) addViolation(violations, "TASK_ACCESS_DISCONNECTED", `${task.title}: разрыв подхода`);
    }
    for (const cell of accessCells) {
      if (task.footprint.some((occupied) => cellKey(occupied) === cellKey(cell))) addViolation(violations, "TASK_ACCESS_CROSSES_BUILDING", `${task.title}: подход проходит через здание`);
      if (roadKeys.has(cellKey(cell))) addViolation(violations, "TASK_ACCESS_CROSSES_ROAD", `${task.title}: подход проходит по проезжей части`);
      if (isWater(terrainAt(seed, cell.x, cell.y).terrain)) {
        addViolation(violations, "TASK_ACCESS_CROSSES_WATER", `${task.title}: подход проходит по воде`);
      }
    }
    const terminal = accessCells.at(-1)!;
    const touchesSidewalk = surfaceKeys.has(cellKey(terminal)) || neighbors4(terminal).some((cell) => surfaceKeys.has(cellKey(cell)));
    if (!touchesSidewalk) addViolation(violations, "TASK_ENTRANCE_UNREACHABLE", `${task.title}: вход не соединён с тротуаром`);
  }

  const greenAreas = worldFeatures.filter((feature) => feature.kind === "PARK" || feature.kind === "GROVE");
  const parkDecor = worldFeatures.filter((feature) => feature.kind === "PARK_DECOR");
  for (const area of greenAreas) {
    const city = area.cityId ? cityById.get(area.cityId) : undefined;
    if (!city) {
      addViolation(violations, "GREEN_AREA_CITY_MISSING", `${area.assetKey}: отсутствует город`);
      continue;
    }
    const owningDistricts = districts.filter((district) => district.cityId === city.id
      && area.footprint.every((cell) => districtCells.get(district.id)?.has(cellKey(cell))));
    if (owningDistricts.length !== 1) addViolation(violations, "GREEN_AREA_OUTSIDE_DISTRICT", `${area.assetKey}: площадь не принадлежит одному району`);
    // Stage one is a prepared earth plot: the authored path geometry exists in
    // the area contract, but is deliberately neither visible nor walkable yet.
    // From stage two onward audit the same shared cells used by the renderer
    // and surface publisher.
    const expectedPathCells = new Set((area.developmentStage >= 2 ? greenAreaPathCells(area.footprint, area.assetKey) : []).map(cellKey));
    for (const cell of area.footprint) {
      const key = cellKey(cell);
      if (!contains(city.bounds, cell)) addViolation(violations, "GREEN_AREA_OUTSIDE_CITY", `${area.assetKey}: клетка ${key} вне города`);
      if (roadKeys.has(key)) addViolation(violations, "GREEN_AREA_ROAD_OVERLAP", `${area.assetKey}: дорога проходит через ${key}`);
      if (occupiedTaskCells.has(key)) addViolation(violations, "GREEN_AREA_TASK_OVERLAP", `${area.assetKey}: задача занимает ${key}`);
      if (isWater(terrainAt(seed, cell.x, cell.y).terrain)) addViolation(violations, "GREEN_AREA_ON_WATER", `${area.assetKey}: клетка ${key} находится в воде`);
      if (expectedPathCells.has(key) && surfaceMap.get(key)?.kind !== "PATH") {
        addViolation(violations, "GREEN_AREA_SURFACE_MISSING", `${area.assetKey}: дорожка ${key} не размечена как парковая поверхность`);
      }
      if (!expectedPathCells.has(key) && surfaceMap.get(key)?.kind === "PATH") {
        addViolation(violations, "GREEN_AREA_SURFACE_SPILL", `${area.assetKey}: лужайка ${key} ошибочно размечена как дорожка`);
      }
    }
    const accessCells = area.accessPath;
    if (accessCells.length > 8) addViolation(violations, "GREEN_AREA_ACCESS_TOO_LONG", `${area.assetKey}: подход длиннее восьми клеток`);
    for (let index = 1; index < accessCells.length; index += 1) {
      if (manhattan(accessCells[index - 1]!, accessCells[index]!) !== 1) addViolation(violations, "GREEN_AREA_ACCESS_DISCONNECTED", `${area.assetKey}: разрыв пешеходного подхода`);
    }
    for (const cell of accessCells) {
      const key = cellKey(cell);
      if (roadKeys.has(key)) addViolation(violations, "GREEN_AREA_ACCESS_CROSSES_ROAD", `${area.assetKey}: подход проходит по дороге`);
      if (occupiedTaskCells.has(key)) addViolation(violations, "GREEN_AREA_ACCESS_CROSSES_TASK", `${area.assetKey}: подход проходит через задачу`);
      if (isWater(terrainAt(seed, cell.x, cell.y).terrain)) addViolation(violations, "GREEN_AREA_ACCESS_CROSSES_WATER", `${area.assetKey}: подход проходит по воде`);
    }
    const sidewalkTouchPoints = accessCells.length > 0 ? [accessCells.at(-1)!] : greenAreaPathCells(area.footprint, area.assetKey);
    const pedestrianQueue = [...sidewalkTouchPoints];
    const pedestrianVisited = new Set<string>();
    let reachesSidewalk = false;
    while (pedestrianQueue.length > 0 && pedestrianVisited.size < 256) {
      const current = pedestrianQueue.shift()!;
      const currentKey = cellKey(current);
      if (pedestrianVisited.has(currentKey)) continue;
      pedestrianVisited.add(currentKey);
      if (surfaceMap.get(currentKey)?.kind === "SIDEWALK") {
        reachesSidewalk = true;
        break;
      }
      for (const neighbor of neighbors4(current)) {
        const kind = surfaceMap.get(cellKey(neighbor))?.kind;
        if (kind === "SIDEWALK") {
          reachesSidewalk = true;
          pedestrianQueue.length = 0;
          break;
        }
        if ((kind === "PATH" || kind === "DRIVEWAY") && !pedestrianVisited.has(cellKey(neighbor))) pedestrianQueue.push(neighbor);
      }
    }
    if (!reachesSidewalk) addViolation(violations, "GREEN_AREA_UNREACHABLE", `${area.assetKey}: нет выхода к тротуару`);
  }

  for (const decor of parkDecor) {
    const insideParent = greenAreas.some((area) => area.cityId === decor.cityId
      && decor.footprint.every((cell) => area.footprint.some((areaCell) => cellKey(areaCell) === cellKey(cell))));
    if (!insideParent) addViolation(violations, "PARK_DECOR_OUTSIDE_AREA", `${decor.assetKey}: декор находится вне парка или рощи`);
    for (const cell of decor.footprint) {
      const key = cellKey(cell);
      if (roadKeys.has(key)) addViolation(violations, "PARK_DECOR_ROAD_OVERLAP", `${decor.assetKey}: декор находится на дороге`);
      if (occupiedTaskCells.has(key)) addViolation(violations, "PARK_DECOR_TASK_OVERLAP", `${decor.assetKey}: декор пересекает задачу`);
    }
  }

  // Every pedestrian path component must be anchored: it touches a road, a
  // sidewalk, a building or a feature footprint. A floating component is a
  // dead spur leading nowhere — the V10 "дорожки обрываются" regression.
  const featureFootprintKeys = new Set(
    worldFeatures.filter((feature) => feature.kind !== "RUIN").flatMap((feature) => feature.footprint).map(cellKey),
  );
  const pathOnlyCells = [...surfaceMap.values()].filter((surface) => surface.kind === "PATH");
  const pathOnlyKeys = new Set(pathOnlyCells.map(cellKey));
  const pathAnchored = (cell: Cell) => neighbors4(cell).some((neighbor) => {
    const key = cellKey(neighbor);
    return roadKeys.has(key)
      || surfaceMap.get(key)?.kind === "SIDEWALK"
      || occupiedTaskCells.has(key)
      || featureFootprintKeys.has(key);
  });
  const unvisitedPaths = new Set(pathOnlyKeys);
  while (unvisitedPaths.size > 0) {
    const start = unvisitedPaths.values().next().value as string;
    unvisitedPaths.delete(start);
    const [startX, startY] = start.split(",").map(Number);
    const component: Cell[] = [];
    const queue: Cell[] = [{ x: startX!, y: startY! }];
    let anchored = false;
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      if (pathAnchored(current)) anchored = true;
      for (const neighbor of neighbors4(current)) {
        const key = cellKey(neighbor);
        if (unvisitedPaths.delete(key)) queue.push(neighbor);
      }
    }
    if (!anchored) {
      addViolation(violations, "ORPHAN_PATH", `Пешеходная сеть из ${component.length} клеток у ${start} не соединена ни с дорогой, ни со зданием`);
    }
  }

  for (const road of roads) {
    for (const direction of GRID_DIRECTIONS) {
      const neighbor = roadMap.get(cellKey({ x: road.x + direction.x, y: road.y + direction.y }));
      const connectedByMask = Boolean(road.mask & direction.bit);
      if (connectedByMask && (!neighbor || !(neighbor.mask & direction.opposite))) {
        addViolation(violations, "ROAD_MASK_NOT_RECIPROCAL", `Дорожная маска не взаимна в ${road.x},${road.y}`);
      }
      if (neighbor && !connectedByMask) addViolation(violations, "ROAD_MASK_MISSING", `Нет маски к соседней дороге из ${road.x},${road.y}`);
    }
    if (road.structure === "BRIDGE" && !isWater(terrainAt(seed, road.x, road.y).terrain)) {
      addViolation(violations, "BRIDGE_ON_LAND", `Мост ${road.x},${road.y} находится не на воде`);
    }
    if (road.roadClass === "HIGHWAY") {
      for (const city of cities) {
        const originalBounds = {
          minX: city.center.x - 50,
          minY: city.center.y - 50,
          maxX: city.center.x + 49,
          maxY: city.center.y + 49,
        };
        if (!contains(originalBounds, road)) continue;
        const edgeDistance = Math.min(
          road.x - originalBounds.minX,
          originalBounds.maxX - road.x,
          road.y - originalBounds.minY,
          originalBounds.maxY - road.y,
        );
        if (edgeDistance > 8) addViolation(violations, "HIGHWAY_CUTS_CITY", `${city.name}: трасса проходит глубоко через город в ${road.x},${road.y}`);
      }
    }
  }

  const unvisitedBridges = new Set(roads.filter((road) => road.structure === "BRIDGE").map(cellKey));
  while (unvisitedBridges.size > 0) {
    const start = unvisitedBridges.values().next().value as string;
    unvisitedBridges.delete(start);
    const queue = [roadMap.get(start)!];
    const landPortals = new Set<string>();
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      for (const neighborCell of neighbors4(current)) {
        const neighbor = roadMap.get(cellKey(neighborCell));
        if (!neighbor) continue;
        const neighborKey = cellKey(neighbor);
        if (neighbor.structure === "ROAD") landPortals.add(neighborKey);
        else if (unvisitedBridges.delete(neighborKey)) queue.push(neighbor);
      }
    }
    let portalComponents = 0;
    while (landPortals.size > 0) {
      portalComponents += 1;
      const portalStart = landPortals.values().next().value as string;
      landPortals.delete(portalStart);
      const portalQueue = [roadMap.get(portalStart)!];
      for (let index = 0; index < portalQueue.length; index += 1) {
        for (const neighbor of neighbors4(portalQueue[index]!)) {
          const neighborKey = cellKey(neighbor);
          if (!landPortals.delete(neighborKey)) continue;
          portalQueue.push(roadMap.get(neighborKey)!);
        }
      }
    }
    if (portalComponents < 2) {
      addViolation(violations, "BRIDGE_WITHOUT_LAND_PORTALS", `Мост ${start} не имеет двух опорных выходов на сушу`);
    }
  }

  const taskStages = Object.fromEntries([1, 2, 3, 4, 5].map((stage) => [String(stage), tasks.filter((task) => task.stage === stage).length]));
  const uniqueBuildingTypesPerCity = Object.fromEntries(cities.map((city) => [city.name, new Set(tasks.filter((task) => task.cityId === city.id).map((task) => task.buildingType)).size]));
  const tasksPerCity = Object.fromEntries(cities.map((city) => [city.name, tasks.filter((task) => task.cityId === city.id).length]));
  const districtsPerCity = Object.fromEntries(cities.map((city) => [city.name, districts.filter((district) => district.cityId === city.id).length]));
  const tasksPerDistrict = Object.fromEntries(districts.map((district) => [district.name, tasks.filter((task) => task.districtId === district.id).length]));
  const districtSizes = districts.map((district) => district.cells.length);
  const serviceRolesPerCity = Object.fromEntries(cities.map((city) => {
    const roles = new Set(tasks.filter((task) => task.cityId === city.id).map((task) => BUILDING_CATALOG.find((entry) => entry.key === task.buildingType)?.serviceRole).filter((role): role is string => Boolean(role)));
    if (tasks.filter((task) => task.cityId === city.id).length >= 30) {
      for (const required of ["police-service", "fire-service", "health-service"]) {
        if (!roles.has(required)) addViolation(violations, "CITY_SERVICE_COVERAGE_MISSING", `${city.name}: отсутствует ${required}`);
      }
    }
    return [city.name, [...roles].sort()];
  }));
  const districtArchetypes = Object.fromEntries(["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"].map((archetype) => [archetype, districts.filter((district) => district.archetype === archetype).length]));
  const zoningPrimaryShareByDistrictId = new Map(districts.map((district) => {
    const districtTasks = tasks.filter((task) => task.districtId === district.id);
    const primary = districtTasks.filter((task) => {
      const entry = BUILDING_CATALOG.find((building) => building.key === task.buildingType);
      return entry ? primaryZoningRole(district.archetype, buildingZoningRole(entry)) : false;
    }).length;
    return [district.id, districtTasks.length === 0 ? 1 : primary / districtTasks.length] as const;
  }));
  const zoningPrimarySharePerDistrict = Object.fromEntries(districts.map((district) => [
    district.name,
    zoningPrimaryShareByDistrictId.get(district.id)!,
  ]));
  // Measure the visible impervious/asphalt surface, not only road rows. Parking
  // platforms, service-building pads and driveways used to be omitted, which
  // could make a district pass while still looking paved over in the renderer.
  const asphaltKeys = new Set(roadKeys);
  for (const task of tasks) {
    if (task.platformType === "ASPHALT") for (const cell of task.footprint) asphaltKeys.add(cellKey(cell));
    if (task.accessKind === "DRIVEWAY") for (const cell of task.accessPath) asphaltKeys.add(cellKey(cell));
  }
  for (const feature of worldFeatures) {
    if (feature.assetKind === "BUILDING") for (const cell of feature.footprint) asphaltKeys.add(cellKey(cell));
  }
  for (const surface of surfaceMap.values()) if (surface.kind === "DRIVEWAY") asphaltKeys.add(cellKey(surface));
  const asphaltShareByDistrictId = new Map(districts.map((district) => {
    const asphalt = district.cells.filter((cell) => asphaltKeys.has(cellKey(cell))).length;
    return [district.id, district.cells.length === 0 ? 0 : asphalt / district.cells.length] as const;
  }));
  const asphaltSharePerDistrict = Object.fromEntries(districts.map((district) => [
    district.name,
    asphaltShareByDistrictId.get(district.id) ?? 0,
  ]));
  const residentialBlockDistricts = districts.filter((district) =>
    (district.archetype === "NEW_BUILD" || district.archetype === "PRIVATE")
    && district.lots.some((lot) => lot.layoutVersion === "block-v3"),
  );
  for (const district of residentialBlockDistricts) {
    const share = asphaltShareByDistrictId.get(district.id) ?? 0;
    if (share > 0.2 + Number.EPSILON) {
      addViolation(violations, "DISTRICT_ASPHALT_DENSITY_HIGH", `${district.name}: асфальт занимает ${Math.round(share * 100)}% района, предел 20%`);
    }
  }
  const minimumPrimaryShare: Partial<Record<(typeof districts)[number]["archetype"], number>> = {
    NEW_BUILD: 0.7,
    PRIVATE: 0.6,
  };
  for (const district of districts) {
    const minimumShare = minimumPrimaryShare[district.archetype];
    if (minimumShare === undefined) continue;
    const taskCount = tasks.filter((task) => task.districtId === district.id).length;
    const primaryShare = zoningPrimaryShareByDistrictId.get(district.id) ?? 0;
    // A first shop or clinic is a legitimate seed for an otherwise empty
    // district. Percentage zoning becomes meaningful once one full planning
    // batch (ten tasks) exists; hard family incompatibility is checked from the
    // very first task above.
    if (taskCount >= 10 && primaryShare + Number.EPSILON < minimumShare) {
      addViolation(
        violations,
        "ZONING_PRIMARY_SHARE_LOW",
        `${district.name}: профильная застройка занимает только ${Math.round(primaryShare * 100)}% района ${district.archetype}, требуется ${Math.round(minimumShare * 100)}%`,
      );
    }
  }
  const compatibleTasks = tasks.filter((task) => {
    const district = districtById.get(task.districtId);
    const building = BUILDING_CATALOG.find((entry) => entry.key === task.buildingType);
    return district && building && taskBuildingCompatibleWithArchetype(building, district.archetype);
  }).length;

  return {
    metrics: {
      cities: cities.length,
      districts: districts.length,
      tasks: tasks.length,
      roads: roads.length,
      bridges: roads.filter((road) => road.structure === "BRIDGE").length,
      roadClasses: {
        LOCAL: roads.filter((road) => road.roadClass === "LOCAL").length,
        COLLECTOR: roads.filter((road) => road.roadClass === "COLLECTOR").length,
        ARTERIAL: roads.filter((road) => road.roadClass === "ARTERIAL").length,
        HIGHWAY: roads.filter((road) => road.roadClass === "HIGHWAY").length,
      },
      taskStages,
      uniqueBuildingTypes: new Set(tasks.map((task) => task.buildingType)).size,
      uniqueBuildingTypesPerCity,
      tasksPerCity,
      districtsPerCity,
      tasksPerDistrict,
      districtCellRange: { min: Math.min(...districtSizes), max: Math.max(...districtSizes) },
      maximumTaskRoadDistance,
      maximumEntranceAccessLength,
      surfaceCells: surfaceKeys.size,
      worldFeatures: worldFeatures.length,
      greenAreas: greenAreas.length,
      parkDecor: parkDecor.length,
      greenAreasPerCity: Object.fromEntries(cities.map((city) => [city.name, greenAreas.filter((area) => area.cityId === city.id).length])),
      serviceRolesPerCity,
      districtArchetypes,
      zoningCompliance: tasks.length === 0 ? 1 : compatibleTasks / tasks.length,
      zoningPrimarySharePerDistrict,
      asphaltSharePerDistrict,
      maximumResidentialAsphaltShare: residentialBlockDistricts.length === 0
        ? 0
        : Math.max(...residentialBlockDistricts.map((district) => asphaltShareByDistrictId.get(district.id) ?? 0)),
      crosswalkCells: [...surfaceMap.values()].filter((surface) => surface.kind === "CROSSWALK").length,
      roadJunctionsPerCity: Object.fromEntries(cities.map((city) => [city.name, countRoadJunctions(city, roadMap)])),
    },
    violations,
  };
}
