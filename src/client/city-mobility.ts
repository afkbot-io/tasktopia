import type { Cell } from "../shared/contracts";
import { microAmbientSprite, type MicroDirection } from "../shared/micro-ambient";
import { nextSeededRandom } from "./agent-routing";
import { buildMobilityNetwork, mobilityCellKey as key, mobilityNetworkSignature, searchMobilityRoutes, type MobilityNetwork, type MobilityNetworkInput, type MobilityZone } from "./city-mobility-network";

export type CityMobilityInput = MobilityNetworkInput & { seed: number; carLimit: number; walkerLimit: number };
export type CityMobilityAgent = {
  id: string; kind: "CAR" | "WALKER"; variant: string; current: Cell; next: Cell; progress: number;
  position: Cell; direction: MicroDirection; speed: number; steps: number;
  activity: "NONE" | "REST"; waitMs: number;
  yieldReason: "NONE" | "RESERVATION" | "OCCUPIED_EXIT" | "BODY";
};
export type CityMobilitySignal = Pick<MobilityZone, "id" | "bounds" | "signalPosts"> & {
  horizontal: "RED" | "GREEN"; vertical: "RED" | "GREEN"; pedestrians: "RED" | "GREEN";
};
export type CityMobilityMetrics = {
  vehicleSteps: number; walkerSteps: number; vehicleUnsafePairs: number; pedestrianUnsafePairs: number;
  vehiclePedestrianUnsafePairs: number; vehicleUnsafeTotal: number; pedestrianUnsafeTotal: number; vehiclePedestrianUnsafeTotal: number;
  maxVehicleWaitMs: number; maxWalkerWaitMs: number; completedTrips: number; crossingsCompleted: number;
  peakVehicleWaitMs: number; peakWalkerWaitMs: number;
  fixedSteps: number; networkBuilds: number;
};
export type CityMobility = {
  updateNetwork(input: MobilityNetworkInput & Partial<Pick<CityMobilityInput, "carLimit" | "walkerLimit">>): void;
  advance(elapsedMs: number): void;
  readonly agents: readonly CityMobilityAgent[];
  readonly signals: readonly CityMobilitySignal[];
  readonly metrics: Readonly<CityMobilityMetrics>;
};

type Agent = CityMobilityAgent & {
  route: Cell[]; previous?: Cell; restMs: number; rng: number; requestedAt?: number; zoneId?: string;
  // Immutable lane endpoints of the currently traversed edge. A future route
  // repair must never change the geometry under an already moving body.
  segmentStart: Cell; segmentEnd: Cell;
};
type Reservation = { owner: string; exit: Cell; axis: "H" | "V" | "P" };
const STEP_MS = 50, EPSILON = 1e-8, WALK_INSET = .25;
const heading = (from: Cell, to: Cell, fallback: MicroDirection): MicroDirection => to.x > from.x ? "east" : to.x < from.x ? "west" : to.y > from.y ? "south" : to.y < from.y ? "north" : fallback;
const horizontal = (direction: MicroDirection) => direction === "east" || direction === "west";
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
const inset = (direction: MicroDirection): Cell => direction === "east" ? { x: 0, y: WALK_INSET } : direction === "west" ? { x: 0, y: -WALK_INSET } : direction === "south" ? { x: -WALK_INSET, y: 0 } : { x: WALK_INSET, y: 0 };

function segmentEnd(kind: Agent["kind"], route: readonly Cell[], direction: MicroDirection): Cell {
  if (kind === "CAR") return { x: 0, y: 0 };
  const outgoing = route[2] ? heading(route[1]!, route[2], direction) : direction;
  const a = inset(direction), b = inset(outgoing);
  return direction === outgoing ? a : { x: a.x + b.x, y: a.y + b.y };
}
function position(agent: Pick<Agent, "current" | "next" | "progress" | "segmentStart" | "segmentEnd">): Cell {
  const p = agent.progress, start = agent.segmentStart, end = agent.segmentEnd;
  return { x: agent.current.x + .5 + (agent.next.x - agent.current.x) * p + start.x * (1 - p) + end.x * p,
    y: agent.current.y + .5 + (agent.next.y - agent.current.y) * p + start.y * (1 - p) + end.y * p };
}

