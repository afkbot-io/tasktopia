import type { Cell, ChunkTaskDto, Rect, RoadCellDto } from '../shared/contracts';
import { BUILDING_CATALOG } from '../shared/catalog';
import { roadBandRole } from '../shared/road-profile';
import { cityLifeHash, cityLifeSites } from './city-life';

export type EverydayKind = 'SCHOOL' | 'KINDERGARTEN' | 'BUS' | 'MARKET' | 'SPORT' | 'DOG' | 'BIRDS'
  | 'OPEN_SCHOOL' | 'OPEN_KINDERGARTEN' | 'OPEN_SHOP' | 'OPEN_FIRE' | 'OPEN_BUILDING';
export type EverydayTask = Pick<ChunkTaskDto, 'id' | 'status' | 'stage' | 'serviceRole' | 'visualKind' | 'visualAssetKey'
  | 'accessPath' | 'footprint' | 'workItemType' | 'defectSummary'>;
export type EverydaySite = { id: string; taskId?: string; kind: EverydayKind; route: Cell[]; area: Cell[]; targets?: Cell[]; playTargets?: Cell[]; stopId?: string };
export type TransitStop = { id: string; lane: Cell; shelter: Cell[]; queue: Cell[]; route: Cell[]; direction: 'horizontal' | 'vertical' };
export type EverydayInput = { tasks: readonly EverydayTask[]; walk: ReadonlyMap<string, Cell>; blocked: Pick<ReadonlySet<string>, 'has'>;
  safeTargets?: ReadonlyMap<string, Cell>;
  roads: ReadonlyMap<string, RoadCellDto>; ground?: Pick<ReadonlyMap<string, Cell>, 'has'>; decorations: readonly unknown[] };
export type EverydayEpisode = EverydaySite & { start: number; end: number };
export type EverydayPose = EverydayEpisode & { phase: 'ARRIVE' | 'ACTIVITY' | 'LEAVE'; elapsed: number; progress: number };
export const EVERYDAY_WINDOW_MS = 75_000;
export const EVERYDAY_LABEL: Record<EverydayKind, string> = {
  SCHOOL: 'В школу', KINDERGARTEN: 'В детский сад', BUS: 'Городской автобус', MARKET: 'Ярмарка', SPORT: 'Игра во дворе',
  DOG: 'Прогулка с собакой', BIRDS: 'Кормление птиц', OPEN_SCHOOL: 'Открытие школы', OPEN_KINDERGARTEN: 'Открытие детского сада',
  OPEN_SHOP: 'Первые покупатели', OPEN_FIRE: 'Открытие пожарной части', OPEN_BUILDING: 'Новоселье',
};
export const cellKey = (cell: Cell) => `${cell.x},${cell.y}`;
const buildings = new Map(BUILDING_CATALOG.map(entry => [entry.key, entry]));
const directions = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
const inside = (cell: Cell, view: Rect) => cell.x >= view.minX && cell.x <= view.maxX && cell.y >= view.minY && cell.y <= view.maxY;

export function openingKind(task: Pick<EverydayTask, 'visualAssetKey' | 'serviceRole'>): EverydayKind {
  const role = task.serviceRole ?? buildings.get(task.visualAssetKey)?.serviceRole;
  if (role === 'EDUCATION') return buildings.get(task.visualAssetKey)?.educationKind === 'KINDERGARTEN' ? 'OPEN_KINDERGARTEN' : 'OPEN_SCHOOL';
  if (role === 'SHOP') return 'OPEN_SHOP';
  if (role === 'FIRE') return 'OPEN_FIRE';
  return 'OPEN_BUILDING';
}

/** Short, finite graph walk. There is no straight-line fallback through a lot. */
export function approachRoute(anchor: Cell, walk: ReadonlyMap<string, Cell>, blocked: Pick<ReadonlySet<string>, 'has'>, length = 7): Cell[] {
  if (!walk.has(cellKey(anchor)) || blocked.has(cellKey(anchor))) return [];
  const queue: Cell[][] = [[anchor]], seen = new Set([cellKey(anchor)]);
  for (let i = 0; i < queue.length && i < 128; i++) {
    const route = queue[i]!;
    if (route.length >= length) return route.reverse();
    for (const delta of directions) {
      const tail = route.at(-1)!, cell = { x: tail.x + delta.x, y: tail.y + delta.y }, id = cellKey(cell);
      if (seen.has(id) || !walk.has(id) || blocked.has(id)) continue;
      seen.add(id); queue.push([...route, cell]);
    }
  }
  return [];
}

/** Eligible roles are read from the assigned authored family, never inferred
 * from a building's color or a false frontal door. Compile on scene changes. */
