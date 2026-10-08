import { expect, it } from 'vitest';
import { compileEverydaySites, compileTransitStops, planEverydayEpisode, everydayPose, rainPose, openingKind, dogFetchPose } from '../src/client/city-everyday-life';
import { cityLifeHash } from '../src/client/city-life';
import type { ChunkTaskDto, RoadCellDto } from '../src/shared/contracts';

const walk = new Map(Array.from({ length: 20 }, (_, x) => [`${x},0`, { x, y: 0 }]));
const task = { id: 'school', status: 'COMPLETED', stage: 5, visualKind: 'BUILDING', visualAssetKey: 'compact-modern-school-v1',
  serviceRole: 'EDUCATION', accessPath: [{ x: 0, y: 0 }], footprint: [{ x: 0, y: -1 }], workItemType: 'TASK' } as ChunkTaskDto;
const input = { tasks: [task], walk, blocked: new Set<string>(), roads: new Map(), decorations: [] };

it('собака подбирает мяч и приносит обратно к краю площадки рядом с реальным хозяином', () => {
  const area = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], owner = { x: -.5, y: .5 };
  const fetch = dogFetchPose(area, owner, 3000);
  expect(fetch.carrying).toBe(true); expect(fetch.ball).toEqual(fetch.position);
  const home = dogFetchPose(area, owner, 5000);
  expect(home.position).toEqual({ x: .5, y: .5 }); expect(home.ball).toEqual(home.position);
  for (let ms = 0; ms < 6000; ms += 100) {
    const p = dogFetchPose(area, owner, ms).position;
    expect(p.x).toBeGreaterThanOrEqual(.5); expect(p.x).toBeLessThanOrEqual(1.5);
    expect(p.y).toBeGreaterThanOrEqual(.5); expect(p.y).toBeLessThanOrEqual(1.5);
  }
});

it('школьная сценка учитывает educationKind и настоящий подход, не рисует переднюю дверь скрытого входа', () => {
  const school = compileEverydaySites(input).find(s => s.kind === 'SCHOOL');
  expect(school?.route.at(-1)).toEqual({ x: 0, y: 0 });
  expect(school?.route.every(c => walk.has(`${c.x},${c.y}`))).toBe(true);
  expect(compileEverydaySites({ ...input, tasks: [{ ...task, visualAssetKey: 'compact-rose-kindergarten-v1' }] }).map(s => s.kind)).toContain('KINDERGARTEN');
  // An explicitly imported school skin has no business infrastructure role.
  // Its residents still use the school family, without changing that role.
  expect(compileEverydaySites({ ...input, tasks: [{ ...task, serviceRole: undefined }] }).map(s => s.kind)).toContain('SCHOOL');
  expect(openingKind({ ...task, serviceRole: undefined })).toBe('OPEN_SCHOOL');
  expect(compileEverydaySites({ ...input, tasks: [{ ...task, stage: 4, status: 'TESTING' }] })).toEqual([]);
  expect(compileEverydaySites({ ...input, blocked: new Set(['3,0']) })).toEqual([]);
});

it('добавление обычных домов не запускает лишний поиск подходов для учебных и парковых событий', () => {
  let probes = 0;
  class ObservedWalk extends Map<string, { x: number; y: number }> {
    override has(key: string) { probes++; return super.has(key); }
  }
  const observed = new ObservedWalk(walk);
  const expected = compileEverydaySites({ ...input, walk: observed });
  const baselineProbes = probes; probes = 0;
  const homes = Array.from({ length: 1000 }, (_, i) => ({ ...task, id: `home-${i}`, visualAssetKey: 'compact-apartment-v1', serviceRole: undefined }));
  expect(compileEverydaySites({ ...input, walk: observed, tasks: [task, ...homes] })).toEqual(expected);
  expect(probes).toBeLessThanOrEqual(baselineProbes + 10);
});

