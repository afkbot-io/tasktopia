import { describe, expect, it } from "vitest";
import type { Cell, RoadCellDto } from "../src/shared/contracts";
import { createCityMobility, mobilityPassageExitIndex } from "../src/client/city-mobility";
import { buildMobilityNetwork, searchMobilityRoutes } from "../src/client/city-mobility-network";
import realCity from "./fixtures/city-mobility-real-city.json";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
export function mobilityGrid() {
  const roads = new Map<string, RoadCellDto>();
  for (const axis of [0, 20, 40]) for (let step = -1; step <= 41; step++) for (const band of [-1, 0, 1]) {
    for (const cell of [{ x: step, y: axis + band }, { x: axis + band, y: step }]) {
      roads.set(key(cell), { ...cell, roadClass: "LOCAL" } as RoadCellDto);
    }
  }
  const walkGraph = new Map<string, Cell>();
  for (const road of roads.values()) for (const delta of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
    const cell = { x: road.x + delta.x, y: road.y + delta.y };
    if (!roads.has(key(cell))) walkGraph.set(key(cell), cell);
  }
  const crosswalks = new Set<string>();
  for (const axis of [0, 20, 40]) for (const position of [5, 15, 25, 35]) for (const band of [-1, 0, 1]) {
    for (const cell of [{ x: position, y: axis + band }, { x: axis + band, y: position }]) {
      crosswalks.add(key(cell)); walkGraph.set(key(cell), cell);
    }
  }
  return { roads, walkGraph, crosswalks, activityCells: new Set(["5,2", "15,2", "22,15"]), seed: 73, carLimit: 12, walkerLimit: 16 };
}

