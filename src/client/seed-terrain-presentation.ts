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
  fieldKind?: "WHEAT" | "CORN";
};

/**
 * Large agricultural blocks derived only from world coordinates. A 64-cell
 * macro parcel contains at most one 40–52 by 28–38 cell field, so fields read
 * as land use rather than a handful of decorative plants. Semantic overlays
 * (roads, platforms and buildings) cover these ground pixels without storing
 * or transferring a coordinate per crop.
 */
export function seededFieldKind(
  seed: number,
  cell: Pick<TerrainCellDto, "x" | "y">,
  terrain: TerrainCellDto["terrain"],
): "WHEAT" | "CORN" | undefined {
  if (terrain !== "GRASS" && terrain !== "MEADOW") return undefined;
  const macroSize = 64;
  const macroX = Math.floor(cell.x / macroSize);
  const macroY = Math.floor(cell.y / macroSize);
  const localX = cell.x - macroX * macroSize;
  const localY = cell.y - macroY * macroSize;
  const roll = hashCoordinate(seed, macroX, macroY, 1_201);
  const kind = roll < 0.3 ? "WHEAT" : roll < 0.55 ? "CORN" : undefined;
  if (!kind) return undefined;
  const centerX = 28 + Math.floor(hashCoordinate(seed, macroX, macroY, 1_207) * 9);
  const centerY = 28 + Math.floor(hashCoordinate(seed, macroX, macroY, 1_213) * 9);
  const halfWidth = 20 + Math.floor(hashCoordinate(seed, macroX, macroY, 1_217) * 7);
  const halfHeight = 14 + Math.floor(hashCoordinate(seed, macroX, macroY, 1_223) * 6);
  if (Math.abs(localX - centerX) > halfWidth || Math.abs(localY - centerY) > halfHeight) return undefined;
  const edgeDistance = Math.min(
    halfWidth - Math.abs(localX - centerX),
    halfHeight - Math.abs(localY - centerY),
  );
  if (edgeDistance <= 1 && hashCoordinate(seed, cell.x, cell.y, 1_229) < 0.22) return undefined;
  return kind;
}

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
  const fieldKind = seededFieldKind(seed, cell, cell.terrain);
  const fieldColors = fieldKind === "WHEAT" ? [0xb49748, 0xd0b45b] as const
    : fieldKind === "CORN" ? [0x657b35, 0x9b9840] as const : undefined;
  const accents: Array<{ x: number; y: number; color: number }> = [];
  const occupiedAccentPixels = new Set<string>();
  const addCluster = (x: number, y: number, length: number, horizontal: boolean, palette: readonly number[]) => {
    for (let step = 0; step < length; step += 1) {
      const pixelX = x + (horizontal ? step : 0);
      const pixelY = y + (horizontal ? 0 : step);
      const pixelKey = `${pixelX},${pixelY}`;
      if (occupiedAccentPixels.has(pixelKey)) continue;
      occupiedAccentPixels.add(pixelKey);
      accents.push({ x: pixelX, y: pixelY, color: palette[step % palette.length]! });
    }
  };

  // Natural texture is grouped by a coarse world-coordinate patch. Individual
  // cells then receive zero, one or (rarely) two connected 1–3 px clusters.
  // This preserves instant seed-only drawing without turning every 8×8 tile
  // into the same noisy wallpaper.
  const patchX = Math.floor(cell.x / 12);
  const patchY = Math.floor(cell.y / 12);
  const patchDensity = 0.12 + hashCoordinate(seed + cell.variant, patchX, patchY, 1_019) * 0.32;
  const detailRoll = hashCoordinate(seed + cell.variant, cell.x, cell.y, 1_021);
  const clusterCount = detailRoll < patchDensity * 0.12 ? 2 : detailRoll < patchDensity ? 1 : 0;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const horizontal = hashCoordinate(seed + cell.variant, cell.x, cell.y, 1_027 + cluster * 11) >= 0.5;
    const length = 1 + Math.floor(hashCoordinate(seed + cell.variant, cell.x, cell.y, 1_031 + cluster * 11) * 3);
    const x = 1 + Math.floor(hashCoordinate(seed + cell.variant, cell.x, cell.y, 1_037 + cluster * 11) * (horizontal ? 5 : 6));
    const y = 1 + Math.floor(hashCoordinate(seed + cell.variant, cell.x, cell.y, 1_041 + cluster * 11) * (horizontal ? 6 : 5));
    const candidatePixels = Array.from({ length }, (_, step) => ({
      x: x + (horizontal ? step : 0),
      y: y + (horizontal ? 0 : step),
    }));
    const touchesExistingCluster = candidatePixels.some((pixel) => [
      `${pixel.x},${pixel.y}`,
      `${pixel.x - 1},${pixel.y}`, `${pixel.x + 1},${pixel.y}`,
      `${pixel.x},${pixel.y - 1}`, `${pixel.x},${pixel.y + 1}`,
    ].some((key) => occupiedAccentPixels.has(key)));
    if (cluster > 0 && touchesExistingCluster) continue;
    addCluster(x, y, length, horizontal, colors);
  }
  if (fieldColors) {
    // Crop strokes share a macro orientation but vary their phase and count by
    // world cell. Adjacent field tiles therefore read as coherent rows without
    // repeating one six-pixel stamp.
    const macroX = Math.floor(cell.x / 64);
    const macroY = Math.floor(cell.y / 64);
    const horizontal = hashCoordinate(seed, macroX, macroY, 1_241) >= 0.5;
    const rowCount = 1 + Math.floor(hashCoordinate(seed, cell.x, cell.y, 1_243) * 3);
    const phase = Math.floor(hashCoordinate(seed, cell.x, cell.y, 1_249) * 3);
    for (let row = 0; row < rowCount; row += 1) {
      const lane = 1 + ((phase + row * 2) % 6);
      const offset = 1 + Math.floor(hashCoordinate(seed, cell.x, cell.y, 1_251 + row * 2) * 4);
      const length = 2 + Math.floor(hashCoordinate(seed, cell.x, cell.y, 1_252 + row * 2) * 2);
      addCluster(horizontal ? offset : lane, horizontal ? lane : offset, length, horizontal, fieldColors);
    }
  }
  return {
    fill: fieldKind === "WHEAT" ? 0x8f7d43 : fieldKind === "CORN" ? 0x617a3e : fill,
    accents,
    ...(fieldKind ? { fieldKind } : {}),
  };
}
