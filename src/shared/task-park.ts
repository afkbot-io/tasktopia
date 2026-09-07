import type { Cell } from "./contracts";
import { PROP_CATALOG } from "./catalog";
import { greenAreaPathCells, isGroundPlantingStrip } from "./green-area";
import { compactTreeCover } from "./compact-tree-placement";
import { courtyardFurnitureFootprint } from "./courtyard-furniture";

export type TaskParkDecorPlacement = { kind: string; origin: Cell; width: number; height: number };

const CENTERPIECE: Readonly<Record<string, string>> = {
  "urban-formal": "compact-park-fountain",
  "urban-community": "park-bandstand",
  "urban-central": "park-flower-clock",
  "urban-botanical": "gazebo",
  "urban-amusement": "playground-carousel",
  "urban-park": "playground-small",
  "urban-large": "compact-park-fountain",
  "urban-fountain": "compact-park-fountain",
  "urban-monument": "compact-park-monument",
  "urban-memorial": "compact-park-monument",
};

function key(cell: Cell): string { return `${cell.x},${cell.y}`; }

function hash(seed: number, x: number, y: number, salt: number): number {
  let value = Math.imul((seed ^ salt) | 0, 0x45d9f3b) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return ((value ^ value >>> 16) >>> 0) / 0x1_0000_0000;
}

function boundsOf(cells: readonly Cell[]) {
  return {
    minX: Math.min(...cells.map((cell) => cell.x)), maxX: Math.max(...cells.map((cell) => cell.x)),
    minY: Math.min(...cells.map((cell) => cell.y)), maxY: Math.max(...cells.map((cell) => cell.y)),
  };
}

/**
 * Deterministic decor for a task-owned park. The task remains the only domain
 * entity; these props are a visual composition derived from its stage and
 * therefore cannot drift from the task number, status or deletion lifecycle.
 */
