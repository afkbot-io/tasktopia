import { describe, expect, it, vi } from "vitest";
import { TaskCardFocus, type TaskCardFocusScope } from "../src/client/task-card-focus";

const scope = (): TaskCardFocusScope => ({ authenticationEpoch: 1, sessionGeneration: 2, navigationRequest: 3,
  countryId: "country", cityId: "city", taskId: "task" });
const ready = { id: "task", countryId: "country", cityId: "city" };
function harness() {
  let id = 0; const callbacks = new Map<number, FrameRequestCallback>(), cancelled: FrameRequestCallback[] = [];
  const owner = new TaskCardFocus(callback => { callbacks.set(++id, callback); return id; }, key => {
    const callback = callbacks.get(key); if (callback) cancelled.push(callback); callbacks.delete(key);
  });
  return { owner, callbacks, tick: () => { const next = [...callbacks.values()]; callbacks.clear(); for (const callback of next) callback(0); },
    stale: () => { for (const callback of cancelled.splice(0)) callback(0); } };
}

describe("card-first owned map focus", () => {
  it("waits for the matching real card and two owned frames without extending on duplicate readiness", () => {
    const h = harness(), apply = vi.fn(), current = scope(); h.owner.queue(current, apply, () => current);
    expect(apply).not.toHaveBeenCalled(); h.owner.ready({ ...ready, id: "old" }); expect(h.callbacks.size).toBe(0);
    h.owner.ready(ready); expect(h.callbacks.size).toBe(1); h.owner.ready(ready); expect(h.callbacks.size).toBe(1);
    h.tick(); expect(apply).not.toHaveBeenCalled(); h.owner.ready(ready); h.tick();
    expect(apply).toHaveBeenCalledTimes(1); h.owner.ready(ready); h.tick(); expect(apply).toHaveBeenCalledTimes(1);
  });
  it.each(["authenticationEpoch", "sessionGeneration", "navigationRequest", "countryId", "cityId", "taskId"] as const)("fences a changed %s between heading and final focus", field => {
      const h = harness(), apply = vi.fn(), expected = scope(); let current = expected;
      h.owner.queue(expected, apply, () => current); h.owner.ready(ready); h.tick();
      current = { ...current, [field]: typeof current[field] === "number" ? 99 : "changed" };
      h.tick(); expect(apply).not.toHaveBeenCalled(); expect(h.callbacks.size).toBe(0);
    });
  it.each(["cancel", "dispose"] as const)("prevents late and already-queued frames after %s", action => {
    const h = harness(), apply = vi.fn(), current = scope();
    h.owner.queue(current, apply, () => current); h.owner.ready(ready); h.tick(); h.owner[action](); h.stale(); h.tick();
    expect(apply).not.toHaveBeenCalled(); expect(h.callbacks.size).toBe(0);
    h.owner.ready(ready); h.tick(); expect(apply).not.toHaveBeenCalled();
  });
  it("replaces an older search and cannot focus the old card even if its cancelled frame runs", () => {
    const h = harness(), first = vi.fn(), second = vi.fn(); let current = scope();
    h.owner.queue(current, first, () => current); h.owner.ready(ready); h.tick();
    current = { ...current, taskId: "second", navigationRequest: 4 };
    h.owner.queue(current, second, () => current); h.stale(); h.owner.ready(ready); h.tick();
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    h.owner.ready({ ...ready, id: "second" }); h.tick(); h.tick(); expect(second).toHaveBeenCalledTimes(1);
  });
  it("cancels stale rendered scope and never revives a disposed owner", () => {
    const h = harness(), apply = vi.fn(); let current: TaskCardFocusScope | undefined = scope();
    h.owner.queue(current, apply, () => current); h.owner.ready(ready); current = undefined; h.owner.cancelIfStale();
    h.stale(); h.tick(); expect(apply).not.toHaveBeenCalled(); h.owner.dispose();
    current = scope(); h.owner.queue(current, apply, () => current); h.owner.ready(ready); h.tick(); h.tick(); expect(apply).not.toHaveBeenCalled();
  });
  it("reuses a cancelled owner after effect cleanup without retaining the previous frames", () => {
    const h = harness(), old = vi.fn(), next = vi.fn(), current = scope();
    h.owner.queue(current, old, () => current); h.owner.ready(ready); h.owner.cancel();
    h.owner.queue(current, next, () => current); h.stale(); h.owner.ready(ready); h.tick(); h.tick();
    expect(old).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1); expect(h.callbacks.size).toBe(0);
  });
});