it('не ищет повторный подход к площадкам парка без спортивных конечных точек после выбора общего события', () => {
  let probes = 0;
  let groundProbes = 0;
  class ObservedTargets extends Map<string, { x: number; y: number }> {
    override get(key: string) { probes++; return super.get(key); }
  }
  class ObservedGround extends Map<string, { x: number; y: number }> {
    override has(key: string) { groundProbes++; return super.has(key); }
  }
  const footprint = Array.from({ length: 10 }, (_, y) => Array.from({ length: 10 }, (_, x) => ({ x, y: y + 1 }))).flat();
  let id = 'park-0';
  for (let i = 0; cityLifeHash(id) % 81 !== 0; i++) id = `park-${i + 1}`;
  const park = { ...task, id, visualKind: 'PARK', visualAssetKey: 'urban-formal', serviceRole: undefined, footprint } as ChunkTaskDto;
  const targets = new ObservedTargets(walk);
  const sites = compileEverydaySites({ ...input, tasks: [park], safeTargets: targets, ground: new ObservedGround(footprint.map(c => [`${c.x},${c.y}`, c])) });
  expect(sites.map(s => s.kind).sort()).toEqual(['BIRDS', 'DOG', 'MARKET']);
  expect(sites.every(s => s.area[0]?.x === 0 && s.area[0]?.y === 1)).toBe(true);
  expect(probes).toBeLessThanOrEqual(49);
  expect(groundProbes).toBeLessThanOrEqual(footprint.length * 2);
});

it('не классифицирует удалённые дорожные клетки, у которых нет доступного бордюра для посадки', () => {
  let probes = 0;
  class ObservedRoads extends Map<string, RoadCellDto> {
    override get(key: string) { probes++; return super.get(key); }
  }
  const roads = new ObservedRoads(Array.from({ length: 1000 }, (_, x) => [`${x},100`, { x, y: 100, mask: 0, structure: 'ROAD', roadClass: 'LOCAL' }]));
  expect(compileTransitStops({ ...input, roads })).toEqual([]);
  expect(probes).toBeLessThanOrEqual(10);
});

it('парк выбирает свободную площадку рядом с допустимыми конечными точками, остановка сохраняет бордюр и проход', () => {
  const footprint = Array.from({ length: 4 }, (_, y) => Array.from({ length: 6 }, (_, x) => ({ x: x + 5, y: y + 1 }))).flat();
  const park = { ...task, id: 'park', visualKind: 'PARK', visualAssetKey: 'urban-formal', footprint, accessPath: [{ x: 5, y: 0 }], serviceRole: undefined } as ChunkTaskDto;
  const ground = new Map(footprint.map(c => [`${c.x},${c.y}`, c]));
  const sites = compileEverydaySites({ ...input, tasks: [park], ground, safeTargets: new Map([['5,0', { x: 5, y: 0 }]]) });
  expect(sites.map(s => s.kind)).toEqual(['BIRDS', 'DOG', 'MARKET']);
  expect(sites.every(s => s.area.length === 4 && s.targets?.every(c => c.x === 5 && c.y === 0))).toBe(true);
  expect(compileEverydaySites({ ...input, tasks: [park], ground, safeTargets: new Map() })).toEqual([]);
  const fullWalk = new Map([...walk, ...ground]);
  const sports = compileEverydaySites({ ...input, tasks: [park], ground, walk: fullWalk, safeTargets: fullWalk }).find(s => s.kind === 'SPORT');
  expect(sports).toBeTruthy();
  expect(sports!.playTargets).toHaveLength(2);
  expect(sports!.playTargets!.every(c => sports!.area.some(a => a.x === c.x && a.y === c.y))).toBe(true);
  const roads = new Map(); const curbWalk = new Map<string, { x: number; y: number }>(), curbGround = new Map<string, { x: number; y: number }>();
  for (let x = 0; x < 50; x++) for (let y = -4; y <= 4; y++) {
    const c = { x, y }, k = `${x},${y}`;
    if (Math.abs(y) <= 1) roads.set(k, { ...c, roadClass: 'LOCAL' });
    else { curbGround.set(k, c); if (Math.abs(y) === 2) curbWalk.set(k, c); }
  }
  const stops = compileTransitStops({ roads, walk: curbWalk, ground: curbGround, blocked: new Set() });
  expect(stops.length).toBeGreaterThanOrEqual(2);
  for (const stop of stops) {
    expect(stop.shelter).toHaveLength(4); expect(stop.queue).toHaveLength(3);
    expect([...stop.shelter, ...stop.queue].every(c => !roads.has(`${c.x},${c.y}`))).toBe(true);
    expect(stop.queue.every(c => Math.abs(c.y) === 2)).toBe(true);
  }
  expect(compileTransitStops({ roads, walk: curbWalk, ground: curbGround, blocked: new Set(), safeTargets: new Map() })).toEqual([]);
});

