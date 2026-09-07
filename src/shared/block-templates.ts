import { BLOCK_SERVICE_ROLES, type BlockServiceRole, type BlockSlotKind, type BlockWorldBounds, type CityBlockV1 } from "./block-world";
import { COMPACT_BUILDING_SHAPES, STRUCTURAL_BUILDING_FAMILIES, STRUCTURAL_BUILDING_FAMILIES_V2, compactFamilyMatchesFootprint, type CompactBuildingFamily } from "./compact-building-families";
import { buildingShapeFitsBlock, packBuildingParcels, readBlockSitePlan, type BlockSitePlan, type PackingCorner, type ParcelShape } from "./block-parcel-plan";
export { COMPACT_BUILDING_SHAPES, type CompactBuildingFamily } from "./compact-building-families";

export const BLOCK_MODULE_CELLS = 8;
export const BLOCK_TEMPLATE_VERSION = 3;

export type BlockTemplate = { key: string; widthModules: number; heightModules: number; kind: BlockSlotKind };
export const BLOCK_TEMPLATES: readonly BlockTemplate[] = [
  { key: "residential-court", widthModules: 4, heightModules: 4, kind: "BUILDING" },
  { key: "residential-row", widthModules: 4, heightModules: 3, kind: "BUILDING" },
  { key: "residential-pair", widthModules: 3, heightModules: 4, kind: "BUILDING" },
  { key: "residential-square", widthModules: 3, heightModules: 3, kind: "BUILDING" },
  { key: "residential-strip", widthModules: 3, heightModules: 2, kind: "BUILDING" },
  { key: "residential-tower", widthModules: 2, heightModules: 3, kind: "BUILDING" },
  { key: "residential-single", widthModules: 2, heightModules: 2, kind: "BUILDING" },
  { key: "park-court", widthModules: 3, heightModules: 2, kind: "PARK" },
  { key: "park-grand", widthModules: 3, heightModules: 3, kind: "PARK" },
  { key: "water-garden", widthModules: 2, heightModules: 2, kind: "WATER" },
  { key: "parking-court", widthModules: 2, heightModules: 2, kind: "PARKING" },
];
export function blockTemplate(key: string): BlockTemplate {
  const template = BLOCK_TEMPLATES.find(candidate => candidate.key === key);
  if (!template) throw new Error(`Unknown block template: ${key}`);
  return template;
}

/** Preferred shape first, then existing fallback order; never rotate a building to fit. */
export function buildingBlockCandidates(sequence: number, shape?: Pick<ParcelShape, "width" | "height">): BlockTemplate[] {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid block sequence");
  const templates = BLOCK_TEMPLATES.filter(template => template.kind === "BUILDING");
  const preferred = templates[sequence % templates.length]!;
  return [preferred, ...templates.filter(template => template !== preferred)]
    .filter(template => !shape || buildingShapeFitsBlock(template.widthModules * BLOCK_MODULE_CELLS,
      template.heightModules * BLOCK_MODULE_CELLS, shape));
}

export type BlockSlot = {
  key: string; sequence: number; kind: BlockSlotKind;
  buildingFamily?: string; serviceRole?: BlockServiceRole;
  siteBounds: BlockWorldBounds; footprintBounds: BlockWorldBounds;
  origin: { x: number; y: number }; footprint: Array<{ x: number; y: number }>;
  entrance: { x: number; y: number }; accessPath: Array<{ x: number; y: number }>;
};

function choice(seed: number, column: number, row: number): number {
  let value = (seed + Math.imul(column + 1, 0x9e3779b1) + Math.imul(row + 1, 0x85ebca6b)) | 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  return (value ^ value >>> 15) >>> 0;
}

