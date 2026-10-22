import { expect, it } from 'vitest';
import { advanceCityMobilityFrame, createCityMobility } from '../src/client/city-mobility';
import { createTaskActivityController } from '../src/client/task-activity-feedback';
import type { Cell } from '../src/shared/contracts';

const now = Date.parse('2026-10-13T15:00:00Z');
function fixture() {
  const walk = new Map<string, Cell>();
  for (let i = 0; i <= 12; i++) for (const c of [{ x: i, y: 0 }, { x: i, y: 12 }, { x: 0, y: i }, { x: 12, y: i }]) walk.set(`${c.x},${c.y}`, c);
  const task = { id: 'home', stage: 5, accessPath: [{ x: 3, y: 0 }] };
  const city = createCityMobility({ roads: new Map(), walkGraph: walk, crosswalks: new Set(), activityCells: new Set(),
    buildingEntrances: new Set(['3,0']), seed: 19, carLimit: 0, walkerLimit: 6 });
  const controller = createTaskActivityController(() => city);
  const event = { id: 1, worldVersion: 3, type: 'task.comment_added', taskId: task.id, createdAt: new Date(now).toISOString() };
  const options = { enabled: true, reducedMotion: false, economy: false };
  return { task, city, controller, event, options, tasks: new Map([[task.id, task]]) };
}

it('новый комментарий доставляют существующие жители по настоящему подходу, знак обсуждения появляется после прибытия', () => {
  const f = fixture(), residents = new Set(f.city.agents.map(a => a.id));
  expect(f.controller.begin(f.event, f.task, now, f.options)).toBe(true);
  expect(f.controller.update(now, f.tasks, f.options)[0]).toMatchObject({ taskId: 'home', kind: 'COMMENT', anchor: { x: 3, y: 0 } });
  let delivered = false;
  for (let elapsed = 50; elapsed <= 40_000; elapsed += 50) {
    f.city.advance(50);
    const pose = f.controller.update(now + elapsed, f.tasks, f.options)[0];
    if (pose?.phase === 'DISCUSS') { expect(pose.arrived).toBeGreaterThan(0); delivered = true; }
    expect(f.city.agents.every(a => residents.has(a.id))).toBe(true);
  }
  expect(delivered).toBe(true);
  expect(f.controller.metrics.delivered).toBe(1);
  expect(f.city.agents.some(a => a.visit)).toBe(false);
  expect(f.city.metrics.pedestrianUnsafeTotal).toBe(0);
});

it('доставка комментария успевает до прежнего срока 32с при реальных кадрах по 200мс', () => {
  const cells = Array.from({ length: 64 }, (_, x) => ({ x, y: 0 }));
  const city = createCityMobility({ roads: new Map(), walkGraph: new Map(cells.map(cell => [`${cell.x},${cell.y}`, cell])),
    crosswalks: new Set(), activityCells: new Set(), buildingEntrances: new Set(['0,0', '63,0']),
    seed: 19, carLimit: 0, walkerLimit: 2 });
  const adults = city.agents.filter(agent => agent.kind === 'WALKER' && agent.age === 'ADULT');
  expect(city.agents).toHaveLength(2); expect(adults).toHaveLength(1);
  const adult = adults[0]!, target = { x: adult.current.x + (adult.current.x <= 47 ? 16 : -16), y: 0 };
  expect(Math.abs(target.x - adult.current.x)).toBe(16);
  expect(city.visitTargets.has(`${target.x},${target.y}`)).toBe(true);
  const task = { id: 'long-comment-approach', stage: 5, accessPath: [target] }, tasks = new Map([[task.id, task]]);
  const controller = createTaskActivityController(() => city), options = { enabled: true, reducedMotion: false, economy: false };
  const residents = city.agents.map(agent => agent.id);
  expect(controller.begin({ id: 1, worldVersion: 3, type: 'task.comment_added', taskId: task.id,
    createdAt: new Date(now).toISOString() }, task, now, options)).toBe(true);
  expect(city.agents.filter(agent => agent.visit).map(agent => agent.id)).toEqual([adult.id]);
  expect(controller.update(now, tasks, options)[0]).toMatchObject({ phase: 'DELIVER', expiresAt: now + 32_000 });
  let discussed = false;
  for (let wall = 200; wall <= 32_000; wall += 200) {
    advanceCityMobilityFrame(city, 200);
    const pose = controller.update(now + wall, tasks, options)[0];
    if (pose?.phase === 'DISCUSS') { expect(pose.arrived).toBeGreaterThan(0); discussed = true; }
    expect(city.agents.map(agent => agent.id)).toEqual(residents);
    expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
  }
  expect(discussed, 'Fresh delivery must arrive before its unchanged wall-clock TTL').toBe(true);
  expect(controller.metrics.delivered).toBe(1);
});

it('один очень долгий кадр выполняет не более пяти обычных физических шагов', () => {
  const { city } = fixture(), residents = city.agents.map(agent => agent.id), before = city.metrics.fixedSteps;
  advanceCityMobilityFrame(city, 10_000);
  const steps = city.metrics.fixedSteps - before;
  expect(steps).toBeGreaterThan(0); expect(steps).toBeLessThanOrEqual(5);
  expect(city.agents.map(agent => agent.id)).toEqual(residents);
  expect(city.metrics.pedestrianUnsafeTotal).toBe(0);
});

