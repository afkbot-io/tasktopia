import type { Cell, CellRunDto, Rect, ChunkDistrictDto, ChunkTaskDto, DistrictStatus, TaskStatus } from "../shared/contracts";
import type { CitySceneDto } from "../shared/city-scene-contract";
import { DevelopmentCellIndex } from "./district-development-geometry";

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
  const boundary = cells.filter(c => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => !owned.has(key({ x: c.x + dx!, y: c.y + dy! }))));
  boundary.sort((a, b) => a.y - b.y || a.x - b.x);
  return planBoundary(boundary, cell => owned.has(key(cell)), cell => blocked.has(key(cell)), state);
}

function planBoundary(boundary: readonly Cell[], owns: (cell: Cell) => boolean, isBlocked: (cell: Cell) => boolean,
  state: DistrictDevelopmentState): DistrictDevelopmentPlan {
  const result: DistrictDevelopmentPlan = { fences: [], marker: null };
  if (!boundary.length || state === "HIDDEN" || state === "FINISHED") return result;
  const used = new Set<string>();
  const canPlace = (footprint: Cell[]) => footprint.every(c => owns(c) && !isBlocked(c) && !used.has(key(c)));
  const reserve = (footprint: Cell[]) => footprint.forEach(c => used.add(key(c)));
  function* inward(cell: Cell) {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const)
      if (!owns({ x: cell.x + dx, y: cell.y + dy }))
        for (let inset = 0; inset < 3; inset++) yield { x: cell.x - dx * inset, y: cell.y - dy * inset };
  }
  markerSearch: for (const source of boundary) for (const cell of inward(source)) {
    // Full 16×16 envelope, including the space above the pole.
    const footprint = [cell, { x: cell.x + 1, y: cell.y }, { x: cell.x, y: cell.y + 1 }, { x: cell.x + 1, y: cell.y + 1 }];
    if (!canPlace(footprint)) continue;
    result.marker = { kind: "marker", origin: cell, cells: footprint };
    reserve(footprint);
    break markerSearch;
  }
  if (state !== "BUILDING" && state !== "PREPARING") return result;
  // Sample the perimeter evenly; avoid thousands of sprites in a large city.
  const stride = Math.max(1, Math.ceil(boundary.length / 96));
  for (let i = 0; i < boundary.length && result.fences.length < 48; i += stride) {
    const c = boundary[i]!;
    const horizontal = !owns({ x: c.x, y: c.y - 1 }) || !owns({ x: c.x, y: c.y + 1 });
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
  const districts = new Map<string, ChunkDistrictDto>(), runs = new Map<string, CellRunDto[]>();
  const indexes = new Map<string, DevelopmentCellIndex>(), tasks = new Map<string, ChunkTaskDto>();
  function* blockedRuns() {
    for (const chunk of scene.chunks) {
      yield* chunk.roadRuns; yield* chunk.surfaceRuns; yield* chunk.decorationContext.blockedCellRuns;
    }
  }
  const blocked = new DevelopmentCellIndex(blockedRuns());
  for (const chunk of scene.chunks) {
    for (const task of chunk.tasks) tasks.set(task.id, task);
    for (const { cellRuns, ...district } of chunk.districts) {
      let owned = runs.get(district.id); if (!owned) { owned = []; runs.set(district.id, owned); }
      owned.push(...cellRuns); districts.set(district.id, { ...district, cells: [] });
    }
  }
  for (const snapshot of scene.completedDistrictSnapshots) for (const task of snapshot.tasks) tasks.set(task.id, task);
  for (const task of tasks.values()) { for (const cell of task.footprint) blocked.addCell(cell); for (const cell of task.accessPath) blocked.addCell(cell); }
  for (const [id, owned] of runs) {
    const index = new DevelopmentCellIndex(owned); indexes.set(id, index);
    // Compatibility for explicit consumers. Rendering uses spans and outlines,
    // so merely opening a city never expands the complete district interior.
    Object.defineProperty(districts.get(id)!, "cells", { enumerable: true, get: () => index.cells() });
  }
  const plans = new Map<string, DistrictDevelopmentPlan>();
  return { districts, tasks,
    hasCells: (id: string) => (indexes.get(id)?.size ?? 0) > 0,
    intersects: (id: string, bounds: Rect) => indexes.get(id)?.intersects(bounds) ?? false,
    outline: (id: string) => indexes.get(id)?.outline() ?? [],
    plan(id: string, state: DistrictDevelopmentState): DistrictDevelopmentPlan {
      const cacheKey = `${id}:${state}`; let plan = plans.get(cacheKey);
      if (!plan) {
        const index = indexes.get(id);
        plan = !index || state === "HIDDEN" || state === "FINISHED" ? { fences: [], marker: null }
          : planBoundary(index.boundary(), cell => index.has(cell.x, cell.y), cell => blocked.has(cell.x, cell.y), state);
        plans.set(cacheKey, plan);
      }
      return plan;
    },
  };
}

export function districtDevelopmentSummary(name:string,tasks:readonly {id:string;status:TaskStatus}[]) {
  const unique=[...new Map(tasks.map(task=>[task.id,task])).values()];
  const done=unique.filter(t=>t.status==='COMPLETED').length;
  const active=unique.filter(t=>t.status==='STARTED'||t.status==='IN_PROGRESS').length;
  const testing=unique.filter(t=>t.status==='TESTING').length;
  const planned=unique.filter(t=>t.status==='PLANNING').length;
  return {title:name,line:unique.length?`${done} / ${unique.length} готово · ${active} в работе`:'Задач пока нет',detail:`${testing} на проверке · ${planned} в планах`};
}
