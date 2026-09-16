import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { persistReadyBlockLayout,activateBlockLayout } from "../src/server/world/block-layout-store";
import { projectCountryCityMiniature } from "../src/server/world/country-overview";
import { readPlanetMiniatures } from "../src/server/planet-miniature-read";

it("reads actual airport stages at the canonical slot point and rejects removed membership",async()=>{
  const db=await createTestDb();
  try {
    const {user}=await registerUser(db,{email:"miniature@example.com",name:"Miniature",password:"password123"});
    const cityId=randomUUID();
    const districts=[0,1,2].map(sequence=>({id:randomUUID(),sequence,archetype:"MIXED_URBAN",
      tasks:Array.from({length:sequence===2?2:1},(_,index)=>({id:randomUUID(),taskNumber:sequence+index+1,
        buildingFamily:"compact-apartment-v1",facadeVariant:"south",constructionStage:4 as const}))}));
    const layout=compileBlockLayout({countryId:user.countryId,cityId,seed:9,revision:1,origin:{x:-64,y:-32},districts});
    await db.prepare(`INSERT INTO cities_v3(id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
      VALUES(?,?,'Miniature city','ACTIVE',-64,-32,?::jsonb,'compact-cartoon',now())`).run(cityId,user.countryId,JSON.stringify(layout.bounds));
    for(const district of districts){
      await db.prepare(`INSERT INTO districts_v3(id,city_id,name,status,growth_direction,color,created_at)
        VALUES(?,?,'Miniature district','PLANNED','E','#fff',now())`).run(district.id,cityId);
      for(const task of district.tasks) await db.prepare(`INSERT INTO tasks_v3(id,task_number,city_id,district_id,title,estimate,building_type,platform_type,visual_kind,visual_asset_key,created_at,updated_at)
        VALUES(?,?,?,?,'Miniature task',1,'compact-apartment-v1','GRASS','BUILDING','compact-apartment-v1',now(),now())`).run(task.id,task.taskNumber,cityId,district.id);
    }
    const timestamp=new Date().toISOString();
    await persistReadyBlockLayout(db,layout,timestamp);await activateBlockLayout(db,layout.id,timestamp);
    const airport=layout.placements.find(p=>p.serviceRole==="AIRPORT")!; expect(airport).toBeDefined();
    const country=projectCountryCityMiniature({sourceBounds:layout.bounds,layout});
    expect(country.airports).toEqual([]);
    const marker=country.transport!.find(p=>p.taskId===airport.taskId)!;
    const planet=(await readPlanetMiniatures(db,user.id)).get(cityId)!;
    expect(planet.find(p=>p.id===airport.taskId)).toMatchObject({stage:4,family:marker.family,
      x:marker.x*8+layout.bounds.minX,y:marker.y*8+layout.bounds.minY});
    await db.prepare("UPDATE task_placements_v1 SET construction_stage=5 WHERE task_id=?").run(airport.taskId);
    const completed=(await readPlanetMiniatures(db,user.id)).get(cityId)!;
    expect(completed.map(p=>p.id)).toEqual(planet.map(p=>p.id));
    expect(completed.find(p=>p.id===airport.taskId)).toMatchObject({stage:5,x:marker.x*8+layout.bounds.minX,y:marker.y*8+layout.bounds.minY});
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(user.countryId,user.id);
    expect((await readPlanetMiniatures(db,user.id)).size).toBe(0);
  } finally { await db.close(); }
});
