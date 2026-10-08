import { expect, it } from 'vitest';
import { createCityMobility } from '../src/client/city-mobility';
import type { Cell, RoadCellDto } from '../src/shared/contracts';
import { compileTransitStops } from '../src/client/city-everyday-life';
const key = (c: Cell) => `${c.x},${c.y}`;
function fixture() {
  const cells: Cell[] = [];
  for (let i = 0; i <= 12; i++) cells.push({ x: i, y: 0 }, { x: i, y: 12 }, { x: 0, y: i }, { x: 12, y: i });
  return createCityMobility({ roads: new Map<string, RoadCellDto>(), walkGraph: new Map(cells.map(c => [key(c), c])),
    crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(['3,0']), seed: 19, carLimit: 0, walkerLimit: 6 });
}
it('направляет существующих жителей к школе, допускает вход без наложений и выпускает после занятия', () => {
  const city = fixture(), before = city.agents.map(a => a.position);
  const ids = city.dispatchVisit('school-arrival', [{ x: 3, y: 0 }], 4, 3000, true);
  expect(ids).toHaveLength(4); expect(city.agents.map(a => a.position)).toEqual(before);
  const arrived = new Set<string>(), left = new Set<string>();
  for (let i = 0; i < 1600; i++) {
    city.advance(50);
    for (const a of city.agents.filter(a => ids.includes(a.id))) {
      if (a.visit?.arrived) { arrived.add(a.id); expect(a.current).toEqual({ x: 3, y: 0 }); }
      else if (arrived.has(a.id)) left.add(a.id);
    }
    expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
  }
  expect(arrived.size).toBe(4); expect(left.size).toBe(4);
  expect(city.agents).toHaveLength(6); expect(city.metrics.networkBuilds).toBe(1);
});
it('отмена и недоступный подход не телепортируют жителей и не оставляют сценку навсегда', () => {
  const city = fixture(); expect(city.dispatchVisit('missing', [{ x: 500, y: 0 }], 6, 3000, true)).toEqual([]);
  const ids = city.dispatchVisit('market', [{ x: 3, y: 0 }], 2, 8000, false);
  city.advance(400); const poses = city.agents.map(a => a.position); city.clearVisits('other');
  expect(city.agents.filter(a => a.visit)).toHaveLength(ids.length);
  city.clearVisits('market'); expect(city.agents.some(a => a.visit)).toBe(false);
  expect(city.agents.map(a => a.position)).toEqual(poses); city.advance(5000);
  expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
});

function transitFixture() {
  const roads = new Map<string, RoadCellDto>(), walk = new Map<string, Cell>(), ground = new Map<string, Cell>();
  for (const axis of [0, 20, 40]) for (let s = -1; s <= 41; s++) for (const b of [-1, 0, 1])
    for (const c of [{ x: s, y: axis + b }, { x: axis + b, y: s }]) roads.set(key(c), { ...c, roadClass: 'LOCAL' } as RoadCellDto);
  for (let y = -5; y <= 45; y++) for (let x = -5; x <= 45; x++) {
    const c = { x, y }; if (roads.has(key(c))) continue; ground.set(key(c), c);
    if (Array.from({ length: 5 }, (_, dx) => Array.from({ length: 5 }, (_, dy) => ({ x: x + dx - 2, y: y + dy - 2 }))).flat()
      .some(n => Math.abs(n.x - x) + Math.abs(n.y - y) <= 2 && roads.has(key(n)))) walk.set(key(c), c);
  }
  const input = { roads, walkGraph: walk, crosswalks: new Set<string>(), activityCells: new Set<string>(), seed: 37, carLimit: 2, walkerLimit: 10 };
  const city = createCityMobility(input), stops = compileTransitStops({ roads, walk, ground, blocked: new Set() });
  return { city, stops, input };
}

