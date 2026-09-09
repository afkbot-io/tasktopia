import { describe, expect, it } from "vitest";
import { waitForVisibleMapWork } from "../src/client/map-frame-work";

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
