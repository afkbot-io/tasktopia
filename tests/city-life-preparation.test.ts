import { expect, it } from 'vitest';
import * as life from '../src/client/city-life';
import * as everyday from '../src/client/city-everyday-controller';
import { createCityMobility } from '../src/client/city-mobility';
import type { EverydayInput, EverydayTask } from '../src/client/city-everyday-life';
import type { CityLifeTask } from '../src/client/city-life';
import type { CooperativePreparationOptions } from '../src/client/cooperative-preparation';
import type { Cell, RoadCellDto } from '../src/shared/contracts';
import { compileTransitStops, cellKey } from '../src/client/city-everyday-life';
import { cityLifeHash } from '../src/client/city-life';

type PrepareLife = (tasks: readonly CityLifeTask[], walk: ReadonlyMap<string, Cell>, blocked: Pick<ReadonlySet<string>, 'has'>,
  options?: CooperativePreparationOptions) => Promise<ReturnType<typeof life.cityLifeSites>>;
type PrepareEveryday = (input: EverydayInput, canDrive: ((from: Cell, to: Cell) => boolean) | undefined,
  options?: CooperativePreparationOptions) => Promise<unknown>;

function fixture() {
  const walk = new Map<string, Cell>();
  for (let along = 0; along <= 12; along++) for (const cell of [{ x: along, y: 0 }, { x: along, y: 12 }, { x: 0, y: along }, { x: 12, y: along }]) walk.set(`${cell.x},${cell.y}`, cell);
  const task: EverydayTask = { id: 'school', status: 'COMPLETED', stage: 5, visualKind: 'BUILDING', serviceRole: 'EDUCATION', visualAssetKey: 'compact-modern-school-v1',
    accessPath: [{ x: 3, y: 0 }], footprint: [{ x: 3, y: -1 }], workItemType: 'TASK' };
  const input: EverydayInput = { tasks: [task], walk, roads: new Map(), blocked: new Set(), decorations: [] };
  const city = createCityMobility({ roads: input.roads, walkGraph: walk, crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(['3,0']), seed: 19, carLimit: 0, walkerLimit: 6 });
  const controller = everyday.createEverydayController('city', () => city, () => undefined);
  return { task, input, city, controller, view: { minX: -5, minY: -5, maxX: 15, maxY: 15 }, options: { enabled: true, economy: false, busy: new Set<string>(), roadBusy: false } };
}

it('prepares real canonical life sites cooperatively without changing route order or the input', async () => {
  const prepare = (life as unknown as { cityLifeSitesAsync: PrepareLife }).cityLifeSitesAsync;
  expect(typeof prepare).toBe('function');
  const task: CityLifeTask = { id: 'shop', status: 'COMPLETED', stage: 5, visualKind: 'BUILDING', serviceRole: 'SHOP', accessPath: [{ x: 0, y: 0 }], workItemType: 'TASK' };
  const tasks = [task, { ...task, id: 'unfinished', stage: 3, status: 'IN_PROGRESS' as const }, task];
  const walk = new Map(Array.from({ length: 12 }, (_, x) => [`${x},0`, { x, y: 0 }] as const)), blocked = new Set(['30,30']);
  const before = structuredClone({ tasks, walk, blocked });
  let ticks = 0, yields = 0;
  const result = await prepare(tasks, walk, blocked, { budgetMs: 1, now: () => ticks++, yieldTask: async () => { yields++; } });
  expect(yields).toBeGreaterThan(0);
  expect(result).toEqual([{ taskId: 'shop', kind: 'DELIVERY', route: Array.from({ length: 7 }, (_, index) => ({ x: 6 - index, y: 0 })) }]);
  expect(result).toEqual(life.cityLifeSites(tasks, walk, blocked));
  expect({ tasks, walk, blocked }).toEqual(before);
});

it('prepares everyday sites without touching the live director and adopts them only behind its final guard', async () => {
  const prepare = (everyday as unknown as { prepareEverydayAsync: PrepareEveryday }).prepareEverydayAsync;
  expect(typeof prepare).toBe('function');
  const f = fixture();
  f.controller.compile({ ...f.input, tasks: [] });
  const previous = f.controller.sites, actors = structuredClone(f.city.agents), inputBefore = structuredClone(f.input);
  let ticks = 0, yields = 0;
  const prepared = await prepare(f.input, f.city.canDrive, { budgetMs: 1, now: () => ticks++, yieldTask: async () => {
    yields++; expect(f.controller.sites).toBe(previous); expect(f.city.agents).toEqual(actors);
  } });
  expect(yields).toBeGreaterThan(0);
  expect(f.controller.sites).toBe(previous);
  const commit = (f.controller as unknown as { commitPrepared: (plan: unknown, isCurrent: () => boolean) => boolean }).commitPrepared;
  expect(typeof commit).toBe('function');
  expect(commit(prepared, () => false)).toBe(false);
  expect(f.controller.sites).toBe(previous); expect(f.city.agents).toEqual(actors);
  expect(commit(prepared, () => true)).toBe(true);
  expect(f.controller.sites.map(site => site.kind)).toEqual(['SCHOOL']);
  expect(f.controller.transitStops).toEqual([]);
  expect(f.input).toEqual(inputBefore);
});

