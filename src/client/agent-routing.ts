import type { Cell } from "../shared/contracts";
import { roadBandRole } from "../shared/road-profile";

export function agentCellKey(cell: Cell): string { return `${cell.x},${cell.y}`; }

const DIRECTIONS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;
export type AgentEdges = ReadonlyMap<string, readonly Cell[]>;
export type VehiclePresentation = {
  view: "horizontal" | "north" | "south";
  scaleX: number;
  scaleY: number;
};

export type VehicleMotionPresentation = {
  /** Stable four-phase motion contract; zero is also the stopped frame. */
  frame: 0 | 1 | 2 | 3;
  suspensionYPx: number;
};

export type TrafficVehicleSnapshot = {
  id: string;
  kind: "CAR" | "BUS";
  current: Cell;
  next: Cell;
  progress: number;
  cruiseSpeed: number;
  /** Ordered cells from current through the next planned road segments. */
  path: readonly Cell[];
  /** Recently traversed cells, newest first, used while the vehicle tail clears a junction. */
  trail?: readonly Cell[];
  /** Continuous time spent unable to advance; older queues receive priority. */
  waitMs?: number;
};

export type VehicleFrameDecision = {
  /** Maximum distance, in road cells, that the vehicle may advance this frame. */
  advance: number;
  /** Nearest vehicle that imposed the limit, useful for runtime diagnostics. */
  blockedBy?: string;
};

// Collision dimensions mirror the non-transparent V6 pixels at native 1x.
// Wide road classes reserve enough real cells for these bodies; render scale
// never changes physics and is never used to squeeze traffic into a lane.
const VEHICLE_BODY_CELLS = {
  CAR: { length: 2.75, width: 1.625 },
  BUS: { length: 6.75, width: 2.75 },
} as const;
const VEHICLE_SAFETY_GAP_CELLS = 0.16;
// A native-pixel inset separates a moving body from the median marking while
// preserving the authored integer-sized sprite.
const VEHICLE_LANE_OFFSET_CELLS = { CAR: 0.125, BUS: 0.25 } as const;
const EPSILON = 1e-9;

/**
 * Map a seeded value to a calm but visibly varied city speed. Cars differ by
 * roughly one road cell per second; buses remain slower and more consistent.
 */
export function vehicleCruiseSpeed(kind: "CAR" | "BUS", variation: number): number {
  const normalized = Math.max(0, Math.min(1, variation));
  return kind === "CAR" ? 0.0019 + normalized * 0.001 : 0.00155 + normalized * 0.00035;
}

function minimumVehicleDistance(left: TrafficVehicleSnapshot, right: TrafficVehicleSnapshot): number {
  return (VEHICLE_BODY_CELLS[left.kind].length + VEHICLE_BODY_CELLS[right.kind].length) / 2
    + VEHICLE_SAFETY_GAP_CELLS;
}

function sameCell(left: Cell, right: Cell): boolean {
  return left.x === right.x && left.y === right.y;
}

function matchingSegmentDistance(follower: TrafficVehicleSnapshot, leader: TrafficVehicleSnapshot): number | undefined {
  for (let segment = 0; segment < follower.path.length - 1; segment += 1) {
    const from = follower.path[segment]!;
    const to = follower.path[segment + 1]!;
    if (from.x !== leader.current.x || from.y !== leader.current.y
      || to.x !== leader.next.x || to.y !== leader.next.y) continue;
    const distance = segment - follower.progress + leader.progress;
    if (distance > 0 || Math.abs(distance) < EPSILON && leader.id.localeCompare(follower.id) < 0) return Math.max(0, distance);
  }
  if (follower.next.x === leader.current.x && follower.next.y === leader.current.y) {
    return 1 - follower.progress + leader.progress;
  }
  if (follower.current.x === leader.current.x && follower.current.y === leader.current.y
    && (follower.next.x !== leader.next.x || follower.next.y !== leader.next.y)
    && leader.id.localeCompare(follower.id) < 0) return follower.progress + leader.progress;
  return undefined;
}

function rightHandLaneInset(from: Cell, to: Cell, inset: number): { x: number; y: number } {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx > 0) return { x: 0, y: inset };
  if (dx < 0) return { x: 0, y: -inset };
  if (dy > 0) return { x: -inset, y: 0 };
  if (dy < 0) return { x: inset, y: 0 };
  return { x: 0, y: 0 };
}

function vehicleCenter(vehicle: TrafficVehicleSnapshot): { x: number; y: number } {
  const laneOffset = VEHICLE_LANE_OFFSET_CELLS[vehicle.kind];
  const previous = vehicle.trail?.[0];
  const startInset = previous
    ? rightHandLaneInset(previous, vehicle.current, laneOffset)
    : rightHandLaneInset(vehicle.current, vehicle.next, laneOffset);
  const endInset = rightHandLaneInset(vehicle.current, vehicle.next, laneOffset);
  return {
    x: vehicle.current.x + (vehicle.next.x - vehicle.current.x) * vehicle.progress
      + startInset.x * (1 - vehicle.progress) + endInset.x * vehicle.progress,
    y: vehicle.current.y + (vehicle.next.y - vehicle.current.y) * vehicle.progress
      + startInset.y * (1 - vehicle.progress) + endInset.y * vehicle.progress,
  };
}

function vehicleHalfExtents(vehicle: TrafficVehicleSnapshot): { x: number; y: number } {
  const body = VEHICLE_BODY_CELLS[vehicle.kind];
  const horizontal = vehicle.current.x !== vehicle.next.x;
  return horizontal
    ? { x: body.length / 2, y: body.width / 2 }
    : { x: body.width / 2, y: body.length / 2 };
}

