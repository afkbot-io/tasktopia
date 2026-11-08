import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {createTestDb,transaction} from '../src/server/db';
import {registerUser} from '../src/server/auth';
import {AppService} from '../src/server/app-service';
import {createMcpServer} from '../src/server/mcp';
import {readActiveBlockLayout,synchronizeCityBlocks} from '../src/server/world/active-block-layout';
import {cityDevelopment} from '../src/server/city-development-read';
import {localServiceZone} from '../src/server/world/local-city-services';
import type {TaskDto} from '../src/shared/contracts';

it('persists local services through real MCP create/status/delete and reload without changing old sites or writing on reads',async()=>{
  const db=await createTestDb(),service=new AppService(db);
  const {user}=await registerUser(db,{email:'local-services@example.test',name:'Local services',password:'password123'});
  const server=await createMcpServer(db,service,{userId:user.id,tokenId:randomUUID(),scopes:['tasks:read','tasks:write']});
  const client=new Client({name:'local-service-contract',version:'1.0.0'});
  try{
    await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(user.countryId);
    const city=await service.createCity(user.countryId,{name:'One large district',idempotencyKey:'city'});
    const district=await service.createDistrict(user.countryId,{cityId:city.id,name:'One sprint',activate:true,idempotencyKey:'district'});
    const first=await service.createTask(user.countryId,{cityId:city.id,districtId:district.id,title:'Initial',estimate:1,idempotencyKey:'first'});
    // Fixture rows only. The real compiler/terrain and persistence choose all
    // parcels, families, entrances, roles, streets and reservations.
    const rows=Array.from({length:599},(_,i)=>({id:randomUUID(),task_number:0,title:`Fixture ${i+2}`,status:'PLANNING',progress:0,
      visual_auto:true,service_role_assigned:false,service_role:null,service_trigger:null}));
    await transaction(db,async()=>{
      await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||r.value)).*
        FROM tasks_v3 t CROSS JOIN jsonb_array_elements(?::jsonb) WITH ORDINALITY r(value,ordinality)
        WHERE t.id=? ORDER BY r.ordinality`).run(JSON.stringify(rows),first.id);
      await synchronizeCityBlocks(db,user.countryId,city.id);
    });
    const before=(await readActiveBlockLayout(db,city.id))!,blockById=new Map(before.blocks.map(b=>[b.id,b]));
    const locals=before.placements.filter(p=>(blockById.get(p.blockId)!.parameters.slotRoleTriggers as Record<string,string>|undefined)?.[p.slotKey]?.startsWith('city:local-service:'));
    expect(new Set(locals.map(p=>localServiceZone(blockById.get(p.blockId)!))).size).toBeGreaterThanOrEqual(2);
    const target=locals.find(p=>p.serviceRole==='EDUCATION')!;expect(target).toBeDefined();
    const original=await service.getTask(user.countryId,target.taskId);
    const [transport,peer]=InMemoryTransport.createLinkedPair();await server.connect(peer);await client.connect(transport);
    const call=async(name:string,args:Record<string,unknown>)=>{
      const result=await client.callTool({name,arguments:{countryId:user.countryId,...args}});
      expect(result.isError,JSON.stringify(result.content)).not.toBe(true);
      return (result.structuredContent as {result:TaskDto}).result;
    };
    for(const status of ['STARTED','IN_PROGRESS','TESTING'])await call('task.set_status',{
      taskId:target.taskId,status,idempotencyKey:`local-${status}`});
    const statusArgs={taskId:target.taskId,status:'COMPLETED',idempotencyKey:'complete-local'};
    const completed=await call('task.set_status',statusArgs);expect(completed.stage).toBe(5);
    expect((await call('task.set_status',statusArgs)).id).toBe(target.taskId);
    expect(cityDevelopment((await readActiveBlockLayout(db,city.id))!).services.find(s=>s.taskId===target.taskId)?.state).toBe('READY');
    const ready=(await readActiveBlockLayout(db,city.id))!;
    await call('task.get',{taskId:target.taskId});await new AppService(db).getTask(user.countryId,target.taskId);
    expect(await readActiveBlockLayout(db,city.id)).toEqual(ready);
    await call('task.delete',{taskId:target.taskId,confirmTitle:original.title,idempotencyKey:'delete-local'});
    const removed=(await readActiveBlockLayout(db,city.id))!;
    expect(removed.siteMarkers.some(m=>m.blockId===target.blockId&&m.slotKey===target.slotKey)).toBe(true);
    const createArgs={cityId:city.id,districtId:district.id,title:'Future task',estimate:1,idempotencyKey:'after-local-delete'};
    const next=await call('task.create',createArgs);expect((await call('task.create',createArgs)).id).toBe(next.id);
    expect(next.footprint.some(c=>original.footprint.some(o=>o.x===c.x&&o.y===c.y))).toBe(false);
    const after=(await readActiveBlockLayout(db,city.id))!;
    for(const old of before.placements.filter(p=>p.taskId!==target.taskId))expect(after.placements.find(p=>p.taskId===old.taskId)).toEqual(old);
    expect(after.siteMarkers).toEqual(removed.siteMarkers);
    const final=(await call('task.get',{taskId:next.id}));expect(final.id).toBe(next.id);
    expect(await readActiveBlockLayout(db,city.id)).toEqual(after);
  }finally{await client.close();await server.close();await db.close();}
},60000);
