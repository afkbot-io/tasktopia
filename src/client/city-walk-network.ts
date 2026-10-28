import type { Cell, ChunkDto, ChunkTaskDto, WorldFeatureDto, SurfaceCellDto, TerrainKind } from "../shared/contracts";
import { PROP_CATALOG } from "../shared/catalog";
import { taskParkDecorLayout } from "../shared/task-park";
import { greenAreaSurfaceLayout } from "../shared/green-area";
import { completePreparation, prepareCooperatively, type CooperativePreparationOptions } from "./cooperative-preparation";

export type CityWalkInput = {
  terrain: Array<Pick<ChunkDto["terrain"][number], "x" | "y" | "terrain">>;
  roads: ReadonlyMap<string, Cell>;
  surfaces: Array<Pick<SurfaceCellDto, "x" | "y" | "kind">>;
  tasks: Array<Pick<ChunkTaskDto, "taskNumber" | "stage" | "visualKind" | "visualAssetKey" | "footprint" | "accessPath">>;
  features: Array<Pick<WorldFeatureDto, "assetKind" | "assetKey" | "developmentStage" | "footprint" | "accessPath" | "kind">>;
  decorations: ChunkDto["decorations"];
  /** Canonical seed/profile lookup; dense terrain remains viewport-owned. */
  sampleTerrain?: (cell: Cell) => TerrainKind | undefined;
};
const key = (cell: Cell) => `${cell.x},${cell.y}`;

export function buildCityWalkNetwork(input: CityWalkInput) {
  return completePreparation(buildCityWalkNetworkSteps(input));
}

export function buildCityWalkNetworkAsync(input: CityWalkInput, options: CooperativePreparationOptions = {}) {
  return prepareCooperatively(buildCityWalkNetworkSteps(input), options);
}

function* buildCityWalkNetworkSteps(input: CityWalkInput) {
  const blocked = new Set<string>();
  function* blockRect(origin: Cell, width: number, height: number) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      blocked.add(key({ x: origin.x + x, y: origin.y + y })); yield;
    }
  }
  for (const task of input.tasks) {
    yield;
    if (task.stage < 5 && task.footprint.length) {
      // Building works use an external fence; public-space works are bounded
      // by their own parcel so narrow infill never closes a neighbour's aisle.
      const minX = Math.min(...task.footprint.map(c => c.x)), minY = Math.min(...task.footprint.map(c => c.y));
      const maxX = Math.max(...task.footprint.map(c => c.x)), maxY = Math.max(...task.footprint.map(c => c.y));
      const clearance = task.visualKind === "PARK" ? 0 : 1;
      yield* blockRect({ x: minX - clearance, y: minY - clearance }, maxX - minX + 1 + 2 * clearance, maxY - minY + 1 + 2 * clearance);
    } else if (task.visualKind !== "PARK") {
      for (const cell of task.footprint) { blocked.add(key(cell)); yield; }
    } else {
      for (const cell of greenAreaSurfaceLayout(task.footprint, 5, task.visualAssetKey)) {
        yield;
        if (cell.role === "WATER" || cell.role === "BASIN") blocked.add(key(cell));
      }
      for (const prop of taskParkDecorLayout(task.footprint, 5, task.visualAssetKey, task.taskNumber)) yield* blockRect(prop.origin, prop.width, prop.height);
    }
  }
  for (const feature of input.features) {
    yield;
    if (feature.assetKind !== "AREA") { for (const cell of feature.footprint) { blocked.add(key(cell)); yield; } }
    else for (const cell of greenAreaSurfaceLayout(feature.footprint, feature.developmentStage, feature.assetKey)) {
      yield;
      if (cell.role === "WATER" || cell.role === "BASIN") blocked.add(key(cell));
    }
  }
  for (const decoration of input.decorations) {
    const size = PROP_CATALOG[decoration.kind]?.footprint ?? { width: 1, height: 1 };
    yield* blockRect(decoration.origin, size.width, size.height);
  }
  const crosswalks = new Set<string>(), surfaceKeys = new Set<string>();
  for (const cell of input.surfaces) { if (cell.kind === "CROSSWALK") crosswalks.add(key(cell)); surfaceKeys.add(key(cell)); yield; }
  const base = new Map<string, Cell>(), safeGround = new Map<string, Cell>(), animalGraph = new Map<string, Cell>();
  for (const cell of input.surfaces) {
    if (!blocked.has(key(cell)) && ["SIDEWALK", "PATH", "CROSSWALK"].includes(cell.kind)
      && (!input.roads.has(key(cell)) || crosswalks.has(key(cell)))) base.set(key(cell), { x: cell.x, y: cell.y });
    yield;
  }
  for (const cell of input.terrain) {
    if (!blocked.has(key(cell)) && !input.roads.has(key(cell))) {
      if (["GRASS", "MEADOW", "DIRT"].includes(cell.terrain)) safeGround.set(key(cell), { x: cell.x, y: cell.y });
      if (!surfaceKeys.has(key(cell)) && ["MEADOW", "FOREST"].includes(cell.terrain)) animalGraph.set(key(cell), { x: cell.x, y: cell.y });
    }
    yield;
  }
  const walkGraph = new Map<string, Cell>();
  for (const [id, cell] of base) { walkGraph.set(id, cell); yield; }
  // Keep connectShortWalkGaps' exact origin/direction/gap insertion order.
  for (const origin of base.values()) {
    for (const direction of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
      for (let gap = 1; gap <= 2; gap++) {
        yield;
        const target = { x: origin.x + direction.x * (gap + 1), y: origin.y + direction.y * (gap + 1) };
        if (!base.has(key(target))) continue;
        const intermediate: Cell[] = [];
        for (let step = 1; step <= gap; step++) intermediate.push({ x: origin.x + direction.x * step, y: origin.y + direction.y * step });
        const safe = intermediate.every(cell => {
          const id=key(cell);
          if(safeGround.has(id))return true;
          if(blocked.has(id)||input.roads.has(id))return false;
          const terrain=input.sampleTerrain?.(cell);
          return terrain!==undefined&&["GRASS","MEADOW","DIRT"].includes(terrain);
        });
        if (safe) for (const cell of intermediate) walkGraph.set(key(cell), safeGround.get(key(cell)) ?? cell);
        break;
      }
    }
  }
  const activityCells = new Set<string>();
  const buildingEntrances = new Set<string>();
  for (const task of input.tasks) {
    yield;
    const approach = task.accessPath[0];
    if (task.stage === 5 && task.visualKind === "BUILDING" && approach && walkGraph.has(key(approach))
      && !input.roads.has(key(approach)) && !crosswalks.has(key(approach))) buildingEntrances.add(key(approach));
  }
  const addActivity = (cell: Cell) => {
    if (walkGraph.has(key(cell)) && !input.roads.has(key(cell)) && !crosswalks.has(key(cell))) activityCells.add(key(cell));
  };
  for (const task of input.tasks) { if (task.stage === 5) for (const cell of task.accessPath) { addActivity(cell); yield; } yield; }
  for (const feature of input.features) { if (feature.kind === "BUS_STOP" || feature.kind === "PARK") for (const cell of feature.accessPath) { addActivity(cell); yield; } yield; }
  for (const decoration of input.decorations) {
    yield;
    if (!["bench-horizontal", "bench-vertical", "picnic-table", "playground-small", "trash-bin"].includes(decoration.kind)) continue;
    for (const [x, y] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) addActivity({ x: decoration.origin.x + x!, y: decoration.origin.y + y! });
  }
  return { walkGraph, activityCells, buildingEntrances, crosswalks, animalGraph, blockedCells: blocked };
}
