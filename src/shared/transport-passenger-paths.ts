import type {Cell} from './contracts';
import type {AirportSitePlan} from './airport-site';
import type {LocalPortSitePlan} from './port-site';
/** Native paved loops let waiting pedestrians leave without reversing into
 * their incoming queue. Geometry stays inside reserved terminal clearances. */
export function airportPassengerCells(plan:AirportSitePlan):Cell[]{
 const cells:Cell[]=[...plan.access,plan.gate];
 for(let x=plan.airfield.minX+8;x<=plan.airfield.minX+29;x++)cells.push({x,y:plan.gate.y-1});
 for(const stand of plan.stands)for(const dx of [-1,0])for(const dy of [1,2])cells.push({x:stand.x+dx,y:stand.y+dy});
 return cells;
}
export function portPassengerDeck(plan:LocalPortSitePlan):Cell[]{
 const end=plan.pier.at(-1),previous=plan.pier.at(-2);if(!end||!previous)return [...plan.pier];
 const dx=end.x-previous.x,dy=end.y-previous.y;
 const side=(plan.berth.x-end.x)*-dy+(plan.berth.y-end.y)*dx>0?-1:1;
 return [...plan.pier,...plan.pier.slice(-3).map(p=>({x:p.x-dy*side,y:p.y+dx*side}))];
}
