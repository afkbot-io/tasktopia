import { describe, expect, it, vi } from "vitest";
import { ChunkMaterializer, recommendedChunkWorkerCount, type ChunkWorker } from "../src/client/chunk-materializer";
import type { ChunkDto, ChunkPayloadDto } from "../src/shared/contracts";
import { materializeChunkPayload } from "../src/shared/world-chunk-payload";

function payload(chunkX: number): ChunkPayloadDto {
  return {
    payloadVersion: 1,
    contentHash: `hash-${chunkX}`,
    generatorVersion: "square-v7",
    terrainSeed: 42,
    publishedVersion: 1,
    lod: "OVERVIEW",
    chunkX,
    chunkY: 0,
    size: 64,
    roads: [], surfaces: [], districts: [], tasks: [], worldFeatures: [],
    decorationContext: { cityBounds: [], districts: [], tasks: [] },
  };
}

class FakeChunkWorker implements ChunkWorker {
  readonly posted: Array<{ id: number; payload: ChunkPayloadDto }> = [];
  terminated = false;
  private messageListener?: (event: MessageEvent<{ id: number; chunk?: ChunkDto; error?: string }>) => void;
  private errorListener?: (event: ErrorEvent) => void;

  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<{ id: number; chunk?: ChunkDto; error?: string }>) => void) | ((event: ErrorEvent) => void)): void {
    if (type === "message") this.messageListener = listener as (event: MessageEvent<{ id: number; chunk?: ChunkDto; error?: string }>) => void;
    else this.errorListener = listener as (event: ErrorEvent) => void;
  }

  postMessage(message: { id: number; payload: ChunkPayloadDto }): void { this.posted.push(message); }
  terminate(): void { this.terminated = true; }

  respond(index = 0): void {
    const request = this.posted[index]!;
    this.messageListener?.({ data: { id: request.id, chunk: materializeChunkPayload(request.payload) } } as MessageEvent);
  }

  fail(message: string): void { this.errorListener?.({ message } as ErrorEvent); }
}