function vehicleBodiesOverlap(left: TrafficVehicleSnapshot, right: TrafficVehicleSnapshot): boolean {
  const leftCenter = vehicleCenter(left);
  const rightCenter = vehicleCenter(right);
  const leftExtent = vehicleHalfExtents(left);
  const rightExtent = vehicleHalfExtents(right);
  return Math.abs(leftCenter.x - rightCenter.x) + EPSILON < leftExtent.x + rightExtent.x
    && Math.abs(leftCenter.y - rightCenter.y) + EPSILON < leftExtent.y + rightExtent.y;
}

/** Number of physically overlapping motor-agent bodies in world coordinates. */
export function vehicleUnsafePairCount(vehicles: readonly TrafficVehicleSnapshot[]): number {
  let unsafePairs = 0;
  for (let leftIndex = 0; leftIndex < vehicles.length; leftIndex += 1) {
    const left = vehicles[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < vehicles.length; rightIndex += 1) {
      const right = vehicles[rightIndex]!;
      if (vehicleBodiesOverlap(left, right)) unsafePairs += 1;
    }
  }
  return unsafePairs;
}

function conflictClearance(waiting: TrafficVehicleSnapshot, crossing: TrafficVehicleSnapshot): number {
  return VEHICLE_BODY_CELLS[waiting.kind].length / 2
    + VEHICLE_BODY_CELLS[crossing.kind].width / 2
    + VEHICLE_SAFETY_GAP_CELLS
    + VEHICLE_LANE_OFFSET_CELLS[waiting.kind] + VEHICLE_LANE_OFFSET_CELLS[crossing.kind];
}

function junctionReservationClearance(vehicle: TrafficVehicleSnapshot | { kind: "CAR" | "BUS" }): number {
  const body = VEHICLE_BODY_CELLS[vehicle.kind];
  return Math.ceil(body.length / 2 + body.width / 2 + VEHICLE_SAFETY_GAP_CELLS);
}

function mergeClearance(
  left: TrafficVehicleSnapshot,
  right: TrafficVehicleSnapshot,
  conflict: { leftIndex: number; rightIndex: number },
): number {
  const leftExit = left.path[conflict.leftIndex + 1];
  const rightExit = right.path[conflict.rightIndex + 1];
  return leftExit && rightExit && sameCell(leftExit, rightExit)
    ? minimumVehicleDistance(left, right) + VEHICLE_LANE_OFFSET_CELLS[left.kind] + VEHICLE_LANE_OFFSET_CELLS[right.kind]
    : conflictClearance(left, right);
}

function capDecision(
  decisions: Map<string, VehicleFrameDecision>,
  waiting: TrafficVehicleSnapshot,
  blocker: TrafficVehicleSnapshot,
  allowed: number,
): void {
  const decision = decisions.get(waiting.id)!;
  const bounded = Math.max(0, allowed);
  if (bounded >= decision.advance) return;
  decision.advance = bounded;
  decision.blockedBy = blocker.id;
}

function firstRouteConflict(
  left: TrafficVehicleSnapshot,
  right: TrafficVehicleSnapshot,
): { leftIndex: number; rightIndex: number } | undefined {
  const leftBody = VEHICLE_BODY_CELLS[left.kind];
  const rightBody = VEHICLE_BODY_CELLS[right.kind];
  // Reserve before a stopped body can reach the physical conflict envelope.
  // The extra four cells cover the wide-road stop buffer and one simulation
  // frame, while still excluding remote followers many cells back in a queue.
  const leftLookahead = leftBody.length / 2 + leftBody.width / 2 + 4;
  const rightLookahead = rightBody.length / 2 + rightBody.width / 2 + 4;
  for (let leftIndex = 1; leftIndex < left.path.length; leftIndex += 1) {
    if (leftIndex - left.progress > leftLookahead) break;
    for (let rightIndex = 1; rightIndex < right.path.length; rightIndex += 1) {
      if (rightIndex - right.progress > rightLookahead) break;
      if (!sameCell(left.path[leftIndex]!, right.path[rightIndex]!)) continue;
      const leftFrom = left.path[leftIndex - 1]!;
      const rightFrom = right.path[rightIndex - 1]!;
      if (sameCell(leftFrom, rightFrom)) continue;
      return { leftIndex, rightIndex };
    }
  }
  return undefined;
}

function winnerAtConflict(
  left: TrafficVehicleSnapshot,
  right: TrafficVehicleSnapshot,
  priorityDistance: ReadonlyMap<string, number>,
): TrafficVehicleSnapshot {
  if (left.cruiseSpeed <= 0 && right.cruiseSpeed > 0) return right;
  if (right.cruiseSpeed <= 0 && left.cruiseSpeed > 0) return left;
  const leftDistance = priorityDistance.get(left.id) ?? Number.POSITIVE_INFINITY;
  const rightDistance = priorityDistance.get(right.id) ?? Number.POSITIVE_INFINITY;
  // A vehicle closer to the conflict owns the reservation until it clears.
  // Re-ranking two partially admitted bodies by their changing wait counters
  // creates a cycle, so wait time is only the tie-break at the same stop line.
  if (Math.abs(leftDistance - rightDistance) > EPSILON) {
    return leftDistance < rightDistance ? left : right;
  }
  const leftWait = left.waitMs ?? 0;
  const rightWait = right.waitMs ?? 0;
  if (Math.abs(leftWait - rightWait) > EPSILON) return leftWait > rightWait ? left : right;
  // Pair-specific distance can produce a priority cycle at a four-arm
  // junction (A beats B, B beats C, C beats A), leaving every decision capped
  // at zero. Rank each vehicle by its nearest conflict across the whole frame
  // so every pair observes the same total order.
  return left.id.localeCompare(right.id) <= 0 ? left : right;
}

