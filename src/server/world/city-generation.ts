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
import { buildRoadSurfaces } from "../../shared/road-surfaces";
import { greenAreaPathCells } from "../../shared/green-area";
import { cellKey, contains, neighbors4 } from "./grid";

export { ROAD_WIDTH } from "../../shared/road-surfaces";
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
  const activeFeatures = input.features.filter((feature) => feature.kind !== "RUIN");
  const blocked = new Set([
    ...input.tasks.flatMap((task) => task.footprint).map(cellKey),
    ...activeFeatures.flatMap((feature) => feature.footprint).map(cellKey),
  ]);
  const surfaces = buildRoadSurfaces({ roads: input.roads, blocked,
    isSurfaceTerrain: input.isSurfaceTerrain,
    isInsideCity: cell => input.cities.some(city => contains(city.bounds, cell)),
  });

  // Occupied block slots publish their shared pedestrian access. Planned
  // slots remain unpaved until an actual task uses them.
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
