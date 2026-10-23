import { expect, it } from 'vitest';
import { createCityMobility, mobilityExitAvailable, type CityMobility, type CityMobilityAgent } from '../src/client/city-mobility';
import { buildMobilityNetwork } from '../src/client/city-mobility-network';
import type { Cell, RoadCellDto } from '../src/shared/contracts';

const key = (cell: Cell) => `${cell.x},${cell.y}`;
const oldExit = { x: 1, y: 2 }, newExit = { x: -1, y: 2 }, upperGuide = { x: -1, y: -2 };
const pose = (actor: CityMobilityAgent) => ({ current: actor.current, next: actor.next, position: actor.position,
  progress: actor.progress, direction: actor.direction });
const stablePose = (actor: CityMobilityAgent) => ({ ...pose(actor), steps: actor.steps });
const safety = (city: CityMobility) => city.metrics.vehicleUnsafeTotal + city.metrics.pedestrianUnsafeTotal + city.metrics.vehiclePedestrianUnsafeTotal;

function fixture() {
  const roads = new Map<string, RoadCellDto>();
  for (let x = -4; x <= 4; x++) for (let y = -1; y <= 1; y++)
    roads.set(`${x},${y}`, { x, y, roadClass: 'LOCAL', mask: 0, structure: 'ROAD' });
  const walkGraph = new Map<string, Cell>();
  const add = (x: number, y: number) => walkGraph.set(`${x},${y}`, { x, y });
  for (let x = -5; x <= 5; x++) { add(x, -2); add(x, 2); }
  for (let y = -2; y <= 2; y++) { add(-5, y); add(5, y); }
  const crosswalks = new Set<string>();
  for (let y = -1; y <= 1; y++) { add(0, y); crosswalks.add(`0,${y}`); }
  for (let x = -3; x <= -1; x++) { add(x, 2); add(x, 4); }
  for (let y = 2; y <= 4; y++) { add(-3, y); add(-1, y); }
  return { roads, walkGraph, crosswalks, activityCells: new Set<string>(),
    transferCells: new Set(['-1,2', '-3,4', '-1,4']), seed: 73, carLimit: 0, walkerLimit: 2 };
}

/** Reach the witness using real residents, ordinary visits and fixed steps.
 * No actor routes, reservations, poses or random generator state are exposed. */
function pairedWitness() {
  const input = fixture(), network = buildMobilityNetwork(input), zone = network.zoneByCell.get('0,0')!;
  expect(zone).toBeTruthy();
  expect([-2, -1, 0, 1, 2].every(y => zone.cells.has(`0,${y}`))).toBe(true);
  expect(network.zoneByCell.has(key(oldExit)) || network.zoneByCell.has(key(newExit))).toBe(false);
  const control = createCityMobility(input), treatment = createCityMobility(input);
  expect(treatment.agents).toEqual(control.agents); expect(control.agents).toHaveLength(2);
  const initialIds = control.agents.map(actor => actor.id);
  const sorted = [...control.agents].sort((a, b) => Math.abs(a.current.x - upperGuide.x) + Math.abs(a.current.y - upperGuide.y)
    - Math.abs(b.current.x - upperGuide.x) - Math.abs(b.current.y - upperGuide.y) || a.id.localeCompare(b.id));
  const aId = sorted[0]!.id, bId = sorted[1]!.id;
  const aVisit = 'retarget-A', bGuide1 = 'retarget-B-guide1', bGuide2 = 'retarget-B-guide2', bHold = 'retarget-B-hold', bGo = 'retarget-B-go';
  const actor = (id: string) => control.agents.find(candidate => candidate.id === id)!;
  const arrived = (id: string, visitId: string) => actor(id).visit?.id === visitId && actor(id).visit?.arrived;
  const paired = (operation: (city: CityMobility) => unknown) => {
    expect(operation(treatment)).toEqual(operation(control));
    expect(treatment.agents).toEqual(control.agents); expect(treatment.metrics).toEqual(control.metrics);
  };
  const dispatch = (id: string, target: Cell, actorId: string, stayMs = 30_000) => paired(city => {
    const selected = city.dispatchVisit(id, [target], 1, stayMs, false, [actorId]);
    expect(selected).toEqual([actorId]); return selected;
  });
  const clear = (id: string) => paired(city => city.clearVisits(id));
  dispatch(aVisit, upperGuide, aId); dispatch(bGuide1, { x: -3, y: 4 }, bId);
  let bStage = 1, aDispatched = false, bReleased = false;
  for (let setupSteps = 0; setupSteps < 400; setupSteps++) {
    if (bStage === 1 && arrived(bId, bGuide1)) { clear(bGuide1); dispatch(bGuide2, { x: -1, y: 4 }, bId); bStage = 2; }
    if (bStage === 2 && arrived(bId, bGuide2)) { clear(bGuide2); dispatch(bHold, newExit, bId); bStage = 3; }
    if (!aDispatched && bStage === 3 && arrived(bId, bHold) && arrived(aId, aVisit)) {
      clear(aVisit); dispatch(aVisit, oldExit, aId, 500); aDispatched = true;
    }
    const a = actor(aId), b = actor(bId);
    const insideEdge = zone.cells.has(key(a.current)) && zone.cells.has(key(a.next)) && a.progress > 0 && a.progress < 1;
    if (aDispatched && !bReleased && insideEdge) { clear(bHold); dispatch(bGo, oldExit, bId); bReleased = true; }
    if (aDispatched && bReleased && insideEdge && key(b.current) === key(newExit)
      && zone.cells.has(key(b.next)) && b.yieldReason === 'RESERVATION'
      && mobilityExitAvailable(oldExit, { ...a, direction: 'east' }, control.agents)
      && !mobilityExitAvailable(newExit, { ...a, direction: 'west' }, control.agents)) {
      expect(control.metrics.walkerSteps).toBeGreaterThan(0);
      return { control, treatment, aId, bId, aVisit, bGo, initialIds, zone, network };
    }
    paired(city => city.advance(50));
    expect(safety(control) + safety(treatment)).toBe(0);
    expect(control.agents.map(a => a.id)).toEqual(initialIds);
  }
  throw new Error('Public reservation/exit witness was not reached within 400 fixed steps');
}

