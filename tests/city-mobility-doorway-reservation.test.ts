import { expect, it } from 'vitest';
import { createCityMobility, type CityMobility, type CityMobilityAgent } from '../src/client/city-mobility';
import { buildMobilityNetwork } from '../src/client/city-mobility-network';
import type { Cell } from '../src/shared/contracts';

// Реальные жители и публичные назначения; без подмены маршрутов, поз или разрешений.
const key = (cell: Cell) => `${cell.x},${cell.y}`;
const pose = (actor: CityMobilityAgent) => ({ current: actor.current, next: actor.next,
  progress: actor.progress, position: actor.position, direction: actor.direction });
const stablePose = (actor: CityMobilityAgent) => ({ ...pose(actor), steps: actor.steps });
function precondition(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(`PRECONDITION_NOT_ESTABLISHED: ${detail}`);
}

it.each([{ name: 'встречное движение', turn: false }, { name: 'поперечный поворот', turn: true }])(
  'выход из здания ждёт занятую зону: $name', ({ turn }) => {
  const cells: Cell[] = [];
  for (let i = 0; i <= 12; i++) cells.push({ x: i, y: 0 }, { x: i, y: 12 }, { x: 0, y: i }, { x: 12, y: i });
  // Маленькая настоящая петля связывает corner и два branch в одну зону.
  cells.push({ x: -1, y: 1 }, { x: -1, y: 2 });
  if (turn) cells.push({ x: 1, y: -1 }, { x: 2, y: -1 });
  const door = { x: 0, y: 0 };
  const input = { roads: new Map(), walkGraph: new Map(cells.map(cell => [key(cell), cell])),
    crosswalks: new Set<string>(), activityCells: new Set<string>(), buildingEntrances: new Set([key(door)]),
    seed: 19, carLimit: 0, walkerLimit: 2 };
  const zone = buildMobilityNetwork(input).zoneByCell.get(key(door));
  precondition(zone, 'canonical door должен находиться в конфликтной зоне');
  precondition(['0,0', '0,1', '0,2'].every(cell => zone.cells.has(cell)), 'door и оба branch должны составлять одну многоклеточную зону');
  expect(zone.cells.has('1,0')).toBe(turn);
  if (turn) expect(zone.cells.has('2,0')).toBe(true);
  const control = createCityMobility(input), treatment = createCityMobility(input);
  expect(treatment.agents).toEqual(control.agents);
  precondition(control.agents.length === 2, 'должны появиться ровно два настоящих жителя');
  const bId = control.agents[0]!.id, aId = control.agents[1]!.id;
  const initialIds = control.agents.map(actor => actor.id);
  const bVisit = 'inside-holder', aVisit = 'incoming-door', aGuide = 'incoming-guide';
  const actor = (city: CityMobility, id: string) => city.agents.find(candidate => candidate.id === id)!;
  const paired = (operation: (city: CityMobility) => unknown) => {
    expect(operation(treatment)).toEqual(operation(control));
    expect(treatment.agents).toEqual(control.agents);
  };
  // Посетитель сначала действительно доходит до безопасного подхода.
  paired(city => {
    const ids = city.dispatchVisit(aGuide, [turn ? { x: 3, y: 0 } : { x: 0, y: 4 }], 1, 30_000, false, [aId]);
    precondition(ids[0] === aId, 'A должен принять безопасный подход'); return ids;
  });
  // Public stayMs ограничен 30 секундами; 60000 не продлил бы удержание.
  paired(city => {
    const ids = city.dispatchVisit(bVisit, [door], 1, 30_000, true, [bId]);
    precondition(ids[0] === bId, 'B должен принять настоящий indoor visit'); return ids;
  });
  let insideAt = -1, guideReady = false, assignedA = false, established = false, setupSteps = 0;
  for (; setupSteps < 1000; setupSteps++) {
    const b = actor(control, bId), a = actor(control, aId);
    if (insideAt < 0 && b.activity === 'INSIDE' && b.visit?.id === bVisit && b.visit.arrived) insideAt = setupSteps;
    if (insideAt >= 0 && !guideReady && a.visit?.id === aGuide && a.visit.arrived) {
      // Оба посетителя готовы к встрече у двери.
      if (!turn) paired(city => city.setWalkClosures(new Set(['1,0'])));
      guideReady = true;
    }
    if (insideAt >= 0 && guideReady && !assignedA && a.visit?.id === aGuide && a.visit.arrived) {
      paired(city => {
        city.clearVisits(aGuide);
        const ids = city.dispatchVisit(aVisit, [door], 1, 9500, true, [aId]);
        precondition(ids[0] === aId, 'A должен принять indoor visit после настоящего входа B'); return ids;
      });
      assignedA = true;
    }
    const incoming = actor(control, aId);
    const green = control.signals.find(signal => signal.id === zone.id)?.pedestrians === 'GREEN';
    // B ещё скрыт; других жителей нет. Поэтому этот GREEN принадлежит A.
    // Не меньше 10 секунд public hold остаётся нетронутому парному контролю.
    if (assignedA && setupSteps - insideAt <= 398 && b.activity === 'INSIDE'
      && b.visit?.id === bVisit && b.visit.arrived && green
      && incoming.visit?.id === aVisit && !incoming.visit.arrived
      && incoming.progress > 0 && incoming.progress < .25
      && key(incoming.current) === (turn ? '1,0' : '0,3')
      && key(incoming.next) === (turn ? '0,0' : '0,2')) {
      established = true; break;
    }
    paired(city => city.advance(50));
  }
  precondition(established, `B INSIDE / A owned GREEN до прибытия не достигнуты за ${setupSteps * 50}мс`);
  // Закрываем уже пройденную клетку A: его физический сегмент 1,0→0,0 сохранён.
  // Теперь B может выйти только на юг, поперёк входящего A.
  if (turn) paired(city => city.setWalkClosures(new Set(['1,0'])));
  const beforeClear = [actor(treatment, aId), actor(treatment, bId)].map(stablePose);
  treatment.clearVisits(bVisit);
  expect([actor(treatment, aId), actor(treatment, bId)].map(stablePose)).toEqual(beforeClear);
  expect(actor(treatment, bId).activity).toBe('INSIDE');
  expect(actor(treatment, bId).visit).toBeUndefined();

  let controlArrived = false, exitedBeforeArrival = false;
  let firstExit: CityMobilityAgent[] | undefined, tail: unknown, stoppedTailFrames = 0;
  for (let step = 1; step <= 200; step++) {
    control.advance(50); treatment.advance(50);
    for (const city of [control, treatment]) {
      expect(city.agents.map(resident => resident.id)).toEqual(initialIds);
      expect(city.metrics.networkBuilds).toBe(1);
      expect(city.metrics.vehicleUnsafeTotal + city.metrics.pedestrianUnsafeTotal
        + city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
    }
    const a = actor(treatment, aId), b = actor(treatment, bId);
    controlArrived ||= actor(control, aId).visit?.id === aVisit && !!actor(control, aId).visit?.arrived;
    if (!exitedBeforeArrival && b.activity !== 'INSIDE' && key(b.current) === key(door)
      && zone.cells.has(key(b.next)) && a.visit?.id === aVisit && !a.visit.arrived) {
      exitedBeforeArrival = true; firstExit = [a, b];
    }
    const poses = [stablePose(a), stablePose(b)];
    if (step === 100) tail = poses;
    if (step > 100 && a.yieldReason === 'BODY' && b.yieldReason === 'RESERVATION'
      && JSON.stringify(poses) === JSON.stringify(tail)) stoppedTailFrames++;
  }
  expect(controlArrived, 'В нетронутом парном контроле A действительно дошёл до входа').toBe(true);
  expect(actor(control, bId).activity, 'Control B продолжает исходное удержание внутри').toBe('INSIDE');
  const diagnostic = { aId, bId, zone: zone.id, zoneCells: [...zone.cells], setupMs: setupSteps * 50,
    observationMs: 10_000, firstExit, final: [actor(treatment, aId), actor(treatment, bId)] };
  expect(exitedBeforeArrival, `PUBLIC_RESERVED_DOOR_EXIT: ${JSON.stringify(diagnostic)}`).toBe(false);
  expect(actor(treatment, aId).visit?.arrived, 'A должен действительно пройти через вход').toBe(true);
  expect(actor(treatment, bId).steps, 'B продолжает движение после освобождения прохода').toBeGreaterThan(beforeClear[1]!.steps);
  expect(stoppedTailFrames, `PUBLIC_BODY_RESERVATION_WITNESS: ${JSON.stringify(diagnostic)}`).toBeLessThan(100);
});
