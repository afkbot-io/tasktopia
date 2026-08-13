import type { Cell } from "./contracts";

export type TaskParkDecorPlacement = { kind: string; origin: Cell; width: number; height: number };

const PROP_FOOTPRINTS: Readonly<Record<string, readonly [number, number]>> = {
  "tree-oak": [1, 1], "tree-maple": [1, 1], "tree-cherry": [1, 1], "tree-magnolia": [1, 1],
  "flower-white": [1, 1], "flower-yellow": [1, 1], "flower-pink": [1, 1], "shrub-flowering": [1, 1],
  "bench-horizontal": [2, 1], "bench-vertical": [1, 2], "park-lamp": [1, 1], "trash-bin": [1, 1],
  "fountain-large": [4, 4], "playground-small": [3, 2], "park-bandstand": [4, 3],
  "park-flower-clock": [3, 2], "playground-carousel": [3, 3], gazebo: [4, 3],
};

const CENTERPIECE: Readonly<Record<string, string>> = {
  "urban-formal": "fountain-large",
  "urban-community": "park-bandstand",
  "urban-central": "park-flower-clock",
  "urban-botanical": "gazebo",
  "urban-amusement": "playground-carousel",
  "urban-park": "playground-small",
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
  const occupied = new Set<string>();
  const result: TaskParkDecorPlacement[] = [];
  const place = (kind: string, origin: Cell): boolean => {
    const [propWidth, propHeight] = PROP_FOOTPRINTS[kind] ?? [1, 1];
    if (origin.x < bounds.minX + 1 || origin.y < bounds.minY + 1
      || origin.x + propWidth - 1 > bounds.maxX - 1 || origin.y + propHeight - 1 > bounds.maxY - 1) return false;
    const cells = Array.from({ length: propWidth * propHeight }, (_, index) => ({
      x: origin.x + index % propWidth, y: origin.y + Math.floor(index / propWidth),
    }));
    if (cells.some((cell) => occupied.has(key(cell)))) return false;
    cells.forEach((cell) => occupied.add(key(cell)));
    result.push({ kind, origin, width: propWidth, height: propHeight });
    return true;
  };

  if (stage >= 5) {
    const kind = CENTERPIECE[assetKey] ?? CENTERPIECE["urban-park"]!;
    const [propWidth, propHeight] = PROP_FOOTPRINTS[kind]!;
    place(kind, {
      x: bounds.minX + Math.floor((width - propWidth) / 2),
      y: bounds.minY + Math.floor((height - propHeight) / 2),
    });
  }

  const corners = [
    { x: bounds.minX + 1, y: bounds.minY + 1 }, { x: bounds.maxX - 1, y: bounds.minY + 1 },
    { x: bounds.minX + 1, y: bounds.maxY - 1 }, { x: bounds.maxX - 1, y: bounds.maxY - 1 },
  ].sort((left, right) => hash(seed, left.x, left.y, 31) - hash(seed, right.x, right.y, 31));
  const trees = ["tree-oak", "tree-maple", "tree-cherry", "tree-magnolia"];
  corners.slice(0, Math.min(4, Math.max(2, Math.floor(footprint.length / 36)))).forEach((origin, index) => {
    place(trees[Math.floor(hash(seed, origin.x, origin.y, 37 + index) * trees.length)]!, origin);
  });
  const flowerOrigins = [
    { x: bounds.minX + 2, y: bounds.minY + 1 }, { x: bounds.maxX - 2, y: bounds.maxY - 1 },
    { x: bounds.maxX - 1, y: bounds.minY + 2 }, { x: bounds.minX + 1, y: bounds.maxY - 2 },
  ];
  const flowers = ["flower-white", "flower-yellow", "flower-pink", "shrub-flowering"];
  flowerOrigins.slice(0, Math.min(4, Math.max(2, Math.floor(footprint.length / 40)))).forEach((origin, index) => {
    place(flowers[Math.floor(hash(seed, origin.x, origin.y, 43 + index) * flowers.length)]!, origin);
  });

  if (stage >= 4) {
    place("bench-horizontal", { x: bounds.minX + Math.max(1, Math.floor(width / 4)), y: bounds.minY + 1 });
    place("bench-horizontal", { x: bounds.maxX - Math.max(2, Math.floor(width / 4)) - 1, y: bounds.maxY - 1 });
    place("park-lamp", { x: bounds.minX + 1, y: bounds.minY + Math.floor(height / 2) });
    place("park-lamp", { x: bounds.maxX - 1, y: bounds.minY + Math.floor(height / 2) });
    place("trash-bin", { x: bounds.minX + Math.floor(width / 2) - 1, y: bounds.maxY - 1 });
  }
  return result;
}