export function compileEverydaySites(input: EverydayInput): EverydaySite[] {
  const blocked = { has: (id: string) => input.blocked.has(id) || input.roads.has(id) };
  const eligible = input.tasks.filter(task => task.visualKind === 'PARK'
    || task.visualKind === 'BUILDING' && (task.serviceRole ?? buildings.get(task.visualAssetKey)?.serviceRole) === 'EDUCATION');
  const existing = cityLifeSites(eligible, input.walk, blocked), result: EverydaySite[] = [];
  const tasks = new Map(input.tasks.map(task => [task.id, task]));
  for (const base of existing) {
    const task = tasks.get(base.taskId)!;
    if (task.visualKind === 'BUILDING' && (task.serviceRole ?? buildings.get(task.visualAssetKey)?.serviceRole) === 'EDUCATION') {
      if (!task.accessPath[0] || cellKey(base.route.at(-1)!) !== cellKey(task.accessPath[0])) continue;
      const kind = buildings.get(task.visualAssetKey)?.educationKind === 'KINDERGARTEN' ? 'KINDERGARTEN' : 'SCHOOL';
      result.push({ id: `${task.id}:${kind}`, taskId: task.id, kind, route: base.route, area: [] });
    }
    if (task.visualKind !== 'PARK') continue;
    // Park items need a full clear2×2 pad, with a connected approach. Water,
    // permanent furniture and neighbouring parcels remain excluded.
    const safeGround = (cell: Cell) => { const id = cellKey(cell); return (input.walk.has(id) || input.ground?.has(id)) && !blocked.has(id); };
    const free = task.footprint.filter(safeGround);
    const freeIds = new Set(free.map(cellKey));
    const areas = free.map(c => [c, { x: c.x + 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x + 1, y: c.y + 1 }])
      .filter(area => area.every(c => freeIds.has(cellKey(c))))
      .sort((a, b) => a[0]!.y - b[0]!.y || a[0]!.x - b[0]!.x);
    const offset = cityLifeHash(task.id) % Math.max(1, areas.length);
    let publicSpace = false, sports = false;
    for (const area of [...areas.slice(offset), ...areas.slice(0, offset)]) {
      const playTargets = area.filter(c => (input.safeTargets ?? input.walk).has(cellKey(c)));
      const publicPad = !area.some(c => input.walk.has(cellKey(c)));
      // Once the common event pad is chosen, only a sports pad can add a
      // scene. Do not search another approach when no sports targets exist.
      if ((publicSpace || !publicPad) && (sports || playTargets.length < 2)) continue;
      const center = { x: area[0]!.x + .5, y: area[0]!.y + .5 };
      const destinations = input.safeTargets ?? input.walk, nearby: Cell[] = [];
      // A local pad only needs49 map lookups, not a scan of every walk cell
      // for every possible park square. Compilation stays bounded per lot.
      for (let y = Math.floor(center.y) - 3; y <= Math.floor(center.y) + 3; y++)
        for (let x = Math.floor(center.x) - 3; x <= Math.floor(center.x) + 3; x++) {
          const id = `${x},${y}`, c = destinations.get(id);
          if (c && !blocked.has(id) && !area.some(a => a.x === c.x && a.y === c.y)
            && Math.abs(c.x - center.x) + Math.abs(c.y - center.y) <= 3) nearby.push(c);
        }
      const targets = nearby.sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 4);
      const route = targets[0] ? approachRoute(targets[0], input.walk, blocked) : [];
      if (!route.length) continue;
      if (!publicSpace && publicPad) {
        for (const kind of ['MARKET', 'DOG', 'BIRDS'] as const) result.push({ id: `${task.id}:${kind}`, taskId: task.id, kind, route, area, targets });
        publicSpace = true;
      }
      if (!sports && playTargets.length >= 2) {
        result.push({ id: `${task.id}:SPORT`, taskId: task.id, kind: 'SPORT', route, area, targets,
          playTargets: [playTargets[0]!, playTargets.at(-1)!] }); sports = true;
      }
      if (publicSpace && sports) break;
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** Candidate shelter pads on the actual right curb. Opposite stops are offset;
 * graph/one-way reachability is checked by the real dispatcher before boarding. */
export function compileTransitStops(input: Pick<EverydayInput, 'roads' | 'walk' | 'blocked' | 'ground' | 'safeTargets'> & Partial<Pick<EverydayInput, 'tasks'>> & { canDrive?: (from: Cell, to: Cell) => boolean }): TransitStop[] {
  const candidates: TransitStop[] = [], result: TransitStop[] = [], occupied = new Set<string>();
  const shelterBlocked = new Set<string>();
  const approachBlocked = { has: (id: string) => input.blocked.has(id) || input.roads.has(id) || shelterBlocked.has(id) };
  const anchors = (input.tasks ?? []).filter(task => (task.serviceRole ?? buildings.get(task.visualAssetKey)?.serviceRole) === 'EDUCATION')
    .sort((a, b) => Number(b.status === 'COMPLETED') - Number(a.status === 'COMPLETED') || a.id.localeCompare(b.id))
    .flatMap(task => task.accessPath[0] ? [task.accessPath[0]] : []);
  const destinations = input.safeTargets ?? input.walk;
  // A stop needs an adjacent safe queue cell. Reject impossible curbs before
  // expensive road-band classification and preserve the sorted lane order.
  const lanes = [...input.roads.values()].filter(lane => directions.some(delta => {
    const id = `${lane.x + delta.x},${lane.y + delta.y}`;
    return destinations.has(id) && !input.roads.has(id) && !input.blocked.has(id);
  })).map(lane => {
    let distance = anchors.length ? Infinity : 0;
    for (const anchor of anchors) distance = Math.min(distance, Math.abs(lane.x - anchor.x) + Math.abs(lane.y - anchor.y));
    return { lane, distance };
  }).sort((a, b) => a.distance - b.distance || a.lane.y - b.lane.y || a.lane.x - b.lane.x);
  for (const { lane } of lanes) {
    if (candidates.length >= 128) break;
    const role = roadBandRole(input.roads, lane); if (role.kind !== 'TRAVEL') continue;
    const normal = { x: -role.dy, y: role.dx };
    // Skip road interior: this tile must be adjacent to actual non-road ground.
    const curb = { x: lane.x + normal.x, y: lane.y + normal.y };
    if (input.roads.has(cellKey(curb))) continue;
    if (candidates.some(stop => Math.abs(stop.lane.x - lane.x) + Math.abs(stop.lane.y - lane.y) < 4)) continue;
    const origin = { x: curb.x + normal.x, y: curb.y + normal.y };
    const shelter = [origin, { x: origin.x + role.dx, y: origin.y + role.dy },
      { x: origin.x + normal.x, y: origin.y + normal.y }, { x: origin.x + role.dx + normal.x, y: origin.y + role.dy + normal.y }];
    const queue = [curb, { x: curb.x + role.dx, y: curb.y + role.dy }, { x: curb.x - role.dx, y: curb.y - role.dy }];
    if (shelter.some(c => !(input.walk.has(cellKey(c)) || input.ground?.has(cellKey(c))) || input.roads.has(cellKey(c)) || input.blocked.has(cellKey(c)) )
      || queue.some(c => !(input.safeTargets ?? input.walk).has(cellKey(c)) || input.roads.has(cellKey(c)) || input.blocked.has(cellKey(c)) )) continue;
    // Only four local cells change between candidates. Avoid copying every
    // road and blocked cell up to128 times during scene preparation.
    for (const cell of shelter) shelterBlocked.add(cellKey(cell));
    const route = approachRoute(queue.at(-1)!, input.walk, approachBlocked);
    shelterBlocked.clear();
    if (!route.length) continue;
    candidates.push({ id: `stop:${cellKey(lane)}`, lane, shelter, queue, route, direction: role.dx ? 'horizontal' : 'vertical' });
  }
  const fits = (stop: TransitStop) => result.some(s => s.id === stop.id) || ![...stop.shelter, ...stop.queue].some(c => occupied.has(cellKey(c)))
    && !result.some(s => Math.abs(s.lane.x - stop.lane.x) + Math.abs(s.lane.y - stop.lane.y) < 12);
  const add = (stop: TransitStop) => {
    if (result.some(s => s.id === stop.id)) return;
    result.push(stop); for (const c of [...stop.shelter, ...stop.queue]) occupied.add(cellKey(c));
  };
  // Allocate a reachable pair per institution before filling ordinary stops.
  // A lone curb next to a school cannot receive a bus from a distant district.
  if (input.canDrive) for (const anchor of anchors) {
    if (result.length >= 16) break;
    const nearby = candidates.filter(s => Math.abs(s.lane.x - anchor.x) + Math.abs(s.lane.y - anchor.y) < 24)
      .sort((a, b) => Math.abs(a.lane.x - anchor.x) + Math.abs(a.lane.y - anchor.y) - Math.abs(b.lane.x - anchor.x) - Math.abs(b.lane.y - anchor.y));
    let found = false;
    for (const destination of nearby.slice(0, 8)) {
      if (!fits(destination)) continue;
      for (const source of [...candidates].sort((a, b) => Math.abs(a.lane.x - destination.lane.x) + Math.abs(a.lane.y - destination.lane.y)
        - Math.abs(b.lane.x - destination.lane.x) - Math.abs(b.lane.y - destination.lane.y)).slice(0, 32)) {
        const separation = Math.abs(source.lane.x - destination.lane.x) + Math.abs(source.lane.y - destination.lane.y);
        if (separation < 12 || !fits(source) || [...source.shelter, ...source.queue].some(c => [...destination.shelter, ...destination.queue].some(d => cellKey(c) === cellKey(d)))
          || result.length + Number(!result.some(s => s.id === source.id)) + Number(!result.some(s => s.id === destination.id)) > 16
          || !input.canDrive(source.lane, destination.lane)) continue;
        add(destination); add(source); found = true; break;
      }
      if (found) break;
    }
  }
  for (const candidate of candidates) { if (result.length >= 16) break; if (fits(candidate)) add(candidate); }
  return result;
}

/** Every eligible kind gets a turn. Reordered sources and reloads preserve the
 * selected site. Rendering may skip an offscreen site, not select another. */
export function planEverydayEpisode(cityId: string, sites: readonly EverydaySite[], now: number): EverydayEpisode | undefined {
  if (!Number.isFinite(now) || !sites.length) return;
  const ordered = [...sites].sort((a, b) => a.id.localeCompare(b.id));
  const kinds = [...new Set(ordered.map(site => site.kind))].sort(), window = Math.floor(now / EVERYDAY_WINDOW_MS);
  const kind = kinds[((window % kinds.length) + kinds.length) % kinds.length];
  const pool = ordered.filter(site => site.kind === kind), site = pool[cityLifeHash(`${cityId}:${window}`) % pool.length]!;
  const start = window * EVERYDAY_WINDOW_MS + 8_000;
  return { ...site, id: `${cityId}:${window}:${site.id}`, start, end: start + 44_000 };
}

export function everydayPose(episode: EverydayEpisode | undefined, now: number, view: Rect): EverydayPose | undefined {
  if (!episode || !Number.isFinite(now) || now < episode.start || now >= episode.end || !episode.route.length) return;
  if (!inside(episode.route.at(-1)!, view)) return;
  const elapsed = now - episode.start, duration = episode.end - episode.start;
  const phase = elapsed < 10_000 ? 'ARRIVE' : elapsed < duration - 10_000 ? 'ACTIVITY' : 'LEAVE';
  const progress = phase === 'ARRIVE' ? elapsed / 10_000 : phase === 'LEAVE' ? (elapsed - duration + 10_000) / 10_000 : (elapsed - 10_000) / (duration - 20_000);
  return { ...episode, elapsed, phase, progress };
}

export type RainPose = { phase: 'DRY' | 'RAIN' | 'DRYING'; intensity: number; puddles: number; id: string };

/** Local animal motion stays on the reserved park pad. */
export function dogFetchPose(area: readonly Cell[], owner: Cell, elapsed: number): { position: Cell; ball: Cell; carrying: boolean } {
  const perimeter = [area[0]!, area[1]!, area[3]!, area[2]!];
  const home = perimeter.reduce((best, c, i) => Math.hypot(c.x + .5 - owner.x, c.y + .5 - owner.y)
    < Math.hypot(perimeter[best]!.x + .5 - owner.x, perimeter[best]!.y + .5 - owner.y) ? i : best, 0);
  const path = [perimeter[home]!, perimeter[(home + 1) % 4]!, perimeter[(home + 2) % 4]!];
  const local = Math.max(0, elapsed) % 6000;
  const step = local < 2500 ? Math.min(2, local / 1000) : Math.max(0, 2 - (local - 2500) / 1000);
  const index = Math.min(1, Math.floor(step)), from = path[index]!, to = path[index + 1]!, part = step - index;
  const position = { x: from.x + (to.x - from.x) * part + .5, y: from.y + (to.y - from.y) * part + .5 };
  const origin = path[0]!, target = path[2]!, throwing = Math.min(1, local / 400);
  const ball = local >= 2500 ? position : { x: origin.x + .5 + (target.x - origin.x) * throwing, y: origin.y + .5 + (target.y - origin.y) * throwing };
  return { position, ball, carrying: local >= 2500 && local < 4500 };
}

export function rainPose(cityId: string, now: number): RainPose {
  if (!Number.isFinite(now)) return { phase: 'DRY', intensity: 0, puddles: 0, id: '' };
  const window = Math.floor(now / 540_000), start = 90_000 + cityLifeHash(cityId) % 150_000, elapsed = now - window * 540_000 - start;
  const id = `${cityId}:rain:${window}`;
  if (elapsed < 0 || elapsed >= 95_000) return { phase: 'DRY', intensity: 0, puddles: 0, id };
  if (elapsed >= 70_000) return { phase: 'DRYING', intensity: 0, puddles: 1 - (elapsed - 70_000) / 25_000, id };
  const intensity = Math.min(1, elapsed / 8_000, (70_000 - elapsed) / 8_000);
  return { phase: 'RAIN', intensity, puddles: Math.min(1, elapsed / 18_000), id };
}
