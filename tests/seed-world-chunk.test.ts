import { describe, expect, it } from "vitest";
import { seedWorldChunkPayload } from "../src/client/seed-world-chunk";
import { materializeChunkPayload } from "../src/shared/world-chunk-payload";

describe("seed-first world chunk", () => {
  it("builds a network-free terrain payload with no server-owned overlays", () => {
    const payload = seedWorldChunkPayload({
      terrainSeed: 42,
      generatorVersion: "square-v7",
      assetRevision: "0123456789abcdef",
      worldRevision: 7,
      chunkSize: 64,
      viewBounds: { minX: -64, minY: -64, maxX: 127, maxY: 127 },
    }, -1, 2, "DETAIL");

    expect(payload).toMatchObject({ chunkX: -1, chunkY: 2, size: 64, terrainSeed: 42, publishedVersion: 7, baseLayerOnly: true });
    expect(payload.contentHash).toBe("seed:square-v7:42:-1:2:DETAIL");
    expect(payload.roads).toEqual([]);
    expect(payload.surfaces).toEqual([]);
    expect(payload.districts).toEqual([]);
    expect(payload.tasks).toEqual([]);
    expect(payload.worldFeatures).toEqual([]);
    const chunk = materializeChunkPayload(payload);
    expect(chunk.terrain).toHaveLength(4096);
    expect(chunk.decorations).toEqual([]);
  });
});
