import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { startPushDeliveryWorker } from "../src/server/push-delivery";

describe("push worker backpressure and shutdown", () => {
  afterEach(() => vi.useRealTimers());
  it("coalesces slow poll ticks and stops after the in-flight delivery instead of draining queued batches", async () => {
    vi.useFakeTimers();
    const row = { id: 1, attempts: 0, payload_json: {}, subscription_id: "s", endpoint: "https://fcm.googleapis.com/wp/test",
      p256dh: "key", auth: "auth", expiration_time: null, authorized: true };
    const db = {
      transaction: async (callback: () => unknown) => callback(),
      prepare: (query: string) => ({
        get: async () => query.includes("push_delivery_cursor_v1") ? { event_id: 0 } : row,
        all: async () => query.includes("FROM events") ? [] : [{ id: 1 }, { id: 2 }],
        run: async () => ({ changes: 1, rows: [] }),
      }),
    } as unknown as Db;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const send = vi.fn(async () => { await pending; return { statusCode: 201 }; });
    const worker = startPushDeliveryWorker(db, { send }, error => { throw error; }, 10)!;
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledOnce();
    const closing = worker.close(); release(); await closing;
    expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledOnce();
  });
});