const bodies = new Map<string, { half: Cell; offset: Cell }>();
function body(agent: Pick<Agent, "kind" | "variant" | "direction">) {
  const cacheKey = `${agent.kind}:${agent.variant}:${agent.direction}`;
  let result = bodies.get(cacheKey);
  if (!result) {
    const art = microAmbientSprite(agent.kind === "CAR" ? "car" : "person", agent.variant, agent.direction);
    const { left, right, top, bottom } = art.opaqueBounds;
    result = { half: { x: (right - left) / 16, y: (bottom - top) / 16 },
      offset: { x: ((left + right) / 2 - art.anchor.x) / 8, y: ((top + bottom) / 2 - art.anchor.y) / 8 } };
    bodies.set(cacheKey, result);
  }
  return result;
}
const bodyCenter = (agent: CityMobilityAgent): Cell => ({ x: agent.position.x + body(agent).offset.x, y: agent.position.y + body(agent).offset.y });
// Authored people are 3×4 in EVERY heading. On horizontal walking lanes their
// four-pixel lateral envelopes meet at the tile centre without overlapping.
const safetyGap = (a: CityMobilityAgent, b: CityMobilityAgent) => a.kind === "WALKER" && b.kind === "WALKER" ? 0 : .025;

function overlap(a: CityMobilityAgent, b: CityMobilityAgent, gap = 0): boolean {
  const ae = body(a).half, be = body(b).half, ac = bodyCenter(a), bc = bodyCenter(b);
  return Math.abs(ac.x - bc.x) + EPSILON < ae.x + be.x + gap
    && Math.abs(ac.y - bc.y) + EPSILON < ae.y + be.y + gap;
}

function projected(agent: Agent, advance: number): Agent {
  let route = agent.route, current = agent.current, next = agent.next, previous = agent.previous;
  let start = agent.segmentStart, end = agent.segmentEnd;
  let p = agent.progress + advance, steps = agent.steps, direction = agent.direction;
  while (p >= 1 - EPSILON && route.length > 1) {
    p = Math.max(0, p - 1); previous = current; current = next; route = route.slice(1); next = route[1] ?? current; steps++;
    direction = heading(current, next, direction);
    start = end;
    end = route.length > 1 ? segmentEnd(agent.kind, route, direction) : start;
  }
  if (route.length < 2) p = 0;
  const result = { ...agent, route, current, next, previous, progress: p, steps, direction, segmentStart: start, segmentEnd: end };
  result.position = position(result);
  return result;
}

type MotionGeometry = { kind: Agent["kind"]; origin: Cell; velocity: Cell; afterOrigin: Cell; afterVelocity: Cell; cutoff: number; beforeHalf: Cell; afterHalf: Cell };
type BodyPose = { x: number; y: number; half: Cell };
function motionGeometry(agent: Agent): MotionGeometry {
  const cutoff = 1 - agent.progress, origin = bodyCenter(agent);
  const end = bodyCenter({ ...agent, position: position({ ...agent, progress: 1 }) });
  const after = projected(agent, cutoff), afterOrigin = bodyCenter(after);
  const afterEnd = bodyCenter({ ...after, position: position({ ...after, progress: 1 }) });
  return { kind: agent.kind, origin, cutoff, velocity: { x: (end.x - origin.x) / cutoff, y: (end.y - origin.y) / cutoff },
    afterOrigin, afterVelocity: { x: afterEnd.x - afterOrigin.x, y: afterEnd.y - afterOrigin.y }, beforeHalf: body(agent).half, afterHalf: body(after).half };
}
function geometryPose(geometry: MotionGeometry, distance: number): BodyPose {
  const after = distance >= geometry.cutoff - EPSILON;
  const origin = after ? geometry.afterOrigin : geometry.origin, velocity = after ? geometry.afterVelocity : geometry.velocity;
  const along = after ? Math.max(0, distance - geometry.cutoff) : distance;
  return { x: origin.x + velocity.x * along, y: origin.y + velocity.y * along, half: after ? geometry.afterHalf : geometry.beforeHalf };
}