it.each([{ label: 'same-id', fresh: false }, { label: 'fresh-id', fresh: true }])('назначение $label внутри перехода сохраняет допущенный выход и не запирает встречного жителя', ({ fresh }) => {
  const { control, treatment, aId, bId, aVisit, initialIds } = pairedWitness();
  const before = treatment.agents.find(a => a.id === aId)!;
  const starts = new Map(control.agents.map(a => [a.id, a.steps]));
  if (fresh) treatment.clearVisits(aVisit);
  expect(treatment.dispatchVisit(fresh ? 'fresh-retarget' : aVisit, [newExit], 1, 500, false, [aId])).toEqual([aId]);
  expect(pose(treatment.agents.find(a => a.id === aId)!)).toEqual(pose(before));
  let tailBaseline: unknown = null, stuckTailFrames = 0;
  for (let step = 1; step <= 200; step++) {
    control.advance(50); treatment.advance(50);
    expect(safety(control) + safety(treatment)).toBe(0);
    expect(control.agents.map(a => a.id)).toEqual(initialIds);
    expect(treatment.agents.map(a => a.id)).toEqual(initialIds);
    const a = treatment.agents.find(a => a.id === aId)!, b = treatment.agents.find(a => a.id === bId)!;
    const poses = [stablePose(a), stablePose(b)];
    if (step === 100) tailBaseline = poses;
    if (step > 100 && a.yieldReason === 'BODY' && b.yieldReason === 'RESERVATION'
      && JSON.stringify(poses) === JSON.stringify(tailBaseline)) stuckTailFrames++;
  }
  for (const actor of control.agents) expect(actor.steps).toBeGreaterThan(starts.get(actor.id)!);
  expect(control.agents.find(a => a.id === bId)!.yieldReason).toBe('NONE');
  expect(stuckTailFrames, 'Пять секунд неподвижного BODY/RESERVATION после retarget').toBeLessThan(100);
  for (const actor of treatment.agents) expect(actor.steps).toBeGreaterThan(starts.get(actor.id)!);
  expect(control.metrics.networkBuilds).toBe(1); expect(treatment.metrics.networkBuilds).toBe(1);
});

it('повторное назначение к уже допущенному выходу не объявляет прибытие до физического прохода', () => {
  const { treatment: city, aId, aVisit } = pairedWitness();
  const before = city.agents.find(a => a.id === aId)!;
  expect(city.dispatchVisit(aVisit, [oldExit], 1, 500, false, [aId])).toEqual([aId]);
  expect(pose(city.agents.find(a => a.id === aId)!)).toEqual(pose(before));
  expect(city.agents.find(a => a.id === aId)!.visit?.arrived).toBe(false);
  let arrived = false;
  for (let step = 0; step < 120 && !arrived; step++) {
    city.advance(50); const actor = city.agents.find(a => a.id === aId)!;
    arrived = !!actor.visit?.arrived;
    if (key(actor.current) !== key(oldExit)) expect(arrived).toBe(false);
    expect(safety(city)).toBe(0);
  }
  expect(arrived).toBe(true); expect(city.agents.find(a => a.id === aId)!.current).toEqual(oldExit);
});

it('закрытый допущенный выход не заменяется вслепую другим и отказ сохраняет прежнее движение', () => {
  const { control, treatment, aId, aVisit } = pairedWitness();
  control.setWalkClosures(new Set([key(oldExit)])); treatment.setWalkClosures(new Set([key(oldExit)]));
  const before = treatment.agents;
  expect(treatment.dispatchVisit(aVisit, [newExit], 1, 500, false, [aId])).toEqual([]);
  expect(treatment.agents).toEqual(before);
  control.advance(250); treatment.advance(250);
  expect(treatment.agents).toEqual(control.agents); expect(treatment.metrics).toEqual(control.metrics);
  expect(safety(treatment)).toBe(0);
});

