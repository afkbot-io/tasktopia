import type { BuildingCatalogEntry, EntranceSide } from "../../shared/catalog";
import type {
  Cell,
  CityDto,
  CityMorphology,
  DistrictArchetype,
  DistrictDto,
  Rect,
  RoadCellDto,
  SurfaceCellDto,
  TaskDto,
  WorldFeatureDto,
} from "../../shared/contracts";
import { greenAreaPathCells } from "../../shared/green-area";
import { cellKey, contains, expandRect, neighbors4, rectangleFootprint } from "./grid";

export const ROAD_WIDTH: Record<RoadCellDto["roadClass"], number> = {
  // V2 always separates opposing streams. Local streets use two outer travel
  // cells and one central marking. Bus-capable roads use two-cell-wide median
  // clearance plus an outer shoulder, so honest 22px buses never need runtime
  // squeezing and can pass without touching the sidewalk or opposing traffic.
  LOCAL: 3,
  COLLECTOR: 7,
  ARTERIAL: 7,
  HIGHWAY: 7,
};

/** Keep annex site search near fresh land instead of rescanning the whole old district. */
export function districtAnnexSearchBounds(patchBounds: Rect): Rect {
  return expandRect(patchBounds, 24);
}

/**
 * Screen-space facades rise north from their south ground anchor. Reserve the
 * opaque height that is not already represented by the physical lot depth so
 * another frontage or street cannot be planned underneath the artwork.
 */
export function buildingVisualSetbackCells(entry: BuildingCatalogEntry): number {
  const finished = entry.stageOpaqueBounds[4]!;
  const opaqueHeight = Math.max(0, finished.bottom - finished.top);
  const projected = Math.max(0, Math.ceil((opaqueHeight - entry.footprint.height * 8) / 8));
  if (entry.category === "HIGHRISE" || entry.category === "CIVIC" || entry.spriteSize.height >= 200) return projected;
  return 0;
}

export function buildingLotDepthCells(entry: BuildingCatalogEntry): number {
  return entry.footprint.height + buildingVisualSetbackCells(entry);
}

/** A compact infill facade must be compact in screen space, not only on the ground. */
export function isCompactNewBuildBuilding(entry: BuildingCatalogEntry): boolean {
  return entry.footprint.width <= 14 && buildingLotDepthCells(entry) <= 12;
}

export function buildingVisualReservationCells(entry: BuildingCatalogEntry, origin: Cell): Cell[] {
  const northSetback = buildingVisualSetbackCells(entry);
  return rectangleFootprint(
    { x: origin.x, y: origin.y - northSetback },
    entry.footprint.width,
    entry.footprint.height + northSetback,
  );
}

export function findAreaAccessPath(input: {
  allowed: ReadonlySet<string>;
  footprint: Cell[];
  roads: ReadonlyMap<string, RoadCellDto>;
  surfaces: ReadonlyMap<string, SurfaceCellDto>;
  occupied: ReadonlySet<string>;
  isWalkableTerrain: (cell: Cell) => boolean;
  maxLength?: number;
}): Cell[] | null {
  const footprintKeys = new Set(input.footprint.map(cellKey));
  const starts = new Map<string, Cell>();
  for (const cell of input.footprint) {
    for (const next of neighbors4(cell)) {
      const nextKey = cellKey(next);
      if (!footprintKeys.has(nextKey) && input.allowed.has(nextKey)) starts.set(nextKey, next);
    }
  }
  const maxLength = input.maxLength ?? 8;
  // Include the sidewalk endpoint in the persisted path. Completed districts
  // suppress newly inferred sidewalks at their boundary, so omitting this
  // anchor can make a valid park unreachable after regeneration.
  for (const start of starts.values()) if (input.surfaces.get(cellKey(start))?.kind === "SIDEWALK") return [start];
  const queue = [...starts.values()].map((cell) => ({ cell, path: [cell] }));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const state = queue.shift()!;
    const stateKey = cellKey(state.cell);
    if (visited.has(stateKey) || state.path.length >= maxLength) continue;
    visited.add(stateKey);
    if (input.roads.has(stateKey) || input.occupied.has(stateKey) || footprintKeys.has(stateKey) || !input.isWalkableTerrain(state.cell)) continue;
    for (const next of neighbors4(state.cell)) {
      const nextKey = cellKey(next);
      if (input.surfaces.get(nextKey)?.kind === "SIDEWALK") return [...state.path, next];
      if (!input.allowed.has(nextKey) || input.surfaces.has(nextKey) || input.roads.has(nextKey)
        || footprintKeys.has(nextKey) || input.occupied.has(nextKey)) continue;
      queue.push({ cell: next, path: [...state.path, next] });
    }
  }
  return null;
}

