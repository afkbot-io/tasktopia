import { expect, it } from 'vitest';
import { createCityMobility, type CityMobility, type CityMobilityAgent } from '../src/client/city-mobility';
import type { Cell } from '../src/shared/contracts';

// Один фиксированный seed и естественное появление; без подмены маршрутов/поз/скоростей.
const key = (cell: Cell) => `${cell.x},${cell.y}`;
function precondition(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(`PRECONDITION_NOT_ESTABLISHED: ${detail}`);
}
function fixture() {
  const cells = new Map<string, Cell>();
  for (let y = 0; y <= 12; y++) for (const x of [0, 4]) cells.set(`${x},${y}`, { x, y });
  for (let x = 1; x < 4; x++) cells.set(`${x},12`, { x, y: 12 });
  return createCityMobility({ roads: new Map(), walkGraph: cells, crosswalks: new Set<string>(),
    activityCells: new Set<string>(), buildingEntrances: new Set(['0,0', '4,0']),
    seed: 19, carLimit: 0, walkerLimit: 2 });
}
const resident = (city: CityMobility, id: string) => city.agents.find(actor => actor.id === id)!;
const physicalPose = (actor: CityMobilityAgent) => ({ current: actor.current, next: actor.next,
  progress: actor.progress, position: actor.position, direction: actor.direction, steps: actor.steps });

it('выбирает раньше прибывающего жителя по настоящему обходу, когда Manhattan ближе к более долгому пути', () => {
  const city = fixture(), initial = city.agents, target = { x: 4, y: 0 };
  precondition(initial.length === 2, 'должны естественно появиться ровно два жителя');
  const near = initial[0]!, fast = initial[1]!, ids = initial.map(actor => actor.id);
  precondition(key(near.current) === '0,0' && key(fast.current) === '0,8',
    `фиксированное естественное появление изменилось: ${JSON.stringify(initial.map(actor => ({ id: actor.id, current: actor.current })))}`);
  expect(initial.every(actor => actor.progress === 0)).toBe(true);
  expect(city.visitTargets.has(key(target))).toBe(true);
  const manhattan = (actor: CityMobilityAgent) => Math.abs(actor.next.x - target.x) + Math.abs(actor.next.y - target.y);
  precondition(manhattan(near) < manhattan(fast), 'старый Manhattan порядок должен сначала рассматривать более долгий обход');
  // Единственная связь ветвей проходит через y12: длины известны из самой U-геометрии.
  const nearDistance = 12 + 4 + 12, fastDistance = 4 + 4 + 12;
  expect(nearDistance / near.speed).toBeLessThan(24_000);
  expect(fastDistance / fast.speed).toBeLessThan(nearDistance / near.speed);

  const controls = [near, fast].map(actor => {
    const control = fixture(); expect(control.agents).toEqual(initial);
    const visitId = `individual-control:${actor.id}`;
    precondition(control.dispatchVisit(visitId, [target], 1, 30_000, false, [actor.id], 24_000)[0] === actor.id,
      'каждый реальный кандидат должен независимо принимать этот путь в исходном24s бюджете');
    return { city: control, actorId: actor.id, visitId, arrivedAt: undefined as number | undefined };
  });
  for (let elapsed = 50; elapsed <= 30_000; elapsed += 50) {
    for (const control of controls) {
      control.city.advance(50);
      expect(control.city.agents.map(actor => actor.id)).toEqual(ids);
      expect(control.city.metrics.networkBuilds).toBe(1);
      expect(control.city.metrics.vehicleUnsafeTotal + control.city.metrics.pedestrianUnsafeTotal
        + control.city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
      if (control.arrivedAt === undefined && resident(control.city, control.actorId).visit?.id === control.visitId
        && resident(control.city, control.actorId).visit?.arrived) control.arrivedAt = elapsed;
    }
    if (controls.every(control => control.arrivedAt !== undefined)) break;
  }
  precondition(controls.every(control => control.arrivedAt !== undefined), 'оба парных контроля должны действительно прибыть за30s физики');
  precondition(controls[1]!.arrivedAt! < controls[0]!.arrivedAt!,
    `ожидаемый фактический порядок прибытия не установлен: ${JSON.stringify(controls.map(control => ({ id: control.actorId, arrivedAt: control.arrivedAt })))}`);

  const before = city.agents;
  // Это продуктовый критерий RED: quota1 не должна заняться медленным обходом при доступном быстром.
  expect(city.dispatchVisit('free-choice', [target], 1, 5000, false, undefined, 24_000)).toEqual([fast.id]);
  expect(city.agents.map(actor => actor.id)).toEqual(ids);
  expect(city.agents.map(physicalPose)).toEqual(before.map(physicalPose));
  expect(resident(city, near.id)).toEqual(near);
  expect(resident(city, fast.id).visit).toEqual({ id: 'free-choice', arrived: false });
});
