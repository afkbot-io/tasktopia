import { describe, expect, it } from "vitest";
import { bindMapPointerGestures, MapPointerGestureTracker } from "../src/client/map-pointer-gesture";

describe("map pointer gesture tracker", () => {
  it("translates one active pointer into incremental pan", () => {
    const tracker = new MapPointerGestureTracker();
    tracker.start(11, { x: 20, y: 30 });
    expect(tracker.move(11, { x: 27, y: 26 })).toEqual({
      center: { x: 27, y: 26 }, panX: 7, panY: -4, scale: 1, pointers: 1, moved: true,
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
      moved: true,
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

  it("recognizes a slow drag from its origin, not each individual event delta", () => {
    const tracker = new MapPointerGestureTracker();
    tracker.start(1, { x: 10, y: 10 });
    expect(tracker.move(1, { x: 11, y: 10 })).toMatchObject({ moved: false, panX: 1 });
    expect(tracker.move(1, { x: 12, y: 10 })).toMatchObject({ moved: false, panX: 1 });
    expect(tracker.move(1, { x: 13, y: 10 })).toMatchObject({ moved: true, panX: 1 });
    expect(tracker.move(1, { x: 10, y: 10 })).toMatchObject({ moved: true });
    tracker.end(1);
    tracker.start(2, { x: 10, y: 10 });
    expect(tracker.move(2, { x: 11, y: 10 })).toMatchObject({ moved: false });
  });

  it("does not accumulate stationary jitter into a drag", () => {
    const tracker = new MapPointerGestureTracker();
    tracker.start(1, { x: 10, y: 10 });
    for (let i = 0; i < 20; i++) {
      expect(tracker.move(1, { x: 10 + i % 2, y: 10 })).toMatchObject({ moved: false });
    }
  });

  it("retains movement through pinch rebasing and resets after cancellation", () => {
    const tracker = new MapPointerGestureTracker();
    tracker.start(1, { x: 10, y: 10 });
    tracker.start(2, { x: 20, y: 10 });
    tracker.end(2);
    expect(tracker.move(1, { x: 10, y: 10 })).toMatchObject({ moved: true });
    tracker.cancel();
    tracker.start(3, { x: 10, y: 10 });
    expect(tracker.move(3, { x: 10, y: 10 })).toMatchObject({ moved: false });
  });

  it("reports a slow bound gesture once at release and preserves the next click", () => {
    const element = new EventTarget();
    const ended: boolean[] = [];
    const dispose = bindMapPointerGestures(element as HTMLElement, () => {}, { onEnd: moved => ended.push(moved) });
    const pointer = (type: string, x: number) => element.dispatchEvent(Object.assign(new Event(type), {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: 10,
    }));
    pointer("pointerdown", 10);
    for (let x = 11; x <= 20; x++) pointer("pointermove", x);
    pointer("pointerup", 20);
    pointer("lostpointercapture", 20);
    pointer("pointerdown", 20);
    pointer("pointerup", 20);
    expect(ended).toEqual([true, false]);
    dispose();
    pointer("pointerdown", 20); pointer("pointerup", 20);
    expect(ended).toEqual([true, false]);
  });

  it("announces navigation before the first finger releases, without inventing a camera transform", () => {
    const element = new EventTarget();
    const events: string[] = [];
    const dispose = bindMapPointerGestures(element as HTMLElement, () => events.push("transform"), {
      onNavigationStart: () => events.push("navigation"),
      onEnd: moved => events.push(`end:${moved}`),
    });
    const pointer = (type: string, pointerId: number) => element.dispatchEvent(Object.assign(new Event(type), {
      pointerId, pointerType: "touch", button: 0, clientX: pointerId * 10, clientY: 10,
    }));
    pointer("pointerdown", 1);
    expect(events).toEqual([]);
    pointer("pointerdown", 2);
    expect(events).toEqual(["navigation"]);
    pointer("pointerup", 1);
    expect(events).toEqual(["navigation"]);
    pointer("pointerup", 2);
    expect(events).toEqual(["navigation", "end:true"]);
    pointer("pointerdown", 3); pointer("pointerup", 3);
    expect(events).toEqual(["navigation", "end:true", "end:false"]);
    dispose();
  });
});
