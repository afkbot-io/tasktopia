import type { Cell, Rect } from '../shared/contracts';
import { ROAD_EVENT_RECIPES } from './city-event-recipes';
export type RoadEventKind='ACCIDENT'|'REPAIR'|'FIRE'|'MEDICAL'|'PATROL'|'BREAKDOWN'|'WATER';
export type RoadEventSite={cells:Cell[];responseCells:Cell[];towCell?:Cell};
export type RoadEpisode=RoadEventSite&{id:string;kind:RoadEventKind;start:number;end:number;responderId?:string;serviceArrival?:number;cargoLoaded?:boolean};
const kinds=ROAD_EVENT_RECIPES.map(recipe=>recipe.kind);
export const ROAD_EVENT_LABEL = Object.fromEntries(ROAD_EVENT_RECIPES.map(recipe=>[recipe.kind,recipe.label])) as Readonly<Record<RoadEventKind,string>>;
export function planRoadEpisode(cityId:string,sites:readonly RoadEventSite[],now:number,bounds:Rect):RoadEpisode|undefined{
 if(!Number.isFinite(now))return;
 let hash=0;for(const ch of cityId)hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;
 const window=Math.floor(now/90000),start=window*90000+12000;
 const kind=kinds[((hash%kinds.length+window)%kinds.length+kinds.length)%kinds.length]!;
 const visible=sites.filter(site=>(kind!=='BREAKDOWN'||site.towCell)&&site.cells.every(c=>c.x>=bounds.minX&&c.x<=bounds.maxX&&c.y>=bounds.minY&&c.y<=bounds.maxY));
 if(!visible.length)return;
 return {...visible[(hash+window*17)%visible.length]!,id:`${cityId}:${window}`,kind,start,end:start+(kind==='BREAKDOWN'?30000:kind==='WATER'?26000:18000)};
}
export function roadEpisodePose(episode:RoadEpisode,now:number):{phase:'ARRIVE'|'WORK'|'CLEAR';progress:number}|null{
 if(!Number.isFinite(now)||now<episode.start||now>=episode.end)return null;
 const duration=episode.end-episode.start,elapsed=now-episode.start,phase=elapsed<4000?'ARRIVE':elapsed<duration-4000?'WORK':'CLEAR';
 const from=phase==='ARRIVE'?0:phase==='WORK'?4000:duration-4000,to=phase==='ARRIVE'?4000:phase==='WORK'?duration-4000:duration;
 return {phase,progress:(elapsed-from)/(to-from)};
}