/** Exact piecewise-linear swept AABB check over cached geometry, without
 * copying route/state or re-reading artwork in the pair-resolution loop. */
function motionConflict(a: MotionGeometry, b: MotionGeometry, aa: number, ba: number): boolean {
  const gap = a.kind === "WALKER" && b.kind === "WALKER" ? 0 : .025;
  const events = [0, 1];
  for (const [geometry, advance] of [[a, aa], [b, ba]] as const) {
    const event = advance > 0 ? geometry.cutoff / advance : 2;
    if (event > 0 && event < 1) events.push(event);
  }
  events.sort((x, y) => x - y);
  for (const time of events) for (const dt of [-1e-7, 0, 1e-7]) {
    const t = time + dt;
    if (t < 0 || t > 1) continue;
    const ap = geometryPose(a, aa * t), bp = geometryPose(b, ba * t);
    if (Math.abs(ap.x - bp.x) + EPSILON < ap.half.x + bp.half.x + gap
      && Math.abs(ap.y - bp.y) + EPSILON < ap.half.y + bp.half.y + gap) return true;
  }
  const interval = (start: number, end: number, radius: number): [number, number] | undefined => {
    const velocity = end - start;
    if (Math.abs(velocity) < EPSILON) return Math.abs(start) + EPSILON < radius ? [0, 1] : undefined;
    const t1 = (-radius - start) / velocity, t2 = (radius - start) / velocity;
    const low = Math.max(0, Math.min(t1, t2)), high = Math.min(1, Math.max(t1, t2));
    return low + EPSILON < high ? [low, high] : undefined;
  };
  for (let i = 1; i < events.length; i++) {
    const start = events[i - 1]! + 1e-7, end = events[i]! - 1e-7;
    if (start >= end) continue;
    const af = geometryPose(a, aa * start), at = geometryPose(a, aa * end), bf = geometryPose(b, ba * start), bt = geometryPose(b, ba * end);
    const x = interval(af.x - bf.x, at.x - bt.x, af.half.x + bf.half.x + gap);
    const y = interval(af.y - bf.y, at.y - bt.y, af.half.y + bf.half.y + gap);
    if (x && y && Math.max(x[0], y[0]) + EPSILON < Math.min(x[1], y[1])) return true;
  }
  return false;
}

/** A complete passage has an actual safe destination outside the conflict zone. */
export function mobilityPassageExitIndex(route: readonly Cell[], zone: Pick<MobilityZone, "cells">): number {
  const first = route.findIndex(cell => zone.cells.has(key(cell)));
  if (first < 0) return -1;
  for (let i = first + 1; i < route.length; i++) if (!zone.cells.has(key(route[i]!))) return i;
  return -1;
}
export function mobilityPassageExit(route: readonly Cell[], zone: Pick<MobilityZone, "cells">): Cell | undefined {
  return route[mobilityPassageExitIndex(route, zone)];
}

/** Public admission policy: an exit cannot be borrowed from an occupied body. */
export function mobilityExitAvailable(exit: Cell, incoming: Pick<CityMobilityAgent, "id" | "kind" | "variant" | "direction">, agents: readonly CityMobilityAgent[]): boolean {
  const offset = incoming.kind === "WALKER" ? inset(incoming.direction) : { x: 0, y: 0 };
  const center = { x: exit.x + .5 + offset.x, y: exit.y + .5 + offset.y };
  const candidate = { ...incoming, position: center } as CityMobilityAgent;
  return agents.every(other => other.id === incoming.id || !overlap(candidate, other, incoming.kind === "CAR" ? .18 : safetyGap(candidate, other)));
}