/** Shortest gated entrance route through free aisles to any exterior sidewalk. */
function connectSidewalks(slots: BlockSlot[], block: CityBlockV1): BlockSlot[] {
  const stride = block.width + 1; const size = stride * (block.height + 1);
  const blocked = new Uint16Array(size);
  for (const [i, slot] of slots.entries()) for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++) {
    for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++) blocked[(y - block.origin.y) * stride + x - block.origin.x] = i + 1;
  }
  for (const [i, slot] of slots.entries()) {
    const start = (slot.entrance.y + 1 - block.origin.y) * stride + slot.entrance.x - block.origin.x;
    if (blocked[start] && blocked[start] !== i + 1) throw new Error(`Blocked planned entrance ${block.id}/${slot.key}`);
    const previous = new Int32Array(size).fill(-2); previous[start] = -1;
    const queue = new Uint16Array(size); queue[0] = start;
    let head = 0; let tail = 1; let target = -1;
    while (head < tail) {
      const cell = queue[head++]!; const x = cell % stride; const y = Math.floor(cell / stride);
      if (x === 2 || y === 2 || x === block.width - 2 || y === block.height - 2) { target = cell; break; }
      for (const [nx, ny] of [[x, y + 1], [x - 1, y], [x + 1, y], [x, y - 1]]) {
        if (nx! < 2 || ny! < 2 || nx! > block.width - 2 || ny! > block.height - 2) continue;
        const next = ny! * stride + nx!;
        if (blocked[next] || previous[next] !== -2) continue;
        previous[next] = cell; queue[tail++] = next;
      }
    }
    if (target < 0) throw new Error(`Unreachable planned entrance ${block.id}/${slot.key}`);
    const path: Array<{ x: number; y: number }> = [];
    for (let cell = target; cell !== -1; cell = previous[cell]!) {
      path.push({ x: block.origin.x + cell % stride, y: block.origin.y + Math.floor(cell / stride) });
    }
    slot.accessPath = path.reverse();
  }
  return slots;
}

const approvedShapes = STRUCTURAL_BUILDING_FAMILIES.map(family => ({ family, ...COMPACT_BUILDING_SHAPES[family] }));

/** Read a durable parcel plan, or the immutable v2 column plan of an older block. */
export function blockSlots(block: CityBlockV1): BlockSlot[] {
  return materializeSlots(block, false);
}

/** Only for a newly created block, before task/role/variant assignment. */
export function createBlockSitePlan(block: CityBlockV1): BlockSitePlan {
  if (block.parameters.sitePlan !== undefined || block.parameters.slotFamilies || block.parameters.slotKinds || block.parameters.slotRoles) {
    throw new Error(`Cannot replan a reserved block ${block.id}`);
  }
  const template = blockTemplate(block.templateKey);
  const initial: BlockSitePlan = { version: 1, parcels: template.kind === "BUILDING"
    ? packBuildingParcels({ width: block.width, height: block.height, seed: block.seed,
      corner: (block.parameters.packingCorner ?? "NW") as PackingCorner, shapes: approvedShapes,
      firstFamily: block.parameters.firstFamily as string | undefined })
    : [{ x: 3, y: 3, width: block.width - 7, height: block.height - 7, clearance: 1, kind: template.kind }] };
  const slots = materializeSlots({ ...block, templateVersion: BLOCK_TEMPLATE_VERSION, parameters: { ...block.parameters, sitePlan: initial } }, true);
  const plan: BlockSitePlan = { version: 1, parcels: slots.map(slot => ({
    x: slot.siteBounds.minX - block.origin.x, y: slot.siteBounds.minY - block.origin.y,
    width: slot.footprintBounds.maxX - slot.footprintBounds.minX + 1,
    height: slot.footprintBounds.maxY - slot.footprintBounds.minY + 1,
    clearance: slot.origin.x - slot.siteBounds.minX as 0 | 1,
    kind: slot.kind, ...(slot.buildingFamily ? { family: slot.buildingFamily } : {}),
  })) };
  return readBlockSitePlan(plan, block.width, block.height, approvedShapes);
}

