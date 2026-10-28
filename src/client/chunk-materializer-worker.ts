import type { ChunkPayloadDto } from "../shared/contracts";
import { materializeChunkPayload } from "../shared/world-chunk-payload";
import { materializeChunkPhysics } from "../shared/world-chunk-physics";

type MaterializeRequest = { id: number; payload: ChunkPayloadDto; terrainSamples?: Uint8Array; physicalOnly?: boolean };
type MaterializeResponse = { id: number; chunk?: ReturnType<typeof materializeChunkPayload>; error?: string; computeMs?: number };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MaterializeRequest>) => void) | null;
  postMessage(message: MaterializeResponse): void;
};

workerScope.onmessage = (event) => {
  try {
    const started = performance.now();
    const chunk = event.data.physicalOnly
      ? materializeChunkPhysics(event.data.payload) : materializeChunkPayload(event.data.payload, event.data.terrainSamples);
    workerScope.postMessage({ id: event.data.id, chunk, computeMs: performance.now() - started });
  } catch (error) {
    workerScope.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : "Chunk materialization failed" });
  }
};
