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
  it("updates local closures without reading topology and preserves earlier results", () => {
    const { graph, edges } = loop();
    const plan = createMobilityRouteSearch(graph, edges);
    const start = { x: 1, y: 0 }, previous = { x: 0, y: 0 }, target = { x: 0, y: 0 };
    const before = plan(start, previous, target, 8);
    graph.values = () => { throw new Error('Topology rescan'); };
    edges.get = () => { throw new Error('Topology rescan'); };
    plan.setBlocked(new Set(['1,1', 'absent']));
    expect(plan(start, previous, target, 8).routeTo(target)).toEqual([]);
    expect(before.routeTo(target)).toEqual([start, { x: 1, y: 1 }, { x: 0, y: 1 }, target]);
    plan.setBlocked(new Set());
    expect(plan(start, previous, target, 8).routeTo(target)).toEqual(before.routeTo(target));
    // A vehicle already on a closed cell can leave it, as with filtered edges.
    plan.setBlocked(new Set([key(start)]));
    expect(plan(start, previous).routeTo(target)).toEqual(before.routeTo(target));
  });
  it("stops a targeted route at the destination and respects its physical cell budget", () => {
    const cells = Array.from({ length: 1000 }, (_, x) => ({ x, y: 0 }));
    const graph = new Map(cells.map(cell => [key(cell), cell]));
    const edges = new Map(cells.map((cell, i) => [key(cell), cells[i + 1] ? [cells[i + 1]!] : []]));
    const plan = createMobilityRouteSearch(graph, edges);
    const result = plan(cells[0]!, undefined, cells[3]!, 4);
    expect(result.cells).toEqual(cells.slice(0, 4));
    expect(result.routeTo(cells[3]!)).toEqual(cells.slice(0, 4));
    expect(plan(cells[0]!, undefined, cells[4]!, 4).routeTo(cells[4]!)).toEqual([]);
    expect(plan(cells[0]!, undefined, cells[999]!, 48).cells).toEqual([]);
    expect(plan(cells[0]!, undefined, undefined, 4).cells).toEqual(cells.slice(0, 4));
    expect(plan(cells[0]!, undefined, { x: 5000, y: 0 }, 64).routeTo({ x: 5000, y: 0 })).toEqual([]);
  });
  it("does not apply the grid distance shortcut to a graph with nonlocal edges", () => {
    const start = { x: 0, y: 0 }, target = { x: 1000, y: 0 };
    const graph = new Map([[key(start), start], [key(target), target]]);
    const edges = new Map([[key(start), [target]]]);
    expect(createMobilityRouteSearch(graph, edges)(start, undefined, target, 2).routeTo(target)).toEqual([start, target]);
  });
  it("keeps the reviewed directed route and heading when the target requires a detour", () => {
    const { graph, edges } = loop();
    const plan = createMobilityRouteSearch(graph, edges), target = { x: 0, y: 0 };
    expect(plan({ x: 1, y: 0 }, { x: 0, y: 0 }, target, 4).routeTo(target))
      .toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }]);
    expect(plan({ x: 1, y: 0 }, { x: 0, y: 0 }, target, 3).routeTo(target)).toEqual([]);
  });
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
          const routes = [0, .2, .4, .6, .8, .99].map(f => {
            const target = cells[Math.floor(f * (cells.length - 1))]!, expectedRoute = result.routeTo(target);
            for (const maxCells of [48, 64])
              expect(search(start, delta ? { x: start.x + delta.x, y: start.y + delta.y } : undefined, target, maxCells).routeTo(target))
                .toEqual(expectedRoute.length <= maxCells ? expectedRoute : []);
            return expectedRoute;
          });
          digest.update(JSON.stringify({ cells: result.cells, routes }));
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
