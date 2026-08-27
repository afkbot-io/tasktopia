export type ConstructionTileKey =
  | "construction-earth-a"
  | "construction-earth-b"
  | "construction-earth-c"
  | "construction-earth-d"
  | "construction-foundation"
  | "construction-foundation-alt"
  | "construction-foundation-edge"
  | "construction-rebar"
  | "construction-survey-marker"
  | "construction-fence"
  | "construction-fence-post"
  | "construction-gate";

export type ConstructionDetailKey =
  | "construction-plan-survey-tripod"
  | "construction-plan-blueprint-table"
  | "construction-plan-string-grid"
  | "construction-plan-tool-crate"
  | "construction-plan-safety-board"
  | "construction-plan-generator"
  | "construction-plan-pipe-stack"
  | "construction-plan-sand-pile"
  | "construction-plan-excavator"
  | "construction-plan-site-office"
  | "construction-build-tower-crane"
  | "construction-build-tower-crane-alt"
  | "construction-build-mobile-crane"
  | "construction-build-dump-truck"
  | "construction-build-scaffolding-rack"
  | "construction-build-brick-pallet"
  | "construction-build-box-pallet"
  | "construction-build-concrete-mixer"
  | "construction-build-workbench"
  | "construction-build-steel-beams"
  | "construction-build-cement-bags"
  | "construction-build-rebar-cage"
  | "construction-build-wheelbarrow";

export type ConstructionDetailSpec = {
  key: ConstructionDetailKey;
  stage: 1 | 2;
  footprint: { width: number; height: number };
  canvas: { width: number; height: number };
  zone: "ANY" | "EDGE" | "REAR" | "FRONT_SIDE";
  minSiteArea: number;
  group?: "CRANE" | "VEHICLE" | "SITE_FACILITY" | "MATERIAL" | "WORK";
};

