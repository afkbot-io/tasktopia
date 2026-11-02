import type { Rect } from "../shared/contracts";
import type { CameraPosition, ScreenSize, ChunkCoordinate } from "./world-camera";

/** Local material only; a fixed zoom floor never triggers city/entity reads.
 * Navigation bounds can include stations and airfields beyond the scene.
 * Use its actual chunk keys for ownership, not that larger camera rectangle. */
export function cameraTerrainPadding(position: CameraPosition, scale: number, screen: ScreenSize, resident: Rect | ReadonlySet<string>, cellSize: number, chunkSize: number, haloChunks = 0): ChunkCoordinate[] {
  if (!Number.isInteger(haloChunks) || haloChunks < 0 || haloChunks > 1) throw new Error("Padding prewarm halo must be 0 or 1 chunk");
  const pixels = cellSize * chunkSize * scale;
  const visible = { minX: Math.floor(-position.x / pixels), minY: Math.floor(-position.y / pixels),
    maxX: Math.ceil((screen.width - position.x) / pixels) - 1, maxY: Math.ceil((screen.height - position.y) / pixels) - 1 };
  const ownsChunk = "has" in resident
    ? (x: number, y: number) => resident.has(`${x},${y}`)
    : (() => {
      const chunks = { minX: Math.floor(resident.minX / chunkSize), minY: Math.floor(resident.minY / chunkSize),
        maxX: Math.floor(resident.maxX / chunkSize), maxY: Math.floor(resident.maxY / chunkSize) };
      return (x: number, y: number) => x >= chunks.minX && x <= chunks.maxX && y >= chunks.minY && y <= chunks.maxY;
    })();
  const result: ChunkCoordinate[] = [];
  for (let y = visible.minY - haloChunks; y <= visible.maxY + haloChunks; y++) for (let x = visible.minX - haloChunks; x <= visible.maxX + haloChunks; x++) {
    if (!ownsChunk(x, y)) result.push([x, y]);
  }
  return result;
}
