import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {CityWorldObservation} from "../src/client/components/CityWorldObservation";
import type {InspectionSnapshot} from "../src/client/city-world-inspection";
const snapshot:InspectionSnapshot={item:{kind:"PLACE",local:true,title:"Школа",phase:"READY",task:{countryId:"country",taskId:"school"}},following:false,canFollow:false,ended:false};
const props={onClose:()=>{},onFollow:()=>{},onTask:()=>{},onTourClose:()=>{},onChoose:()=>{}};
it("keeps the active place task action but removes an obsolete task button after the inspected place ends",()=>{
 expect(renderToStaticMarkup(<CityWorldObservation {...props} snapshot={snapshot}/>)).toContain("Открыть задачу");
 const ended=renderToStaticMarkup(<CityWorldObservation {...props} snapshot={{...snapshot,ended:true}}/>);
 expect(ended).toContain("Это событие завершилось.");expect(ended).not.toContain("Открыть задачу");
});
it("describes a boarding ferry at its real berth instead of claiming it is travelling",()=>{
 const ferry:InspectionSnapshot={...snapshot,item:{kind:"TRANSPORT",transportKind:"SEA",routeId:"route",vehicleId:"vehicle",journeyId:"journey",
  title:"Паром",phase:"STOPPED",activity:"BOARDING",fromName:"Приморск",toName:"Сосново",progress:0,local:true,waiting:2,aboard:1,boarded:1,alighted:0}};
 const html=renderToStaticMarkup(<CityWorldObservation {...props} snapshot={ferry}/>);
 expect(html).toContain("Посадка пассажиров");expect(html).toContain("У причала");
});
