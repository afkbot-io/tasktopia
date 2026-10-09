import type { Cell,RoadCellDto } from "../shared/contracts";
import type { CitySceneDto } from "../shared/city-scene-contract";
import { cityRailwayPassengerPaths } from "../shared/city-railway";
import {airportPassengerCells,portPassengerDeck} from '../shared/transport-passenger-paths';
/** Extra authored infrastructure paths join the existing pedestrian graph.
 * Street intersections are explicit crossings handled by the existing signals. */
export function addTransportWalkways(scene:CitySceneDto|undefined,roads:ReadonlyMap<string,RoadCellDto>,walkGraph:Map<string,Cell>,crosswalks:Set<string>,activityCells:Set<string>,blocked:ReadonlySet<string>){
 const key=(p:Cell)=>`${p.x},${p.y}`;
 const add=(p:Cell)=>{const id=key(p);if(blocked.has(id))return;walkGraph.set(id,p);if(roads.has(id))crosswalks.add(id);};
 if(scene?.railway?.running)for(const lane of [0,-1] as const){const paths=cityRailwayPassengerPaths(scene.railway,lane);for(const p of [...paths.access,...paths.platform,...paths.bridge])add(p);for(const p of paths.boardingCells)activityCells.add(key(p));}
 for(const site of scene?.airports??[]){if(site.stage!==5||!site.plan)continue;const plan=site.plan;for(const p of plan.access)add(p);
  for(const p of airportPassengerCells(plan))add(p);
  for(const stand of plan.stands){add({x:stand.x,y:stand.y+2});add({x:stand.x,y:stand.y+1});activityCells.add(key({x:stand.x,y:stand.y+1}));}}
 for(const port of scene?.ports??[]){if(port.stage!==5)continue;for(const p of [...port.plan.approach,...portPassengerDeck(port.plan)])add(p);
  for(const p of port.plan.pier.slice(-3))activityCells.add(key(p));}
}
