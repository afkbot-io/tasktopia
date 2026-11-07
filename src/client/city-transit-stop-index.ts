import type { CanonicalTransitStop } from '../shared/city-transit-stops';
import type { Cell, Rect } from '../shared/contracts';
import { completePreparation,prepareCooperatively,type CooperativePreparationOptions } from '../shared/cooperative-preparation';
import type { TransitStop } from './city-everyday-life';

const key = (p: Cell) => `${p.x},${p.y}`;
export type TransitStopIndex = { size: number; byId: ReadonlyMap<string, TransitStop>;
  metrics: { maxVisited: number; maxBuckets: number };
  nearby: (center: Cell) => TransitStop[]; visible: (bounds: Rect) => readonly TransitStop[];
  isSheltered: (position: Cell) => boolean };
const prepared = new WeakMap<readonly CanonicalTransitStop[],TransitStopIndex>();
export function* transitStopIndexSteps(source: readonly CanonicalTransitStop[]): Generator<void, TransitStopIndex, void> {
  const retained=prepared.get(source);if(retained)return retained;
  const buckets = new Map<string, TransitStop[]>(), byId = new Map<string, TransitStop>(), queue = new Set<string>();
  for (const stop of source) {
    const runtime: TransitStop = { id: stop.id, lane: { ...stop.lane }, shelter: stop.shelter.map(p => ({ ...p })),
      queue: stop.queue.map(p => ({ ...p })), route: stop.accessPath.map(p => ({ ...p })),
      direction: stop.heading==='E'||stop.heading==='W'?'horizontal':'vertical' };
    byId.set(stop.id,runtime);
    const id = `${Math.floor(stop.lane.x/64)},${Math.floor(stop.lane.y/64)}`, list = buckets.get(id)??[];
    list.push(runtime);buckets.set(id,list);
    for (const p of stop.queue) queue.add(key(p));yield;
  }
  let signature = '', visible: TransitStop[] = [];
  const metrics = { maxVisited: 0, maxBuckets: 0 };
  const query = (bounds: Rect, limit: number): TransitStop[] => {
    if (!Object.values(bounds).every(Number.isFinite) || bounds.minX>bounds.maxX || bounds.minY>bounds.maxY) return [];
    const cx = (bounds.minX+bounds.maxX)/2, cy = (bounds.minY+bounds.maxY)/2;
    const x0 = Math.floor(bounds.minX/64), y0 = Math.floor(bounds.minY/64), x1 = Math.floor(bounds.maxX/64), y1 = Math.floor(bounds.maxY/64);
    let width = Math.min(64,x1-x0+1), height = Math.min(64,y1-y0+1);
    const ratio = width/height;
    while (width*height>64) { if (width/height>ratio) width--;else height--; }
    // Use the same64-bucket budget for wide and tall displays, rather than
    // cropping each axis to8 and losing an otherwise affordable visible edge.
    const minX = Math.max(x0,Math.floor(cx/64)-Math.floor(width/2)), minY = Math.max(y0,Math.floor(cy/64)-Math.floor(height/2));
    const maxX = Math.min(x1,minX+width-1), maxY = Math.min(y1,minY+height-1);
    const found: TransitStop[] = [];let visited = 0, count = 0;
    for (let y=minY; y<=maxY; y++) for (let x=minX; x<=maxX; x++) {
      count++;
      for (const stop of buckets.get(`${x},${y}`)??[]) {
        visited++;
        if (stop.lane.x>=bounds.minX && stop.lane.x<=bounds.maxX && stop.lane.y>=bounds.minY && stop.lane.y<=bounds.maxY) found.push(stop);
      }
    }
    metrics.maxVisited = Math.max(metrics.maxVisited,visited);metrics.maxBuckets = Math.max(metrics.maxBuckets,count);
    found.sort((a,b) => Math.abs(a.lane.x-cx)+Math.abs(a.lane.y-cy)-Math.abs(b.lane.x-cx)-Math.abs(b.lane.y-cy) || a.id.localeCompare(b.id));
    return found.slice(0,limit);
  };
  const index:TransitStopIndex = {
    size: byId.size, byId: byId as ReadonlyMap<string, TransitStop>, metrics,
    nearby(center: Cell): TransitStop[] { return query({ minX: center.x-128, minY: center.y-128, maxX: center.x+128, maxY: center.y+128 },16); },
    visible(bounds: Rect): readonly TransitStop[] {
      const rounded = { minX: Math.floor(bounds.minX/16)*16-8, minY: Math.floor(bounds.minY/16)*16-8,
        maxX: Math.ceil(bounds.maxX/16)*16+8, maxY: Math.ceil(bounds.maxY/16)*16+8 };
      const next = Object.values(rounded).join(':');
      if (next!==signature) { signature = next;visible = query(rounded,256); }
      return visible;
    },
    isSheltered(position: Cell): boolean {
      const x = Math.floor(position.x), y = Math.floor(position.y);
      for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) if (queue.has(`${x+dx},${y+dy}`)
        && Math.hypot(position.x-x-dx-.5,position.y-y-dy-.5)<1) return true;
      return false;
    },
  };
  prepared.set(source,index);return index;
}
export function createTransitStopIndex(source: readonly CanonicalTransitStop[]) {
  return completePreparation(transitStopIndexSteps(source));
}
export function prepareTransitStopIndexAsync(source: readonly CanonicalTransitStop[],options:CooperativePreparationOptions={}) {
  return prepareCooperatively(transitStopIndexSteps(source),options);
}