function holdForOccupiedConflict(
  decisions: Map<string, VehicleFrameDecision>,
  waiting: TrafficVehicleSnapshot,
  crossing: TrafficVehicleSnapshot,
): void {
  const occupied = [crossing.current, ...(crossing.trail ?? [])];
  for (let routeIndex = 1; routeIndex < waiting.path.length; routeIndex += 1) {
    const occupiedIndex = occupied.findIndex((cell) => sameCell(cell, waiting.path[routeIndex]!));
    if (occupiedIndex < 0) continue;
    const waitingFrom = waiting.path[routeIndex - 1]!;
    const crossingFrom = occupiedIndex === 0 ? crossing.trail?.[0] : crossing.trail?.[occupiedIndex];
    if (crossingFrom && sameCell(waitingFrom, crossingFrom)) continue;
    const distancePastConflict = occupiedIndex + crossing.progress;
    if (distancePastConflict + EPSILON >= conflictClearance(crossing, waiting)) continue;
    capDecision(
      decisions,
      waiting,
      crossing,
      routeIndex - conflictClearance(waiting, crossing) - waiting.progress,
    );
    return;
  }
}

function projectVehicle(vehicle: TrafficVehicleSnapshot, advance: number): TrafficVehicleSnapshot {
  let current = vehicle.current;
  let next = vehicle.next;
  let progress = vehicle.progress + Math.max(0, advance);
  let path = [...vehicle.path];
  const trail = [...(vehicle.trail ?? [])];
  while (progress >= 1 && path[2]) {
    progress -= 1;
    trail.unshift(current);
    trail.length = Math.min(trail.length, 4);
    current = next;
    next = path[2];
    path = path.slice(1);
  }
  return { ...vehicle, current, next, progress: Math.min(progress, 0.999_999), path, trail };
}

function motionsOverlap(
  left: TrafficVehicleSnapshot,
  right: TrafficVehicleSnapshot,
  leftAdvance: number,
  rightAdvance: number,
): boolean {
  const transitionFraction = (vehicle: TrafficVehicleSnapshot, advance: number): number | undefined => {
    if (advance <= EPSILON) return undefined;
    const fraction = (1 - vehicle.progress) / advance;
    return fraction > EPSILON && fraction < 1 - EPSILON ? fraction : undefined;
  };
  const breakpoints = [0, 1, transitionFraction(left, leftAdvance), transitionFraction(right, rightAdvance)]
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]!) > EPSILON);
  const pointSnapshot = (vehicle: TrafficVehicleSnapshot, advance: number, fraction: number) => (
    projectVehicle(vehicle, advance * Math.max(0, Math.min(1, fraction)))
  );
  const timeEpsilon = 1e-7;
  for (const breakpoint of breakpoints) {
    for (const fraction of [breakpoint - timeEpsilon, breakpoint, breakpoint + timeEpsilon]) {
      if (fraction < 0 || fraction > 1) continue;
      if (vehicleBodiesOverlap(
        pointSnapshot(left, leftAdvance, fraction),
        pointSnapshot(right, rightAdvance, fraction),
      )) return true;
    }
  }

  const axisInterval = (start: number, end: number, limit: number): [number, number] | undefined => {
    const velocity = end - start;
    if (Math.abs(velocity) < EPSILON) return Math.abs(start) + EPSILON < limit ? [0, 1] : undefined;
    const first = (-limit - start) / velocity;
    const second = (limit - start) / velocity;
    const lower = Math.max(0, Math.min(first, second));
    const upper = Math.min(1, Math.max(first, second));
    return lower + EPSILON < upper ? [lower, upper] : undefined;
  };
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const from = breakpoints[index]! + timeEpsilon;
    const to = breakpoints[index + 1]! - timeEpsilon;
    if (from >= to) continue;
    const leftFrom = pointSnapshot(left, leftAdvance, from);
    const leftTo = pointSnapshot(left, leftAdvance, to);
    const rightFrom = pointSnapshot(right, rightAdvance, from);
    const rightTo = pointSnapshot(right, rightAdvance, to);
    const leftFromCenter = vehicleCenter(leftFrom);
    const leftToCenter = vehicleCenter(leftTo);
    const rightFromCenter = vehicleCenter(rightFrom);
    const rightToCenter = vehicleCenter(rightTo);
    const leftExtent = vehicleHalfExtents(leftFrom);
    const rightExtent = vehicleHalfExtents(rightFrom);
    const xInterval = axisInterval(
      leftFromCenter.x - rightFromCenter.x,
      leftToCenter.x - rightToCenter.x,
      leftExtent.x + rightExtent.x,
    );
    const yInterval = axisInterval(
      leftFromCenter.y - rightFromCenter.y,
      leftToCenter.y - rightToCenter.y,
      leftExtent.y + rightExtent.y,
    );
    if (xInterval && yInterval && Math.max(xInterval[0], yInterval[0]) + EPSILON < Math.min(xInterval[1], yInterval[1])) {
      return true;
    }
  }
  return false;
}

function safeMotionAdvance(
  waiting: TrafficVehicleSnapshot,
  crossing: TrafficVehicleSnapshot,
  maximum: number,
  crossingAdvance: number,
): number | undefined {
  for (let step = 15; step >= 0; step -= 1) {
    const candidate = maximum * step / 16;
    if (!motionsOverlap(waiting, crossing, candidate, crossingAdvance)) return candidate;
  }
  return undefined;
}

