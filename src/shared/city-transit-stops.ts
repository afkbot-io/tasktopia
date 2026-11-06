import type { CardinalOrientation, Cell, Rect } from './contracts';
import { CITY_SCENE_MAX_CHUNKS } from './city-capacity';

/** Server-owned infrastructure; task states never choose or move a stop. */
export type CanonicalTransitStop = Readonly<{
  id: string;
  blockId: string;
  lane: Readonly<Cell>;
  heading: CardinalOrientation;
  shelter: readonly Readonly<Cell>[];
  queue: readonly Readonly<Cell>[];
  accessPath: readonly Readonly<Cell>[];
}>;

export type CityTransitStopPlan = Readonly<{
  schemaVersion: 1;
  layoutId: string;
  processedBlockIds: readonly string[];
  stops: readonly CanonicalTransitStop[];
}>;

const directions = { N: [0,-1], E: [1,0], S: [0,1], W: [-1,0] } as const;
const point = (x: number, y: number): Readonly<Cell> => {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new RangeError('Invalid transit stop coordinates');
  return Object.freeze({ x: x || 0, y: y || 0 });
};

/** Direction is the actual travel lane heading. Each sprite keeps its native
 * horizontal/vertical artwork; no runtime rotation or task entrance is used. */
export function canonicalTransitStop(blockId: string, lane: Cell, heading: CardinalOrientation): CanonicalTransitStop {
  if (typeof blockId !== 'string' || !blockId.trim() || blockId.length > 256 || !lane || !Object.hasOwn(directions, heading))
    throw new RangeError('Invalid transit stop identity or heading');
  const origin = point(lane.x, lane.y), [dx,dy] = directions[heading], nx = -dy, ny = dx;
  if (Math.abs(origin.x) > Number.MAX_SAFE_INTEGER-16 || Math.abs(origin.y) > Number.MAX_SAFE_INTEGER-16)
    throw new RangeError('Unsafe transit stop corridor');
  const curb = point(origin.x+nx, origin.y+ny), shelter = point(curb.x+nx, curb.y+ny);
  return Object.freeze({
    id: `stop:${origin.x},${origin.y}`, blockId, lane: origin, heading,
    shelter: Object.freeze([shelter, point(shelter.x+dx,shelter.y+dy), point(shelter.x+nx,shelter.y+ny), point(shelter.x+dx+nx,shelter.y+dy+ny)]),
    queue: Object.freeze([curb, point(curb.x+dx,curb.y+dy), point(curb.x-dx,curb.y-dy)]),
    accessPath: Object.freeze(Array.from({ length: 7 }, (_,i) => point(curb.x-(7-i)*dx,curb.y-(7-i)*dy))),
  });
}

/** Two outer curb neighbours keep the seven-cell route and three waiting
 * cells connected when native furniture is generated around this feature. */
export function canonicalTransitStopWalkway(stop: CanonicalTransitStop): readonly Readonly<Cell>[] {
  const [dx,dy] = directions[stop.heading], curb = stop.queue[0]!;
  return Object.freeze([point(curb.x-8*dx,curb.y-8*dy),...stop.accessPath,curb,stop.queue[1]!,point(curb.x+2*dx,curb.y+2*dy)]);
}

/** A small public pocket makes an actual pedestrian loop around the native
 * shelter. Keep the eleven front cells first for its protected waiting strip.
 * Unlike an isolated one-cell spur it has a physical outdoor turnaround. */
export function canonicalTransitStopPublicWalkway(stop: CanonicalTransitStop): readonly Readonly<Cell>[] {
  const front = canonicalTransitStopWalkway(stop), [dx,dy] = directions[stop.heading], nx = -dy, ny = dx;
  const first = front[0]!, last = front.at(-1)!;
  return Object.freeze([...front,point(last.x+nx,last.y+ny),point(last.x+2*nx,last.y+2*ny),
    ...[...front].reverse().map(p => point(p.x+3*nx,p.y+3*ny)),
    point(first.x+2*nx,first.y+2*ny),point(first.x+nx,first.y+ny)]);
}

export const CITY_TRANSIT_REGION_SIZE = 64;
export const CITY_TRANSIT_STOPS_PER_REGION = 4;
const MAX_BLOCKS = CITY_SCENE_MAX_CHUNKS * 16;
const MAX_STOPS = CITY_SCENE_MAX_CHUNKS * 8; // includes the outer region halo
const invalid = (): never => { throw new RangeError('Invalid canonical transit stop plan'); };
const identity = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 256;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : invalid();
const samePoints = (value: unknown, expected: readonly Readonly<Cell>[]) => Array.isArray(value) && value.length === expected.length
  && value.every((cell, i) => cell && typeof cell === 'object' && cell.x === expected[i]!.x && cell.y === expected[i]!.y);

function readStop(value: unknown): CanonicalTransitStop {
  const source = record(value);
  if (!identity(source.blockId)) return invalid();
  const lane = record(source.lane);
  const stop = canonicalTransitStop(source.blockId, point(lane.x as number,lane.y as number), source.heading as CardinalOrientation);
  if (source.id !== stop.id || !samePoints(source.shelter, stop.shelter) || !samePoints(source.queue, stop.queue)
    || !samePoints(source.accessPath, stop.accessPath)) return invalid();
  return stop;
}

