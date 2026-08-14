import { createHash } from "node:crypto";
import type { ChunkPayloadDto } from "../../shared/contracts";

/**
 * Validator for render-equivalent chunk content. The publication version is
 * deliberately excluded: unrelated country events may advance worldVersion
 * without changing this chunk's pixels or entities.
 */
export function chunkPayloadContentHash(payload: Omit<ChunkPayloadDto, "contentHash">): string {
  const { publishedVersion, ...renderContent } = payload;
  void publishedVersion;
  return createHash("sha256").update(JSON.stringify(renderContent)).digest("hex");
}
