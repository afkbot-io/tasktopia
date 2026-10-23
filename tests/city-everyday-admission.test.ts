import { expect, it } from 'vitest';
import { createEverydayController } from '../src/client/city-everyday-controller';
import { everydayPose, type EverydayTask } from '../src/client/city-everyday-life';
import { createCityMobility, type CityMobilityInput } from '../src/client/city-mobility';
import type { Cell } from '../src/shared/contracts';

const key = (cell: Cell) => `${cell.x},${cell.y}`;

/** One naturally spawned child and one real isolated entrance. No traffic,
 * renderer clocks, actor hydration, route replacement or synthetic arrival. */
function kindergarten(distance: number) {
  const cells = Array.from({ length: 128 }, (_, x) => ({ x, y: 0 }));
  const walk = new Map(cells.map(cell => [key(cell), cell]));
  const target = { x: distance, y: 0 };
  const input: CityMobilityInput = { roads: new Map(), walkGraph: walk,
    crosswalks: new Set(), activityCells: new Set(),
    buildingEntrances: new Set(['0,0', '127,0', key(target)]),
    seed: 19, carLimit: 0, walkerLimit: 1 };
  const city = createCityMobility(input);
  expect(city.agents).toHaveLength(1);
  const child = city.agents[0]!;
  expect(child.age).toBe('CHILD');
  expect(child.current).toEqual({ x: 0, y: 0 });
  expect(child.progress).toBe(0);
  expect(city.visitTargets.has(key(target))).toBe(true);
  const task: EverydayTask = { id: 'isolated-kindergarten', status: 'COMPLETED', stage: 5,
    visualKind: 'BUILDING', visualAssetKey: 'compact-color-kindergarten-v1',
    accessPath: [target], footprint: [{ x: target.x, y: -1 }], workItemType: 'TASK' };
  const sounds: string[] = [];
  const controller = createEverydayController('admission-city', () => city, sound => sounds.push(sound));
  controller.compile({ tasks: [task], walk, roads: input.roads, blocked: new Set(), decorations: [] });
  expect(controller.sites).toHaveLength(1);
  expect(controller.kinds).toBe('KINDERGARTEN');
  const view = { minX: -5, minY: -5, maxX: 132, maxY: 5 };
  const options = { enabled: true, economy: false, busy: new Set<string>(), roadBusy: false };
  controller.update(7999, view, options);
  const episode = controller.planned!;
  expect(episode).toBeDefined();
  expect(episode.start).toBe(8000);
  expect(everydayPose(episode, episode.end - 10_001, view)?.phase).toBe('ACTIVITY');
  expect(everydayPose(episode, episode.end - 10_000, view)?.phase).toBe('LEAVE');
  return { city, input, child, target, sounds, controller, view, options, episode };
}

const safety = (city: ReturnType<typeof createCityMobility>) => city.metrics.vehicleUnsafeTotal
  + city.metrics.pedestrianUnsafeTotal + city.metrics.vehiclePedestrianUnsafeTotal;

// Independent public counterexamples to the director's admission boundary.
// Their fixed line/seed do not reproduce or attribute the historical CI city.
it.each([
  { distance: 47, lowerMs: 34_000, upperMs: 40_000, reason: 'самого LEAVE' },
  { distance: 36, lowerMs: 26_000, upperMs: 34_000, reason: 'LEAVE с восемью секундами очереди' },
])('не принимает подход $distance клеток, который не укладывается до $reason', ({ distance, lowerMs, upperMs }) => {
  const f = kindergarten(distance), before = f.city.agents;
  const freeFlowMs = distance / f.child.speed;
  expect(distance + 1).toBeLessThanOrEqual(48);
  expect(freeFlowMs).toBeGreaterThan(lowerMs);
  expect(freeFlowMs).toBeLessThan(upperMs);
  const admissionBudgetMs = f.episode.end - 10_000 - f.episode.start - 8000;
  expect(admissionBudgetMs).toBe(26_000);
  expect(freeFlowMs).toBeGreaterThan(admissionBudgetMs);

  const control = createCityMobility(f.input);
  expect(control.agents).toEqual(before);
  expect(control.dispatchVisit('free-flow-control', [f.target], 1, 9500, true, [f.child.id])).toEqual([f.child.id]);
  const accepted = f.controller.update(f.episode.start, f.view, f.options).visitors.map(actor => actor.id);
  expect(f.city.agents.map(actor => actor.position)).toEqual(before.map(actor => actor.position));
  let controlArrivalAt: number | undefined, maxArrivals = 0, firstEmptyAt: number | undefined;
  for (let elapsed = 50; elapsed <= 40_000; elapsed += 50) {
    control.advance(50); f.city.advance(50);
    const state = f.controller.update(f.episode.start + elapsed, f.view, f.options);
    if (control.agents[0]!.visit?.id === 'free-flow-control' && control.agents[0]!.visit?.arrived) controlArrivalAt ??= elapsed;
    maxArrivals = Math.max(maxArrivals, state.visitors.filter(actor => actor.visit?.arrived).length);
    if (!state.visitors.length) firstEmptyAt ??= elapsed;
    expect(f.city.agents.map(actor => actor.id)).toEqual([f.child.id]);
    expect(control.agents.map(actor => actor.id)).toEqual([f.child.id]);
    expect(safety(f.city)).toBe(0); expect(safety(control)).toBe(0);
  }
  // The control proves an actual reachable doorway with ordinary 50ms motion,
  // rather than mistaking a failed setup or blocked path for admission RED.
  expect(controlArrivalAt).toBeDefined();
  expect(controlArrivalAt!).toBeGreaterThan(lowerMs);
  expect(controlArrivalAt!).toBeLessThanOrEqual(upperMs + 50);
  const diagnostic = { distance, speed: f.child.speed, freeFlowMs, admissionBudgetMs,
    accepted, controlArrivalAt, maxArrivals, firstEmptyAt, sounds: f.sounds };
  expect(accepted, `PUBLIC_ADMISSION_COUNTEREXAMPLE: ${JSON.stringify(diagnostic)}`).toEqual([]);
});

it('близкий принятый ребёнок действительно входит и вызывает звонок через обычные физические шаги', () => {
  const f = kindergarten(4), before = f.city.agents;
  expect(4 / f.child.speed).toBeLessThan(8000);
  const first = f.controller.update(f.episode.start, f.view, f.options);
  expect(first.visitors.map(actor => actor.id)).toEqual([f.child.id]);
  expect(f.city.agents.map(actor => actor.position)).toEqual(before.map(actor => actor.position));
  let arrivedAt: number | undefined;
  for (let elapsed = 50; elapsed <= 8000 && arrivedAt === undefined; elapsed += 50) {
    f.city.advance(50);
    const state = f.controller.update(f.episode.start + elapsed, f.view, f.options);
    if (state.visitors.some(actor => actor.id === f.child.id && actor.visit?.arrived)) arrivedAt = elapsed;
    expect(safety(f.city)).toBe(0);
  }
  expect(arrivedAt).toBeDefined();
  expect(f.city.agents[0]!.current).toEqual(f.target);
  expect(f.city.agents[0]!.activity).toBe('INSIDE');
  expect(f.city.agents.map(actor => actor.id)).toEqual([f.child.id]);
  expect(f.sounds).toEqual(['bell']);
});
