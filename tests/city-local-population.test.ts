import { expect, it } from 'vitest';
import { createCityMobility } from '../src/client/city-mobility';
import type { Cell, Rect, RoadCellDto } from '../src/shared/contracts';
import { cityTransitGrid } from './fixtures/city-transit-grid';

const key = (cell: Cell) => `${cell.x},${cell.y}`;
const contains = (view: Rect, cell: Cell) => cell.x >= view.minX && cell.x <= view.maxX && cell.y >= view.minY && cell.y <= view.maxY;
function separatedRegions() {
  const base = cityTransitGrid(0).input, roads = new Map<string, RoadCellDto>(), walk = new Map<string, Cell>();
  for (let region = 0; region < 12; region++) {
    for (const cell of base.roads.values()) { const shifted = { ...cell, x: cell.x + region * 256 }; roads.set(key(shifted), shifted); }
    for (const cell of base.walkGraph.values()) { const shifted = { ...cell, x: cell.x + region * 256 }; walk.set(key(shifted), shifted); }
  }
  const view = { minX: 11 * 256 - 6, minY: -6, maxX: 11 * 256 + 46, maxY: 46 };
  return { view, input: { ...base, roads, walkGraph: walk, carLimit: 24, walkerLimit: 32, spawnRegion: view } };
}

it('starts real bounded traffic and residents in the visible region instead of spreading them over the whole network', () => {
  const { input, view } = separatedRegions(), city = createCityMobility(input);
  expect(city.walkingCells.has(`${11 * 256 + 3},-2`)).toBe(true);
  const local = city.agents.filter(actor => contains(view, actor.position));
  expect(local.filter(actor => actor.kind === 'CAR').length).toBeGreaterThanOrEqual(16);
  expect(local.filter(actor => actor.kind === 'WALKER').length).toBeGreaterThanOrEqual(24);
  expect(city.agents.filter(actor => actor.kind === 'CAR')).toHaveLength(24);
  expect(city.agents.filter(actor => actor.kind === 'WALKER')).toHaveLength(32);
  expect(city.agents.filter(actor => actor.fleet)).toHaveLength(2);
  for (let step = 0; step < 200; step++) city.advance(50);
  expect([city.metrics.vehicleUnsafeTotal, city.metrics.pedestrianUnsafeTotal, city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0, 0, 0]);
});

it('keeps a small real group near distant transport doors without losing the local majority', () => {
  const { input, view } = separatedRegions(), door = { x: 3, y: -2 };
  const city = createCityMobility({ ...input, transferCells: new Set([key(door)]), spawnPriorityCells: [door] });
  const walkers = city.agents.filter(actor => actor.kind === 'WALKER');
  expect(walkers.filter(actor => Math.abs(actor.position.x - door.x) + Math.abs(actor.position.y - door.y) < 10).length).toBeGreaterThanOrEqual(4);
  expect(walkers.filter(actor => contains(view, actor.position)).length).toBeGreaterThanOrEqual(24);
  expect(walkers.length).toBeLessThanOrEqual(32);
});

it('does not let hidden carried passengers mask a visible pedestrian deficit', () => {
  const f=cityTransitGrid(16);
  for(let elapsed=0;elapsed<90000&&!f.city.agents.some(actor=>actor.carrier);elapsed+=50){
    f.controller.update(42000+elapsed,f.view,f.options);f.city.advance(50);
  }
  const passengers=f.city.agents.filter(actor=>actor.carrier),busId=passengers[0]?.carrier;
  expect(busId).toBeDefined();
  const initialScans=f.city.population.graphCellsScanned;
  const view={minX:-12,minY:-8,maxX:28,maxY:37};
  f.city.updatePopulation(view);
  for(let step=0;step<16;step++){f.city.holdTransit(busId!);f.city.advance(50);}
  const before=f.city.agents.filter(actor=>actor.kind==='WALKER');
  const inView=before.filter(actor=>contains(view,actor.position));
  expect(inView).toHaveLength(8);
  expect(inView.filter(actor=>!actor.carrier&&actor.activity!=='INSIDE')).toHaveLength(7);
  f.city.updatePopulation(view,{now:()=>0});
  expect(before.filter(actor=>!f.city.agents.some(next=>next.id===actor.id)).length).toBeGreaterThan(0);
  for(const passenger of passengers)expect(f.city.agents.find(actor=>actor.id===passenger.id)?.carrier).toBe(busId);
  expect(f.city.population.graphCellsScanned).toBe(initialScans);
});

