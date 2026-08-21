import { createHash } from "node:crypto";
import type { ChunkPayloadV1Dto, ChunkPayloadV2Dto } from "../../shared/contracts";

export type ChunkPayloadHashInput = Omit<ChunkPayloadV1Dto, "contentHash"> | Omit<ChunkPayloadV2Dto, "contentHash">;

/**
 * Validator for render-equivalent chunk content. The publication version is
 * deliberately excluded: unrelated country events may advance worldVersion
 * without changing this chunk's pixels or entities.
 */
export function chunkPayloadContentHash(payload: ChunkPayloadHashInput): string {
  const { publishedVersion, ...renderContent } = payload;
  void publishedVersion;
  return createHash("sha256").update(JSON.stringify(renderContent)).digest("hex");
}
