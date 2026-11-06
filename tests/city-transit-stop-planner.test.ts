import { expect, it } from 'vitest';
import * as planner from '../src/server/world/city-transit-stop-planner';
import * as stopModel from '../src/shared/city-transit-stops';
import { compileBlockLayout, rasterizeBlockRoads, type BlockLayoutCompilerInput } from '../src/server/world/block-layout-compiler';
import { blockSlots } from '../src/shared/block-templates';
import { canonicalTransitStopWalkway, cityTransitStopReservations, type CityTransitStopPlan } from '../src/shared/city-transit-stops';
import { buildRoadSurfaces } from '../src/shared/road-surfaces';
import { buildMobilityNetwork } from '../src/client/city-mobility-network';
import { createMobilityRouteSearch } from '../src/client/mobility-route-search';
import { compileTransitLines } from '../src/client/city-transit-lines';
import { roadBandRole } from '../src/shared/road-profile';
import type { Cell, Rect } from '../src/shared/contracts';

const key = (p: Cell) => `${p.x},${p.y}`;
const inside = (p: Cell, b: Rect) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const intersects = (a: Rect, b: Rect) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
it('permits a shared parallel perimeter while protecting the shelter and nearby perpendicular junctions', () => {
  const stop = stopModel.canonicalTransitStop('b',{ x: 10, y: 1 },'E');
  const allowed = stopModel.createCityTransitStopBlockGuard([stop]);
  // Compiler envelope includes two clearance cells around the street centre.
  expect(allowed({ minX: -2, minY: -18, maxX: 34, maxY: 2 })).toBe(true);
  expect(allowed({ minX: 8, minY: -18, maxX: 44, maxY: 18 })).toBe(false);
  // A protected plaza can remain inside a newly attached block. Its parcels
  // are packed around that plaza; the old street itself stays unchanged.
  expect(allowed({ minX: -2, minY: -2, maxX: 34, maxY: 18 })).toBe(true);
});
const input = (count: number): BlockLayoutCompilerInput => ({ countryId: 'country', cityId: 'city', seed: 7, revision: 1,
  districts: [{ id: 'district', archetype: 'MIXED_URBAN', sequence: 0, tasks: Array.from({ length: count }, (_,i) => ({
    id: `task-${i+1}`, taskNumber: i+1, buildingFamily: 'compact-apartment', facadeVariant: 'south', constructionStage: 5, autoVisualKind: true,
  })) }] });
it('packs every future parcel and entrance around an inherited public plaza without moving old blocks', () => {
  const original = compileBlockLayout(input(1)), first = original.blocks[0]!;
  const reservation = blockSlots(first)[0]!.siteBounds;
  const protectedLayout = compileBlockLayout({ ...input(1),publicReservations: [reservation] });
  expect(protectedLayout.blocks[0]!.origin).toEqual(first.origin);
  for (const slot of blockSlots(protectedLayout.blocks[0]!)) {
    expect(intersects(slot.siteBounds,reservation)).toBe(false);
    expect(slot.accessPath.some(p => inside(p,reservation))).toBe(false);
  }
});
it('tries another connected template when a protected curb pocket leaves the smallest block without any parcel', () => {
  const reservation={minX:2,minY:2,maxX:5,maxY:12};
  const layout=compileBlockLayout({...input(1),compactReplay:true,publicReservations:[reservation]});
  expect(layout.placements).toHaveLength(1);
  expect(layout.blocks[0]!.width*layout.blocks[0]!.height).toBeGreaterThan(16*16);
  for(const slot of blockSlots(layout.blocks[0]!))expect(intersects(slot.siteBounds,reservation)).toBe(false);
});

function nativeNetwork(layout: ReturnType<typeof compileBlockLayout>, plan: CityTransitStopPlan) {
  const slots = layout.blocks.flatMap(block => blockSlots(block));
  const roads = new Map(rasterizeBlockRoads(layout.roadNetwork).map(p => [key(p),p])), blocked = new Set(plan.stops.flatMap(stop => stop.shelter.map(key)));
  const surfaces = buildRoadSurfaces({ roads, blocked, isInsideCity: () => true, isSurfaceTerrain: p => !slots.some(slot => inside(p,slot.siteBounds)) });
  const walkGraph = new Map([...surfaces].map(([id,p]) => [id,{ x: p.x, y: p.y }]));
  for (const slot of slots) for (const p of slot.accessPath) if (!blocked.has(key(p)) && !roads.has(key(p))) walkGraph.set(key(p),p);
  for (const stop of plan.stops) for (const p of canonicalTransitStopWalkway(stop)) walkGraph.set(key(p),p);
  const network = buildMobilityNetwork({ roads, walkGraph, crosswalks: new Set([...surfaces].filter(([,p]) => p.kind === 'CROSSWALK').map(([id]) => id)),
    activityCells: new Set(plan.stops.flatMap(stop => canonicalTransitStopWalkway(stop).map(key))), buildingEntrances: new Set(slots.flatMap(slot => slot.accessPath[0] ? [key(slot.accessPath[0])] : [])) });
  return { network,roads };
}