function materializeSlots(block: CityBlockV1, fillNewPlan: boolean): BlockSlot[] {
  const template = blockTemplate(block.templateKey);
  if (![2, BLOCK_TEMPLATE_VERSION].includes(block.templateVersion) || block.width !== template.widthModules * BLOCK_MODULE_CELLS
    || block.height !== template.heightModules * BLOCK_MODULE_CELLS) throw new Error(`Invalid block ${block.id}`);
  if ((block.templateVersion === BLOCK_TEMPLATE_VERSION) !== (block.parameters.sitePlan !== undefined)) {
    throw new Error(`Invalid site plan version in ${block.id}`);
  }
  const slots: BlockSlot[] = [];
  const firstFamily = block.parameters.firstFamily as CompactBuildingFamily | undefined;
  if (firstFamily && (!Object.hasOwn(COMPACT_BUILDING_SHAPES, firstFamily) || template.kind !== "BUILDING")) throw new Error(`Invalid first family ${block.id}`);
  const roles = block.parameters.slotRoles as Record<string, BlockServiceRole> | undefined;
  const aliases = block.parameters.slotFamilies as Record<string,string> | undefined;
  const storedKinds = block.parameters.slotKinds;
  if (storedKinds !== undefined && (!storedKinds || typeof storedKinds !== "object" || Array.isArray(storedKinds))) {
    throw new Error(`Invalid slot kinds in ${block.id}`);
  }
  const kinds = storedKinds as Record<string, "PARK"> | undefined;
  const usedKinds = new Set<string>();
  const usedAliases = new Set<string>();
  const corner = block.parameters.packingCorner ?? "NW";
  if (!["NW", "NE", "SW", "SE"].includes(String(corner))) throw new Error(`Invalid packing corner ${block.id}`);
  const append = (siteX: number, siteY: number, width: number, height: number, baseKind: BlockSlotKind, buildingFamily?: CompactBuildingFamily, clearance = 1, fixed = false) => {
    if (!fixed) {
      if (corner === "NE" || corner === "SE") siteX = block.width - siteX - width - 2 * clearance + 1;
      if (corner === "SW" || corner === "SE") siteY = block.height - siteY - height - 2 * clearance + 1;
    }
    const sequence = slots.length;
    const origin = { x: block.origin.x + siteX + clearance, y: block.origin.y + siteY + clearance };
    const entrance = { x: origin.x + Math.floor(width / 2), y: origin.y + height - 1 };
    const key = `slot-${sequence}`;
    const override = kinds?.[key];
    if (override !== undefined) {
      if (override !== "PARK" || baseKind !== "BUILDING") throw new Error(`Invalid slot kind ${block.id}/${key}`);
      usedKinds.add(key);
    }
    const kind = override ?? baseKind;
    const serviceRole = roles?.[key];
    if (serviceRole && (!BLOCK_SERVICE_ROLES.includes(serviceRole) || kind !== "BUILDING")) throw new Error(`Invalid service reservation ${block.id}/${key}`);
    const authoredFamily = aliases?.[key];
    if (authoredFamily) {
      if (kind !== "BUILDING" || !compactFamilyMatchesFootprint(authoredFamily,width,height)) throw new Error(`Invalid authored family footprint ${block.id}/${key}`);
      usedAliases.add(key);
    }
    slots.push({ key, sequence, kind, ...(kind === "BUILDING" && buildingFamily ? { buildingFamily: authoredFamily ?? buildingFamily } : {}), ...(serviceRole ? { serviceRole } : {}),
      siteBounds: { minX: origin.x - clearance, minY: origin.y - clearance, maxX: origin.x + width - 1 + clearance, maxY: origin.y + height - 1 + clearance },
      footprintBounds: { minX: origin.x, minY: origin.y, maxX: origin.x + width - 1, maxY: origin.y + height - 1 },
      origin, footprint: Array.from({ length: width * height }, (_, i) => ({ x: origin.x + i % width, y: origin.y + Math.floor(i / width) })),
      entrance, accessPath: [] });
  };
  const storedPlan = block.parameters.sitePlan === undefined ? undefined
    : readBlockSitePlan(block.parameters.sitePlan, block.width, block.height, approvedShapes);
  if (storedPlan) {
    for (const p of storedPlan.parcels) {
      if (template.kind !== "BUILDING" && (storedPlan.parcels.length !== 1 || p.kind !== template.kind)) {
        throw new Error(`Invalid public-space site plan ${block.id}`);
      }
      append(p.x, p.y, p.width, p.height, p.kind, p.family as CompactBuildingFamily | undefined, p.clearance, true);
    }
  } else if (template.kind !== "BUILDING") {
    if (aliases && Object.keys(aliases).length) throw new Error(`Non-building slot cannot have an authored family: ${block.id}`);
    if (kinds && Object.keys(kinds).length) throw new Error(`Non-building template cannot override slot kinds: ${block.id}`);
    append(3, 3, block.width - 7, block.height - 7, template.kind);
    return connectSidewalks(slots, block);
  } else {
    // This exact interpretation belongs to already persisted template-v2 blocks.
    const families = STRUCTURAL_BUILDING_FAMILIES_V2;
    for (let column = 0, siteX = 3; siteX + 8 <= block.width - 2; column++, siteX += 9) {
      let siteY = 3; let row = 0;
      while (block.height - 2 - siteY >= 5) {
        const remaining = block.height - 2 - siteY;
        // An actual usable residual parcel becomes a staged pocket park. Tiny
        // fragments remain landscaping, never phantom buildable task slots.
        if (row >= 2 && remaining <= 7) { append(siteX, siteY, 6, remaining - 2, "PARK"); break; }
        const offset = column === 0 && row === 0 ? firstFamily ? families.indexOf(firstFamily) : 0 : choice(block.seed, column, row) % families.length;
        const family = [...families.slice(offset), ...families.slice(0, offset)]
          .find(key => COMPACT_BUILDING_SHAPES[key].height + 2 <= remaining)!;
        const shape = COMPACT_BUILDING_SHAPES[family];
        append(siteX, siteY, shape.width, shape.height, "BUILDING", family);
        siteY += shape.height + 3; row++;
      }
    }
  }
  if (Object.keys(aliases ?? {}).some(key => !usedAliases.has(key))) throw new Error(`Unknown authored family slot in ${block.id}`);
  if (Object.keys(kinds ?? {}).some(key => !usedKinds.has(key))) throw new Error(`Unknown kind override slot in ${block.id}`);
  connectSidewalks(slots, block);
  if (template.kind === "BUILDING" && block.parameters.infill === true && (!storedPlan || fillNewPlan)) {
    // Ground-level public spaces have no external worksite envelope. Protect
    // every planned house (not only occupied houses) and its route first.
    const stride = block.width + 1;
    const reserved = new Uint8Array(stride * (block.height + 1));
    const index = (x: number, y: number) => y * stride + x;
    const protect = () => {
      for (const slot of slots) {
        for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++)
          for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++)
            reserved[index(x - block.origin.x, y - block.origin.y)] = 1;
        for (const p of slot.accessPath) reserved[index(p.x - block.origin.x, p.y - block.origin.y)] = 1;
      }
    };
    protect();
    for (let y = 3; y <= block.height - 3; y++) for (let x = 3; x <= block.width - 3; x++) {
      if (reserved[index(x, y)]) continue;
      let width = 1;
      while (x + width <= block.width - 3 && !reserved[index(x + width, y)]) width++;
      let height = 1;
      while (y + height <= block.height - 3 && Array.from({ length: width }, (_, dx) => reserved[index(x + dx, y + height)]).every(v => !v)) height++;
      // Keep a south gate corridor when the next row is already a site.
      const gateX = x + Math.floor(width / 2);
      const blockedGate = slots.some(s => block.origin.x + gateX >= s.siteBounds.minX && block.origin.x + gateX <= s.siteBounds.maxX
        && block.origin.y + y + height >= s.siteBounds.minY && block.origin.y + y + height <= s.siteBounds.maxY);
      if (blockedGate) height--;
      if (!height) { reserved[index(x, y)] = 1; continue; }
      append(x, y, width, height, "PARK", undefined, 0, true);
      connectSidewalks(slots, block);
      protect();
    }
  }
  return slots;
}
