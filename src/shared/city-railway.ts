import type { Cell, ChunkTaskDto, PlannedSiteDto, Rect } from "./contracts";

export type CityRailway = {
  stationId: string; axis: "horizontal" | "vertical"; from: Cell; to: Cell;
  platform: Cell; access: Cell[]; stage: number; running: boolean;
};
const key = (p: Cell) => `${p.x}:${p.y}`;
// Scene/corridor owners replace a plan when its geometry changes. The weak
// index dies with that plan; scenery tests must not reconstruct its footbridge
// and platform for thousands of cells during a cold city entry.
const approachIndexes = new WeakMap<CityRailway, { cells: Set<string>; bounds: Rect }>();

/** Keep scenery out of the ballast, platform and pedestrian approach. */
export function railwayIntersectsRect(line: CityRailway | undefined, origin: Cell, width: number, height: number): boolean {
  if (!line || line.stage <= 0) return false;
  const maxX = origin.x + width, maxY = origin.y + height;
  const track = line.axis === "horizontal"
    ? origin.y < line.from.y + 4 && maxY > line.from.y - 3 && origin.x <= line.to.x && maxX >= line.from.x
    : origin.x < line.from.x + 4 && maxX > line.from.x - 3 && origin.y <= line.to.y && maxY >= line.from.y;
  if (track) return true;
  let approach = approachIndexes.get(line);
  if (!approach) {
    const access = cityRailwayPassengerPaths(line).access;
    approach = { cells: new Set(access.map(key)), bounds: {
      minX: Math.min(...access.map(p => p.x)), maxX: Math.max(...access.map(p => p.x)),
      minY: Math.min(...access.map(p => p.y)), maxY: Math.max(...access.map(p => p.y)),
    } };
    approachIndexes.set(line, approach);
  }
  const r = approach.bounds;
  for (let y = Math.max(r.minY, Math.floor(origin.y)); y <= r.maxY && y < maxY; y++) {
    for (let x = Math.max(r.minX, Math.floor(origin.x)); x <= r.maxX && x < maxX; x++) {
      if (approach.cells.has(`${x}:${y}`)) return true;
    }
  }
  return false;
}

/** Derived once from the whole resident scene, never from viewport chunks.
 * A five-cell clear corridor includes ballast and platform. Existing parcels
 * and reservations remain immutable; the pedestrian approach may bend. */
export function planCityRailway(bounds: Rect, tasks: readonly Pick<ChunkTaskDto,"id"|"serviceRole"|"footprint"|"accessPath"|"stage"|"status">[], sites: readonly PlannedSiteDto[], roads: readonly Rect[] = [], preserveEastCoast = false): CityRailway | undefined {
  const station = tasks.filter(t => t.serviceRole === "RAILWAY" && t.footprint.length)
    .sort((a,b) => a.id.localeCompare(b.id))[0];
  if (!station) return undefined;
  const blocked = new Set<string>(), rows = new Set<number>(), columns = new Set<number>();
  let minX=bounds.minX, minY=bounds.minY, maxX=bounds.maxX, maxY=bounds.maxY;
  const occupy = (p: Cell) => {
    minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
    blocked.add(key(p));
    for (let d=-2;d<=2;d++) { rows.add(p.y+d); columns.add(p.x+d); }
  };
  for (const task of tasks) for (const p of task.footprint) occupy(p);
  for (const site of sites) for(let y=0;y<site.height;y++) for(let x=0;x<site.width;x++) occupy({x:site.origin.x+x,y:site.origin.y+y});
  minX-=16; minY-=16; maxX+=16; maxY+=16;
  const sx=Math.floor((Math.min(...station.footprint.map(p=>p.x))+Math.max(...station.footprint.map(p=>p.x)))/2);
  const start=station.accessPath.find(p=>!blocked.has(key(p))) ?? {x:sx,y:Math.max(...station.footprint.map(p=>p.y))+1};
  if (blocked.has(key(start))) return undefined;
  const queue: Cell[]=[start], parents=new Map<string,Cell|undefined>([[key(start),undefined]]);
  // This bound prevents malformed/extreme worlds from blocking a browser frame.
  for (let head=0;head<queue.length && head<50_000;head++) {
    const p=queue[head]!;
    // A free parcel row can still be a street. Keep the entire railway
    // corridor outside the resident city envelope, including sidewalks.
    const horizontal = !preserveEastCoast && (p.y < bounds.minY - 4 || p.y > bounds.maxY + 4) && !rows.has(p.y)
      && !roads.some(r => p.y >= r.minY - 4 && p.y <= r.maxY + 4);
    const vertical = (p.x < bounds.minX - 4 || !preserveEastCoast && p.x > bounds.maxX + 4) && !columns.has(p.x)
      && !roads.some(r => p.x >= r.minX - 4 && p.x <= r.maxX + 4);
    const axis = horizontal ? "horizontal" : vertical ? "vertical" : undefined;
    if (axis) {
      const access:Cell[]=[];
      for(let cursor:Cell|undefined=p;cursor;cursor=parents.get(key(cursor))) access.push(cursor);
      access.reverse();
      return {stationId:station.id,axis,from:axis==="horizontal"?{x:minX-240,y:p.y}:{x:p.x,y:minY-240},to:axis==="horizontal"?{x:maxX+240,y:p.y}:{x:p.x,y:maxY+240},platform:p,access,stage:station.stage,running:station.stage===5 && station.status==="COMPLETED"};
    }
    for(const [dx,dy] of [[0,1],[1,0],[-1,0],[0,-1]]) {
      const next={x:p.x+dx!,y:p.y+dy!}, id=key(next);
      if(next.x<minX || next.x>maxX || next.y<minY || next.y>maxY || blocked.has(id) || parents.has(id)) continue;
      parents.set(id,p); queue.push(next);
    }
  }
  return undefined;
}