function preferredCollisionLoser(
  left: TrafficVehicleSnapshot,
  right: TrafficVehicleSnapshot,
  decisions: ReadonlyMap<string, VehicleFrameDecision>,
): TrafficVehicleSnapshot {
  const leftAdvance = decisions.get(left.id)!.advance;
  const rightAdvance = decisions.get(right.id)!.advance;
  if (leftAdvance <= EPSILON && rightAdvance > EPSILON) return right;
  if (rightAdvance <= EPSILON && leftAdvance > EPSILON) return left;
  if (left.cruiseSpeed <= 0 && right.cruiseSpeed > 0) return right;
  if (right.cruiseSpeed <= 0 && left.cruiseSpeed > 0) return left;
  const leftTransitions = left.progress + leftAdvance >= 1;
  const rightTransitions = right.progress + rightAdvance >= 1;
  if (leftTransitions !== rightTransitions) return leftTransitions ? left : right;
  return left.id.localeCompare(right.id) > 0 ? left : right;
}

function resolveProjectedCollisions(
  vehicles: readonly TrafficVehicleSnapshot[],
  decisions: Map<string, VehicleFrameDecision>,
): void {
  const maximumPasses = vehicles.length * 2;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let resolved = false;
    for (let leftIndex = 0; leftIndex < vehicles.length && !resolved; leftIndex += 1) {
      const left = vehicles[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < vehicles.length; rightIndex += 1) {
        const right = vehicles[rightIndex]!;
        const leftAdvance = decisions.get(left.id)!.advance;
        const rightAdvance = decisions.get(right.id)!.advance;
        if (!motionsOverlap(left, right, leftAdvance, rightAdvance)) continue;
        const preferred = preferredCollisionLoser(left, right, decisions);
        const other = preferred === left ? right : left;
        const safe = safeMotionAdvance(
          preferred,
          other,
          decisions.get(preferred.id)!.advance,
          decisions.get(other.id)!.advance,
        );
        if (safe !== undefined) capDecision(decisions, preferred, other, safe);
        else {
          const alternateSafe = safeMotionAdvance(
            other,
            preferred,
            decisions.get(other.id)!.advance,
            decisions.get(preferred.id)!.advance,
          );
          if (alternateSafe !== undefined) capDecision(decisions, other, preferred, alternateSafe);
          else if (!vehicleBodiesOverlap(preferred, other)) {
            capDecision(decisions, preferred, other, 0);
            capDecision(decisions, other, preferred, 0);
          } else continue;
        }
        resolved = true;
        break;
      }
    }
    if (!resolved) return;
  }
}

/**
 * Resolve one traffic frame without mutating render state. A follower is
 * limited by the nearest vehicle on its planned lane, including the next road
 * segment. Competing approaches reserve a merge cell deterministically, so two
 * vehicles cannot cross through each other when they enter an intersection.
 */
export function planVehicleFrame(
  vehicles: readonly TrafficVehicleSnapshot[],
  elapsedMs: number,
): Map<string, VehicleFrameDecision> {
  const decisions = new Map<string, VehicleFrameDecision>();
  for (const vehicle of vehicles) {
    decisions.set(vehicle.id, { advance: Math.max(0, elapsedMs * vehicle.cruiseSpeed) });
  }

  for (const follower of vehicles) {
    for (const leader of vehicles) {
      if (leader.id === follower.id) continue;
      const distance = matchingSegmentDistance(follower, leader);
      if (distance === undefined) continue;
      const minimumDistance = minimumVehicleDistance(follower, leader);
      capDecision(decisions, follower, leader, distance - minimumDistance);
    }
  }

  const conflicts: Array<{
    left: TrafficVehicleSnapshot;
    right: TrafficVehicleSnapshot;
    conflict: { leftIndex: number; rightIndex: number };
  }> = [];
  const priorityDistance = new Map<string, number>();
  for (let leftIndex = 0; leftIndex < vehicles.length; leftIndex += 1) {
    const left = vehicles[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < vehicles.length; rightIndex += 1) {
      const right = vehicles[rightIndex]!;
      const conflict = firstRouteConflict(left, right);
      if (!conflict) continue;
      conflicts.push({ left, right, conflict });
      priorityDistance.set(left.id, Math.min(
        priorityDistance.get(left.id) ?? Number.POSITIVE_INFINITY,
        conflict.leftIndex - left.progress,
      ));
      priorityDistance.set(right.id, Math.min(
        priorityDistance.get(right.id) ?? Number.POSITIVE_INFINITY,
        conflict.rightIndex - right.progress,
      ));
    }
  }
  for (const { left, right, conflict } of conflicts) {
      const winner = winnerAtConflict(left, right, priorityDistance);
      const waiting = winner === left ? right : left;
      const waitingIndex = winner === left ? conflict.rightIndex : conflict.leftIndex;
      const clearance = Math.max(
        mergeClearance(waiting, winner, winner === left
          ? { leftIndex: conflict.rightIndex, rightIndex: conflict.leftIndex }
          : conflict),
        junctionReservationClearance(waiting),
      );
      capDecision(
        decisions,
        waiting,
        winner,
        waitingIndex - clearance - waiting.progress,
      );
  }

  for (const waiting of vehicles) {
    for (const crossing of vehicles) {
      if (waiting.id !== crossing.id) holdForOccupiedConflict(decisions, waiting, crossing);
    }
  }
  resolveProjectedCollisions(vehicles, decisions);
  return decisions;
}

/**
 * Vehicle source art has three authored directions: east, north and south.
 * West is the only mirrored direction. North and south are never flipped
 * because their front/rear silhouettes contain different information.
 * Keeping this mapping pure prevents render code and asset metadata from
 * silently disagreeing about which way a vehicle is facing.
 */
export function vehiclePresentation(current: Cell, next: Cell, scale = 1): VehiclePresentation {
  const horizontal = next.x !== current.x;
  return {
    view: horizontal ? "horizontal" : next.y < current.y ? "north" : "south",
    scaleX: horizontal && next.x < current.x ? -scale : scale,
    scaleY: scale,
  };
}

