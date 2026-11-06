import type { CompiledBlockLayoutV1 } from '../../shared/block-world';
import type { Cell, Rect } from '../../shared/contracts';
import type { CityTransitStopPlan } from '../../shared/city-transit-stops';
import { canonicalTransitStop, cityTransitStopPlanSteps, readCityTransitStopPlan, CityTransitStopAdmission,
  cityTransitStopReservations, type CanonicalTransitStop } from '../../shared/city-transit-stops';
import { rasterizeBlockRoads } from '../../shared/road-raster';
import { roadBandRole } from '../../shared/road-profile';
import { buildRoadSurfaces } from '../../shared/road-surfaces';
import type { SemanticRoadNetwork, SemanticRoadSegment } from '../../shared/semantic-road';
import { CITY_SCENE_MAX_CHUNKS, citySceneChunkRange } from '../../shared/city-capacity';
import { completePreparation, prepareCooperatively, type CooperativePreparationOptions } from '../../shared/cooperative-preparation';

export type CityTransitStopPlannerInput = {
  layout: Pick<CompiledBlockLayoutV1, 'id' | 'blocks' | 'roadNetwork' | 'bounds'>;
  previous?: CityTransitStopPlan;
  isDry: (cell: Cell) => boolean;
  obstacles?: readonly Rect[];
  extraRoads?: SemanticRoadNetwork;
  /** Accepted road corridors include their clearance, not only asphalt. */
  protectedRoads?: readonly Rect[];
};

export type CityTransitStopPlannerMetrics = {
  plannedBlocks: number; indexedBlocks: number; indexedRoadRuns: number; terrainReads: number; candidates: number;
  maxLocalRoadCells: number; maxLocalRoadSegments: number;
  fullyServedBlocks: number;
};
const key = (p: Cell) => `${p.x},${p.y}`;
const steps = { N: [0,-1], E: [1,0], S: [0,1], W: [-1,0] } as const;
const directionDeltas = Object.values(steps);
const inside = (p: Cell, b: Rect) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const expand = (b: Rect, margin: number): Rect => ({ minX: b.minX-margin, minY: b.minY-margin, maxX: b.maxX+margin, maxY: b.maxY+margin });
const clip = (a: Rect, b: Rect): Rect | undefined => {
  if (![a.minX,a.minY,a.maxX,a.maxY].every(Number.isSafeInteger) || a.minX > a.maxX || a.minY > a.maxY) throw new RangeError('Invalid transit planner bounds');
  const result = { minX: Math.max(a.minX,b.minX), minY: Math.max(a.minY,b.minY), maxX: Math.min(a.maxX,b.maxX), maxY: Math.min(a.maxY,b.maxY) };
  return result.minX <= result.maxX && result.minY <= result.maxY ? result : undefined;
};
function* bucketKeys(bounds: Rect) {
  for (let y = Math.floor(bounds.minY/64); y <= Math.floor(bounds.maxY/64); y++)
    for (let x = Math.floor(bounds.minX/64); x <= Math.floor(bounds.maxX/64); x++) yield `${x},${y}`;
}
class Obstacles {
  private buckets = new Map<string, Rect[]>();
  constructor(private scope: Rect) {}
  add(bounds: Rect) {
    const clipped = clip(bounds,this.scope);if (!clipped) return;
    for (const id of bucketKeys(clipped)) { const items = this.buckets.get(id) ?? [];items.push(bounds);this.buckets.set(id,items); }
  }
  has(p: Cell): boolean { return this.buckets.get(`${Math.floor(p.x/64)},${Math.floor(p.y/64)}`)?.some(rect => inside(p,rect)) ?? false; }
  intersects(bounds: Rect): boolean {
    for (const id of bucketKeys(bounds)) if (this.buckets.get(id)?.some(rect =>
      rect.minX <= bounds.maxX && rect.maxX >= bounds.minX && rect.minY <= bounds.maxY && rect.maxY >= bounds.minY)) return true;
    return false;
  }
}
/** Index run rectangles, never all of a city's raster cells. Querying a block
 * includes the exact rasterizer halo, width, structure and class precedence. */
class Roads {
  private buckets = new Map<string, Map<number, SemanticRoadSegment>>();
  private serial = 0;
  constructor(private scope: Rect) {}
  add(segment: SemanticRoadSegment, x: number, y: number, direction: keyof typeof steps, length: number) {
    if (!Object.hasOwn(steps,direction)) throw new RangeError('Invalid transit road direction');
    const [dx,dy] = steps[direction];
    if (!Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(segment.widthCells)
      || segment.widthCells < 1 || segment.widthCells > 9) throw new RangeError('Invalid transit road run');
    const endX = x+dx*length, endY = y+dy*length, radius = Math.floor(segment.widthCells/2)+1;
    const bounds = clip({ minX: Math.min(x,endX)-radius, minY: Math.min(y,endY)-radius,
      maxX: Math.max(x,endX)+radius, maxY: Math.max(y,endY)+radius },this.scope);
    if (!bounds) return;
    const id = this.serial++, run = { ...segment, geometry: { start: { x,y }, runs: [{ direction,length }] } };
    for (const bucket of bucketKeys(bounds)) {
      let items = this.buckets.get(bucket);if (!items) { items = new Map();this.buckets.set(bucket,items); }
      items.set(id,run);
    }
  }
  query(bounds: Rect): SemanticRoadSegment[] {
    const found = new Map<number,SemanticRoadSegment>();
    for (const id of bucketKeys(expand(bounds,1))) for (const [key,segment] of this.buckets.get(id) ?? []) found.set(key,segment);
    if (found.size > 2048) throw new RangeError('Transit local road query exceeded its segment budget');
    return [...found.values()];
  }
}

