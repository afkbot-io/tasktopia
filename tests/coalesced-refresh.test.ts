import { expect, it, vi } from "vitest";
import { CoalescedRefresh } from "../src/client/coalesced-refresh";

it("coalesces an in-flight burst and still fetches once after the later invalidation", async () => {
  const queue = new CoalescedRefresh();
  let resolve!: () => void;
  const work = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { resolve = done; })).mockResolvedValue(undefined);
  const first = queue.request(work);
  const later = queue.request(work);
  queue.request(work);
  expect(work).toHaveBeenCalledTimes(1);
  expect(later).toBe(first);
  resolve();
  await first;
  expect(work).toHaveBeenCalledTimes(2);
  await queue.request(work);
  expect(work).toHaveBeenCalledTimes(3);
});

it("releases the queue after a failed request so an explicit retry can succeed", async () => {
  const queue = new CoalescedRefresh();
  await expect(queue.request(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  await expect(queue.request(async () => undefined)).resolves.toBeUndefined();
});