const MORPHOLOGIES: CityMorphology[] = ["BALANCED", "DENSE_CORE", "GARDEN_CITY", "POLYCENTRIC"];
const ARCHETYPES: DistrictArchetype[] = ["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"];

export function cityMorphology(seedValue: number): CityMorphology {
  return MORPHOLOGIES[Math.abs(Math.floor(seedValue * 10_000)) % MORPHOLOGIES.length]!;
}

function explicitArchetype(value: string): DistrictArchetype | undefined {
  const text = value.toLocaleLowerCase("ru");
  if (/(полици|пожар|клиник|больниц|служб|граждан|администр|муницип)/.test(text)) return "CIVIC";
  if (/(новострой|высот|башн|многоэтаж|новый делов)/.test(text)) return "NEW_BUILD";
  if (/(частн|коттедж|сад|соснов|дач|усад|слобод|деревн|жил|\bдом)/.test(text)) return "PRIVATE";
  if (/(рын|торгов|бизнес|вокзал|порт|пром|мастерск)/.test(text)) return "COMMERCIAL";
  if (/(центр|университет|набереж|городск)/.test(text)) return "MIXED_URBAN";
  return undefined;
}

const MORPHOLOGY_ORDER: Record<CityMorphology, DistrictArchetype[]> = {
  BALANCED: ["PRIVATE", "NEW_BUILD", "COMMERCIAL", "CIVIC", "MIXED_URBAN"],
  DENSE_CORE: ["NEW_BUILD", "NEW_BUILD", "MIXED_URBAN", "CIVIC", "COMMERCIAL", "NEW_BUILD", "MIXED_URBAN", "PRIVATE"],
  GARDEN_CITY: ["PRIVATE", "PRIVATE", "COMMERCIAL", "CIVIC", "PRIVATE", "MIXED_URBAN", "PRIVATE", "NEW_BUILD"],
  POLYCENTRIC: ["MIXED_URBAN", "NEW_BUILD", "COMMERCIAL", "CIVIC", "MIXED_URBAN", "PRIVATE", "NEW_BUILD"],
};

export function chooseDistrictArchetype(input: {
  requested?: DistrictArchetype;
  name: string;
  goal: string;
  morphology: CityMorphology;
  existing: DistrictDto[];
  variation: number;
}): DistrictArchetype {
  if (input.requested && ARCHETYPES.includes(input.requested)) return input.requested;
  const semantic = explicitArchetype(`${input.name} ${input.goal}`);
  if (semantic) return semantic;
  const order = MORPHOLOGY_ORDER[input.morphology];
  const cycle = Math.floor(input.existing.length / order.length);
  const offset = cycle > 0 && input.variation > 0.66 ? 1 : 0;
  return order[(input.existing.length + offset) % order.length]!;
}

export type BuildingZoningRole =
  | "LOW_RISE_RESIDENTIAL"
  | "MID_RISE_RESIDENTIAL"
  | "HIGH_RISE_RESIDENTIAL"
  | "COMMERCIAL"
  | "CIVIC";

export function buildingZoningRole(entry: BuildingCatalogEntry): BuildingZoningRole {
  const tags = new Set(entry.tags);
  if (entry.category === "CIVIC") return "CIVIC";
  if (entry.category === "COMMERCIAL") return "COMMERCIAL";
  if (entry.category === "HIGHRISE" || tags.has("high-rise-residential")) return "HIGH_RISE_RESIDENTIAL";
  if (tags.has("mid-rise-residential") || tags.has("new-build") || tags.has("mixed-use")) return "MID_RISE_RESIDENTIAL";
  return "LOW_RISE_RESIDENTIAL";
}

