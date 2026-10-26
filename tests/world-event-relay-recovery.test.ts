import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { consumeDurableWorldEvents, subscribeToWorldEvents } from "../src/server/world-event-relay";

const transport = vi.hoisted(() => ({
  notify: undefined as ((payload: string) => void) | undefined,
  unlisten: vi.fn(), end: vi.fn(),
}));
vi.mock("postgres", () => ({ default: () => ({
  listen: async (_channel: string, notify: (payload: string) => void) => {
    transport.notify = notify;
    return { unlisten: transport.unlisten };
  },
  end: transport.end,
}) }));

function fixtureDb(head: () => Promise<unknown>, rows: () => Promise<unknown[]>): Db {
  return { prepare: (query: string) => ({ get: head, all: async () => {
    if (!query.includes("FROM countries")) return rows();
    const value = await head() as Record<string, unknown>;
    return [{ country_id: "country", ...value }];
  } }) } as unknown as Db;
}
const row = { id: 7, country_id: "country", type: "task.comment_added", world_version: 1,
  payload_json: {}, created_at: "2026-10-16T00:00:00.000Z" };

describe("durable event recovery after transient database failures", () => {
  let subscription: { close(): Promise<void> } | undefined;
  beforeEach(() => {
    vi.useFakeTimers(); transport.notify = undefined;
    transport.unlisten.mockReset().mockResolvedValue(undefined);
    transport.end.mockReset().mockResolvedValue(undefined);
  });
  afterEach(async () => { await subscription?.close(); subscription = undefined; vi.useRealTimers(); });

  it("reports a failed poll immediately and replays the gap after recovery", async () => {
    const failure = new Error("database temporarily unavailable");
    const head = vi.fn().mockResolvedValueOnce({ id: 0 }).mockRejectedValueOnce(failure).mockResolvedValue({ id: 7 });
    const rows = vi.fn().mockResolvedValue([row]);
    const delivered: number[] = [];
    const onError = vi.fn();
    subscription = await consumeDurableWorldEvents(fixtureDb(head, rows), "postgres://fixture",
      event => { delivered.push(event.id); }, 10, onError);
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(40);
    expect(delivered).toEqual([7]);
  });

  it("keeps its cursor when draining fails and retries without a later notification", async () => {
    const failure = new Error("event row temporarily unavailable");
    const rows = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue([row]);
    const delivered: number[] = [];
    const onError = vi.fn();
    subscription = await consumeDurableWorldEvents(
      fixtureDb(vi.fn().mockResolvedValueOnce({ id: 0 }).mockResolvedValue({ id: 7 }), rows), "postgres://fixture",
      event => { delivered.push(event.id); }, 10, onError);
    transport.notify?.("7");
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(50);
    expect(delivered).toEqual([7]);
  });

  it("does not overlap slow polls or leave a poll running after close", async () => {
    let release!: (value: unknown) => void;
    const head = vi.fn().mockResolvedValueOnce({ id: 0 }).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    subscription = await consumeDurableWorldEvents(fixtureDb(head, vi.fn().mockResolvedValue([])), "postgres://fixture", vi.fn(), 10);
    await vi.advanceTimersByTimeAsync(60);
    expect(head).toHaveBeenCalledTimes(2);
    const closing = subscription.close();
    release({ id: 7 });
    await closing;
    await vi.advanceTimersByTimeAsync(100);
    expect(head).toHaveBeenCalledTimes(2);
  });

  it("closes LISTEN resources if initial baseline acquisition fails", async () => {
    const failure = new Error("baseline unavailable");
    await expect(consumeDurableWorldEvents(fixtureDb(vi.fn().mockRejectedValue(failure), vi.fn()),
      "postgres://fixture", vi.fn())).rejects.toThrow(failure);
    expect(transport.unlisten).toHaveBeenCalledTimes(1);
    expect(transport.end).toHaveBeenCalledTimes(1);
  });

  it("handles an asynchronous notification callback failure immediately", async () => {
    const failure = new Error("notification consumer failed");
    const onError = vi.fn();
    subscription = await subscribeToWorldEvents("postgres://fixture", async () => { throw failure; }, onError);
    transport.notify?.("7");
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("drains paged backlogs in country order without starving another country", async () => {
    const heads = vi.fn().mockResolvedValueOnce([{ country_id: "a", id: 0 }, { country_id: "b", id: 0 }])
      .mockResolvedValue([{ country_id: "a", id: 1_200 }, { country_id: "b", id: 2_000 }]);
    const events = Array.from({ length: 1_200 }, (_, index) => ({ ...row, country_id: "a", id: index + 1 }))
      .concat({ ...row, country_id: "b", id: 2_000 });
    const db = { prepare: (query: string) => ({ all: async (countryId: string, after: number, target: number) => {
      if (query.includes("FROM countries")) return heads();
      return events.filter(event => event.country_id === countryId && event.id > after && event.id <= target).slice(0, 500);
    } }) } as unknown as Db;
    const delivered: number[] = [];
    subscription = await consumeDurableWorldEvents(db, "postgres://fixture", event => { delivered.push(event.id); }, 10);
    await vi.advanceTimersByTimeAsync(30);
    expect(delivered).toHaveLength(1_201);
    expect(delivered.filter(id => id !== 2_000)).toEqual(Array.from({ length: 1_200 }, (_, index) => index + 1));
    expect(delivered.indexOf(2_000)).toBeLessThan(delivered.indexOf(501));
  });
});
