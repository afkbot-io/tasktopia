import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAgentRoutePlanner } from "../src/client/agent-route-planner";

const fixtures = [
  { cells: Array.from({ length: 24 }, (_, x) => ({ x: x - 8, y: -3 })), hash: "f858c054fa186a820902d8ccedba1ff397a6fd33b8ba27894d89b441be417cc6" },
  { cells: Array.from({ length: 324 }, (_, i) => ({ x: i % 18 - 9, y: Math.floor(i / 18) - 9 })).filter(c => !(c.x === 0 && c.y < 5) || c.y === -4), hash: "ac1ddc8cc1a5a92ad10b956a6b95f6b1b3ef864c72115a897a00c511cade7384" },
  { cells: Array.from({ length: 1600 }, (_, i) => ({ x: i % 40, y: Math.floor(i / 40) })).filter(c => (c.x * 19 + c.y * 7) % 13 > 1), hash: "0a7778bc8f71f1d7e37896bf9fb21ec3538adbc06a2813a170f957f81f32df46" },
  { cells: Array.from({ length: 10000 }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100) })), hash: "4359d3b5b40430d57ea572326e8daa281426a2a60ebba23f48223826b9ce14fe" },
];

describe("compiled animal routes", () => {
  // Recorded against 157b1a29: includes insertion/tie order, signed coordinates,
  // avoid-first, seeded choices, fewest turns and the 8,000-visited ceiling.
  it.each(fixtures)("preserves the existing route distribution for $cells.length cells", ({ cells, hash }) => {
    const graph = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
    const plan = createAgentRoutePlanner(graph);
    const start = cells[Math.floor(cells.length / 3)]!;
    const results = Array.from({ length: 12 }, (_, i) => plan(start, 42 + i * 971, 9, i % 2 ? cells[Math.floor(cells.length / 3) - 1] : undefined));
    expect(createHash("sha256").update(JSON.stringify(results)).digest("hex")).toBe(hash);
  });

  it("reuses topology for later trips and preserves an already returned route", () => {
    const graph = new Map(Array.from({ length: 300 }, (_, x) => [`${x},0`, { x, y: 0 }] as const));
    const get = vi.spyOn(graph, "get"), has = vi.spyOn(graph, "has"), values = vi.spyOn(graph, "values");
    const plan = createAgentRoutePlanner(graph);
    get.mockClear(); has.mockClear(); values.mockClear();
    const first = plan({ x: 100, y: 0 }, 42);
    const saved = structuredClone(first);
    for (let i = 0; i < 12; i++) plan({ x: i * 10, y: 0 }, 171 + i);
    expect(first).toEqual(saved);
    expect(get).not.toHaveBeenCalled(); expect(has).not.toHaveBeenCalled(); expect(values).not.toHaveBeenCalled();
  });

  it("keeps disconnected and absent starts still, and retries a sole avoided exit", () => {
    const plan = createAgentRoutePlanner(new Map([["-2,0", { x: -2, y: 0 }], ["0,0", { x: 0, y: 0 }], ["1,0", { x: 1, y: 0 }]]));
    expect(plan({ x: -2, y: 0 }, 42)).toEqual({ route: [{ x: -2, y: 0 }], randomState: 42 });
    expect(plan({ x: 9, y: 0 }, 42)).toEqual({ route: [{ x: 9, y: 0 }], randomState: 42 });
    expect(plan({ x: 0, y: 0 }, 42, 12, { x: 1, y: 0 }).route).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  });
});
