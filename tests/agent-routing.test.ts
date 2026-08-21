import { describe, expect, it } from "vitest";
import {
  agentCellKey,
  buildDirectedCarEdges,
  connectShortWalkGaps,
  directedTrafficCore,
  isAgentEdgeAllowed,
  mustYieldAtCrosswalk,
  detectTrafficJunctions,
  mustYieldAtTrafficSignal,
  mustYieldForBlockedJunctionExit,
  trafficSignalPhase,
  nextSeededRandom,
  nextWithoutUTurn,
  planAgentRoute,
  shortestAgentRoute,
  vehiclePresentation,
  vehicleMotionPresentation,
  vehicleLanePosition,
  planVehicleFrame,
  vehicleCruiseSpeed,
  vehicleUnsafePairCount,
  walkerInteractionPairs,
  type TrafficJunction,
  type TrafficVehicleSnapshot,
} from "../src/client/agent-routing";

const TEST_VEHICLE_BODY = {
  CAR: { length: 2.1, width: 0.9 },
  BUS: { length: 5.75, width: 1.875 },
} as const;

function independentlyOverlaps(left: TrafficVehicleSnapshot, right: TrafficVehicleSnapshot): boolean {
  const center = (vehicle: TrafficVehicleSnapshot) => {
    return {
      x: vehicle.current.x + (vehicle.next.x - vehicle.current.x) * vehicle.progress,
      y: vehicle.current.y + (vehicle.next.y - vehicle.current.y) * vehicle.progress,
    };
  };
  const extents = (vehicle: TrafficVehicleSnapshot) => {
    const body = TEST_VEHICLE_BODY[vehicle.kind];
    const horizontal = vehicle.current.x !== vehicle.next.x;
    return horizontal
      ? { x: body.length / 2, y: body.width / 2 }
      : { x: body.width / 2, y: body.length / 2 };
  };
  const leftCenter = center(left);
  const rightCenter = center(right);
  const leftExtents = extents(left);
  const rightExtents = extents(right);
  return Math.abs(leftCenter.x - rightCenter.x) < leftExtents.x + rightExtents.x
    && Math.abs(leftCenter.y - rightCenter.y) < leftExtents.y + rightExtents.y;
}

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

  it("keeps the marked center band of a three-cell road free of vehicles", () => {
    const cells = Array.from({ length: 7 }, (_, x) => [-1, 0, 1].map((y) => ({ x, y }))).flat();
    const graph = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
    const outgoing = buildDirectedCarEdges(graph);

    expect(shortestAgentRoute(graph, { x: 1, y: 1 }, { x: 5, y: 1 }, 8_000, outgoing)).toHaveLength(5);
    expect(shortestAgentRoute(graph, { x: 5, y: -1 }, { x: 1, y: -1 }, 8_000, outgoing)).toHaveLength(5);
    for (let x = 0; x < 7; x += 1) expect(outgoing.get(`${x},0`)).toEqual([]);
  });

  it("keeps a right-hand lane through a ninety-degree road bend", () => {
    const cells = [
      ...Array.from({ length: 7 }, (_, index) => [-1, 0].map((y) => ({ x: index - 6, y }))).flat(),
      ...Array.from({ length: 7 }, (_, index) => [-1, 0].map((x) => ({ x, y: index - 6 }))).flat(),
    ];
    const graph = new Map(cells.map((cell) => [agentCellKey(cell), cell]));
    const outgoing = buildDirectedCarEdges(graph);
    const route = shortestAgentRoute(graph, { x: -5, y: 0 }, { x: 0, y: -5 }, 8_000, outgoing);
    expect(route.length).toBeGreaterThan(8);
    expect(route).toContainEqual({ x: 0, y: 0 });
    expect(route.every((cell, index) => index === 0 || Math.abs(cell.x - route[index - 1]!.x) + Math.abs(cell.y - route[index - 1]!.y) === 1)).toBe(true);
  });

  it("stays on a directed dead end instead of returning an absent next cell", () => {
    const current = { x: 4, y: 2 };
    const graph = new Map([["4,2", current]]);
    const outgoing = new Map([["4,2", []]]);
    expect(nextWithoutUTurn(graph, current, { x: 3, y: 2 }, outgoing)).toEqual(current);
  });

  it("removes terminal road tails from the moving traffic graph", () => {
    const outgoing = new Map([
      ["0,0", [{ x: 1, y: 0 }]],
      ["1,0", [{ x: 2, y: 0 }]],
      ["2,0", [{ x: 1, y: 0 }]],
      ["3,0", []],
    ]);
    expect(directedTrafficCore(outgoing)).toEqual(new Set(["1,0", "2,0"]));
  });

  it("prunes a long streamed tail without repeatedly scanning the road graph", () => {
    const outgoing = new Map<string, Array<{ x: number; y: number }>>();
    for (let x = 0; x < 5_000; x += 1) outgoing.set(`${x},0`, [{ x: x + 1, y: 0 }]);
    outgoing.set("5000,0", [{ x: 5001, y: 0 }]);
    outgoing.set("5001,0", [{ x: 5000, y: 0 }]);
    expect(directedTrafficCore(outgoing)).toEqual(new Set(["5000,0", "5001,0"]));
  });

  it("maps every travel direction to the matching base sprite and mirror", () => {
    expect(vehiclePresentation({ x: 1, y: 1 }, { x: 2, y: 1 })).toEqual({ view: "horizontal", scaleX: 1.2, scaleY: 1.2 });
    expect(vehiclePresentation({ x: 2, y: 1 }, { x: 1, y: 1 })).toEqual({ view: "horizontal", scaleX: -1.2, scaleY: 1.2 });
    expect(vehiclePresentation({ x: 1, y: 1 }, { x: 1, y: 2 })).toEqual({ view: "south", scaleX: 1.2, scaleY: 1.2 });
    expect(vehiclePresentation({ x: 1, y: 2 }, { x: 1, y: 1 })).toEqual({ view: "north", scaleX: 1.2, scaleY: 1.2 });
  });

  it("animates suspension by travelled distance and settles blocked queues", () => {
    expect(vehicleMotionPresentation("CAR", 0, 0)).toEqual({ frame: 0, suspensionYPx: 0 });
    expect(vehicleMotionPresentation("CAR", 0.25, 0)).toEqual({ frame: 1, suspensionYPx: -1 });
    expect(vehicleMotionPresentation("CAR", 0.5, 0)).toEqual({ frame: 2, suspensionYPx: 0 });
    expect(vehicleMotionPresentation("BUS", 0.5, 0)).toEqual({ frame: 1, suspensionYPx: -1 });
    expect(vehicleMotionPresentation("BUS", 0.75, 12, false)).toEqual({ frame: 0, suspensionYPx: 0 });
  });

  it("keeps vehicles inset toward the centre of their carriageway through turns", () => {
    expect(vehicleLanePosition({ x: 1, y: 1 }, { x: 2, y: 1 }, 0.5)).toEqual({ x: 16, y: 11.5 });
    expect(vehicleLanePosition({ x: 2, y: 1 }, { x: 1, y: 1 }, 0.5)).toEqual({ x: 16, y: 12.5 });
    expect(vehicleLanePosition({ x: 2, y: 1 }, { x: 2, y: 0 }, 0.5)).toEqual({ x: 19.5, y: 8 });
    const turnStart = vehicleLanePosition({ x: 1, y: 1 }, { x: 1, y: 0 }, 0, { x: 0, y: 1 });
    const turnEnd = vehicleLanePosition({ x: 1, y: 1 }, { x: 1, y: 0 }, 1, { x: 0, y: 1 });
    expect(turnStart).toEqual({ x: 12, y: 11.5 });
    expect(turnEnd).toEqual({ x: 11.5, y: 4 });
  });

  it("detects real T/X junctions but not an ordinary ninety-degree bend", () => {
    const horizontal = Array.from({ length: 13 }, (_, index) => [-1, 0].map((y) => ({ x: index - 6, y }))).flat();
    const vertical = Array.from({ length: 13 }, (_, index) => [-1, 0].map((x) => ({ x, y: index - 6 }))).flat();
    const crossing = new Map([...horizontal, ...vertical].map((cell) => [agentCellKey(cell), cell]));
    const junctions = detectTrafficJunctions(crossing);
    expect(junctions).toHaveLength(1);
    expect(junctions[0]?.arms.sort()).toEqual(["E", "N", "S", "W"]);
    expect(junctions[0]?.signalPosts).toHaveLength(4);

    const bendCells = [
      ...Array.from({ length: 7 }, (_, index) => [-1, 0].map((y) => ({ x: index - 6, y }))).flat(),
      ...Array.from({ length: 7 }, (_, index) => [-1, 0].map((x) => ({ x, y: index - 6 }))).flat(),
    ];
    expect(detectTrafficJunctions(new Map(bendCells.map((cell) => [agentCellKey(cell), cell])))).toEqual([]);
  });

  it("holds an approaching car on red and releases it on its green phase", () => {
    const horizontal = Array.from({ length: 13 }, (_, index) => [-1, 0].map((y) => ({ x: index - 6, y }))).flat();
    const vertical = Array.from({ length: 13 }, (_, index) => [-1, 0].map((x) => ({ x, y: index - 6 }))).flat();
    const graph = new Map([...horizontal, ...vertical].map((cell) => [agentCellKey(cell), cell]));
    const junction = detectTrafficJunctions(graph)[0]!;
    const horizontalGreenAt = Array.from({ length: 8_000 }, (_, time) => time).find((time) => trafficSignalPhase(junction, time).horizontal === "GREEN")!;
    const horizontalRedAt = Array.from({ length: 8_000 }, (_, time) => time).find((time) => trafficSignalPhase(junction, time).horizontal === "RED")!;
    const current = { x: -2, y: 0 };
    const next = { x: -1, y: 0 };
    expect(mustYieldAtTrafficSignal(current, next, [junction], horizontalGreenAt)).toBe(false);
    expect(mustYieldAtTrafficSignal(current, next, [junction], horizontalRedAt)).toBe(true);
    expect(mustYieldAtTrafficSignal(current, next, [junction], horizontalRedAt, 0.1)).toBe(false);
  });

  it("does not enter an intersection when the exit lane cannot fit the vehicle", () => {
    const junction: TrafficJunction = {
      id: "junction",
      bounds: { minX: -1, minY: -1, maxX: 0, maxY: 0 },
      cells: [{ x: -1, y: 0 }, { x: 0, y: 0 }],
      arms: ["E", "N", "S", "W"],
      signalPosts: [],
    };
    const approaching: TrafficVehicleSnapshot = {
      id: "approaching", kind: "CAR", current: { x: -2, y: 0 }, next: { x: -1, y: 0 },
      progress: 0.4, cruiseSpeed: 0.0024,
      path: [{ x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    };
    const blocking: TrafficVehicleSnapshot = {
      id: "blocking", kind: "CAR", current: { x: 1, y: 0 }, next: { x: 2, y: 0 },
      progress: 0.1, cruiseSpeed: 0,
      path: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    };

    expect(mustYieldForBlockedJunctionExit(approaching, [junction], [approaching, blocking])).toBe(true);
    expect(mustYieldForBlockedJunctionExit(approaching, [junction], [approaching])).toBe(false);
  });

  it("looks through a wide junction and accounts for a vehicle on the final lookahead cell", () => {
    const junction: TrafficJunction = {
      id: "wide-junction",
      bounds: { minX: 0, minY: 0, maxX: 3, maxY: 3 },
      cells: Array.from({ length: 16 }, (_, index) => ({ x: index % 4, y: Math.floor(index / 4) })),
      arms: ["E", "N", "S", "W"],
      signalPosts: [],
    };
    const approaching: TrafficVehicleSnapshot = {
      id: "approaching", kind: "CAR", current: { x: -1, y: 1 }, next: { x: 0, y: 1 },
      progress: 0.25, cruiseSpeed: 0.0024,
      path: [
        { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
        { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
      ],
    };
    const blocker: TrafficVehicleSnapshot = {
      id: "blocker", kind: "BUS", current: { x: 5, y: 1 }, next: { x: 6, y: 1 },
      progress: 0.05, cruiseSpeed: 0,
      path: [{ x: 5, y: 1 }, { x: 6, y: 1 }],
    };

    expect(mustYieldForBlockedJunctionExit(approaching, [junction], [approaching])).toBe(false);
    expect(mustYieldForBlockedJunctionExit(approaching, [junction], [approaching, blocker])).toBe(true);
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

  it("gives each car a reproducible but visibly different cruise speed", () => {
    expect(vehicleCruiseSpeed("CAR", 0)).toBeCloseTo(0.0019);
    expect(vehicleCruiseSpeed("CAR", 1)).toBeCloseTo(0.0029);
    expect(vehicleCruiseSpeed("BUS", 0)).toBeCloseTo(0.00155);
    expect(vehicleCruiseSpeed("BUS", 1)).toBeCloseTo(0.0019);
    expect(vehicleCruiseSpeed("CAR", 0.42)).toBe(vehicleCruiseSpeed("CAR", 0.42));
  });

  it("lets opposing cars pass on adjacent local-road lanes without a false gridlock", () => {
    const eastbound: TrafficVehicleSnapshot = {
      id: "eastbound",
      kind: "CAR",
      current: { x: -2, y: 0 },
      next: { x: -1, y: 0 },
      progress: 0.92,
      cruiseSpeed: 0.0024,
      path: Array.from({ length: 8 }, (_, index) => ({ x: index - 2, y: 0 })),
      trail: [{ x: -3, y: 0 }],
    };
    const westbound: TrafficVehicleSnapshot = {
      id: "westbound",
      kind: "CAR",
      current: { x: 2, y: -1 },
      next: { x: 1, y: -1 },
      progress: 0.98,
      cruiseSpeed: 0.0024,
      path: Array.from({ length: 8 }, (_, index) => ({ x: 2 - index, y: -1 })),
      trail: [{ x: 3, y: -1 }],
    };

    expect(vehicleUnsafePairCount([eastbound, westbound])).toBe(0);
    const decisions = planVehicleFrame([eastbound, westbound], 50);
    expect(decisions.get("eastbound")?.advance).toBeGreaterThan(0);
    expect(decisions.get("westbound")?.advance).toBeGreaterThan(0);
  });

  it("drains four signal-controlled queues without starvation", () => {
    type SimVehicle = TrafficVehicleSnapshot & {
      trail: { x: number; y: number }[];
      baseSpeed: number;
      stoppedMs: number;
    };
    const junction: TrafficJunction = {
      id: "queue-drain",
      bounds: { minX: -1, minY: -1, maxX: 0, maxY: 0 },
      cells: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 0 }],
      arms: ["N", "E", "S", "W"],
      signalPosts: [],
    };
    const range = (start: number, end: number) => Array.from(
      { length: Math.abs(end - start) + 1 },
      (_, index) => start + Math.sign(end - start) * index,
    );
    const routes = {
      east: range(-32, 32).map((x) => ({ x, y: 0 })),
      west: range(32, -32).map((x) => ({ x, y: -1 })),
      south: range(-32, 32).map((y) => ({ x: -1, y })),
      north: range(32, -32).map((y) => ({ x: 0, y })),
    };
    const vehicles: SimVehicle[] = [];
    for (const [approach, route] of Object.entries(routes)) {
      for (let queueIndex = 0; queueIndex < 6; queueIndex += 1) {
        const path = route.slice(26 - queueIndex * 4);
        vehicles.push({
          id: `${approach}-${queueIndex}`,
          kind: "CAR",
          current: path[0]!,
          next: path[1]!,
          progress: 0,
          cruiseSpeed: 0.0024,
          baseSpeed: 0.0024,
          path,
          trail: [],
          stoppedMs: 0,
        });
      }
    }

    let elapsedMs = 0;
    let maxStoppedMs = 0;
    while (vehicles.length > 0 && elapsedMs < 120_000) {
      for (const vehicle of vehicles) {
        vehicle.cruiseSpeed = mustYieldAtTrafficSignal(vehicle.current, vehicle.next, [junction], elapsedMs, vehicle.progress)
          || mustYieldForBlockedJunctionExit(vehicle, [junction], vehicles)
          ? 0
          : vehicle.baseSpeed;
      }
      const decisions = planVehicleFrame(vehicles, 50);
      for (const vehicle of vehicles) {
        const advance = decisions.get(vehicle.id)?.advance ?? 0;
        vehicle.stoppedMs = advance < 0.0001 ? vehicle.stoppedMs + 50 : 0;
        maxStoppedMs = Math.max(maxStoppedMs, vehicle.stoppedMs);
        vehicle.progress += advance;
        if (vehicle.progress < 1) continue;
        vehicle.progress -= 1;
        vehicle.trail.unshift(vehicle.current);
        vehicle.trail.length = Math.min(vehicle.trail.length, 7);
        vehicle.current = vehicle.next;
        vehicle.path = vehicle.path.slice(1);
        vehicle.next = vehicle.path[1] ?? vehicle.current;
      }
      for (let index = vehicles.length - 1; index >= 0; index -= 1) {
        if (vehicles[index]!.path.length < 2) vehicles.splice(index, 1);
      }
      expect(vehicleUnsafePairCount(vehicles), `unsafe pair at ${elapsedMs}ms`).toBe(0);
      elapsedMs += 50;
    }

    expect(vehicles).toHaveLength(0);
    expect(maxStoppedMs).toBeLessThan(60_000);
  });

  it("slows a following car before it reaches the vehicle ahead", () => {
    const decisions = planVehicleFrame([
      {
        id: "leader", kind: "CAR", current: { x: 1, y: 0 }, next: { x: 2, y: 0 },
        progress: 0.72, cruiseSpeed: 0.0021, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
      },
      {
        id: "follower", kind: "CAR", current: { x: 0, y: 0 }, next: { x: 1, y: 0 },
        progress: 0.8, cruiseSpeed: 0.0029, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      },
    ], 50);

    expect(decisions.get("leader")?.advance).toBeCloseTo(0.105);
    expect(decisions.get("follower")?.advance).toBeGreaterThanOrEqual(0);
    expect(decisions.get("follower")?.advance).toBeLessThan(0.145);
    expect(decisions.get("follower")?.blockedBy).toBe("leader");
  });

  it("reserves a merging road cell so vehicles cannot pass through each other", () => {
    const vehicles = [
      {
        id: "first", kind: "CAR", current: { x: -2, y: 0 }, next: { x: -1, y: 0 },
        progress: 0.65, cruiseSpeed: 0.0024,
        path: [{ x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
      },
      {
        id: "second", kind: "CAR", current: { x: 0, y: -2 }, next: { x: 0, y: -1 },
        progress: 0.65, cruiseSpeed: 0.0024,
        path: [{ x: 0, y: -2 }, { x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      },
    ] as const;
    const decisions = planVehicleFrame(vehicles, 50);

    expect(decisions.get("first")?.advance).toBeCloseTo(0.12);
    expect(decisions.get("second")?.advance).toBeLessThan(0.12);
    expect(decisions.get("second")?.blockedBy).toBe("first");
    // The enlarged body contract correctly identifies that this synthetic
    // starting state is already unsafe; the frame planner prevents it from
    // becoming worse while real spawns reject it entirely.
    expect(vehicleUnsafePairCount(vehicles)).toBe(1);
  });

  it("keeps a merge cell reserved until a vehicle has cleared it on a diverging route", () => {
    const vehicles = [
      {
        id: "leader", kind: "CAR" as const, current: { x: 0, y: 0 }, next: { x: 1, y: 0 },
        progress: 0.05, cruiseSpeed: 0.0024,
        path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], trail: [{ x: -1, y: 0 }],
      },
      {
        id: "waiting", kind: "CAR" as const, current: { x: 0, y: -2 }, next: { x: 0, y: -1 },
        progress: 0.4, cruiseSpeed: 0.0024,
        path: [{ x: 0, y: -2 }, { x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      },
    ];
    const decisions = planVehicleFrame(vehicles, 50);

    expect(decisions.get("leader")?.advance).toBeCloseTo(0.12);
    expect(decisions.get("waiting")?.advance).toBeGreaterThanOrEqual(0);
    expect(vehicleUnsafePairCount(vehicles)).toBe(0);
  });

  it("preserves physical separation across multiple merge and exit frames", () => {
    const vehicles = [
      {
        id: "a", kind: "CAR" as const, current: { x: -3, y: 0 }, next: { x: -2, y: 0 },
        progress: 0, cruiseSpeed: 0.0024,
        path: Array.from({ length: 8 }, (_, index) => ({ x: index - 3, y: 0 })), trail: [] as { x: number; y: number }[],
      },
      {
        id: "b", kind: "CAR" as const, current: { x: 0, y: -3 }, next: { x: 0, y: -2 },
        progress: 0, cruiseSpeed: 0.0024,
        path: Array.from({ length: 8 }, (_, index) => ({ x: 0, y: index - 3 })), trail: [] as { x: number; y: number }[],
      },
    ];

    for (let frame = 0; frame < 32; frame += 1) {
      const decisions = planVehicleFrame(vehicles, 50);
      for (const vehicle of vehicles) {
        vehicle.progress += decisions.get(vehicle.id)!.advance;
        if (vehicle.progress < 1) continue;
        vehicle.progress -= 1;
        vehicle.trail.unshift(vehicle.current);
        vehicle.trail.length = Math.min(vehicle.trail.length, 4);
        vehicle.current = vehicle.next;
        vehicle.next = vehicle.path[2]!;
        vehicle.path = vehicle.path.slice(1);
      }
      expect(independentlyOverlaps(vehicles[0]!, vehicles[1]!), `frame ${frame}`).toBe(false);
      expect(vehicleUnsafePairCount(vehicles), `telemetry frame ${frame}`).toBe(0);
    }
  });

  it("keeps turn-to-same-lane merges separated through the orientation change", () => {
    const vehicles = [
      {
        id: "straight", kind: "CAR" as const, current: { x: 0, y: -3 }, next: { x: 0, y: -2 },
        progress: 0, cruiseSpeed: 0.0024,
        path: Array.from({ length: 10 }, (_, index) => ({ x: 0, y: index - 3 })), trail: [] as { x: number; y: number }[],
      },
      {
        id: "turning", kind: "CAR" as const, current: { x: -2, y: 0 }, next: { x: -1, y: 0 },
        progress: 0, cruiseSpeed: 0.0024,
        path: [{ x: -2, y: 0 }, { x: -1, y: 0 }, ...Array.from({ length: 8 }, (_, index) => ({ x: 0, y: index }))],
        trail: [] as { x: number; y: number }[],
      },
    ];

    for (let frame = 0; frame < 45; frame += 1) {
      const decisions = planVehicleFrame(vehicles, 50);
      for (const vehicle of vehicles) {
        vehicle.progress += decisions.get(vehicle.id)!.advance;
        if (vehicle.progress < 1) continue;
        vehicle.progress -= 1;
        vehicle.trail.unshift(vehicle.current);
        vehicle.trail.length = Math.min(vehicle.trail.length, 4);
        vehicle.current = vehicle.next;
        vehicle.next = vehicle.path[2]!;
        vehicle.path = vehicle.path.slice(1);
      }
      expect(independentlyOverlaps(vehicles[0]!, vehicles[1]!), `frame ${frame}`).toBe(false);
      expect(vehicleUnsafePairCount(vehicles), `telemetry frame ${frame}`).toBe(0);
    }
  });

  it("measures collision geometry at the rendered lane centerlines", () => {
    const vehicles = [
      {
        id: "east", kind: "CAR" as const, current: { x: -1, y: 0 }, next: { x: 0, y: 0 },
        progress: 0.8, cruiseSpeed: 0, path: [{ x: -2, y: 0 }, { x: -1, y: 0 }],
      },
      {
        id: "north", kind: "CAR" as const, current: { x: 0, y: 1 }, next: { x: 0, y: 0 },
        progress: 0.8, cruiseSpeed: 0, path: [{ x: 0, y: 1 }, { x: 0, y: 0 }], trail: [{ x: 0, y: 2 }],
      },
    ];

    expect(independentlyOverlaps(vehicles[0]!, vehicles[1]!)).toBe(true);
    expect(vehicleUnsafePairCount(vehicles)).toBe(1);
  });

  it("prevents an adjacent turning bus body from sweeping through a car", () => {
    const car = {
      id: "car", kind: "CAR" as const, current: { x: 1, y: 9 }, next: { x: 1, y: 8 },
      progress: 0.36, cruiseSpeed: 0.0024,
      path: [{ x: 1, y: 9 }, { x: 1, y: 8 }, { x: 1, y: 7 }], trail: [{ x: 1, y: 10 }],
    };
    const bus = {
      id: "bus", kind: "BUS" as const, current: { x: -1, y: 8 }, next: { x: -1, y: 9 },
      progress: 0.94, cruiseSpeed: 0.0019,
      path: [{ x: -1, y: 8 }, { x: -1, y: 9 }, { x: 0, y: 9 }, { x: 1, y: 9 }], trail: [{ x: -1, y: 7 }],
    };
    const decisions = planVehicleFrame([car, bus], 50);
    const project = (vehicle: TrafficVehicleSnapshot, advance: number): TrafficVehicleSnapshot => {
      const progress = vehicle.progress + advance;
      if (progress < 1) return { ...vehicle, progress };
      return {
        ...vehicle,
        current: vehicle.next,
        next: vehicle.path[2]!,
        progress: progress - 1,
        path: vehicle.path.slice(1),
        trail: [vehicle.current, ...(vehicle.trail ?? [])],
      };
    };

    expect(independentlyOverlaps(car, bus)).toBe(false);
    expect(independentlyOverlaps(
      project(car, decisions.get("car")!.advance),
      project(bus, decisions.get("bus")!.advance),
    )).toBe(false);
    expect(decisions.get("bus")!.advance).toBeLessThan(0.095);
  });

  it("checks continuously immediately before a bus changes orientation", () => {
    const bus = {
      id: "bus", kind: "BUS" as const, current: { x: -1, y: 1 }, next: { x: -1, y: 0 },
      progress: 0.962146, cruiseSpeed: 0.0019,
      path: [{ x: -1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }], trail: [{ x: -1, y: 2 }],
    };
    const car = {
      id: "car", kind: "CAR" as const, current: { x: 1, y: -2 }, next: { x: 1, y: -1 },
      progress: 0.082806, cruiseSpeed: 0.0029,
      path: [{ x: 1, y: -2 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 0 }], trail: [{ x: 1, y: -3 }],
    };
    const decisions = planVehicleFrame([bus, car], 50);
    const project = (vehicle: TrafficVehicleSnapshot, advance: number): TrafficVehicleSnapshot => {
      const progress = vehicle.progress + advance;
      if (progress < 1) return { ...vehicle, progress };
      return {
        ...vehicle,
        current: vehicle.next,
        next: vehicle.path[2]!,
        progress: progress - 1,
        path: vehicle.path.slice(1),
        trail: [vehicle.current, ...(vehicle.trail ?? [])],
      };
    };

    expect(independentlyOverlaps(bus, car)).toBe(false);
    for (let step = 1; step <= 1_000; step += 1) {
      const fraction = step / 1_000;
      expect(independentlyOverlaps(
        project(bus, decisions.get("bus")!.advance * fraction),
        project(car, decisions.get("car")!.advance * fraction),
      ), `fraction ${fraction}`).toBe(false);
    }
  });

  it("resolves an exact car and bus overlap deterministically instead of advancing both", () => {
    const vehicles = [
      {
        id: "car", kind: "CAR" as const, current: { x: 0, y: 0 }, next: { x: 1, y: 0 },
        progress: 0.5, cruiseSpeed: 0.0024, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      },
      {
        id: "bus", kind: "BUS" as const, current: { x: 0, y: 0 }, next: { x: 1, y: 0 },
        progress: 0.5, cruiseSpeed: 0.0017, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      },
    ];
    const decisions = planVehicleFrame(vehicles, 50);

    expect(vehicleUnsafePairCount(vehicles)).toBe(1);
    expect(decisions.get("bus")?.advance).toBeCloseTo(0.085);
    expect(decisions.get("car")?.advance).toBe(0);
    expect(decisions.get("car")?.blockedBy).toBe("bus");
  });
});