describe("deterministic joint city mobility", () => {
  it("spawns native cars and people only off conflict zones with no initial overlaps", () => {
    const input = mobilityGrid(), city = createCityMobility(input);
    expect(city.agents.filter(agent => agent.kind === "CAR")).toHaveLength(12);
    expect(city.agents.filter(agent => agent.kind === "WALKER")).toHaveLength(16);
    expect(city.agents.every(agent => !input.crosswalks.has(key(agent.current)))).toBe(true);
    expect(city.metrics.vehicleUnsafePairs).toBe(0);
    expect(city.metrics.vehiclePedestrianUnsafePairs).toBe(0);
    expect(city.metrics.pedestrianUnsafePairs).toBe(0);
  });

  it("preserves identity and exact positions on an unchanged network refresh", () => {
    const input = mobilityGrid(), city = createCityMobility(input);
    city.advance(2_125);
    const before = city.agents;
    city.updateNetwork({ ...input, roads: new Map(input.roads), walkGraph: new Map(input.walkGraph) });
    expect(city.agents).toEqual(before);
  });

  it("produces identical states for equal elapsed time under irregular rendering frames", () => {
    const regular = createCityMobility(mobilityGrid()), irregular = createCityMobility(mobilityGrid());
    for (let i = 0; i < 100; i++) regular.advance(50);
    for (let i = 0; i < 25; i++) for (const dt of [17, 33, 25, 75, 50]) irregular.advance(dt);
    expect(irregular.agents).toEqual(regular.agents);
    expect(irregular.metrics).toEqual(regular.metrics);
    expect(irregular.signals).toEqual(regular.signals);
  });

  it("does not allocate new snapshots when a render frame performs no fixed step", () => {
    const city = createCityMobility(mobilityGrid()), snapshot = city.agents, signals = city.signals;
    city.advance(17); city.advance(20);
    expect(city.agents).toBe(snapshot);
    expect(city.signals).toBe(signals);
    expect(city.metrics.fixedSteps).toBe(0);
    city.advance(13);
    expect(city.agents).not.toBe(snapshot);
    expect(city.metrics.fixedSteps).toBe(1);
  });

  it("grows population without rebuilding unchanged topology or moving existing actors", () => {
    const input = mobilityGrid(), city = createCityMobility(input);
    city.advance(1_225);
    const before = city.agents;
    city.updateNetwork({ ...input, carLimit: 24, walkerLimit: 32 });
    expect(city.metrics.networkBuilds).toBe(1);
    expect(city.agents.filter(agent => agent.kind === "CAR")).toHaveLength(24);
    expect(city.agents.filter(agent => agent.kind === "WALKER")).toHaveLength(32);
    for (const agent of before) expect(city.agents.find(current => current.id === agent.id)).toEqual(agent);
    expect(city.metrics.vehicleUnsafeTotal + city.metrics.pedestrianUnsafeTotal + city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
  });

  it("keeps the current physical segment fixed when a removed future cell forces rerouting", () => {
    const walkGraph = new Map<string, Cell>();
    for (const axis of [-6, 0, 6]) for (let value = -6; value <= 6; value++) {
      for (const cell of [{ x: axis, y: value }, { x: value, y: axis }]) walkGraph.set(key(cell), cell);
    }
    const input = { roads: new Map<string, RoadCellDto>(), walkGraph, crosswalks: new Set<string>(), activityCells: new Set<string>(), seed: 73, carLimit: 0, walkerLimit: 1 };
    const city = createCityMobility(input);
    city.advance(18_550);
    const before = city.agents[0]!;
    expect(before.current).toEqual({ x: -1, y: 6 });
    expect(before.next).toEqual({ x: 0, y: 6 });
    const updated = new Map(walkGraph); updated.delete("0,5");
    city.updateNetwork({ ...input, walkGraph: updated });
    expect(city.agents[0]!.position).toEqual(before.position);
    let last = before;
    for (let step = 0; step < 100; step++) {
      city.advance(50);
      const current = city.agents[0]!;
      const displacement = Math.hypot(current.position.x - last.position.x, current.position.y - last.position.y);
      expect(displacement, `step ${step} has no discontinuous lane jump`).toBeLessThan(.1);
      if (key(current.current) === key(before.current)) expect(current.position.x).toBeGreaterThanOrEqual(last.position.x);
      expect(key(current.current)).not.toBe("0,5");
      expect(key(current.next)).not.toBe("0,5");
      last = current;
    }
    expect(last.steps).toBeGreaterThan(before.steps);
  });

  it("retires an invalid directed edge after a road edit even if both endpoint cells remain", () => {
    const input = { ...mobilityGrid(), walkGraph: new Map<string, Cell>(), crosswalks: new Set<string>(), activityCells: new Set<string>(), walkerLimit: 0 }, city = createCityMobility(input);
    city.advance(7_300);
    const before = city.agents.find(agent => agent.id === "mobility-73-2")!;
    expect(before.current).toEqual({ x: 19, y: 39 });
    expect(before.next).toEqual({ x: 20, y: 39 });
    const roads = new Map([...input.roads].filter(([, cell]) => cell.x < 19 || cell.x > 21 || [0, 20, 40].some(axis => Math.abs(cell.y - axis) <= 1)));
    const update = { ...input, roads }, network = buildMobilityNetwork(update);
    expect(network.cars.has(key(before.current))).toBe(true);
    expect(network.cars.has(key(before.next))).toBe(true);
    expect(network.carEdges.get(key(before.current))).not.toContainEqual(before.next);
    city.updateNetwork(update);
    expect(city.agents.some(agent => agent.id === before.id)).toBe(false);
    for (let step = 0; step < 100; step++) {
      city.advance(50);
      for (const agent of city.agents) {
        if (key(agent.current) !== key(agent.next)) expect(network.carEdges.get(key(agent.current))).toContainEqual(agent.next);
      }
    }
    expect(city.agents.filter(agent => agent.kind === "CAR")).toHaveLength(input.carLimit);
    expect(city.metrics.vehicleUnsafeTotal).toBe(0);
  });

  it("finds a forward loop rather than using a hidden A→B→A reversal to reach a destination behind", () => {
    const points: Cell[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const graph = new Map(points.map(cell => [key(cell), cell]));
    const edges = new Map(points.map(cell => [key(cell), points.filter(other => Math.abs(cell.x - other.x) + Math.abs(cell.y - other.y) === 1)]));
    const start = { x: 1, y: 0 }, previous = { x: 0, y: 0 };
    const route = searchMobilityRoutes(graph, edges, start, previous).routeTo(previous);
    expect(route.length).toBeGreaterThan(2);
    expect(route[0]).toEqual(start);
    expect(route.at(-1)).toEqual(previous);
    const trace = [previous, ...route];
    for (let i = 2; i < trace.length; i++) expect(trace[i]).not.toEqual(trace[i - 2]);
  });

  it("reserves the outgoing lane when a loop exits at the same cell where it entered", () => {
    const loop = [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: -1 }];
    const zone = { cells: new Set(["-1,0", "-1,1", "0,1"]) };
    expect(mobilityPassageExitIndex(loop, zone)).toBe(4); // northbound exit, not westbound entry at index0
    const input = { ...realCity, roads: new Map(realCity.roads.map(cell => [key(cell), cell as RoadCellDto])),
      walkGraph: new Map(realCity.walkGraph.map(cell => [key(cell), cell])), crosswalks: new Set(realCity.crosswalks), activityCells: new Set(realCity.activityCells) };
    const city = createCityMobility(input);
    city.advance(270_250);
    const before = city.agents.find(agent => agent.id === "mobility-107250608-29")!;
    city.advance(4_000);
    const after = city.agents.find(agent => agent.id === before.id)!;
    expect(after.steps).toBeGreaterThan(before.steps);
    expect(after.waitMs).toBeLessThan(3_000);
    expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
  });

  it("makes sustained progress without vehicle/people collisions or stopping to chat on a road", () => {
    const input = mobilityGrid(), city = createCityMobility(input);
    const initialIds = city.agents.map(agent => agent.id);
    let middleSteps = new Map<string, number>();
    for (let frame = 0; frame < 2_400; frame++) {
      city.advance(50);
      expect(city.metrics.vehicleUnsafePairs, `cars frame ${frame}`).toBe(0);
      expect(city.metrics.vehiclePedestrianUnsafePairs, `car/person frame ${frame}`).toBe(0);
      expect(city.metrics.pedestrianUnsafePairs, `people frame ${frame}`).toBe(0);
      for (const agent of city.agents) if (input.roads.has(key(agent.current))) expect(agent.activity).toBe("NONE");
      if (frame === 1_199) middleSteps = new Map(city.agents.map(agent => [agent.id, agent.steps]));
    }
    expect(city.metrics.vehicleSteps).toBeGreaterThan(200);
    expect(city.metrics.walkerSteps).toBeGreaterThan(200);
    expect(city.metrics.crossingsCompleted).toBeGreaterThan(5);
    expect(city.metrics.completedTrips).toBeGreaterThan(5);
    expect(city.metrics.maxVehicleWaitMs).toBeLessThan(20_000);
    expect(city.metrics.maxWalkerWaitMs).toBeLessThan(20_000);
    expect(city.agents.map(agent => agent.id)).toEqual(initialIds);
    for (const agent of city.agents) {
      expect(middleSteps.get(agent.id), `${agent.id} first minute`).toBeGreaterThan(0);
      expect(agent.steps, `${agent.id} second minute`).toBeGreaterThan(middleSteps.get(agent.id)!);
    }
  });
});
