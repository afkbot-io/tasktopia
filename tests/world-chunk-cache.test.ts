import { describe, expect, it } from "vitest";
import type { ChunkDto } from "../src/shared/contracts";
import { overviewFromDetailChunk } from "../src/client/world-chunk-cache";

describe("detail-to-overview chunk cache", () => {
  it("derives the lightweight overview without another server response", () => {
    const detail = {
      chunkX: -1,
      chunkY: 2,
      size: 64,
      terrain: [
        { x: -64, y: 128, terrain: "GRASS", variant: 0 },
        { x: -63, y: 128, terrain: "GRASS", variant: 1 },
        { x: -60, y: 132, terrain: "MEADOW", variant: 0 },
      ],
      roads: [],
      surfaces: [
        { x: -64, y: 128, kind: "SIDEWALK" },
        { x: -63, y: 128, kind: "CROSSWALK", orientation: "H" },
      ],
      districts: [],
      tasks: [{ id: "task", defectSummary: { open: 1, inProgress: 0, verifying: 0, active: 1 } }],
      worldFeatures: [{ id: "feature" }],
      decorations: [{ id: "decoration" }],
      worldVersion: 4,
    } as unknown as ChunkDto;

    const overview = overviewFromDetailChunk(detail);

    expect(overview.terrain.map(({ x, y }) => [x, y])).toEqual([[-64, 128], [-60, 132]]);
    expect(overview.surfaces).toEqual([{ x: -64, y: 128, kind: "SIDEWALK" }]);
    expect(overview.tasks[0]).not.toHaveProperty("defectSummary");
    expect(overview.worldFeatures).toEqual([]);
    expect(overview.decorations).toEqual([]);
    expect(detail.worldFeatures).toHaveLength(1);
  });
});
