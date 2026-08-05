import { describe, expect, it } from "vitest";
import {
  connectShortWalkGaps,
  mustYieldAtCrosswalk,
  nextSeededRandom,
  nextWithoutUTurn,
  planAgentRoute,
  shortestAgentRoute,
} from "../src/client/agent-routing";

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

  it("plans a continuous route through intersections instead of turning around mid-road", () => {
    const cells = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
      { x: 2, y: -1 }, { x: 2, y: -2 }, { x: 4, y: 1 }, { x: 4, y: 2 },
    ];
    const graph = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
    expect(shortestAgentRoute(graph, cells[0]!, { x: 4, y: 2 })).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 4, y: 2 },
    ]);
    expect(nextWithoutUTurn(graph, { x: 2, y: 0 }, { x: 1, y: 0 })).not.toEqual({ x: 1, y: 0 });
    expect(planAgentRoute(graph, { x: 2, y: 0 }, 42, 12, { x: 1, y: 0 }).route[1]).not.toEqual({ x: 1, y: 0 });
  });

  it("uses a reproducible route for one session seed and different choices for another", () => {
    const cells = Array.from({ length: 24 }, (_, x) => ({ x, y: 0 }));
    const graph = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
    expect(planAgentRoute(graph, cells[8]!, 12345)).toEqual(planAgentRoute(graph, cells[8]!, 12345));
    expect(planAgentRoute(graph, cells[8]!, 12345).randomState).not.toBe(planAgentRoute(graph, cells[8]!, 67890).randomState);
    expect(nextSeededRandom(42)).toEqual(nextSeededRandom(42));
  });
});
