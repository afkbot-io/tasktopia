import { describe, expect, it, vi } from "vitest";
import { drainGroundBakeFrame, type GroundBakeWork } from "../src/client/ground-bake-budget";

function fixture(costs: number[]) {
  let time = 0;
  const results: Array<number | undefined> = [];
  const errors: unknown[] = [];
  const queue: GroundBakeWork<number>[] = costs.map((cost, index) => ({
    valid: () => true,
    task: () => { time += cost; return index; },
    resolve: result => { results.push(result); },
    reject: error => { errors.push(error); },
  }));
  return { queue, results, errors, clock: () => time };
}

describe("initial atomic CITY ground frame budget", () => {
  it("completes newly ready visible material before queued halo captures, with one interactive job per frame", () => {
    const result: string[] = [];
    const queue: Array<GroundBakeWork<string> & { priority: () => number }> = [];
    const work = (id: string, priority: () => number, task = () => id) => ({ valid: () => true, priority, task,
      resolve: (value: string | undefined) => { if (value) result.push(value); }, reject: (error: unknown) => { throw error; } });
    queue.push(work("visible-sample", () => 1, () => {
      queue.push(work("visible-bake", () => 0)); return "visible-sample";
    }), work("halo-sample", () => 3), work("halo-bake", () => 2));
    expect(drainGroundBakeFrame(queue, false).completed).toBe(1);
    expect(drainGroundBakeFrame(queue, false).completed).toBe(1);
    expect(result).toEqual(["visible-sample", "visible-bake"]);
    let nowVisible = false;
    queue.push(work("newly-visible", () => nowVisible ? 0 : 4)); nowVisible = true;
    drainGroundBakeFrame(queue, false);
    expect(result.at(-1)).toBe("newly-visible");
    expect(queue).toHaveLength(2);
  });
  it("prepares up to three cheap jobs in FIFO order before the first frame", () => {
    const work = fixture([.5, .5, .5, .5]);
    expect(drainGroundBakeFrame(work.queue, true, work.clock)).toMatchObject({ completed: 3, elapsedMs: 1.5 });
    expect(work.results).toEqual([0, 1, 2]);
    expect(work.queue).toHaveLength(1);
  });
  it("stops at the four-millisecond deadline instead of consuming the entire initial queue", () => {
    const work = fixture([2, 2, 2]);
    expect(drainGroundBakeFrame(work.queue, true, work.clock)).toMatchObject({ completed: 2, elapsedMs: 4 });
    expect(work.results).toEqual([0, 1]);
    expect(work.queue).toHaveLength(1);
  });
  it("lets one non-preemptible slow job complete but never adds another behind it", () => {
    const work = fixture([6, .1]);
    expect(drainGroundBakeFrame(work.queue, true, work.clock)).toMatchObject({ completed: 1, elapsedMs: 6 });
    expect(work.results).toEqual([0]);
    expect(work.queue).toHaveLength(1);
  });
  it("keeps interactive and non-CITY frames limited to one job even when all jobs are cheap", () => {
    const work = fixture([.1, .1, .1]);
    expect(drainGroundBakeFrame(work.queue, false, work.clock)).toMatchObject({ completed: 1 });
    expect(work.results).toEqual([0]);
    expect(work.queue).toHaveLength(2);
  });
  it("does not execute cancelled work, isolates failures, and leaves the following frame recoverable", () => {
    const work = fixture([.1, .1, .1, .1]);
    const cancelledTask = vi.fn(() => 99);
    work.queue[0] = { ...work.queue[0]!, valid: () => false, task: cancelledTask };
    const failure = new Error("texture allocation failed");
    work.queue[1]!.task = () => { throw failure; };
    drainGroundBakeFrame(work.queue, true, work.clock);
    expect(cancelledTask).not.toHaveBeenCalled();
    expect(work.errors).toEqual([failure]);
    expect(work.results).toEqual([undefined, 2]);
    drainGroundBakeFrame(work.queue, false, work.clock);
    expect(work.results).toEqual([undefined, 2, 3]);
  });
});
