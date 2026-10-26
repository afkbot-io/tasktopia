import { describe, expect, it } from "vitest";
import { drainGroundBakeFrame, type GroundBakeWork } from "../src/client/ground-bake-budget";
import { mapPaddingWorkPriority, type MapPaddingWorkKind, visibleMapPaddingReady, waitForVisibleMapWork } from "../src/client/map-frame-work";

function wakeSource() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (wake: () => void) => { listeners.add(wake); return () => { listeners.delete(wake); }; },
    wake: () => { for (const listener of [...listeners]) listener(); },
    get subscriptions() { return listeners.size; },
  };
}

describe("visible map padding priority", () => {
  const kinds: MapPaddingWorkKind[] = ["terrain-sample", "terrain-bake", "tree-sample", "tree-create", "road-bake"];

  it("completes every required visible work kind before any invisible prewarming", () => {
    const firstBackground = Math.min(...kinds.map(kind => mapPaddingWorkPriority(kind, false)));
    for (const kind of kinds) expect(mapPaddingWorkPriority(kind, true), kind).toBeLessThan(firstBackground);
  });

  it.each(["tree-sample", "tree-create"] as const)("runs newly visible %s before older halo bakes within one interactive job", kind => {
    const completed: string[] = [];
    let targetVisible = false;
    const work = (id: string, workKind: MapPaddingWorkKind, visible: () => boolean): GroundBakeWork<string> => ({
      priority: () => mapPaddingWorkPriority(workKind, visible()),
      valid: () => true,
      task: () => id,
      resolve: result => { if (result) completed.push(result); },
      reject: error => { throw error; },
    });
    const queue = [work("halo-terrain", "terrain-bake", () => false), work("halo-road", "road-bake", () => false),
      work("target-trees", kind, () => targetVisible)];
    targetVisible = true;

    expect(drainGroundBakeFrame(queue, false, () => 0)).toEqual({ completed: 1, elapsedMs: 0 });
    expect(completed).toEqual(["target-trees"]);
    expect(queue).toHaveLength(2);
    drainGroundBakeFrame(queue, false, () => 0);
    expect(completed).toEqual(["target-trees", "halo-terrain"]);
    expect(queue).toHaveLength(1);
  });
});

