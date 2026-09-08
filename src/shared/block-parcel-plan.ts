import type { BlockSlotKind } from "./block-world";

/** Local site origin includes the construction envelope, not just the sprite. */
export type BlockParcel = {
  x: number; y: number; width: number; height: number; clearance: 0 | 1;
  kind: BlockSlotKind; family?: string;
};
export type BlockSitePlan = { version: 1; parcels: BlockParcel[] };
export type ParcelShape = { family: string; width: number; height: number };
export type PackingCorner = "NW" | "NE" | "SW" | "SE";

/** Three cells before the site, two after it, and its two construction margins. */
export function buildingShapeFitsBlock(width: number, height: number, shape: Pick<ParcelShape, "width" | "height">): boolean {
  return Number.isSafeInteger(shape.width) && Number.isSafeInteger(shape.height)
    && shape.width > 0 && shape.height > 0 && shape.width + 7 <= width && shape.height + 7 <= height;
}

function choice(seed: number, column: number, row: number): number {
  let value = (seed + Math.imul(column + 1, 0x9e3779b1) + Math.imul(row + 1, 0x85ebca6b)) | 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  return (value ^ value >>> 15) >>> 0;
}

/** Guillotine cuts leave a connected one-cell aisle around independent shapes.
 * The catalogue supplies approved geometry; mirroring sites never rotates art.
 */
export function packBuildingParcels(input: {
  width: number; height: number; seed: number; corner: PackingCorner;
  shapes: readonly ParcelShape[]; firstFamily?: string;
}): BlockParcel[] {
  const { width, height, seed, shapes, corner, firstFamily } = input;
  if (![width, height].every(n => Number.isInteger(n) && n >= 8 && n <= 128)
    || !Number.isSafeInteger(seed) || !["NW", "NE", "SW", "SE"].includes(corner)
    || !shapes.length || shapes.length > 128 || new Set(shapes.map(s => s.family)).size !== shapes.length
    || shapes.some(s => !s.family || ![s.width, s.height].every(n => Number.isInteger(n) && n > 0 && n <= 128))) {
    throw new Error("Invalid rectangular packing input");
  }
  const fitting = shapes.filter(s => buildingShapeFitsBlock(width, height, s));
  const first = firstFamily === undefined
    ? shapes.indexOf(fitting[choice(seed, 0, 0) % fitting.length]!)
    : shapes.findIndex(s => s.family === firstFamily);
  if (first < 0 || !buildingShapeFitsBlock(width, height, shapes[first]!)) {
    throw new Error("First building shape does not fit the block");
  }
  const parcels: BlockParcel[] = [];
  const visit = (x: number, y: number, w: number, h: number, column: number, row: number) => {
    const offset = parcels.length === 0 ? first : choice(seed, column, row) % shapes.length;
    const shape = [...shapes.slice(offset), ...shapes.slice(0, offset)].find(s => s.width + 2 <= w && s.height + 2 <= h);
    if (!shape) return;
    // A short residual strip after two houses is an actual public-space site.
    const park = row >= 2 && h <= 7 && choice(seed, column, row + 17) % 3 === 0;
    const parcel: BlockParcel = { x, y, width: shape.width, height: park ? h - 2 : shape.height,
      clearance: 1, kind: park ? "PARK" : "BUILDING", ...(!park ? { family: shape.family } : {}) };
    if (corner === "NE" || corner === "SE") parcel.x = width - x - parcel.width - 1;
    if (corner === "SW" || corner === "SE") parcel.y = height - y - parcel.height - 1;
    parcels.push(parcel);
    const siteWidth = shape.width + 2, siteHeight = parcel.height + 2;
    visit(x, y + siteHeight + 1, siteWidth, h - siteHeight - 1, column, row + 1);
    visit(x + siteWidth + 1, y, w - siteWidth - 1, h, column + 1, 0);
  };
  visit(3, 3, width - 5, height - 5, 0, 0);
  return parcels;
}

/** Fail closed before allocating footprint cells or trusting persisted geometry. */
export function readBlockSitePlan(value: unknown, width: number, height: number,
  shapes: readonly ParcelShape[]): BlockSitePlan {
  const fail = (): never => { throw new Error("Invalid stored block site plan"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const plan = value as BlockSitePlan;
  if (plan.version !== 1 || !Array.isArray(plan.parcels) || !plan.parcels.length || plan.parcels.length > width * height) return fail();
  const occupied = new Uint8Array(width * height);
  for (const p of plan.parcels) {
    if (!p || typeof p !== "object" || Array.isArray(p) || ![p.x, p.y, p.width, p.height].every(Number.isSafeInteger)
      || p.width < 1 || p.height < 1 || ![0, 1].includes(p.clearance)
      || !["BUILDING", "PARK", "WATER", "PARKING"].includes(p.kind)
      || p.x < 3 || p.y < 3 || p.x + p.width + 2 * p.clearance > width - 2
      || p.y + p.height + 2 * p.clearance > height - 2) return fail();
    if (p.kind === "BUILDING") {
      if (p.clearance !== 1 || !shapes.some(s => s.family === p.family && s.width === p.width && s.height === p.height)) return fail();
    } else if (p.family !== undefined) return fail();
    for (let y = p.y; y < p.y + p.height + 2 * p.clearance; y++)
      for (let x = p.x; x < p.x + p.width + 2 * p.clearance; x++) {
        if (occupied[y * width + x]) return fail();
        occupied[y * width + x] = 1;
      }
  }
  return plan;
}
