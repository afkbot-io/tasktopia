import { expect, it } from "vitest";
import { cityTransportDevelopment } from "../src/server/city-transport-development";
import type { CountryOverviewDto } from "../src/shared/country-overview-contract";
import { transportSchedule } from "../src/shared/transport-schedule";

it("describes real paired routes once and distinguishes unbuilt from isolated stops", () => {
  const overview = { cities: [{id:"a",name:"Alpha"},{id:"b",name:"Beta"}],
    connections: [{fromCityId:"a",toCityId:"b",fromAirportId:"airport-a",toAirportId:"airport-b"},
      {fromCityId:"b",toCityId:"a",fromAirportId:"airport-b",toAirportId:"airport-a"}],
    railConnections: [] } as unknown as CountryOverviewDto;
  const result = cityTransportDevelopment("a", [{role:"AIRPORT",state:"READY"},{role:"RAILWAY",state:"BUILDING"}], overview);
  expect(result).toHaveLength(3);
  expect(result[0]).toMatchObject({kind:"AIR",state:"CONNECTED",routes:[{
    id:transportSchedule("AIR","airport-a","airport-b").id, destinationCityId:"b",destinationName:"Beta",travelMs:30000,dwellMs:20000,
  }]});
  expect(result[1]).toMatchObject({kind:"RAIL",state:"NOT_READY",routes:[]});
  expect(cityTransportDevelopment("a",[{role:"RAILWAY",state:"READY"}],overview)[1]).toMatchObject({state:"NO_CONNECTION",routes:[]});
  expect(cityTransportDevelopment("a",[],undefined).every(item=>item.state==="NOT_READY"&&item.routes.length===0)).toBe(true);
});


it("describes a ready marine route with actual destination and common timing",()=>{
  const overview={cities:[{id:"a",name:"Берег"}],connections:[],railConnections:[],seaConnections:[{
    id:"sea:a:b",fromPortId:"port-a",toPortId:"port-b",fromCityId:"a",toCityId:"b",toCityName:"Приморск",points:[],progressRange:[0,0]
  }]} as unknown as CountryOverviewDto;
  expect(cityTransportDevelopment("a",[{role:"PORT",state:"READY"}],overview)[2]).toEqual({kind:"SEA",state:"CONNECTED",routes:[{
    id:transportSchedule("SEA","port-a","port-b").id,destinationCityId:"b",destinationName:"Приморск",travelMs:120000,dwellMs:24000
  }]});
  expect(cityTransportDevelopment("a",[{role:"PORT",state:"BUILDING"}],overview)[2]).toMatchObject({state:"NOT_READY",routes:[]});
});
