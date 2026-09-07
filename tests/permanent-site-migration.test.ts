import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerUser } from "../src/server/auth";
import { createTestDb, transaction } from "../src/server/db";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { activateBlockLayout, persistReadyBlockLayout } from "../src/server/world/block-layout-store";
import { freezePermanentSiteGeometry, readPermanentSiteFeatures } from "../src/server/world/permanent-task-sites";
import { blockSlots } from "../src/shared/block-templates";

describe("permanent site upgrade from populated version 25",()=>{
  it("backfills ownership and service intent without losing old ruins or their exact address",async()=>{
    const db=await createTestDb();
    try { await transaction(db,async()=>{
      const schema=`sites_upgrade_${randomUUID().replaceAll("-","")}`, directory=join(process.cwd(),"migrations/postgres");
      await db.exec(`CREATE SCHEMA "${schema}"`); await db.exec(`SET LOCAL search_path TO "${schema}"`);
      for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)&&name<"0026_").sort()) {
        await db.exec(await readFile(join(directory,name),"utf8"));
      }
      const {user}=await registerUser(db,{email:"upgrade@example.test",name:"Upgrade",password:"password123"});
      const cityId=randomUUID(), districtId=randomUUID(), taskId=randomUUID(), timestamp=new Date().toISOString();
      await db.prepare(`INSERT INTO cities_v3(id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
        VALUES(?,?,'Historical project','ACTIVE',0,0,'{"minX":0,"minY":0,"maxX":32,"maxY":32}','block-v1',?)`).run(cityId,user.countryId,timestamp);
      await db.prepare(`INSERT INTO districts_v3(id,city_id,name,status,growth_direction,color,created_at)
        VALUES(?,?,'Historical sprint','ACTIVE','E','#fff',?)`).run(districtId,cityId,timestamp);
      await db.prepare(`INSERT INTO tasks_v3(id,task_number,city_id,district_id,title,estimate,building_type,platform_type,created_at,updated_at)
        VALUES(?,1,?,?,'Still active',1,'compact-apartment-v1','STONE',?,?)`).run(taskId,cityId,districtId,timestamp,timestamp);
      const layout=compileBlockLayout({countryId:user.countryId,cityId,seed:17,revision:1,districts:[{
        id:districtId,sequence:0,archetype:"MIXED_URBAN",tasks:[{id:taskId,taskNumber:1,buildingFamily:"compact-apartment-v1",facadeVariant:"south",constructionStage:1}],
      }]});
      await persistReadyBlockLayout(db,layout,timestamp); await activateBlockLayout(db,layout.id,timestamp);
      const block=layout.blocks[0]!, slot=blockSlots(block)[1]!, markerId=randomUUID();
      await db.prepare(`UPDATE city_blocks_v1 SET parameters_json=jsonb_set(parameters_json,'{slotRoles}',?::jsonb) WHERE id=?`)
        .run(JSON.stringify({[layout.placements[0]!.slotKey]:"AIRPORT"}),block.id);
      await db.prepare(`INSERT INTO site_markers_v1(id,layout_id,block_id,slot_key,kind,snapshot_json,asset_variant,created_at,updated_at)
        VALUES(?,?,?,?,'RUINED',?::jsonb,'compact-rubble',?,?)`).run(markerId,layout.id,block.id,slot.key,
          JSON.stringify({taskNumber:99,title:"Demolished",buildingFamily:slot.buildingFamily,lastStage:4}),timestamp,timestamp);
      await db.exec(await readFile(join(directory,"0026_permanent_task_sites.sql"),"utf8"));
      expect(await db.prepare("SELECT service_role,service_role_assigned FROM tasks_v3 WHERE id=?").get(taskId))
        .toEqual({service_role:"AIRPORT",service_role_assigned:true});
      const original=(await readPermanentSiteFeatures(db,user.countryId))[0]!;
      expect(original).toMatchObject({id:markerId,cityId,districtId,origin:slot.origin,footprint:slot.footprint});
      await freezePermanentSiteGeometry(db,user.countryId);
      await db.prepare("DELETE FROM cities_v3 WHERE id=?").run(cityId);
      expect(await readPermanentSiteFeatures(db,user.countryId)).toEqual([original]);
      expect(await db.prepare("SELECT layout_id,block_id FROM site_markers_v1 WHERE id=?").get(markerId)).toEqual({layout_id:null,block_id:null});
      await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
      expect(await readPermanentSiteFeatures(db,user.countryId)).toEqual([]);
      await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await db.exec(`DROP SCHEMA "${schema}" CASCADE`);
    }); } finally {await db.close();}
  },30_000);
});
