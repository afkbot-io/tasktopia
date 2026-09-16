import {expect,it} from "vitest";
import {portRoutes,type PortStop} from "../src/shared/port-routes";
import {transportSchedule} from "../src/shared/transport-schedule";
const water=Array.from({length:15*9},(_,i)=>({x:i%15,y:Math.floor(i/15)}));
const stops:PortStop[]=[
 {id:"a",cityId:"a-city",countryId:"a-country",continent:0,stage:5,dock:{x:2,y:4}},
 {id:"b",cityId:"b-city",countryId:"b-country",continent:1,stage:5,dock:{x:12,y:4}},
];
it("requires two completed real ports on different continents and uses their shared SEA schedule",()=>{
 const routes=portRoutes(stops,water,1);expect(routes).toHaveLength(1);
 expect(routes[0]).toMatchObject({id:transportSchedule("SEA","a","b").id,from:stops[0],to:stops[1]});
 expect(routes[0]!.cells[0]).toEqual(stops[0]!.dock);expect(routes[0]!.cells.at(-1)).toEqual(stops[1]!.dock);
 expect(portRoutes(stops.slice(0,1),water,1)).toEqual([]);
 expect(portRoutes([stops[0]!,{...stops[1]!,stage:4}],water,1)).toEqual([]);
 expect(portRoutes([stops[0]!,{...stops[1]!,continent:0}],water,1)).toEqual([]);
 expect(portRoutes([...stops].reverse(),water,1)).toEqual(routes);
});
it("rejects narrow channels and land docks, and checks full hull clearance around every bend",()=>{
 const narrow=water.filter(p=>p.x!==7||p.y===4);
 expect(portRoutes(stops,narrow,1)).toEqual([]);
 expect(portRoutes(stops,narrow,0)).toHaveLength(1);
 expect(portRoutes(stops,water.filter(p=>p.x!==2||p.y!==4),1)).toEqual([]);
 const obstacle=water.filter(p=>!(p.x>=6&&p.x<=8&&p.y>=3&&p.y<=5));
 const route=portRoutes(stops,obstacle,1)[0]!;expect(route).toBeDefined();
 const allowed=new Set(obstacle.map(p=>`${p.x},${p.y}`));
 route.cells.forEach((p,i)=>{
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)expect(allowed.has(`${p.x+dx},${p.y+dy}`)).toBe(true);
  if(i)expect(Math.abs(p.x-route.cells[i-1]!.x)+Math.abs(p.y-route.cells[i-1]!.y)).toBe(1);
 });
});
it("does not invent routes between disconnected seas or duplicate endpoints",()=>{
 expect(portRoutes(stops,water.filter(p=>p.x!==7),1)).toEqual([]);
 expect(portRoutes([stops[0]!,stops[0]!],water,1)).toEqual([]);
 expect(()=>portRoutes(stops,water,-1)).toThrow();
 expect(()=>portRoutes(stops,water,0.5)).toThrow();
});

it("keeps a bounded connected fleet for several ports regardless of input ordering",()=>{
 const many=[...stops,{id:"c",cityId:"c-city",countryId:"c-country",continent:2,stage:5,dock:{x:7,y:6}}];
 const routes=portRoutes(many,water,1);
 expect(routes).toHaveLength(2);
 expect(new Set(routes.flatMap(r=>[r.from.id,r.to.id]))).toEqual(new Set(["a","b","c"]));
 expect(portRoutes([...many].reverse(),water,1)).toEqual(routes);
 expect(portRoutes([...many,{...many[2]!,id:"z-duplicate-city"}],water,1)).toEqual(routes);
});
