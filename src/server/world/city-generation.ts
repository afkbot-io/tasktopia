import type { BuildingCatalogEntry, EntranceSide } from "../../shared/catalog";
import type {
  Cell,
  CityDto,
  CityMorphology,
  DistrictArchetype,
  DistrictDto,
  RoadCellDto,
  SurfaceCellDto,
  TaskDto,
  WorldFeatureDto,
} from "../../shared/contracts";
import { cellKey, contains, neighbors4 } from "./grid";

export const ROAD_WIDTH: Record<RoadCellDto["roadClass"], number> = {
  // One 8 px cell is one traffic lane. Local and district collector streets
  // therefore use an even two-cell profile: one lane per direction.
  LOCAL: 2,
  COLLECTOR: 2,
  ARTERIAL: 4,
  HIGHWAY: 4,
};

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

export type BuildingZoningRole = "PRIVATE_RESIDENTIAL" | "DENSE_RESIDENTIAL" | "COMMERCIAL" | "CIVIC";

export function buildingZoningRole(entry: BuildingCatalogEntry): BuildingZoningRole {
  const tags = new Set(entry.tags);
  if (entry.category === "CIVIC") return "CIVIC";
  if (entry.category === "COMMERCIAL") return "COMMERCIAL";
  if (entry.category === "HIGHRISE" || tags.has("new-build") || tags.has("mixed-use")) return "DENSE_RESIDENTIAL";
  return "PRIVATE_RESIDENTIAL";
}

export function buildingCompatibleWithArchetype(entry: BuildingCatalogEntry, archetype: DistrictArchetype): boolean {
  const role = buildingZoningRole(entry);
  if (entry.serviceRole) return true;
  if (archetype === "PRIVATE") return role === "PRIVATE_RESIDENTIAL" || role === "COMMERCIAL" || role === "CIVIC";
  if (archetype === "NEW_BUILD") {
    const longSupport = role === "COMMERCIAL" && (entry.footprint.width >= 5 || entry.key === "commercial-parking-lot");
    return role === "DENSE_RESIDENTIAL" || longSupport || role === "CIVIC";
  }
  if (archetype === "COMMERCIAL") return role === "COMMERCIAL" || role === "CIVIC" || entry.tags.includes("mixed-use");
  if (archetype === "CIVIC") return role === "CIVIC" || role === "COMMERCIAL";
  return true;
}

export function primaryZoningRole(archetype: DistrictArchetype, role: BuildingZoningRole): boolean {
  if (archetype === "PRIVATE") return role === "PRIVATE_RESIDENTIAL";
  if (archetype === "NEW_BUILD") return role === "DENSE_RESIDENTIAL";
  if (archetype === "COMMERCIAL") return role === "COMMERCIAL";
  if (archetype === "CIVIC") return role === "CIVIC";
  return true;
}

export function archetypeAffinity(entry: BuildingCatalogEntry, archetype: DistrictArchetype): number {
  const tags = new Set(entry.tags);
  const isNewBuild = tags.has("new-build") || entry.category === "HIGHRISE";
  const isPrivate = tags.has("private-residential");
  const isMixed = tags.has("mixed-use");
  const isCommercial = entry.category === "COMMERCIAL" || tags.has("commercial");
  const isCivic = entry.category === "CIVIC" || tags.has("civic");
  if (archetype === "NEW_BUILD") return isNewBuild || isMixed ? 13 : isCommercial ? 5 : isCivic ? 2 : isPrivate ? -9 : 0;
  if (archetype === "PRIVATE") return isPrivate ? 13 : isCommercial ? 4 : isCivic ? 2 : isNewBuild ? -11 : 0;
  if (archetype === "MIXED_URBAN") return isMixed ? 14 : isNewBuild ? 9 : isCommercial || isCivic ? 6 : isPrivate ? -3 : 0;
  if (archetype === "COMMERCIAL") return isCommercial ? 14 : isMixed ? 7 : isCivic ? 3 : isPrivate ? -7 : 0;
  return isCivic ? 16 : isMixed || isCommercial ? 5 : isPrivate ? -3 : 0;
}

export function entranceOutside(origin: Cell, entry: BuildingCatalogEntry, side: EntranceSide, offset: number): Cell {
  if (side === "N") return { x: origin.x + offset, y: origin.y - 1 };
  if (side === "S") return { x: origin.x + offset, y: origin.y + entry.footprint.height };
  if (side === "W") return { x: origin.x - 1, y: origin.y + offset };
  return { x: origin.x + entry.footprint.width, y: origin.y + offset };
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
  const blocked = new Set([
    ...input.tasks.flatMap((task) => task.footprint).map(cellKey),
    ...input.features.flatMap((feature) => feature.footprint).map(cellKey),
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

  // V9 block plans publish their shared pedestrian skeleton before tasks are
  // assigned. Rear residential rows can therefore reuse one stable courtyard
  // path instead of asking the road generator for another street.
  for (const district of input.districts) {
    for (const lot of district.lots) {
      for (const cell of lot.sharedAccess ?? []) {
        const key = cellKey(cell);
        if (!input.roads.has(key) && !blocked.has(key) && input.isSurfaceTerrain(cell) && surfaces.get(key)?.kind !== "SIDEWALK") {
          surfaces.set(key, { ...cell, kind: "PATH" });
        }
      }
    }
  }

  for (const task of input.tasks) {
    for (const cell of task.accessPath) {
      const key = cellKey(cell);
      if (!input.roads.has(key) && !blocked.has(key) && surfaces.get(key)?.kind !== "SIDEWALK") {
        surfaces.set(key, { ...cell, kind: task.accessKind });
      }
    }
  }
  for (const feature of input.features) {
    if (feature.assetKind === "AREA") {
      for (const cell of feature.footprint) {
        const key = cellKey(cell);
        if (!input.roads.has(key)) surfaces.set(key, { ...cell, kind: "PATH" });
      }
    }
    for (const cell of feature.accessPath) {
      const key = cellKey(cell);
      if (!input.roads.has(key) && !blocked.has(key) && surfaces.get(key)?.kind !== "SIDEWALK") {
        surfaces.set(key, { ...cell, kind: feature.kind === "PARK" || feature.kind === "GROVE" ? "PATH" : "DRIVEWAY" });
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
      while (roads.has(cellKey(current)) && cells.length <= expectedWidth) {
        cells.push(current);
        current = { x: current.x + direction.x, y: current.y + direction.y };
      }
      // Imported/legacy maps may have an odd three-cell local road. Accept one
      // compatibility cell, but reject wider junction envelopes and turns.
      if (surfaces.get(cellKey(current))?.kind !== "SIDEWALK" || cells.length < 2 || cells.length > expectedWidth + 1) continue;
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
