import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCityMobility, type CityMobilityAgent, type CityMobilityInput } from "../src/client/city-mobility";
import { buildMobilityNetwork } from "../src/client/city-mobility-network";
import type { Cell, RoadCellDto } from "../src/shared/contracts";
import { microAmbientSprite } from "../src/shared/micro-ambient";

const cellKey = ({ x, y }: Cell) => `${x},${y}`;

/** Five mixed rectangular blocks, a T at (24,24), an X at (48,24), and one-cell
 * courtyard paths. This fixture is independent of the engine's graph builder. */
function mixedStreetFixture(seed: number, cars = 48, walkers = 64): CityMobilityInput {
  const roads = new Map<string, RoadCellDto>();
  const street = (from: Cell, to: Cell) => {
    const vertical = from.x === to.x;
    for (let along = vertical ? from.y : from.x; along <= (vertical ? to.y : to.x); along++) {
      for (let band = -1; band <= 1; band++) {
        const cell = vertical ? { x: from.x + band, y: along } : { x: along, y: from.y + band };
        roads.set(cellKey(cell), { ...cell, roadClass: "LOCAL", mask: 0, structure: "ROAD" });
      }
    }
  };
  for (const y of [0, 24, 48]) street({ x: -1, y }, { x: 73, y });
  for (const x of [0, 48, 72]) street({ x, y: -1 }, { x, y: 49 });
  street({ x: 24, y: -1 }, { x: 24, y: 25 });
  const walkGraph = new Map<string, Cell>();
  const directions = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
  for (const road of roads.values()) for (const delta of directions) {
    const cell = { x: road.x + delta.x, y: road.y + delta.y };
    if (!roads.has(cellKey(cell))) walkGraph.set(cellKey(cell), cell);
  }
  const crosswalks = new Set<string>();
  for (const y of [0, 24, 48]) for (const x of [8, 16, 32, 40, 56, 64]) {
    for (let band = -1; band <= 1; band++) {
      const cell = { x, y: y + band };
      crosswalks.add(cellKey(cell)); walkGraph.set(cellKey(cell), cell);
    }
  }
  for (const x of [0, 24, 48, 72]) for (const y of [8, 16, 32, 40]) {
    for (let band = -1; band <= 1; band++) {
      const cell = { x: x + band, y };
      if (!roads.has(cellKey(cell))) continue;
      crosswalks.add(cellKey(cell)); walkGraph.set(cellKey(cell), cell);
    }
  }
  // A genuine one-cell-wide path with a 90° turn and branch; the surrounding
  // ground is intentionally absent from walkGraph, not an unlimited plaza.
  for (let x = 2; x <= 22; x++) walkGraph.set(`${x},12`, { x, y: 12 });
  for (let y = 2; y <= 22; y++) walkGraph.set(`12,${y}`, { x: 12, y });
  return { roads, walkGraph, crosswalks, activityCells: new Set(["6,12", "12,18", "32,2", "56,26"]),
    seed, carLimit: cars, walkerLimit: walkers };
}

function renderedBody(agent: CityMobilityAgent) {
  // The authoritative opaque pixels and anchor come from the authored asset,
  // independently of the simulation's own collision radii/counters.
  const asset = microAmbientSprite(agent.kind === "CAR" ? "car" : "person", agent.variant, agent.direction);
  return { id: agent.id, kind: agent.kind,
    left: agent.position.x + (asset.opaqueBounds.left - asset.anchor.x) / 8,
    right: agent.position.x + (asset.opaqueBounds.right - asset.anchor.x) / 8,
    top: agent.position.y + (asset.opaqueBounds.top - asset.anchor.y) / 8,
    bottom: agent.position.y + (asset.opaqueBounds.bottom - asset.anchor.y) / 8 };
}

function firstRenderedOverlap(agents: readonly CityMobilityAgent[]) {
  const bodies = agents.map(renderedBody);
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i]!, b = bodies[j]!;
    if (a.left < b.right - 1e-7 && a.right > b.left + 1e-7 && a.top < b.bottom - 1e-7 && a.bottom > b.top + 1e-7) {
      return { a: agents[i], b: agents[j], bodyA: a, bodyB: b };
    }
  }
  return undefined;
}