export function* cityTransitStopPlannerSteps(input: CityTransitStopPlannerInput): Generator<void, { plan: CityTransitStopPlan; metrics: CityTransitStopPlannerMetrics }, void> {
  const { layout } = input;
  if (typeof input.isDry !== 'function') throw new RangeError('Transit stop planner needs terrain authority');
  const previous = readCityTransitStopPlan(input.previous ?? { schemaVersion: 1, layoutId: layout.id, processedBlockIds: [], stops: [] },layout.id);
  const metrics: CityTransitStopPlannerMetrics = { plannedBlocks: 0, indexedBlocks: 0, indexedRoadRuns: 0, terrainReads: 0, candidates: 0,
    maxLocalRoadCells: 0, maxLocalRoadSegments: 0, fullyServedBlocks: 0 };
  const processed = new Set(previous.processedBlockIds), pending = layout.blocks.filter(block => !processed.has(block.id))
    .sort((a,b) => a.sequence-b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!pending.length) return { plan: previous, metrics };
  const scope = expand(pending.reduce((bounds,block) => ({ minX: Math.min(bounds.minX,block.origin.x), minY: Math.min(bounds.minY,block.origin.y),
    maxX: Math.max(bounds.maxX,block.origin.x+block.width), maxY: Math.max(bounds.maxY,block.origin.y+block.height) }),
    { minX: pending[0]!.origin.x, minY: pending[0]!.origin.y, maxX: pending[0]!.origin.x, maxY: pending[0]!.origin.y }),32);
  if (citySceneChunkRange(scope).count > CITY_SCENE_MAX_CHUNKS*9) throw new RangeError('Transit planner scope exceeded city capacity');
  const hard = new Obstacles(scope), walkBlocked = new Obstacles(scope), protectedRoads = new Obstacles(scope),
    roads = new Roads(scope), admission = new CityTransitStopAdmission();
  for (const rect of input.protectedRoads ?? []) { protectedRoads.add(rect);yield; }
  for (const stop of previous.stops) { admission.add(stop);yield; }
  for (const rect of input.obstacles ?? []) { hard.add(rect);walkBlocked.add(rect);yield; }
  for (const rect of cityTransitStopReservations(previous)) { hard.add(rect);yield; }
  for (const stop of previous.stops) {
    walkBlocked.add({ minX: Math.min(...stop.shelter.map(p => p.x)), minY: Math.min(...stop.shelter.map(p => p.y)),
      maxX: Math.max(...stop.shelter.map(p => p.x)), maxY: Math.max(...stop.shelter.map(p => p.y)) });yield;
  }
  for (const block of layout.blocks) {
    if (![block.width,block.height].every(n => Number.isSafeInteger(n) && n >= 8 && n <= 128)) throw new RangeError('Invalid transit source block');
    if (!clip(expand({ minX: block.origin.x, minY: block.origin.y, maxX: block.origin.x+block.width, maxY: block.origin.y+block.height },8),scope)) { yield;continue; }
    // Existing blocks keep their complete interior and entrance choices.
    // A later authored side/rear door must not acquire a route through a new
    // stop. Their future parcels/fences are inside3, all entrances inside2.
    // Index two rectangles instead of materializing every planned task slot.
    hard.add({minX:block.origin.x+2,minY:block.origin.y+2,maxX:block.origin.x+block.width-2,maxY:block.origin.y+block.height-2});
    walkBlocked.add({minX:block.origin.x+3,minY:block.origin.y+3,maxX:block.origin.x+block.width-3,maxY:block.origin.y+block.height-3});
    metrics.indexedBlocks++;yield;
  }
  const junctions=new Set<string>();
  for (const network of [layout.roadNetwork,...(input.extraRoads ? [input.extraRoads] : [])]) {
    const degree=new Map<string,number>();
    for (const segment of network.segments) {
      degree.set(segment.fromNodeId,(degree.get(segment.fromNodeId)??0)+1);
      degree.set(segment.toNodeId,(degree.get(segment.toNodeId)??0)+1);
      let { x,y } = segment.geometry.start;
      for (const run of segment.geometry.runs) {
        roads.add(segment,x,y,run.direction,run.length);metrics.indexedRoadRuns++;yield;
        const [dx,dy] = steps[run.direction];x += dx*run.length;y += dy*run.length;
      }
    }
    for(const node of network.nodes){if((degree.get(node.id)??0)>2)junctions.add(key(node));yield;}
  }
  const dryCache = new Map<string,boolean>(), dry = (p: Cell) => {
    const id = key(p), known = dryCache.get(id);if (known !== undefined) return known;
    const result = input.isDry(p);dryCache.set(id,result);metrics.terrainReads++;return result;
  };
  const offered = new Map<string,CanonicalTransitStop[]>();
  for (const block of pending) {
    metrics.plannedBlocks++;
    const area = expand({ minX: block.origin.x, minY: block.origin.y, maxX: block.origin.x+block.width, maxY: block.origin.y+block.height },6);
    if (!admission.hasCapacityIn(area)) { offered.set(block.id,[]);metrics.fullyServedBlocks++;yield;continue; }
    const bounds = expand({ minX: block.origin.x, minY: block.origin.y, maxX: block.origin.x+block.width, maxY: block.origin.y+block.height },15);
    const local = roads.query(bounds), cells = rasterizeBlockRoads({ schemaVersion: 1, nodes: [], segments: local },bounds);
    metrics.maxLocalRoadSegments = Math.max(metrics.maxLocalRoadSegments,local.length);metrics.maxLocalRoadCells = Math.max(metrics.maxLocalRoadCells,cells.length);
    yield;
    const graph = new Map(cells.map(cell => [key(cell),cell]));
    const surfaces = buildRoadSurfaces({ roads: graph, blocked: { has: id => {
      const [x,y] = id.split(',').map(Number);return walkBlocked.has({ x: x!, y: y! });
    } }, isInsideCity: () => true, isSurfaceTerrain: p => !walkBlocked.has(p) && dry(p) });
    yield;
    const lanes = cells.filter(cell => inside(cell,area) && directionDeltas.some(([dx,dy]) => !graph.has(`${cell.x+dx},${cell.y+dy}`)))
      .sort((a,b) => Math.abs(a.x*2-block.origin.x*2-block.width)+Math.abs(a.y*2-block.origin.y*2-block.height)
        -Math.abs(b.x*2-block.origin.x*2-block.width)-Math.abs(b.y*2-block.origin.y*2-block.height) || a.y-b.y || a.x-b.x);
    const selected: CanonicalTransitStop[] = [];
    for (const lane of lanes.slice(0,512)) {
      metrics.candidates++;yield;
      if (selected.length >= 4) break;
      if (!admission.canAdd({ lane })) continue;
      const role = roadBandRole(graph,lane);if (role.kind !== 'TRAVEL') continue;
      const stop = canonicalTransitStop(block.id,lane,role.dx ? role.dx > 0 ? 'E' : 'W' : role.dy > 0 ? 'S' : 'N');
      const candidate = { schemaVersion: 1 as const, layoutId: layout.id, processedBlockIds: [block.id], stops: [stop] };
      // The road planner must be able to revalidate its immutable routes
      // against the same full reservation after this stop is published.
      if (input.protectedRoads?.length && protectedRoads.intersects(cityTransitStopReservations(candidate,'ROAD')[0]!)) continue;
      const plaza = cityTransitStopReservations(candidate)[0]!;
      const all: Cell[] = [];
      for (let y=plaza.minY; y<=plaza.maxY; y++) for (let x=plaza.minX; x<=plaza.maxX; x++) all.push({x,y});
      if (all.some(p => graph.has(key(p)) || hard.has(p) || !dry(p))) continue;
      if (stop.shelter.some(p => surfaces.has(key(p)))) continue;
      if ([...stop.queue,...stop.accessPath].some(p => !surfaces.has(key(p))
        || !surfaces.has(`${p.x+role.dx},${p.y+role.dy}`) || !surfaces.has(`${p.x-role.dx},${p.y-role.dy}`)
        || directionDeltas.filter(([dx,dy]) => surfaces.has(`${p.x+dx},${p.y+dy}`)).length !== 2)) continue;
      // Keep the protected corridor away from an existing junction. An outer
      // two-way bend is still usable; a nearby T/crossing can seal later growth.
      let straight=true;
      for(let offset=-8;offset<=8;offset++){
        if(junctions.has(`${lane.x+role.dy+role.dx*offset},${lane.y-role.dx+role.dy*offset}`)){straight=false;break;}
      }
      if(!straight)continue;
      selected.push(stop);admission.add(stop);
      hard.add(plaza);
    }
    offered.set(block.id,selected);
  }
  const plan = yield* cityTransitStopPlanSteps({ layoutId: layout.id, blocks: layout.blocks, previous, candidates: block => offered.get(block.id) ?? [] });
  return { plan, metrics };
}
export function planCityTransitStops(input: CityTransitStopPlannerInput) { return completePreparation(cityTransitStopPlannerSteps(input)); }
export function prepareCityTransitStops(input: CityTransitStopPlannerInput, options: CooperativePreparationOptions = {}) {
  return prepareCooperatively(cityTransitStopPlannerSteps(input),options);
}
