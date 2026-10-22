import { describe, expect, it } from 'vitest';
import * as walking from '../src/client/city-walk-network';
import * as mobility from '../src/client/city-mobility';
import type { CityMobilityInput, CityMobility } from '../src/client/city-mobility';
import * as cooperative from '../src/client/cooperative-preparation';
import * as routeSearch from '../src/client/mobility-route-search';
import * as mobilityNetwork from '../src/client/city-mobility-network';
import type { MobilityNetworkInput } from '../src/client/city-mobility-network';
import type { Cell, RoadCellDto } from '../src/shared/contracts';
import type { CityWalkInput } from '../src/client/city-walk-network';
import realCity from './fixtures/city-mobility-real-city.json';

function walkFixture(): CityWalkInput {
  const cells = Array.from({ length: 32 * 20 }, (_, index) => ({ x: index % 32, y: Math.floor(index / 32) }));
  return {
    terrain: cells.map(cell => ({ ...cell, terrain: 'GRASS' })), roads: new Map(),
    surfaces: cells.filter(cell => cell.y === 2 || cell.y === 4).map(cell => ({ ...cell, kind: 'PATH' })),
    tasks: [{ taskNumber: 1, visualKind: 'BUILDING', stage: 3, visualAssetKey: 'compact-row-v1',
      footprint: [{ x: 10, y: 8 }, { x: 11, y: 8 }], accessPath: [{ x: 10, y: 9 }] }],
    features: [], decorations: [],
  };
}

function mobilityLoopInput(): CityMobilityInput {
  const cells = new Map<string, Cell>();
  for (let along = 0; along <= 8; along++) for (const cell of [{ x: along, y: 0 }, { x: along, y: 8 }, { x: 0, y: along }, { x: 8, y: along }]) cells.set(`${cell.x},${cell.y}`, cell);
  return { roads: new Map(), walkGraph: cells, crosswalks: new Set(), activityCells: new Set(['4,0']), buildingEntrances: new Set(['4,0']), seed: 73, carLimit: 0, walkerLimit: 4 };
}

function mobilityStreetInput(): CityMobilityInput {
  const roads = new Map<string, RoadCellDto>(), walkGraph = new Map<string, Cell>();
  for (const axis of [0, 24]) for (let along = -1; along <= 25; along++) for (const band of [-1, 0, 1]) {
    for (const cell of [{ x: along, y: axis + band }, { x: axis + band, y: along }]) roads.set(`${cell.x},${cell.y}`, { ...cell, roadClass: 'LOCAL', mask: 0, structure: 'ROAD' });
  }
  for (const road of roads.values()) for (const delta of [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]) {
    const cell = { x: road.x + delta.x, y: road.y + delta.y }, id = `${cell.x},${cell.y}`;
    if (!roads.has(id)) walkGraph.set(id, cell);
  }
  const crosswalks = new Set<string>();
  for (const x of [-1, 0, 1]) { crosswalks.add(`${x},12`); walkGraph.set(`${x},12`, { x, y: 12 }); }
  return { roads, walkGraph, crosswalks, activityCells: new Set(['2,7']), buildingEntrances: new Set(['2,7']), seed: 73, carLimit: 0, walkerLimit: 0 };
}

