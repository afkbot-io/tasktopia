import { describe, expect, it } from "vitest";
import { connectShortWalkGaps, mustYieldAtCrosswalk } from "../src/client/agent-routing";

describe("living city agent routing", () => {
  it("connects only short safe gaps in the pedestrian network", () => {
    const base = new Map([
      ["0,0", { x: 0, y: 0 }],
      ["3,0", { x: 3, y: 0 }],
      ["0,5", { x: 0, y: 5 }],
    ]);
    const safe = new Map([
      ["1,0", { x: 1, y: 0 }],
      ["2,0", { x: 2, y: 0 }],
      ["0,1", { x: 0, y: 1 }],
      ["0,2", { x: 0, y: 2 }],
      ["0,3", { x: 0, y: 3 }],
      ["0,4", { x: 0, y: 4 }],
    ]);
    const connected = connectShortWalkGaps(base, safe, 2);
    expect(connected.has("1,0")).toBe(true);
    expect(connected.has("2,0")).toBe(true);
    expect(connected.has("0,1")).toBe(false);
  });

  it("stops a car only when a walker occupies its next crosswalk cell", () => {
    const crossing = new Set(["4,7"]);
    expect(mustYieldAtCrosswalk({ x: 4, y: 7 }, crossing, [{ current: { x: 4, y: 7 }, next: { x: 4, y: 8 } }])).toBe(true);
    expect(mustYieldAtCrosswalk({ x: 4, y: 7 }, crossing, [{ current: { x: 3, y: 7 }, next: { x: 3, y: 8 } }])).toBe(false);
    expect(mustYieldAtCrosswalk({ x: 4, y: 6 }, crossing, [{ current: { x: 4, y: 7 }, next: { x: 4, y: 8 } }])).toBe(false);
  });
});