/** At most four admitted stops per64-cell region; each16-cell spacing query
 * reads nine tiny neighbouring buckets, independent of city size. */
export class CityTransitStopAdmission {
  private cells = new Map<string, CanonicalTransitStop[]>();
  private regions = new Map<string, number>();
  private region(stop: Pick<CanonicalTransitStop, 'lane'>) { return `${Math.floor(stop.lane.x/CITY_TRANSIT_REGION_SIZE)},${Math.floor(stop.lane.y/CITY_TRANSIT_REGION_SIZE)}`; }
  canAdd(stop: Pick<CanonicalTransitStop, 'lane'>): boolean {
    if ((this.regions.get(this.region(stop)) ?? 0) >= CITY_TRANSIT_STOPS_PER_REGION) return false;
    const x = Math.floor(stop.lane.x/16), y = Math.floor(stop.lane.y/16);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (this.cells.get(`${x+dx},${y+dy}`)?.some(other => Math.abs(other.lane.x-stop.lane.x)+Math.abs(other.lane.y-stop.lane.y) < 12)) return false;
    return true;
  }
  hasCapacityIn(bounds: Rect): boolean {
    if (![bounds.minX,bounds.minY,bounds.maxX,bounds.maxY].every(Number.isSafeInteger) || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY)
      throw new RangeError('Invalid transit capacity extent');
    const minX = Math.floor(bounds.minX/CITY_TRANSIT_REGION_SIZE), minY = Math.floor(bounds.minY/CITY_TRANSIT_REGION_SIZE);
    const maxX = Math.floor(bounds.maxX/CITY_TRANSIT_REGION_SIZE), maxY = Math.floor(bounds.maxY/CITY_TRANSIT_REGION_SIZE);
    if (maxX-minX > 3 || maxY-minY > 3) throw new RangeError('Transit capacity query exceeded its local budget');
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++)
      if ((this.regions.get(`${x},${y}`) ?? 0) < CITY_TRANSIT_STOPS_PER_REGION) return true;
    return false;
  }
  add(stop: CanonicalTransitStop) {
    const id = `${Math.floor(stop.lane.x/16)},${Math.floor(stop.lane.y/16)}`, values = this.cells.get(id) ?? [];
    values.push(stop);this.cells.set(id, values);
    const region = this.region(stop);this.regions.set(region, (this.regions.get(region) ?? 0)+1);
  }
}

/** Persisted values are validated and snapshotted before native paths or
 * resource allocation trust them. No stored coordinate array escapes. */
export function readCityTransitStopPlan(value: unknown, layoutId: string): CityTransitStopPlan {
  const source = record(value);
  if (!identity(layoutId) || source.schemaVersion !== 1 || source.layoutId !== layoutId
    || !Array.isArray(source.processedBlockIds) || source.processedBlockIds.length > MAX_BLOCKS
    || !Array.isArray(source.stops) || source.stops.length > MAX_STOPS) return invalid();
  const blocks = new Set<string>();
  for (const id of source.processedBlockIds) {
    if (!identity(id) || blocks.has(id)) return invalid();
    blocks.add(id);
  }
  const stops = readCanonicalTransitStops(source.stops);
  for (const stop of stops) if (!blocks.has(stop.blockId)) return invalid();
  return Object.freeze({ schemaVersion: 1, layoutId, processedBlockIds: Object.freeze([...blocks]), stops });
}

export function readCanonicalTransitStops(value: unknown): readonly CanonicalTransitStop[] {
  if (!Array.isArray(value) || value.length>MAX_STOPS) return invalid();
  const stops: CanonicalTransitStop[] = [], ids = new Set<string>(), perBlock = new Map<string, number>(), admission = new CityTransitStopAdmission();
  for (const valueStop of value) {
    const stop = readStop(valueStop), count = (perBlock.get(stop.blockId) ?? 0)+1;
    if (ids.has(stop.id) || count > 4 || !admission.canAdd(stop)) return invalid();
    ids.add(stop.id);perBlock.set(stop.blockId,count);admission.add(stop);stops.push(stop);
  }
  return Object.freeze(stops);
}

type StopBlock = { id: string; sequence: number };
export type CityTransitStopPlanInput = {
  layoutId: string; blocks: readonly StopBlock[]; previous?: CityTransitStopPlan;
  candidates: (block: StopBlock) => readonly CanonicalTransitStop[];
};
/** Only never-processed immutable blocks may offer new infrastructure. A
 * failed candidate cannot move or replace any previously published stop. */
