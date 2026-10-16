import { expect, it } from "vitest";
import { CityCameraPresentation } from "../src/client/city-camera-presentation";

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