export function taskParkDecorLayout(
  footprint: readonly Cell[], stage: 1 | 2 | 3 | 4 | 5, assetKey: string, seed: number,
): TaskParkDecorPlacement[] {
  if (footprint.length === 0 || stage < 3) return [];
  const bounds = boundsOf(footprint);
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  if (isGroundPlantingStrip(width, height, assetKey)) return [];
  const occupied = new Set<string>();
  const allowed = new Set(footprint.map(key));
  const paths = new Set(greenAreaPathCells([...footprint], assetKey).map(key));
  const result: Array<TaskParkDecorPlacement & { from: number; staged: boolean }> = [];
  const dimensions = (kind: string): readonly [number, number] => {
    if (kind.startsWith("compact-park-")) return [2, 2];
    const courtyard = courtyardFurnitureFootprint(kind);
    if (courtyard) return [courtyard.width, courtyard.height];
    const prop = PROP_CATALOG[kind];
    if (!prop) throw new Error(`Unregistered park object: ${kind}`);
    return [prop.footprint.width, prop.footprint.height];
  };
  const place = (kind: string, origin: Cell, from: number): boolean => {
    if (result.length >= 36) return false;
    if (kind === "park-lamp" && result.some(prop => prop.kind === kind
      && Math.abs(prop.origin.x - origin.x) + Math.abs(prop.origin.y - origin.y) < 3)) return false;
    const [propWidth, propHeight] = dimensions(kind);
    const cells = Array.from({ length: propWidth * propHeight }, (_, index) => ({
      x: origin.x + index % propWidth, y: origin.y + Math.floor(index / propWidth),
    }));
    const visibleCells = kind.startsWith("tree-") ? compactTreeCover(origin) : cells;
    if (visibleCells.some(cell => !allowed.has(key(cell)) || occupied.has(key(cell))
      || assetKey !== "urban-lake" && paths.has(key(cell)))) return false;
    visibleCells.forEach((cell) => occupied.add(key(cell)));
    result.push({ kind, origin, width: propWidth, height: propHeight, from, staged: kind.startsWith("compact-park-") });
    return true;
  };

  if (assetKey === "urban-parking") return [];
  if (assetKey === "urban-lake") {
    // Furniture stays on the one-cell shoreline; no trees or fountain occupy water.
    place("bench-horizontal", { x: bounds.minX + 1, y: bounds.minY }, 4);
    place("bench-horizontal", { x: bounds.maxX - 1, y: bounds.maxY }, 5);
  } else {
    // Plan the finished layout FIRST. Earlier stages reveal this plan rather
    // than reallocating around a late fountain and teleporting planted trees.
    const search = (kind: string, from: number, targetX: number, targetY: number) => {
      const [w, h] = dimensions(kind);
      const candidates = [...footprint].sort((a, b) =>
        Math.abs(a.x + w / 2 - targetX) + Math.abs(a.y + h / 2 - targetY)
        - Math.abs(b.x + w / 2 - targetX) - Math.abs(b.y + h / 2 - targetY)
        || a.y - b.y || a.x - b.x);
      return candidates.some(origin => place(kind, origin, from));
    };
    const centerpiece = CENTERPIECE[assetKey];
    if (centerpiece) search(centerpiece, centerpiece.startsWith("compact-park-") ? 3 : 5,
      bounds.minX + width / 2, bounds.minY + height / 2);
    if (assetKey === "urban-large") {
      search("gazebo", 5, bounds.minX + width * 0.75, bounds.minY + height * 0.25);
      search("playground-small", 5, bounds.minX + width * 0.25, bounds.minY + height * 0.75);
    }
    // Furniture gets a permanent reserved location before vegetation, but is
    // revealed only after paths and planting. This keeps small lots useful.
    search("bench-horizontal", 4, bounds.minX + width * 0.25, bounds.maxY - 1);
    if (footprint.length >= 40) search("bench-horizontal", 4, bounds.minX + width * 0.75, bounds.minY + 1);
    // Reserve lighting before trees. Spread fixtures around the perimeter,
    // scaling with the site rather than leaving every large park with two.
    const lampCount = footprint.length >= 160 ? 8 : footprint.length >= 60 ? 4 : footprint.length >= 24 ? 2 : 0;
    const lampTargets = [[0.15, 0.15], [0.85, 0.85], [0.85, 0.15], [0.15, 0.85],
      [0.5, 0.15], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5]] as const;
    for (const [x, y] of lampTargets.slice(0, lampCount)) {
      search("park-lamp", 4, bounds.minX + width * x, bounds.minY + height * y);
    }
    // Reserve the finished furniture before any tree crown. It is absent on
    // construction stages, but cannot displace planting when stage5 arrives.
    if (footprint.length >= 36) search("courtyard-picnic-table", 5,
      bounds.minX + width * 0.25, bounds.minY + height * 0.25);
    if (footprint.length >= 24) search("courtyard-cycle-rack", 5,
      bounds.minX + width * 0.75, bounds.minY + height * 0.75);
    // One small lime accent, never a repeated bed or general world scatter.
    search("courtyard-square-planter", 5, bounds.minX + width * 0.75, bounds.minY + height * 0.25);
    const tree = assetKey === "urban-orchard" ? "tree-apple" : assetKey === "urban-memorial" ? "tree-cypress"
      : ["tree-oak", "tree-maple", "tree-cherry", "tree-magnolia"][Math.floor(hash(seed, 0, 0, 37) * 4)]!;
    // Try every integer anchor. A two-cell stride can miss an entire narrow
    // garden bed once its lamp is reserved; crown masks already enforce space.
    const vegetation = [...footprint]
      .sort((a, b) => hash(seed, a.x, a.y, 31) - hash(seed, b.x, b.y, 31));
    const treeLimit = Math.min(16, Math.max(2, Math.floor(footprint.length / (assetKey === "urban-orchard" ? 12 : 25))));
    let planted = 0;
    for (const cell of vegetation) {
      if (place(tree, cell, 3) && ++planted >= treeLimit) break;
    }
    // Deliberate planted beds inside task parks, not the retired world scatter.
    const flower = assetKey === "urban-memorial" ? "flower-white" : "shrub-flowering";
    search(flower, 3, bounds.minX + 1, bounds.minY + 1);
    if (footprint.length >= 36) search(flower, 5, bounds.maxX - 2, bounds.maxY - 2);
  }
  return result.filter(prop => stage >= prop.from).map(prop => ({
    origin: prop.origin, width: prop.width, height: prop.height,
    kind: prop.staged ? `${prop.kind}-stage-${stage}` : prop.kind,
  }));
}

export type ParkingPaintRect = { x: number; y: number; width: number; height: number };

/** Integer-pixel bay lines, local to the site's north-west corner; no overlay sprite. */
export function taskParkingMarkings(footprint: readonly Cell[], stage: number): ParkingPaintRect[] {
  if (stage < 4 || !footprint.length) return [];
  const bounds = boundsOf(footprint);
  const width = (bounds.maxX - bounds.minX + 1) * 8;
  const height = (bounds.maxY - bounds.minY + 1) * 8;
  if (width < 24 || height < 32) return [];
  const bays = Math.floor((width - 16) / 8);
  const count = stage === 4 ? Math.ceil(bays / 2) : bays;
  const lines: ParkingPaintRect[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = 8 + index * 8;
    lines.push({ x, y: 9, width: 1, height: Math.min(12, height - 24) });
    lines.push({ x, y: 9, width: 8, height: 1 });
  }
  if (count > 0) lines.push({ x: 8 + count * 8, y: 9, width: 1, height: Math.min(12, height - 24) });
  return lines;
}