describe('cooperative canonical city preparation', () => {
  it('yields while preparing the complete WALK graph without changing cells, insertion order or input', async () => {
    const input = walkFixture(), before = structuredClone(input), expected = walking.buildCityWalkNetwork(input);
    let ticks = 0, yields = 0;
    const prepare = (walking as unknown as { buildCityWalkNetworkAsync: (input: CityWalkInput, options: { budgetMs: number; now: () => number; yieldTask: () => Promise<void> }) => Promise<ReturnType<typeof walking.buildCityWalkNetwork>> }).buildCityWalkNetworkAsync;
    expect(typeof prepare).toBe('function');
    const result = await prepare(input, {
      budgetMs: 4, now: () => ticks++, yieldTask: async () => { yields++; },
    });
    expect(yields).toBeGreaterThan(4);
    expect(result).toEqual(expected);
    expect([...result.walkGraph]).toEqual([...expected.walkGraph]);
    expect(result.walkGraph.has('10,8')).toBe(false);
    expect(result.walkGraph.has('10,3')).toBe(true); // real short grass gap
    expect(input).toEqual(before);
  });
  it('cancels a held WALK yield promptly and never publishes its late result', async () => {
    const controller = new AbortController();
    let release!: () => void, entered!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    let published = false, ticks = 0;
    const work = walking.buildCityWalkNetworkAsync(walkFixture(), {
      signal: controller.signal, budgetMs: 1, now: () => ticks++,
      yieldTask: () => { entered(); return held; },
    }).then(result => { published = true; return result; });
    await paused;
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    release(); await Promise.resolve();
    expect(published).toBe(false);
    await expect(walking.buildCityWalkNetworkAsync(walkFixture(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('prepares full road/walking topology cooperatively with identical zones, edges, signature and ordering', async () => {
    const roads = new Map<string, RoadCellDto>(), walkGraph = new Map<string, Cell>();
    for (const axis of [0, 12]) for (let along = -1; along <= 13; along++) for (const band of [-1, 0, 1]) {
      for (const cell of [{ x: along, y: axis + band }, { x: axis + band, y: along }]) roads.set(`${cell.x},${cell.y}`, { ...cell, roadClass: 'LOCAL' } as RoadCellDto);
    }
    for (const road of roads.values()) for (const delta of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
      const cell = { x: road.x + delta.x, y: road.y + delta.y }, id = `${cell.x},${cell.y}`;
      if (!roads.has(id)) walkGraph.set(id, cell);
    }
    const input: MobilityNetworkInput = { roads, walkGraph, crosswalks: new Set(), activityCells: new Set(['5,2']), buildingEntrances: new Set(['5,2']) };
    const expected = mobilityNetwork.buildMobilityNetwork(input), before = structuredClone(input);
    const prepare = (mobilityNetwork as unknown as { buildMobilityNetworkAsync: (input: MobilityNetworkInput, options: { now: () => number; yieldTask: () => Promise<void> }) => Promise<typeof expected> }).buildMobilityNetworkAsync;
    expect(typeof prepare).toBe('function');
    let ticks = 0, yields = 0;
    const result = await prepare(input, { now: () => ticks++, yieldTask: async () => { yields++; } });
    expect(yields).toBeGreaterThan(8);
    expect(result).toEqual(expected);
    for (const field of ['roads', 'cars', 'walkers', 'carEdges', 'walkerEdges', 'zoneByCell'] as const) expect([...result[field]]).toEqual([...expected[field]]);
    expect(input).toEqual(before);
  });
  it('does not swallow a rejected cooperative yield whose rejection reason is undefined', async () => {
    let ticks = 0, resolved = false, rejected = false;
    await walking.buildCityWalkNetworkAsync(walkFixture(), {
      budgetMs: 1, now: () => ticks++, yieldTask: () => Promise.reject(undefined), signal: new AbortController().signal,
    }).then(() => { resolved = true; }, () => { rejected = true; });
    expect({ resolved, rejected }).toEqual({ resolved: false, rejected: true });
  });

  it('prepares route indexes cooperatively and retains reviewed heading-aware routes and closure ownership', async () => {
    const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const graph = new Map(cells.map(cell => [`${cell.x},${cell.y}`, cell]));
    const edges = new Map(cells.map(cell => [`${cell.x},${cell.y}`, cells.filter(next => Math.abs(next.x - cell.x) + Math.abs(next.y - cell.y) === 1)]));
    const prepare = (routeSearch as unknown as { createMobilityRouteSearchAsync: (graph: ReadonlyMap<string, Cell>, edges: ReadonlyMap<string, readonly Cell[]>, options: { now: () => number; yieldTask: () => Promise<void>; budgetMs: number }) => Promise<ReturnType<typeof routeSearch.createMobilityRouteSearch>> }).createMobilityRouteSearchAsync;
    expect(typeof prepare).toBe('function');
    let ticks = 0, yields = 0;
    const result = await prepare(graph, edges, { budgetMs: 1, now: () => ticks++, yieldTask: async () => { yields++; } });
    expect(yields).toBeGreaterThan(2);
    const start = { x: 1, y: 0 }, previous = { x: 0, y: 0 }, target = { x: 0, y: 0 };
    const before = result(start, previous, target, 4);
    expect(before.routeTo(target)).toEqual([start, { x: 1, y: 1 }, { x: 0, y: 1 }, target]);
    result.setBlocked(new Set(['1,1']));
    expect(result(start, previous, target, 4).routeTo(target)).toEqual([]);
    expect(before.routeTo(target)).toHaveLength(4);
  });

  it('provides a real default task boundary and cancels it with the exact abort reason', async () => {
    const pause = (cooperative as unknown as { yieldPreparationTask: (signal?: AbortSignal) => Promise<void> }).yieldPreparationTask;
    expect(typeof pause).toBe('function');
    let finished = false;
    const work = pause().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    await work;
    expect(finished).toBe(true);
    const controller = new AbortController(), reason = new Error('city owner was replaced');
    const cancelled = pause(controller.signal);
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    await expect(pause(controller.signal)).rejects.toBe(reason);
  });

  it('prepares initial route indexes and spawned residents cooperatively with identical seeded motion', async () => {
    const input = mobilityLoopInput(), expected = mobility.createCityMobility(input), before = structuredClone(input);
    const prepare = (mobility as unknown as { createCityMobilityAsync: (input: CityMobilityInput, options: { now: () => number; budgetMs: number; yieldTask: () => Promise<void> }) => Promise<CityMobility> }).createCityMobilityAsync;
    expect(typeof prepare).toBe('function');
    let ticks = 0, yields = 0;
    const result = await prepare(input, { budgetMs: 1, now: () => ticks++, yieldTask: async () => { yields++; } });
    expect(yields).toBeGreaterThan(32);
    expect(result.agents).toHaveLength(4);
    expect(result.agents).toEqual(expected.agents);
    expect(result.signals).toEqual(expected.signals);
    expect(result.metrics).toEqual(expected.metrics);
    for (const elapsed of [17, 33, 50, 75, 25, 300]) { result.advance(elapsed); expected.advance(elapsed); }
    expect(result.agents).toEqual(expected.agents);
    expect(result.metrics).toEqual(expected.metrics);
    expect(input).toEqual(before);
  });

  it('commits prepared geometry to the same controller using the latest visits, closures, poses and population', async () => {
    const input = mobilityLoopInput(), city = mobility.createCityMobility(input);
    const commit = (city as CityMobility & { updateNetworkPrepared: (prepared: Awaited<ReturnType<typeof mobility.prepareCityMobilityNetworkAsync>>) => void }).updateNetworkPrepared;
    expect(typeof commit).toBe('function');
    let release!: () => void, entered!: () => void, ticks = 0, held = false;
    const paused = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const changed = { ...input, walkGraph: new Map([...input.walkGraph, ['100,100', { x: 100, y: 100 }] as [string, Cell]]) };
    const preparing = mobility.prepareCityMobilityNetworkAsync(changed, { budgetMs: 1, now: () => ticks++, yieldTask: async () => { if (!held) { held = true; entered(); await gate; } } });
    await paused;
    city.updateNetwork({ ...input, walkerLimit: 2 });
    const actorId = city.agents[0]!.id, target = [...city.visitTargets.values()][1]!;
    expect(city.dispatchVisit('latest-visit', [target], 1, 3000, false, [actorId])).toEqual([actorId]);
    const closed = [...city.walkingCells.values()].find(cell => `${cell.x},${cell.y}` !== `${target.x},${target.y}`)!;
    city.setWalkClosures(new Set([`${closed.x},${closed.y}`]));
    city.advance(50);
    const latest = city.agents;
    release(); const prepared = await preparing;
    city.updateNetworkPrepared(prepared);
    expect(city.agents).toEqual(latest);
    expect(city.agents).toHaveLength(2); // stale preparation input still had4
    expect(city.agents.find(actor => actor.id === actorId)!.visit?.id).toBe('latest-visit');
    expect(city.dispatchVisit('closed-target', [closed], 1, 3000, false)).toEqual([]);
    expect(city.metrics.networkBuilds).toBe(2);
  });

  it('bounds work even with a frozen clock and aborts before reading the remaining canonical terrain', async () => {
    const input = walkFixture(), terrain = Array.from({ length: 32768 }, (_, x) => ({ x, y: 100, terrain: 'GRASS' as const }));
    let read = 0;
    input.terrain = new Proxy(terrain, { get(target, property, receiver) {
      if (property === Symbol.iterator) return function* () { for (const cell of target) { read++; yield cell; } };
      return Reflect.get(target, property, receiver);
    } });
    const controller = new AbortController();
    await expect(walking.buildCityWalkNetworkAsync(input, { signal: controller.signal, now: () => 0,
      yieldTask: async () => { controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(terrain.length);
  });

  it('avoids excessive task posts for cheap canonical work on a coarse clock', async () => {
    const input = { ...walkFixture(), tasks: [], surfaces: [], terrain: Array.from({ length: 32768 }, (_, x) => ({ x, y: 100, terrain: 'MEADOW' as const })) };
    let posts = 0;
    const result = await walking.buildCityWalkNetworkAsync(input, { now: () => 0, yieldTask: async () => { posts++; } });
    expect(result.animalGraph.size).toBe(input.terrain.length);
    expect(posts).toBeGreaterThan(0); // a frozen clock must still cooperate
    expect(posts).toBeLessThanOrEqual(8);
  });

  it('still pauses cheap work promptly when the elapsed-time budget expires', async () => {
    const input = { ...walkFixture(), tasks: [], surfaces: [], terrain: [] as CityWalkInput['terrain'] };
    const terrain = Array.from({ length: 32768 }, (_, x) => ({ x, y: 100, terrain: 'MEADOW' as const }));
    let read = 0, ticks = 0;
    input.terrain = new Proxy(terrain, { get(target, property, receiver) {
      if (property === Symbol.iterator) return function* () { for (const cell of target) { read++; yield cell; } };
      return Reflect.get(target, property, receiver);
    } });
    const controller = new AbortController();
    await expect(walking.buildCityWalkNetworkAsync(input, { signal: controller.signal, now: () => ticks++,
      yieldTask: async () => { controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(16); // elapsed time takes precedence over the fallback work cap
  });

  it('bounds scheduler overhead while preparing a full protected walking network', async () => {
    const walkGraph = new Map(Array.from({ length: 4096 }, (_, x) => [`${x},0`, { x, y: 0 }] as const));
    const input: MobilityNetworkInput = { roads: new Map(), walkGraph, crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(walkGraph.keys()) };
    const expected = mobilityNetwork.buildMobilityNetwork(input), before = structuredClone(input);
    let clockReads = 0;
    const result = await mobilityNetwork.buildMobilityNetworkAsync(input, { now: () => { clockReads++; return 0; }, yieldTask: async () => undefined });
    expect(result.walkers.size).toBe(walkGraph.size);
    expect(result.walkerEdges.get('2048,0')).toEqual([{ x: 2049, y: 0 }, { x: 2047, y: 0 }]);
    expect(result).toEqual(expected);
    expect([...result.walkers]).toEqual([...expected.walkers]);
    expect(input).toEqual(before);
    // Indexing all cells is required. Scheduler bookkeeping should use fewer
    // than six clock reads per cell, rather than one per tiny graph operation.
    expect(clockReads).toBeLessThan(walkGraph.size * 6);
  });

  it('bounds coarse-clock task posts while preparing all residents on a real street network', async () => {
    const key = (cell: Cell) => `${cell.x},${cell.y}`;
    const input: CityMobilityInput = {
      roads: new Map(realCity.roads.map(cell => [key(cell), cell as RoadCellDto])),
      walkGraph: new Map(realCity.walkGraph.map(cell => [key(cell), cell])),
      crosswalks: new Set(realCity.crosswalks), activityCells: new Set(realCity.activityCells),
      seed: 73, carLimit: 24, walkerLimit: 32,
    };
    const expected = mobility.createCityMobility(input);
    let posts = 0;
    const result = await mobility.createCityMobilityAsync(input, { now: () => 0, yieldTask: async () => { posts++; } });
    expect(result.agents).toHaveLength(56);
    expect(result.agents).toEqual(expected.agents);
    for (const elapsed of [50, 500, 2500]) {
      result.advance(elapsed); expected.advance(elapsed);
      expect(result.agents).toEqual(expected.agents);
      expect(result.metrics).toEqual(expected.metrics);
    }
    // Cheap graph checkpoints must not turn a bounded population into dozens
    // of browser tasks. The elapsed-time scheduler still keeps its 4ms budget.
    expect(posts).toBeGreaterThan(0);
    expect(posts).toBeLessThanOrEqual(8);
  });

  it('checks network cancellation within one small batch while consuming canonical geometry', async () => {
    const abort = new AbortController(), reason = new Error('network superseded');
    let read = 0, abortedAt = 0, published = false;
    class ObservedWalk extends Map<string, Cell> {
      override *[Symbol.iterator](): MapIterator<[string, Cell]> {
        for (const entry of super[Symbol.iterator]()) {
          read++;
          if (read === 17) { abortedAt = read; abort.abort(reason); }
          yield entry;
        }
      }
    }
    const walkGraph = new ObservedWalk(Array.from({ length: 4096 }, (_, x) => [`${x},0`, { x, y: 0 }]));
    const input: MobilityNetworkInput = { roads: new Map(), walkGraph, crosswalks: new Set(), activityCells: new Set() };
    const pending = mobilityNetwork.buildMobilityNetworkAsync(input, { signal: abort.signal, now: () => 0,
      yieldTask: async () => undefined,
    }).then(result => { published = true; return result; });
    await expect(pending).rejects.toBe(reason);
    expect(abortedAt).toBe(17);
    expect(read - abortedAt).toBeLessThan(16);
    expect(read).toBeLessThan(walkGraph.size);
    expect(published).toBe(false);
  });

  it('keeps the elapsed-time network pause ahead of the coarse-clock operation fallback', async () => {
    let read = 0, ticks = 0;
    class ObservedWalk extends Map<string, Cell> {
      override *[Symbol.iterator](): MapIterator<[string, Cell]> {
        for (const entry of super[Symbol.iterator]()) { read++; yield entry; }
      }
    }
    const walkGraph = new ObservedWalk(Array.from({ length: 4096 }, (_, x) => [`${x},0`, { x, y: 0 }]));
    const input: MobilityNetworkInput = { roads: new Map(), walkGraph, crosswalks: new Set(), activityCells: new Set() };
    const abort = new AbortController();
    await expect(mobilityNetwork.buildMobilityNetworkAsync(input, { signal: abort.signal, now: () => ticks++,
      yieldTask: async () => { abort.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(128);
  });

  it('does not cross a partial child preparation boundary after cancellation', async () => {
    const abort = new AbortController();
    let roadChecks = 0, readsAfterAbort = 0;
    class ObservedRoads extends Map<string, RoadCellDto> {
      override has(id: string) {
        // One input membership check, then four final child curb probes.
        if (++roadChecks === 5) abort.abort();
        return super.has(id);
      }
    }
    const cell = { get x() { if (abort.signal.aborted) readsAfterAbort++; return 0; }, get y() { if (abort.signal.aborted) readsAfterAbort++; return 0; } };
    const input: MobilityNetworkInput = { roads: new ObservedRoads(), walkGraph: new Map([['0,0', cell]]),
      crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(['0,0']) };
    await expect(mobilityNetwork.buildMobilityNetworkAsync(input, { signal: abort.signal, now: () => 0,
      yieldTask: async () => undefined,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(roadChecks).toBe(5);
    expect(readsAfterAbort).toBe(0);
  });

  it('rejects an already owned topology before changing population or live motion', async () => {
    const input = mobilityLoopInput(), owner = mobility.createCityMobility(input);
    const city = mobility.createCityMobility(input), control = mobility.createCityMobility(input);
    const changed = { ...input, walkGraph: new Map([...input.walkGraph, ['100,100', { x: 100, y: 100 }] as [string, Cell]]) };
    const prepared = await mobility.prepareCityMobilityNetworkAsync(changed);
    owner.updateNetworkPrepared(prepared);
    expect(() => city.updateNetworkPrepared(prepared, { walkerLimit: 0, spawnPriorityCells: [{ x: 100, y: 100 }] })).toThrow('already belongs');
    city.advance(50); control.advance(50);
    expect(city.agents).toHaveLength(4);
    expect(city.agents).toEqual(control.agents);
    expect(city.metrics).toEqual(control.metrics);
    expect([...city.walkingCells]).toEqual([...control.walkingCells]);

    // An unchanged topology is not adopted, so its preparation remains free.
    const unchanged = await mobility.prepareCityMobilityNetworkAsync(input);
    city.updateNetworkPrepared(unchanged);
    owner.updateNetworkPrepared(unchanged);
    expect([...owner.walkingCells]).toEqual([...control.walkingCells]);
  });

  it('exposes a cached immutable geometry view without actors or mutable core references', async () => {
    const read = (mobility as unknown as { readPreparedCityMobilityGeometry: (prepared: mobility.PreparedCityMobilityNetwork) => {
      zones: readonly mobilityNetwork.MobilityZone[]; walkingCells: ReadonlyMap<string, Cell>; visitTargets: ReadonlyMap<string, Cell>;
      canDrive(from: Cell, to: Cell): boolean;
    } }).readPreparedCityMobilityGeometry;
    expect(typeof read).toBe('function');
    const input = mobilityStreetInput(), prepared = await mobility.prepareCityMobilityNetworkAsync(input), view = read(prepared);
    expect(read(prepared)).toBe(view);
    expect(Object.keys(view).sort()).toEqual(['canDrive', 'visitTargets', 'walkingCells', 'zones']);
    expect(view.walkingCells.has('2,7')).toBe(true);
    expect(view.visitTargets.has('2,7')).toBe(true);
    const zone = view.zones[0]!;
    expect(zone.signalPosts.length).toBeGreaterThan(0);
    expect(() => (view.walkingCells as Map<string, Cell>).clear()).toThrow();
    expect(() => (view.visitTargets as Map<string, Cell>).set('fake', { x: 100, y: 100 })).toThrow();
    expect(() => { view.walkingCells.get('2,7')!.x = 999; }).toThrow();
    expect(() => { view.walkingCells.values().next().value!.y = 999; }).toThrow();
    expect(() => { view.walkingCells.entries().next().value![1].x = 999; }).toThrow();
    view.walkingCells.forEach((cell, id, map) => { expect(map).toBe(view.walkingCells); expect(cell).toBe(view.walkingCells.get(id)); });
    expect(() => (view.zones as mobilityNetwork.MobilityZone[]).pop()).toThrow();
    expect(() => { zone.bounds.minX = 999; }).toThrow();
    expect(() => { zone.signalPosts[0]!.origin.x = 999; }).toThrow();
    expect(() => (zone.cells as Set<string>).clear()).toThrow();
    const city = mobility.createCityMobility(mobilityLoopInput());
    city.updateNetworkPrepared(prepared);
    expect(city.walkingCells.has('fake')).toBe(false);
    expect(city.walkingCells.get('2,7')).toEqual({ x: 2, y: 7 });
    expect(() => read(prepared)).toThrow('already belongs');
    expect(() => view.canDrive({ x: -1, y: 3 }, { x: -1, y: 7 })).toThrow('already belongs');
    expect(() => read({ ...prepared })).toThrow('Invalid mobility preparation');
    expect(() => read({ signature: prepared.signature } as mobility.PreparedCityMobilityNetwork)).toThrow('Invalid mobility preparation');
  });

  it('plans driving against prepared geometry while actual dispatch retains the latest closures', async () => {
    const read = (mobility as unknown as { readPreparedCityMobilityGeometry: (prepared: mobility.PreparedCityMobilityNetwork) => { canDrive(from: Cell, to: Cell): boolean } }).readPreparedCityMobilityGeometry;
    expect(typeof read).toBe('function');
    const input = mobilityStreetInput(), city = mobility.createCityMobility(input);
    const from = { x: -1, y: 3 }, to = { x: -1, y: 7 };
    expect(city.canDrive(from, to)).toBe(true);
    const changed = { ...input, walkGraph: new Map([...input.walkGraph, ['100,100', { x: 100, y: 100 }] as [string, Cell]]) };
    const prepared = await mobility.prepareCityMobilityNetworkAsync(changed), view = read(prepared);
    city.setRoadClosures(new Set(['-1,7']));
    expect(city.canDrive(from, to)).toBe(false);
    expect(view.canDrive(from, to)).toBe(true);
    expect(view.canDrive(from, { x: -1, y: 200 })).toBe(false);
    expect(view.canDrive(from, { x: 0, y: 7 })).toBe(false);
    city.updateNetworkPrepared(prepared);
    expect(city.canDrive(from, to)).toBe(false);
    city.setRoadClosures(new Set());
    expect(city.canDrive(from, to)).toBe(true);
  });

  it('can cancel in initial population preparation after the complete topology prefix without publishing a controller', async () => {
    const input = mobilityLoopInput();
    let ticks = 0, topologyYields = 0;
    await mobility.prepareCityMobilityNetworkAsync(input, { budgetMs: 1, now: () => ticks++, yieldTask: async () => { topologyYields++; } });
    const controller = new AbortController();
    let initialYields = 0, published = false; ticks = 0;
    const work = mobility.createCityMobilityAsync(input, { budgetMs: 1, now: () => ticks++, signal: controller.signal,
      yieldTask: async () => { if (++initialYields > topologyYields + 2) controller.abort(); },
    }).then(result => { published = true; return result; });
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(initialYields).toBe(topologyYields + 3);
    expect(published).toBe(false);
  });

});
