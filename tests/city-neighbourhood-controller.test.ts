import { expect, it } from 'vitest';
import { CityEventDirector } from '../src/client/city-event-director';
import { createNeighbourhoodController } from '../src/client/city-neighbourhood-controller';
import type { CityLifeKind, CityLifePlan } from '../src/client/city-life';
import { cityTransitGrid } from './fixtures/city-transit-grid';
import { createCityMobility } from '../src/client/city-mobility';

const options = { enabled: true, economy: false, busy: new Set<string>() };
function fixture(kind: CityLifeKind = 'GARDEN') {
  const f = cityTransitGrid(24), director = new CityEventDirector(), start = 42_000;
  director.update(start, options);
  const route = Array.from({ length: 7 }, (_, i) => ({ x: 9 - i, y: -2 }));
  const responseCells = f.city.roadEventSites({ minX: -8, minY: -8, maxX: 16, maxY: 8 })[0]!.responseCells;
  const plan = { id: `city:window:${kind}`, taskId: 'completed-home', kind, route, responseCells, start, durationMs: 75_000 } satisfies CityLifePlan;
  const controller = createNeighbourhoodController(() => f.city, director);
  return { ...f, director, start, plan, controller };
}

it('reserves waiting headroom instead of admitting an almost-deadline background approach', () => {
  const input={...cityTransitGrid(0).input,carLimit:0,walkerLimit:2,
    spawnRegion:{minX:-6,minY:-4,maxX:0,maxY:10}};
  const target={x:14,y:-2},control=createCityMobility(input);
  const adults=control.agents.filter(actor=>actor.age==='ADULT').map(actor=>actor.id);
  // The real route is possible under the old full24s free-flow allowance.
  // A cosmetic scene also needs room for normal crossing/traffic waits.
  expect(control.dispatchVisit('direct',[target],1,30000,false,adults,24000)).toEqual(adults);
  const city=createCityMobility(input),before=structuredClone(city.agents),director=new CityEventDirector(),start=42000;
  director.update(start,options);
  const controller=createNeighbourhoodController(()=>city,director);
  const plan={id:'slow-background-approach',taskId:'garden',kind:'GARDEN',start,durationMs:75000,
    route:Array.from({length:7},(_,i)=>({x:8+i,y:-2}))} satisfies CityLifePlan;
  expect(controller.canStart(plan)).toBe(false);expect(controller.start(plan,start)).toBe(false);
  expect(controller.state).toBeUndefined();expect(director.active).toEqual([]);expect(city.agents).toEqual(before);
});

it('rejects a stale approach window before claiming a real participant', () => {
  const f=fixture(),before=structuredClone(f.city.agents);
  expect(f.controller.start(f.plan,f.start+20000)).toBe(false);
  expect(f.controller.state).toBeUndefined();expect(f.director.active).toEqual([]);expect(f.city.agents).toEqual(before);
});

it.each(['MOVING', 'DELIVERY', 'GARDEN', 'MUSIC', 'CELEBRATION', 'CLEANING', 'MAINTENANCE', 'DRILL'] as const)(
  '%s uses actual existing participants, works only after arrival, and completes after physical departure', kind => {
    const f = fixture(kind), before = f.city.agents.map(actor => actor.position);
    expect(f.controller.start(f.plan, f.start)).toBe(true);
    expect(f.city.agents.map(actor => actor.position)).toEqual(before);
    expect(f.controller.state?.phase).toBe('ARRIVING');
    const ids = f.controller.state!.actorIds, phases = new Set<string>(), departure = new Map<string, { x: number; y: number }>();
    expect(ids.length).toBeGreaterThan(0);
    for (let elapsed = 0; elapsed < 75_000 && f.controller.state; elapsed += 50) {
      const now = f.start + elapsed;f.director.update(now, options);
      const state = f.controller.update(now, f.view, true);
      if (state) phases.add(state.phase);
      if (state?.phase === 'LEAVING' && !departure.size) for (const id of ids) departure.set(id, { ...f.city.agents.find(actor => actor.id === id)!.position });
      if (state?.phase === 'ACTIVITY') {
        expect(ids.every(id => f.city.agents.some(actor => actor.id === id && actor.visit?.id === f.plan.id && actor.visit.arrived))).toBe(true);
        if (kind === 'DRILL') expect(f.city.agents.some(actor => actor.id === state.serviceId && actor.responseOwner === f.plan.id && actor.activity === 'REST')).toBe(true);
      }
      if (f.controller.state) f.city.advance(50);
    }
    expect([...phases]).toEqual(['ARRIVING', 'ACTIVITY', 'LEAVING']);
    expect(f.controller.metrics.completed).toBe(1);expect(f.controller.state).toBeUndefined();expect(f.director.active).toEqual([]);
    for (const id of ids) {
      const actor = f.city.agents.find(actor => actor.id === id)!;
      expect(actor.visit?.id ?? '').not.toMatch(/city:window:/);
      expect(Math.abs(actor.position.x - 3.5) + Math.abs(actor.position.y + 1.5)).toBeGreaterThanOrEqual(3);
      const origin = departure.get(id)!;
      expect(Math.abs(actor.position.x - origin.x) + Math.abs(actor.position.y - origin.y)).toBeGreaterThanOrEqual(3);
    }
    expect(f.city.agents).toHaveLength(before.length);
    expect([f.city.metrics.vehicleUnsafeTotal, f.city.metrics.pedestrianUnsafeTotal, f.city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0, 0, 0]);
  });