it('refreshes free offscreen residents after a modest viewport change even when they all remain in the old48-cell halo', () => {
  const f=cityTransitGrid(0),wide={minX:-6,minY:-6,maxX:54,maxY:54};
  const city=createCityMobility({...f.input,carLimit:8,walkerLimit:32,spawnRegion:wide});
  const view={minX:18,minY:8,maxX:30,maxY:32};
  const original=new Set(city.agents.map(actor=>actor.id)),born=new Map<string,number>(),entered=new Set<string>();
  const graph=city.walkingCells as Map<string,Cell>;
  graph.values=()=>{throw new Error('No full graph scan for a local density deficit');};
  for(let step=0;step<400;step++){
    const visible=city.agents.filter(actor=>contains(view,actor.position));
    city.updatePopulation(view);city.advance(50);
    for(const actor of city.agents)if(!original.has(actor.id)){
      if(!born.has(actor.id))born.set(actor.id,step);
      if(actor.kind==='WALKER'&&contains(view,actor.position))entered.add(actor.id);
    }
    for(const [id,at] of born)if(step-at<160)expect(city.agents.some(actor=>actor.id===id),'New arrivals need their8s entry grace').toBe(true);
    for(const actor of visible){
      const next=city.agents.find(next=>next.id===actor.id);expect(next).toBeDefined();
      expect(Math.hypot(next!.position.x-actor.position.x,next!.position.y-actor.position.y)).toBeLessThan(.25);
    }
    expect(city.population.workStepsLast).toBeLessThanOrEqual(256);
  }
  expect(city.population.retired,'A buffer outside the visible neighbourhood must not exhaust its whole resident budget').toBeGreaterThan(0);
  expect(entered.size,'New offscreen residents must physically enter the observed street').toBeGreaterThanOrEqual(2);
  expect(city.population.graphCellsScanned).toBe(0);
  expect(city.agents.filter(actor=>actor.kind==='WALKER').length).toBeLessThanOrEqual(32);
  expect([city.metrics.vehicleUnsafeTotal,city.metrics.pedestrianUnsafeTotal,city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0,0,0]);
});

it('does not let a young offscreen cohort delay a second distant neighbourhood', () => {
  const {input}=separatedRegions(),city=createCityMobility({...input,carLimit:0,walkerLimit:8});
  const original=new Set(city.agents.map(actor=>actor.id));
  const first={minX:12,minY:12,maxX:28,maxY:28};
  for(let step=0;step<100;step++){city.updatePopulation(first,{now:()=>0});city.advance(50);}
  const young=city.agents.filter(actor=>!original.has(actor.id)).map(actor=>actor.id);
  expect(young.length).toBeGreaterThan(0);
  const second={...first,minX:first.minX+256,maxX:first.maxX+256};
  for(let step=0;step<40;step++){
    city.updatePopulation(second,{now:()=>0});city.advance(50);
    expect(city.population.workStepsLast).toBeLessThanOrEqual(256);
  }
  // Every member was born less than8s ago. Its entry grace belongs to the
  // first view; free invisible bodies may drain after this distant move.
  expect(young.some(id=>!city.agents.some(actor=>actor.id===id))).toBe(true);
  expect(city.population.graphCellsScanned).toBe(0);
  expect(city.agents.filter(actor=>actor.kind==='WALKER').length).toBeLessThanOrEqual(8);
});

