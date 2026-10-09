import type { RoadEventSite } from "./city-road-events";
import type { Cell } from "../shared/contracts";
import { roadBandRole } from '../shared/road-profile';
import { MICRO_CAR_VARIANTS, MICRO_PERSON_VARIANTS, microAmbientSprite, type MicroDirection } from "../shared/micro-ambient";
import { nextSeededRandom } from "./agent-routing";
import { buildMobilityNetwork, mobilityCellKey as key, mobilityNetworkSignature, type MobilityNetwork, type MobilityNetworkInput, type MobilityZone } from "./city-mobility-network";
import { createMobilityRouteSearch } from "./mobility-route-search";

export type CityMobilityInput = MobilityNetworkInput & { seed: number; carLimit: number; walkerLimit: number;spawnPriorityCells?:readonly Cell[] };
export type CityResponseRole = "POLICE" | "FIRE" | "AMBULANCE" | "REPAIR" | "BUS" | "SCHOOL_BUS" | "TOW";
export type CityMobilityAgent = {
  id: string; kind: "CAR" | "WALKER"; variant: string; current: Cell; next: Cell; progress: number;
  position: Cell; direction: MicroDirection; speed: number; steps: number;
  activity: "NONE" | "REST" | "PARKED" | "INSIDE"; waitMs: number;
  yieldReason: "NONE" | "RESERVATION" | "OCCUPIED_EXIT" | "BODY" | "ROAD_CLOSED" | "WORK_SITE";
  response?: CityResponseRole;
  visit?: { id: string; arrived: boolean };
  carrier?: string;
  age?: 'CHILD' | 'ADULT';
};
export type CityMobilitySignal = Pick<MobilityZone, "id" | "bounds" | "signalPosts"> & {
  horizontal: "RED" | "GREEN"; vertical: "RED" | "GREEN"; pedestrians: "RED" | "GREEN";
};
export type CityMobilityMetrics = {
  vehicleSteps: number; walkerSteps: number; vehicleUnsafePairs: number; pedestrianUnsafePairs: number;
  vehiclePedestrianUnsafePairs: number; vehicleUnsafeTotal: number; pedestrianUnsafeTotal: number; vehiclePedestrianUnsafeTotal: number;
  maxVehicleWaitMs: number; maxWalkerWaitMs: number; completedTrips: number; crossingsCompleted: number;
  peakVehicleWaitMs: number; peakWalkerWaitMs: number;
  fixedSteps: number; networkBuilds: number; closureBuilds: number; responseTrips: number; cancelledPassengers: number;
};
export type CityExternalCarrier={id:string;position:Cell;doors:readonly Cell[];boardingCells:readonly Cell[];doorsOpen:boolean;capacity:number};
export type CityMobility = {
  updateNetwork(input: MobilityNetworkInput & Partial<Pick<CityMobilityInput, "carLimit" | "walkerLimit"|"spawnPriorityCells">>): void;
  advance(elapsedMs: number): void;
  setRoadClosures(cells: ReadonlySet<string>): void;
  setWalkClosures(cells: ReadonlySet<string>): void;
  roadEventSites(): RoadEventSite[];
  dispatchResponse(role: CityResponseRole, targets: readonly Cell[], stayMs?: number, agentId?: string): boolean;
  clearResponses(roles?: readonly CityResponseRole[], agentId?: string): void;
  dispatchVisit(id: string, targets: readonly Cell[], count: number, stayMs: number, indoors: boolean, actorIds?: readonly string[]): string[];
  clearVisits(id?: string): void;
  boardVisit(id: string, vehicleId: string): number;
  alightVisit(vehicleId: string, targets: readonly Cell[]): number;
  updateExternalCarrier(carrier: CityExternalCarrier): void;
  boardExternalVisit(visitId: string, carrierId: string): number;
  alightExternalCarrier(carrierId: string): number;
  removeExternalCarrier(carrierId: string): void;
  releaseResponse(agentId: string, retainMs?: number): void;
  canDrive(from: Cell, to: Cell): boolean;
  readonly agents: readonly CityMobilityAgent[];
  readonly signals: readonly CityMobilitySignal[];
  readonly metrics: Readonly<CityMobilityMetrics>;
  readonly walkingCells: ReadonlyMap<string, Cell>;
  readonly visitTargets: ReadonlyMap<string, Cell>;
};

