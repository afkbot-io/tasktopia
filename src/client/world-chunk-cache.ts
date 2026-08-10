import type { ChunkDto } from "../shared/contracts";

/**
 * Detail is a strict data superset for the overview renderer. Reusing it when
 * zooming out avoids a second HTTP round trip while preserving the public
 * overview contract (coarse terrain, no decorations/features/defect payload).
 */
export function overviewFromDetailChunk(chunk: ChunkDto): ChunkDto {
  const originX = chunk.chunkX * chunk.size;
  const originY = chunk.chunkY * chunk.size;
  return {
    ...chunk,
    terrain: chunk.terrain.filter((cell) => (cell.x - originX) % 4 === 0 && (cell.y - originY) % 4 === 0),
    surfaces: chunk.surfaces.filter((surface) => surface.kind === "PATH" || surface.kind === "SIDEWALK"),
    tasks: chunk.tasks.map((task) => {
      const overviewTask = { ...task };
      delete overviewTask.defectSummary;
      return overviewTask;
    }),
    worldFeatures: [],
    decorations: [],
  };
}
