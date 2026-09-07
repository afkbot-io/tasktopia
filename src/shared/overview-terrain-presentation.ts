import { atlasTerrainTile, type AtlasTerrainKind, type AtlasTerrainTile } from "./atlas-scene";

export type OverviewTerrainPatch = { x: number; y: number; size: number; tile: AtlasTerrainTile };

/** Material frequency only. The normalized patches partition one unchanged
 * semantic cell; no new coast, terrain family, ownership or map coordinate is
 * sampled. Internal edges connect and exterior edges inherit the macro mask. */
export function overviewTerrainPatches(
  kind: AtlasTerrainKind, level: "country" | "planet", column: number, row: number, connectionMask: number,
): OverviewTerrainPatch[] {
  const count = level === "country" ? 4 : 2;
  const patches: OverviewTerrainPatch[] = [];
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
    const mask = (y > 0 || connectionMask & 1 ? 1 : 0) | (x < count - 1 || connectionMask & 2 ? 2 : 0)
      | (y < count - 1 || connectionMask & 4 ? 4 : 0) | (x > 0 || connectionMask & 8 ? 8 : 0);
    patches.push({ x: x / count, y: y / count, size: 1 / count,
      tile: atlasTerrainTile(kind, level, column * count + x, row * count + y, mask) });
  }
  return patches;
}
