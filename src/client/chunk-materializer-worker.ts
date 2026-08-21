import type { ChunkPayloadDto } from "../shared/contracts";
import { materializeChunkPayload } from "../shared/world-chunk-payload";

type MaterializeRequest = { id: number; payload: ChunkPayloadDto; terrainSamples?: Uint8Array };
type MaterializeResponse = { id: number; chunk?: ReturnType<typeof materializeChunkPayload>; error?: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MaterializeRequest>) => void) | null;
  postMessage(message: MaterializeResponse): void;
};

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({ id: event.data.id, chunk: materializeChunkPayload(event.data.payload, event.data.terrainSamples) });
  } catch (error) {
    workerScope.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : "Chunk materialization failed" });
  }
};
