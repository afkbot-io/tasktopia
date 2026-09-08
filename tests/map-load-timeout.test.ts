import { describe, expect, it, vi } from "vitest";
import { loadMapWithTimeout } from "../src/client/map-load-timeout";

describe("map resource deadline", () => {
  it("aborts a stalled read and lets a fresh retry succeed", async () => {
    vi.useFakeTimers();
    try {
      let signal!: AbortSignal;
      const pending = loadMapWithTimeout(s => { signal=s; return new Promise(() => {}); });
      const outcome = pending.catch(error => error.message);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await outcome).toContain("слишком долго");
      expect(signal.aborted).toBe(true);
      await expect(loadMapWithTimeout(async () => 42)).resolves.toBe(42);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("preserves ordinary errors and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      await expect(loadMapWithTimeout(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
