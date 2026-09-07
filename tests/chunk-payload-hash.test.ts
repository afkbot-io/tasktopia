import { describe, expect, it } from "vitest";
import { chunkPayloadContentHash } from "../src/server/world/chunk-payload-hash";
import type { ChunkPayloadV2Dto } from "../src/shared/contracts";

function content(publishedVersion: number): Omit<ChunkPayloadV2Dto, "contentHash"> {
  return {
    payloadVersion: 2,
    generatorVersion: "block-v1",
    terrainSeed: 42,
    publishedVersion,
    lod: "DETAIL",
    chunkX: 0,
    chunkY: 0,
    size: 64,
    roadRuns: [],
    surfaceRuns: [],
    districts: [],
    tasks: [],
    worldFeatures: [],
    decorationContext: { treeGeometryVersion: 7, lightingVersion: 1, surfaceHaloRuns: [], blockedCellRuns: [], cityBounds: [], districts: [], tasks: [] },
  };
}

describe("chunk payload content hash", () => {
  it("stays stable when only the publication version changes", () => {
    expect(chunkPayloadContentHash(content(7))).toBe(chunkPayloadContentHash(content(18)));
  });

  it("changes when render content changes", () => {
    const changed = content(7);
    changed.roadRuns = [{ start:{ x: 1, y: 2 }, end:{ x: 1, y: 2 }, mask: 4, structure: "ROAD", roadClass: "LOCAL" }];

    expect(chunkPayloadContentHash(changed)).not.toBe(chunkPayloadContentHash(content(7)));
  });
});