/** Gas stations belong inside a road-bounded service court, not on a facade row. */
export function buildingLotPlacementScore(input: {
  entry: BuildingCatalogEntry;
  lot: { origin: Cell; width: number; height: number };
  origin: Cell;
  accessDistance: number;
  bottomGap: number;
  partyBonus: number;
}): number {
  const { entry, lot, origin, accessDistance, bottomGap, partyBonus } = input;
  if (entry.serviceRole === "fuel-service") {
    const lotCenterX = lot.origin.x + lot.width / 2;
    const lotCenterY = lot.origin.y + lot.height / 2;
    const buildingCenterX = origin.x + entry.footprint.width / 2;
    const buildingCenterY = origin.y + entry.footprint.height / 2;
    const centerOffset = Math.abs(buildingCenterX - lotCenterX) + Math.abs(buildingCenterY - lotCenterY);
    return accessDistance * 100 + centerOffset * 24;
  }
  const edgePenalty = (origin.x - lot.origin.x) * 2;
  return accessDistance * 100 + bottomGap * 30 + partyBonus + edgePenalty;
}

export function buildingCompatibleWithArchetype(entry: BuildingCatalogEntry, archetype: DistrictArchetype): boolean {
  const role = buildingZoningRole(entry);
  if (entry.serviceRole) return true;
  if (archetype === "PRIVATE") return role === "LOW_RISE_RESIDENTIAL" || role === "MID_RISE_RESIDENTIAL" || role === "COMMERCIAL" || role === "CIVIC";
  if (archetype === "NEW_BUILD") {
    const longSupport = role === "COMMERCIAL" && (entry.footprint.width >= 5 || entry.key === "commercial-parking-lot");
    return role === "MID_RISE_RESIDENTIAL" || role === "HIGH_RISE_RESIDENTIAL" || longSupport || role === "CIVIC";
  }
  if (archetype === "COMMERCIAL") return role === "COMMERCIAL" || role === "CIVIC" || entry.tags.includes("mixed-use");
  if (archetype === "CIVIC") return role === "CIVIC" || role === "COMMERCIAL";
  return true;
}

/** Task buildings obey the same zoning contract as the generated city. */
export function taskBuildingCompatibleWithArchetype(entry: BuildingCatalogEntry, archetype: DistrictArchetype): boolean {
  // Reviewed emergency services are city infrastructure, not residential
  // zoning. Their own catalog rules and placement platform decide the site;
  // every district archetype may host the scheduled 10/20/30-task service.
  if (entry.serviceRole) return buildingCompatibleWithArchetype(entry, archetype);
  if (archetype === "PRIVATE" || archetype === "NEW_BUILD") return buildingCompatibleWithArchetype(entry, archetype);
  // The current task catalog intentionally focuses on residential growth.
  // Dense task buildings remain the neutral fallback for older commercial or
  // civic district records until those task types get an explicit selector.
  return entry.tags.includes("new-build");
}

export function primaryZoningRole(archetype: DistrictArchetype, role: BuildingZoningRole): boolean {
  if (archetype === "PRIVATE") return role === "LOW_RISE_RESIDENTIAL" || role === "MID_RISE_RESIDENTIAL";
  if (archetype === "NEW_BUILD") return role === "MID_RISE_RESIDENTIAL" || role === "HIGH_RISE_RESIDENTIAL";
  if (archetype === "COMMERCIAL") return role === "COMMERCIAL";
  if (archetype === "CIVIC") return role === "CIVIC";
  return true;
}

