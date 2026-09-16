import type { Cell, ChunkDistrictDto, ChunkTaskDto, DistrictStatus, TaskStatus } from "../shared/contracts";
import type { CitySceneDto } from "../shared/city-scene-contract";
import { expandCellRuns } from "../shared/world-cell-runs";

export type DistrictDevelopmentState = "PREPARING" | "BUILDING" | "TESTING" | "FINISHED" | "PLANNED" | "HIDDEN";
export type DistrictDevelopmentProp = { kind: "fence-horizontal" | "fence-vertical" | "marker"; origin: Cell; cells: Cell[] };
export type DistrictDevelopmentPlan = { fences: DistrictDevelopmentProp[]; marker: DistrictDevelopmentProp | null };
const key = (cell: Cell) => `${cell.x},${cell.y}`;

export function districtDevelopmentState(status: DistrictStatus, tasks: readonly TaskStatus[]): DistrictDevelopmentState {
  if (status === "COMPLETED" || status === "ABANDONED") return "HIDDEN";
  if (status === "PLANNED") return "PLANNED";
  if (tasks.length && tasks.every(task => task === "COMPLETED")) return "FINISHED";
  if (tasks.some(task => task === "STARTED" || task === "IN_PROGRESS")) return "BUILDING";
  if (tasks.some(task => task === "TESTING")) return "TESTING";
  return "PREPARING";
}

export const DISTRICT_DEVELOPMENT_LABEL: Record<DistrictDevelopmentState, string> = {
  PREPARING: "Подготовка района", BUILDING: "Район развивается", TESTING: "Район на проверке",
  FINISHED: "Работы завершены", PLANNED: "Район запланирован", HIDDEN: "",
};

/** Decorative, not physical reservations. Caller supplies roads, paths, props,
 * task footprints and infrastructure as blocked cells. No geometry is mutated. */
export function planDistrictDevelopment(cells: readonly Cell[], blocked: ReadonlySet<string>, state: DistrictDevelopmentState): DistrictDevelopmentPlan {
  const result: DistrictDevelopmentPlan = { fences: [], marker: null };
  if (!cells.length || state === "HIDDEN" || state === "FINISHED") return result;
  const owned = new Set(cells.map(key));
  const used = new Set<string>();
  const boundary = cells.filter(c => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => !owned.has(key({ x: c.x + dx!, y: c.y + dy! }))));
  boundary.sort((a, b) => a.y - b.y || a.x - b.x);
  const canPlace = (footprint: Cell[]) => footprint.every(c => owned.has(key(c)) && !blocked.has(key(c)) && !used.has(key(c)));
  const reserve = (footprint: Cell[]) => footprint.forEach(c => used.add(key(c)));
  const inward = (cell: Cell) => {
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    return directions.filter(([dx, dy]) => !owned.has(key({ x: cell.x + dx, y: cell.y + dy })))
      .flatMap(([dx, dy]) => [0, 1, 2].map(inset => ({ x: cell.x - dx * inset, y: cell.y - dy * inset })));
  };
  for (const cell of boundary.flatMap(inward)) {
    // Full 16×16 envelope, including the space above the pole.
    const footprint = [cell, { x: cell.x + 1, y: cell.y }, { x: cell.x, y: cell.y + 1 }, { x: cell.x + 1, y: cell.y + 1 }];
    if (!canPlace(footprint)) continue;
    result.marker = { kind: "marker", origin: cell, cells: footprint };
    reserve(footprint);
    break;
  }
  if (state !== "BUILDING" && state !== "PREPARING") return result;
  // Sample the perimeter evenly; avoid thousands of sprites in a large city.
  const stride = Math.max(1, Math.ceil(boundary.length / 96));
  for (let i = 0; i < boundary.length && result.fences.length < 48; i += stride) {
    const c = boundary[i]!;
    const horizontal = !owned.has(key({ x: c.x, y: c.y - 1 })) || !owned.has(key({ x: c.x, y: c.y + 1 }));
    for (const origin of inward(c)) {
      const next = { x: origin.x + (horizontal ? 1 : 0), y: origin.y + (horizontal ? 0 : 1) };
      const footprint = [origin, next];
      if (!canPlace(footprint)) continue;
      result.fences.push({ kind: horizontal ? "fence-horizontal" : "fence-vertical", origin, cells: footprint });
      reserve(footprint);
      break;
    }
  }
  return result;
}

/** Construct once per authoritative scene, never from the moving viewport.
 * Shared page seams are internal; pan cannot move a sign or a fence. */
export function createDistrictDevelopmentGeometry(scene: CitySceneDto) {
  const districts = new Map<string, ChunkDistrictDto>();
  const districtCells = new Map<string, Map<string, Cell>>();
  const tasks = new Map<string, ChunkTaskDto>();
  const blocked = new Set<string>();
  for (const chunk of scene.chunks) {
    for (const task of chunk.tasks) tasks.set(task.id, task);
    for (const run of [...chunk.roadRuns, ...chunk.surfaceRuns, ...chunk.decorationContext.blockedCellRuns])
      for (const cell of expandCellRuns([run])) blocked.add(key(cell));
    for (const { cellRuns, ...district } of chunk.districts) {
      const cells = districtCells.get(district.id) ?? new Map<string, Cell>();
      for (const cell of expandCellRuns(cellRuns)) cells.set(key(cell), cell);
      districtCells.set(district.id, cells);
      districts.set(district.id, { ...district, cells: [] });
    }
  }
  for (const snapshot of scene.completedDistrictSnapshots) for (const task of snapshot.tasks) tasks.set(task.id, task);
  for (const task of tasks.values()) for (const cell of [...task.footprint, ...task.accessPath]) blocked.add(key(cell));
  for (const [id, cells] of districtCells) districts.get(id)!.cells = [...cells.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  const plans = new Map<string, DistrictDevelopmentPlan>();
  return { districts, tasks, plan(id: string, state: DistrictDevelopmentState): DistrictDevelopmentPlan {
    const cacheKey = `${id}:${state}`;
    let plan = plans.get(cacheKey);
    if (!plan) { plan = planDistrictDevelopment(districts.get(id)?.cells ?? [], blocked, state); plans.set(cacheKey, plan); }
    return plan;
  } };
}
