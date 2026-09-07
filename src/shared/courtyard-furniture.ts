/** Geometry-only worker contract. Keep the large runtime asset catalog out of world generation. */
export const COURTYARD_FURNITURE = {
  "courtyard-picnic-table": { width: 2, height: 2 },
  "courtyard-cycle-rack": { width: 2, height: 1 },
  "courtyard-square-planter": { width: 1, height: 1 },
} as const;

export type CourtyardFurnitureKind = keyof typeof COURTYARD_FURNITURE;

export function courtyardFurnitureFootprint(kind: string): { width: number; height: number } | undefined {
  return Object.hasOwn(COURTYARD_FURNITURE, kind) ? COURTYARD_FURNITURE[kind as CourtyardFurnitureKind] : undefined;
}
