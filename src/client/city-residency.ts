import type { Cell, Rect } from "../shared/contracts";
import type { ChunkRange } from "./world-camera";

export function planCityResidency(chunks: readonly {chunkX:number;chunkY:number}[], range: ChunkRange, chunkSize:number) {
  const visibleKeys = new Set<string>(), centerX = (range.minChunkX+range.maxChunkX)/2, centerY = (range.minChunkY+range.maxChunkY)/2;
  const wanted = chunks.filter(chunk => chunk.chunkX>=range.minChunkX-1 && chunk.chunkX<=range.maxChunkX+1
    && chunk.chunkY>=range.minChunkY-1 && chunk.chunkY<=range.maxChunkY+1).map(chunk => {
    if (chunk.chunkX>=range.minChunkX && chunk.chunkX<=range.maxChunkX && chunk.chunkY>=range.minChunkY && chunk.chunkY<=range.maxChunkY)
      visibleKeys.add(`${chunk.chunkX},${chunk.chunkY}`);
    return [chunk.chunkX,chunk.chunkY] as [number,number];
  });
  wanted.sort((a,b)=>Number(visibleKeys.has(`${b[0]},${b[1]}`))-Number(visibleKeys.has(`${a[0]},${a[1]}`))
    || Math.abs(a[0]-centerX)+Math.abs(a[1]-centerY)-Math.abs(b[0]-centerX)-Math.abs(b[1]-centerY) || a[1]-b[1] || a[0]-b[0]);
  return {wanted,visibleKeys,bounds:{minX:(range.minChunkX-1)*chunkSize,minY:(range.minChunkY-1)*chunkSize,
    maxX:(range.maxChunkX+2)*chunkSize-1,maxY:(range.maxChunkY+2)*chunkSize-1}};
}
export function taskIntersectsResidentBounds(task: {footprint: readonly Cell[]}, bounds: Rect): boolean {
  // A roof can rise above its ground footprint. The page halo already exceeds
  // authored sprite sizes; this margin preserves cross-edge hit targets too.
  return task.footprint.some(cell=>cell.x>=bounds.minX-16 && cell.x<=bounds.maxX+16 && cell.y>=bounds.minY-16 && cell.y<=bounds.maxY+16);
}
