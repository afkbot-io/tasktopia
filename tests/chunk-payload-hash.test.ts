import { describe, expect, it } from "vitest";
import { chunkPayloadContentHash } from "../src/server/world/chunk-payload-hash";
import type { ChunkPayloadDto } from "../src/shared/contracts";

function content(publishedVersion: number): Omit<ChunkPayloadDto, "contentHash"> {
  return {
    payloadVersion: 1,
    generatorVersion: "square-v7",
    terrainSeed: 42,
    publishedVersion,
    lod: "DETAIL",
    chunkX: 0,
    chunkY: 0,
    size: 64,
    roads: [],
    surfaces: [],
    districts: [],
    tasks: [],
    worldFeatures: [],
    decorationContext: { cityBounds: [], districts: [], tasks: [] },
  };
}

describe("chunk payload content hash", () => {
  it("stays stable when only the publication version changes", () => {
    expect(chunkPayloadContentHash(content(7))).toBe(chunkPayloadContentHash(content(18)));
  });

  it("changes when render content changes", () => {
    const changed = content(7);
    changed.roads = [{ x: 1, y: 2, mask: 4, structure: "ROAD", roadClass: "LOCAL" }];

    expect(chunkPayloadContentHash(changed)).not.toBe(chunkPayloadContentHash(content(7)));
  });
});
