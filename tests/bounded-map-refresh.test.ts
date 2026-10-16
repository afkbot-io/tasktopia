import { afterEach, expect, it, vi } from "vitest";
import { BoundedMapRefresh } from "../src/client/bounded-map-refresh";

afterEach(() => vi.useRealTimers());

it("bounds a hung read, aborts its transport and permits a real retry", async () => {
  vi.useFakeTimers();
  const refresh = new BoundedMapRefresh(50);
  let signal!: AbortSignal;
  const hung = refresh.request(current => { signal = current; return new Promise<void>(() => undefined); });
  let failure: unknown;
  void hung.catch(error => { failure = error; });
  await vi.advanceTimersByTimeAsync(50);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain("слишком долго");
  expect(signal.aborted).toBe(true);
  let reads = 0;
  await refresh.request(async () => { reads++; });
  expect(reads).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("coalesces a burst into one trailing read and cancels a hidden or disposed owner", async () => {
  vi.useFakeTimers();
  const refresh = new BoundedMapRefresh(100);
  let finish!: () => void;
  let reads = 0;
  const work = async () => { reads++; if (reads === 1) await new Promise<void>(resolve => { finish = resolve; }); };
  const first = refresh.request(work);
  expect(refresh.request(work)).toBe(first);
  expect(refresh.request(work)).toBe(first);
  await vi.advanceTimersByTimeAsync(0);
  finish();
  await first;
  expect(reads).toBe(2);
  const pending = refresh.request(() => new Promise<void>(() => undefined));
  const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  refresh.cancel();
  await cancelled;
  await refresh.request(async () => undefined);
  refresh.dispose();
  await expect(refresh.request(async () => undefined)).rejects.toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});
