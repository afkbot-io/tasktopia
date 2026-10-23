import { expect, it } from 'vitest';
import { createCityMobility, type CityMobilityInput } from '../src/client/city-mobility';
import type { Cell } from '../src/shared/contracts';

const key = (cell: Cell) => `${cell.x},${cell.y}`;
function lineInput(): CityMobilityInput {
  const cells = Array.from({ length: 128 }, (_, x) => ({ x, y: 0 }));
  return { roads: new Map(), walkGraph: new Map(cells.map(cell => [key(cell), cell])),
    crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(['0,0', '127,0']),
    seed: 19, carLimit: 0, walkerLimit: 2 };
}
function fixture() {
  const city = createCityMobility(lineInput()), adults = city.agents.filter(agent => agent.age === 'ADULT');
  expect(city.agents).toHaveLength(2); expect(adults).toHaveLength(1);
  return { city, adult: adults[0]! };
}

it('короткий подход в пределах бюджета назначается существующему жителю без изменения позы', () => {
  const { city, adult } = fixture(), target = { x: adult.current.x + 4, y: 0 }, before = city.agents;
  expect(4 / adult.speed).toBeLessThan(8000);
  expect(city.dispatchVisit('short', [target], 1, 5000, false, [adult.id], 8000)).toEqual([adult.id]);
  expect(city.agents.map(agent => agent.id)).toEqual(before.map(agent => agent.id));
  expect(city.agents.map(agent => agent.position)).toEqual(before.map(agent => agent.position));
  expect(city.agents.find(agent => agent.id === adult.id)?.visit).toEqual({ id: 'short', arrived: false });
});

it('отклонённый по времени подход сохраняет жителей, позы и продолжение прежнего маршрута', () => {
  const { city, adult } = fixture(), control = createCityMobility(lineInput()), before = city.agents;
  const target = { x: adult.current.x + 16, y: 0 };
  expect(16 / adult.speed).toBeGreaterThan(5000);
  expect(city.dispatchVisit('too-far', [target], 1, 5000, false, [adult.id], 5000)).toEqual([]);
  expect(city.agents).toEqual(before);
  city.advance(250); control.advance(250);
  expect(city.agents).toEqual(control.agents);
  expect(city.metrics).toEqual(control.metrics);
});

it('бюджет учитывает настоящий обход, даже когда цель близка по прямой', () => {
  const cells = new Map<string, Cell>();
  for (let y = 0; y <= 20; y++) for (const x of [0, 4]) cells.set(`${x},${y}`, { x, y });
  for (let x = 1; x < 4; x++) cells.set(`${x},20`, { x, y: 20 });
  const city = createCityMobility({ roads: new Map(), walkGraph: cells, crosswalks: new Set(), activityCells: new Set(),
    buildingEntrances: new Set(['0,0', '4,0']), seed: 19, carLimit: 0, walkerLimit: 2 });
  const adult = city.agents.find(agent => agent.age === 'ADULT')!;
  expect(adult).toBeTruthy(); expect([0, 4]).toContain(adult.current.x); expect(adult.current.y).toBeLessThan(20);
  const target = { x: adult.current.x === 0 ? 4 : 0, y: adult.current.y }, budget = 5 / adult.speed;
  const routeDistance = 2 * (20 - adult.current.y) + 4, before = city.agents;
  expect(city.visitTargets.has(key(target))).toBe(true);
  expect(Math.abs(target.x - adult.current.x) / adult.speed).toBeLessThan(budget);
  expect(routeDistance).toBeLessThan(48); expect(routeDistance / adult.speed).toBeGreaterThan(budget);
  expect(city.dispatchVisit('detour', [target], 1, 5000, false, [adult.id], budget)).toEqual([]);
  expect(city.agents).toEqual(before);
  // Without the presentation budget this same valid graph route is admitted.
  expect(city.dispatchVisit('ordinary-detour', [target], 1, 5000, false, [adult.id])).toEqual([adult.id]);
});

it('бюджет включает остаток уже начатого физического сегмента', () => {
  const { city, adult } = fixture(); city.advance(250);
  const moving = city.agents.find(agent => agent.id === adult.id)!;
  expect(moving.progress).toBeGreaterThan(0); expect(moving.progress).toBeLessThan(1);
  const direction = moving.next.x - moving.current.x, target = { x: moving.next.x + direction * 2, y: 0 };
  expect(Math.abs(direction)).toBe(1); expect(city.visitTargets.has(key(target))).toBe(true);
  const budget = (2 + (1 - moving.progress) / 2) / moving.speed, before = city.agents;
  expect(2 / moving.speed).toBeLessThan(budget);
  expect((3 - moving.progress) / moving.speed).toBeGreaterThan(budget);
  expect(city.dispatchVisit('mid-edge', [target], 1, 5000, false, [adult.id], budget)).toEqual([]);
  expect(city.agents).toEqual(before);
});

it('старые вызовы без бюджета сохраняют допустимый подход до 48 клеток', () => {
  const { city, adult } = fixture(), target = { x: adult.current.x + 46, y: 0 };
  expect(46 / adult.speed).toBeGreaterThan(32_000);
  expect(city.dispatchVisit('ordinary', [target], 1, 5000, false, [adult.id])).toEqual([adult.id]);
});

it.each([0, -1, Number.NaN, -Infinity])('некорректный бюджет %s не изменяет движение', budget => {
  const { city, adult } = fixture(), before = city.agents;
  expect(city.dispatchVisit('invalid-budget', [{ x: adult.current.x + 1, y: 0 }], 1, 5000, false, [adult.id], budget)).toEqual([]);
  expect(city.agents).toEqual(before);
});
