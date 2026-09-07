import { afterEach, expect, it, vi } from "vitest";
import { readWorldLighting } from "../src/client/world-light-clock";
afterEach(() => vi.useRealTimers());

it("uses real Moscow time and catches up after a suspended tab", () => {
  vi.useFakeTimers();
  for (const [time, phase] of [["02:59:59","NIGHT"],["03:00:00","DAWN"],
    ["07:00:00","DAY"],["13:00:00","DUSK"],["15:00:00","NIGHT"]] as const) {
    vi.setSystemTime(new Date(`2026-09-06T${time}Z`));
    expect(readWorldLighting().phase).toBe(phase);
  }
  expect(readWorldLighting().lamps).toBe(1);
});
