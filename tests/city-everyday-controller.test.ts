import { expect, it, vi } from 'vitest';
import { createEverydayController } from '../src/client/city-everyday-controller';
import { createCityMobility } from '../src/client/city-mobility';
import type { Cell, ChunkTaskDto, RoadCellDto } from '../src/shared/contracts';

function fixture() {
  const walk = new Map<string, Cell>();
  for (let i = 0; i <= 12; i++) for (const c of [{ x: i, y: 0 }, { x: i, y: 12 }, { x: 0, y: i }, { x: 12, y: i }]) walk.set(`${c.x},${c.y}`, c);
  const task = { id: 'school', status: 'COMPLETED', stage: 5, visualKind: 'BUILDING', visualAssetKey: 'compact-modern-school-v1',
    accessPath: [{ x: 3, y: 0 }], footprint: [{ x: 3, y: -1 }], workItemType: 'TASK' } as ChunkTaskDto;
  const input = { tasks: [task], walk, roads: new Map<string, RoadCellDto>(), blocked: new Set<string>(), decorations: [] };
  const city = createCityMobility({ roads: input.roads, walkGraph: walk, crosswalks: new Set(), activityCells: new Set(),
    buildingEntrances: new Set(['3,0']), seed: 19, carLimit: 0, walkerLimit: 6 });
  const sounds: string[] = [], controller = createEverydayController('city', () => city, sound => sounds.push(sound));
  controller.compile(input);
  const view = { minX: -5, minY: -5, maxX: 15, maxY: 15 }, options = { enabled: true, economy: false, busy: new Set<string>(), roadBusy: false };
  return { city, task, input, sounds, controller, view, options };
}

it('открытие использует адресные проверки занятости и не копирует все клетки города', () => {
  const f = fixture();
  class LocalBlocked extends Set<string> {
    override [Symbol.iterator](): SetIterator<string> { throw new Error('Full-city copy'); }
  }
  f.controller.compile({ ...f.input, blocked: new LocalBlocked() });
  f.controller.update(0, f.view, f.options);
  expect(f.controller.open(f.task, 'local-blocked', 1)).toBe(true);
  expect(f.controller.update(2, f.view, f.options).pose?.kind).toBe('OPEN_SCHOOL');
});

it('открывает школу только по свежему подтверждённому событию, звонит после прихода и не повторяет версию', () => {
  const f = fixture();
  expect(f.controller.update(0, f.view, f.options).pose).toBeUndefined();
  expect(f.controller.open({ ...f.task, status: 'TESTING', stage: 4 }, 'not-complete', 0)).toBe(false);
  expect(f.controller.open(f.task, 'fresh:school', 0)).toBe(true);
  expect(f.controller.open(f.task, 'fresh:school', 0)).toBe(false);
  expect(f.controller.update(1, f.view, f.options).pose?.kind).toBe('OPEN_SCHOOL');
  expect(f.sounds).toEqual([]);
  for (let now = 50; now <= 44000; now += 50) { f.city.advance(50); f.controller.update(now, f.view, f.options); }
  expect(f.sounds).toEqual(['bell']); expect(f.city.agents.some(a => a.visit)).toBe(false);
  f.controller.clear(); f.controller.update(45000, f.view, f.options);
  expect(f.controller.open(f.task, 'fresh:school', 45000)).toBe(false);
});

it('смена режима, занятый подход и удаление объекта отменяют сценку и освобождают жителей', () => {
  const f = fixture(); f.controller.update(0, f.view, f.options); f.controller.open(f.task, 'fresh', 1);
  expect(f.controller.update(2, f.view, f.options).visitors.length).toBeGreaterThan(0);
  expect(f.controller.update(3, f.view, { ...f.options, enabled: false }).pose).toBeUndefined();
  expect(f.controller.reservedCells().size).toBe(0); expect(f.city.agents.some(a => a.visit)).toBe(false);
  f.controller.update(4, f.view, f.options); f.controller.open(f.task, 'fresh2', 5);
  f.controller.update(6, f.view, f.options); f.controller.compile({ ...f.input, tasks: [] });
  expect(f.controller.update(7, f.view, f.options).pose).toBeUndefined(); expect(f.city.agents.some(a => a.visit)).toBe(false);
  expect(f.city.metrics.pedestrianUnsafeTotal).toBe(0);
});