type Agent = CityMobilityAgent & {
  baseVariant: string; responseUntil?: number; responseStayMs?: number; responseTarget?: Cell; responseRetryAt?: number;
  visitStayMs?: number; visitUntil?: number; visitDeadline?: number; visitIndoors?: boolean; visitTarget?: Cell; visitRetryAt?: number;
  alightPending?: boolean;
  evacuating?: boolean;
  evacuationTargets?: Cell[];
  route: Cell[]; previous?: Cell; restMs: number; rng: number; requestedAt?: number; zoneId?: string;
  // At most one uncommitted doorway pose; never a chain of prior actors.
  pendingExit?: Agent;
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
  // INSIDE positions are doorway references for the next trip, not bodies
  // occupying outdoor lanes. The renderer hides these people completely.
  if (a.activity === "INSIDE" || b.activity === "INSIDE") return false;
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
  let carRoutes = createMobilityRouteSearch(network.cars, network.carEdges);
  let closures = new Set<string>();
  const compileClosures = () => {
    carRoutes.setBlocked(closures);
  };
  let walkerRoutes = createMobilityRouteSearch(network.walkers, network.walkerEdges);
  let walkClosures = new Set<string>(), walkClosureInput: ReadonlySet<string> | undefined;
  const compileWalkClosures = () => {
    walkerRoutes.setBlocked(walkClosures);
  };
  let spawnPriorityCells=input.spawnPriorityCells??[];
  const externalCarriers=new Map<string,CityExternalCarrier & {cancelled?:boolean;recoveryRetryAt?:number}>();
  let actors: Agent[] = [], rng = input.seed || 1, idCounter = 0, remainder = 0, clock = 0;
  const limits = { CAR: Math.max(0, Math.min(48, Math.floor(input.carLimit))), WALKER: Math.max(0, Math.min(64, Math.floor(input.walkerLimit))) };
  const reservations = new Map<string, Reservation>();
  const metrics: CityMobilityMetrics = { vehicleSteps: 0, walkerSteps: 0, vehicleUnsafePairs: 0, pedestrianUnsafePairs: 0, vehiclePedestrianUnsafePairs: 0, vehicleUnsafeTotal: 0, pedestrianUnsafeTotal: 0, vehiclePedestrianUnsafeTotal: 0, maxVehicleWaitMs: 0, maxWalkerWaitMs: 0, peakVehicleWaitMs: 0, peakWalkerWaitMs: 0, completedTrips: 0, crossingsCompleted: 0, fixedSteps: 0, networkBuilds: 1, closureBuilds: 0, responseTrips: 0, cancelledPassengers: 0 };
  let agentsSnapshot: readonly CityMobilityAgent[] = [], signalSnapshot: readonly CityMobilitySignal[] = [];
  const random = () => { const result = nextSeededRandom(rng); rng = result.state; return result.value; };
  const graph = (kind: Agent["kind"]) => kind === "CAR" ? network.cars : network.walkers;
  const edges = (kind: Agent["kind"]) => kind === "CAR" ? network.carEdges : network.walkerEdges;
  const safeDestination = (cell: Cell) => !network.zoneByCell.has(key(cell));
  let visitTargets = new Map([...network.walkers].filter(([id, cell]) => !network.roads.has(id) && safeDestination(cell)));
  const beginRoute = (agent: Agent, route: Cell[]) => {
    agent.route = route; agent.next = route[1]!; agent.direction = heading(agent.current, agent.next, agent.direction); agent.progress = 0;
    agent.segmentStart = agent.previous ? { x: agent.position.x - agent.current.x - .5, y: agent.position.y - agent.current.y - .5 }
      : agent.kind === "WALKER" ? inset(agent.direction) : { x: 0, y: 0 };
    agent.segmentEnd = segmentEnd(agent.kind, route, agent.direction); agent.position = position(agent);
  };
  const plan = (agent: Agent): void => {
    if (agent.visit && !agent.visit.arrived && clock < (agent.visitRetryAt ?? 0)) return;
    if (agent.responseTarget && clock < (agent.responseRetryAt ?? 0)) return;
    if (agent.kind === 'CAR' && agent.response && agent.responseTarget && !agent.evacuating) {
      // A shortened route is not arrival. Keep the requested curb while a
      // closure requires a detour or waiting, rather than taking a random trip.
      if (closures.has(key(agent.responseTarget)) || !network.cars.has(key(agent.responseTarget))) { agent.responseRetryAt = clock + 1000; return; }
      if (same(agent.current, agent.responseTarget)) {
        const stay = agent.responseStayMs ?? 2500;
        agent.responseUntil = clock + stay; agent.activity = 'REST'; agent.restMs = stay; metrics.responseTrips++; return;
      }
      const route = carRoutes(agent.current, agent.previous, agent.responseTarget,
        agent.response === 'BUS' || agent.response === 'SCHOOL_BUS' ? 64 : 28).routeTo(agent.responseTarget);
      if (route.length < 2 || route.length > (agent.response === 'BUS' || agent.response === 'SCHOOL_BUS' ? 64 : 28)) { agent.responseRetryAt = clock + 1000; return; }
      agent.responseRetryAt = undefined; beginRoute(agent, route); return;
    }
    if (agent.visit && !agent.visit.arrived && agent.visitTarget) {
      // Closures can shorten a physical route. Its former last edge is not an
      // arrival: retain the requested destination and retry the actual graph.
      if (walkClosures.has(key(agent.visitTarget)) || !network.walkers.has(key(agent.visitTarget))) { agent.visitRetryAt = clock + 1000; return; }
      if (same(agent.current, agent.visitTarget)) {
        agent.visit = { ...agent.visit, arrived: true }; agent.visitUntil = clock + (agent.visitStayMs ?? 3000);
        agent.activity = agent.visitIndoors ? 'INSIDE' : 'REST'; agent.restMs = agent.visitStayMs ?? 3000; return;
      }
      const route = walkerRoutes(agent.current, agent.previous, agent.visitTarget, 48).routeTo(agent.visitTarget);
      if (route.length < 2 || route.length > 48) { agent.visitRetryAt = clock + 1000; return; }
      beginRoute(agent, route); return;
    }
    const turnaround = agent.kind === 'WALKER' && network.transferCells.has(key(agent.current));
    const search = (agent.kind === "CAR" ? carRoutes : walkerRoutes)(agent.current, turnaround ? undefined : agent.previous);
    const destinations = search.cells.filter(cell => {
      if (!safeDestination(cell) || same(cell, agent.current)) return false;
      if (agent.kind === "CAR") return true;
      const neighbors = edges(agent.kind).get(key(cell)) ?? [];
      if (network.buildingEntrances.has(key(cell))) return neighbors.length > 0;
      // Stop/rest on a straight path, never a corner where a future turn would
      // need to move the resting person sideways or block both walking lanes.
      return neighbors.length === 2 && neighbors[0]!.x + neighbors[1]!.x === cell.x * 2 && neighbors[0]!.y + neighbors[1]!.y === cell.y * 2;
    });
    let preferred = agent.kind === "WALKER" && agent.steps % 3 === 0 ? destinations.filter(cell => network.buildingEntrances.has(key(cell))) : [];
    if (!preferred.length && agent.kind === "WALKER" && agent.steps % 3 === 0) preferred = destinations.filter(cell => network.activityCells.has(key(cell)));
    if(agent.kind==='CAR'&&agent.steps%3===0&&!network.parkingBays.has(key(agent.current))) {
      preferred=destinations.filter(cell=>network.parkingBays.has(key(cell)));
    }
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
      const reachable = ((agent.kind === "CAR" ? network.carEdges : network.walkerEdges).get(key(agent.current)) ?? [])
        .filter(cell => !(agent.kind === "CAR" ? closures : walkClosures).has(key(cell)));
      for (const cell of reachable) {
        if (!turnaround && agent.previous && same(cell, agent.previous)) continue;
        if (!safeDestination(cell)) continue;
        best = [agent.current, cell]; break;
      }
    }
    if (best.length < 2) return;
    beginRoute(agent, best);
  };

  const alight = (vehicleId: string, targets: readonly Cell[]): number => {
    const external=externalCarriers.get(vehicleId);
    const vehicle = actors.find(actor => actor.id === vehicleId && actor.kind === 'CAR');
    if(external?!external.doorsOpen:!vehicle || vehicle.activity !== 'REST' || vehicle.route.length > 1)return 0;
    let count = 0;
    for (const passenger of actors.filter(actor => actor.carrier === vehicleId)) {
      for (const target of targets) {
        if (!network.walkers.has(key(target)) || network.roads.has(key(target)) || walkClosures.has(key(target)) || !safeDestination(target)
          || (external? (!external.cancelled && !external.boardingCells.some(cell=>same(cell,target))) || !external.doors.some(door=>Math.hypot(target.x+.5-door.x,target.y+.5-door.y)<=2)
            : Math.hypot(target.x+.5-vehicle!.position.x,target.y+.5-vehicle!.position.y)>4 || !curbSide(vehicle!.current,target)))continue;
        const exit: Agent = { ...passenger, carrier: undefined, alightPending: undefined, visit: undefined, visitUntil: undefined, visitTarget: undefined,
          activity: 'NONE', restMs: 0, pendingExit: undefined, route: [target], current: target, next: target, previous: undefined,
          progress: 0, position: { x: target.x + .5, y: target.y + .5 }, segmentStart: { x: 0, y: 0 }, segmentEnd: { x: 0, y: 0 } };
        plan(exit);
        if (exit.route.length < 2 || actors.some(other => other.id !== passenger.id && overlap(exit, other, safetyGap(exit, other)))) continue;
        Object.assign(passenger, exit); count++; break;
      }
    }
    return count;
  };

  const curbSide = (lane: Cell, target: Cell) => {
    const role = roadBandRole(network.roads, lane);
    if (role.kind !== 'TRAVEL') return false;
    const forward = (target.x - lane.x) * role.dx + (target.y - lane.y) * role.dy;
    const lateral = (target.x - lane.x) * -role.dy + (target.y - lane.y) * role.dx;
    return lateral > 0 && lateral <= 3 && Math.abs(forward) <= 2;
  };
  const nearbyExits = (cell: Cell): Cell[] => {
    const targets: Cell[] = [];
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const target = network.walkers.get(`${cell.x + x},${cell.y + y}`);
      if (target && !network.roads.has(key(target)) && !walkClosures.has(key(target)) && safeDestination(target) && curbSide(cell, target)) targets.push(target);
    }
    return targets.sort((a, b) => Math.abs(a.x - cell.x) + Math.abs(a.y - cell.y) - Math.abs(b.x - cell.x) - Math.abs(b.y - cell.y));
  };
  /** Cancellation finishes the physical edge and drives to a reachable curb.
   * Passengers remain inside until that car rests and a body-safe exit exists. */
  const recoverPassengers = (vehicle: Agent) => {
    vehicle.evacuating = true;
    vehicle.responseTarget = undefined; vehicle.responseRetryAt = undefined;
    for (const passenger of actors) if (passenger.carrier === vehicle.id) passenger.alightPending = true;
    const moving = vehicle.route.length > 1, start = moving ? vehicle.next : vehicle.current;
    const search = carRoutes(start, moving ? vehicle.current : vehicle.previous);
    for (const cell of search.cells) {
      if (!network.roads.has(key(cell)) || !safeDestination(cell) || closures.has(key(cell))) continue;
      const exits = nearbyExits(cell); if (!exits.length) continue;
      const suffix = search.routeTo(cell); if (!suffix.length || suffix.length > 28) continue;
      vehicle.route = moving ? [vehicle.current, ...suffix] : suffix;
      vehicle.evacuationTargets = exits; vehicle.responseUntil = undefined; vehicle.responseStayMs = 30_000;
      if (vehicle.route.length === 1) { vehicle.activity = 'REST'; vehicle.restMs = 30_000; }
      else {
        vehicle.restMs = 0; vehicle.activity = 'NONE';
        if (!moving) { vehicle.next = vehicle.route[1]!; vehicle.direction = heading(vehicle.current, vehicle.next, vehicle.direction);
          vehicle.progress = 0; vehicle.segmentStart = { x: 0, y: 0 }; vehicle.segmentEnd = { x: 0, y: 0 }; }
      }
      return;
    }
    // No safe curb currently reachable: retain ordinary motion and retry once
    // its current trip ends. Never invent a walk cell or a mid-road exit.
    vehicle.evacuationTargets = undefined;
  };

  const spawn = (): void => {
    for (const kind of ["CAR", "WALKER"] as const) {
      const candidates = [...graph(kind).values()].filter(cell => !(kind === "CAR" ? closures : walkClosures).has(key(cell)) && (kind!=="CAR"||network.roads.has(key(cell))) && safeDestination(cell) && (edges(kind).get(key(cell))?.length ?? 0) > 0);
      const byCell=new Map(candidates.map(cell=>[key(cell),cell]));
      const preferred=kind==="WALKER"?spawnPriorityCells.slice(0,8).map(p=>{
        const choices:Cell[]=[];for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
          const distance=Math.abs(x)+Math.abs(y);if(distance<2||distance>4)continue;
          const cell=byCell.get(`${p.x+x},${p.y+y}`);if(cell)choices.push(cell);
        }return {stop:p,choices};
      }).filter(entry=>entry.choices.length):[];
      let remaining = limits[kind] - actors.filter(actor => actor.kind === kind).length;
      for (let attempt = 0; remaining > 0 && attempt < candidates.length * 2; attempt++) {
        const nearby=kind==="WALKER"&&actors.filter(actor=>actor.kind==="WALKER").length<Math.min(6,Math.floor(limits.WALKER/3))&&preferred.length&&attempt<32;
        const priority=nearby?preferred[actors.filter(actor=>actor.kind==="WALKER").length%preferred.length]:undefined;
        const choices=priority?.choices??candidates;
        const current = choices[Math.floor(random() * choices.length)];
        if (!current) break;
        const count = actors.filter(actor => actor.kind === kind).length;
        const actor: Agent = {
          id: `mobility-${input.seed >>> 0}-${idCounter}`, kind, variant: kind === "CAR" ? MICRO_CAR_VARIANTS[count % MICRO_CAR_VARIANTS.length]! : MICRO_PERSON_VARIANTS[count % MICRO_PERSON_VARIANTS.length]!,
          baseVariant: kind === "CAR" ? MICRO_CAR_VARIANTS[count % MICRO_CAR_VARIANTS.length]! : MICRO_PERSON_VARIANTS[count % MICRO_PERSON_VARIANTS.length]!,
          age: kind === 'WALKER' ? count % 4 === 0 ? 'CHILD' : 'ADULT' : undefined,
          current, next: current, progress: 0, position: { x: current.x + .5, y: current.y + .5 }, direction: "east",
          speed: kind === "CAR" ? .0021 + random() * .00045 : .0012 + random() * .00018,
          steps: 0, activity: "NONE", waitMs: 0, yieldReason: "NONE", route: [current], rng: Math.floor(random() * 0x7fff_ffff) || 1, restMs: 0,
          segmentStart: { x: 0, y: 0 }, segmentEnd: { x: 0, y: 0 },
        };
        const stop=priority?.stop;
        const approach=stop&&network.transferCells.has(key(stop))?walkerRoutes(current,undefined,stop,48).routeTo(stop):[];
        if(approach.length>=2)beginRoute(actor,approach);else plan(actor);
        if (actor.route.length < 2 || actors.some(other => overlap(actor, other, .35))) continue;
        actors.push(actor); idCounter++; remaining--;
      }
    }
  };

  const publish = () => {
    agentsSnapshot = actors.map(({ id, kind, variant, current, next, progress, position, direction, speed, steps, activity, waitMs, yieldReason, response, visit, carrier, age }) => ({ id, kind, variant, current: { ...current }, next: { ...next }, progress, position: { ...position }, direction, speed, steps, activity, waitMs, yieldReason, response, visit: visit && { ...visit }, carrier, age }));
    signalSnapshot = network.zones.map(zone => {
      const reservation = reservations.get(zone.id);
      return { id: zone.id, bounds: zone.bounds, signalPosts: zone.signalPosts,
        horizontal: reservation?.axis === "H" ? "GREEN" : "RED", vertical: reservation?.axis === "V" ? "GREEN" : "RED", pedestrians: reservation?.axis === "P" ? "GREEN" : "RED" };
    });
  };

  const recordMetrics = () => {
    metrics.vehicleUnsafePairs = metrics.pedestrianUnsafePairs = metrics.vehiclePedestrianUnsafePairs = 0;
    const outdoor = actors.filter(actor => actor.activity !== "INSIDE");
    const poses = outdoor.map(actor => ({ center: bodyCenter(actor), half: body(actor).half }));
    for (let a = 0; a < outdoor.length; a++) for (let b = a + 1; b < outdoor.length; b++) {
      const ap = poses[a]!, bp = poses[b]!;
      if (Math.abs(ap.center.x - bp.center.x) + EPSILON >= ap.half.x + bp.half.x
        || Math.abs(ap.center.y - bp.center.y) + EPSILON >= ap.half.y + bp.half.y) continue;
      if (outdoor[a]!.kind === "CAR" && outdoor[b]!.kind === "CAR") metrics.vehicleUnsafePairs++;
      else if (outdoor[a]!.kind === "WALKER" && outdoor[b]!.kind === "WALKER") metrics.pedestrianUnsafePairs++;
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
      if (actor.evacuating) {
        if (!actors.some(a => a.carrier === actor.id)) {
          actor.evacuating = undefined; actor.evacuationTargets = undefined;
          actor.response = undefined; actor.responseUntil = undefined; actor.responseTarget = undefined; actor.responseRetryAt = undefined; actor.variant = actor.baseVariant;
          actor.restMs = 0; actor.activity = 'NONE';
        } else if (actor.activity === 'REST') {
          alight(actor.id, actor.evacuationTargets ?? nearbyExits(actor.current));
          if (actor.restMs <= STEP_MS) recoverPassengers(actor);
        } else if (actor.route.length < 2) recoverPassengers(actor);
      }
      if (actor.visit && clock >= (actor.visitUntil ?? actor.visitDeadline ?? Infinity)) {
        actor.visit = undefined; actor.visitUntil = undefined; actor.visitDeadline = undefined; actor.visitTarget = undefined; actor.visitRetryAt = undefined;
      }
      if (actor.responseUntil !== undefined && clock >= actor.responseUntil) {
        if (actors.some(a => a.carrier === actor.id)) recoverPassengers(actor);
        else { actor.response = undefined; actor.responseUntil = undefined; actor.responseTarget = undefined; actor.responseRetryAt = undefined; actor.variant = actor.baseVariant; }
      }
      if (actor.restMs > 0) {
        actor.restMs = Math.max(0, actor.restMs - STEP_MS);
        if (!actor.restMs) {
          if (actor.activity === "INSIDE") {
            // Leaving a doorway can reverse the walking lane. Admit the new
            // pose while still hidden; planning directly on the live actor
            // would move its lateral offset before swept collision checks.
            let exit = actor.pendingExit;
            if (!exit) {
              exit = { ...actor, pendingExit: undefined, previous: undefined, activity: "NONE" };
              plan(exit);
              actor.pendingExit = exit;
            }
            if (walkClosures.has(key(exit.current)) || actors.some(other => other.id !== actor.id && overlap(exit, other, safetyGap(exit, other)))) {
              actor.restMs = STEP_MS;
              actor.yieldReason = "OCCUPIED_EXIT";
            } else Object.assign(actor, exit, { pendingExit: undefined });
          } else actor.activity = "NONE";
        }
      }
      if (actor.route.length < 2 && !actor.restMs) plan(actor);
      if (actor.kind === "CAR" && closures.size && actor.route.length < 2 && !actor.restMs) actor.yieldReason = "ROAD_CLOSED";
      if (actor.kind === "WALKER" && walkClosures.size && actor.route.length < 2 && !actor.restMs) actor.yieldReason = "WORK_SITE";
    }
    // Release only after the entire body has passed the last conflict tile.
    for (const [zoneId, reservation] of reservations) {
      const owner = actors.find(actor => actor.id === reservation.owner), zone = network.zones.find(zone => zone.id === zoneId);
      if (!owner || !zone) { reservations.delete(zoneId); continue; }
      if (owner.activity === 'INSIDE') { reservations.delete(zoneId); owner.zoneId = undefined; owner.requestedAt = undefined; continue; }
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
      let exitIndex = mobilityPassageExitIndex(actor.route, zone);
      if (exitIndex < 0 && actor.kind === 'WALKER' && actor.visitIndoors && actor.visitTarget
        && network.buildingEntrances.has(key(actor.visitTarget)) && same(actor.route.at(-1)!, actor.visitTarget)) exitIndex = actor.route.length - 1;
      const exit = actor.route[exitIndex];
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
    const outdoor = actors.filter(actor => actor.activity !== "INSIDE");
    const geometries = new Map(outdoor.map(actor => [actor.id, motionGeometry(actor)]));
    const candidatePairs: Array<[Agent, Agent]> = [];
    for (let a = 0; a < outdoor.length; a++) for (let b = a + 1; b < outdoor.length; b++) {
      const left = outdoor[a]!, right = outdoor[b]!;
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
        if (actor.response && actor.responseUntil === undefined && (!actor.responseTarget || same(next.current, actor.responseTarget))) {
          const stay = actor.responseStayMs ?? 2500;
          next.responseUntil = clock + stay; next.activity = "REST"; next.restMs = stay; metrics.responseTrips++;
        }
        if(!actor.response && actor.kind==='CAR'&&network.parkingBays.has(key(next.current))) {
          next.activity='PARKED';next.restMs=7000+Math.abs(next.rng%9000);
        }
        if (actor.kind === 'WALKER' && actor.visit && !actor.visit.arrived && actor.visitTarget
          && same(next.current, actor.visitTarget) && !walkClosures.has(key(next.current))) {
          next.visit = { ...actor.visit, arrived: true }; next.visitUntil = clock + (actor.visitStayMs ?? 3000);
          next.activity = actor.visitIndoors ? 'INSIDE' : 'REST'; next.restMs = actor.visitStayMs ?? 3000;
        } else if (actor.kind === "WALKER" && !actor.visit && !network.roads.has(key(next.current)) && !next.zoneId
          && (network.activityCells.has(key(next.current)) || network.buildingEntrances.has(key(next.current)))) {
          next.activity = network.buildingEntrances.has(key(next.current)) ? "INSIDE" : "REST";
          next.restMs = 650 + Math.abs(next.rng % 700);
        }
      }
      return next;
    });
    for (const passenger of actors.filter(actor => actor.carrier)) {
      const vehicle = actors.find(actor => actor.id === passenger.carrier);
      const external=externalCarriers.get(passenger.carrier!);
      if (vehicle) passenger.position = { ...vehicle.position };
      else if(external)passenger.position={...external.position};
    }
    for(const [id,carrier] of externalCarriers)if(carrier.cancelled && clock>=(carrier.recoveryRetryAt??0)){
      carrier.recoveryRetryAt=clock+1000;
      // Recovery is limited to the last physical doors. A deleted platform
      // cannot teleport its hidden representatives to a remote neighbourhood.
      const targets = new Map<string, Cell>();
      for (const door of carrier.doors) for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) {
        const cell=network.walkers.get(`${Math.floor(door.x)+dx},${Math.floor(door.y)+dy}`);
        if(cell&&!network.roads.has(key(cell))&&Math.hypot(cell.x+.5-door.x,cell.y+.5-door.y)<=2) targets.set(key(cell),cell);
      }
      if(targets.size) alight(id,[...targets.values()]);
      else {
        // The terminal no longer exists. Retire only its invisible local
        // representatives; don't replay the trip or create replacement people.
        const before=actors.length;
        actors=actors.filter(actor=>actor.carrier!==id);
        metrics.cancelledPassengers+=before-actors.length;
      }
      if(!actors.some(actor=>actor.carrier===id))externalCarriers.delete(id);
    }
    recordMetrics();
  };

  spawn(); recordMetrics(); publish();
  return {
    updateNetwork(updated) {
      if(updated.spawnPriorityCells)spawnPriorityCells=updated.spawnPriorityCells;
      const oldCarLimit = limits.CAR, oldWalkerLimit = limits.WALKER;
      if (updated.carLimit !== undefined) limits.CAR = Math.max(0, Math.min(48, Math.floor(updated.carLimit)));
      if (updated.walkerLimit !== undefined) limits.WALKER = Math.max(0, Math.min(64, Math.floor(updated.walkerLimit)));
      if (limits.CAR < oldCarLimit || limits.WALKER < oldWalkerLimit) {
        const counts={CAR:0,WALKER:0};
        actors=actors.filter(actor=>actor.carrier||++counts[actor.kind]<=limits[actor.kind]);
        const alive=new Set(actors.map(actor=>actor.id));
        for(const [id,reservation] of reservations) if(!alive.has(reservation.owner)) reservations.delete(id);
      }
      if (mobilityNetworkSignature(updated) === network.signature) {
        const alive = new Set(actors.map(actor => actor.id));
        actors = actors.filter(actor => !actor.carrier || (alive.has(actor.carrier)||externalCarriers.has(actor.carrier)));
        if (oldCarLimit !== limits.CAR || oldWalkerLimit !== limits.WALKER) { spawn(); recordMetrics(); publish(); }
        return;
      }
      network = buildMobilityNetwork(updated); metrics.networkBuilds++;
      visitTargets = new Map([...network.walkers].filter(([id, cell]) => !network.roads.has(id) && safeDestination(cell)));
      closures = new Set([...closures].filter(id => network.cars.has(id)));
      carRoutes = createMobilityRouteSearch(network.cars, network.carEdges);
      compileClosures();
      walkClosures = new Set([...walkClosures].filter(id => network.walkers.has(id)));
      walkerRoutes = createMobilityRouteSearch(network.walkers, network.walkerEdges);
      compileWalkClosures();
      for (const actor of actors) actor.pendingExit = undefined;
      actors = actors.filter(actor => actor.carrier&&externalCarriers.has(actor.carrier) || graph(actor.kind).has(key(actor.current)) && graph(actor.kind).has(key(actor.next))
        // A road edit can reverse a lane while retaining both cells. Such an
        // invalid physical edge is retired, never kept as a wrong-way route.
        && (same(actor.current, actor.next) || edges(actor.kind).get(key(actor.current))?.some(next => same(next, actor.next))));
      const alive = new Set(actors.map(actor => actor.id));
      actors = actors.filter(actor => !actor.carrier || (alive.has(actor.carrier)||externalCarriers.has(actor.carrier)));
      for (const actor of actors) {
        actor.zoneId = undefined; actor.requestedAt = undefined;
        if (actor.evacuating) recoverPassengers(actor);
        if (actor.route.some((cell, i) => !graph(actor.kind).has(key(cell)) || i > 0 && !edges(actor.kind).get(key(actor.route[i - 1]!))?.some(next => same(cell, next)))) {
          // Preserve the current physical edge; repair only its future suffix.
          actor.route = [actor.current, actor.next];
        }
      }
      reservations.clear(); spawn(); recordMetrics(); publish();
    },
    setWalkClosures(cells) {
      if (walkClosureInput === cells) return;
      walkClosureInput = cells;
      const next = new Set([...cells].filter(id => network.walkers.has(id)));
      if (next.size === walkClosures.size && [...next].every(id => walkClosures.has(id))) return;
      walkClosures = next; compileWalkClosures();
      for (const actor of actors) if (actor.kind === "WALKER") {
        actor.pendingExit = undefined;
        if (!actor.route.some((cell, i) => i > 0 && walkClosures.has(key(cell)))) continue;
        if (walkClosures.has(key(actor.next)) && actor.progress === 0) { actor.route = [actor.current]; actor.next = actor.current; }
        else actor.route = actor.route.slice(0, 2);
      }
      publish();
    },
    setRoadClosures(cells) {
      const next = new Set([...cells].filter(id => network.cars.has(id)));
      if (next.size === closures.size && [...next].every(id => closures.has(id))) return;
      closures = next; compileClosures(); metrics.closureBuilds++;
      for (const actor of actors) if (actor.kind === "CAR" && actor.route.some((cell, i) => i > 0 && closures.has(key(cell)))) {
        // Finish a physical edge already in progress; only future intentions
        // are replaced. An empty lane is selected before a new episode closes it.
        if (closures.has(key(actor.next)) && actor.progress === 0) {
          actor.route = [actor.current]; actor.next = actor.current;
        } else actor.route = actor.route.slice(0, 2);
      }
      publish();
    },
    roadEventSites() {
      // A cosmetic call cannot choose a lane whose curb no available service
      // can reach. Compute this once per episode, not on animation frames.
      const reachable = new Set<string>();
      for (const actor of actors.filter(a => a.kind === "CAR" && !a.response).slice(0, 6)) {
        const moving = actor.route.length >= 2, start = moving ? actor.next : actor.current;
        const search = carRoutes(start, moving ? actor.current : actor.previous, undefined, 28);
        for (const cell of search.cells) {
          if (!safeDestination(cell) || Math.abs(cell.x - start.x) + Math.abs(cell.y - start.y) > 28) continue;
          const length = search.routeTo(cell).length;
          if (length >= 2 && length <= 28) reachable.add(key(cell));
        }
      }
      const unsafe = new Set<string>();
      for (const actor of actors) if (actor.kind === "CAR") for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) unsafe.add(`${Math.floor(actor.position.x) + x},${Math.floor(actor.position.y) + y}`);
      for (const id of network.zoneByCell.keys()) {
        const cell = network.cars.get(id); if (!cell) continue;
        for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) unsafe.add(`${cell.x + x},${cell.y + y}`);
      }
      // A scene can only use a curb within five cells of a reachable responder.
      // Index that local coverage once instead of probing121 cells at every
      // road in a megacity. Preserve the canonical candidate iteration order.
      const responseCoverage = new Set<string>();
      for (const id of reachable) {
        const cell = network.cars.get(id)!;
        for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) responseCoverage.add(`${cell.x + x},${cell.y + y}`);
      }
      const sites: RoadEventSite[] = [];
      for (const [id, outgoing] of network.carEdges) {
        const first = network.cars.get(id), second = outgoing[0];
        if (!first || !second || unsafe.has(id) || closures.has(id) || !responseCoverage.has(id)) continue;
        const third = network.carEdges.get(key(second))?.find(cell => cell.x - second.x === second.x - first.x && cell.y - second.y === second.y - first.y);
        if (!third || [second, third].some(cell => unsafe.has(key(cell)) || closures.has(key(cell)) || !network.roads.has(key(cell)))) continue;
        const cells = [first, second, third];
        const responseCells: Cell[] = [];
        for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
          const c = network.cars.get(`${first.x + x},${first.y + y}`);
          if (c && reachable.has(key(c)) && !network.zoneByCell.has(key(c)) && cells.every(cell => Math.abs(c.x - cell.x) + Math.abs(c.y - cell.y) >= 3)) responseCells.push(c);
        }
        const behind = { x: first.x - second.x + first.x, y: first.y - second.y + first.y };
        const towCell = network.carEdges.get(key(behind))?.some(cell => same(cell, first)) && safeDestination(behind) && reachable.has(key(behind)) ? behind : undefined;
        if (responseCells.length) sites.push({ cells, responseCells, towCell });
      }
      return sites;
    },
    dispatchResponse(role, targets, stayMs = 2500, agentId) {
      if (!targets.length || actors.filter(a => a.response && a.id !== agentId).length >= 2) return false;
      const candidates = actors.filter(actor => actor.kind === "CAR" && !actor.evacuating && (!actor.response || actor.id === agentId) && (!agentId || actor.id === agentId))
        .sort((a, b) => Math.min(...targets.map(c => Math.abs(c.x-a.next.x)+Math.abs(c.y-a.next.y)))-Math.min(...targets.map(c => Math.abs(c.x-b.next.x)+Math.abs(c.y-b.next.y)))).slice(0, 6);
      let picked: { actor: Agent; route: Cell[] } | undefined;
      for (const actor of candidates) {
        const moving = actor.route.length >= 2;
        const start = moving ? actor.next : actor.current;
        const search = carRoutes(start, moving ? actor.current : actor.previous, undefined, role === 'BUS' || role === 'SCHOOL_BUS' ? 64 : 28);
        for (const target of targets) {
          if (!safeDestination(target) || closures.has(key(target))) continue;
          const suffix = search.routeTo(target);
          if (suffix.length < 2 || suffix.length > (role === 'BUS' || role === 'SCHOOL_BUS' ? 64 : 28)) continue;
          const route = moving ? [actor.current, ...suffix] : suffix;
          if (!picked || route.length < picked.route.length) picked = { actor, route };
        }
      }
      if (!picked) return false;
      const actor = picked.actor, moving = actor.route.length >= 2;
      actor.route = picked.route; actor.restMs = 0; actor.activity = "NONE";
      if (!moving) {
        actor.next = actor.route[1]!; actor.direction = heading(actor.current, actor.next, actor.direction);
        actor.progress = 0; actor.segmentStart = { x: 0, y: 0 }; actor.segmentEnd = { x: 0, y: 0 };
      }
      actor.response = role; actor.responseUntil = undefined; actor.responseTarget = { ...picked.route.at(-1)! }; actor.responseRetryAt = undefined;
      actor.responseStayMs = Math.max(500, Math.min(30_000, Number.isFinite(stayMs) ? stayMs : 2500));
      actor.variant = role === "POLICE" ? "blue" : role === "FIRE" ? "red" : "van";
      publish(); return true;
    },
    clearResponses(roles, agentId) {
      for (const actor of actors) if (actor.response && (!roles || roles.includes(actor.response)) && (!agentId || actor.id === agentId)) {
        if (actors.some(passenger => passenger.carrier === actor.id)) { recoverPassengers(actor); continue; }
        actor.response = undefined; actor.responseUntil = undefined; actor.responseTarget = undefined; actor.responseRetryAt = undefined; actor.variant = actor.baseVariant;
        actor.restMs = 0; actor.activity = "NONE"; actor.route = actor.route.slice(0, 2);
      }
      publish();
    },
    dispatchVisit(id, targets, count, stayMs, indoors, actorIds) {
      if (!id || !targets.length || !Number.isFinite(count) || !Number.isFinite(stayMs)) return [];
      const validTargets = targets.filter(target => network.walkers.has(key(target)) && !network.roads.has(key(target))
        && !walkClosures.has(key(target)) && (safeDestination(target) || indoors && network.buildingEntrances.has(key(target))));
      if (!validTargets.length) return [];
      const selected: string[] = [], quota = Math.max(0, Math.min(6, Math.floor(count)));
      const candidates = actors.filter(actor => actor.kind === 'WALKER' && (!actor.visit || actorIds?.includes(actor.id) && actor.visit.id === id)
        && (!actorIds || actorIds.includes(actor.id)) && !actor.carrier && actor.activity !== 'INSIDE')
        .sort((a, b) => Math.min(...targets.map(c => Math.abs(c.x - a.next.x) + Math.abs(c.y - a.next.y)))
          - Math.min(...targets.map(c => Math.abs(c.x - b.next.x) + Math.abs(c.y - b.next.y))));
      for (const actor of candidates) {
        if (selected.length >= quota) break;
        // A freshly alighted person has not committed the random outgoing
        // step yet. Choose the requested destination from the actual curb.
        // Mid-edge walkers still finish their immutable physical segment.
        const moving = actor.route.length >= 2 && actor.progress > EPSILON, start = moving ? actor.next : actor.current;
        const target = validTargets[selected.length % validTargets.length]!;
        if (!network.walkers.has(key(target)) || network.roads.has(key(target)) || walkClosures.has(key(target)) || !(safeDestination(target) || indoors && network.buildingEntrances.has(key(target)))) continue;
        const suffix = walkerRoutes(start, moving ? actor.current : actor.previous, target, 48).routeTo(target);
        if (!suffix.length || suffix.length > 48) continue;
        actor.route = moving ? [actor.current, ...suffix] : suffix;
        actor.restMs = 0; actor.activity = 'NONE'; actor.pendingExit = undefined;
        if (!moving) {
          actor.next = actor.route[1]??actor.current; actor.direction = heading(actor.current, actor.next, actor.direction); actor.progress = 0;
          // Keep the physical pose; turning is admitted through the ordinary
          // swept-body resolution on the next fixed step.
          actor.segmentStart = { x: actor.position.x - actor.current.x - .5, y: actor.position.y - actor.current.y - .5 };
          actor.segmentEnd = segmentEnd(actor.kind, actor.route, actor.direction);
        }
        actor.visit = { id, arrived: false }; actor.visitTarget = target; actor.visitRetryAt = undefined; actor.visitStayMs = Math.max(500, Math.min(30_000, stayMs));
        actor.visitIndoors = indoors; actor.visitUntil = undefined; actor.visitDeadline = clock + 60_000;
        if(!moving&&suffix.length===1){actor.visit.arrived=true;actor.visitUntil=clock+actor.visitStayMs;actor.activity=indoors?'INSIDE':'REST';actor.restMs=actor.visitStayMs;}
        selected.push(actor.id);
      }
      publish(); return selected;
    },
    clearVisits(id) {
      for (const actor of actors) if (actor.visit && (!id || actor.visit.id === id)) {
        actor.visit = undefined; actor.visitUntil = undefined; actor.visitDeadline = undefined; actor.visitTarget = undefined; actor.visitRetryAt = undefined;
        if (actor.carrier) {
          actor.alightPending = true;
          const external=externalCarriers.get(actor.carrier);
          if(external){external.cancelled=true;external.doorsOpen=true;external.recoveryRetryAt=0;}
          const vehicle = actors.find(candidate => candidate.id === actor.carrier);
          if (vehicle && !vehicle.evacuating) recoverPassengers(vehicle);
          continue;
        }
        actor.restMs = actor.activity === 'INSIDE' ? STEP_MS : 0; actor.pendingExit = undefined;
        if (actor.activity !== 'INSIDE') { actor.activity = 'NONE'; actor.route = actor.route.slice(0, 2); }
      }
      publish();
    },
    boardVisit(id, vehicleId) {
      const vehicle = actors.find(actor => actor.id === vehicleId && actor.kind === 'CAR' && actor.activity === 'REST'
        && !actor.evacuating && (actor.response === 'BUS' || actor.response === 'SCHOOL_BUS'));
      if (!vehicle) return 0;
      let count = 0;
      for (const actor of actors) if (actor.visit?.id === id && actor.visit.arrived && !actor.carrier
        && Math.hypot(actor.position.x - vehicle.position.x, actor.position.y - vehicle.position.y) <= 3 && curbSide(vehicle.current, actor.current)) {
        actor.carrier = vehicleId; actor.activity = 'INSIDE'; actor.restMs = Number.MAX_SAFE_INTEGER; actor.visitUntil = undefined;
        actor.visitDeadline = undefined; actor.route = [actor.current]; actor.next = actor.current; actor.progress = 0;
        actor.position = { ...vehicle.position }; actor.pendingExit = undefined; count++;
      }
      publish(); return count;
    },
    alightVisit(vehicleId, targets) { const count = alight(vehicleId, targets); publish(); return count; },
    updateExternalCarrier(carrier){
      if(!carrier.id.startsWith("transport:")||![carrier.position.x,carrier.position.y,carrier.capacity,...carrier.doors.flatMap(p=>[p.x,p.y]),...carrier.boardingCells.flatMap(p=>[p.x,p.y])].every(Number.isFinite))throw new Error("Invalid external carrier");
      externalCarriers.set(carrier.id,{...carrier,capacity:Math.max(0,Math.min(12,Math.floor(carrier.capacity)))});
    },
    boardExternalVisit(visitId,carrierId){
      const carrier=externalCarriers.get(carrierId);if(!carrier||!carrier.doorsOpen||carrier.cancelled)return 0;
      let remaining=carrier.capacity-actors.filter(actor=>actor.carrier===carrierId).length,count=0;
      for(const actor of actors){
        if(remaining<=0)break;
        if(actor.kind!=="WALKER"||actor.carrier||actor.visit?.id!==visitId||!actor.visit.arrived||walkClosures.has(key(actor.current))
          ||!carrier.boardingCells.some(cell=>same(cell,actor.current))||!carrier.doors.some(door=>Math.hypot(actor.position.x-door.x,actor.position.y-door.y)<=2))continue;
        actor.carrier=carrierId;actor.activity="INSIDE";actor.restMs=Number.MAX_SAFE_INTEGER;actor.visitUntil=undefined;actor.visitDeadline=undefined;
        actor.route=[actor.current];actor.next=actor.current;actor.progress=0;actor.position={...carrier.position};actor.pendingExit=undefined;
        count++;remaining--;
      }
      if(count)publish();return count;
    },
    alightExternalCarrier(carrierId){const carrier=externalCarriers.get(carrierId);const count=carrier?alight(carrierId,carrier.boardingCells):0;if(count)publish();return count;},
    removeExternalCarrier(carrierId){const carrier=externalCarriers.get(carrierId);if(!carrier)return;carrier.cancelled=true;carrier.doorsOpen=true;carrier.recoveryRetryAt=0;publish();},
    releaseResponse(agentId, retainMs = 10_000) {
      const actor = actors.find(a => a.id === agentId && a.kind === 'CAR' && a.response);
      if (!actor) return;
      actor.responseTarget = undefined; actor.responseRetryAt = undefined;
      actor.responseUntil = clock + Math.max(500, Math.min(30_000, Number.isFinite(retainMs) ? retainMs : 10_000));
      actor.restMs = 0; actor.activity = 'NONE'; actor.route = actor.route.slice(0, 2); publish();
    },
    canDrive(from, to) {
      const role = roadBandRole(network.roads, from);
      if (role.kind !== 'TRAVEL' || !safeDestination(to) || closures.has(key(to))) return false;
      const route = carRoutes(from, { x: from.x - role.dx, y: from.y - role.dy }, to, 64).routeTo(to);
      return route.length >= 2 && route.length <= 64;
    },
    advance(elapsedMs) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("Mobility elapsed time must be finite and nonnegative");
      remainder += elapsedMs;
      let stepped = false;
      while (remainder + EPSILON >= STEP_MS) { remainder = Math.max(0, remainder - STEP_MS); step(); stepped = true; }
      if (stepped) publish();
    },
    get agents() { return agentsSnapshot; }, get signals() { return signalSnapshot; }, get metrics() { return { ...metrics }; },
    get walkingCells() { return network.walkers; }, get visitTargets() { return visitTargets; },
  };
}