/** No renderer state, RAF clocks or random globals enter this deterministic controller. */
export function createCityMobility(input: CityMobilityInput): CityMobility {
  let network: MobilityNetwork = buildMobilityNetwork(input);
  let actors: Agent[] = [], rng = input.seed || 1, idCounter = 0, remainder = 0, clock = 0;
  const limits = { CAR: Math.max(0, Math.min(48, Math.floor(input.carLimit))), WALKER: Math.max(0, Math.min(64, Math.floor(input.walkerLimit))) };
  const reservations = new Map<string, Reservation>();
  const metrics: CityMobilityMetrics = { vehicleSteps: 0, walkerSteps: 0, vehicleUnsafePairs: 0, pedestrianUnsafePairs: 0, vehiclePedestrianUnsafePairs: 0, vehicleUnsafeTotal: 0, pedestrianUnsafeTotal: 0, vehiclePedestrianUnsafeTotal: 0, maxVehicleWaitMs: 0, maxWalkerWaitMs: 0, peakVehicleWaitMs: 0, peakWalkerWaitMs: 0, completedTrips: 0, crossingsCompleted: 0, fixedSteps: 0, networkBuilds: 1 };
  let agentsSnapshot: readonly CityMobilityAgent[] = [], signalSnapshot: readonly CityMobilitySignal[] = [];
  const random = () => { const result = nextSeededRandom(rng); rng = result.state; return result.value; };
  const graph = (kind: Agent["kind"]) => kind === "CAR" ? network.cars : network.walkers;
  const edges = (kind: Agent["kind"]) => kind === "CAR" ? network.carEdges : network.walkerEdges;
  const safeDestination = (cell: Cell) => !network.zoneByCell.has(key(cell));
  const plan = (agent: Agent): void => {
    const search = searchMobilityRoutes(graph(agent.kind), edges(agent.kind), agent.current, agent.previous);
    const destinations = search.cells.filter(cell => {
      if (!safeDestination(cell) || same(cell, agent.current)) return false;
      if (agent.kind === "CAR") return true;
      const neighbors = edges(agent.kind).get(key(cell)) ?? [];
      // Stop/rest on a straight path, never a corner where a future turn would
      // need to move the resting person sideways or block both walking lanes.
      return neighbors.length === 2 && neighbors[0]!.x + neighbors[1]!.x === cell.x * 2 && neighbors[0]!.y + neighbors[1]!.y === cell.y * 2;
    });
    let preferred = agent.kind === "WALKER" && agent.steps % 3 === 0 ? destinations.filter(cell => network.activityCells.has(key(cell))) : [];
    if (!preferred.length) preferred = destinations;
    let best: Cell[] = [];
    for (let attempt = 0; attempt < 6 && preferred.length; attempt++) {
      const picked = nextSeededRandom(agent.rng); agent.rng = picked.state;
      const destination = preferred[Math.floor(picked.value * preferred.length)]!;
      const route = search.routeTo(destination);
      if (route.length > best.length) best = route;
      if (best.length >= 12) break;
    }
    if (best.length < 2) {
      const reachable = edges(agent.kind).get(key(agent.current)) ?? [];
      for (const cell of reachable) {
        if (agent.previous && same(cell, agent.previous)) continue;
        if (!safeDestination(cell)) continue;
        best = [agent.current, cell]; break;
      }
    }
    if (best.length < 2) return;
    agent.route = best; agent.next = best[1]!; agent.direction = heading(agent.current, agent.next, agent.direction); agent.progress = 0;
    agent.segmentStart = agent.previous ? { x: agent.position.x - agent.current.x - .5, y: agent.position.y - agent.current.y - .5 }
      : agent.kind === "WALKER" ? inset(agent.direction) : { x: 0, y: 0 };
    agent.segmentEnd = segmentEnd(agent.kind, best, agent.direction);
    agent.position = position(agent);
  };

  const spawn = (): void => {
    for (const kind of ["CAR", "WALKER"] as const) {
      const candidates = [...graph(kind).values()].filter(cell => safeDestination(cell) && (edges(kind).get(key(cell))?.length ?? 0) > 0);
      let remaining = limits[kind] - actors.filter(actor => actor.kind === kind).length;
      for (let attempt = 0; remaining > 0 && attempt < candidates.length * 2; attempt++) {
        const current = candidates[Math.floor(random() * candidates.length)];
        if (!current) break;
        const count = actors.filter(actor => actor.kind === kind).length;
        const actor: Agent = {
          id: `mobility-${input.seed >>> 0}-${idCounter}`, kind, variant: kind === "CAR" ? ["blue", "red", "taxi", "van"][count % 4]! : ["ochre", "teal"][count % 2]!,
          current, next: current, progress: 0, position: { x: current.x + .5, y: current.y + .5 }, direction: "east",
          speed: kind === "CAR" ? .0021 + random() * .00045 : .0012 + random() * .00018,
          steps: 0, activity: "NONE", waitMs: 0, yieldReason: "NONE", route: [current], rng: Math.floor(random() * 0x7fff_ffff) || 1, restMs: 0,
          segmentStart: { x: 0, y: 0 }, segmentEnd: { x: 0, y: 0 },
        };
        plan(actor);
        if (actor.route.length < 2 || actors.some(other => overlap(actor, other, .35))) continue;
        actors.push(actor); idCounter++; remaining--;
      }
    }
  };

  const publish = () => {
    agentsSnapshot = actors.map(({ id, kind, variant, current, next, progress, position, direction, speed, steps, activity, waitMs, yieldReason }) => ({ id, kind, variant, current: { ...current }, next: { ...next }, progress, position: { ...position }, direction, speed, steps, activity, waitMs, yieldReason }));
    signalSnapshot = network.zones.map(zone => {
      const reservation = reservations.get(zone.id);
      return { id: zone.id, bounds: zone.bounds, signalPosts: zone.signalPosts,
        horizontal: reservation?.axis === "H" ? "GREEN" : "RED", vertical: reservation?.axis === "V" ? "GREEN" : "RED", pedestrians: reservation?.axis === "P" ? "GREEN" : "RED" };
    });
  };

  const recordMetrics = () => {
    metrics.vehicleUnsafePairs = metrics.pedestrianUnsafePairs = metrics.vehiclePedestrianUnsafePairs = 0;
    const poses = actors.map(actor => ({ center: bodyCenter(actor), half: body(actor).half }));
    for (let a = 0; a < actors.length; a++) for (let b = a + 1; b < actors.length; b++) {
      const ap = poses[a]!, bp = poses[b]!;
      if (Math.abs(ap.center.x - bp.center.x) + EPSILON >= ap.half.x + bp.half.x
        || Math.abs(ap.center.y - bp.center.y) + EPSILON >= ap.half.y + bp.half.y) continue;
      if (actors[a]!.kind === "CAR" && actors[b]!.kind === "CAR") metrics.vehicleUnsafePairs++;
      else if (actors[a]!.kind === "WALKER" && actors[b]!.kind === "WALKER") metrics.pedestrianUnsafePairs++;
      else metrics.vehiclePedestrianUnsafePairs++;
    }
    metrics.vehicleUnsafeTotal += metrics.vehicleUnsafePairs;
    metrics.pedestrianUnsafeTotal += metrics.pedestrianUnsafePairs;
    metrics.vehiclePedestrianUnsafeTotal += metrics.vehiclePedestrianUnsafePairs;
    metrics.maxVehicleWaitMs = Math.max(0, ...actors.filter(actor => actor.kind === "CAR").map(actor => actor.waitMs));
    metrics.maxWalkerWaitMs = Math.max(0, ...actors.filter(actor => actor.kind === "WALKER").map(actor => actor.waitMs));
    metrics.peakVehicleWaitMs = Math.max(metrics.peakVehicleWaitMs, metrics.maxVehicleWaitMs);
    metrics.peakWalkerWaitMs = Math.max(metrics.peakWalkerWaitMs, metrics.maxWalkerWaitMs);
  };

  const step = () => {
    clock += STEP_MS; metrics.fixedSteps++;
    for (const actor of actors) {
      actor.yieldReason = "NONE";
      if (actor.restMs > 0) { actor.restMs = Math.max(0, actor.restMs - STEP_MS); if (!actor.restMs) actor.activity = "NONE"; }
      if (actor.route.length < 2 && !actor.restMs) plan(actor);
    }
    // Release only after the entire body has passed the last conflict tile.
    for (const [zoneId, reservation] of reservations) {
      const owner = actors.find(actor => actor.id === reservation.owner), zone = network.zones.find(zone => zone.id === zoneId);
      if (!owner || !zone) { reservations.delete(zoneId); continue; }
      const e = body(owner).half, center = bodyCenter(owner);
      let bodyInside = false;
      // Test only tiles beneath this tiny body, not every tile in a whole
      // intersection on every step. The boundary tolerance is unchanged.
      for (let y = Math.floor(center.y - e.y + EPSILON); y <= Math.floor(center.y + e.y - EPSILON); y++) {
        for (let x = Math.floor(center.x - e.x + EPSILON); x <= Math.floor(center.x + e.x - EPSILON); x++) {
          if (zone.cells.has(`${x},${y}`)) bodyInside = true;
        }
      }
      if (!bodyInside && !zone.cells.has(key(owner.next))) {
        reservations.delete(zoneId); owner.zoneId = undefined; owner.requestedAt = undefined;
        if ([...zone.cells].some(cell => network.roads.has(cell))) metrics.crossingsCompleted++;
      }
    }
    const requests: Array<{ actor: Agent; zone: MobilityZone; exit: Cell; exitIndex: number }> = [];
    for (const actor of actors) {
      if (actor.restMs || actor.zoneId) continue;
      const zone = network.zoneByCell.get(key(actor.next));
      if (!zone) { actor.requestedAt = undefined; continue; }
      actor.requestedAt ??= clock;
      const exitIndex = mobilityPassageExitIndex(actor.route, zone), exit = actor.route[exitIndex];
      if (!exit) { actor.yieldReason = "OCCUPIED_EXIT"; continue; }
      requests.push({ actor, zone, exit, exitIndex });
    }
    requests.sort((a, b) => a.actor.requestedAt! - b.actor.requestedAt! || a.actor.id.localeCompare(b.actor.id));
    for (const { actor, zone, exit, exitIndex } of requests) {
      if (reservations.has(zone.id)) { actor.yieldReason = "RESERVATION"; continue; }
      // A loop can leave through its original entry cell on the opposite
      // walking lane. Use this passage's EXIT occurrence, never findIndex(x,y).
      const exitHeading = heading(actor.route[Math.max(0, exitIndex - 1)]!, exit, actor.direction);
      if (!mobilityExitAvailable(exit, { ...actor, direction: exitHeading }, actors)
        || [...reservations.values()].some(reservation => same(reservation.exit, exit))) {
        actor.yieldReason = "OCCUPIED_EXIT"; continue;
      }
      reservations.set(zone.id, { owner: actor.id, exit, axis: actor.kind === "WALKER" ? "P" : horizontal(actor.direction) ? "H" : "V" });
      actor.zoneId = zone.id;
    }
    const movements = new Map<string, number>();
    for (const actor of actors) {
      let distance = actor.restMs || actor.yieldReason !== "NONE" || actor.route.length < 2 ? 0 : actor.speed * STEP_MS;
      const followingZone = actor.route[2] ? network.zoneByCell.get(key(actor.route[2])) : undefined;
      // Never carry a cell-transition remainder beyond an ungranted stop node.
      // Otherwise even 0.1cell of overshoot puts a waiting bumper in the crossing.
      if (followingZone && followingZone.id !== actor.zoneId) distance = Math.min(distance, 1 - actor.progress);
      for (const reservation of reservations.values()) {
        if (reservation.owner === actor.id) continue;
        if (same(actor.next, reservation.exit)) { distance = 0; actor.yieldReason = "RESERVATION"; }
      }
      movements.set(actor.id, distance);
    }
    // Transactional, symmetric collision resolution over the same snapshot.
    // A losing intention is shortened, never rewound or teleported elsewhere.
    const geometries = new Map(actors.map(actor => [actor.id, motionGeometry(actor)]));
    const candidatePairs: Array<[Agent, Agent]> = [];
    for (let a = 0; a < actors.length; a++) for (let b = a + 1; b < actors.length; b++) {
      const left = actors[a]!, right = actors[b]!;
      if (Math.abs(left.position.x - right.position.x) <= 2 && Math.abs(left.position.y - right.position.y) <= 2) candidatePairs.push([left, right]);
    }
    const conflict = (a: Agent, b: Agent, aa: number, ba: number) => motionConflict(geometries.get(a.id)!, geometries.get(b.id)!, aa, ba);
    for (let pass = 0; pass < actors.length * 3; pass++) {
      let changed = false;
      for (const [left, right] of candidatePairs) {
        const la = movements.get(left.id)!, ra = movements.get(right.id)!;
        if (!conflict(left, right, la, ra)) continue;
        const preferred = Boolean(left.zoneId) !== Boolean(right.zoneId) ? left.zoneId ? right : left
          : left.waitMs !== right.waitMs ? left.waitMs < right.waitMs ? left : right
            : left.id.localeCompare(right.id) > 0 ? left : right;
        for (const loser of [preferred, preferred === left ? right : left]) {
          const other = loser === left ? right : left, maximum = movements.get(loser.id)!;
          if (maximum < EPSILON) continue;
          for (let fraction = 15; fraction >= 0; fraction--) {
            const distance = maximum * fraction / 16;
            if (conflict(loser, other, distance, movements.get(other.id)!)) continue;
            movements.set(loser.id, distance); loser.yieldReason = "BODY"; changed = true; break;
          }
          if (changed) break;
        }
        if (!changed && (la > EPSILON || ra > EPSILON)) {
          movements.set(left.id, 0); movements.set(right.id, 0); left.yieldReason = right.yieldReason = "BODY"; changed = true;
        }
        if (changed) break;
      }
      if (!changed) break;
    }
    actors = actors.map(actor => {
      const distance = movements.get(actor.id)!;
      const next = projected(actor, distance);
      next.waitMs = distance > .000_001 || actor.restMs > 0 ? 0 : actor.waitMs + STEP_MS;
      const steps = next.steps - actor.steps;
      if (actor.kind === "CAR") metrics.vehicleSteps += steps; else metrics.walkerSteps += steps;
      if (actor.route.length > 1 && next.route.length < 2) {
        metrics.completedTrips++;
        if (actor.kind === "WALKER" && !network.roads.has(key(next.current)) && !next.zoneId && network.activityCells.has(key(next.current))) {
          next.activity = "REST"; next.restMs = 650 + Math.abs(next.rng % 700);
        }
      }
      return next;
    });
    recordMetrics();
  };

  spawn(); recordMetrics(); publish();
  return {
    updateNetwork(updated) {
      const oldCarLimit = limits.CAR, oldWalkerLimit = limits.WALKER;
      if (updated.carLimit !== undefined) limits.CAR = Math.max(0, Math.min(48, Math.floor(updated.carLimit)));
      if (updated.walkerLimit !== undefined) limits.WALKER = Math.max(0, Math.min(64, Math.floor(updated.walkerLimit)));
      if (mobilityNetworkSignature(updated) === network.signature) {
        if (oldCarLimit !== limits.CAR || oldWalkerLimit !== limits.WALKER) { spawn(); recordMetrics(); publish(); }
        return;
      }
      network = buildMobilityNetwork(updated); metrics.networkBuilds++;
      actors = actors.filter(actor => graph(actor.kind).has(key(actor.current)) && graph(actor.kind).has(key(actor.next))
        // A road edit can reverse a lane while retaining both cells. Such an
        // invalid physical edge is retired, never kept as a wrong-way route.
        && (same(actor.current, actor.next) || edges(actor.kind).get(key(actor.current))?.some(next => same(next, actor.next))));
      for (const actor of actors) {
        actor.zoneId = undefined; actor.requestedAt = undefined;
        if (actor.route.some((cell, i) => !graph(actor.kind).has(key(cell)) || i > 0 && !edges(actor.kind).get(key(actor.route[i - 1]!))?.some(next => same(cell, next)))) {
          // Preserve the current physical edge; repair only its future suffix.
          actor.route = [actor.current, actor.next];
        }
      }
      reservations.clear(); spawn(); recordMetrics(); publish();
    },
    advance(elapsedMs) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("Mobility elapsed time must be finite and nonnegative");
      remainder += elapsedMs;
      let stepped = false;
      while (remainder + EPSILON >= STEP_MS) { remainder = Math.max(0, remainder - STEP_MS); step(); stepped = true; }
      if (stepped) publish();
    },
    get agents() { return agentsSnapshot; }, get signals() { return signalSnapshot; }, get metrics() { return { ...metrics }; },
  };
}
