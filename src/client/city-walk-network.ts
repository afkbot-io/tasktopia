import type { Cell, ChunkDto, ChunkTaskDto, WorldFeatureDto, SurfaceCellDto } from "../shared/contracts";
import { PROP_CATALOG } from "../shared/catalog";
import { taskParkDecorLayout } from "../shared/task-park";
import { greenAreaSurfaceLayout } from "../shared/green-area";
import { connectShortWalkGaps } from "./agent-routing";

export type CityWalkInput = {
  terrain: Array<Pick<ChunkDto["terrain"][number], "x" | "y" | "terrain">>;
  roads: ReadonlyMap<string, Cell>;
  surfaces: Array<Pick<SurfaceCellDto, "x" | "y" | "kind">>;
  tasks: Array<Pick<ChunkTaskDto, "taskNumber" | "stage" | "visualKind" | "visualAssetKey" | "footprint" | "accessPath">>;
  features: Array<Pick<WorldFeatureDto, "assetKind" | "assetKey" | "developmentStage" | "footprint" | "accessPath" | "kind">>;
  decorations: ChunkDto["decorations"];
};
const key = (cell: Cell) => `${cell.x},${cell.y}`;

export function buildCityWalkNetwork(input: CityWalkInput) {
  const blocked = new Set<string>();
  const blockRect = (origin: Cell, width: number, height: number) => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) blocked.add(key({ x: origin.x + x, y: origin.y + y }));
  };
  for (const task of input.tasks) {
    if (task.stage < 5 && task.footprint.length) {
      // Building works use an external fence; public-space works are bounded
      // by their own parcel so narrow infill never closes a neighbour's aisle.
      const minX = Math.min(...task.footprint.map(c => c.x)), minY = Math.min(...task.footprint.map(c => c.y));
      const maxX = Math.max(...task.footprint.map(c => c.x)), maxY = Math.max(...task.footprint.map(c => c.y));
      const clearance = task.visualKind === "PARK" ? 0 : 1;
      blockRect({ x: minX - clearance, y: minY - clearance }, maxX - minX + 1 + 2 * clearance, maxY - minY + 1 + 2 * clearance);
    } else if (task.visualKind !== "PARK") {
      task.footprint.forEach(cell => blocked.add(key(cell)));
    } else {
      for (const cell of greenAreaSurfaceLayout(task.footprint, 5, task.visualAssetKey)) {
        if (cell.role === "WATER" || cell.role === "BASIN") blocked.add(key(cell));
      }
      for (const prop of taskParkDecorLayout(task.footprint, 5, task.visualAssetKey, task.taskNumber)) blockRect(prop.origin, prop.width, prop.height);
    }
  }
  for (const feature of input.features) {
    if (feature.assetKind !== "AREA") feature.footprint.forEach(cell => blocked.add(key(cell)));
    else for (const cell of greenAreaSurfaceLayout(feature.footprint, feature.developmentStage, feature.assetKey)) {
      if (cell.role === "WATER" || cell.role === "BASIN") blocked.add(key(cell));
    }
  }
  for (const decoration of input.decorations) {
    const size = PROP_CATALOG[decoration.kind]?.footprint ?? { width: 1, height: 1 };
    blockRect(decoration.origin, size.width, size.height);
  }
  const crosswalks = new Set(input.surfaces.filter(cell => cell.kind === "CROSSWALK").map(key));
  const walkableSurfaces = input.surfaces.filter(cell => !blocked.has(key(cell))
    && ["SIDEWALK", "PATH", "CROSSWALK"].includes(cell.kind)
    && (!input.roads.has(key(cell)) || crosswalks.has(key(cell))));
  const base = new Map(walkableSurfaces.map(cell => [key(cell), { x: cell.x, y: cell.y }]));
  const safeGround = new Map(input.terrain.filter(cell => !blocked.has(key(cell)) && !input.roads.has(key(cell))
    && ["GRASS", "MEADOW", "DIRT"].includes(cell.terrain)).map(cell => [key(cell), { x: cell.x, y: cell.y }]));
  const walkGraph = connectShortWalkGaps(base, safeGround, 2);
  const surfaceKeys = new Set(input.surfaces.map(key));
  const animalGraph = new Map(input.terrain.filter(cell => !blocked.has(key(cell)) && !input.roads.has(key(cell))
    && !surfaceKeys.has(key(cell)) && ["MEADOW", "FOREST"].includes(cell.terrain)).map(cell => [key(cell), { x: cell.x, y: cell.y }]));
  const activityCells = new Set<string>();
  const addActivity = (cell: Cell) => {
    if (walkGraph.has(key(cell)) && !input.roads.has(key(cell)) && !crosswalks.has(key(cell))) activityCells.add(key(cell));
  };
  for (const task of input.tasks) if (task.stage === 5) task.accessPath.forEach(addActivity);
  for (const feature of input.features) if (feature.kind === "BUS_STOP" || feature.kind === "PARK") feature.accessPath.forEach(addActivity);
  for (const decoration of input.decorations) {
    if (!["bench-horizontal", "bench-vertical", "picnic-table", "playground-small", "trash-bin"].includes(decoration.kind)) continue;
    for (const [x, y] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) addActivity({ x: decoration.origin.x + x!, y: decoration.origin.y + y! });
  }
  return { walkGraph, activityCells, crosswalks, animalGraph, blockedCells: blocked };
}