export const CITY_TRAIN_SPACING = 3.125;
export const CITY_TRAIN_PARTS = 6;
/** The entire five-cell corridor is already reserved. Extending the old
 * platform inside that corridor changes neither parcels nor the track. */
export function cityRailwayPlatformSpan(line: CityRailway) {
  const platform = line.axis === "horizontal" ? line.platform.x : line.platform.y;
  const start = line.axis === "horizontal" ? line.from.x : line.from.y;
  const end = line.axis === "horizontal" ? line.to.x : line.to.y;
  return { start: Math.max(start + 1, platform - 20), end: Math.min(end - 1, platform + 3) };
}

/** Grade-separated end-of-platform footbridge. The old entrance approach is
 * retained up to the protected corridor; people never walk along a rail. */
export function cityRailwayPassengerPaths(line:CityRailway,platformLane:0|-1=0){
 const horizontal=line.axis==="horizontal",cross=horizontal?line.from.y:line.from.x;
 const along=horizontal?line.platform.x:line.platform.y,span=cityRailwayPlatformSpan(line);
 const point=(a:number,c:number):Cell=>horizontal?{x:a,y:c}:{x:c,y:a};
 let cut=line.access.length-1;
 while(cut>0&&Math.abs((horizontal?line.access[cut]!.y:line.access[cut]!.x)-cross)<2)cut--;
 const access=line.access.slice(0,cut+1).map(p=>({...p}));
 const bridgeAlong=along+3;
 const append=(target:Cell)=>{let current=access.at(-1)??point(bridgeAlong,cross+1);if(!access.length)access.push(current);
  while(current.x!==target.x){current={x:current.x+Math.sign(target.x-current.x),y:current.y};access.push(current);}
  while(current.y!==target.y){current={x:current.x,y:current.y+Math.sign(target.y-current.y)};access.push(current);}};
 const last=access.at(-1),side=last&&(horizontal?last.y:last.x)<cross?-2:2;
 if(last){append(horizontal?{x:last.x,y:cross+side}:{x:cross+side,y:last.y});append(point(bridgeAlong,cross+side));append(point(bridgeAlong,cross+1));}
 const bridge=Array.from({length:5},(_,i)=>point(bridgeAlong,cross-2+i));
 const platformCross=platformLane===0?cross+1:cross-2;
 const platform=Array.from({length:Math.max(0,Math.floor(span.end-span.start))},(_,i)=>[point(span.start+i,platformCross),point(span.start+i,platformCross+(platformLane===0?1:-1))]).flat();
 const boardingCells=Array.from({length:CITY_TRAIN_PARTS-1},(_,i)=>point(Math.floor(along-(i+1)*CITY_TRAIN_SPACING),platformCross));
 return {access,bridge,platform,boardingCells};
}
