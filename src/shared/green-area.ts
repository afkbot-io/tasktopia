import type { Cell, TaskStatus } from "./contracts";

export type GreenAreaDevelopmentStage = 1 | 2 | 3 | 4 | 5;
export type GreenAreaSurfaceRole = "EARTH" | "MEADOW" | "PATH" | "BOUNDARY";

const DEVELOPMENT_STAGE_BY_TASK_STATUS: Readonly<Record<TaskStatus, GreenAreaDevelopmentStage>> = {
  PLANNING: 1,
  STARTED: 2,
  IN_PROGRESS: 3,
  TESTING: 4,
  COMPLETED: 5,
};

/** A district park grows with the furthest visible construction milestone. */
export function greenAreaDevelopmentStage(statuses: readonly TaskStatus[]): GreenAreaDevelopmentStage {
  return statuses.reduce<GreenAreaDevelopmentStage>(
    (stage, status) => Math.max(stage, DEVELOPMENT_STAGE_BY_TASK_STATUS[status]) as GreenAreaDevelopmentStage,
    1,
  );
}

/** A task-backed park follows exactly the same five milestones as its task. */
export function greenAreaStageForTaskStatus(status: TaskStatus): GreenAreaDevelopmentStage {
  return DEVELOPMENT_STAGE_BY_TASK_STATUS[status];
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function boundsOf(footprint: Cell[]) {
  return {
    minX: Math.min(...footprint.map((cell) => cell.x)),
    maxX: Math.max(...footprint.map((cell) => cell.x)),
    minY: Math.min(...footprint.map((cell) => cell.y)),
    maxY: Math.max(...footprint.map((cell) => cell.y)),
  };
}

/**
 * Visible and navigable park paths. Formal public parks use a two-cell axial
 * promenade when their even dimensions allow it; compact parks retain a
 * single-cell cross so planted quarters do not disappear.
 */
export function greenAreaPathCells(footprint: Cell[], assetKey = "urban-park"): Cell[] {
  if (footprint.length === 0) return [];
  const occupied = new Set(footprint.map(cellKey));
  const { minX, maxX, minY, maxY } = boundsOf(footprint);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const centerX = Math.floor((minX + maxX) / 2);
  const centerY = Math.floor((minY + maxY) / 2);
  const formal = new Set(["urban-formal", "urban-community", "urban-central"]).has(assetKey);
  const hasInteriorPaths = width >= 6 && height >= 5;
  const centerXs = new Set([centerX, ...(formal && width % 2 === 0 ? [centerX + 1] : [])]);
  const centerYs = new Set([centerY, ...(formal && height % 2 === 0 ? [centerY + 1] : [])]);
  const insetLoop = assetKey === "urban-botanical" || assetKey === "urban-amusement";
  return footprint.filter((cell) => {
    const boundary = [
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x - 1, y: cell.y },
    ].some((neighbor) => !occupied.has(cellKey(neighbor)));
    const axial = hasInteriorPaths && (centerXs.has(cell.x) || centerYs.has(cell.y));
    const innerRing = insetLoop && width >= 8 && height >= 7
      && (cell.x === minX + 2 || cell.x === maxX - 2 || cell.y === minY + 2 || cell.y === maxY - 2);
    return boundary || axial || innerRing;
  });
}

/** Surface sequence used by every staged park renderer. */
export function greenAreaSurfaceRole(
  footprint: Cell[],
  cell: Cell,
  stage: GreenAreaDevelopmentStage,
  assetKey = "urban-park",
): GreenAreaSurfaceRole {
  if (stage === 1) return "EARTH";
  const occupied = new Set(footprint.map(cellKey));
  const boundary = [
    { x: cell.x, y: cell.y - 1 }, { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 }, { x: cell.x - 1, y: cell.y },
  ].some((neighbor) => !occupied.has(cellKey(neighbor)));
  if (boundary) return "BOUNDARY";
  if (greenAreaPathCells(footprint, assetKey).some((path) => path.x === cell.x && path.y === cell.y)) return "PATH";
  return stage === 2 ? "EARTH" : "MEADOW";
}

/** Earliest stage at which a composed park prop becomes visible. */
export function greenAreaDecorStage(assetKey: string): GreenAreaDevelopmentStage {
  if (/tree-|streetlamp|flower|shrub/.test(assetKey)) return 3;
  if (/bench|trash-bin|picnic|topiary|playground/.test(assetKey)) return 4;
  return 5;
}