export const CONSTRUCTION_DETAIL_SPECS: ConstructionDetailSpec[] = [
  { key: "construction-plan-survey-tripod", stage: 1, footprint: { width: 1, height: 1 }, canvas: { width: 16, height: 24 }, zone: "ANY", minSiteArea: 8 },
  { key: "construction-plan-blueprint-table", stage: 1, footprint: { width: 2, height: 1 }, canvas: { width: 24, height: 16 }, zone: "FRONT_SIDE", minSiteArea: 16 },
  { key: "construction-plan-string-grid", stage: 1, footprint: { width: 2, height: 1 }, canvas: { width: 24, height: 16 }, zone: "ANY", minSiteArea: 16 },
  { key: "construction-plan-tool-crate", stage: 1, footprint: { width: 1, height: 1 }, canvas: { width: 16, height: 16 }, zone: "FRONT_SIDE", minSiteArea: 8 },
  { key: "construction-plan-safety-board", stage: 1, footprint: { width: 1, height: 1 }, canvas: { width: 16, height: 24 }, zone: "FRONT_SIDE", minSiteArea: 8 },
  { key: "construction-plan-generator", stage: 1, footprint: { width: 2, height: 1 }, canvas: { width: 24, height: 16 }, zone: "EDGE", minSiteArea: 18 },
  { key: "construction-plan-pipe-stack", stage: 1, footprint: { width: 2, height: 1 }, canvas: { width: 24, height: 16 }, zone: "EDGE", minSiteArea: 18 },
  { key: "construction-plan-sand-pile", stage: 1, footprint: { width: 2, height: 1 }, canvas: { width: 24, height: 16 }, zone: "REAR", minSiteArea: 18 },
  { key: "construction-plan-excavator", stage: 1, footprint: { width: 6, height: 3 }, canvas: { width: 48, height: 32 }, zone: "REAR", minSiteArea: 70, group: "VEHICLE" },
  { key: "construction-plan-site-office", stage: 1, footprint: { width: 5, height: 3 }, canvas: { width: 48, height: 32 }, zone: "EDGE", minSiteArea: 60, group: "SITE_FACILITY" },
  { key: "construction-build-tower-crane", stage: 2, footprint: { width: 6, height: 4 }, canvas: { width: 80, height: 96 }, zone: "REAR", minSiteArea: 70, group: "CRANE" },
  { key: "construction-build-tower-crane-alt", stage: 2, footprint: { width: 5, height: 4 }, canvas: { width: 72, height: 88 }, zone: "REAR", minSiteArea: 70, group: "CRANE" },
  { key: "construction-build-mobile-crane", stage: 2, footprint: { width: 6, height: 3 }, canvas: { width: 48, height: 24 }, zone: "REAR", minSiteArea: 70, group: "VEHICLE" },
  { key: "construction-build-dump-truck", stage: 2, footprint: { width: 5, height: 3 }, canvas: { width: 40, height: 24 }, zone: "REAR", minSiteArea: 60, group: "VEHICLE" },
  { key: "construction-build-scaffolding-rack", stage: 2, footprint: { width: 4, height: 3 }, canvas: { width: 32, height: 32 }, zone: "EDGE", minSiteArea: 48, group: "SITE_FACILITY" },
  { key: "construction-build-brick-pallet", stage: 2, footprint: { width: 1, height: 1 }, canvas: { width: 16, height: 16 }, zone: "EDGE", minSiteArea: 8 },
  { key: "construction-build-box-pallet", stage: 2, footprint: { width: 1, height: 1 }, canvas: { width: 16, height: 16 }, zone: "EDGE", minSiteArea: 8 },
  { key: "construction-build-concrete-mixer", stage: 2, footprint: { width: 2, height: 1 }, canvas: { width: 24, height: 16 }, zone: "FRONT_SIDE", minSiteArea: 18 },
  { key: "construction-build-workbench", stage: 2, footprint: { width: 2, height: 1 }, canvas: { width: 24, height: 16 }, zone: "FRONT_SIDE", minSiteArea: 18 },
  { key: "construction-build-steel-beams", stage: 2, footprint: { width: 2, height: 1 }, canvas: { width: 24, height: 16 }, zone: "EDGE", minSiteArea: 18 },
  { key: "construction-build-cement-bags", stage: 2, footprint: { width: 1, height: 1 }, canvas: { width: 16, height: 16 }, zone: "EDGE", minSiteArea: 8 },
  { key: "construction-build-rebar-cage", stage: 2, footprint: { width: 1, height: 1 }, canvas: { width: 16, height: 24 }, zone: "ANY", minSiteArea: 8 },
  { key: "construction-build-wheelbarrow", stage: 2, footprint: { width: 1, height: 1 }, canvas: { width: 16, height: 16 }, zone: "FRONT_SIDE", minSiteArea: 8 },
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
  /** North-west cell of the logical footprint inside the projected pad. */
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

/**
 * The visible roof/foundation plane is deliberately shallower than the full
 * collision footprint.  Tall buildings use five cells, while compact houses
 * keep a three- or four-cell pad.  This is the single source of truth for the
 * runtime, storybook and verifier previews.
 */
export function constructionPadDepth(footprint: { width: number; height: number }): number {
  return clamp(Math.ceil(footprint.height * 0.42), 3, 5);
}

function deterministicVariant(x: number, y: number, seed: number): 0 | 1 | 2 | 3 {
  let value = Math.imul(x + 17, 73_856_093) ^ Math.imul(y - 31, 19_349_663) ^ Math.imul(seed + 7, 83_492_791);
  value ^= value >>> 13;
  return (value & 3) as 0 | 1 | 2 | 3;
}

function seededGenerator(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function detailPositions(
  spec: ConstructionDetailSpec,
  width: number,
  depth: number,
  random: () => number,
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  for (let y = -depth; y <= -spec.footprint.height; y += 1) {
    for (let x = 0; x <= width - spec.footprint.width; x += 1) {
      const atEdge = x === 0
        || x + spec.footprint.width === width
        || y === -depth
        || y + spec.footprint.height === 0;
      // Rear-zone equipment is anchored to the back edge. Requiring its whole
      // footprint to stay in the rear half made real tower cranes impossible
      // on the intentionally shallow 3–5-cell projected pad.
      const atRear = y === -depth;
      const atFront = y + spec.footprint.height === 0;
      if (spec.zone === "EDGE" && !atEdge) continue;
      if (spec.zone === "REAR" && !atRear) continue;
      if (spec.zone === "FRONT_SIDE" && !atFront) continue;
      positions.push({ x, y });
    }
  }
  return shuffled(positions, random);
}

function constructionDetails(
  width: number,
  depth: number,
  entranceOffset: number,
  stage: 1 | 2,
  seed: number,
): ConstructionDetailPlacement[] {
  const area = width * depth;
  const gateStart = clamp(entranceOffset - 1, 0, Math.max(0, width - 2));
  const access = new Set<string>();
  for (const x of [gateStart, Math.min(width - 1, gateStart + 1)]) {
    for (let y = -Math.min(2, depth); y < 0; y += 1) access.add(`${x},${y}`);
  }
  const occupied = new Set(access);
  const random = seededGenerator(
    Math.imul(seed + 101, 2_654_435_761)
      ^ Math.imul(width + stage * 17, 1_597_334_677)
      ^ Math.imul(depth + 31, 381_201_581),
  );
  const eligible = CONSTRUCTION_DETAIL_SPECS.filter((spec) =>
    spec.stage === stage
      && spec.minSiteArea <= area
      && spec.footprint.width <= width
      && spec.footprint.height <= depth,
  );
  const large = shuffled(
    eligible.filter((spec) => spec.footprint.width * spec.footprint.height >= 4),
    random,
  );
  const firstLarge = large[0];
  const remaining = shuffled(eligible.filter((spec) => spec !== firstLarge), random);
  const ordered = firstLarge ? [firstLarge, ...remaining] : remaining;
  const targetCount = clamp(Math.ceil(area / 18) + 1, 2, 7);
  const targetCoverage = clamp(Math.round(area * 0.18), 3, 16);
  const details: ConstructionDetailPlacement[] = [];
  const exclusiveGroups = new Set<ConstructionDetailSpec["group"]>();
  let coverage = 0;

  for (const spec of ordered) {
    if (details.length >= targetCount && coverage >= targetCoverage) break;
    if ((spec.group === "CRANE" || spec.group === "VEHICLE") && exclusiveGroups.has(spec.group)) continue;
    for (const position of detailPositions(spec, width, depth, random)) {
      const cells: string[] = [];
      for (let y = position.y; y < position.y + spec.footprint.height; y += 1) {
        for (let x = position.x; x < position.x + spec.footprint.width; x += 1) cells.push(`${x},${y}`);
      }
      if (cells.some((cell) => occupied.has(cell))) continue;
      details.push({ key: spec.key, ...position });
      if (spec.group === "CRANE" || spec.group === "VEHICLE") exclusiveGroups.add(spec.group);
      for (const cell of cells) occupied.add(cell);
      coverage += cells.length;
      break;
    }
  }

  return details.sort((left, right) => {
    const leftSpec = CONSTRUCTION_DETAIL_SPEC_BY_KEY[left.key];
    const rightSpec = CONSTRUCTION_DETAIL_SPEC_BY_KEY[right.key];
    const leftBaseline = left.y + leftSpec.footprint.height;
    const rightBaseline = right.y + rightSpec.footprint.height;
    return leftBaseline - rightBaseline || left.x - right.x;
  });
}

function fenceTiles(width: number, depth: number, entranceOffset: number) {
  const rear: ConstructionTile[] = [];
  const front: ConstructionTile[] = [];
  const top = -depth - 1;
  const bottom = 0;
  const left = -1;
  const right = width;
  const gateStart = clamp(entranceOffset - 1, 0, Math.max(0, width - 2));
  const gateEnd = Math.min(width - 1, gateStart + 1);

  for (let x = left; x <= right; x += 1) {
    rear.push({ key: "construction-fence", x, y: top });
    if (x < 0 || x >= width || x < gateStart || x > gateEnd) {
      front.push({ key: "construction-fence", x, y: bottom });
    }
  }
  front.push({ key: "construction-gate", x: gateStart, y: bottom });
  front.push({ key: "construction-gate", x: gateEnd, y: bottom, quarterTurns: 2 });

  for (let y = top + 1; y < bottom; y += 1) {
    rear.push({ key: "construction-fence", x: left, y, quarterTurns: 1 });
    rear.push({ key: "construction-fence", x: right, y, quarterTurns: 1 });
  }
  for (const [x, y] of [[left, top], [right, top], [left, bottom], [right, bottom]] as const) {
    const target = y === bottom ? front : rear;
    target.push({ key: "construction-fence-post", x, y });
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
  const details = stage === 1 || stage === 2
    ? constructionDetails(width, depth, entranceOffset, stage, seed)
    : [];

  if (stage === 1 || stage === 2) {
    for (let y = -depth; y < 0; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (stage === 1) {
          const earthKeys = ["construction-earth-a", "construction-earth-b", "construction-earth-c", "construction-earth-d"] as const;
          site.push({ key: earthKeys[deterministicVariant(x, y, seed)], x, y });
        } else {
          site.push({ key: deterministicVariant(x, y, seed) < 2 ? "construction-foundation" : "construction-foundation-alt", x, y });
          if (y === -depth) site.push({ key: "construction-foundation-edge", x, y });
          if (y === -1) site.push({ key: "construction-foundation-edge", x, y, quarterTurns: 2 });
          if (x === 0) site.push({ key: "construction-foundation-edge", x, y, quarterTurns: 3 });
          if (x === width - 1) site.push({ key: "construction-foundation-edge", x, y, quarterTurns: 1 });
          if ((x === 0 || x === width - 1 || x % 4 === 0) && (y === -depth || y === -1)) {
            site.push({ key: "construction-rebar", x, y });
          }
        }
      }
    }
    if (stage === 1) {
      for (const [x, y] of [[0, -depth], [width - 1, -depth], [0, -1], [width - 1, -1]] as const) {
        site.push({ key: "construction-survey-marker", x, y });
      }
    }
  }

  const fence = stage < 5 ? fenceTiles(width, depth, entranceOffset) : { rear: [], front: [] };
  return { padDepth: depth, site, details, rearFence: fence.rear, frontFence: fence.front };
}

export const CONSTRUCTION_TILE_KEYS: ConstructionTileKey[] = [
  "construction-earth-a",
  "construction-earth-b",
  "construction-earth-c",
  "construction-earth-d",
  "construction-foundation",
  "construction-foundation-alt",
  "construction-foundation-edge",
  "construction-rebar",
  "construction-survey-marker",
  "construction-fence",
  "construction-fence-post",
  "construction-gate",
];