describe("first map frame", () => {
  it("does not wait for invisible prewarming", async () => {
    const work = new Map<Promise<void>, string>([[new Promise(() => {}), "outside"]]);
    await waitForVisibleMapWork(work, () => new Set(["visible"]), () => true);
  });
  it("releases a former visible page when the latest camera page is already ready", async () => {
    let finishA!: () => void, finishedA = false, finishedWait = false;
    const pageA = new Promise<void>(resolve => { finishA = resolve; });
    const work = new Map<Promise<void>, string>([[pageA, "A"]]);
    void pageA.then(() => { finishedA = true; work.delete(pageA); });
    let visible = new Set(["A"]);
    const changes = wakeSource();
    const waiting = waitForVisibleMapWork(work, () => visible, () => true, changes.subscribe)
      .then(() => { finishedWait = true; });
    // A real pan changes the required page. B has no outstanding work, while
    // A remains valid background prewarming and must not hold B's camera.
    visible = new Set(["B"]);
    changes.wake();
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(finishedA).toBe(false);
      expect(finishedWait).toBe(true);
      expect(changes.subscriptions).toBe(0);
    } finally {
      finishA();
      await waiting;
    }
  });
  it("still waits for nested work required by the latest page after a visibility wake", async () => {
    let finishA!: () => void, finishTerrain!: () => void, finishTrees!: () => void, finishedWait = false;
    const pageA = new Promise<void>(resolve => { finishA = resolve; });
    const trees = new Promise<void>(resolve => { finishTrees = resolve; });
    const work = new Map<Promise<void>, string>([[pageA, "A"]]);
    const terrain = new Promise<void>(resolve => { finishTerrain = resolve; }).then(() => {
      work.delete(terrain); work.set(trees, "B");
      void trees.then(() => work.delete(trees));
    });
    work.set(terrain, "B");
    let visible = new Set(["A"]);
    const changes = wakeSource();
    const waiting = waitForVisibleMapWork(work, () => visible, () => true, changes.subscribe)
      .then(() => { finishedWait = true; });
    visible = new Set(["B"]); changes.wake();
    try {
      finishTerrain();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(finishedWait).toBe(false);
      finishTrees(); await waiting;
      expect(finishedWait).toBe(true);
      expect(changes.subscriptions).toBe(0);
    } finally {
      finishA(); finishTerrain(); finishTrees(); await waiting;
    }
  });
  it("propagates a still visible job failure and releases its wake subscription", async () => {
    let fail!: (error: Error) => void;
    const failure = new Error("Visible terrain failed");
    const job = new Promise<void>((_, reject) => { fail = reject; });
    const changes = wakeSource();
    const waiting = waitForVisibleMapWork(new Map([[job, "visible"]]), () => new Set(["visible"]), () => true, changes.subscribe);
    const rejected = expect(waiting).rejects.toBe(failure);
    fail(failure); await rejected;
    expect(changes.subscriptions).toBe(0);
  });
  it("does not reject the ready latest page when former visible work fails after moving offscreen", async () => {
    let failA!: (error: Error) => void;
    const pageA = new Promise<void>((_, reject) => { failA = reject; });
    let visible = new Set(["A"]);
    const changes = wakeSource();
    const waiting = waitForVisibleMapWork(new Map([[pageA, "A"]]), () => visible, () => true, changes.subscribe);
    visible = new Set(["B"]); changes.wake();
    failA(new Error("Former visible prewarming failed"));
    await waiting;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(changes.subscriptions).toBe(0);
  });
  it("releases an invalidated owner without waiting for its old job or retaining a subscription", async () => {
    let finish!: () => void, finishedJob = false, active = true;
    const job = new Promise<void>(resolve => { finish = resolve; });
    void job.then(() => { finishedJob = true; });
    const changes = wakeSource();
    const waiting = waitForVisibleMapWork(new Map([[job, "visible"]]), () => new Set(["visible"]), () => active, changes.subscribe);
    active = false; changes.wake();
    try {
      await waiting;
      expect(finishedJob).toBe(false);
      expect(changes.subscriptions).toBe(0);
    } finally { finish(); await job; }
  });
  it("waits for terrain and the tree job it creates before publishing", async () => {
    let finishTerrain!: () => void, finishTrees!: () => void;
    const work = new Map<Promise<void>, string>();
    const trees = new Promise<void>(resolve => { finishTrees = resolve; });
    const terrain = new Promise<void>(resolve => { finishTerrain = resolve; }).then(() => {
      work.delete(terrain); work.set(trees, "visible");
      void trees.then(() => work.delete(trees));
    });
    work.set(terrain, "visible");
    let ready = false;
    const result = waitForVisibleMapWork(work, () => new Set(["visible"]), () => true).then(() => { ready = true; });
    finishTerrain();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ready).toBe(false);
    finishTrees(); await result;
    expect(ready).toBe(true);
  });
});

it("requires a successful visible exterior road overlay, while accepting genuinely empty road padding", () => {
  const terrainAndTrees = {terrainView:{},treeViews:[]};
  expect(visibleMapPaddingReady({...terrainAndTrees,roads:{},roadComplete:true,roadFailed:true})).toBe(false);
  expect(visibleMapPaddingReady({...terrainAndTrees,roads:{},roadComplete:false})).toBe(false);
  expect(visibleMapPaddingReady({...terrainAndTrees,roads:{},roadComplete:true})).toBe(false);
  expect(visibleMapPaddingReady({...terrainAndTrees,roads:{},roadComplete:true,overlayView:{}})).toBe(true);
  expect(visibleMapPaddingReady({...terrainAndTrees,roadComplete:true})).toBe(true);
  expect(visibleMapPaddingReady(undefined)).toBe(false);
  expect(visibleMapPaddingReady({treeViews:[]})).toBe(false);
  expect(visibleMapPaddingReady({terrainView:{}})).toBe(false);
});