it('repopulates a distant visible neighbourhood without moving or retiring visible and explicitly protected bodies', () => {
  const { input } = separatedRegions(), city = createCityMobility({ ...input, carLimit: 8, walkerLimit: 16 });
  const protectedId = city.agents.find(actor => actor.kind === 'CAR' && !actor.fleet)!.id;
  const protectedIds = new Set([protectedId]);
  const view = { minX: 12, minY: 12, maxX: 28, maxY: 28 };
  const before = structuredClone(city.agents);
  city.updatePopulation(view, { protectedIds });expect(city.agents).toEqual(before);
  const graph = city.walkingCells as Map<string, Cell>;
  graph.values = () => { throw new Error('full walking graph scan on pan'); };
  for (let step = 0; step < 240; step++) {
    const previous = new Map(city.agents.map(actor => [actor.id, actor]));
    city.updatePopulation(view, { protectedIds });city.advance(50);
    expect(city.agents.some(actor => actor.id === protectedId)).toBe(true);
    for (const actor of previous.values()) if (contains(view, actor.position) || protectedIds.has(actor.id)) {
      const next = city.agents.find(next => next.id === actor.id)!;
      expect(next).toBeDefined();expect(Math.hypot(next.position.x - actor.position.x, next.position.y - actor.position.y)).toBeLessThan(.25);
    }
    expect(city.agents.filter(actor => actor.kind === 'CAR').length).toBeLessThanOrEqual(8);
    expect(city.agents.filter(actor => actor.kind === 'WALKER').length).toBeLessThanOrEqual(16);
    expect(city.population.workStepsLast).toBeLessThanOrEqual(256);
  }
  const halo = { minX: -4, minY: -4, maxX: 44, maxY: 44 };
  expect(city.agents.filter(actor => actor.kind === 'CAR' && contains(halo, actor.position)).length).toBeGreaterThanOrEqual(3);
  expect(city.agents.filter(actor => actor.kind === 'WALKER' && contains(halo, actor.position)).length).toBeGreaterThanOrEqual(6);
  expect(city.population.retired).toBeGreaterThan(0);expect(city.population.graphCellsScanned).toBe(0);
  expect([city.metrics.vehicleUnsafeTotal, city.metrics.pedestrianUnsafeTotal, city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0, 0, 0]);
});

it('keeps real boarded passengers, visits, a service call and an observed idle bus during far pan and quality changes', () => {
  const f = cityTransitGrid(16);
  for (let elapsed = 0; elapsed < 90_000 && !f.city.agents.some(actor => actor.carrier); elapsed += 50) {
    f.controller.update(42_000 + elapsed, f.view, f.options);f.city.advance(50);
  }
  const passengers = f.city.agents.filter(actor => actor.carrier), busId = passengers[0]?.carrier;
  expect(busId).toBeDefined();expect(passengers.length).toBeGreaterThan(0);
  const site = f.city.roadEventSites()[0]!;expect(site).toBeDefined();
  expect(f.city.dispatchResponse('FIRE', site.responseCells, 30_000, undefined, 'protected-fire')).toBe(true);
  const engine = f.city.agents.find(actor => actor.responseOwner === 'protected-fire')!;
  // This road-grid fixture has no building doors. Admit an actual free
  // resident to its current safe curb, rather than passing an empty door map.
  let visit: string[] = [];
  for (const actor of f.city.agents.filter(actor => actor.kind === 'WALKER' && !actor.carrier && !actor.visit)) {
    visit = f.city.dispatchVisit('protected-visit', [actor.next], 1, 30_000, false, [actor.id]);
    if (visit.length) break;
  }
  expect(visit.length).toBeGreaterThan(0);
  const observed = f.city.agents.find(actor => actor.fleet === 'SCHOOL_BUS')!.id;
  const protectedIds = new Set([observed]);
  const { input, view: whole } = separatedRegions();
  f.city.updateNetwork({ ...input, carLimit: 8, walkerLimit: 16, spawnRegion: f.view });
  const graph = f.city.walkingCells as Map<string, Cell>;graph.values = () => { throw new Error('full graph scan during population update'); };
  const view = { minX: whole.minX + 18, minY: 12, maxX: whole.maxX - 18, maxY: 28 };
  for (let step = 0; step < 160; step++) {
    f.city.holdTransit(busId!);f.city.updatePopulation(view, { protectedIds });f.city.advance(50);
    for (const passenger of passengers) expect(f.city.agents.find(actor => actor.id === passenger.id)?.carrier).toBe(busId);
    expect(f.city.agents.find(actor => actor.id === engine.id)?.responseOwner).toBe('protected-fire');
    expect(f.city.agents.some(actor => actor.id === observed)).toBe(true);
    expect(f.city.agents.find(actor => actor.id === visit[0])?.visit?.id).toBe('protected-visit');
  }
  const beforeDowngrade=f.city.agents.filter(actor=>actor.kind==='WALKER');
  const visibleAtDowngrade=beforeDowngrade.filter(actor=>contains(view,actor.position)).map(actor=>actor.id);
  f.city.updatePopulationLimits({ carLimit: 5, walkerLimit: 8 });
  for (const id of [...passengers.map(actor => actor.id), busId!, engine.id, observed, ...visit]) expect(f.city.agents.some(actor => actor.id === id)).toBe(true);
  for(const id of visibleAtDowngrade)expect(f.city.agents.some(actor=>actor.id===id)).toBe(true);
  expect(f.city.agents.filter(actor => actor.kind === 'CAR').length).toBeLessThanOrEqual(5);
  // Visible and occupied bodies can drain above the new target, within the
  // old bounded pool. The following test separately verifies eventual8/5.
  expect(f.city.agents.filter(actor => actor.kind === 'WALKER').length).toBeLessThanOrEqual(beforeDowngrade.length);
  expect(f.city.metrics.networkBuilds).toBe(2);
  expect([f.city.metrics.vehicleUnsafeTotal, f.city.metrics.pedestrianUnsafeTotal, f.city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0, 0, 0]);
});