/**
 * Advance a stable distance phase without deforming or rotating pixel art.
 * Vehicle wheels are authored into the sprite, so moving the whole body by a
 * pixel made it detach from the lane and look crooked at frame boundaries.
 */
export function vehicleMotionPresentation(
  kind: "CAR" | "BUS",
  progress: number,
  completedCells: number,
  moving = true,
): VehicleMotionPresentation {
  if (!moving) return { frame: 0, suspensionYPx: 0 };
  const distancePhase = Math.max(0, completedCells) + Math.max(0, Math.min(0.999_999, progress));
  const multiplier = kind === "BUS" ? 2 : 4;
  const frame = Math.floor(distancePhase * multiplier) % 4 as 0 | 1 | 2 | 3;
  return { frame, suspensionYPx: 0 };
}

/** Pixel position on the exact centre of the assigned travel cell. */
export function vehicleLanePosition(
  current: Cell,
  next: Cell,
  progress: number,
  previous?: Cell,
  cellSize = 8,
  kind: "CAR" | "BUS" = "CAR",
): { x: number; y: number } {
  const inset = VEHICLE_LANE_OFFSET_CELLS[kind] * cellSize;
  const clamped = Math.max(0, Math.min(1, progress));
  const startInset = previous ? rightHandLaneInset(previous, current, inset) : rightHandLaneInset(current, next, inset);
  const endInset = rightHandLaneInset(current, next, inset);
  return {
    x: (current.x + (next.x - current.x) * clamped) * cellSize + cellSize / 2
      + startInset.x * (1 - clamped) + endInset.x * clamped,
    y: (current.y + (next.y - current.y) * clamped) * cellSize + cellSize / 2
      + startInset.y * (1 - clamped) + endInset.y * clamped,
  };
}

export function isAgentEdgeAllowed(current: Cell, next: Cell, outgoing?: AgentEdges): boolean {
  return !outgoing || Boolean(outgoing.get(agentCellKey(current))?.some((candidate) => agentCellKey(candidate) === agentCellKey(next)));
}

function directedNeighbors(graph: ReadonlyMap<string, Cell>, cell: Cell, outgoing?: AgentEdges): Cell[] {
  return outgoing ? [...outgoing.get(agentCellKey(cell)) ?? []] : adjacentGraphCells(graph, cell);
}

export type TrafficArm = "N" | "E" | "S" | "W";
export type TrafficJunction = {
  id: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  cells: Cell[];
  arms: TrafficArm[];
  signalPosts: Array<{ origin: Cell; axis: "H" | "V"; approach: TrafficArm }>;
};
export type TrafficSignalPhase = { horizontal: "RED" | "GREEN"; vertical: "RED" | "GREEN" };

function directionalRun(graph: ReadonlyMap<string, Cell>, cell: Cell, dx: number, dy: number): number {
  let length = 0;
  for (let step = 1; step <= 12; step += 1) {
    if (!graph.has(agentCellKey({ x: cell.x + dx * step, y: cell.y + dy * step }))) break;
    length += 1;
  }
  return length;
}

/**
 * Collapse the asphalt overlap of every genuine T/X crossing into one logical
 * junction. Requiring a four-cell arm beyond the overlap deliberately rejects
 * both ordinary bends and the transverse thickness of a four-lane avenue.
 */
export function detectTrafficJunctions(graph: ReadonlyMap<string, Cell>): TrafficJunction[] {
  const seeds = new Map<string, Cell>();
  for (const cell of graph.values()) {
    const north = directionalRun(graph, cell, 0, -1);
    const east = directionalRun(graph, cell, 1, 0);
    const south = directionalRun(graph, cell, 0, 1);
    const west = directionalRun(graph, cell, -1, 0);
    const horizontalThrough = east >= 6 && west >= 6;
    const verticalThrough = north >= 6 && south >= 6;
    if (horizontalThrough && (north >= 6 || south >= 6) || verticalThrough && (east >= 6 || west >= 6)) {
      seeds.set(agentCellKey(cell), cell);
    }
  }

  const junctions: TrafficJunction[] = [];
  const visited = new Set<string>();
  for (const seed of seeds.values()) {
    if (visited.has(agentCellKey(seed))) continue;
    const queue = [seed];
    const cells: Cell[] = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      const currentKey = agentCellKey(current);
      if (visited.has(currentKey) || !seeds.has(currentKey)) continue;
      visited.add(currentKey);
      cells.push(current);
      for (const direction of DIRECTIONS) {
        const next = { x: current.x + direction.x, y: current.y + direction.y };
        if (seeds.has(agentCellKey(next)) && !visited.has(agentCellKey(next))) queue.push(next);
      }
    }
    if (cells.length === 0) continue;
    const bounds = {
      minX: Math.min(...cells.map((cell) => cell.x)), minY: Math.min(...cells.map((cell) => cell.y)),
      maxX: Math.max(...cells.map((cell) => cell.x)), maxY: Math.max(...cells.map((cell) => cell.y)),
    };
    const hasRoad = (candidates: Cell[]) => candidates.some((cell) => graph.has(agentCellKey(cell)));
    const arms: TrafficArm[] = [];
    if (hasRoad(Array.from({ length: bounds.maxX - bounds.minX + 1 }, (_, index) => ({ x: bounds.minX + index, y: bounds.minY - 1 })))) arms.push("N");
    if (hasRoad(Array.from({ length: bounds.maxY - bounds.minY + 1 }, (_, index) => ({ x: bounds.maxX + 1, y: bounds.minY + index })))) arms.push("E");
    if (hasRoad(Array.from({ length: bounds.maxX - bounds.minX + 1 }, (_, index) => ({ x: bounds.minX + index, y: bounds.maxY + 1 })))) arms.push("S");
    if (hasRoad(Array.from({ length: bounds.maxY - bounds.minY + 1 }, (_, index) => ({ x: bounds.minX - 1, y: bounds.minY + index })))) arms.push("W");
    if (arms.length < 3) continue;
    const postsByArm: Record<TrafficArm, { origin: Cell; axis: "H" | "V"; approach: TrafficArm }> = {
      N: { origin: { x: bounds.minX - 1, y: bounds.minY - 1 }, axis: "V", approach: "N" },
      E: { origin: { x: bounds.maxX + 1, y: bounds.minY - 1 }, axis: "H", approach: "E" },
      S: { origin: { x: bounds.maxX + 1, y: bounds.maxY + 1 }, axis: "V", approach: "S" },
      W: { origin: { x: bounds.minX - 1, y: bounds.maxY + 1 }, axis: "H", approach: "W" },
    };
    const signalPosts = arms.map((arm) => postsByArm[arm]).filter((post) => !graph.has(agentCellKey(post.origin)));
    junctions.push({ id: `${bounds.minX},${bounds.minY}:${bounds.maxX},${bounds.maxY}`, bounds, cells, arms, signalPosts });
  }
  return junctions;
}