it('places dry permanent shelters outside every occupied or future parcel and keeps native straight queues and directed bus lines', () => {
  const layout = compileBlockLayout(input(50)), before = structuredClone(layout);
  const { plan, metrics } = planner.planCityTransitStops({ layout, isDry: () => true });
  expect(plan.stops.length).toBeGreaterThanOrEqual(2);expect(layout).toEqual(before);
  expect(metrics.maxLocalRoadCells).toBeLessThanOrEqual(160*160);
  expect(metrics.maxLocalRoadSegments).toBeLessThanOrEqual(2048);
  for (const plaza of cityTransitStopReservations(plan)) expect(layout.blocks.some(block => intersects(plaza,{
    minX:block.origin.x+2,minY:block.origin.y+2,maxX:block.origin.x+block.width-2,maxY:block.origin.y+block.height-2,
  }))).toBe(false);
  const slots = layout.blocks.flatMap(block => blockSlots(block)), access = new Set(slots.flatMap(slot => slot.accessPath.map(key)));
  for (const stop of plan.stops) for (const p of [...stop.shelter,...canonicalTransitStopWalkway(stop)]) {
    expect(slots.some(slot => inside(p,slot.siteBounds)), `${stop.id} planned slot`).toBe(false);expect(access.has(key(p))).toBe(false);
  }
  const { network,roads } = nativeNetwork(layout,plan);
  for (const stop of plan.stops) for (const p of [...stop.queue,...stop.accessPath]) {
    expect(network.walkers.has(key(p)), `${stop.id} missing approach`).toBe(true);expect(network.zoneByCell.has(key(p)), `${stop.id} unsafe waiting cell`).toBe(false);
  }
  const routes = createMobilityRouteSearch(network.cars,network.carEdges);
  const canDrive = (from: Cell, to: Cell) => { const role = roadBandRole(roads,from);return role.kind === 'TRAVEL' && !network.zoneByCell.has(key(to))
    && routes(from,{ x: from.x-role.dx, y: from.y-role.dy },to,64).routeTo(to).length > 1; };
  const runtimeStops = plan.stops.map(stop => ({ ...stop, lane: { ...stop.lane }, shelter: [...stop.shelter], queue: [...stop.queue], route: [...stop.accessPath],
    direction: stop.heading === 'E' || stop.heading === 'W' ? 'horizontal' as const : 'vertical' as const }));
  expect(compileTransitLines(runtimeStops,canDrive).length).toBeGreaterThan(0);
});
it('retains published stops and task geography through append-only growth with protected stop approaches', () => {
  const first = compileBlockLayout(input(30)), previous = planner.planCityTransitStops({ layout: first, isDry: () => true }).plan;
  const reservations = cityTransitStopReservations(previous);
  const grown = compileBlockLayout({ ...input(80), previous: first, revision: 2, publicReservations: reservations,
    canPlaceBlock: stopModel.createCityTransitStopBlockGuard(previous.stops) });
  for (const block of grown.blocks.filter(b => !first.blocks.some(old => old.id===b.id))) for (const slot of blockSlots(block)) {
    expect(reservations.some(rect => intersects(slot.siteBounds,rect))).toBe(false);
    expect(slot.accessPath.some(p => reservations.some(rect => inside(p,rect)))).toBe(false);
  }
  const next = planner.planCityTransitStops({ layout: grown, previous, isDry: () => true });
  expect(next.plan.stops).toEqual(expect.arrayContaining([...previous.stops]));expect(grown.placements).toEqual(expect.arrayContaining(first.placements));
  expect(next.metrics.plannedBlocks).toBe(grown.blocks.length-first.blocks.length);
  const changedTaskMetadata = { ...grown, placements: [] };
  const noChange = planner.planCityTransitStops({ layout: changedTaskMetadata, previous: next.plan, isDry: () => { throw new Error('No existing block may be replanned'); } });
  expect(noChange.plan).toEqual(next.plan);expect(noChange.metrics.plannedBlocks).toBe(0);
  const { network } = nativeNetwork(grown,next.plan);
  for (const stop of next.plan.stops) for (const p of [...stop.queue,...stop.accessPath]) {
    expect(network.walkers.has(key(p)), `${stop.id} lost after growth`).toBe(true);
    expect(network.zoneByCell.has(key(p)), `${stop.id} became a conflict zone after growth`).toBe(false);
  }
});
it('leaves unsuitable wet or protected locations empty and can abort before sampling terrain', async () => {
  const layout = compileBlockLayout(input(12));
  expect(planner.planCityTransitStops({ layout, isDry: () => false }).plan.stops).toEqual([]);
  const obstacle = { minX: layout.bounds.minX-64, minY: layout.bounds.minY-64, maxX: layout.bounds.maxX+64, maxY: layout.bounds.maxY+64 };
  expect(planner.planCityTransitStops({ layout, isDry: () => true, obstacles: [obstacle] }).plan.stops).toEqual([]);
  const controller = new AbortController();controller.abort();let reads = 0;
  await expect(planner.prepareCityTransitStops({ layout, isDry: () => { reads++;return true; } },{ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(reads).toBe(0);
});
