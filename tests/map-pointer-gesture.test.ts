import { describe, expect, it } from "vitest";
import { MapPointerGestureTracker } from "../src/client/map-pointer-gesture";

describe("map pointer gesture tracker", () => {
  it("translates one active pointer into incremental pan", () => {
    const tracker = new MapPointerGestureTracker();
    tracker.start(11, { x: 20, y: 30 });
    expect(tracker.move(11, { x: 27, y: 26 })).toEqual({
      center: { x: 27, y: 26 }, panX: 7, panY: -4, scale: 1, pointers: 1,
    });
    expect(tracker.move(11, { x: 30, y: 31 })).toMatchObject({ panX: 3, panY: 5, scale: 1 });
  });

  it("combines two pointers into midpoint pan and continuous pinch scale", () => {
    const tracker = new MapPointerGestureTracker();
    tracker.start(1, { x: 10, y: 20 });
    tracker.start(2, { x: 30, y: 20 });
    expect(tracker.move(2, { x: 40, y: 30 })).toEqual({
      center: { x: 25, y: 25 }, panX: 5, panY: 5,
      scale: Math.hypot(30, 10) / 20,
      pointers: 2,
    });
  });

  it("rebases the remaining pointer after pointerup and clears canceled gestures", () => {
    const tracker = new MapPointerGestureTracker();
    tracker.start(1, { x: 10, y: 10 });
    tracker.start(2, { x: 20, y: 10 });
    tracker.end(2);
    expect(tracker.move(1, { x: 12, y: 13 })).toMatchObject({ panX: 2, panY: 3, pointers: 1 });
    tracker.cancel();
    expect(tracker.move(1, { x: 20, y: 20 })).toBeNull();
    expect(tracker.pointerCount).toBe(0);
  });
});