it('рядом со школой выделяет достижимую пару остановок устойчиво к порядку исходных клеток', () => {
  const roads = new Map(), curb = new Map<string, { x: number; y: number }>(), ground = new Map<string, { x: number; y: number }>();
  for (let x = 0; x < 100; x++) for (let y = -4; y <= 4; y++) {
    const c = { x, y }, k = `${x},${y}`;
    if (Math.abs(y) <= 1) roads.set(k, { ...c, roadClass: 'LOCAL' });
    else { ground.set(k, c); if (Math.abs(y) === 2) curb.set(k, c); }
  }
  // Only a nearby source can reach the school curb: geometry alone must not
  // fill the stop budget with disconnected destinations from other blocks.
  const canDrive = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    to.x <= 8 && from.x >= 12 && from.x <= 30 && from.y === to.y;
  const options = { roads, walk: curb, ground, blocked: new Set<string>(), tasks: [task], canDrive };
  const stops = compileTransitStops(options);
  expect(stops.length).toBeLessThanOrEqual(16);
  expect(stops.some(destination => destination.lane.x <= 8 && stops.some(source => canDrive(source.lane, destination.lane)))).toBe(true);
  expect(compileTransitStops({ ...options, roads: new Map([...roads].reverse()), walk: new Map([...curb].reverse()) })).toEqual(stops);
  const occupied = stops.flatMap(stop => [...stop.shelter, ...stop.queue].map(c => `${c.x},${c.y}`));
  expect(new Set(occupied).size).toBe(occupied.length);
});

it('выбор и фазы устойчивы, событие не появляется вне камеры или после срока', () => {
  const sites = compileEverydaySites(input), view = { minX: -5, minY: -5, maxX: 25, maxY: 5 };
  const plan = planEverydayEpisode('city', sites, 0)!;
  expect(plan).toBeTruthy();
  expect(planEverydayEpisode('city', [...sites].reverse(), 0)).toEqual(plan);
  expect(everydayPose(plan, plan.start - 1, view)).toBeUndefined();
  expect(everydayPose(plan, plan.start + 1, view)?.phase).toBe('ARRIVE');
  expect(everydayPose(plan, plan.start + 16000, view)?.phase).toBe('ACTIVITY');
  expect(everydayPose(plan, plan.end - 1, view)?.phase).toBe('LEAVE');
  expect(everydayPose(plan, plan.end, view)).toBeUndefined();
  expect(everydayPose(plan, plan.start + 16000, { ...view, minX: 100 })).toBeUndefined();
  expect(everydayPose(plan, NaN, view)).toBeUndefined();
});

it('дождь имеет начало, основную фазу, высыхание и конечный срок, открытие соответствует роли здания', () => {
  expect(rainPose('city', 0).phase).toBe('DRY');
  const phases = new Set(Array.from({ length: 540 }, (_, s) => rainPose('city', s * 1000).phase));
  expect([...phases].sort()).toEqual(['DRY', 'DRYING', 'RAIN']);
  expect(rainPose('city', NaN).phase).toBe('DRY');
  expect(openingKind(task)).toBe('OPEN_SCHOOL');
  expect(openingKind({ ...task, visualAssetKey: 'compact-color-kindergarten-v1' })).toBe('OPEN_KINDERGARTEN');
  expect(openingKind({ ...task, serviceRole: 'SHOP' })).toBe('OPEN_SHOP');
  expect(openingKind({ ...task, serviceRole: 'FIRE' })).toBe('OPEN_FIRE');
});
