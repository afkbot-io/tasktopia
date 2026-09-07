export const SEMANTIC_ROAD_SCHEMA_VERSION = 1 as const;

export type GridPoint = { x: number; y: number };
export type OrthogonalDirection = "N" | "E" | "S" | "W";
export type OrthogonalRoadRun = { direction: OrthogonalDirection; length: number };
export type OrthogonalRoadGeometry = { start: GridPoint; runs: OrthogonalRoadRun[] };
export type SemanticRoadClass = "LOCAL" | "COLLECTOR" | "ARTERIAL" | "SERVICE";

export type SemanticRoadNode = GridPoint & {
  id: string;
  kind?: "BOUNDARY" | "JUNCTION" | "TERMINUS";
};

export type SemanticRoadSegment = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  roadClass: SemanticRoadClass;
  widthCells: number;
  geometry: OrthogonalRoadGeometry;
};

export type SemanticRoadNetwork = {
  schemaVersion: typeof SEMANTIC_ROAD_SCHEMA_VERSION;
  nodes: SemanticRoadNode[];
  segments: SemanticRoadSegment[];
};

const DIRECTION_DELTA: Record<OrthogonalDirection, GridPoint> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function directionBetween(from: GridPoint, to: GridPoint): OrthogonalDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    if (dx !== 0 && dy !== 0) throw new Error("Semantic road steps must be orthogonal");
    throw new Error("Semantic road points must be adjacent");
  }
  if (dx === 1) return "E";
  if (dx === -1) return "W";
  if (dy === 1) return "S";
  return "N";
}

function assertGridPoint(point: GridPoint, label: string): void {
  if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) {
    throw new Error(`${label} must use safe integer coordinates`);
  }
}

export function encodeOrthogonalRoadPath(path: readonly GridPoint[]): OrthogonalRoadGeometry {
  if (path.length < 2) throw new Error("Semantic road path must contain at least two points");
  path.forEach((point, index) => assertGridPoint(point, `Semantic road point ${index}`));
  const runs: OrthogonalRoadRun[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const direction = directionBetween(path[index - 1]!, path[index]!);
    const previous = runs.at(-1);
    if (previous?.direction === direction) previous.length += 1;
    else runs.push({ direction, length: 1 });
  }
  return { start: { ...path[0]! }, runs };
}

export function decodeOrthogonalRoadRuns(geometry: OrthogonalRoadGeometry): GridPoint[] {
  assertGridPoint(geometry.start, "Semantic road start");
  if (geometry.runs.length === 0) throw new Error("Semantic road geometry must contain at least one run");
  const points: GridPoint[] = [{ ...geometry.start }];
  let cursor = { ...geometry.start };
  for (const run of geometry.runs) {
    const delta = DIRECTION_DELTA[run.direction];
    if (!delta) throw new Error(`Unknown semantic road direction: ${String(run.direction)}`);
    if (!Number.isSafeInteger(run.length) || run.length <= 0) {
      throw new Error("Semantic road run length must be a positive safe integer");
    }
    for (let step = 0; step < run.length; step += 1) {
      cursor = { x: cursor.x + delta.x, y: cursor.y + delta.y };
      assertGridPoint(cursor, "Semantic road point");
      points.push(cursor);
    }
  }
  return points;
}

export function auditSemanticRoadNetwork(network: SemanticRoadNetwork): SemanticRoadNetwork {
  if (network.schemaVersion !== SEMANTIC_ROAD_SCHEMA_VERSION) {
    throw new Error(`Unsupported semantic road schema version: ${network.schemaVersion}`);
  }
  if (network.nodes.length < 2) throw new Error("Semantic road network must contain at least two nodes");
  const nodes = new Map<string, SemanticRoadNode>();
  const coordinateOwners = new Map<string, string>();
  for (const node of network.nodes) {
    if (!node.id || nodes.has(node.id)) throw new Error(`Duplicate semantic road node: ${node.id}`);
    assertGridPoint(node, `Semantic road node ${node.id}`);
    const coordinate = `${node.x}:${node.y}`;
    if (coordinateOwners.has(coordinate)) throw new Error(`Duplicate semantic road node coordinate: ${coordinate}`);
    nodes.set(node.id, node);
    coordinateOwners.set(coordinate, node.id);
  }

  const segmentIds = new Set<string>();
  const adjacency = new Map(network.nodes.map((node) => [node.id, new Set<string>()]));
  for (const segment of network.segments) {
    if (!segment.id || segmentIds.has(segment.id)) throw new Error(`Duplicate semantic road segment: ${segment.id}`);
    segmentIds.add(segment.id);
    const from = nodes.get(segment.fromNodeId);
    const to = nodes.get(segment.toNodeId);
    if (!from || !to || from.id === to.id) throw new Error(`Invalid semantic road endpoints for segment ${segment.id}`);
    if (!Number.isSafeInteger(segment.widthCells) || segment.widthCells <= 0 || segment.widthCells > 9) {
      throw new Error(`Semantic road widthCells must be between one and nine for segment ${segment.id}`);
    }
    const points = decodeOrthogonalRoadRuns(segment.geometry);
    if (!samePoint(points[0]!, from) || !samePoint(points.at(-1)!, to)) {
      throw new Error(`Semantic road endpoint mismatch for segment ${segment.id}`);
    }
    adjacency.get(from.id)!.add(to.id);
    adjacency.get(to.id)!.add(from.id);
  }

  const visited = new Set<string>();
  const queue = [network.nodes[0]!.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...adjacency.get(current)!);
  }
  if (visited.size !== network.nodes.length) throw new Error("Semantic road network must be connected");
  return network;
}
