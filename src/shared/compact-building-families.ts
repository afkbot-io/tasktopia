import { BUILDING_CATALOG } from "./catalog";
import { BLOCK_SERVICE_ROLES, type BlockServiceRole } from "./block-world";

/** Approved geometry vocabulary, not the authored asset pool. Existing entries are immutable. */
export const COMPACT_BUILDING_SHAPES = Object.freeze({
  "compact-apartment-v1": Object.freeze({ width: 6, height: 6, floors: 3 }),
  "compact-row-v1": Object.freeze({ width: 6, height: 3, floors: 1 }),
  "compact-wide-v1": Object.freeze({ width: 6, height: 4, floors: 2 }),
  "compact-long-gallery-v1": Object.freeze({ width: 12, height: 6, floors: 2 }),
  "compact-corner-court-v1": Object.freeze({ width: 8, height: 8, floors: 2 }),
  "compact-u-courtyard-v1": Object.freeze({ width: 12, height: 8, floors: 2 }),
  "compact-long-slate-wing-v1": Object.freeze({ width: 6, height: 12, floors: 2 }),
});
export type CompactBuildingFamily = keyof typeof COMPACT_BUILDING_SHAPES;
export const STRUCTURAL_BUILDING_FAMILIES: readonly CompactBuildingFamily[] = Object.freeze(
  Object.keys(COMPACT_BUILDING_SHAPES) as CompactBuildingFamily[],
);
/** Never extend this list: old blocks derive their recorded geometry from its order. */
export const STRUCTURAL_BUILDING_FAMILIES_V2: readonly CompactBuildingFamily[] = Object.freeze([
  "compact-apartment-v1", "compact-row-v1", "compact-wide-v1",
]);

/** An asset is an alias only when its physical envelope and entrance match. */
export function compactBuildingShapeFamily(family: string): CompactBuildingFamily | undefined {
  const entry = BUILDING_CATALOG.find(entry => entry.key === family);
  if (!entry?.tags.includes("compact-building") || entry.entrances.length !== 1
    || entry.entrances[0]!.side !== "S" || entry.entrances[0]!.offset !== Math.floor(entry.footprint.width / 2)
    || entry.anchor.x !== entry.spriteSize.width / 2 || entry.anchor.y !== entry.spriteSize.height
    || entry.spriteSize.width !== entry.footprint.width * 8) return undefined;
  return STRUCTURAL_BUILDING_FAMILIES.find(key => {
    const shape = COMPACT_BUILDING_SHAPES[key];
    return shape.width === entry.footprint.width && shape.height === entry.footprint.height;
  });
}

export function compactFamilyMatchesFootprint(family: string, width: number, height: number): boolean {
  const key = compactBuildingShapeFamily(family);
  return Boolean(key && COMPACT_BUILDING_SHAPES[key].width === width && COMPACT_BUILDING_SHAPES[key].height === height);
}

export function compactServiceFamily(role: BlockServiceRole, width: number, height: number): string | undefined {
  return BUILDING_CATALOG.filter(entry => entry.serviceRole === role && compactFamilyMatchesFootprint(entry.key,width,height))
    .map(entry => entry.key).sort()[0];
}

/** Only used for a newly occupied slot. Persist the result in slotFamilies. */
export function compactHomeFamily(width: number, height: number, entropy: number, usage?: ReadonlyMap<string, number>): string | undefined {
  const candidates = BUILDING_CATALOG.filter(entry => entry.category === "HOUSE" && !entry.serviceRole
    && compactFamilyMatchesFootprint(entry.key, width, height)).map(entry => entry.key).sort();
  if (!candidates.length) return undefined;
  const minimum = Math.min(...candidates.map(key => usage?.get(key) ?? 0));
  const leastUsed = candidates.filter(key => (usage?.get(key) ?? 0) === minimum);
  return leastUsed[entropy % leastUsed.length];
}

export function compactBuildingServiceRole(family: string): BlockServiceRole | undefined {
  const role = BUILDING_CATALOG.find(entry => entry.key === family)?.serviceRole;
  return BLOCK_SERVICE_ROLES.find(candidate => candidate === role);
}