export function archetypeAffinity(entry: BuildingCatalogEntry, archetype: DistrictArchetype): number {
  const tags = new Set(entry.tags);
  const role = buildingZoningRole(entry);
  const isLowRise = role === "LOW_RISE_RESIDENTIAL";
  const isMidRise = role === "MID_RISE_RESIDENTIAL";
  const isHighRise = role === "HIGH_RISE_RESIDENTIAL";
  const isMixed = tags.has("mixed-use");
  const isCommercial = entry.category === "COMMERCIAL" || tags.has("commercial");
  const isCivic = entry.category === "CIVIC" || tags.has("civic");
  if (archetype === "NEW_BUILD") return isHighRise ? 14 : isMidRise || isMixed ? 11 : isCommercial ? 5 : isCivic ? 2 : isLowRise ? -11 : 0;
  if (archetype === "PRIVATE") return isLowRise ? 14 : isMidRise ? 10 : isCommercial ? 4 : isCivic ? 2 : isHighRise ? -11 : 0;
  if (archetype === "MIXED_URBAN") return isMixed ? 14 : isMidRise || isHighRise ? 9 : isCommercial || isCivic ? 6 : isLowRise ? 2 : 0;
  if (archetype === "COMMERCIAL") return isCommercial ? 14 : isMixed ? 7 : isCivic ? 3 : isLowRise ? -7 : 0;
  return isCivic ? 16 : isMixed || isCommercial ? 5 : isLowRise ? -3 : 0;
}

export function entranceOutside(origin: Cell, entry: BuildingCatalogEntry, side: EntranceSide, offset: number): Cell {
  if (side === "N") return { x: origin.x + offset, y: origin.y - 1 };
  if (side === "S") return { x: origin.x + offset, y: origin.y + entry.footprint.height };
  if (side === "W") return { x: origin.x - 1, y: origin.y + offset };
  return { x: origin.x + entry.footprint.width, y: origin.y + offset };
}

function pathFinish(id: string): NonNullable<SurfaceCellDto["finish"]> {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (["EARTH", "PAVERS", "ASPHALT"] as const)[hash % 3]!;
}

/** One-cell seams between adjacent occupied facades become narrow alleys. */
export function buildingGapPaths(districts: DistrictDto[], tasks: Array<Pick<TaskDto, "id" | "footprint">>): Cell[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const cells = new Map<string, Cell>();
  for (const district of districts) {
    const grouped = new Map<string, Array<Pick<TaskDto, "id" | "footprint">>>();
    for (const lot of district.lots) {
      if (!lot.taskId || !lot.groupId) continue;
      const task = taskById.get(lot.taskId);
      if (!task) continue;
      const group = grouped.get(lot.groupId) ?? [];
      group.push(task);
      grouped.set(lot.groupId, group);
    }
    for (const group of grouped.values()) {
      for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
        const left = group[leftIndex]!;
        const leftBounds = {
          minX: Math.min(...left.footprint.map((cell) => cell.x)), maxX: Math.max(...left.footprint.map((cell) => cell.x)),
          minY: Math.min(...left.footprint.map((cell) => cell.y)), maxY: Math.max(...left.footprint.map((cell) => cell.y)),
        };
        for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
          const right = group[rightIndex]!;
          const rightBounds = {
            minX: Math.min(...right.footprint.map((cell) => cell.x)), maxX: Math.max(...right.footprint.map((cell) => cell.x)),
            minY: Math.min(...right.footprint.map((cell) => cell.y)), maxY: Math.max(...right.footprint.map((cell) => cell.y)),
          };
          const west = leftBounds.maxX < rightBounds.minX ? leftBounds : rightBounds;
          const east = west === leftBounds ? rightBounds : leftBounds;
          if (west.maxX + 2 !== east.minX) continue;
          const minY = Math.max(west.minY, east.minY);
          const maxY = Math.min(west.maxY, east.maxY);
          if (minY > maxY) continue;
          for (let y = minY; y <= maxY; y += 1) {
            const cell = { x: west.maxX + 1, y };
            cells.set(cellKey(cell), cell);
          }
        }
      }
    }
  }
  return [...cells.values()];
}

/**
 * A one-cell paved apron visually seats a facade into the public realm. It is
 * derived from free orthogonal neighbours, so it never covers a road, another
 * parcel or a persisted world feature.
 */
