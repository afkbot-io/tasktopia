import {expect,it} from "vitest";
import {roadInspection} from "../src/client/city-road-inspection";
import type {RoadEpisode} from "../src/client/city-road-events";
const episode:RoadEpisode={id:"real-episode",kind:"ACCIDENT",start:1000,end:19000,cells:[{x:1,y:2},{x:2,y:2},{x:3,y:2}],responseCells:[{x:4,y:2}]};
it("reads only the active real episode, its actual responders, arrivals and closure state",()=>{
 expect(roadInspection(undefined,2000,[],new Set())).toBeUndefined();
 expect(roadInspection(episode,999,[],new Set())).toBeUndefined();
 expect(roadInspection(episode,19000,[],new Set())).toBeUndefined();
 const responders=[{id:"police",response:"POLICE"},{id:"unrelated",response:"FIRE"}];
 expect(roadInspection(episode,6000,responders,new Set(["police"]))).toMatchObject({id:episode.id,title:"Дорожная авария",phase:"ARRIVE",closedCells:3,services:["Полиция"]});
 expect(roadInspection({...episode,serviceArrival:5000},6000,responders,new Set(["police"]))).toMatchObject({phase:"WORK"});
 expect(roadInspection({...episode,serviceArrival:5000,cargoLoaded:true},18000,responders,new Set(["police"]))).toMatchObject({phase:"CLEAR",closedCells:0});
 expect(roadInspection({...episode,kind:"PATROL"},2000,[],new Set())).toMatchObject({closedCells:0});
});
