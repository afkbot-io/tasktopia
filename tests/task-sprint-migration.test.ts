import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createTestDb, transaction } from '../src/server/db';
import { registerUser } from '../src/server/auth';
import { compileBlockLayout } from '../src/server/world/block-layout-compiler';
import { activateBlockLayout, persistReadyBlockLayout } from '../src/server/world/block-layout-store';

it('upgrades populated v49 without changing task identity, geometry, history or legacy writer admission',async()=>{
  const db=await createTestDb();
  try{await transaction(db,async()=>{
    const schema=`sprint_upgrade_${randomUUID().replaceAll('-','')}`,directory=join(process.cwd(),'migrations/postgres');
    await db.exec(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
    for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)&&name<'0050_').sort())
      await db.exec(await readFile(join(directory,name),'utf8'));
    const {user}=await registerUser(db,{email:'sprint-upgrade@example.test',name:'Upgrade',password:'password123'});
    const city=randomUUID(),district=randomUUID(),task=randomUUID(),time=new Date().toISOString();
    await db.prepare(`INSERT INTO cities_v3(id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
      VALUES(?,?,'Existing city','ACTIVE',0,0,'{"minX":0,"minY":0,"maxX":32,"maxY":32}','block-v1',?)`).run(city,user.countryId,time);
    await db.prepare(`INSERT INTO districts_v3(id,city_id,name,status,growth_direction,color,created_at)
      VALUES(?,?,'Existing sprint','ACTIVE','E','#fff',?)`).run(district,city,time);
    await db.prepare(`INSERT INTO tasks_v3(id,city_id,district_id,title,estimate,status,progress,building_type,visual_asset_key,platform_type,created_at,updated_at)
      VALUES(?,?,?,'Existing task',3,'IN_PROGRESS',40,'compact-apartment-v1','compact-apartment-v1','STONE',?,?)`).run(task,city,district,time,time);
    await db.prepare(`INSERT INTO task_events_v7(task_id,actor_label,event_type,details_json,created_at)
      VALUES(?,'Legacy','UPDATED','{"fromDistrictId":"former-sprint"}',?)`).run(task,time);
    const layout=compileBlockLayout({countryId:user.countryId,cityId:city,seed:17,revision:1,districts:[{
      id:district,sequence:0,archetype:'MIXED_URBAN',tasks:[{id:task,taskNumber:1,buildingFamily:'compact-apartment-v1',facadeVariant:'south',constructionStage:3}],
    }]});
    await persistReadyBlockLayout(db,layout,time);await activateBlockLayout(db,layout.id,time);
    const before=await db.prepare('SELECT to_jsonb(t) AS value FROM tasks_v3 t WHERE id=?').get(task);
    const placements=await db.prepare('SELECT * FROM task_placements_v1 WHERE task_id=?').all(task);
    const events=await db.prepare('SELECT * FROM task_events_v7 WHERE task_id=?').all(task);
    await db.exec(await readFile(join(directory,'0050_task_sprint_continuations.sql'),'utf8'));
    expect(await db.prepare("SELECT to_jsonb(t)-'work_district_id' AS value FROM tasks_v3 t WHERE id=?").get(task)).toEqual(before);
    expect(await db.prepare('SELECT district_id,work_district_id FROM tasks_v3 WHERE id=?').get(task)).toEqual({district_id:district,work_district_id:district});
    expect(await db.prepare('SELECT * FROM task_placements_v1 WHERE task_id=?').all(task)).toEqual(placements);
    expect(await db.prepare('SELECT * FROM task_events_v7 WHERE task_id=?').all(task)).toEqual(events);
    expect(await db.prepare('SELECT * FROM task_sprint_phases_v1').all()).toEqual([]);
    const legacyInsert=randomUUID();
    await db.prepare(`INSERT INTO tasks_v3(id,city_id,district_id,title,estimate,building_type,visual_asset_key,platform_type,created_at,updated_at)
      VALUES(?,?,?,'Legacy writer after expand',1,'compact-row-v1','compact-row-v1','STONE',?,?)`).run(legacyInsert,city,district,time,time);
    expect(await db.prepare('SELECT work_district_id FROM tasks_v3 WHERE id=?').get(legacyInsert)).toEqual({work_district_id:district});
    await db.exec('SET CONSTRAINTS ALL IMMEDIATE');await db.exec(`DROP SCHEMA "${schema}" CASCADE`);
  });}finally{await db.close();}
},30_000);
