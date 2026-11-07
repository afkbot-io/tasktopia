import type { Cell, Rect } from '../shared/contracts';
import { cityLifeHash } from './city-life';
import { completePreparation, prepareCooperatively, type CooperativePreparationOptions } from '../shared/cooperative-preparation';

const inside = (x: number, y: number, view: Rect, halo = 0) => x >= view.minX - halo && x <= view.maxX + halo
  && y >= view.minY - halo && y <= view.maxY + halo;
const valid = (view: Rect) => Object.values(view).every(Number.isFinite) && view.maxX >= view.minX && view.maxY >= view.minY;
const modulo = (value: number, span: number) => ((value % span) + span) % span;

/** Limits protect the renderer even during a malformed/very large viewport.
 * All lattice IDs and positions belong to the world, never the camera. */
function lattice(view: Rect, width: number, height: number, dx: number, dy: number, maxAxis: number) {
  const cx = Math.floor(((view.minX + view.maxX) * 4 - dx) / width);
  const cy = Math.floor(((view.minY + view.maxY) * 4 - dy) / height);
  const minX = Math.max(cx - Math.floor(maxAxis / 2), Math.floor((view.minX * 8 - dx) / width) - 1);
  const minY = Math.max(cy - Math.floor(maxAxis / 2), Math.floor((view.minY * 8 - dy) / height) - 1);
  return { minX, minY, maxX: Math.min(minX + maxAxis - 1, Math.floor((view.maxX * 8 - dx) / width) + 1),
    maxY: Math.min(minY + maxAxis - 1, Math.floor((view.maxY * 8 - dy) / height) + 1) };
}

export type CloudShadowPose = { id: string; x: number; y: number; scale: number; variant: number };

export function sampleCloudShadows(cityId: string, now: number, view: Rect, economy: boolean) {
  const poses: CloudShadowPose[] = [];
  let visited = 0;
  if (!Number.isFinite(now) || !valid(view)) return { poses, visited };
  const dx = now / 1000 * 3, dy = now / 1000 * .4;
  const range = lattice(view, 384, 256, dx, dy, 24);
  const ranked: Array<{ rank: number; pose: CloudShadowPose }> = [];
  for (let gy = range.minY; gy <= range.maxY; gy++) for (let gx = range.minX; gx <= range.maxX; gx++) {
    visited++;
    const id = `cloud:${cityId}:${gx}:${gy}`, hash = cityLifeHash(id), scale = 4 + hash % 2;
    const x = gx * 384 + dx + hash % 129 - 64, y = gy * 256 + dy + (hash >>> 8) % 81 - 40;
    if (inside(x / 8, y / 8, view, 20)) ranked.push({ rank: hash, pose: { id, x, y, scale, variant: (hash >>> 16) % 4 } });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  for (const { pose } of ranked.slice(0, economy ? 6 : 12)) poses.push(pose);
  return { poses, visited };
}

export type RainStreakPose = { id: string; x: number; y: number; length: number };

export function sampleRainStreaks(rainId: string, now: number, view: Rect, economy: boolean, intensity: number) {
  const poses: RainStreakPose[] = [];
  let visited = 0;
  if (!Number.isFinite(now) || !valid(view) || !(intensity > 0)) return { poses, visited };
  const range = lattice(view, 64, 64, 0, 0, 32), ranked: Array<{ rank: number; pose: RainStreakPose }> = [];
  for (let gy = range.minY; gy <= range.maxY; gy++) for (let gx = range.minX; gx <= range.maxX; gx++) {
    visited++;
    const id = `rain:${rainId}:${gx}:${gy}`, hash = cityLifeHash(id);
    const x = gx * 64 + 3 + hash % 58, y = gy * 64 + modulo(now * .14 + (hash >>> 8) % 64, 64);
    if (inside(x / 8, y / 8, view, 1)) ranked.push({ rank: hash, pose: { id, x, y, length: 3 + hash % 3 } });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  for (const { pose } of ranked.slice(0, Math.round((economy ? 48 : 112) * Math.min(1, intensity)))) poses.push(pose);
  return { poses, visited };
}

/** Precompiled sparse, safe ground samples. Each query reads only local
 * buckets with bounded occupancy, including on cities with 10,000 tasks. */
export type WetCellIndex = { readonly size: number; query: (view: Rect, limit: number) => { cells: Cell[]; visited: number; buckets: number } };
function* wetCellIndexSteps(walk: ReadonlyMap<string, Cell>, roads: ReadonlyMap<string, Cell>, blocked: ReadonlySet<string>): Generator<void, WetCellIndex, void> {
  const buckets = new Map<string, Cell[]>(), seen = new Set<string>();
  let size = 0;
  for (const graph of [walk, roads]) for (const [id, cell] of graph) {
    yield;
    if (blocked.has(id) || cityLifeHash(id) % 11 !== 0 || seen.has(id)) continue;
    seen.add(id);
    const key = `${Math.floor(cell.x / 32)},${Math.floor(cell.y / 32)}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); }
    if (bucket.length < 24) { bucket.push(cell); size++; }
  }
  return {
    size,
    query(view: Rect, limit: number) {
      const cells: Cell[] = [];
      let visited = 0, queried = 0;
      if (!valid(view) || limit <= 0) return { cells, visited, buckets: queried };
      const cx = (view.minX + view.maxX) / 2, cy = (view.minY + view.maxY) / 2;
      const minX = Math.max(Math.floor(view.minX / 32), Math.floor(cx / 32) - 8);
      const minY = Math.max(Math.floor(view.minY / 32), Math.floor(cy / 32) - 8);
      const maxX = Math.min(Math.floor(view.maxX / 32), minX + 15), maxY = Math.min(Math.floor(view.maxY / 32), minY + 15);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        queried++;
        for (const cell of buckets.get(`${x},${y}`) ?? []) { visited++; if (inside(cell.x, cell.y, view)) cells.push(cell); }
      }
      cells.sort((a, b) => Math.abs(a.x - cx) + Math.abs(a.y - cy) - Math.abs(b.x - cx) - Math.abs(b.y - cy));
      return { cells: cells.slice(0, Math.min(28, limit)), visited, buckets: queried };
    },
  };
}

export function createWetCellIndex(walk: ReadonlyMap<string, Cell>, roads: ReadonlyMap<string, Cell>, blocked: ReadonlySet<string>): WetCellIndex {
  return completePreparation(wetCellIndexSteps(walk, roads, blocked));
}

export function prepareWetCellIndexAsync(walk: ReadonlyMap<string, Cell>, roads: ReadonlyMap<string, Cell>, blocked: ReadonlySet<string>,
  options: CooperativePreparationOptions = {}): Promise<WetCellIndex> {
  return prepareCooperatively(wetCellIndexSteps(walk, roads, blocked), options);
}