function actualCityFixture(): CityMobilityInput {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/city-mobility-real-city.json', import.meta.url), 'utf8')) as {
    seed: number; carLimit: number; walkerLimit: number; roads: RoadCellDto[]; walkGraph: Cell[];
    crosswalks: string[]; activityCells: string[];
  };
  return { ...fixture, roads: new Map(fixture.roads.map(cell => [cellKey(cell), cell])),
    walkGraph: new Map(fixture.walkGraph.map(cell => [cellKey(cell), cell])),
    crosswalks: new Set(fixture.crosswalks), activityCells: new Set(fixture.activityCells) };
}

const adjacent = (cell: Cell): Cell[] => [{ x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y },
  { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 }];

/** Independent baseline: the pre-thinning contract removed only blind walking
 * tails. No proposed navigation reduction participates in this oracle. */
function referenceWalkCore(input: CityMobilityInput): Map<string, Cell> {
  const cells = new Map([...input.walkGraph].filter(([key]) => !input.roads.has(key) || input.crosswalks.has(key)));
  const tails = [...cells].filter(([, cell]) => adjacent(cell).filter(next => cells.has(cellKey(next))).length < 2).map(([key]) => key);
  for (let index = 0; index < tails.length; index++) {
    const cell = cells.get(tails[index]!);
    if (!cell) continue;
    cells.delete(tails[index]!);
    for (const next of adjacent(cell)) if (cells.has(cellKey(next)) && adjacent(next).filter(neighbor => cells.has(cellKey(neighbor))).length < 2) tails.push(cellKey(next));
  }
  return cells;
}

function reachable(graph: ReadonlyMap<string, Cell>, start: Cell): Set<string> {
  const visited = new Set([cellKey(start)]), queue = [start];
  for (let index = 0; index < queue.length; index++) for (const cell of adjacent(queue[index]!)) {
    const key = cellKey(cell);
    if (visited.has(key) || !graph.has(key)) continue;
    visited.add(key); queue.push(cell);
  }
  return visited;
}

