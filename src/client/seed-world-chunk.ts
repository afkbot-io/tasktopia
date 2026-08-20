import type { ChunkLod, ChunkPayloadDto, WorldManifestDto } from "../shared/contracts";

/**
 * Creates the deterministic, network-free base layer. Server-owned roads,
 * surfaces and entities arrive later and replace this temporary ground.
 */
export function seedWorldChunkPayload(
  manifest: WorldManifestDto,
  chunkX: number,
  chunkY: number,
  lod: ChunkLod,
): ChunkPayloadDto {
  return {
    payloadVersion: 1,
    contentHash: `seed:${manifest.generatorVersion}:${manifest.terrainSeed}:${chunkX}:${chunkY}:${lod}`,
    chunkX,
    chunkY,
    size: manifest.chunkSize,
    generatorVersion: manifest.generatorVersion,
    terrainSeed: manifest.terrainSeed,
    publishedVersion: manifest.worldRevision,
    lod,
    baseLayerOnly: true,
    roads: [],
    surfaces: [],
    districts: [],
    tasks: [],
    worldFeatures: [],
    decorationContext: { cityBounds: [], districts: [], tasks: [] },
  };
}
