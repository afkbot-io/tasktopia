import type {AirportSitePlan} from './airport-site';
import {airportPassengerCells} from './transport-passenger-paths';
import {cityRailwayPassengerPaths,cityRailwayPlatformSpan,type CityRailway} from './city-railway';
import type {Cell,Rect} from './contracts';

export type CityTransportFurniture={id:string;taskId:string;kind:'airport-windsock'|'rail-platform-clock';origin:Cell};
type Task={stage:number;status:string;serviceRole?:string|null};
type Input={airports:readonly {taskId:string;stage:number;plan:AirportSitePlan|null}[];railway?:CityRailway;
  tasks:{get:(id:string)=>Task|undefined};free:(cell:Cell)=>boolean};
const key=(p:Cell)=>`${p.x},${p.y}`;
const valid=(p:Cell)=>Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y);
const inside=(p:Cell,r:Rect)=>p.x>=r.minX&&p.x<=r.maxX&&p.y>=r.minY&&p.y<=r.maxY;
const alive=(input:Input,id:string,role:string)=>{const task=input.tasks.get(id);return task?.stage===5&&task.status==='COMPLETED'&&task.serviceRole===role;};
// The upright authored image can overhang its1x1 ground contact. Require the
// whole conservative3x2 visible envelope to stay clear of passenger routes.
const envelope=(p:Cell)=>[-1,0,1].flatMap(dx=>[-1,0].map(dy=>({x:p.x+dx,y:p.y+dy})));

/** Only canonical reserved transport land is eligible. Server reservations
 * already exclude parcels/streets; the local free lookup additionally checks
 * current terrain/infrastructure. No task catalog or world graph enumeration. */
export function resolveCityTransportFurniture(input:Input):CityTransportFurniture[]{
  const result:CityTransportFurniture[]=[],claimed=new Set<string>();
  const accept=(prop:CityTransportFurniture,reserved:(p:Cell)=>boolean,passengers:ReadonlySet<string>)=>{
    const cells=envelope(prop.origin);
    if(!cells.every(p=>reserved(p)&&!passengers.has(key(p))&&!claimed.has(key(p))&&input.free(p)))return false;
    result.push(prop);for(const p of cells)claimed.add(key(p));return true;
  };
  const ids=new Set<string>();
  for(const site of input.airports.slice(0,32)){
    const plan=site.plan;if(site.stage!==5||!plan||ids.has(site.taskId)||!alive(input,site.taskId,'AIRPORT'))continue;
    ids.add(site.taskId);const r=plan.airfield;
    if(plan.schemaVersion!==1||!Object.values(r).every(Number.isSafeInteger)||r.maxX-r.minX!==37||r.maxY-r.minY!==13
      ||!valid(plan.gate)||plan.access.length>4096||plan.stands.length>8||plan.taxiPath.length>32||plan.runway.length!==2
      ||![...plan.access,...plan.stands,...plan.taxiPath,...plan.runway].every(valid))continue;
    const passengers=new Set(airportPassengerCells(plan).map(key));
    const reserved=(p:Cell)=>inside(p,r)&&!plan.stands.some(s=>p.x>=s.x-2&&p.x<=s.x+1&&p.y>=s.y-1&&p.y<=s.y+1)
      &&!plan.runway.some((a,i)=>i===0&&p.x>=Math.min(a.x,plan.runway[1].x)-1&&p.x<=Math.max(a.x,plan.runway[1].x)+1
        &&p.y>=Math.min(a.y,plan.runway[1].y)-1&&p.y<=Math.max(a.y,plan.runway[1].y)+1)
      &&!plan.taxiPath.some((a,i)=>{const b=plan.taxiPath[i+1];return b&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y);});
    for(const offset of [2,35])if(accept({id:`transport-furniture:${site.taskId}:windsock`,taskId:site.taskId,kind:'airport-windsock',
      origin:{x:r.minX+offset,y:r.minY+11}},reserved,passengers))break;
  }
  const line=input.railway;
  if(!line||line.stage!==5||!alive(input,line.stationId,'RAILWAY')||!['horizontal','vertical'].includes(line.axis)
    ||line.access.length>4096||![line.from,line.to,line.platform,...line.access].every(valid))return result;
  const horizontal=line.axis==='horizontal',along=(p:Cell)=>horizontal?p.x:p.y,cross=(p:Cell)=>horizontal?p.y:p.x;
  const start=along(line.from),end=along(line.to),c=cross(line.from);
  if(end-start<4||end-start>8192||cross(line.to)!==c||cross(line.platform)!==c||along(line.platform)<start||along(line.platform)>end
    ||line.access.some(p=>Math.abs(along(p)-along(line.platform)-3)+Math.abs(cross(p)-c)>4096))return result;
  const passengers=new Set([0,-1].flatMap(lane=>{const p=cityRailwayPassengerPaths(line,lane as 0|-1);
    return [...p.access,...p.bridge,...p.platform,...p.boardingCells];}).map(key));
  const span=cityRailwayPlatformSpan(line),reserved=(p:Cell)=>along(p)>=start&&along(p)<end&&cross(p)>=c-2&&cross(p)<=c+3;
  // A tall upright clock directly behind walking lanes would hide people.
  // Inspect four protected end pockets; a river can make one end unsuitable.
  for(const a of [span.start-2,span.end+2,span.start-3,span.end+3]){
    const origin=horizontal?{x:a,y:c+2}:{x:c+2,y:a};
    if(accept({id:`transport-furniture:${line.stationId}:clock`,taskId:line.stationId,kind:'rail-platform-clock',origin},reserved,passengers))break;
  }
  return result;
}
