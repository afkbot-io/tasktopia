import { describe, expect, it } from "vitest";
import type { Cell, RoadCellDto } from "../src/shared/contracts";
import { buildMobilityNetwork, buildWalkingSpine, type MobilityNetworkInput } from "../src/client/city-mobility-network";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
const adjacent = (cell: Cell) => [{ x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y }, { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 }];
const reachable = (graph: ReadonlyMap<string, Cell>, start: Cell) => {
  const visited = new Set([key(start)]), queue = [start];
  for (let i = 0; i < queue.length; i++) for (const next of adjacent(queue[i]!)) {
    if (!graph.has(key(next)) || visited.has(key(next))) continue;
    visited.add(key(next)); queue.push(next);
  }
  return visited;
};
function wideSidewalk(): MobilityNetworkInput {
  const roads = new Map<string, RoadCellDto>(), walkGraph = new Map<string, Cell>(), crosswalks = new Set<string>();
  for (let y = 0; y <= 18; y++) {
    for (let x = -1; x <= 1; x++) roads.set(`${x},${y}`, { x, y, roadClass: "LOCAL", mask: 0, structure: "ROAD" });
    for (const x of [-4, -3, -2, 2]) walkGraph.set(`${x},${y}`, { x, y });
  }
  for (const y of [4, 14]) for (let x = -1; x <= 1; x++) {
    crosswalks.add(`${x},${y}`); walkGraph.set(`${x},${y}`, { x, y });
  }
  const activityCells = new Set(["-4,8", "-4,9", "-4,10", "-3,8", "-3,10"]);
  return { roads, walkGraph, crosswalks, activityCells };
}

describe("canonical routes inside wide walking surfaces", () => {
  it("does not serialize two distant crossings as one courtyard-wide conflict zone", () => {
    const network = buildMobilityNetwork(wideSidewalk());
    const top = network.zoneByCell.get("0,4"), bottom = network.zoneByCell.get("0,14");
    expect(top).toBeDefined(); expect(bottom).toBeDefined();
    expect(top!.id).not.toBe(bottom!.id);
    expect(top!.cells.size).toBeLessThanOrEqual(7);
    expect(bottom!.cells.size).toBeLessThanOrEqual(7);
  });

  it("preserves every protected crossing, roadside path and activity access with four-connected reachability", () => {
    const input = wideSidewalk(), before = [...input.walkGraph], spine = buildWalkingSpine(input);
    const protectedCells = new Set([...input.crosswalks, ...input.activityCells]);
    for (const [cellKey, cell] of input.walkGraph) if (adjacent(cell).some(next => input.roads.has(key(next)))) protectedCells.add(cellKey);
    expect(spine.size).toBeLessThan(input.walkGraph.size);
    expect([...input.walkGraph]).toEqual(before); // navigation does not edit painted surfaces
    for (const cellKey of protectedCells) expect(spine.has(cellKey), cellKey).toBe(true);
    const visited = reachable(spine, spine.get("0,4")!);
    for (const cellKey of protectedCells) expect(visited.has(cellKey), `access ${cellKey}`).toBe(true);
    expect(visited.size).toBe(spine.size);
    const network = buildMobilityNetwork(input);
    for (const cellKey of input.activityCells) expect(network.walkers.has(cellKey), `activity ${cellKey}`).toBe(true);
  });

  it("preserves one-cell connectors between wide areas and is independent of insertion order", () => {
    const walkGraph = new Map<string, Cell>();
    for (const base of [0, 8]) for (let y = 0; y < 4; y++) for (let x = base; x < base + 4; x++) walkGraph.set(`${x},${y}`, { x, y });
    for (let x = 3; x <= 8; x++) walkGraph.set(`${x},1`, { x, y: 1 });
    const input = { roads: new Map<string, RoadCellDto>(), walkGraph, crosswalks: new Set<string>(), activityCells: new Set(["0,0", "11,3"]) };
    const spine = buildWalkingSpine(input), reversed = buildWalkingSpine({ ...input, walkGraph: new Map([...walkGraph].reverse()) });
    expect([...spine]).toEqual([...reversed]);
    expect(reachable(spine, spine.get("0,0")!).has("11,3")).toBe(true);
    for (let x = 4; x < 8; x++) expect(spine.has(`${x},1`)).toBe(true);
  });
});

describe("signal posts represent actual incoming car approaches", () => {
  function streetGrid(tee = false): MobilityNetworkInput {
    const roads = new Map<string, RoadCellDto>();
    for (const axis of [0, 20, 40]) for (let along = -1; along <= 41; along++) for (let band = -1; band <= 1; band++) {
      const horizontal = { x: along, y: axis + band };
      roads.set(key(horizontal), { ...horizontal, roadClass: "LOCAL", mask: 0, structure: "ROAD" });
      if (tee && axis === 20 && along > 21 && along < 39) continue;
      const vertical = { x: axis + band, y: along };
      roads.set(key(vertical), { ...vertical, roadClass: "LOCAL", mask: 0, structure: "ROAD" });
    }
    const crosswalks = new Set(["10,19", "10,20", "10,21", "19,10", "20,10", "21,10"]);
    return { roads, walkGraph: new Map(), crosswalks, activityCells: new Set() };
  }

  it("places only E/W posts on a horizontal crossing and N/S on a vertical crossing", () => {
    const network = buildMobilityNetwork(streetGrid());
    expect(network.zoneByCell.get("10,20")!.signalPosts.map(post => post.approach).sort()).toEqual(["E", "W"]);
    expect(network.zoneByCell.get("20,10")!.signalPosts.map(post => post.approach).sort()).toEqual(["N", "S"]);
  });

  it("places three posts at a T, excluding its nonexistent south approach", () => {
    const network = buildMobilityNetwork(streetGrid(true));
    expect(network.zoneByCell.get("20,20")!.signalPosts.map(post => post.approach).sort()).toEqual(["E", "N", "W"]);
  });

  it("retains all four posts at an X with four incoming approaches", () => {
    const network = buildMobilityNetwork(streetGrid());
    expect(network.zoneByCell.get("20,20")!.signalPosts.map(post => post.approach).sort()).toEqual(["E", "N", "S", "W"]);
  });
});