it('камера не перезапускает пропущенную сценку и стройка имеет приоритет', () => {
  const f = fixture();
  f.controller.update(7000, f.view, f.options);
  expect(f.controller.update(8500, { ...f.view, minX: 100 }, f.options).pose).toBeUndefined();
  expect(f.controller.update(9000, f.view, f.options).pose).toBeUndefined(); expect(f.controller.metrics.episodes).toBe(0);
  f.controller.update(82000, f.view, f.options);
  expect(f.controller.update(83500, f.view, { ...f.options, busy: new Set(['3,0']) }).pose).toBeUndefined();
  expect(f.controller.metrics.episodes).toBe(0);
});

it('после временного ухода из DETAIL до начала окна сохраняет будущую сценку, после начала не переигрывает', () => {
  const f = fixture(); f.controller.update(0, f.view, f.options);
  expect(f.controller.planned?.start).toBe(8000);
  f.controller.update(1000, f.view, { ...f.options, enabled: false });
  expect(f.controller.planned).toBeUndefined();
  f.controller.update(2000, f.view, f.options);
  expect(f.controller.planned?.start).toBe(8000);
  f.controller.update(8500, f.view, f.options); expect(f.controller.metrics.episodes).toBe(1);
  f.controller.update(9000, f.view, { ...f.options, enabled: false });
  f.controller.update(9500, f.view, f.options); expect(f.controller.planned).toBeUndefined();
  expect(f.controller.metrics.episodes).toBe(1);
});

it('инцидент или смена реального входа отменяют активное и отложенное открытие', () => {
  for (const change of [
    { defectSummary: { active: 1, open: 1, inProgress: 0, verifying: 0 } },
    { accessPath: [{ x: 9, y: 0 }] },
  ]) {
    const f = fixture(); f.controller.update(0, f.view, f.options);
    f.controller.open(f.task, 'active', 1); f.controller.update(2, f.view, f.options);
    f.controller.open(f.task, 'queued', 3);
    f.controller.compile({ ...f.input, tasks: [{ ...f.task, ...change } as ChunkTaskDto] });
    expect(f.controller.update(4, f.view, f.options).pose).toBeUndefined();
    expect(f.city.agents.some(a => a.visit)).toBe(false);
    expect(f.controller.open(f.task, 'stale', 5)).toBe(false);
  }
});

it('церемония управляет своим новым пожарным автомобилем и не отменяет чужой выезд', () => {
  const f = fixture(), task = { ...f.task, serviceRole: 'FIRE' as const };
  f.controller.compile({ ...f.input, tasks: [task], roads: new Map([['3,1', { x: 3, y: 1, roadClass: 'LOCAL' } as RoadCellDto]]) });
  const other = { ...f.city.agents[0]!, id: 'other-engine', kind: 'CAR' as const, response: 'FIRE' as const };
  const agents = [other]; Object.defineProperty(f.city, 'agents', { get: () => agents });
  vi.spyOn(f.city, 'dispatchResponse').mockImplementation(() => { agents.push({ ...other, id: 'opening-engine' }); return true; });
  const clear = vi.spyOn(f.city, 'clearResponses');
  f.controller.update(0, f.view, f.options); f.controller.open(task, 'fire', 1); f.controller.update(2, f.view, f.options);
  f.controller.clear(); expect(clear).toHaveBeenCalledWith(['FIRE'], 'opening-engine');
  expect(clear).not.toHaveBeenCalledWith(['FIRE'], 'other-engine');
});

it('рейс не занимает машину, пока к выбранной очереди не назначены настоящие доступные пассажиры', () => {
  const roads = new Map<string, RoadCellDto>(), walk = new Map<string, Cell>(), ground = new Map<string, Cell>();
  for (const axis of [0, 20, 40]) for (let s = -1; s <= 41; s++) for (const b of [-1, 0, 1])
    for (const c of [{ x: s, y: axis + b }, { x: axis + b, y: s }]) roads.set(`${c.x},${c.y}`, { ...c, roadClass: 'LOCAL' } as RoadCellDto);
  for (let x = -5; x <= 45; x++) for (let y = -5; y <= 45; y++) {
    const c = { x, y }, key = `${x},${y}`;
    if (roads.has(key)) continue; ground.set(key, c);
    if ([...roads.values()].some(r => Math.abs(r.x - x) + Math.abs(r.y - y) <= 2)) walk.set(key, c);
  }
  const city = createCityMobility({ roads, walkGraph: walk, crosswalks: new Set(), activityCells: new Set(), seed: 37, carLimit: 2, walkerLimit: 0 });
  const controller = createEverydayController('city', () => city, () => undefined);
  controller.compile({ tasks: [], roads, walk, ground, blocked: new Set(), decorations: [] });
  const dispatch = vi.spyOn(city, 'dispatchResponse');
  const state = controller.update(0, { minX: -10, minY: -10, maxX: 70, maxY: 70 }, { enabled: true, economy: false, busy: new Set(), roadBusy: false });
  expect(state.stops.length).toBeGreaterThanOrEqual(2);
  expect(dispatch).not.toHaveBeenCalled(); expect(controller.metrics.regularBuses).toBe(0);
});