it('elapsed wall time cannot manufacture arrival and an unserved call times out safely', () => {
  const f = fixture();expect(f.controller.start(f.plan, f.start)).toBe(true);
  expect(f.controller.update(f.start + 20_000, f.view, true)?.phase).toBe('ARRIVING');
  expect(f.controller.metrics.activities).toBe(0);
  expect(f.controller.update(f.start + 25_000, f.view, true)).toBeUndefined();
  expect(f.controller.metrics.completed).toBe(0);expect(f.controller.metrics.cancelled).toBe(1);
  expect(f.city.agents.some(actor => actor.visit?.id === f.plan.id)).toBe(false);
});

it('refuses a blocked place and keeps the unconfirmed ID retryable without inventing a participant', () => {
  const f = fixture(), before = f.city.agents.map(actor => actor.position);
  f.city.setWalkClosures(new Set(f.plan.route.map(cell => `${cell.x},${cell.y}`)));
  expect(f.controller.start(f.plan, f.start)).toBe(false);expect(f.controller.state).toBeUndefined();
  expect(f.city.agents.map(actor => actor.position)).toEqual(before);expect(f.director.active).toEqual([]);
  f.city.setWalkClosures(new Set());expect(f.controller.start(f.plan, f.start + 1000)).toBe(true);
  f.controller.clear();expect(f.director.active).toEqual([]);
  expect(f.controller.start(f.plan, f.start + 2000)).toBe(false);
});

it('cancellation never clears a newer foreign visit on the same physical resident', () => {
  const f = fixture();expect(f.controller.start(f.plan, f.start)).toBe(true);
  const id = f.controller.state!.actorIds[0]!;
  f.city.clearVisits(f.plan.id);
  expect(f.city.dispatchVisit('foreign-owner', [{ x: 3, y: -2 }], 1, 30_000, false, [id])).toEqual([id]);
  const before = f.city.agents.find(actor => actor.id === id)!.position;
  f.controller.clear();
  expect(f.city.agents.find(actor => actor.id === id)?.visit?.id).toBe('foreign-owner');
  expect(f.city.agents.find(actor => actor.id === id)?.position).toEqual(before);
  expect(f.director.active).toEqual([]);
});

it('requires a real available engine for a drill and preserves its newer owner during stale cleanup', () => {
  const f = fixture('DRILL');
  const all = f.city.agents.map(actor => actor.id);
  const noEngine = { ...f.plan, responseCells: [] };
  expect(f.controller.start(noEngine, f.start)).toBe(false);
  expect(f.city.agents.map(actor => actor.id)).toEqual(all);
  expect(f.controller.start(f.plan, f.start)).toBe(true);
  const id = f.controller.state!.serviceId!;
  f.city.clearResponses(['FIRE'], id, f.plan.id);
  expect(f.city.dispatchResponse('POLICE', f.plan.responseCells!, 30_000, id, 'new-patrol')).toBe(true);
  f.controller.clear();
  expect(f.city.agents.find(actor => actor.id === id)?.responseOwner).toBe('new-patrol');
});

it.each(['disabled', 'offscreen', 'construction'] as const)('releases native appointments exactly once when %s', mode => {
  const f = fixture();expect(f.controller.start(f.plan, f.start)).toBe(true);
  if (mode === 'construction') f.director.update(f.start + 100, { ...options, busy: new Set(['3,-2']) });
  else f.controller.update(f.start + 100, mode === 'offscreen' ? { minX: 100, minY: 100, maxX: 120, maxY: 120 } : f.view, mode !== 'disabled');
  expect(f.controller.state).toBeUndefined();expect(f.director.active).toEqual([]);
  f.controller.clear();expect(f.controller.metrics.cancelled).toBe(1);
  expect(f.city.agents.some(actor => actor.visit?.id === f.plan.id)).toBe(false);
});

