import { describe, expect, it } from "vitest";
import { drainGroundBakeFrame, type GroundBakeWork } from "../src/client/ground-bake-budget";
import { mapPaddingWorkPriority, type MapPaddingWorkKind, visibleMapPaddingReady, waitForVisibleMapWork } from "../src/client/map-frame-work";

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
