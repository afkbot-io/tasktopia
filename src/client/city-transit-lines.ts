import type { Cell } from '../shared/contracts';
import type { TransitStop } from './city-everyday-life';
import { completePreparation, stableSortPreparation } from './cooperative-preparation';

export type TransitLine = { id: string; stops: readonly TransitStop[] };
const distance = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const bucketKey = (x: number, y: number) => `${x},${y}`;

/** Directed loops of real curbs. Every hop is accepted by the existing64-cell
 * mobility search; no city-wide path is searched during an animation frame. */
export function* compileTransitLinesSteps(stops: readonly TransitStop[], canDrive: (from: Cell, to: Cell) => boolean): Generator<void, TransitLine[], void> {
  const unique = new Map<string, TransitStop>();
  for (const stop of stops) { unique.set(stop.id, stop); yield; }
  const ordered = yield* stableSortPreparation(unique.values(), (a, b) => a.id.localeCompare(b.id));
  const buckets = new Map<string, TransitStop[]>();
  for (const stop of ordered) {
    const key = bucketKey(Math.floor(stop.lane.x / 32), Math.floor(stop.lane.y / 32));
    const group = buckets.get(key) ?? []; group.push(stop); buckets.set(key, group); yield;
  }
  const edges = new Map<string, TransitStop[]>();
  for (const stop of ordered) {
    const nearby: TransitStop[] = [], x = Math.floor(stop.lane.x / 32), y = Math.floor(stop.lane.y / 32);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      for (const next of (buckets.get(bucketKey(x + dx, y + dy)) ?? []).slice(0, 24)) {
        const length = distance(stop.lane, next.lane);
        if (next.id !== stop.id && length > 0 && length < 64) nearby.push(next); yield;
      }
    }
    const candidates = yield* stableSortPreparation(nearby, (a, b) => distance(stop.lane, a.lane) - distance(stop.lane, b.lane) || a.id.localeCompare(b.id));
    const targets: TransitStop[] = [];
    for (const next of candidates.slice(0, 8)) { if (canDrive(stop.lane, next.lane)) targets.push(next); yield; }
    edges.set(stop.id, targets);
  }
  const assigned = new Set<string>(), lines: TransitLine[] = [];
  for (const source of ordered) {
    yield; if (assigned.has(source.id)) continue;
    let best: TransitStop[] = [];
    const stack = [[source]];
    for (let work = 0; stack.length && work < 128; work++) {
      const path = stack.pop()!, tail = path.at(-1)!; yield;
      const targets = edges.get(tail.id) ?? [];
      if (path.length >= 2 && targets.some(next => next.id === source.id) && path.length > best.length) best = path;
      if (best.length === 8) break;
      if (path.length >= 8) continue;
      for (const next of [...targets].reverse()) if (!assigned.has(next.id) && !path.some(stop => stop.id === next.id)) stack.push([...path, next]);
    }
    if (best.length < 2) continue;
    lines.push({ id: `line:${best.map(stop => encodeURIComponent(stop.id)).join('>')}`, stops: best });
    for (const stop of best) assigned.add(stop.id);
  }
  return lines;
}
export function compileTransitLines(stops: readonly TransitStop[], canDrive: (from: Cell, to: Cell) => boolean): TransitLine[] {
  return completePreparation(compileTransitLinesSteps(stops, canDrive));
}