describe("independent native-pixel mobility acceptance", () => {
  it("preserves eligible real-city access in the FINAL walking network, not just the intermediate spine", ({ task }) => {
    const input = actualCityFixture(), baseline = referenceWalkCore(input), final = buildMobilityNetwork(input).walkers;
    const protectedCells = new Set([...baseline].filter(([key, cell]) => input.crosswalks.has(key)
      || input.activityCells.has(key) || adjacent(cell).some(next => input.roads.has(cellKey(next)))).map(([key]) => key));
    const lost = [...protectedCells].filter(key => !final.has(key));
    const eligibleActivities = [...input.activityCells].filter(key => baseline.has(key));
    const retainedActivities = eligibleActivities.filter(key => final.has(key));
    Object.assign(task.meta, { mobilityAccess: { baselineCells: baseline.size, finalCells: final.size,
      protectedCells: protectedCells.size, eligibleActivities: eligibleActivities.length, retainedActivities: retainedActivities.length, lost } });
    expect(eligibleActivities).toHaveLength(114);
    expect(lost, 'Navigation optimization must not strand previously usable crossings, curb paths or task access').toEqual([]);
    const remaining = new Set(protectedCells);
    while (remaining.size > 0) {
      const start = baseline.get(remaining.values().next().value!)!;
      const before = reachable(baseline, start), after = reachable(final, start);
      for (const key of before) if (protectedCells.has(key)) {
        expect(after.has(key), `Previously connected protected access ${key}`).toBe(true);
        remaining.delete(key);
      }
    }
  });

  for (const seed of [107_250_608, 73, 424_242]) it(`preserves individual progress on exact real-city geometry for five virtual minutes (seed ${seed})`, ({ task }) => {
    const input = actualCityFixture();
    input.seed = seed;
    const city = createCityMobility(input);
    expect(city.agents.filter(agent => agent.kind === 'CAR')).toHaveLength(13);
    expect(city.agents.filter(agent => agent.kind === 'WALKER')).toHaveLength(23);
    const ids = city.agents.map(agent => agent.id).sort();
    const checkpoints = new Map(city.agents.map(agent => [agent.id, agent.steps]));
    const stalled: Array<{id: string; kind: string; atMs: number; steps: number; waitMs: number; reason: string}> = [];
    const progressWindows: Array<{ endMs: number; expectedParticipants: number; observedParticipants: number; minimumCompletedCellTransitions: number }> = [];
    const timings: number[] = [];
    let overlap: ReturnType<typeof firstRenderedOverlap>;
    let overlapAtMs: number | undefined;
    let maxWaitMs = 0;
    let longestWaitAgent: CityMobilityAgent | undefined;
    for (let step = 0; step < 6_000; step++) {
      const startedAt = performance.now();
      city.advance(50);
      if (step >= 100) timings.push(performance.now() - startedAt);
      if (!overlap) {
        overlap = firstRenderedOverlap(city.agents);
        if (overlap) overlapAtMs = (step + 1) * 50;
      }
      for (const agent of city.agents) {
        if (agent.waitMs > maxWaitMs) { maxWaitMs = agent.waitMs; longestWaitAgent = agent; }
        if (input.roads.has(cellKey(agent.current)) && agent.activity !== 'NONE') throw new Error(`Road activity: ${JSON.stringify(agent)}`);
        if (agent.kind === 'WALKER' && !input.walkGraph.has(cellKey(agent.current))) throw new Error(`Walker left graph: ${JSON.stringify(agent)}`);
      }
      if ((step + 1) % 1_200 === 0) {
        const currentById = new Map(city.agents.map(agent => [agent.id, agent]));
        const completedTransitions: number[] = [];
        for (const id of ids) {
          const agent = currentById.get(id);
          if (!agent) {
            stalled.push({ id, kind: 'MISSING', atMs: (step + 1) * 50, steps: 0, waitMs: 0, reason: 'Original participant disappeared' });
            completedTransitions.push(0); continue;
          }
          const delta = agent.steps - checkpoints.get(id)!;
          if (delta <= 0) stalled.push({ id, kind: agent.kind, atMs: (step + 1) * 50,
            steps: agent.steps, waitMs: agent.waitMs, reason: agent.yieldReason });
          completedTransitions.push(delta);
          checkpoints.set(id, agent.steps);
        }
        progressWindows.push({ endMs: (step + 1) * 50, expectedParticipants: ids.length, observedParticipants: currentById.size,
          minimumCompletedCellTransitions: Math.min(...completedTransitions) });
      }
    }
    timings.sort((a,b) => a-b);
    const report = { fixture: 'city-mobility-real-city.json', seed: input.seed, virtualMs: 300_000,
      roads: input.roads.size, walkingCells: input.walkGraph.size, crossingCells: input.crosswalks.size,
      cars: input.carLimit, walkers: input.walkerLimit, fixedSteps: city.metrics.fixedSteps,
      p95Ms: timings[Math.floor(timings.length * .95)]!, maximumStepMs: timings.at(-1),
      maxWaitMs, longestWaitAgent, blockedAgents: city.agents.filter(agent => agent.waitMs >= 30_000),
      metrics: city.metrics, overlapAtMs, overlap, stalled, progressWindows };
    Object.assign(task.meta, { mobility: report });
    expect(overlap, `Native opaque sprite bodies overlapped at ${overlapAtMs}ms`).toBeUndefined();
    expect(stalled, 'Every original car and walker must complete a cell transition in every sixty-second window').toEqual([]);
    expect(city.agents.map(agent => agent.id).sort()).toEqual(ids);
    expect(city.metrics.networkBuilds).toBe(1);
    expect(city.metrics.fixedSteps).toBe(6_000);
    expect(maxWaitMs).toBeLessThan(60_000);
    expect(report.p95Ms).toBeLessThan(5);
  }, 60_000);

  it("does not respawn or move anyone when identical geography is refreshed in a different insertion order", () => {
    const input = mixedStreetFixture(42, 12, 16);
    const city = createCityMobility(input);
    city.advance(1_025);
    const before = structuredClone(city.agents);
    const metricsBefore = city.metrics;
    city.updateNetwork({ roads: new Map([...input.roads].reverse()), walkGraph: new Map([...input.walkGraph].reverse()),
      crosswalks: new Set([...input.crosswalks].reverse()), activityCells: new Set([...input.activityCells].reverse()) });
    expect(city.agents).toEqual(before);
    expect(city.metrics).toEqual(metricsBefore);
    expect(city.metrics.networkBuilds).toBe(1);
  });

  for (const seed of [73, 424_242, 987_321]) it(`preserves real body clearance and free-graph progress for two virtual minutes (seed ${seed})`, ({ task }) => {
    const input = mixedStreetFixture(seed);
    const city = createCityMobility(input);
    expect(city.agents.filter(agent => agent.kind === "CAR")).toHaveLength(48);
    expect(city.agents.filter(agent => agent.kind === "WALKER")).toHaveLength(64);
    const initialIds = city.agents.map(agent => agent.id).sort();
    const timings: number[] = [];
    let overlap: ReturnType<typeof firstRenderedOverlap>;
    let overlapAtMs: number | undefined;
    let maxWaitMs = 0;
    let longestWaitAgent: CityMobilityAgent | undefined;
    const carCheckpoints = new Map(city.agents.filter(agent => agent.kind === "CAR").map(agent => [agent.id, agent.steps]));
    const stalled: Array<{ id: string; atMs: number; steps: number; waitMs: number; reason: string }> = [];
    for (let step = 0; step < 2_400; step++) {
      const startedAt = performance.now();
      city.advance(50);
      const elapsed = performance.now() - startedAt;
      if (step >= 100) timings.push(elapsed); // five virtual seconds of warmup
      if (!overlap) {
        overlap = firstRenderedOverlap(city.agents);
        if (overlap) overlapAtMs = (step + 1) * 50;
      }
      for (const agent of city.agents) {
        if (agent.waitMs > maxWaitMs) { maxWaitMs = agent.waitMs; longestWaitAgent = agent; }
        if (input.roads.has(cellKey(agent.current)) && agent.activity !== "NONE") throw new Error(`Road activity: ${JSON.stringify(agent)}`);
        if (agent.kind === "WALKER" && !input.walkGraph.has(cellKey(agent.current))) throw new Error(`Walker left graph: ${JSON.stringify(agent)}`);
      }
      if ((step + 1) % 1_200 === 0) for (const agent of city.agents.filter(agent => agent.kind === "CAR")) {
        if (agent.steps <= carCheckpoints.get(agent.id)!) stalled.push({ id: agent.id, atMs: (step + 1) * 50, steps: agent.steps, waitMs: agent.waitMs, reason: agent.yieldReason });
        carCheckpoints.set(agent.id, agent.steps);
      }
    }
    timings.sort((a, b) => a - b);
    const p95Ms = timings[Math.floor(timings.length * .95)]!;
    const report = { seed, virtualMs: 120_000, roads: input.roads.size, walkingCells: input.walkGraph.size,
      crossingCells: input.crosswalks.size, cars: 48, walkers: 64, fixedSteps: city.metrics.fixedSteps,
      p95Ms, maximumStepMs: timings.at(-1), maxWaitMs, longestWaitAgent,
      blockedAgents: city.agents.filter(agent => agent.waitMs >= 30_000),
      metrics: city.metrics, overlapAtMs, overlap, stalled };
    Object.assign(task.meta, { mobility: report });
    expect(overlap, `Native opaque sprite bodies overlapped at ${overlapAtMs}ms`).toBeUndefined();
    expect(stalled, "Every original car must make progress in both sixty-second free-graph windows").toEqual([]);
    expect(city.agents.map(agent => agent.id).sort()).toEqual(initialIds);
    expect(city.metrics.networkBuilds).toBe(1);
    expect(city.metrics.fixedSteps).toBe(2_400);
    expect(maxWaitMs).toBeLessThan(60_000);
    expect(p95Ms, `48-car / 64-person fixed-step CPU budget; ${input.roads.size} road cells`).toBeLessThan(5);
  }, 60_000);
});