export function* cityTransitStopPlanSteps(input: CityTransitStopPlanInput): Generator<void, CityTransitStopPlan, void> {
  if (!identity(input.layoutId) || !Array.isArray(input.blocks) || input.blocks.length > MAX_BLOCKS
    || typeof input.candidates !== 'function') return invalid();
  const blockIds = new Set<string>(), ordered: StopBlock[] = [];
  for (const block of input.blocks) {
    if (!block || !identity(block.id) || blockIds.has(block.id) || !Number.isSafeInteger(block.sequence) || block.sequence < 0) return invalid();
    blockIds.add(block.id);ordered.push({ id: block.id, sequence: block.sequence });yield;
  }
  ordered.sort((a,b) => a.sequence-b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const previous = input.previous ? readCityTransitStopPlan(input.previous,input.layoutId)
    : readCityTransitStopPlan({ schemaVersion: 1, layoutId: input.layoutId, processedBlockIds: [], stops: [] },input.layoutId);
  const processed = new Set(previous.processedBlockIds), stops = [...previous.stops], ids = new Set(stops.map(stop => stop.id)), admission = new CityTransitStopAdmission();
  for (const stop of stops) { admission.add(stop);yield; }
  for (const block of ordered) {
    yield;if (processed.has(block.id)) continue;
    const offered = input.candidates(block);
    if (!Array.isArray(offered) || offered.length > 4 || processed.size >= MAX_BLOCKS) return invalid();
    processed.add(block.id);
    for (const value of offered) {
      const stop = readStop(value);yield;
      if (stop.blockId !== block.id) return invalid();
      if (ids.has(stop.id) || !admission.canAdd(stop)) continue;
      if (stops.length >= MAX_STOPS) return invalid();
      stops.push(stop);ids.add(stop.id);admission.add(stop);
    }
  }
  return Object.freeze({ schemaVersion: 1, layoutId: input.layoutId, processedBlockIds: Object.freeze([...processed]), stops: Object.freeze(stops) });
}
export function extendCityTransitStopPlan(input: CityTransitStopPlanInput): CityTransitStopPlan {
  const steps = cityTransitStopPlanSteps(input);
  for (;;) { const next = steps.next();if (next.done) return next.value; }
}

export function cityTransitStopReservations(plan: CityTransitStopPlan, purpose: 'PARCEL' | 'ROAD' = 'PARCEL'): Rect[] {
  return plan.stops.map(stop => {
    const points = [...stop.shelter,...canonicalTransitStopPublicWalkway(stop)];
    if (purpose === 'ROAD') {
      const [dx,dy] = directions[stop.heading], nx = -dy, ny = dx;
      for (const along of [-8,8]) for (const across of [-3,3]) points.push(point(stop.lane.x+along*dx+across*nx,stop.lane.y+along*dy+across*ny));
    }
    return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
      maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
  });
}

/** A new block may share the already existing parallel street. Vetoing its
 * whole envelope would seal a small city's frontier after its first stops. */
export function createCityTransitStopBlockGuard(stops: readonly CanonicalTransitStop[]): (envelope: Rect) => boolean {
  const buckets = new Map<string, Array<{ road: Rect; horizontal: boolean; center: number }>>();
  const overlap = (a: Rect,b: Rect) => a.minX<=b.maxX && a.maxX>=b.minX && a.minY<=b.maxY && a.maxY>=b.minY;
  for (const stop of stops) {
    const plan: CityTransitStopPlan = { schemaVersion: 1, layoutId: 'guard', processedBlockIds: [stop.blockId], stops: [stop] };
    const road = cityTransitStopReservations(plan,'ROAD')[0]!;
    const [dx,dy] = directions[stop.heading], horizontal = dx!==0;
    const record = { road,horizontal,center: horizontal ? stop.lane.y-dx : stop.lane.x+dy };
    for (let y=Math.floor(road.minY/64); y<=Math.floor(road.maxY/64); y++) for (let x=Math.floor(road.minX/64); x<=Math.floor(road.maxX/64); x++) {
      const id = `${x},${y}`, list = buckets.get(id)??[];list.push(record);buckets.set(id,list);
    }
  }
  return envelope => {
    const b = { minX: envelope.minX+2, minY: envelope.minY+2, maxX: envelope.maxX-2, maxY: envelope.maxY-2 };
    const edges = [
      { horizontal: true, center: b.minY, rect: { ...b, minY: b.minY-1, maxY: b.minY+1 } },
      { horizontal: true, center: b.maxY, rect: { ...b, minY: b.maxY-1, maxY: b.maxY+1 } },
      { horizontal: false, center: b.minX, rect: { ...b, minX: b.minX-1, maxX: b.minX+1 } },
      { horizontal: false, center: b.maxX, rect: { ...b, minX: b.maxX-1, maxX: b.maxX+1 } },
    ];
    const seen = new Set<object>();
    for (let y=Math.floor(envelope.minY/64); y<=Math.floor(envelope.maxY/64); y++) for (let x=Math.floor(envelope.minX/64); x<=Math.floor(envelope.maxX/64); x++) {
      for (const record of buckets.get(`${x},${y}`)??[]) {
        if (seen.has(record)) continue;seen.add(record);
        for (const edge of edges) if (overlap(edge.rect,record.road)
          && !(edge.horizontal===record.horizontal && edge.center===record.center)) return false;
      }
    }
    return true;
  };
}