it('does not erase visible bodies on a quality downgrade and drains free excess after they leave the viewport', () => {
  const { input, view } = separatedRegions(), city = createCityMobility(input);
  city.updatePopulation(view);
  const visible = city.agents.filter(actor => contains(view, actor.position)).map(actor => actor.id);
  city.updatePopulationLimits({ carLimit: 5, walkerLimit: 8 });
  for (const id of visible) expect(city.agents.some(actor => actor.id === id)).toBe(true);
  const remote = { minX: 12, minY: 12, maxX: 28, maxY: 28 };
  for (let step = 0; step < 400; step++) { city.updatePopulation(remote);city.advance(50); }
  expect(city.agents.filter(actor => actor.kind === 'CAR').length).toBeLessThanOrEqual(5);
  expect(city.agents.filter(actor => actor.kind === 'WALKER').length).toBeLessThanOrEqual(8);
  expect(city.population.graphCellsScanned).toBe(0);
  expect([city.metrics.vehicleUnsafeTotal, city.metrics.pedestrianUnsafeTotal, city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0, 0, 0]);
});

it('bounds draft route work and cancels it on a new view, closure or disabled presentation', () => {
  const { input } = separatedRegions(), city = createCityMobility({ ...input, carLimit: 8, walkerLimit: 16 });
  const view = { minX: 12, minY: 12, maxX: 28, maxY: 28 };
  const startDraft = () => {
    city.updatePopulation(view);
    for (let i = 0; i < 16; i++) city.advance(50);
    let wall = 0;city.updatePopulation(view, { now: () => wall++ });
    expect(city.population.workStepsLast).toBeLessThanOrEqual(4);expect(city.population.pending).toBe(true);
  };
  startDraft();
  city.updatePopulation({ ...view, minX: 80, maxX: 96 });expect(city.population.pending).toBe(false);
  startDraft();
  city.setWalkClosures(new Set(['3,-2']));expect(city.population.pending).toBe(false);
  startDraft();
  const before = city.population.spawned;city.updatePopulation(view, { enabled: false });
  expect(city.population.pending).toBe(false);
  for (let i = 0; i < 40; i++) city.advance(50);
  expect(city.population.spawned).toBe(before);expect(city.population.graphCellsScanned).toBe(0);
});