it('повторы и старый replay не доставляют письмо заново, серия комментариев объединяется без новых жителей', () => {
  const f = fixture();
  expect(f.controller.begin({ ...f.event, createdAt: new Date(now - 60_000).toISOString() }, f.task, now, f.options)).toBe(false);
  expect(f.controller.begin({ ...f.event, id: 2 }, f.task, now, f.options)).toBe(true);
  const visitors = f.city.agents.filter(a => a.visit).map(a => a.id);
  for (let id = 3; id <= 503; id++) expect(f.controller.begin({ ...f.event, id }, f.task, now, f.options)).toBe(true);
  expect(f.controller.begin({ ...f.event, id: 503 }, f.task, now, f.options)).toBe(false);
  expect(f.controller.metrics).toMatchObject({ started: 1, merged: 501 });
  expect(f.controller.update(now, f.tasks, f.options)).toHaveLength(1);
  expect(f.city.agents.filter(a => a.visit).map(a => a.id)).toEqual(visitors);
  expect(f.controller.update(now + 33_000, f.tasks, f.options)).toHaveLength(0);
  expect(f.city.agents.some(a => a.visit)).toBe(false);
});

it('поле и прогресс получают документ, смена стадии остаётся строительной сценой', () => {
  const f = fixture();
  expect(f.controller.begin({ ...f.event, type: 'task.status_changed', stage: 4 }, f.task, now, f.options)).toBe(false);
  expect(f.controller.begin({ ...f.event, id: 2, type: 'task.fields_updated' }, f.task, now, f.options)).toBe(true);
  expect(f.controller.update(now, f.tasks, f.options)[0]?.kind).toBe('UPDATE');
  expect(f.controller.begin({ ...f.event, id: 3, type: 'task.status_changed', stage: 5 }, f.task, now, f.options)).toBe(true);
  f.controller.cancel('home'); expect(f.city.agents.some(a => a.visit)).toBe(false);
  expect(f.controller.update(now, f.tasks, f.options)).toHaveLength(0);
});

it('ограничивает реакцию четырьмя объектами, двумя в ECONOMY и освобождает посещения при смене входа/выключении', () => {
  const f = fixture();
  const tasks = new Map(Array.from({ length: 40 }, (_, id) => [String(id), { ...f.task, id: String(id) }]));
  for (let id = 1; id <= 40; id++) { const task = tasks.get(String(id - 1))!; f.controller.begin({ ...f.event, id, taskId: task.id }, task, now, f.options); }
  expect(f.controller.update(now, tasks, f.options)).toHaveLength(4);
  expect(f.controller.update(now, tasks, { ...f.options, economy: true })).toHaveLength(2);
  for (const [id, task] of tasks) tasks.set(id, { ...task, accessPath: [{ x: 9, y: 0 }] });
  expect(f.controller.update(now, tasks, f.options)).toHaveLength(0);
  expect(f.city.agents.some(a => a.visit)).toBe(false);
  f.controller.begin({ ...f.event, id: 50 }, f.task, now, f.options);
  expect(f.controller.update(now, f.tasks, { ...f.options, enabled: false })).toHaveLength(0);
  expect(f.city.agents.some(a => a.visit)).toBe(false);
});

it('reduced motion показывает ограниченный статический сигнал без движения и не переигрывает выключенные события', () => {
  const f = fixture(), options = { ...f.options, reducedMotion: true };
  expect(f.controller.begin(f.event, f.task, now, { ...options, enabled: false })).toBe(false);
  expect(f.controller.begin(f.event, f.task, now, options)).toBe(false);
  expect(f.controller.begin({ ...f.event, id: 2 }, f.task, now, options)).toBe(true);
  expect(f.controller.update(now, f.tasks, options)[0]).toMatchObject({ static: true, visitors: [], phase: 'SIGNAL' });
  expect(f.city.agents.some(a => a.visit)).toBe(false);
  expect(f.controller.update(now + 4001, f.tasks, options)).toHaveLength(0);
});

it('включение reduced motion во время доставки освобождает жителей и оставляет краткий неподвижный знак',()=>{
  const f=fixture();f.controller.begin(f.event,f.task,now,f.options);
  expect(f.city.agents.some(a=>a.visit)).toBe(true);
  const options={...f.options,reducedMotion:true};
  expect(f.controller.update(now+1000,f.tasks,options)[0]).toMatchObject({static:true});
  expect(f.city.agents.some(a=>a.visit)).toBe(false);
  expect(f.controller.update(now+5001,f.tasks,options)).toHaveLength(0);
});

it('свежий комментарий после истечения срока начинает новую доставку даже до следующего кадра',()=>{
  const f=fixture();f.controller.begin(f.event,f.task,now,f.options);
  const later=now+33_000;
  expect(f.controller.begin({...f.event,id:2,createdAt:new Date(later).toISOString()},f.task,later,f.options)).toBe(true);
  expect(f.controller.update(later,f.tasks,f.options)).toHaveLength(1);
  expect(f.controller.metrics).toMatchObject({started:2,merged:0});
});
