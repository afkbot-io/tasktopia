import type { Cell, TaskStatus } from "./contracts";

export type GreenAreaDevelopmentStage = 1 | 2 | 3 | 4 | 5;
export type GreenAreaSurfaceRole = "EARTH" | "MEADOW" | "PATH" | "BOUNDARY" | "BASIN" | "WATER" | "PARKING";

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

/** Ground-only infill: a perimeter would consume the entire planting bed. */
export function isGroundPlantingStrip(width: number, height: number, assetKey: string): boolean {
  return assetKey === "urban-park" && (width <= 2 || height <= 2);
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
  if (isGroundPlantingStrip(width, height, assetKey)) {
    return footprint.length === 1 ? [] : footprint.filter(cell => cell.x === minX + Math.floor(width / 2) && cell.y === maxY);
  }
  const centerX = Math.floor((minX + maxX) / 2);
  const centerY = Math.floor((minY + maxY) / 2);
  const formal = new Set(["urban-formal", "urban-community", "urban-central"]).has(assetKey);
  const hasInteriorPaths = width >= 6 && height >= 5;
  const centerXs = new Set([centerX, ...(formal && width % 2 === 0 ? [centerX + 1] : [])]);
  const centerYs = new Set([centerY, ...(formal && height % 2 === 0 ? [centerY + 1] : [])]);
  const insetLoop = assetKey === "urban-botanical" || assetKey === "urban-amusement" || assetKey === "urban-large";
  const compact = height <= 8 && width >= 6 && width <= 8 && assetKey !== "urban-lake" && assetKey !== "urban-parking";
  return footprint.filter((cell) => {
    const boundary = [
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x - 1, y: cell.y },
    ].some((neighbor) => !occupied.has(cellKey(neighbor)));
    // Compact6×3..6×6 lots need room for a2×2 centerpiece. Perimeter+cross
    // paths consume it. Keep a south walk and a gated spine instead.
    if (compact) return cell.y === maxY || cell.x === minX + Math.floor(width / 2);
    const axial = hasInteriorPaths && (centerXs.has(cell.x) || centerYs.has(cell.y));
    const innerRing = insetLoop && width >= 8 && height >= 7
      && (cell.x === minX + 2 || cell.x === maxX - 2 || cell.y === minY + 2 || cell.y === maxY - 2);
    // Water and parking never inherit the park's cross-shaped promenade.
    if (assetKey === "urban-lake" || assetKey === "urban-parking") return boundary;
    return boundary || axial || innerRing;
  });
}

/** Resolve once per site; renderers must not rebuild membership/path sets per cell. */
export function greenAreaSurfaceLayout(
  footprint: Cell[],
  stage: GreenAreaDevelopmentStage,
  assetKey = "urban-park",
): Array<Cell & { role: GreenAreaSurfaceRole }> {
  if (footprint.length === 0) return [];
  const occupied = new Set(footprint.map(cellKey));
  const paths = new Set(greenAreaPathCells(footprint, assetKey).map(cellKey));
  const bounds = boundsOf(footprint);
  const strip = isGroundPlantingStrip(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1, assetKey);
  const boundary = (cell: Cell) => [
    { x: cell.x, y: cell.y - 1 }, { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 }, { x: cell.x - 1, y: cell.y },
  ].some((neighbor) => !occupied.has(cellKey(neighbor)));
  return footprint.map((cell) => {
    let role: GreenAreaSurfaceRole;
    if (stage === 1) role = "EARTH";
    else if (strip) {
      const index = (cell.y - bounds.minY) * (bounds.maxX - bounds.minX + 1) + cell.x - bounds.minX;
      role = paths.has(cellKey(cell)) ? "PATH"
        : stage >= 5 || stage >= 3 && index % 2 === 1 ? "MEADOW" : "EARTH";
    }
    else if (boundary(cell)) role = "BOUNDARY";
    else if (assetKey === "urban-lake") {
      role = stage <= 2 ? "EARTH" : stage >= 5 || stage === 4 && cell.x > (bounds.minX + bounds.maxX) / 2 ? "WATER" : "BASIN";
    } else if (assetKey === "urban-parking") role = stage <= 2 ? "EARTH" : "PARKING";
    else if (paths.has(cellKey(cell)) || ["urban-fountain", "urban-monument"].includes(assetKey)) role = "PATH";
    else role = stage === 2 ? "EARTH" : "MEADOW";
    return { ...cell, role };
  });
}

/** Convenience seam for a single cell; batched callers use greenAreaSurfaceLayout. */
export function greenAreaSurfaceRole(
  footprint: Cell[], cell: Cell, stage: GreenAreaDevelopmentStage, assetKey = "urban-park",
): GreenAreaSurfaceRole {
  return greenAreaSurfaceLayout(footprint, stage, assetKey).find((entry) => cellKey(entry) === cellKey(cell))?.role ?? "EARTH";
}

/** Earliest stage at which a composed park prop becomes visible. */
export function greenAreaDecorStage(assetKey: string): GreenAreaDevelopmentStage {
  if (/tree-|streetlamp|flower|shrub/.test(assetKey)) return 3;
  if (/bench|trash-bin|picnic|topiary|playground/.test(assetKey)) return 4;
  return 5;
}
