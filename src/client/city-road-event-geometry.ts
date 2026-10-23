import type { Cell } from "../shared/contracts";
import type { MobilityNetwork } from "./city-mobility-network";

type RoadGeometry = Pick<MobilityNetwork, "cars" | "carEdges" | "zoneByCell" | "roads">;
export type PreparedRoadEventSite = {
  readonly cells: readonly [Cell, Cell, Cell];
  readonly keys: readonly [string, string, string];
  readonly responseKeys: readonly string[];
  readonly towCandidate?: Cell;
};
export type PreparedRoadEventGeometry = {
  readonly candidates: readonly PreparedRoadEventSite[];
  readonly byCurb: ReadonlyMap<string, readonly number[]>;
};

const key = (cell: Cell) => `${cell.x},${cell.y}`;

/** Immutable topology only. Actor occupancy, reachability and closures belong
 * to the live controller; no appointment or responder can enter this index. */
export function* prepareRoadEventGeometrySteps(network: RoadGeometry): Generator<void, PreparedRoadEventGeometry, void> {
  let work = 0;
  const unsafe = new Set<string>();
  for (const id of network.zoneByCell.keys()) {
    const cell = network.cars.get(id);
    if (!cell) { if (++work === 16) { work = 0; yield; } continue; }
    for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) {
      unsafe.add(`${cell.x + x},${cell.y + y}`);
      if (++work === 16) { work = 0; yield; }
    }
  }
  // Reuse canonical key strings across candidate lists and the reverse index.
  const curbKeys = new Map<string, string>();
  for (const id of network.cars.keys()) {
    if (!network.zoneByCell.has(id)) curbKeys.set(id, id);
    if (++work === 16) { work = 0; yield; }
  }
  const candidates: PreparedRoadEventSite[] = [];
  const byCurb = new Map<string, number[]>();
  for (const [id, outgoing] of network.carEdges) {
    if (++work === 16) { work = 0; yield; }
    const first = network.cars.get(id), second = outgoing[0];
    if (!first || !second || unsafe.has(id)) continue;
    const third = network.carEdges.get(key(second))?.find(cell => cell.x - second.x === second.x - first.x && cell.y - second.y === second.y - first.y);
    if (!third) continue;
    const keys: [string, string, string] = [id, key(second), key(third)];
    if (keys.slice(1).some(id => unsafe.has(id) || !network.roads.has(id))) continue;
    const cells: [Cell, Cell, Cell] = [first, second, third];
    const responseKeys: string[] = [];
    for (let y = -5; y <= 5; y += 1) for (let x = -5; x <= 5; x += 1) {
      const responseKey = curbKeys.get(`${first.x + x},${first.y + y}`);
      const curb = responseKey === undefined ? undefined : network.cars.get(responseKey);
      if (curb && cells.every(cell => Math.abs(curb.x - cell.x) + Math.abs(curb.y - cell.y) >= 3)) responseKeys.push(responseKey!);
      if (++work === 16) { work = 0; yield; }
    }
    if (!responseKeys.length) continue;
    const behind = { x: first.x - second.x + first.x, y: first.y - second.y + first.y };
    const towCandidate = network.carEdges.get(key(behind))?.some(cell => cell.x === first.x && cell.y === first.y) ? behind : undefined;
    const index = candidates.length;
    candidates.push({ cells, keys, responseKeys, towCandidate });
    for (const id of responseKeys) {
      let indices = byCurb.get(id);
      if (!indices) { indices = []; byCurb.set(id, indices); }
      indices.push(index);
      if (++work === 16) { work = 0; yield; }
    }
  }
  if (work) yield;
  return { candidates, byCurb };
}
