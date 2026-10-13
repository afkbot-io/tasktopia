/** One primary ready stop per city and a deterministic chain. Each city has
 * at most two neighbours. O(n log n), independent of camera, projection, array
 * order and personal visibility of other countries. Call once per country. */
export type TransportNetworkEdge = { fromCityId: string; toCityId: string };
export function countryTransportNetwork<T extends { taskId: string; cityId: string }>(endpoints: readonly T[], edges?: readonly TransportNetworkEdge[]): Array<{from:T;to:T}> {
  const primary=new Map<string,T>();
  for(const endpoint of endpoints){
    const previous=primary.get(endpoint.cityId);
    if(!previous || endpoint.taskId<previous.taskId)primary.set(endpoint.cityId,endpoint);
  }
  const cities=[...primary.values()].sort((a,b)=>a.cityId<b.cityId?-1:a.cityId>b.cityId?1:0);
  if (edges) return edges.flatMap(edge=>{
    const from=primary.get(edge.fromCityId),to=primary.get(edge.toCityId);
    return from&&to&&from.cityId!==to.cityId?[{from,to}]:[];
  });
  return cities.slice(1).map((to,index)=>({from:cities[index]!,to}));
}

/** A retained sparse chain in canonical country coordinates. Existing valid
 * edges win. New components join a bounded spatial window of16 candidates;
 * this avoids all-pairs distance matrices and limits each station to2 lines. */
export function retainedTransportNetwork(endpoints: readonly {taskId:string;cityId:string;point:{x:number;y:number}}[], previous: readonly TransportNetworkEdge[]): TransportNetworkEdge[] {
  const primary=new Map<string,(typeof endpoints)[number]>();
  for(const stop of endpoints)if(!primary.has(stop.cityId)||stop.taskId<primary.get(stop.cityId)!.taskId)primary.set(stop.cityId,stop);
  const parents=new Map([...primary.keys()].map(id=>[id,id])),degree=new Map<string,number>(),result:TransportNetworkEdge[]=[];
  const root=(id:string):string=>{let p=id;while(parents.get(p)!==p)p=parents.get(p)!;while(id!==p){const next=parents.get(id)!;parents.set(id,p);id=next;}return p;};
  const add=(a:string,b:string)=>{
    if(!primary.has(a)||!primary.has(b)||a===b||(degree.get(a)??0)>=2||(degree.get(b)??0)>=2||root(a)===root(b))return false;
    parents.set(root(b),root(a));degree.set(a,(degree.get(a)??0)+1);degree.set(b,(degree.get(b)??0)+1);
    const [fromCityId,toCityId]=[a,b].sort() as [string,string];result.push({fromCityId,toCityId});return true;
  };
  for(const edge of previous)add(edge.fromCityId,edge.toCityId);
  const compare=(a:string,b:string)=>primary.get(a)!.point.x-primary.get(b)!.point.x||primary.get(a)!.point.y-primary.get(b)!.point.y||a.localeCompare(b);
  const components=new Map<string,string[]>();
  for(const id of primary.keys())if((degree.get(id)??0)<2){const r=root(id),ends=components.get(r)??[];ends.push(id);components.set(r,ends);}
  const ordered=[...components.values()].map(ends=>ends.sort(compare)).sort((a,b)=>compare(a[0]!,b[0]!));
  if(!ordered.length)return [];
  let tail=ordered[0]!.at(-1)!,cursor=1;
  const window:string[][]=[];
  while(cursor<ordered.length||window.length){
    while(cursor<ordered.length&&window.length<16)window.push(ordered[cursor++]!);
    const origin=primary.get(tail)!.point;
    let bestIndex=0,bestEnd=window[0]![0]!,bestDistance=Infinity;
    window.forEach((ends,index)=>ends.forEach(id=>{const p=primary.get(id)!.point,d=(p.x-origin.x)**2+(p.y-origin.y)**2;
      if(d<bestDistance||d===bestDistance&&compare(id,bestEnd)<0){bestIndex=index;bestEnd=id;bestDistance=d;}}));
    const ends=window.splice(bestIndex,1)[0]!;
    add(tail,bestEnd);tail=ends.find(id=>id!==bestEnd)??bestEnd;
  }
  return result.sort((a,b)=>a.fromCityId.localeCompare(b.fromCityId)||a.toCityId.localeCompare(b.toCityId));
}

export type TimetabledRailEdge = TransportNetworkEdge & { arrivalPhaseMs: number };
/** Immutable windows on two platforms. Each platform has36-second separation
 * for18seconds dwell plus6seconds clearance. Four18-second slots permit two
 * domestic and two foreign lines without changing published valid timings. */
