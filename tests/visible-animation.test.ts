import { afterEach, expect, it, vi } from "vitest";
import { startVisibleAnimation } from "../src/client/visible-animation";

afterEach(() => vi.unstubAllGlobals());
it("owns one loop, pauses live visibility/motion changes and resumes without background delta", () => {
  const page = Object.assign(new EventTarget(), { hidden: false });
  const motion = Object.assign(new EventTarget(), { matches: false });
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", { matchMedia: () => motion });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  const render = vi.fn();
  const stop = startVisibleAnimation(render);
  const frame = (time: number) => {
    expect(callbacks.size).toBe(1);
    const [id, callback] = [...callbacks][0]!;
    callbacks.delete(id); callback(time);
  };
  frame(100); frame(116);
  expect(render.mock.calls).toEqual([[100, 0], [116, 16]]);
  page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
  expect(callbacks.size).toBe(0);
  page.hidden = false; page.dispatchEvent(new Event("visibilitychange"));
  frame(60000);
  expect(render).toHaveBeenLastCalledWith(60000, 0);
  motion.matches = true; motion.dispatchEvent(new Event("change"));
  expect(callbacks.size).toBe(0);
  motion.matches = false; motion.dispatchEvent(new Event("change"));
  frame(70000);
  expect(render).toHaveBeenLastCalledWith(70000, 0);
  stop();
  page.dispatchEvent(new Event("visibilitychange")); motion.dispatchEvent(new Event("change"));
  expect(callbacks.size).toBe(0);
});