it('пассажиры едут внутри настоящего автобуса и выходят только после остановки на свободный тротуар', () => {
  const { city, stops } = transitFixture();
  const stop = stops.find(s => city.dispatchResponse('BUS', [s.lane], 30000))!; expect(stop).toBeTruthy();
  const bus = city.agents.find(a => a.response === 'BUS')!;
  expect(city.dispatchVisit('ride', stop.queue, 4, 30000, false).length).toBeGreaterThan(0);
  for (let i = 0; i < 1000 && !city.agents.some(a => a.id === bus.id && a.activity === 'REST'); i++) city.advance(50);
  let boarded = 0;
  for (let i = 0; i < 350 && !boarded; i++) { city.advance(50); boarded += city.boardVisit('ride', bus.id); }
  expect(boarded).toBeGreaterThan(0);
  const destination = stops.find(s => s.id !== stop.id && city.dispatchResponse('BUS', [s.lane], 30000, bus.id))!; expect(destination).toBeTruthy();
  city.advance(50);
  const vehicle = city.agents.find(a => a.id === bus.id)!;
  expect(vehicle.activity).toBe('NONE');
  expect(city.agents.filter(a => a.carrier === bus.id).every(a => a.activity === 'INSIDE' && a.position.x === vehicle.position.x && a.position.y === vehicle.position.y)).toBe(true);
  expect(city.alightVisit(bus.id, stop.queue)).toBe(0);
  let alighted = 0;
  for (let i = 0; i < 1800 && alighted < boarded; i++) { city.advance(50); alighted += city.alightVisit(bus.id, destination.queue); }
  expect(alighted).toBe(boarded); expect(city.agents.some(a => a.carrier)).toBe(false);
  expect(city.metrics.vehicleUnsafeTotal + city.metrics.pedestrianUnsafeTotal + city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
});

it('перекрытие будущего пути автобуса не выдаёт случайную остановку за назначенный бордюр', () => {
  const { city, stops } = transitFixture();
  const stop = stops.find(s => city.dispatchResponse('BUS', [s.lane], 30000))!;
  const bus = city.agents.find(a => a.response === 'BUS')!;
  city.setRoadClosures(new Set([key(stop.lane)]));
  city.advance(8000);
  expect(city.agents.find(a => a.id === bus.id)?.activity).not.toBe('REST');
  city.setRoadClosures(new Set());
  let arrived = false;
  for (let i = 0; i < 1400 && !arrived; i++) {
    city.advance(50); const a = city.agents.find(a => a.id === bus.id)!;
    arrived = a.activity === 'REST' && key(a.current) === key(stop.lane);
  }
  expect(arrived).toBe(true);
  expect(city.metrics.vehicleUnsafeTotal + city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
});

it('после высадки может сразу выбрать путь к входу вместо случайного первого шага от здания', () => {
  const { city, stops } = transitFixture();
  const stop = stops.find(s => city.dispatchResponse('BUS', [s.lane], 30000))!;
  const bus = city.agents.find(a => a.response === 'BUS')!;
  const ids = city.dispatchVisit('ride', stop.queue, 4, 30000, false);
  let boarded = 0;
  for (let i = 0; i < 1400 && !boarded; i++) { city.advance(50); boarded += city.boardVisit('ride', bus.id); }
  expect(boarded).toBeGreaterThan(0); expect(city.alightVisit(bus.id, stop.queue)).toBeGreaterThan(0);
  const actor = city.agents.find(a => ids.includes(a.id) && !a.carrier && key(a.current) !== key(a.next))!;
  const target = { x: actor.current.x * 2 - actor.next.x, y: actor.current.y * 2 - actor.next.y };
  expect(city.visitTargets.has(key(target))).toBe(true);
  const before = { ...actor.position };
  expect(city.dispatchVisit('school-after-bus', [target], 1, 9500, true, [actor.id])).toEqual([actor.id]);
  expect(city.agents.find(a => a.id === actor.id)!.position).toEqual(before);
  let arrived = false;
  for (let i = 0; i < 800 && !arrived; i++) { city.advance(50); arrived = !!city.agents.find(a => a.id === actor.id)?.visit?.arrived; }
  expect(arrived).toBe(true); expect(city.metrics.pedestrianUnsafeTotal + city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
});

it('отмена посещения внутри школы выпускает жителя через обычный допуск входа', () => {
  const city = fixture(), ids = city.dispatchVisit('school', [{ x: 3, y: 0 }], 1, 30000, true);
  for (let i = 0; i < 1000 && !city.agents.some(a => ids.includes(a.id) && a.activity === 'INSIDE'); i++) city.advance(50);
  expect(city.agents.find(a => ids.includes(a.id))?.activity).toBe('INSIDE');
  city.clearVisits('school'); city.advance(4000);
  expect(city.agents.find(a => ids.includes(a.id))?.activity).not.toBe('INSIDE'); expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
});

it('отмена движущегося рейса довозит пассажиров до безопасного бордюра и не оставляет скрытых жителей', () => {
  const { city, stops, input } = transitFixture();
  const stop = stops.find(s => city.dispatchResponse('BUS', [s.lane], 30000))!;
  const bus = city.agents.find(a => a.response === 'BUS')!;
  city.dispatchVisit('cancelled', stop.queue, 4, 30000, false);
  let boarded = 0;
  for (let i = 0; i < 1400 && !boarded; i++) { city.advance(50); boarded += city.boardVisit('cancelled', bus.id); }
  expect(boarded).toBeGreaterThan(0);
  expect(stops.some(s => s.id !== stop.id && city.dispatchResponse('BUS', [s.lane], 30000, bus.id))).toBe(true);
  city.advance(200); const pose = city.agents.find(a => a.id === bus.id)!.position;
  city.clearVisits('cancelled'); city.clearResponses(['BUS']);
  expect(city.agents.find(a => a.id === bus.id)!.position).toEqual(pose);
  city.updateNetwork(input);
  for (let i = 0; i < 1200 && city.agents.some(a => a.carrier); i++) city.advance(50);
  expect(city.agents.some(a => a.carrier)).toBe(false);
  expect(city.agents.filter(a => a.kind === 'WALKER')).toHaveLength(10);
  expect(city.metrics.vehicleUnsafeTotal + city.metrics.pedestrianUnsafeTotal + city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
  city.updateNetwork({ ...input, carLimit: 0 }); city.advance(1000);
  expect(city.agents.some(a => a.carrier)).toBe(false);
});

it('перекрытие подхода не выдаёт конец урезанного маршрута за прибытие в здание', () => {
  const city = fixture(), ids = city.dispatchVisit('school-blocked', [{ x: 3, y: 0 }], 4, 30000, true);
  expect(ids.length).toBeGreaterThan(0); city.setWalkClosures(new Set(['3,0']));
  city.advance(10000);
  expect(city.agents.filter(a => ids.includes(a.id)).some(a => a.visit?.arrived)).toBe(false);
  city.setWalkClosures(new Set()); city.advance(25000);
  expect(city.agents.filter(a => ids.includes(a.id)).some(a => a.visit?.arrived)).toBe(true);
  expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
});

it('настоящий вход на пешеходном повороте допускает вход внутрь и не удерживает проход', () => {
  const cells: Cell[] = [];
  for (let i = 0; i <= 12; i++) cells.push({ x: i, y: 0 }, { x: i, y: 12 }, { x: 0, y: i }, { x: 12, y: i });
  const city = createCityMobility({ roads: new Map(), walkGraph: new Map(cells.map(c => [key(c), c])),
    crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(['0,0']), seed: 19, carLimit: 0, walkerLimit: 6 });
  // Waiting outdoors on a bend remains disallowed; a confirmed doorway has
  // an indoor turnaround and releases its conflict reservation on entry.
  expect(city.dispatchVisit('outdoor-corner', [{ x: 0, y: 0 }], 4, 30000, false)).toEqual([]);
  const ids = city.dispatchVisit('corner-door', [{ x: 0, y: 0 }], 4, 9500, true); expect(ids.length).toBeGreaterThan(0);
  let arrivals = 0;
  for (let i = 0; i < 1000; i++) { city.advance(50); arrivals = Math.max(arrivals, city.agents.filter(a => ids.includes(a.id) && a.visit?.arrived).length); }
  expect(arrivals).toBeGreaterThan(1); expect(city.agents.some(a => a.activity === 'INSIDE')).toBe(false);
  expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
});