describe("ChunkMaterializer", () => {
  it("uses additional desktop cores for a bounded whole-city decode", () => {
    expect(recommendedChunkWorkerCount(1)).toBe(1);
    expect(recommendedChunkWorkerCount(2)).toBe(1);
    expect(recommendedChunkWorkerCount(4)).toBe(2);
    expect(recommendedChunkWorkerCount(8)).toBe(4);
    expect(recommendedChunkWorkerCount(32)).toBe(4);
  });

  it("correlates out-of-order worker responses", async () => {
    const workers = [new FakeChunkWorker(), new FakeChunkWorker()];
    let cursor = 0;
    const materializer = new ChunkMaterializer(2, () => workers[cursor++]!);
    const first = materializer.materialize(payload(1));
    const second = materializer.materialize(payload(2));

    workers[1]!.respond();
    workers[0]!.respond();

    await expect(first).resolves.toMatchObject({ chunkX: 1, terrain: expect.any(Array) });
    await expect(second).resolves.toMatchObject({ chunkX: 2, terrain: expect.any(Array) });
    materializer.destroy();
  });

  it("isolates a failed worker, retries on the survivor, and rejects work on dispose", async () => {
    const workers = [new FakeChunkWorker(), new FakeChunkWorker()];
    let cursor = 0;
    const materializer = new ChunkMaterializer(2, () => workers[cursor++]!);
    const failed = materializer.materialize(payload(3));
    workers[0]!.fail("worker crashed");
    await expect(failed).rejects.toThrow("worker crashed");
    expect(workers[0]!.terminated).toBe(true);

    const retry = materializer.materialize(payload(4));
    workers[1]!.respond();
    await expect(retry).resolves.toMatchObject({ chunkX: 4 });

    const pending = materializer.materialize(payload(5));
    materializer.destroy();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(materializer.materialize(payload(6))).rejects.toMatchObject({ name: "AbortError" });
  });

  it("replaces the last crashed worker before materializing the next chunk", async () => {
    const workers = [new FakeChunkWorker(), new FakeChunkWorker()];
    let cursor = 0;
    const materializer = new ChunkMaterializer(1, () => workers[cursor++]!);
    const failed = materializer.materialize(payload(7));

    workers[0]!.fail("last worker crashed");

    await expect(failed).rejects.toThrow("last worker crashed");
    const recovered = materializer.materialize(payload(8));
    expect(workers[1]!.posted).toHaveLength(1);
    workers[1]!.respond();
    await expect(recovered).resolves.toMatchObject({
      chunkX: 8,
      terrain: expect.any(Array),
    });
    materializer.destroy();
  });

  it("drops a materialization result after its viewport request is aborted", async () => {
    const workers = [new FakeChunkWorker(), new FakeChunkWorker()];
    let cursor = 0;
    const materializer = new ChunkMaterializer(1, () => workers[cursor++]!);
    const controller = new AbortController();
    const stale = materializer.materialize(payload(9), controller.signal);

    controller.abort();

    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(true);
    workers[0]!.respond(0);

    const current = materializer.materialize(payload(10));
    expect(workers[1]!.posted.map((request) => request.payload.chunkX)).toEqual([10]);
    workers[1]!.respond(0);
    await expect(current).resolves.toMatchObject({ chunkX: 10 });
    materializer.destroy();
  });

  it("removes aborted queued work before dispatching the current chunk", async () => {
    const worker = new FakeChunkWorker();
    const materializer = new ChunkMaterializer(1, () => worker);
    const active = materializer.materialize(payload(11));
    const staleController = new AbortController();
    const stale = materializer.materialize(payload(12), staleController.signal);
    const current = materializer.materialize(payload(13));

    staleController.abort();
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.posted.map((request) => request.payload.chunkX)).toEqual([11]);

    worker.respond(0);
    await expect(active).resolves.toMatchObject({ chunkX: 11 });
    expect(worker.posted.map((request) => request.payload.chunkX)).toEqual([11, 13]);
    worker.respond(1);
    await expect(current).resolves.toMatchObject({ chunkX: 13 });
    materializer.destroy();
  });

  it("falls back inline when initial Worker construction throws", async () => {
    const materializer = new ChunkMaterializer(1, () => { throw new Error("workers unavailable"); });
    await expect(materializer.materialize(payload(14))).resolves.toMatchObject({ chunkX: 14 });
    materializer.destroy();
  });

  it("restores a two-worker pool after two crashes and a transient factory failure", async () => {
    vi.useFakeTimers();
    try {
      const workers = [new FakeChunkWorker(), new FakeChunkWorker(), new FakeChunkWorker(), new FakeChunkWorker()];
      let cursor = 0;
      let factoryCalls = 0;
      const materializer = new ChunkMaterializer(2, () => {
        factoryCalls += 1;
        if (factoryCalls === 4) throw new Error("transient factory failure");
        return workers[cursor++]!;
      });
      const first = materializer.materialize(payload(15));
      const second = materializer.materialize(payload(16));

      workers[0]!.fail("first crashed");
      workers[1]!.fail("second crashed");
      await expect(first).rejects.toThrow("first crashed");
      await expect(second).rejects.toThrow("second crashed");
      await vi.advanceTimersByTimeAsync(50);

      const recoveredA = materializer.materialize(payload(17));
      const recoveredB = materializer.materialize(payload(18));
      expect(workers[2]!.posted.map((request) => request.payload.chunkX)).toEqual([17]);
      expect(workers[3]!.posted.map((request) => request.payload.chunkX)).toEqual([18]);
      workers[2]!.respond(0);
      workers[3]!.respond(0);
      await expect(recoveredA).resolves.toMatchObject({ chunkX: 17 });
      await expect(recoveredB).resolves.toMatchObject({ chunkX: 18 });
      materializer.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains queued work through a bounded inline fallback after permanent worker failure", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeChunkWorker();
      let factoryCalls = 0;
      const materializer = new ChunkMaterializer(1, () => {
        factoryCalls += 1;
        if (factoryCalls === 1) return worker;
        throw new Error("workers permanently unavailable");
      });
      const failed = materializer.materialize(payload(19));
      const queued = materializer.materialize(payload(20));

      worker.fail("last worker crashed");

      await expect(failed).rejects.toThrow("last worker crashed");
      await vi.runAllTimersAsync();
      let queuedOutcome = "pending";
      void queued.then(
        () => { queuedOutcome = "resolved"; },
        () => { queuedOutcome = "rejected"; },
      );
      await Promise.resolve();
      expect(queuedOutcome).toBe("resolved");

      const requests = Array.from({ length: 34 }, (_, index) => materializer.materialize(payload(21 + index)));
      await expect(requests[1]).rejects.toMatchObject({ name: "AbortError" });
      await expect(requests[0]).resolves.toMatchObject({ chunkX: 21 });
      await expect(requests.at(-1)).resolves.toMatchObject({ chunkX: 54 });
      materializer.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
