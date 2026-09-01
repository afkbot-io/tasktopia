import type { BlockWorldKind } from "./block-world.js";
import { BLOCK_V1_CITY_PRESENTATION } from "./city-presentation-profile.js";

export const BLOCK_SURFACE_SCHEMA_VERSION = 1 as const;
export const BLOCK_SURFACE_VISUAL_PROFILE = "TASKTOPIA_BLOCK_V1_MICRO_SURFACES_2026" as const;

export const BLOCK_SURFACE_TILE_KEYS = Object.freeze({
  LAWN: "block-lawn",
  WATER: "block-water",
} as const);

export type BlockSurfaceKind = keyof typeof BLOCK_SURFACE_TILE_KEYS;
export type BlockSurfaceTileKey = typeof BLOCK_SURFACE_TILE_KEYS[BlockSurfaceKind];

export type BlockSurfacePlanV1 = Readonly<{
  schemaVersion: typeof BLOCK_SURFACE_SCHEMA_VERSION;
  profile: typeof BLOCK_SURFACE_VISUAL_PROFILE;
  cellPx: typeof BLOCK_V1_CITY_PRESENTATION.logicalCellPx;
  kind: BlockSurfaceKind;
  tileKey: BlockSurfaceTileKey;
}>;

/**
 * Stores one semantic base material per block. The renderer repeats the native
 * 4px tile only for free interior cells; sidewalks, roads, lots, and props are
 * separate layers and are never encoded as a per-cell surface array here.
 */
export function blockSurfacePlanForKind(blockKind: BlockWorldKind): BlockSurfacePlanV1 {
  const kind: BlockSurfaceKind = blockKind === "WATER" ? "WATER" : "LAWN";
  return {
    schemaVersion: BLOCK_SURFACE_SCHEMA_VERSION,
    profile: BLOCK_SURFACE_VISUAL_PROFILE,
    cellPx: BLOCK_V1_CITY_PRESENTATION.logicalCellPx,
    kind,
    tileKey: BLOCK_SURFACE_TILE_KEYS[kind],
  };
}