it('keeps park pads and real reachable school curbs when preparing asynchronously', async () => {
  const f = fixture(), roads = new Map<string, RoadCellDto>(), walk = new Map<string, Cell>(), ground = new Map<string, Cell>();
  for (let x = 0; x < 100; x++) for (let y = -4; y <= 4; y++) {
    const cell = { x, y }, key = cellKey(cell);
    if (Math.abs(y) <= 1) roads.set(key, { ...cell, roadClass: 'LOCAL', structure: 'ROAD', mask: 0 });
    else { ground.set(key, cell); if (Math.abs(y) === 2) walk.set(key, cell); }
  }
  const canDrive = (from: Cell, to: Cell) => to.x <= 8 && from.x >= 12 && from.x <= 30 && from.y === to.y;
  const schoolInput = { ...f.input, roads, walk, ground, tasks: [{ ...f.task, accessPath: [{ x: 0, y: -2 }] }] };
  const syncStops = compileTransitStops({ ...schoolInput, canDrive });
  let ticks = 0, yields = 0;
  const prepared = await everyday.prepareEverydayAsync(schoolInput, canDrive,
    { budgetMs: 1, now: () => ticks++, yieldTask: async () => { yields++; } });
  expect(f.controller.commitPrepared(prepared, () => true)).toBe(true);
  expect(yields).toBeGreaterThan(100);
  expect(f.controller.transitStops).toEqual(syncStops);
  // These curb identities are also qualified against the immutable 053e
  // implementation, independently of the shared sync/async generator.
  expect(f.controller.transitStops.map(stop => stop.id)).toEqual([
    'stop:1,-1', 'stop:13,-1', 'stop:25,-1', 'stop:37,-1', 'stop:49,-1', 'stop:61,-1', 'stop:73,-1', 'stop:85,-1', 'stop:97,-1',
  ]);
  expect(syncStops.length).toBeGreaterThanOrEqual(2);
  expect(syncStops.length).toBeLessThanOrEqual(16);
  expect(syncStops.some(destination => destination.lane.x <= 8 && syncStops.some(source => canDrive(source.lane, destination.lane)))).toBe(true);
  for (const stop of syncStops) {
    expect(stop.shelter).toHaveLength(4); expect(stop.queue).toHaveLength(3);
    expect([...stop.shelter, ...stop.queue].every(cell => !roads.has(cellKey(cell)))).toBe(true);
    expect(stop.queue.every(cell => Math.abs(cell.y) === 2)).toBe(true);
  }
  const occupied = syncStops.flatMap(stop => [...stop.shelter, ...stop.queue].map(cellKey));
  expect(new Set(occupied).size).toBe(occupied.length);

  const footprint = Array.from({ length: 10 }, (_, y) => Array.from({ length: 10 }, (_, x) => ({ x, y: y + 1 }))).flat();
  let id = 'park-0';
  for (let index = 0; cityLifeHash(id) % 81 !== 0; index++) id = `park-${index + 1}`;
  const park: EverydayTask = { ...f.task, id, visualKind: 'PARK', visualAssetKey: 'urban-formal', serviceRole: undefined,
    footprint, accessPath: [{ x: 0, y: 0 }] };
  const path = new Map<string, Cell>(Array.from({ length: 20 }, (_, x) => [`${x},0`, { x, y: 0 }] as const));
  const parkInput = { ...f.input, tasks: [park], walk: path, safeTargets: path, ground: new Map(footprint.map(cell => [cellKey(cell), cell])) };
  const parkPlan = await everyday.prepareEverydayAsync(parkInput, undefined,
    { budgetMs: 1, now: () => ticks++, yieldTask: async () => { yields++; } });
  f.controller.commitPrepared(parkPlan, () => true);
  expect(f.controller.sites.map(site => site.kind)).toEqual(['BIRDS', 'DOG', 'MARKET']);
  expect(f.controller.kinds).toBe('BIRDS,DOG,MARKET');
  for (const site of f.controller.sites) {
    // Keep the original first-row footprint: its diagonal audience approach
    // is unsafe, so cooperative preparation must choose the next clear pad.
    expect(site.area).toEqual([{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 3 }, { x: 1, y: 3 }]);
    expect(site.area.some(cell => path.has(cellKey(cell)))).toBe(false);
    expect(site.route.every(cell => path.has(cellKey(cell)))).toBe(true);
    const targets = site.targets ?? [];
    expect(targets.length).toBeGreaterThan(0);
    expect(site.route.at(-1)).toEqual(targets[0]);
    for (const target of targets) for (const dx of [-.25, 0, .25]) for (const dy of [-.25, 0, .25]) {
      expect(site.area.some(cell => Math.abs(target.x + dx - cell.x) < .8 && Math.abs(target.y + dy - cell.y) < .8)).toBe(false);
    }
  }
});