export function buildingApronCells(input: {
  tasks: Array<Pick<TaskDto, "visualKind" | "footprint">>;
  roads: ReadonlyMap<string, RoadCellDto>;
  blocked: ReadonlySet<string>;
  isSurfaceTerrain: (cell: Cell) => boolean;
}): Cell[] {
  const result = new Map<string, Cell>();
  for (const task of input.tasks) {
    if (task.visualKind !== "BUILDING") continue;
    const own = new Set(task.footprint.map(cellKey));
    for (const footprintCell of task.footprint) {
      for (const cell of neighbors4(footprintCell)) {
        const key = cellKey(cell);
        if (own.has(key) || input.roads.has(key) || input.blocked.has(key) || !input.isSurfaceTerrain(cell)) continue;
        result.set(key, cell);
      }
    }
  }
  return [...result.values()];
}

export function buildSurfaceMap(input: {
  roads: Map<string, RoadCellDto>;
  cities: CityDto[];
  districts: DistrictDto[];
  tasks: TaskDto[];
  features: WorldFeatureDto[];
  isSurfaceTerrain: (cell: Cell) => boolean;
}): Map<string, SurfaceCellDto> {
  const surfaces = new Map<string, SurfaceCellDto>();
  // V10: RUIN plots are vacant land. They neither block surfaces nor publish
  // any surface of their own — the cell stays plain terrain until redevelopment.
  const activeFeatures = input.features.filter((feature) => feature.kind !== "RUIN");
  const blocked = new Set([
    ...input.tasks.flatMap((task) => task.footprint).map(cellKey),
    ...activeFeatures.flatMap((feature) => feature.footprint).map(cellKey),
  ]);
  const completedOwners = new Map<string, string>();
  for (const district of input.districts.filter((item) => item.status === "COMPLETED")) {
    for (const cell of district.cells) completedOwners.set(cellKey(cell), district.id);
  }
  const persistedAccess = new Set([
    ...input.tasks.flatMap((task) => [task.entrance, ...task.accessPath]),
    ...input.features.flatMap((feature) => feature.accessPath),
  ].map(cellKey));

  for (const road of input.roads.values()) {
    const roadOwner = completedOwners.get(cellKey(road));
    for (const cell of neighbors4(road)) {
      const key = cellKey(cell);
      if (input.roads.has(key) || blocked.has(key) || !input.isSurfaceTerrain(cell)) continue;
      const targetOwner = completedOwners.get(key);
      // New external roads must never synthesize fresh sidewalk inside a
      // completed district. Only its already published internal streets own it.
      // Do not synthesize arbitrary new sidewalk across a sealed boundary, but
      // preserve an access anchor that was explicitly committed while the
      // district was active (park entrance or building approach).
      if (targetOwner && targetOwner !== roadOwner && !persistedAccess.has(key)) continue;
      const insideCity = input.cities.some((city) => contains(city.bounds, cell));
      const kind: SurfaceCellDto["kind"] = road.roadClass === "HIGHWAY" && !insideCity ? "SHOULDER" : "SIDEWALK";
      const existing = surfaces.get(key);
      if (!existing || existing.kind === "SHOULDER" && kind === "SIDEWALK") surfaces.set(key, { ...cell, kind });
    }
  }

  publishCrosswalks(input.roads, surfaces);

  // V10: a complex publishes its courtyard skeleton only together with the
  // first committed courtyard building. Empty lots stay plain grass, so the
  // map never shows pedestrian spurs leading nowhere.
  for (const district of input.districts) {
    const finish = pathFinish(district.id);
    for (const lot of district.lots) {
      if (!lot.taskId) continue;
      for (const cell of lot.sharedAccess ?? []) {
        const key = cellKey(cell);
        if (!input.roads.has(key) && !blocked.has(key) && input.isSurfaceTerrain(cell) && surfaces.get(key)?.kind !== "SIDEWALK") {
          surfaces.set(key, { ...cell, kind: "PATH", finish });
        }
      }
    }
  }


  // A deliberately narrow paved seam makes dense rows legible without
  // replacing them with another road. Sidewalks keep priority where the seam
  // reaches the street edge.
  for (const cell of buildingGapPaths(input.districts, input.tasks)) {
    const key = cellKey(cell);
    if (!input.roads.has(key) && !blocked.has(key) && input.isSurfaceTerrain(cell) && surfaces.get(key)?.kind !== "SIDEWALK") {
      surfaces.set(key, { ...cell, kind: "PATH", finish: "PAVERS" });
    }
  }

  // New facades sit on the same small-scale paving language as the surrounding
  // sidewalk instead of ending abruptly against grass. Street sidewalk and
  // access cells retain priority over this decorative apron.
  for (const cell of buildingApronCells({ tasks: input.tasks, roads: input.roads, blocked, isSurfaceTerrain: input.isSurfaceTerrain })) {
    const key = cellKey(cell);
    if (surfaces.get(key)?.kind !== "SIDEWALK") surfaces.set(key, { ...cell, kind: "PATH", finish: "PAVERS" });
  }

  for (const task of input.tasks) {
    const finish = pathFinish(task.districtId);
    if (task.visualKind === "PARK" && task.stage >= 2) {
      for (const cell of greenAreaPathCells(task.footprint, task.visualAssetKey)) {
        const key = cellKey(cell);
        if (!input.roads.has(key)) surfaces.set(key, { ...cell, kind: "PATH", finish: "PAVERS" });
      }
    }
    for (const cell of task.accessPath) {
      const key = cellKey(cell);
      if (!input.roads.has(key) && !blocked.has(key) && surfaces.get(key)?.kind !== "SIDEWALK") {
        surfaces.set(key, { ...cell, kind: task.accessKind, finish: task.accessKind === "PATH" ? finish : undefined });
      }
    }
  }
  for (const feature of activeFeatures) {
    const finish = pathFinish(feature.districtId ?? feature.cityId ?? feature.id);
    if (feature.assetKind === "AREA" && feature.developmentStage >= 2) {
      for (const cell of greenAreaPathCells(feature.footprint, feature.assetKey)) {
        const key = cellKey(cell);
        if (!input.roads.has(key)) surfaces.set(key, { ...cell, kind: "PATH", finish });
      }
    }
    for (const cell of feature.accessPath) {
      const key = cellKey(cell);
      if (!input.roads.has(key) && !blocked.has(key) && surfaces.get(key)?.kind !== "SIDEWALK") {
        const kind = feature.kind === "PARK" || feature.kind === "GROVE" ? "PATH" : "DRIVEWAY";
        surfaces.set(key, { ...cell, kind, finish: kind === "PATH" ? finish : undefined });
      }
    }
  }
  return surfaces;
}

