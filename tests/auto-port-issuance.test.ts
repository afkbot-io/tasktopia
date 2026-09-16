import { expect,it } from "vitest";
import { createTestDb } from "../src/server/db";
import { coastalPortPair } from "./fixtures/coastal-ports";
import { countryPortReservations } from "../src/server/world/port-reservations";
import { readCountryRoads } from "../src/server/world/intercity-road-store";
import { intercityRoadCorridors } from "../src/shared/intercity-roads";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
it("assigns a coastal port during ordinary city growth and preserves earlier task geography",async()=>{
  const db=await createTestDb();
  try{
    const {service,sites}=await coastalPortPair(db,false),site=sites[0]!;
    const created=[];
    for(let i=0;i<140;i++){
      const task=await service.createTask(site.countryId,{cityId:site.city.id,districtId:site.district.id,title:`Задача ${i+1}`,estimate:1,idempotencyKey:`auto-port-${i}`});
      created.push(task);
      if(task.serviceRole==="PORT")break;
    }
    const port=created.find(task=>task.serviceRole==="PORT");
    expect(port).toBeDefined();
    const layout=(await readActiveBlockLayout(db,site.city.id))!;
    const before=new Set(created.slice(0,-1).map(task=>layout.placements.find(p=>p.taskId===task.id)!.blockId));
    expect(before.size).toBeGreaterThanOrEqual(6);
    expect(layout.placements.filter(p=>p.serviceRole==="PORT")).toHaveLength(1);
    expect((await service.getTask(site.countryId,created[0]!.id)).footprint).toEqual(created[0]!.footprint);
    const scene=await service.getCityScene(site.countryId,site.city.id);
    expect(scene.ports![0]!.plan.waterPath.length).toBeGreaterThan(1);
    expect(scene.railway).toMatchObject({axis:"vertical"});
    expect(scene.railway!.from.x).toBeLessThan(Math.min(...layout.blocks.map(b=>b.origin.x)));
    const reservations=await countryPortReservations(db,site.countryId);
    expect(reservations.length).toBeGreaterThan(0);
    const blocked=(p:{x:number;y:number})=>reservations.some(r=>p.x>=r.minX&&p.x<=r.maxX&&p.y>=r.minY&&p.y<=r.maxY);
    for(let i=0;i<16;i++){
      const task=await service.createTask(site.countryId,{cityId:site.city.id,districtId:site.district.id,title:`Дальше ${i}`,estimate:1,idempotencyKey:`after-port-${i}`});
      expect(task.footprint.some(blocked)).toBe(false);
    }
    const after=await service.getCityScene(site.countryId,site.city.id);
    expect(after.railway).toEqual(scene.railway);expect(after.ports).toEqual(scene.ports);
    const neighbor=await service.createCity(site.countryId,{name:"Соседний",idempotencyKey:"neighbor"});
    const district=await service.createDistrict(site.countryId,{cityId:neighbor.id,name:"Новый",activate:true,idempotencyKey:"neighbor-district"});
    const next=await service.createTask(site.countryId,{cityId:neighbor.id,districtId:district.id,title:"Первый дом",estimate:1,idempotencyKey:"neighbor-task"});
    expect(next.footprint.some(blocked)).toBe(false);
    const roads=await readCountryRoads(db,site.countryId);
    expect(roads).toBeDefined();
    const overlap=(a:typeof reservations[number],b:typeof reservations[number])=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
    for(const corridor of intercityRoadCorridors(roads!.plan.routes))expect(reservations.some(r=>overlap(r,corridor))).toBe(false);
    await service.deleteTask(site.countryId,{taskId:port!.id,confirmTitle:port!.title,idempotencyKey:"delete-port"});
    expect(await countryPortReservations(db,site.countryId)).toEqual(reservations);
    expect((await service.getCityScene(site.countryId,site.city.id)).ports).toEqual([]);
  }finally{await db.close();}
},120_000);

it("serializes concurrent real port requests without duplicating coastal reservations",async()=>{
  const db=await createTestDb();
  try{
    const {service,sites}=await coastalPortPair(db,false),site=sites[0]!;
    const results=await Promise.allSettled(["a","b"].map(key=>service.createTask(site.countryId,{
      cityId:site.city.id,districtId:site.district.id,title:`Порт ${key}`,estimate:1,buildingHint:"compact-port-v1",idempotencyKey:`concurrent-${key}`
    })));
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
    const layout=(await readActiveBlockLayout(db,site.city.id))!;
    expect(layout.placements.filter(p=>p.serviceRole==="PORT")).toHaveLength(1);
    const stored=layout.blocks.flatMap(b=>Object.values(b.parameters.slotPortPlans??{}));
    expect(stored).toHaveLength(1);
  }finally{await db.close();}
});
