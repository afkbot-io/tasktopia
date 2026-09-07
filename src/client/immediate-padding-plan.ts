import type { Cell } from "../shared/contracts";
import type { CameraPosition, ChunkCoordinate, ScreenSize } from "./world-camera";

/** Measured local native-Sprite limit, not a hard millisecond guarantee. */
export const IMMEDIATE_PADDING_CELL_LIMIT = 8192;
export type ImmediatePaddingRegion = { chunkX: number; chunkY: number; cells: Cell[] };
export function planImmediatePadding(position: CameraPosition, scale: number, screen: ScreenSize,
  missing: readonly ChunkCoordinate[], covered: ReadonlySet<string>, cellBudget: number, cellSize: number, chunkSize: number): {
    regions: ImmediatePaddingRegion[]; cells: number; complete: boolean;
  } {
  if (![position.x, position.y, scale, screen.width, screen.height, cellSize].every(Number.isFinite)
    || scale <= 0 || cellSize <= 0 || screen.width < 0 || screen.height < 0
    || !Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 64
    || !Number.isInteger(cellBudget) || cellBudget < 0 || cellBudget > IMMEDIATE_PADDING_CELL_LIMIT
    || covered.size > IMMEDIATE_PADDING_CELL_LIMIT) throw new Error("Invalid bounded immediate padding request");
  const pixels = scale * cellSize;
  const minX = Math.floor(-position.x / pixels), minY = Math.floor(-position.y / pixels);
  const maxX = Math.ceil((screen.width - position.x) / pixels) - 1, maxY = Math.ceil((screen.height - position.y) / pixels) - 1;
  const regions: ImmediatePaddingRegion[] = [], visited = new Set<string>();
  let cells = 0;
  for (const [chunkX, chunkY] of missing) {
    if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkY)) throw new Error("Invalid immediate chunk coordinate");
    const id = `${chunkX},${chunkY}`; if (visited.has(id)) continue; visited.add(id);
    const region: ImmediatePaddingRegion = { chunkX, chunkY, cells: [] };
    for (let y = Math.max(minY, chunkY * chunkSize); y <= Math.min(maxY, (chunkY + 1) * chunkSize - 1); y++) {
      for (let x = Math.max(minX, chunkX * chunkSize); x <= Math.min(maxX, (chunkX + 1) * chunkSize - 1); x++) {
        if (covered.has(`${x},${y}`)) continue;
        if (cells === cellBudget) return { regions, cells, complete: false };
        if (!region.cells.length) regions.push(region);
        region.cells.push({ x, y }); cells++;
      }
    }
  }
  return { regions, cells, complete: true };
}
