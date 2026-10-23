import { expect, it } from 'vitest';
import { createCityMobility, type CityMobilityAgent } from '../src/client/city-mobility';
import { buildMobilityNetwork } from '../src/client/city-mobility-network';
import type { Cell } from '../src/shared/contracts';

// Только публичные назначения и фиксированные шаги; без подмены состояния жителей.
const key = (cell: Cell) => `${cell.x},${cell.y}`;
const pose = (actor: CityMobilityAgent) => ({ current: actor.current, next: actor.next,
  position: actor.position, progress: actor.progress, direction: actor.direction });
const stablePose = (actor: CityMobilityAgent) => ({ ...pose(actor), steps: actor.steps });

function fixture() {
  const cells: Cell[] = [];
  for (let i = 0; i <= 12; i++) cells.push({ x: i, y: 0 }, { x: i, y: 12 }, { x: 0, y: i }, { x: 12, y: i });
  const entrance = { x: 0, y: 0 };
  const input = { roads: new Map(), walkGraph: new Map(cells.map(cell => [key(cell), cell])),
    crosswalks: new Set<string>(), activityCells: new Set<string>(), buildingEntrances: new Set([key(entrance)]),
    seed: 19, carLimit: 0, walkerLimit: 1 };
  return { input, entrance };
}

it.each([{ label: 'до допуска', advanceMs: 0 }, { label: 'после начала движения', advanceMs: 50 }])(
  'отмена подхода к входу на повороте $label не оставляет жителя без допустимого выхода', ({ advanceMs }) => {
  const { input, entrance } = fixture(), network = buildMobilityNetwork(input);
  expect(network.zoneByCell.has(key(entrance)), 'Настоящий вход находится на конфликтном повороте').toBe(true);
  const control = createCityMobility(input), treatment = createCityMobility(input);
  expect(treatment.agents).toEqual(control.agents); expect(control.agents).toHaveLength(1);
  const actorId = control.agents[0]!.id;
  const visitId = 'school-before-leave';
  for (const city of [control, treatment]) {
    expect(city.dispatchVisit(visitId, [entrance], 1, 9500, true, [actorId])).toEqual([actorId]);
    city.advance(advanceMs);
    expect(city.agents[0]!.visit?.arrived, 'Отмена выполняется до настоящего прибытия').toBe(false);
  }
  if (advanceMs) expect(treatment.agents[0]!.progress).toBeGreaterThan(0);
  expect(treatment.agents).toEqual(control.agents);
  const beforeClear = treatment.agents[0]!;
  treatment.clearVisits(visitId);
  expect(treatment.agents[0]!.visit).toBeUndefined();
  expect(pose(treatment.agents[0]!)).toEqual(pose(beforeClear));

  let controlArrived = false, cancelledEntered = false;
  let tailStart: ReturnType<typeof stablePose> | undefined;
  let stationaryExitTailFrames = 0;
  let tailInitialSteps = -1;
  for (let step = 1; step <= 1200; step++) {
    control.advance(50); treatment.advance(50);
    for (const city of [control, treatment]) {
      expect(city.agents.map(actor => actor.id)).toEqual([actorId]);
      expect(city.metrics.vehicleUnsafeTotal + city.metrics.pedestrianUnsafeTotal
        + city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
      expect(city.metrics.networkBuilds).toBe(1);
    }
    const untreated = control.agents[0]!, cancelled = treatment.agents[0]!;
    if (untreated.visit?.id === visitId && untreated.visit.arrived) {
      expect(untreated.current).toEqual(entrance); controlArrived = true;
    }
    expect(cancelled.visit).toBeUndefined();
    if (cancelled.activity === 'INSIDE') {
      expect(cancelled.current).toEqual(entrance); cancelledEntered = true;
    }
    if (step === 1100) { tailStart = stablePose(cancelled); tailInitialSteps = cancelled.steps; }
    if (step > 1100 && cancelled.yieldReason === 'OCCUPIED_EXIT'
      && JSON.stringify(stablePose(cancelled)) === JSON.stringify(tailStart)) stationaryExitTailFrames++;
  }
  expect(controlArrived, 'Парный контроль действительно вошёл через заданный вход').toBe(true);
  expect(cancelledEntered, 'Физический подход завершается у существующей двери без восстановления посещения').toBe(true);
  expect(stationaryExitTailFrames, `Единственный житель не должен стоять у пустого поворота все последние 5 секунд: ${JSON.stringify(treatment.agents[0])}`).toBeLessThan(100);
  expect(treatment.agents[0]!.steps).toBeGreaterThan(beforeClear.steps);
  expect(treatment.agents[0]!.steps, 'После отмены сохраняется дальнейшее обычное движение').toBeGreaterThan(tailInitialSteps);
});

it.each([true, false])('удалённый из сети вход не допускает скрытого входа и сохраняет движение (отмена до обновления: %s)', cancelBeforeUpdate => {
  const { input, entrance } = fixture(), city = createCityMobility(input), id = city.agents[0]!.id;
  expect(city.dispatchVisit('removed-door', [entrance], 1, 9500, true, [id])).toEqual([id]);
  city.advance(50);
  if (cancelBeforeUpdate) city.clearVisits('removed-door');
  city.updateNetwork({ ...input, buildingEntrances: new Set<string>() });
  if (!cancelBeforeUpdate) city.clearVisits('removed-door');
  const before = city.agents[0]!.steps;
  for (let step = 0; step < 1200; step++) {
    city.advance(50);
    expect(city.agents.map(actor => actor.id)).toEqual([id]);
    expect(city.agents[0]!.activity).not.toBe('INSIDE');
    expect(city.agents[0]!.visit).toBeUndefined();
    expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
  }
  expect(city.agents[0]!.steps).toBeGreaterThan(before);
  expect(city.metrics.networkBuilds).toBe(2);
});

it('истечение подхода после удаления двери возвращает обычное движение без скрытого входа', () => {
  const { input, entrance } = fixture(), city = createCityMobility(input), id = city.agents[0]!.id;
  expect(city.dispatchVisit('expired-door', [entrance], 1, 9500, true, [id])).toEqual([id]);
  city.advance(50); city.updateNetwork({ ...input, buildingEntrances: new Set<string>() });
  let beforeExpirySteps = -1;
  for (let step = 0; step < 1400; step++) {
    city.advance(50);
    expect(city.agents.map(actor => actor.id)).toEqual([id]);
    expect(city.agents[0]!.activity).not.toBe('INSIDE');
    expect(city.agents[0]!.visit?.arrived).not.toBe(true);
    expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
    if (step === 1198) beforeExpirySteps = city.agents[0]!.steps;
  }
  expect(city.agents[0]!.visit).toBeUndefined();
  expect(city.agents[0]!.steps).toBeGreaterThan(beforeExpirySteps);
});