export function railwayTimetable(edges: readonly TransportNetworkEdge[], previous: readonly TimetabledRailEdge[],strict=true): TimetabledRailEdge[] {
  const period=72_000,dwell=24_000,slots=[0,18_000,36_000,54_000];
  const key=(edge:TransportNetworkEdge)=>`${edge.fromCityId}:${edge.toCityId}`;
  const old=new Map(previous.map(edge=>[key(edge),edge]));
  const result:TimetabledRailEdge[]=[],published=new Set<string>(),phases=new Map<string,number[]>();
  const phase=(value:number)=>((value%period)+period)%period;
  const add=(edge:TimetabledRailEdge)=>{result.push(edge);published.add(key(edge));for(const [id,p] of [[edge.fromCityId,edge.arrivalPhaseMs],[edge.toCityId,phase(edge.arrivalPhaseMs+108_000)]] as const){const values=phases.get(id)??[];values.push(p);phases.set(id,values);}};
  const free=(edge:TransportNetworkEdge,candidate:number)=>[...(phases.get(edge.fromCityId)??[]),...(phases.get(edge.toCityId)??[]).map(p=>phase(p-108_000))].every(p=>{if(p%36_000!==candidate%36_000)return true;const delta=phase(candidate-p);return delta>=dwell&&delta<=period-dwell;});
  for(const edge of edges){const saved=old.get(key(edge));if(saved&&slots.includes(phase(saved.arrivalPhaseMs))&&free(edge,phase(saved.arrivalPhaseMs)))add({...edge,arrivalPhaseMs:phase(saved.arrivalPhaseMs)});}
  for(const edge of edges){
    if(published.has(key(edge)))continue;
    const available=slots.find(candidate=>free(edge,candidate));
    if(available===undefined){if(strict)throw new Error("No safe railway platform window");continue;}
    add({...edge,arrivalPhaseMs:available});
  }
  return result.sort((a,b)=>key(a).localeCompare(key(b)));
}
export function railwayScheduleOffset(edge: TimetabledRailEdge, fromTaskId: string, toTaskId: string): number {
  return (fromTaskId<toTaskId?0:108_000)-edge.arrivalPhaseMs;
}

export type TimetabledAirEdge=TransportNetworkEdge & {arrivalPhaseMs:number};
/** One100-second headway, four25-second terminal slots. Arrival movement
 * ends at the slot start; departure movement starts25seconds later. A slot
 * owns11seconds on either side, leaving3seconds between moving aircraft. */
function slotTimetable(edges:readonly TransportNetworkEdge[],previous:readonly TimetabledAirEdge[],slotMs:number,strict:boolean):TimetabledAirEdge[]{
 const key=(edge:TransportNetworkEdge)=>`${edge.fromCityId}:${edge.toCityId}`;
 const slots=Array.from({length:4},(_,i)=>i*slotMs);
 const old=new Map(previous.filter(edge=>slots.includes(edge.arrivalPhaseMs)).map(edge=>[key(edge),edge]));
 const result:TimetabledAirEdge[]=[],used=new Map<string,Set<number>>(),published=new Set<string>();
 const add=(edge:TimetabledAirEdge)=>{for(const id of [edge.fromCityId,edge.toCityId]){const slots=used.get(id)??new Set();slots.add(edge.arrivalPhaseMs);used.set(id,slots);}result.push(edge);published.add(key(edge));};
 for(const edge of edges){const saved=old.get(key(edge));if(saved&&!used.get(edge.fromCityId)?.has(saved.arrivalPhaseMs)&&!used.get(edge.toCityId)?.has(saved.arrivalPhaseMs))add({...edge,arrivalPhaseMs:saved.arrivalPhaseMs});}
 for(const edge of edges){if(published.has(key(edge)))continue;
  const slot=slots.find(phase=>!used.get(edge.fromCityId)?.has(phase)&&!used.get(edge.toCityId)?.has(phase));
  if(slot===undefined){if(strict)throw new Error("No safe terminal runway window");continue;}
  add({...edge,arrivalPhaseMs:slot});
 }
 return result;
}
export function airportTimetable(edges:readonly TransportNetworkEdge[],previous:readonly TimetabledAirEdge[],strict=true){return slotTimetable(edges,previous,25_000,strict);}
export function seaTimetable(edges:readonly TransportNetworkEdge[],previous:readonly TimetabledAirEdge[],strict=true){return slotTimetable(edges,previous,36_000,strict);}
export function airportScheduleOffset(edge:TimetabledAirEdge,fromTaskId:string,toTaskId:string):number{
 return (fromTaskId<toTaskId?0:100_000)-edge.arrivalPhaseMs;
}
export function seaScheduleOffset(edge:TimetabledAirEdge,fromTaskId:string,toTaskId:string):number{return (fromTaskId<toTaskId?0:144_000)-edge.arrivalPhaseMs;}
