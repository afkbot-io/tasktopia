import type { Cell, ChunkTaskDto, RoadCellDto, SurfaceCellDto } from '../shared/contracts';
import { roadBandRole } from '../shared/road-profile';

export type CityParkingPlan={id:string;route:Cell[];bay:Cell};
type ParkingTask=Pick<ChunkTaskDto,'id'|'visualAssetKey'|'status'|'stage'|'footprint'>;
const key=(cell:Cell)=>`${cell.x},${cell.y}`;

/** Two distinct curb crossings form a forward-only loop. Every interior cell
 * must already be paved and free: no invented driveway through grass/water or
 * a neighbouring building. Small/inaccessible lots remain static parking. */
export function planCityParking(tasks:readonly ParkingTask[],roads:ReadonlyMap<string,RoadCellDto>,surfaces:readonly Pick<SurfaceCellDto,'x'|'y'|'kind'>[],blocked:ReadonlySet<string>):CityParkingPlan[] {
  const paved=new Set(surfaces.filter(c=>['SIDEWALK','PATH','DRIVEWAY'].includes(c.kind)).map(key));
  const used=new Set<string>(),result:CityParkingPlan[]=[];
  const candidates=[...roads.values()].sort((a,b)=>a.y-b.y||a.x-b.x);
  for(const task of [...tasks].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(task.status!=='COMPLETED'||task.stage!==5||task.visualAssetKey!=='urban-parking'||task.footprint.length<12)continue;
    const lot=new Set(task.footprint.map(key));
    const pavedLot=new Set([...paved,...lot]);
    const minX=Math.min(...task.footprint.map(c=>c.x)),maxX=Math.max(...task.footprint.map(c=>c.x));
    const minY=Math.min(...task.footprint.map(c=>c.y)),maxY=Math.max(...task.footprint.map(c=>c.y));
    let found:CityParkingPlan|undefined;
    for(const entry of candidates) {
      if(entry.x<minX-8||entry.x>maxX+8||entry.y<minY-8||entry.y>maxY+8)continue;
      const role=roadBandRole(roads,entry);if(role.kind!=='TRAVEL')continue;
      // Right-side curb only; a visit never cuts across oncoming traffic.
      const normal={x:-role.dy,y:role.dx};
      for(let depth=2;depth<=8&&!found;depth++)for(const span of [3,4,5]) {
        const point=(along:number,out:number)=>({x:entry.x+role.dx*along+normal.x*out,y:entry.y+role.dy*along+normal.y*out});
        const exit=point(span,0),exitRoad=roads.get(key(exit));if(!exitRoad)continue;
        const exitRole=roadBandRole(roads,exitRoad);
        if(exitRole.kind!=='TRAVEL'||exitRole.dx!==role.dx||exitRole.dy!==role.dy)continue;
        const route:Cell[]=[entry];
        for(let n=1;n<=depth;n++)route.push(point(0,n));
        for(let n=1;n<=span;n++)route.push(point(n,depth));
        for(let n=depth-1;n>=0;n--)route.push(point(span,n));
        const bay=point(Math.floor(span/2),depth);
        if(![{x:0,y:0},{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].every(d=>lot.has(key({x:bay.x+d.x,y:bay.y+d.y})))||route.slice(1,-1).some(c=>roads.has(key(c))||!pavedLot.has(key(c))||blocked.has(key(c))||used.has(key(c))))continue;
        // The parking aisle and its two turning corners belong to this lot.
        if(!Array.from({length:span+1},(_,n)=>point(n,depth)).every(c=>lot.has(key(c))))continue;
        found={id:task.id,route,bay};break;
      }
      if(found)break;
    }
    if(found) {result.push(found);found.route.slice(1,-1).forEach(c=>used.add(key(c)));}
  }
  return result;
}
