import { describe, expect, it } from "vitest";
import {
  buildDirectedCarEdges,
  connectShortWalkGaps,
  isAgentEdgeAllowed,
  mustYieldAtCrosswalk,
  nextSeededRandom,
  nextWithoutUTurn,
  planAgentRoute,
  shortestAgentRoute,
  walkerInteractionPairs,
} from "../src/client/agent-routing";

describe("living city agent routing", () => {
  it("invalidates a retained car edge when a refreshed directed graph forbids it", () => {
    const current = { x: 1, y: 1 };
    const next = { x: 2, y: 1 };
    expect(isAgentEdgeAllowed(current, next, new Map([["1,1", [next]]]))).toBe(true);
    expect(isAgentEdgeAllowed(current, next, new Map([["1,1", [{ x: 0, y: 1 }]]]))).toBe(false);
  });

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

  it("keeps cars in the right-hand lane instead of routing into oncoming traffic", () => {
    const cells = Array.from({ length: 7 }, (_, x) => [{ x, y: 0 }, { x, y: 1 }]).flat();
    const graph = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
    const outgoing = buildDirectedCarEdges(graph);

    expect(shortestAgentRoute(graph, { x: 1, y: 1 }, { x: 5, y: 1 }, 8_000, outgoing)).toHaveLength(5);
    expect(shortestAgentRoute(graph, { x: 5, y: 0 }, { x: 1, y: 0 }, 8_000, outgoing)).toHaveLength(5);
    expect(shortestAgentRoute(graph, { x: 5, y: 1 }, { x: 1, y: 1 }, 8_000, outgoing)).toEqual([]);
    expect(shortestAgentRoute(graph, { x: 1, y: 0 }, { x: 5, y: 0 }, 8_000, outgoing)).toEqual([]);

    const verticalCells = Array.from({ length: 7 }, (_, y) => [{ x: 0, y }, { x: 1, y }]).flat();
    const vertical = new Map(verticalCells.map((cell) => [`${cell.x},${cell.y}`, cell]));
    const verticalOutgoing = buildDirectedCarEdges(vertical);
    expect(shortestAgentRoute(vertical, { x: 0, y: 1 }, { x: 0, y: 5 }, 8_000, verticalOutgoing)).toHaveLength(5);
    expect(shortestAgentRoute(vertical, { x: 1, y: 5 }, { x: 1, y: 1 }, 8_000, verticalOutgoing)).toHaveLength(5);
  });

  it("pairs nearby free walkers for bounded social interactions", () => {
    const pairs = walkerInteractionPairs([
      { id: "a", current: { x: 2, y: 2 }, pauseMs: 0, socialCooldownMs: 0 },
      { id: "b", current: { x: 3, y: 2 }, pauseMs: 0, socialCooldownMs: 0 },
      { id: "c", current: { x: 3, y: 3 }, pauseMs: 0, socialCooldownMs: 0 },
      { id: "busy", current: { x: 2, y: 3 }, pauseMs: 200, socialCooldownMs: 0 },
    ], 1);

    expect(pairs).toEqual([["a", "b"]]);
  });
});