type CrosswalkCandidate = {
  cells: Cell[];
  orientation: "H" | "V";
  axis: number;
  group: string;
};

function publishCrosswalks(roads: Map<string, RoadCellDto>, surfaces: Map<string, SurfaceCellDto>): void {
  const candidates = new Map<string, CrosswalkCandidate>();
  for (const sidewalk of [...surfaces.values()].filter((surface) => surface.kind === "SIDEWALK")) {
    for (const direction of [{ x: 1, y: 0 }, { x: 0, y: 1 }] as const) {
      const first = { x: sidewalk.x + direction.x, y: sidewalk.y + direction.y };
      const firstRoad = roads.get(cellKey(first));
      if (!firstRoad || firstRoad.structure !== "ROAD" || firstRoad.roadClass === "HIGHWAY") continue;
      const expectedWidth = ROAD_WIDTH[firstRoad.roadClass];
      const cells: Cell[] = [];
      let current = first;
      while (roads.has(cellKey(current)) && cells.length < expectedWidth) {
        cells.push(current);
        current = { x: current.x + direction.x, y: current.y + direction.y };
      }
      if (surfaces.get(cellKey(current))?.kind !== "SIDEWALK" || cells.length !== expectedWidth) continue;
      if (cells.some((cell) => {
        const road = roads.get(cellKey(cell));
        return !road || road.structure !== "ROAD" || road.roadClass !== firstRoad.roadClass;
      })) continue;
      const orientation: "H" | "V" = direction.x !== 0 ? "H" : "V";
      const perpendicularCenter = orientation === "H"
        ? cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length
        : cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;
      const axis = orientation === "H" ? sidewalk.y : sidewalk.x;
      const group = `${orientation}:${Math.round(perpendicularCenter * 2)}`;
      const candidateKey = cells.map(cellKey).sort().join("|");
      candidates.set(candidateKey, { cells, orientation, axis, group });
    }
  }

  const groups = new Map<string, CrosswalkCandidate[]>();
  for (const candidate of candidates.values()) groups.set(candidate.group, [...(groups.get(candidate.group) ?? []), candidate]);
  for (const group of groups.values()) {
    const ordered = group.sort((left, right) => left.axis - right.axis);
    const segments: CrosswalkCandidate[][] = [];
    for (const candidate of ordered) {
      const segment = segments.at(-1);
      if (!segment || candidate.axis - segment.at(-1)!.axis > 1) segments.push([candidate]);
      else segment.push(candidate);
    }
    for (const segment of segments) {
      // Short blocks get one central crossing. Long blocks receive a crossing
      // roughly every twelve cells, keeping the walk graph useful without
      // painting zebra stripes across the entire street.
      const firstIndex = Math.min(segment.length - 1, Math.max(0, Math.floor(Math.min(6, segment.length / 2))));
      for (let index = firstIndex; index < segment.length; index += 12) {
        const crossing = segment[index]!;
        for (const cell of crossing.cells) surfaces.set(cellKey(cell), { ...cell, kind: "CROSSWALK", orientation: crossing.orientation });
      }
    }
  }
}

