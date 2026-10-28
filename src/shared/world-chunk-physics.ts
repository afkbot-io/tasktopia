import type { ChunkPayloadDto } from "./contracts";
import { materializeChunkPayload } from "./world-chunk-payload";

/** Physical projection of the authoritative compact page. */
export function materializeChunkPhysics(payload: ChunkPayloadDto) {
  return materializeChunkPayload(payload,undefined,true);
}