export function trafficSignalPhase(junction: TrafficJunction, elapsedMs: number): TrafficSignalPhase {
  // From the five-cell bus stop envelope, a minimum-speed 6.75-cell bus needs
  // just under ten seconds for its tail to clear a seven-cell junction. Pair
  // each 10.5-second clearance with a 21-second admission window: two thirds
  // of the cycle remains productive without admitting a conflicting arm while
  // the late bus body is still inside the box.
  const cycleMs = 63_000;
  // Adjacent intersections receive a short, spatially coherent wave instead
  // of unrelated hash phases. A vehicle moving through a street grid now sees
  // successive greens rather than a random red wall at every next block.
  const offset = Math.abs(junction.bounds.minX + junction.bounds.minY) % 8 * 250;
  const phase = (elapsedMs + offset) % cycleMs;
  if (phase < 21_000) return { horizontal: "GREEN", vertical: "RED" };
  if (phase < 31_500) return { horizontal: "RED", vertical: "RED" };
  if (phase < 52_500) return { horizontal: "RED", vertical: "GREEN" };
  return { horizontal: "RED", vertical: "RED" };
}

export type TrafficSignalDecision = { yield: boolean; reservationId?: string };

export function trafficSignalDecision(
  current: Cell,
  next: Cell,
  junctions: readonly TrafficJunction[],
  elapsedMs: number,
  kind: "CAR" | "BUS" = "CAR",
  reservationId?: string,
): TrafficSignalDecision {
  const stopClearance = junctionReservationClearance({ kind });
  const distanceToBounds = (bounds: TrafficJunction["bounds"], cell: Cell) => (
    Math.max(bounds.minX - cell.x, 0, cell.x - bounds.maxX)
    + Math.max(bounds.minY - cell.y, 0, cell.y - bounds.maxY)
  );
  const reserved = reservationId ? junctions.find((candidate) => candidate.id === reservationId) : undefined;
  if (reserved) {
    const currentDistance = distanceToBounds(reserved.bounds, current);
    const nextDistance = distanceToBounds(reserved.bounds, next);
    // Keep the token from the stop line through the entire box. It is released
    // only on the departing side, so a phase change cannot strand an admitted
    // body while a freshly red approach cannot enter without its own token.
    if (currentDistance === 0 || nextDistance <= currentDistance) {
      return { yield: false, reservationId: reserved.id };
    }
    return { yield: false };
  }
  const junction = junctions.find((candidate) => {
    const stopBounds = {
      minX: candidate.bounds.minX - stopClearance,
      minY: candidate.bounds.minY - stopClearance,
      maxX: candidate.bounds.maxX + stopClearance,
      maxY: candidate.bounds.maxY + stopClearance,
    };
    const approaching = distanceToBounds(candidate.bounds, next) < distanceToBounds(candidate.bounds, current);
    return !containsCell(candidate.bounds, current)
      && approaching
      && (containsCell(stopBounds, current) || containsCell(stopBounds, next));
  });
  if (!junction) return { yield: false };
  const axis = next.x !== current.x ? "horizontal" : "vertical";
  if (trafficSignalPhase(junction, elapsedMs)[axis] === "RED") return { yield: true };
  return { yield: false, reservationId: junction.id };
}

export function mustYieldAtTrafficSignal(
  current: Cell,
  next: Cell,
  junctions: readonly TrafficJunction[],
  elapsedMs: number,
  _progress = 0,
  kind: "CAR" | "BUS" = "CAR",
): boolean {
  void _progress; // retained for backwards-compatible callers; admission state is explicit now.
  return trafficSignalDecision(current, next, junctions, elapsedMs, kind).yield;
}

function containsCell(bounds: TrafficJunction["bounds"], cell: Cell): boolean {
  return cell.x >= bounds.minX && cell.x <= bounds.maxX
    && cell.y >= bounds.minY && cell.y <= bounds.maxY;
}

/**
 * Keep an approaching vehicle behind the stop line when its lane beyond the
 * junction has no room for the body and safety gap. This is the classic
 * "do not block the box" rule: collision avoidance alone is insufficient,
 * because a safe car may otherwise stop inside the crossing and deadlock the
 * next signal phase.
 */
