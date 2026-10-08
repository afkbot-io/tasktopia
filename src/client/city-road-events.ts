import type { Cell, Rect } from '../shared/contracts';
export type RoadEventKind='ACCIDENT'|'REPAIR'|'FIRE'|'MEDICAL'|'PATROL';
export type RoadEventSite={cells:Cell[];responseCells:Cell[]};
export type RoadEpisode=RoadEventSite&{id:string;kind:RoadEventKind;start:number;end:number};
const kinds:RoadEventKind[]=['ACCIDENT','REPAIR','FIRE','MEDICAL','PATROL'];
export function planRoadEpisode(cityId:string,sites:readonly RoadEventSite[],now:number,bounds:Rect):RoadEpisode|undefined{
 if(!Number.isFinite(now))return;
 const visible=sites.filter(site=>site.cells.every(c=>c.x>=bounds.minX&&c.x<=bounds.maxX&&c.y>=bounds.minY&&c.y<=bounds.maxY));
 if(!visible.length)return;
 let hash=0;for(const ch of cityId)hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;
 const window=Math.floor(now/90000),start=window*90000+12000;
 return {...visible[(hash+window*17)%visible.length]!,id:`${cityId}:${window}`,kind:kinds[((hash%5+window)%5+5)%5]!,start,end:start+18000};
}
export function roadEpisodePose(episode:RoadEpisode,now:number):{phase:'ARRIVE'|'WORK'|'CLEAR';progress:number}|null{
 if(!Number.isFinite(now)||now<episode.start||now>=episode.end)return null;
 const elapsed=now-episode.start,phase=elapsed<4000?'ARRIVE':elapsed<14000?'WORK':'CLEAR';
 const from=phase==='ARRIVE'?0:phase==='WORK'?4000:14000,to=phase==='ARRIVE'?4000:phase==='WORK'?14000:18000;
 return {phase,progress:(elapsed-from)/(to-from)};
}