it.each(['delete', 'entrance', 'incident', 'role', 'stage'] as const)('изменение школы (%s) отменяет уже назначенный после автобуса проход к старому входу', cause => {
  const roads = new Map<string, RoadCellDto>(), walk = new Map<string, Cell>(), ground = new Map<string, Cell>();
  for (const axis of [0, 20, 40]) for (let s = -1; s <= 41; s++) for (const b of [-1, 0, 1])
    for (const c of [{ x: s, y: axis + b }, { x: axis + b, y: s }]) roads.set(`${c.x},${c.y}`, { ...c, roadClass: 'LOCAL' } as RoadCellDto);
  for (let x = -5; x <= 45; x++) for (let y = -5; y <= 45; y++) {
    const c = { x, y }, key = `${x},${y}`; if (roads.has(key)) continue; ground.set(key, c);
    if ([...roads.values()].some(r => Math.abs(r.x - x) + Math.abs(r.y - y) <= 2)) walk.set(key, c);
  }
  const entrance = { x: 3, y: -2 }, task = { ...fixture().task, accessPath: [entrance], footprint: [{ x: 3, y: -3 }] };
  const city = createCityMobility({ roads, walkGraph: walk, crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(['3,-2']), seed: 37, carLimit: 6, walkerLimit: 32 });
  const actors = city.agents.map(a => ({ ...a })), vehicle = actors.find(a => a.kind === 'CAR')!, child = actors.find(a => a.age === 'CHILD')!;
  Object.defineProperty(city, 'agents', { get: () => actors });
  vi.spyOn(city, 'canDrive').mockReturnValue(true);
  // Route/body physics is qualified separately. This director test supplies
  // actual-arrival signals and checks ownership of the subsequent school visit.
  vi.spyOn(city, 'dispatchResponse').mockImplementation((role, targets) => {
    vehicle.response = role; vehicle.current = targets[0]!; vehicle.next = vehicle.current;
    vehicle.position = { x: vehicle.current.x + .5, y: vehicle.current.y + .5 }; vehicle.activity = 'REST'; return true;
  });
  vi.spyOn(city, 'dispatchVisit').mockImplementation(id => {
    if (!id.includes(':bus:')) return [];
    child.visit = { id, arrived: !id.endsWith(':school') }; return [child.id];
  });
  vi.spyOn(city, 'boardVisit').mockImplementation(() => { if (child.carrier) return 0; child.carrier = vehicle.id; return 1; });
  vi.spyOn(city, 'alightVisit').mockImplementation(() => { if (!child.carrier) return 0; child.carrier = undefined; return 1; });
  const controller = createEverydayController('city', () => city, () => undefined), input = { tasks: [task], roads, walk, ground, blocked: new Set<string>(), decorations: [] };
  controller.compile(input); const view = { minX: -10, minY: -10, maxX: 70, maxY: 70 }, options = { enabled: true, economy: false, busy: new Set<string>(), roadBusy: false };
  controller.update(7000, view, options);
  controller.update(8300, view, options); controller.update(14000, view, options);
  const visit = child.visit?.id; expect(visit).toMatch(/:school$/);
  const changed = cause === 'delete' ? [] : [{ ...task, ...(cause === 'entrance' ? { accessPath: [{ x: 8, y: -2 }] }
    : cause === 'incident' ? { defectSummary: { active: 1, open: 1, inProgress: 0, verifying: 0 } }
      : cause === 'role' ? { serviceRole: 'SHOP' as const } : { stage: 4 as const, status: 'TESTING' as const }) }];
  const clear = vi.spyOn(city, 'clearVisits'); controller.compile({ ...input, tasks: changed });
  expect(clear).toHaveBeenCalledWith(visit);
});
