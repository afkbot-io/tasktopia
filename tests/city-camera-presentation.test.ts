import { expect, it } from "vitest";
import { CityCameraPresentation } from "../src/client/city-camera-presentation";
import { cityResidentGroundReady } from "../src/client/city-ground-readiness";

it("preserves the last complete camera frame and commits the latest queued gesture only when ready", () => {
  const initial={x:0,y:0,scale:1};
  const camera=new CityCameraPresentation(initial);
  expect(camera.stage({x:100,y:50,scale:.8},()=>false)).toEqual(initial);
  expect(camera.stage({x:130,y:50,scale:.8},()=>false)).toEqual(initial);
  expect(camera.pending).toEqual({x:130,y:50,scale:.8});
  expect(camera.commitPending(()=>false)).toBeUndefined();
  expect(camera.commitPending(()=>true)).toEqual({x:130,y:50,scale:.8});
  expect(camera.pending).toBeUndefined();
});

it("retains the previous camera pose when fresh halo entities precede the actual ground commit", () => {
  const initial = { x: 0, y: 0, scale: 1 };
  const target = { x: 512, y: 0, scale: 1 };
  const camera = new CityCameraPresentation(initial);
  const ground = { terrainView: {}, overlayView: {} };
  let materializedLod: "DETAIL" | "OVERVIEW" | undefined;
  let invalidated = true;
  // Entity publication clears its dirty fence before deferred halo ground is ready.
  const ready = () => cityResidentGroundReady(ground, materializedLod, "DETAIL", invalidated, false);

  expect(camera.stage(target, ready)).toEqual(initial);
  expect(camera.pending).toEqual(target);
  materializedLod = "DETAIL";
  expect(camera.commitPending(ready)).toBeUndefined();
  expect(camera.pending).toEqual(target);
  invalidated = false;
  materializedLod = undefined;
  expect(camera.commitPending(ready)).toBeUndefined();
  expect(camera.pending).toEqual(target);

  // Only the actual resident ground commit restores the materialized DETAIL fence.
  materializedLod = "DETAIL";
  expect(camera.commitPending(ready)).toEqual(target);
  expect(camera.pending).toBeUndefined();
});
