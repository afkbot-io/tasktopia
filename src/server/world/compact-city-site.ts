import type { Cell, Rect } from "../../shared/contracts";
import { hashCoordinate, isBuildableTerrain, terrainAt } from "../../shared/world-terrain";
import type { WorldTerrainProfile } from "../../shared/world-terrain-profile";

/** Preserve the approved inner search, then explore bounded outer bands only
 * when it is exhausted. The world is procedural beyond the initial composition;
 * existing coordinates, terrain seeds and the 48-cell city separation stay fixed.
 */
export function findCompactCitySite(seed: number, cityBounds: readonly Rect[], roadCorridors: readonly Rect[] = [], terrainProfile?: WorldTerrainProfile): Cell | undefined {
  const occupied = cityBounds.map(b => ({ minX: b.minX - 48, minY: b.minY - 48, maxX: b.maxX + 48, maxY: b.maxY + 48 }));
  const intersects = (a: Rect, b: Rect) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  const dry = (x: number, y: number) => isBuildableTerrain(terrainAt(seed, x, y, terrainProfile).terrain);
  let firstRadius = 0;
  for (const lastRadius of [16, 32, 64]) {
    const candidates: Array<{ cell: Cell; score: number }> = [];
    for (let radius = firstRadius; radius <= lastRadius; radius++) {
      // Visit only the O(radius) perimeter, not the O(radius²) square interior.
      for (let gy = -radius; gy <= radius; gy++) {
        const xs = Math.abs(gy) === radius
          ? Array.from({ length: radius * 2 + 1 }, (_, i) => i - radius)
          : [-radius, radius];
        for (const gx of xs) {
          const cell = { x: gx * 32, y: gy * 32 };
          const reserve = { minX: cell.x - 4, minY: cell.y - 4, maxX: cell.x + 96, maxY: cell.y + 96 };
          if (occupied.some(bounds => intersects(bounds, reserve))) continue;
          if (roadCorridors.some(bounds => intersects(bounds, reserve))) continue;
          let score = 0;
          for (let dy = -2; dy <= 94; dy += 12) for (let dx = -2; dx <= 190; dx += 12) {
            if (dry(cell.x + dx, cell.y + dy)) score++;
          }
          candidates.push({ cell, score: score * 100 - radius + hashCoordinate(seed, cell.x, cell.y, 417) });
        }
      }
    }
    candidates.sort((a, b) => {
      // A coastal world should actually start near its coast. Dry-area scores
      // alone prefer the deepest inland plain, making the sea unreachable from
      // the city's bounded camera. The full starter parcel is still validated.
      if (terrainProfile) {
        const targetX = terrainProfile.coastX - 64;
        const distance = Math.abs(a.cell.x - targetX) - Math.abs(b.cell.x - targetX);
        if (distance) return distance;
      }
      return b.score - a.score;
    });
    for (const { cell } of candidates) {
      let buildable = true;
      for (let y = cell.y - 2; y <= cell.y + 34 && buildable; y++) {
        for (let x = cell.x - 2; x <= cell.x + 34; x++) if (!dry(x, y)) { buildable = false; break; }
      }
      if (buildable) return cell;
    }
    firstRadius = lastRadius + 1;
  }
  return undefined;
}
