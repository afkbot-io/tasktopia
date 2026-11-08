import type { BlockSlotKind } from "./block-world";
import type { Rect } from './contracts';

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
  shapes: readonly ParcelShape[]; firstFamily?: string; publicReservations?: readonly Rect[];
}): BlockParcel[] {
  const { width, height, seed, shapes, corner, firstFamily } = input;
  if (![width, height].every(n => Number.isInteger(n) && n >= 8 && n <= 128)
    || !Number.isSafeInteger(seed) || !["NW", "NE", "SW", "SE"].includes(corner)
    || !shapes.length || shapes.length > 128 || new Set(shapes.map(s => s.family)).size !== shapes.length
    || shapes.some(s => !s.family || ![s.width, s.height].every(n => Number.isInteger(n) && n > 0 && n <= 128))
    || input.publicReservations && (!Array.isArray(input.publicReservations) || input.publicReservations.length>64
      || input.publicReservations.some(r => !r || ![r.minX,r.minY,r.maxX,r.maxY].every(Number.isSafeInteger)
        || r.minX<0 || r.minY<0 || r.maxX>width || r.maxY>height || r.minX>r.maxX || r.minY>r.maxY))) {
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
  if (input.publicReservations?.length) {
    // Only new blocks around frozen infrastructure use this bounded grid.
    // Unaffected blocks retain their established guillotine interpretation.
    const stride = width+1, occupied = new Uint8Array(stride*(height+1));
    const at = (x:number,y:number) => y*stride+x;
    for (const r of input.publicReservations) for (let y=Math.max(0,r.minY-1); y<=Math.min(height,r.maxY+1); y++)
      for (let x=Math.max(0,r.minX-1); x<=Math.min(width,r.maxX+1); x++) occupied[at(x,y)] = 1;
    const positions = Array.from({ length: (width-5)*(height-5) },(_,i) => ({ x: 3+i%(width-5), y: 3+Math.floor(i/(width-5)) }));
    positions.sort((a,b) => (corner==='SW'||corner==='SE' ? b.y-a.y : a.y-b.y)
      || (corner==='NE'||corner==='SE' ? b.x-a.x : a.x-b.x));
    for (const {x,y} of positions) {
      const offset = parcels.length===0 ? first : choice(seed,x,y)%shapes.length;
      const candidates = parcels.length===0 && firstFamily ? [shapes[first]!] : [...shapes.slice(offset),...shapes.slice(0,offset)];
      for (const shape of candidates) {
        const w = shape.width+2, h = shape.height+2;
        if (x+w>width-2 || y+h>height-2) continue;
        let free = true;
        for (let cy=y; cy<y+h && free; cy++) for (let cx=x; cx<x+w; cx++) if (occupied[at(cx,cy)]) { free = false;break; }
        if (!free) continue;
        parcels.push({ x,y,width:shape.width,height:shape.height,clearance:1,kind:'BUILDING',family:shape.family });
        for (let cy=y-1; cy<=y+h; cy++) for (let cx=x-1; cx<=x+w; cx++) occupied[at(cx,cy)] = 1;
        break;
      }
    }
    if (!parcels.length) throw new Error('No parcel fits around public infrastructure');
    return parcels;
  }
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
