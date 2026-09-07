/** Shared 8px kit for the compact 5–6-cell city family. */
export const CONSTRUCTION_TILE_KEYS = [
  "compact-construction-foundation-a",
  "compact-construction-foundation-b",
  "compact-construction-foundation-c",
  "compact-construction-fence",
  "compact-construction-fence-corner",
  "compact-construction-fence-post",
  "compact-construction-gate",
] as const;
export type ConstructionTileKey = typeof CONSTRUCTION_TILE_KEYS[number];
export type ConstructionDetailKey =
  | "compact-construction-crane"
  | "compact-construction-hut"
  | "compact-construction-bricks"
  | "compact-construction-sand";

export type ConstructionDetailSpec = {
  key: ConstructionDetailKey;
  stage: 2;
  footprint: { width: number; height: number };
  canvas: { width: number; height: number };
  group: "CRANE" | "SITE_FACILITY" | "MATERIAL";
};

export const CONSTRUCTION_DETAIL_SPECS: ConstructionDetailSpec[] = [
  { key: "compact-construction-crane", stage: 2, footprint: { width: 2, height: 2 }, canvas: { width: 16, height: 24 }, group: "CRANE" },
  { key: "compact-construction-hut", stage: 2, footprint: { width: 2, height: 1 }, canvas: { width: 16, height: 8 }, group: "SITE_FACILITY" },
  { key: "compact-construction-bricks", stage: 2, footprint: { width: 1, height: 1 }, canvas: { width: 8, height: 8 }, group: "MATERIAL" },
  { key: "compact-construction-sand", stage: 2, footprint: { width: 1, height: 1 }, canvas: { width: 8, height: 8 }, group: "MATERIAL" },
];

export const CONSTRUCTION_DETAIL_SPEC_BY_KEY = Object.fromEntries(
  CONSTRUCTION_DETAIL_SPECS.map((spec) => [spec.key, spec]),
) as Record<ConstructionDetailKey, ConstructionDetailSpec>;

export type ConstructionTile = {
  key: ConstructionTileKey;
  x: number;
  y: number;
  quarterTurns?: 0 | 1 | 2 | 3;
};

export type ConstructionDetailPlacement = {
  key: ConstructionDetailKey;
  /** North-west cell of the physical prop footprint, relative to the south-west site corner. */
  x: number;
  y: number;
};

export type ConstructionStageLayout = {
  padDepth: number;
  site: ConstructionTile[];
  details: ConstructionDetailPlacement[];
  rearFence: ConstructionTile[];
  frontFence: ConstructionTile[];
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The temporary site matches the full physical building rectangle on every stage. */
export function constructionPadDepth(footprint: { width: number; height: number }): number {
  return Math.max(1, Math.round(footprint.height));
}

function variant(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 17, 73_856_093) ^ Math.imul(y - 31, 19_349_663) ^ Math.imul(seed + 7, 83_492_791);
  value ^= value >>> 13;
  return value >>> 0;
}

function gateBounds(width: number, entranceOffset: number) {
  const start = clamp(entranceOffset - 1, 0, Math.max(0, width - 2));
  return { start, end: Math.min(width - 1, start + 1) };
}

/** Reserve the whole sprite canvas, so a crane jib cannot overhang the fence or hut. */
function constructionDetails(width: number, depth: number, entranceOffset: number, seed: number): ConstructionDetailPlacement[] {
  const gate = gateBounds(width, entranceOffset);
  const occupied = new Set<string>();
  for (let x = gate.start; x <= gate.end; x += 1) {
    for (let y = -Math.min(2, depth); y < 0; y += 1) occupied.add(`${x},${y}`);
  }
  const details: ConstructionDetailPlacement[] = [];
  for (const [index, spec] of CONSTRUCTION_DETAIL_SPECS.entries()) {
    const visualWidth = spec.canvas.width / 8;
    const visualDepth = spec.canvas.height / 8;
    const positions: Array<{ x: number; y: number; score: number }> = [];
    for (let y = -depth; y <= -visualDepth; y += 1) {
      for (let x = 0; x <= width - visualWidth; x += 1) {
        // Keep crane mass at the rear, leaving the south site entrance readable.
        if (spec.group === "CRANE" && y !== -depth) continue;
        positions.push({ x, y, score: variant(x, y, seed + index * 31) });
      }
    }
    positions.sort((left, right) => left.score - right.score || left.y - right.y || left.x - right.x);
    for (const position of positions) {
      const cells: string[] = [];
      for (let y = position.y; y < position.y + visualDepth; y += 1) {
        for (let x = position.x; x < position.x + visualWidth; x += 1) cells.push(`${x},${y}`);
      }
      if (cells.some((cell) => occupied.has(cell))) continue;
      details.push({
        key: spec.key,
        x: position.x + (visualWidth - spec.footprint.width) / 2,
        y: position.y + visualDepth - spec.footprint.height,
      });
      for (const cell of cells) occupied.add(cell);
      break;
    }
  }
  return details.sort((left, right) =>
    left.y + CONSTRUCTION_DETAIL_SPEC_BY_KEY[left.key].footprint.height
      - right.y - CONSTRUCTION_DETAIL_SPEC_BY_KEY[right.key].footprint.height || left.x - right.x,
  );
}

function fenceTiles(width: number, depth: number, entranceOffset: number) {
  const rear: ConstructionTile[] = [];
  const front: ConstructionTile[] = [];
  const top = -depth - 1;
  const gate = gateBounds(width, entranceOffset);
  for (let x = 0; x < width; x += 1) {
    rear.push({ key: "compact-construction-fence", x, y: top });
    if (x < gate.start || x > gate.end) front.push({ key: "compact-construction-fence", x, y: 0 });
  }
  front.push({ key: "compact-construction-gate", x: gate.start, y: 0 });
  if (gate.end !== gate.start) front.push({ key: "compact-construction-gate", x: gate.end, y: 0, quarterTurns: 2 });
  for (let y = top + 1; y < 0; y += 1) {
    rear.push({ key: "compact-construction-fence", x: -1, y, quarterTurns: 1 });
    rear.push({ key: "compact-construction-fence", x: width, y, quarterTurns: 1 });
  }
  for (const [x, y, quarterTurns] of [[-1, top, 0], [width, top, 1], [-1, 0, 3], [width, 0, 2]] as const) {
    (y === 0 ? front : rear).push({ key: "compact-construction-fence-corner", x, y, quarterTurns });
    (y === 0 ? front : rear).push({ key: "compact-construction-fence-post", x, y });
  }
  return { rear, front };
}

/** Local cell coordinates use the building's south-west corner as (0, 0). */
export function constructionStageLayout(
  footprint: { width: number; height: number },
  entranceOffset: number,
  stage: number,
  seed = 0,
): ConstructionStageLayout {
  const width = Math.max(1, Math.round(footprint.width));
  const depth = constructionPadDepth(footprint);
  const site: ConstructionTile[] = [];
  if (stage === 2) {
    const foundation = CONSTRUCTION_TILE_KEYS.slice(0, 3);
    for (let y = -depth; y < 0; y += 1) {
      for (let x = 0; x < width; x += 1) site.push({ key: foundation[variant(x, y, seed) % 3]!, x, y });
    }
  }
  const fence = stage >= 1 && stage <= 4 ? fenceTiles(width, depth, entranceOffset) : { rear: [], front: [] };
  return {
    padDepth: depth,
    site,
    details: stage === 2 ? constructionDetails(width, depth, entranceOffset, seed) : [],
    rearFence: fence.rear,
    frontFence: fence.front,
  };
}
