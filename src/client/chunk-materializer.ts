import type { ChunkDto, ChunkPayloadDto } from "../shared/contracts";

type WorkerResponse = { id: number; chunk?: ChunkDto; error?: string };

export type ChunkWorker = {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(message: { id: number; payload: ChunkPayloadDto; terrainSamples?: Uint8Array }): void;
  terminate(): void;
};

export type ChunkWorkerFactory = () => ChunkWorker;

type MaterializationRequest = {
  id: number;
  payload: ChunkPayloadDto;
  terrainSamples?: Uint8Array;
  resolve(chunk: ChunkDto): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  abort?: () => void;
  settled: boolean;
};

type WorkerSlot = {
  worker: ChunkWorker;
  active?: MaterializationRequest;
};

const browserWorkerFactory: ChunkWorkerFactory = () => new Worker(
  new URL("./chunk-materializer-worker.ts", import.meta.url),
  { type: "module" },
);

function abortError(): DOMException {
  return new DOMException("Chunk materialization aborted", "AbortError");
}

export class ChunkMaterializer {
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: MaterializationRequest[] = [];
  private readonly targetWorkerCount: number;
  private readonly workerFactory: ChunkWorkerFactory;
  private nextRequestId = 1;
  private replacementAttempts = 0;
  private replacementTimer: ReturnType<typeof setTimeout> | undefined;
  private inlineActive: MaterializationRequest | undefined;
  private inlineFallback = false;
  private destroyed = false;
  private static readonly QUEUE_LIMIT = 32;

