import {ROAD_EVENT_LABEL,roadEpisodePose,type RoadEpisode} from "./city-road-events";
import type {RoadInspection} from "./city-world-inspection";
const roles:Record<string,string>={POLICE:"Полиция",FIRE:"Пожарные",AMBULANCE:"Скорая помощь",REPAIR:"Ремонтная служба",TOW:"Эвакуатор"};
export function roadInspection(episode:RoadEpisode|undefined,now:number,responders:readonly {id:string;response?:string;responseOwner?:string}[],owned:ReadonlySet<string>):RoadInspection|undefined {
 const pose=episode&&roadEpisodePose(episode,now);if(!episode||!pose)return;
 return {kind:"ROAD",id:episode.id,title:ROAD_EVENT_LABEL[episode.kind],phase:episode.serviceArrival===undefined?"ARRIVE":pose.phase,
  position:episode.cells[0],local:true,closedCells:episode.kind!=="PATROL"&&!episode.cargoLoaded?episode.cells.length:0,
  services:[...new Set(responders.filter(agent=>owned.has(agent.id)&&agent.responseOwner===episode.id&&agent.response&&roles[agent.response]).map(agent=>roles[agent.response!]!))]};
}
