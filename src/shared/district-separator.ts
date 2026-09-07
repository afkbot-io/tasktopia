import type { CityBlockV1, BlockWorldBounds } from "./block-world";

/** A reserved green median between two parallel compact streets, with links at both ends. */
export type DistrictSeparator = { neighborBlockId: string; axis: "H" | "V"; bounds: BlockWorldBounds };
type Rectangle = { origin: { x: number; y: number }; width: number; height: number };
export const DISTRICT_STREET_GAP = 8;

export function districtSeparatorBetween(candidate: Rectangle, neighbor: CityBlockV1): DistrictSeparator | undefined {
  const a = { minX: candidate.origin.x, minY: candidate.origin.y, maxX: candidate.origin.x + candidate.width, maxY: candidate.origin.y + candidate.height };
  const b = { minX: neighbor.origin.x, minY: neighbor.origin.y, maxX: neighbor.origin.x + neighbor.width, maxY: neighbor.origin.y + neighbor.height };
  const minY = Math.max(a.minY, b.minY), maxY = Math.min(a.maxY, b.maxY);
  if (maxY - minY >= DISTRICT_STREET_GAP) {
    if (a.minX - b.maxX === DISTRICT_STREET_GAP) return { neighborBlockId: neighbor.id, axis: "H", bounds: { minX: b.maxX, minY, maxX: a.minX, maxY } };
    if (b.minX - a.maxX === DISTRICT_STREET_GAP) return { neighborBlockId: neighbor.id, axis: "H", bounds: { minX: a.maxX, minY, maxX: b.minX, maxY } };
  }
  const minX = Math.max(a.minX, b.minX), maxX = Math.min(a.maxX, b.maxX);
  if (maxX - minX >= DISTRICT_STREET_GAP) {
    if (a.minY - b.maxY === DISTRICT_STREET_GAP) return { neighborBlockId: neighbor.id, axis: "V", bounds: { minX, minY: b.maxY, maxX, maxY: a.minY } };
    if (b.minY - a.maxY === DISTRICT_STREET_GAP) return { neighborBlockId: neighbor.id, axis: "V", bounds: { minX, minY: a.maxY, maxX, maxY: b.minY } };
  }
  return undefined;
}

/** Read only the exact persisted relationship, never infer a new bridge on reload. */
export function readDistrictSeparators(blocks: readonly CityBlockV1[]): DistrictSeparator[] {
  const byId = new Map(blocks.map(b => [b.id, b]));
  return blocks.flatMap(block => {
    const stored = block.parameters.districtSeparator as DistrictSeparator | undefined;
    if (stored === undefined) return [];
    const neighbor = stored && byId.get(stored.neighborBlockId);
    if (!neighbor) throw new Error(`Missing district street neighbor for ${block.id}`);
    const expected = districtSeparatorBetween(block, neighbor);
    if (!expected || expected.axis !== stored.axis || neighbor.districtLayoutId === block.districtLayoutId || !stored.bounds
      || (Object.keys(expected.bounds) as Array<keyof BlockWorldBounds>).some(key => stored.bounds[key] !== expected.bounds[key])) {
      throw new Error(`Invalid district separator for ${block.id}`);
    }
    return [expected];
  });
}

export function overlapsDistrictSeparator(rectangle: Rectangle, separator: DistrictSeparator): boolean {
  const { bounds: b } = separator;
  return rectangle.origin.x < b.maxX && rectangle.origin.x + rectangle.width > b.minX
    && rectangle.origin.y < b.maxY && rectangle.origin.y + rectangle.height > b.minY;
}
