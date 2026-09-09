import type { Cell, ChunkTaskDto, PlannedSiteDto, Rect } from "../shared/contracts";

export type CityRailway = {
  stationId: string; axis: "horizontal" | "vertical"; from: Cell; to: Cell;
  platform: Cell; access: Cell[]; stage: number; running: boolean;
};
const key = (p: Cell) => `${p.x}:${p.y}`;

/** Keep scenery out of the ballast, platform and pedestrian approach. */
export function railwayIntersectsRect(line: CityRailway | undefined, origin: Cell, width: number, height: number): boolean {
  if (!line || line.stage <= 0) return false;
  const maxX = origin.x + width, maxY = origin.y + height;
  const track = line.axis === "horizontal"
    ? origin.y < line.from.y + 3 && maxY > line.from.y - 1 && origin.x <= line.to.x && maxX >= line.from.x
    : origin.x < line.from.x + 3 && maxX > line.from.x - 1 && origin.y <= line.to.y && maxY >= line.from.y;
  return track || line.access.some(p => p.x < maxX && p.x + 1 > origin.x && p.y < maxY && p.y + 1 > origin.y);
}

/** Derived once from the whole resident scene, never from viewport chunks.
 * A five-cell clear corridor includes ballast and platform. Existing parcels
 * and reservations remain immutable; the pedestrian approach may bend. */
export function planCityRailway(bounds: Rect, tasks: readonly ChunkTaskDto[], sites: readonly PlannedSiteDto[]): CityRailway | undefined {
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
    const axis=!rows.has(p.y)?"horizontal":!columns.has(p.x)?"vertical":undefined;
    if (axis) {
      const access:Cell[]=[];
      for(let cursor:Cell|undefined=p;cursor;cursor=parents.get(key(cursor))) access.push(cursor);
      access.reverse();
      return {stationId:station.id,axis,from:axis==="horizontal"?{x:minX,y:p.y}:{x:p.x,y:minY},to:axis==="horizontal"?{x:maxX,y:p.y}:{x:p.x,y:maxY},platform:p,access,stage:station.stage,running:station.stage===5 && station.status==="COMPLETED"};
    }
    for(const [dx,dy] of [[0,1],[1,0],[-1,0],[0,-1]]) {
      const next={x:p.x+dx!,y:p.y+dy!}, id=key(next);
      if(next.x<minX || next.x>maxX || next.y<minY || next.y>maxY || blocked.has(id) || parents.has(id)) continue;
      parents.set(id,p); queue.push(next);
    }
  }
  return undefined;
}

/** Four coupled vehicles. The complete consist exits before its next arrival. */
export function cityTrainPosition(line:CityRailway,elapsedMs:number):Cell[] {
  const length=Math.abs(line.to.x-line.from.x)+Math.abs(line.to.y-line.from.y);
  const lead=(Math.max(0,elapsedMs)*.005)%(length+18)-4;
  return Array.from({length:4},(_,index)=>line.axis==="horizontal"
    ? {x:line.from.x+lead-index*3.5,y:line.from.y+.5}
    : {x:line.from.x+.5,y:line.from.y+lead-index*3.5});
}