it('недостижимая новая цель оставляет допущенный проход и посещение без изменений', () => {
  const { control, treatment, aId, aVisit } = pairedWitness();
  const closures = new Set(['-3,3', '-2,4']), target = { x: -3, y: 4 };
  control.setWalkClosures(closures); treatment.setWalkClosures(closures);
  expect(treatment.visitTargets.has(key(target))).toBe(true);
  const before = treatment.agents;
  expect(treatment.dispatchVisit(aVisit, [target], 1, 500, false, [aId])).toEqual([]);
  expect(treatment.agents).toEqual(before);
  control.advance(250); treatment.advance(250);
  expect(treatment.agents).toEqual(control.agents); expect(safety(treatment)).toBe(0);
});

it('временной бюджет включает весь сохранённый проход и будущий обход', () => {
  const { control, treatment, aId, aVisit } = pairedWitness();
  const before = treatment.agents;
  // The old shortcut to the opposite curb is under eight seconds; completing
  // the admitted exit and its real onward loop cannot fit that budget.
  expect((5 - before.find(a => a.id === aId)!.progress) / before.find(a => a.id === aId)!.speed).toBeLessThan(8000);
  expect(treatment.dispatchVisit(aVisit, [newExit], 1, 500, false, [aId], 8000)).toEqual([]);
  expect(treatment.agents).toEqual(before);
  control.advance(250); treatment.advance(250);
  expect(treatment.agents).toEqual(control.agents); expect(safety(treatment)).toBe(0);
});

it('назначение вне конфликтной зоны сохраняет физический сегмент и обычный подход', () => {
  const { control: city, aId, network } = pairedWitness();
  for (let step = 0; step < 200; step++) city.advance(50);
  const before = city.agents.find(a => a.id === aId)!;
  expect(network.zoneByCell.has(key(before.current)) || network.zoneByCell.has(key(before.next))).toBe(false);
  expect(before.progress).toBeGreaterThan(0);
  expect(city.dispatchVisit('outside', [upperGuide], 1, 500, false, [aId])).toEqual([aId]);
  expect(pose(city.agents.find(a => a.id === aId)!)).toEqual(pose(before));
  city.advance(250); expect(safety(city)).toBe(0);
  expect(city.agents.find(a => a.id === aId)!.progress).not.toBe(before.progress);
});

it('остановка внутри занятой зоны не выдаёт короткий новый маршрут за прибытие', () => {
  const { treatment: city, aId, aVisit, zone } = pairedWitness();
  // A real public closure truncates only the future route. The committed
  // edge finishes inside the still-owned zone, with an actual zero progress.
  city.setWalkClosures(new Set(['0,0']));
  for (let step = 0; step < 30 && key(city.agents.find(a => a.id === aId)!.current) !== '0,-1'; step++) city.advance(50);
  const before = city.agents.find(a => a.id === aId)!;
  expect(before.current).toEqual({ x: 0, y: -1 }); expect(before.next).toEqual(before.current); expect(before.progress).toBe(0);
  expect(zone.cells.has(key(before.current))).toBe(true); expect(before.visit?.arrived).toBe(false);
  expect(city.signals.find(signal => signal.id === zone.id)!.pedestrians).toBe('GREEN');
  city.setWalkClosures(new Set());
  expect(city.dispatchVisit(aVisit, [oldExit], 1, 500, false, [aId])).toEqual([]);
  expect(pose(city.agents.find(a => a.id === aId)!)).toEqual(pose(before));
  expect(city.agents.find(a => a.id === aId)!.visit?.arrived).toBe(false);
  let arrived = false;
  for (let step = 0; step < 120 && !arrived; step++) { city.advance(50); arrived = !!city.agents.find(a => a.id === aId)!.visit?.arrived; expect(safety(city)).toBe(0); }
  expect(arrived).toBe(true); expect(city.agents.find(a => a.id === aId)!.current).toEqual(oldExit);
});

it('лимит 48 клеток включает уже начатый физический сегмент', () => {
  const cells = Array.from({ length: 128 }, (_, x) => ({ x, y: 0 }));
  const city = createCityMobility({ roads: new Map(), walkGraph: new Map(cells.map(cell => [key(cell), cell])),
    crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(['0,0', '127,0']), seed: 19, carLimit: 0, walkerLimit: 2 });
  city.advance(250);
  const adult = city.agents.find(a => a.age === 'ADULT')!, direction = adult.next.x - adult.current.x;
  const target = { x: adult.next.x + direction * 47, y: 0 }, before = city.agents;
  expect(adult.progress).toBeGreaterThan(0); expect(Math.abs(direction)).toBe(1);
  expect(city.visitTargets.has(key(target))).toBe(true);
  expect(city.dispatchVisit('full-route-limit', [target], 1, 500, false, [adult.id])).toEqual([]);
  expect(city.agents).toEqual(before);
});
