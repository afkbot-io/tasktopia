import type { TerrainCellDto } from "../shared/contracts";
import { hashCoordinate } from "../shared/world-terrain";

export const SEED_TERRAIN_COLORS: Record<string, number> = {
  GRASS: 0x668548, MEADOW: 0x789451, FOREST: 0x315f3d,
  DIRT: 0x8d6549, SAND: 0xc5aa73, CLAY: 0x9b5d47, STONE: 0x7d8581,
  HILL: 0x64754b, MOUNTAIN: 0x717875, SHALLOW_WATER: 0x287da0, DEEP_WATER: 0x1f648c,
};

const SEED_TERRAIN_ACCENTS: Record<string, readonly [number, number]> = {
  GRASS: [0x789755, 0x526f3c], MEADOW: [0x91a963, 0x657f47], FOREST: [0x477552, 0x244b32],
  DIRT: [0xa27a59, 0x75513d], SAND: [0xd7bd84, 0xab8e5f], CLAY: [0xb36e54, 0x7d4638],
  STONE: [0x929a96, 0x686f6d], HILL: [0x78875d, 0x53623f], MOUNTAIN: [0x89908c, 0x5e6562],
  SHALLOW_WATER: [0x3990b1, 0x206b8c], DEEP_WATER: [0x2d769d, 0x185579],
};

export type SeedTerrainCellPresentation = {
  fill: number;
  accents: Array<{ x: number; y: number; color: number }>;
};

/**
 * Tiny deterministic pixel texture used before any HTTP or PNG decode. It
 * keeps the instant first frame, but avoids leaving loaded detail terrain as
 * one flat colour when the immutable seed layer is retained.
 */
export function seedTerrainCellPresentation(
  seed: number,
  cell: Pick<TerrainCellDto, "x" | "y" | "terrain" | "variant">,
): SeedTerrainCellPresentation {
  const fill = SEED_TERRAIN_COLORS[cell.terrain] ?? SEED_TERRAIN_COLORS.GRASS!;
  const colors = SEED_TERRAIN_ACCENTS[cell.terrain] ?? SEED_TERRAIN_ACCENTS.GRASS!;
  const first = hashCoordinate(seed + cell.variant, cell.x, cell.y, 1_031);
  const second = hashCoordinate(seed + cell.variant, cell.x, cell.y, 1_033);
  const firstPoint = { x: 1 + Math.floor(first * 6), y: 1 + Math.floor(second * 6) };
  let secondPoint = {
    x: 1 + Math.floor(hashCoordinate(seed, cell.x, cell.y, 1_039) * 6),
    y: 1 + Math.floor(hashCoordinate(seed, cell.x, cell.y, 1_049) * 6),
  };
  if (secondPoint.x === firstPoint.x && secondPoint.y === firstPoint.y) {
    secondPoint = { x: secondPoint.x === 6 ? 1 : secondPoint.x + 1, y: secondPoint.y };
  }
  return {
    fill,
    accents: [
      { ...firstPoint, color: colors[0] },
      { ...secondPoint, color: colors[1] },
    ],
  };
}