export type AccessPlan = { entrance: Cell; path: Cell[]; distance: number };

export function findAccessPlan(input: {
  entry: BuildingCatalogEntry;
  origin: Cell;
  lotCells: Set<string>;
  buildingFootprint: Set<string>;
  occupied: Set<string>;
  roads: Map<string, RoadCellDto>;
  surfaces: Map<string, SurfaceCellDto>;
  isWalkableTerrain: (cell: Cell) => boolean;
  maxLength?: number;
}): AccessPlan | null {
  const maxLength = input.maxLength ?? 6;
  const isPublicPedestrianSurface = (cell: Cell): boolean => {
    const kind = input.surfaces.get(cellKey(cell))?.kind;
    return kind === "SIDEWALK" || kind === "PATH";
  };
  let best: AccessPlan | null = null;
  for (const configured of input.entry.entrances) {
    const start = entranceOutside(input.origin, input.entry, configured.side, configured.offset);
    const startKey = cellKey(start);
    if (input.roads.has(startKey) || input.buildingFootprint.has(startKey) || input.occupied.has(startKey) || !input.isWalkableTerrain(start)) continue;
    if (isPublicPedestrianSurface(start)) {
      const direct = { entrance: start, path: [], distance: 0 };
      if (!best || direct.distance < best.distance) best = direct;
      continue;
    }
    type State = { cell: Cell; path: Cell[]; direction: number; turns: number };
    const queue: State[] = [{ cell: start, path: [start], direction: -1, turns: 0 }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const state = queue.shift()!;
      if (state.path.length > maxLength) continue;
      const stateKey = `${cellKey(state.cell)}:${state.direction}:${state.turns}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      for (let direction = 0; direction < 4; direction += 1) {
        const next = neighbors4(state.cell)[direction]!;
        const nextKey = cellKey(next);
        if (isPublicPedestrianSurface(next)) {
          const candidate = { entrance: start, path: state.path, distance: state.path.length };
          if (!best || candidate.distance < best.distance) best = candidate;
          queue.length = 0;
          break;
        }
        const turns = state.direction < 0 || state.direction === direction ? state.turns : state.turns + 1;
        if (turns > 2 || state.path.length >= maxLength) continue;
        if (!input.lotCells.has(nextKey) || input.roads.has(nextKey) || input.buildingFootprint.has(nextKey) || input.occupied.has(nextKey)) continue;
        if (!input.isWalkableTerrain(next)) continue;
        queue.push({ cell: next, path: [...state.path, next], direction, turns });
      }
    }
  }
  return best;
}