  constructor(
    workerCount = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)),
    workerFactory: ChunkWorkerFactory = browserWorkerFactory,
  ) {
    this.targetWorkerCount = workerCount;
    this.workerFactory = workerFactory;
    this.inlineFallback = workerCount === 0;
    for (let index = 0; index < workerCount; index += 1) {
      try {
        this.attachWorker(workerFactory());
        this.replacementAttempts = 0;
      } catch {
        this.replacementAttempts += 1;
      }
    }
    this.scheduleReplacement();
  }

  private attachWorker(worker: ChunkWorker): void {
    this.inlineFallback = false;
    const slot: WorkerSlot = { worker };
    worker.addEventListener("message", (event) => {
      const request = slot.active;
      if (!request || request.id !== event.data.id) return;
      slot.active = undefined;
      this.replacementAttempts = 0;
      if (event.data.chunk) this.finish(request, () => request.resolve(event.data.chunk!));
      else this.finish(request, () => request.reject(new Error(event.data.error ?? "Chunk materialization failed")));
      this.dispatch();
    });
    worker.addEventListener("error", (event) => {
      if (!this.workers.includes(slot)) return;
      const error = new Error(event.message || "Chunk materialization worker failed");
      if (slot.active) this.finish(slot.active, () => slot.active?.reject(error));
      slot.active = undefined;
      worker.terminate();
      const index = this.workers.indexOf(slot);
      if (index >= 0) this.workers.splice(index, 1);
      this.scheduleReplacement();
      this.dispatch();
    });
    this.workers.push(slot);
  }

  private finish(request: MaterializationRequest, settle: () => void): void {
    if (request.settled) return;
    request.settled = true;
    if (request.abort) request.signal?.removeEventListener("abort", request.abort);
    settle();
  }

  private dispatch(): void {
    if (this.destroyed) return;
    for (const slot of this.workers) {
      if (slot.active) continue;
      let request = this.queue.shift();
      while (request && (request.settled || request.signal?.aborted)) {
        const skipped = request;
        if (!skipped.settled) this.finish(skipped, () => skipped.reject(abortError()));
        request = this.queue.shift();
      }
      if (!request) return;
      slot.active = request;
      try {
        slot.worker.postMessage({ id: request.id, payload: request.payload, terrainSamples: request.terrainSamples });
      } catch (error) {
        slot.active = undefined;
        this.finish(request, () => request.reject(error instanceof Error ? error : new Error("Chunk materialization worker failed")));
        slot.worker.terminate();
        const index = this.workers.indexOf(slot);
        if (index >= 0) this.workers.splice(index, 1);
        this.scheduleReplacement();
        this.dispatch();
        return;
      }
    }
    if (this.inlineFallback && !this.inlineActive) {
      let request = this.queue.shift();
      while (request && (request.settled || request.signal?.aborted)) {
        const skipped = request;
        if (!skipped.settled) this.finish(skipped, () => skipped.reject(abortError()));
        request = this.queue.shift();
      }
      if (!request) return;
      const active = request;
      this.inlineActive = active;
      void import("../shared/world-chunk-payload")
        .then(({ materializeChunkPayload }) => materializeChunkPayload(active.payload, active.terrainSamples))
        .then(
          (chunk) => this.finish(active, () => active.resolve(chunk)),
          (error: unknown) => this.finish(active, () => active.reject(error instanceof Error ? error : new Error("Chunk materialization failed"))),
        )
        .finally(() => {
          if (this.inlineActive === active) this.inlineActive = undefined;
          this.dispatch();
        });
    }
  }

  private scheduleReplacement(): void {
    if (this.destroyed || this.workers.length >= this.targetWorkerCount || this.replacementTimer) return;
    if (this.replacementAttempts >= 3) {
      if (this.workers.length === 0) {
        this.inlineFallback = true;
        this.dispatch();
      }
      return;
    }
    const replace = () => {
      this.replacementTimer = undefined;
      if (this.destroyed || this.workers.length >= this.targetWorkerCount) return;
      try {
        this.attachWorker(this.workerFactory());
        this.replacementAttempts = 0;
      } catch {
        this.replacementAttempts += 1;
        this.scheduleReplacement();
        return;
      }
      this.dispatch();
      this.scheduleReplacement();
    };
    const delay = this.replacementAttempts === 0 ? 0 : Math.min(1_000, 50 * (2 ** (this.replacementAttempts - 1)));
    if (delay === 0) replace();
    else this.replacementTimer = setTimeout(replace, delay);
  }

  materialize(payload: ChunkPayloadDto, signal?: AbortSignal, terrainSamples?: Uint8Array): Promise<ChunkDto> {
    if (this.destroyed) return Promise.reject(new DOMException("Chunk materializer disposed", "AbortError"));
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const request: MaterializationRequest = {
        id: this.nextRequestId++, payload, terrainSamples, resolve, reject, signal, settled: false,
      };
      const abort = () => {
        if (request.settled) return;
        const queuedIndex = this.queue.indexOf(request);
        if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
        const slot = this.workers.find((candidate) => candidate.active === request);
        if (slot) {
          slot.active = undefined;
          slot.worker.terminate();
          const workerIndex = this.workers.indexOf(slot);
          if (workerIndex >= 0) this.workers.splice(workerIndex, 1);
          this.scheduleReplacement();
        }
        this.finish(request, () => request.reject(abortError()));
        if (this.inlineActive !== request) this.dispatch();
      };
      request.abort = abort;
      signal?.addEventListener("abort", abort, { once: true });
      while (this.queue.length >= ChunkMaterializer.QUEUE_LIMIT) {
        const stale = this.queue.shift();
        if (stale && !stale.settled) this.finish(stale, () => stale.reject(abortError()));
      }
      this.queue.push(request);
      this.dispatch();
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.replacementTimer) clearTimeout(this.replacementTimer);
    for (const slot of this.workers) {
      slot.worker.terminate();
      if (slot.active) this.finish(slot.active, () => slot.active?.reject(new DOMException("Chunk materializer disposed", "AbortError")));
    }
    if (this.inlineActive) this.finish(this.inlineActive, () => this.inlineActive?.reject(new DOMException("Chunk materializer disposed", "AbortError")));
    this.inlineActive = undefined;
    for (const request of this.queue) this.finish(request, () => request.reject(new DOMException("Chunk materializer disposed", "AbortError")));
    this.queue.length = 0;
    this.workers.length = 0;
  }
}