export function mustYieldForBlockedJunctionExit(
  vehicle: TrafficVehicleSnapshot,
  junctions: readonly TrafficJunction[],
  vehicles: readonly TrafficVehicleSnapshot[],
): boolean {
  const junction = junctions.find((candidate) => !containsCell(candidate.bounds, vehicle.current)
    && containsCell(candidate.bounds, vehicle.next));
  if (!junction) return false;
  const exitIndex = vehicle.path.findIndex((cell, index) => index > 1 && !containsCell(junction.bounds, cell));
  // An incomplete streamed/planned lookahead must not turn a free junction
  // into a permanent red light. The caller supplies the full remaining route;
  // if it still has no exit, defer the decision until that route is extended.
  if (exitIndex < 0) return false;
  const required = VEHICLE_BODY_CELLS[vehicle.kind].length / 2 + VEHICLE_SAFETY_GAP_CELLS;
  for (const other of vehicles) {
    if (other.id === vehicle.id) continue;
    for (let segment = exitIndex; segment < vehicle.path.length; segment += 1) {
      if (!sameCell(vehicle.path[segment]!, other.current)) continue;
      const available = segment - exitIndex + other.progress;
      if (available + EPSILON < required + VEHICLE_BODY_CELLS[other.kind].length / 2) return true;
    }
  }
  return false;
}

/**
 * Build a directed road graph for right-hand traffic. Ordinary road bands are
 * one-way per lane; intersections temporarily allow turns, but a car may only
 * leave them through a lane whose direction matches the movement.
 */
export function buildDirectedCarEdges(graph: ReadonlyMap<string, Cell>): Map<string, Cell[]> {
  const lanes = new Map([...graph].map(([key, cell]) => [key, roadBandRole(graph, cell)]));
  const edges = new Map<string, Cell[]>();
  for (const cell of graph.values()) {
    const lane = lanes.get(agentCellKey(cell))!;
    if (lane.kind === "MEDIAN" || lane.kind === "SHOULDER") {
      edges.set(agentCellKey(cell), []);
      continue;
    }
    const candidates = adjacentGraphCells(graph, cell).filter((next) => {
      const dx = next.x - cell.x;
      const dy = next.y - cell.y;
      const nextLane = lanes.get(agentCellKey(next))!;
      if (nextLane.kind === "MEDIAN" || nextLane.kind === "SHOULDER") return false;
      if (lane.kind !== "JUNCTION" && (dx !== lane.dx || dy !== lane.dy)) return false;
      return nextLane.kind === "JUNCTION" || dx === nextLane.dx && dy === nextLane.dy;
    });
    edges.set(agentCellKey(cell), candidates);
  }
  return edges;
}

/**
 * Retain only the directed core that has both an entrance and an exit. Re-run
 * until stable so streamed road tails and dead ends cannot host an agent that
 * will inevitably stop at the edge of the resident graph.
 */
export function directedTrafficCore(outgoing: AgentEdges): Set<string> {
  const active = new Set(outgoing.keys());
  const successors = new Map<string, Set<string>>([...active].map((key) => [key, new Set()]));
  const predecessors = new Map<string, Set<string>>([...active].map((key) => [key, new Set()]));
  for (const key of active) {
    for (const candidate of outgoing.get(key) ?? []) {
      const candidateKey = agentCellKey(candidate);
      if (!active.has(candidateKey)) continue;
      successors.get(key)!.add(candidateKey);
      predecessors.get(candidateKey)!.add(key);
    }
  }
  const queue = [...active].filter((key) => successors.get(key)!.size === 0 || predecessors.get(key)!.size === 0);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor]!;
    if (!active.delete(key)) continue;
    for (const successor of successors.get(key)!) {
      predecessors.get(successor)!.delete(key);
      if (active.has(successor) && (predecessors.get(successor)!.size === 0 || successors.get(successor)!.size === 0)) queue.push(successor);
    }
    for (const predecessor of predecessors.get(key)!) {
      successors.get(predecessor)!.delete(key);
      if (active.has(predecessor) && (predecessors.get(predecessor)!.size === 0 || successors.get(predecessor)!.size === 0)) queue.push(predecessor);
    }
  }
  return active;
}

export function walkerInteractionPairs(
  walkers: ReadonlyArray<{ id: string; current: Cell; pauseMs: number; socialCooldownMs: number }>,
  maximumPairs = 2,
): Array<[string, string]> {
  const available = walkers.filter((walker) => walker.pauseMs <= 0 && walker.socialCooldownMs <= 0);
  const used = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (let left = 0; left < available.length && pairs.length < maximumPairs; left += 1) {
    const first = available[left]!;
    if (used.has(first.id)) continue;
    for (let right = left + 1; right < available.length; right += 1) {
      const second = available[right]!;
      if (used.has(second.id)) continue;
      const distance = Math.abs(first.current.x - second.current.x) + Math.abs(first.current.y - second.current.y);
      if (distance > 1) continue;
      used.add(first.id); used.add(second.id); pairs.push([first.id, second.id]);
      break;
    }
  }
  return pairs;
}

export function nextSeededRandom(state: number): { state: number; value: number } {
  let next = state | 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  const normalized = (next >>> 0) / 0x1_0000_0000;
  return { state: next || 0x6d2b79f5, value: normalized };
}

export function adjacentGraphCells(graph: ReadonlyMap<string, Cell>, cell: Cell): Cell[] {
  return DIRECTIONS
    .map((direction) => graph.get(agentCellKey({ x: cell.x + direction.x, y: cell.y + direction.y })))
    .filter((candidate): candidate is Cell => Boolean(candidate));
}