it('aborts a held road scan before reading the full city or changing the live director', async () => {
  const f = fixture(); f.controller.compile(f.input);
  let scanned = 0;
  class ObservedRoads extends Map<string, RoadCellDto> {
    override *values(): MapIterator<RoadCellDto> {
      for (const cell of super.values()) { scanned++; yield cell; }
    }
  }
  const roads = new ObservedRoads(Array.from({ length: 20_000 }, (_, x) => [`${x},100`, { x, y: 100, roadClass: 'LOCAL', structure: 'ROAD', mask: 0 }]));
  const input = { ...f.input, tasks: [], roads };
  const sites = f.controller.sites, actors = structuredClone(f.city.agents), metrics = f.controller.metrics;
  let resume!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { reached = resolve; }), abort = new AbortController();
  const pending = everyday.prepareEverydayAsync(input, undefined, { signal: abort.signal, now: () => 0,
    yieldTask: () => { reached(); return new Promise<void>(resolve => { resume = resolve; }); } });
  await held;
  expect(scanned).toBeGreaterThan(0); expect(scanned).toBeLessThan(roads.size);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort(); await rejected;
  const stoppedAt = scanned; resume(); await Promise.resolve();
  expect(scanned).toBe(stoppedAt);
  expect(f.controller.sites).toBe(sites); expect(f.city.agents).toEqual(actors); expect(f.controller.metrics).toEqual(metrics);
});

it('cancels city life preparation during a held canonical task batch', async () => {
  const f = fixture(), tasks = Array.from({ length: 20_000 }, (_, index) => ({ ...f.task, id: `task-${index}` }));
  const abort = new AbortController(); let resume!: () => void, reached!: () => void, published = false;
  const held = new Promise<void>(resolve => { reached = resolve; });
  const pending = life.cityLifeSitesAsync(tasks, f.input.walk, f.input.blocked, { signal: abort.signal, now: () => 0,
    yieldTask: () => { reached(); return new Promise<void>(resolve => { resume = resolve; }); } });
  void pending.then(() => { published = true; }, () => undefined);
  await held;
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort(); await rejected; resume(); await Promise.resolve();
  expect(published).toBe(false); expect(f.task.status).toBe('COMPLETED'); expect(f.input.walk.size).toBe(48);
});

it.each(['stage', 'role'] as const)('rejects a stale %s plan after a held yield and commits the latest task against current actors', async cause => {
  const f = fixture(); f.controller.compile(f.input);
  f.controller.update(7000, f.view, f.options);
  expect(f.controller.update(8300, f.view, f.options).pose?.kind).toBe('SCHOOL');
  expect(f.city.agents.some(actor => actor.visit)).toBe(true);
  let revision = 1, ticks = 0, resume!: () => void, reached!: () => void, first = true;
  const captured = revision, held = new Promise<void>(resolve => { reached = resolve; });
  const pending = everyday.prepareEverydayAsync(f.input, f.city.canDrive, { budgetMs: 1, now: () => ticks++, yieldTask: () => {
    if (!first) return Promise.resolve(); first = false; reached();
    return new Promise<void>(resolve => { resume = resolve; });
  } });
  await held;
  revision++;
  const changed: EverydayTask = cause === 'stage' ? { ...f.task, stage: 4, status: 'TESTING' } : { ...f.task, serviceRole: 'SHOP' };
  const latest = { ...f.input, tasks: [changed] };
  f.city.advance(50);
  const actors = structuredClone(f.city.agents), sites = f.controller.sites, metrics = f.controller.metrics;
  const reservations = [...f.controller.reservedCells()];
  resume(); const stale = await pending;
  expect(f.controller.commitPrepared(stale, () => captured === revision)).toBe(false);
  expect(f.controller.sites).toBe(sites); expect(f.city.agents).toEqual(actors);
  expect(f.controller.metrics).toEqual(metrics); expect([...f.controller.reservedCells()]).toEqual(reservations);
  const currentRevision = revision, fresh = await everyday.prepareEverydayAsync(latest, f.city.canDrive);
  const positions = f.city.agents.map(actor => ({ id: actor.id, position: { ...actor.position } }));
  expect(f.controller.commitPrepared(fresh, () => currentRevision === revision)).toBe(true);
  expect(f.controller.sites).toEqual([]); expect(f.city.agents.some(actor => actor.visit)).toBe(false);
  expect(f.city.agents.map(actor => ({ id: actor.id, position: actor.position }))).toEqual(positions);
  expect(f.controller.metrics.cancellations).toBe(metrics.cancellations + 1);
  expect(f.controller.update(8400, f.view, f.options).pose).toBeUndefined();
});
