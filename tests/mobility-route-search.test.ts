import { describe, expect, it } from "vitest";
import { createMobilityRouteSearch } from "../src/client/mobility-route-search";
import type { Cell } from "../src/shared/contracts";
import type { RoadCellDto } from "../src/shared/contracts";
import { createHash } from "node:crypto";
import realCity from "./fixtures/city-mobility-real-city.json";
import { buildMobilityNetwork } from "../src/client/city-mobility-network";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
function loop() {
  const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const graph = new Map(cells.map(cell => [key(cell), cell]));
  const edges = new Map(cells.map(cell => [key(cell), cells.filter(next => Math.abs(next.x - cell.x) + Math.abs(next.y - cell.y) === 1)]));
  return { graph, edges };
}

describe("compiled mobility routing", () => {
  it("matches the reviewed real-city reachability and routes for all initial headings", () => {
    const network = buildMobilityNetwork({ roads: new Map(realCity.roads.map(cell => [key(cell), cell as RoadCellDto])),
      walkGraph: new Map(realCity.walkGraph.map(cell => [key(cell), cell])), crosswalks: new Set(realCity.crosswalks), activityCells: new Set(realCity.activityCells) });
    // Independent oracle recorded from 80bcd0fa's search on this saved street
    // network, before removing its implementation. 160 searches/960 routes.
    for (const [kind, expected] of [["cars", "407d5f01840b8d154634105006af9e6c215fc68e1acf3e995e6312d12b4a771e"],
      ["walkers", "50c95afb40c9d53b7a6997d1d3e20de7b01da127232b9d60ea93dc89ad8b4184"]] as const) {
      const graph = network[kind], edges = network[kind === "cars" ? "carEdges" : "walkerEdges"];
      const cells = [...graph.values()], search = createMobilityRouteSearch(graph, edges), digest = createHash("sha256");
      for (let i = 0; i < 16; i++) {
        const start = cells[Math.floor(i * cells.length / 16)]!;
        for (const delta of [undefined, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
          const result = search(start, delta ? { x: start.x + delta.x, y: start.y + delta.y } : undefined);
          digest.update(JSON.stringify({ cells: result.cells, routes: [0, .2, .4, .6, .8, .99].map(f => result.routeTo(cells[Math.floor(f * (cells.length - 1))]!)) }));
        }
      }
      expect(digest.digest("hex")).toBe(expected);
    }
  });
  it("reaches an entrance behind the walker through a loop, with no outdoor reversal", () => {
    const { graph, edges } = loop();
    const search = createMobilityRouteSearch(graph, edges)({ x: 1, y: 0 }, { x: 0, y: 0 });
    expect(search.routeTo({ x: 0, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }]);
    expect(search.cells).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }]);
  });
  it("keeps previous search results valid after another route is planned", () => {
    const { graph, edges } = loop();
    const plan = createMobilityRouteSearch(graph, edges);
    const first = plan({ x: 1, y: 0 }, { x: 0, y: 0 });
    plan({ x: 2, y: 1 }, { x: 2, y: 0 });
    expect(first.routeTo({ x: 0, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }]);
  });
  it("returns physical endpoints without leaking graph metadata or signed zero", () => {
    const graph = new Map([["1,0", { x: 1, y: 0, roadClass: "LOCAL" }], ["0,0", { x: -0, y: 0, roadClass: "LOCAL" }]]);
    const edges = new Map([["1,0", [{ x: 0, y: 0 }]]]);
    expect(createMobilityRouteSearch(graph, edges)({ x: 1, y: 0 }).routeTo({ x: 0, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 0, y: 0 }]);
  });
  it("does not invent an edge through absent ground or escape a directed dead end", () => {
    const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 9, y: 0 }];
    const graph = new Map(cells.map(cell => [key(cell), cell]));
    const edges = new Map([["0,0", [cells[1]!, { x: 0, y: 1 }]], ["1,0", []], ["9,0", []]]);
    const plan = createMobilityRouteSearch(graph, edges);
    expect(plan(cells[0]!).routeTo(cells[2]!)).toEqual([]);
    expect(plan(cells[1]!).cells).toEqual([cells[1]]);
    expect(plan({ x: 3, y: 0 }).cells).toEqual([]);
  });
});