/** Bounded BFS. Route includes start and target and never jumps between cells. */
export function shortestAgentRoute(
  graph: ReadonlyMap<string, Cell>,
  start: Cell,
  target: Cell,
  maximumVisited = 8_000,
  outgoing?: AgentEdges,
  avoidFirst?: Cell,
): Cell[] {
  const startKey = agentCellKey(start);
  const targetKey = agentCellKey(target);
  if (!graph.has(startKey) || !graph.has(targetKey)) return [];
  if (startKey === targetKey) return [start];
  type RouteState = { cell: Cell; direction: number; steps: number; turns: number; stateKey: string };
  type BestState = { steps: number; turns: number; previous: string | null };
  const stateKey = (cell: Cell, direction: number) => `${agentCellKey(cell)}:${direction}`;
  const queue: RouteState[] = [{ cell: start, direction: -1, steps: 0, turns: 0, stateKey: stateKey(start, -1) }];
  const best = new Map<string, BestState>([[stateKey(start, -1), { steps: 0, turns: 0, previous: null }]]);
  let targetSteps = Number.POSITIVE_INFINITY;
  let targetState: RouteState | undefined;
  for (let cursor = 0; cursor < queue.length && cursor < maximumVisited; cursor += 1) {
    const current = queue[cursor]!;
    if (current.steps > targetSteps) break;
    if (agentCellKey(current.cell) === targetKey) {
      if (!targetState || current.turns < targetState.turns) targetState = current;
      targetSteps = current.steps;
      continue;
    }
    for (const next of directedNeighbors(graph, current.cell, outgoing)) {
      if (current.steps === 0 && avoidFirst && agentCellKey(next) === agentCellKey(avoidFirst)) continue;
      const dx = next.x - current.cell.x;
      const dy = next.y - current.cell.y;
      const direction = dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
      const steps = current.steps + 1;
      const turns = current.turns + (current.direction < 0 || current.direction === direction ? 0 : 1);
      const nextStateKey = stateKey(next, direction);
      const known = best.get(nextStateKey);
      if (known && (known.steps < steps || known.steps === steps && known.turns <= turns)) continue;
      best.set(nextStateKey, { steps, turns, previous: current.stateKey });
      queue.push({ cell: next, direction, steps, turns, stateKey: nextStateKey });
    }
  }
  if (!targetState) return [];
  const route: Cell[] = [];
  let trace: string | null = targetState.stateKey;
  while (trace) {
    const separator = trace.lastIndexOf(":");
    const cell = graph.get(trace.slice(0, separator));
    if (cell) route.push(cell);
    trace = best.get(trace)?.previous ?? null;
  }
  return route.reverse();
}

/**
 * Pick several session-random distant destinations and return the longest
 * reachable route. Planning is called only at route boundaries, never per RAF.
 */
export function planAgentRoute(
  graph: ReadonlyMap<string, Cell>,
  start: Cell,
  randomState: number,
  sampleCount = 12,
  avoidFirst?: Cell,
  outgoing?: AgentEdges,
): { route: Cell[]; randomState: number } {
  const startKey = agentCellKey(start);
  if (graph.size < 2 || !graph.has(startKey)) return { route: [start], randomState };
  const queue = [start];
  const previous = new Map<string, string | null>([[startKey, null]]);
  for (let cursor = 0; cursor < queue.length && cursor < 8_000; cursor += 1) {
    const current = queue[cursor]!;
    for (const next of directedNeighbors(graph, current, outgoing)) {
      const nextKey = agentCellKey(next);
      if (cursor === 0 && avoidFirst && nextKey === agentCellKey(avoidFirst)) continue;
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, agentCellKey(current));
      queue.push(next);
    }
  }
  if (queue.length < 2) return avoidFirst
    ? planAgentRoute(graph, start, randomState, sampleCount, undefined, outgoing)
    : { route: [start], randomState };
  let state = randomState;
  let target = queue[1]!;
  let bestDistance = 1;
  for (let index = 0; index < Math.min(sampleCount, queue.length - 1); index += 1) {
    const random = nextSeededRandom(state);
    state = random.state;
    const candidateIndex = 1 + Math.floor(random.value * (queue.length - 1));
    if (candidateIndex > bestDistance) {
      target = queue[candidateIndex]!;
      bestDistance = candidateIndex;
    }
  }
  const route = shortestAgentRoute(graph, start, target, 8_000, outgoing, avoidFirst);
  return { route, randomState: state };
}

export function nextWithoutUTurn(graph: ReadonlyMap<string, Cell>, current: Cell, previous?: Cell, outgoing?: AgentEdges): Cell {
  const candidates = directedNeighbors(graph, current, outgoing);
  return candidates.find((candidate) => !previous || agentCellKey(candidate) !== agentCellKey(previous))
    ?? (outgoing ? undefined : previous)
    ?? current;
}

export function connectShortWalkGaps(base: Map<string, Cell>, availableGround: Map<string, Cell>, maxGapCells = 2): Map<string, Cell> {
  const connected = new Map(base);
  for (const origin of base.values()) {
    for (const direction of DIRECTIONS) {
      for (let gap = 1; gap <= maxGapCells; gap += 1) {
        const target = { x: origin.x + direction.x * (gap + 1), y: origin.y + direction.y * (gap + 1) };
        if (!base.has(agentCellKey(target))) continue;
        const intermediate: Cell[] = [];
        for (let step = 1; step <= gap; step += 1) intermediate.push({ x: origin.x + direction.x * step, y: origin.y + direction.y * step });
        if (intermediate.every((cell) => availableGround.has(agentCellKey(cell)))) {
          for (const cell of intermediate) connected.set(agentCellKey(cell), availableGround.get(agentCellKey(cell))!);
        }
        break;
      }
    }
  }
  return connected;
}

export function mustYieldAtCrosswalk(next: Cell, crosswalks: Set<string>, walkers: ReadonlyArray<{ current: Cell; next: Cell }>): boolean {
  const nextKey = agentCellKey(next);
  if (!crosswalks.has(nextKey)) return false;
  return walkers.some((walker) => agentCellKey(walker.current) === nextKey || agentCellKey(walker.next) === nextKey);
}