it('does not invent residents or an engine when their real population is absent', () => {
  const f = fixture('DRILL');
  for (const limits of [{ carLimit: 0, walkerLimit: 16 }, { carLimit: 8, walkerLimit: 0 }]) {
    const city = createCityMobility({ ...f.input, ...limits }), controller = createNeighbourhoodController(() => city, f.director);
    const ids = city.agents.map(actor => actor.id);
    expect(controller.canStart(f.plan)).toBe(false);
    expect(controller.start(f.plan, f.start)).toBe(false);
    expect(controller.state).toBeUndefined();expect(city.agents.map(actor => actor.id)).toEqual(ids);
    expect(city.agents.some(actor => actor.visit || actor.response)).toBe(false);
    expect(controller.metrics.started).toBe(0);expect(controller.metrics.activities).toBe(0);
  }
});

it('does not count a drill as completed when the actual engine cannot leave its closed road', () => {
  const f = fixture('DRILL');expect(f.controller.start(f.plan, f.start)).toBe(true);
  let closed = false;
  for (let elapsed = 0; elapsed < 75_000 && f.controller.state; elapsed += 50) {
    const now = f.start + elapsed;f.director.update(now, options);
    const state = f.controller.update(now, f.view, true);
    if (!closed && state?.phase === 'LEAVING') { f.city.setRoadClosures(new Set(f.input.roads.keys()));closed = true; }
    if (f.controller.state) f.city.advance(50);
  }
  expect(closed).toBe(true);expect(f.controller.metrics.completed).toBe(0);expect(f.controller.metrics.cancelled).toBe(1);
  expect(f.director.active).toEqual([]);
});

it('keeps a blocked pedestrian departure negative after a real arrival and activity', () => {
  const f=fixture('GARDEN');expect(f.controller.start(f.plan,f.start)).toBe(true);
  let blockedAt:number|undefined,terminatedAt:number|undefined;
  const departure=new Map<string,{x:number;y:number}>();
  const phases=new Set<string>();
  for(let elapsed=0;elapsed<75_000&&f.controller.state;elapsed+=50){
    const now=f.start+elapsed;f.director.update(now,options);
    const state=f.controller.update(now,f.view,true);
    if(state)phases.add(state.phase);
    if(blockedAt===undefined&&state?.phase==='LEAVING'){
      blockedAt=now;
      for(const id of state.actorIds)departure.set(id,{...f.city.agents.find(actor=>actor.id===id)!.position});
      f.city.setWalkClosures(new Set(f.input.walkGraph.keys()));
    }
    if(f.controller.state)f.city.advance(50);else terminatedAt=now;
  }
  expect([...phases]).toEqual(['ARRIVING','ACTIVITY','LEAVING']);
  expect(blockedAt).toBeDefined();expect(f.controller.metrics.activities).toBe(1);
  expect(terminatedAt!-blockedAt!).toBe(12_000);
  for(const [id,origin] of departure){
    const actor=f.city.agents.find(actor=>actor.id===id)!;
    expect(Math.abs(actor.position.x-origin.x)+Math.abs(actor.position.y-origin.y)).toBeLessThan(3);
  }
  expect(f.controller.metrics.completed).toBe(0);expect(f.controller.metrics.cancelled).toBe(1);
  expect(f.controller.state).toBeUndefined();expect(f.director.active).toEqual([]);
  expect(f.city.agents.some(actor=>actor.visit?.id.startsWith(f.plan.id))).toBe(false);
  expect([f.city.metrics.vehicleUnsafeTotal,f.city.metrics.pedestrianUnsafeTotal,f.city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0,0,0]);
});

it('uses one worker on a narrow approach so a resting arrival cannot block the next participant', () => {
  const f = fixture('GARDEN'), city = createCityMobility({ ...f.input, spawnPriorityCells: [{ x: 3, y: -2 }] });
  const controller = createNeighbourhoodController(() => city, f.director);
  expect(controller.start(f.plan, f.start)).toBe(true);expect(controller.state!.actorIds).toHaveLength(1);
});

it('does not turn junction-only open paving into a resting pad outside the native safe graph', () => {
  const f = fixture('MUSIC'), walkGraph = new Map(f.input.walkGraph);
  for (let y = -20; y <= -2; y++) for (let x = 0; x <= 20; x++) walkGraph.set(`${x},${y}`, { x, y });
  const city = createCityMobility({ ...f.input, walkGraph, activityCells: new Set(walkGraph.keys()), spawnPriorityCells: [{ x: 3, y: -10 }] });
  const controller = createNeighbourhoodController(() => city, f.director);
  const plan = { ...f.plan, route: Array.from({ length: 7 }, (_, i) => ({ x: 9 - i, y: -10 })) };
  expect(controller.canStart(plan)).toBe(false);expect(controller.start(plan, f.start)).toBe(false);
  expect(city.agents.some(actor=>actor.visit?.id===plan.id)).toBe(false);
});
