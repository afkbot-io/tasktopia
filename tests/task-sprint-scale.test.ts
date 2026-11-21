import { expect, it } from 'vitest';
import { createTestDb } from '../src/server/db';
import { registerUser } from '../src/server/auth';
import { AppService } from '../src/server/app-service';
import { synchronizeCityBlocks } from '../src/server/world/active-block-layout';
import { readTaskListPageRows } from '../src/server/task-list-read';

it.each([200,10_000])('keeps sprint participation reads bounded with %i canonical tasks',async count=>{
  const db=await createTestDb(),service=new AppService(db);
  try{
    const {user}=await registerUser(db,{email:`sprint-scale-${count}@example.test`,name:'Scale',password:'password123'});
    const country=user.countryId;await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(country);
    const city=await service.createCity(country,{name:'Sprint read scale',idempotencyKey:'city'});
    const first=await service.createDistrict(country,{cityId:city.id,name:'Home',activate:true,idempotencyKey:'first'});
    const next=await service.createDistrict(country,{cityId:city.id,name:'Next',idempotencyKey:'next'});
    const task=await service.createTask(country,{cityId:city.id,districtId:first.id,title:'Canonical task',estimate:3,idempotencyKey:'task'});
    await service.updateTaskStatus(country,{taskId:task.id,status:'STARTED',idempotencyKey:'start'},'compact');
    await service.updateTaskStatus(country,{taskId:task.id,status:'IN_PROGRESS',progress:40,idempotencyKey:'work'},'compact');
    await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||jsonb_build_object(
      'id',gen_random_uuid()::text,'task_number',0,'title','Read fixture '||n))).*
      FROM tasks_v3 t CROSS JOIN generate_series(1,?::int) n WHERE t.id=?`).run(count-1,task.id);
    if(count===200){
      await synchronizeCityBlocks(db,country,city.id);
      await service.continueTask(country,{taskId:task.id,fromDistrictId:first.id,targetDistrictId:next.id,idempotencyKey:'continue'},'compact');
      const started=performance.now(),scene=await new AppService(db).getCityScene(country,city.id);
      const taskIds=new Set(scene.chunks.flatMap(chunk=>chunk.tasks.map(t=>t.id)));
      expect(taskIds.size).toBe(count);
      expect(new Set(scene.chunks.flatMap(chunk=>chunk.worldFeatures.filter(f=>f.continuation).map(f=>f.id))).size).toBe(1);
      expect(scene.chunks.flatMap(chunk=>chunk.tasks).some(t=>'sprintPhases' in t)).toBe(false);
      console.info('SPRINT_SCENE_SCALE',JSON.stringify({tasks:count,coldSceneMs:Math.round(performance.now()-started),chunks:scene.chunks.length,historyEmbedded:false}));
    }else{
      // Isolated metadata workload: 10k tasks and 20k phases, not a claim of a
      // freshly generated 10k-building browser city. No synthetic scene escapes.
      await db.prepare(`INSERT INTO task_sprint_phases_v1(id,task_id,district_id,sequence,outcome,entry_status,entry_progress,
        entry_estimate,exit_status,exit_progress,exit_estimate,entered_at,exited_at)
        SELECT gen_random_uuid()::text,id,?,1,'CARRIED','PLANNING',0,estimate,status,progress,estimate,created_at,now()
        FROM tasks_v3 WHERE city_id=?`).run(first.id,city.id);
      await db.prepare('UPDATE tasks_v3 SET work_district_id=? WHERE city_id=?').run(next.id,city.id);
      await db.prepare(`INSERT INTO task_sprint_phases_v1(id,task_id,district_id,sequence,outcome,entry_status,entry_progress,entry_estimate,entered_at)
        SELECT gen_random_uuid()::text,id,?,2,'OPEN',status,progress,estimate,now() FROM tasks_v3 WHERE city_id=?`).run(next.id,city.id);
    }
    const times:number[]=[];
    for(let sample=0;sample<5;sample++){
      const queries=db.runtimeMetrics!().started,started=performance.now();
      const history=await service.listTaskSprints(country,task.id,{limit:1});
      expect(db.runtimeMetrics!().started-queries).toBe(1);
      expect(history.items).toHaveLength(1);expect(history.nextCursor).toBeTruthy();
      expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThan(3000);
      const page=await readTaskListPageRows(db,country,{districtId:first.id,limit:50});
      expect(page.rows).toHaveLength(50);expect(page.nextCursor).toBeTruthy();
      expect(new Set(page.rows.map(row=>row.id)).size).toBe(50);
      const workloads=await service.getDistrictWorkloads(country,[first.id,next.id]);
      expect(workloads.get(first.id)?.carriedOutCount).toBe(count===200?1:count);
      expect(workloads.get(next.id)?.openSp).toBe(count===200?3:count*3);
      expect(db.runtimeMetrics!().started-queries).toBe(3);
      times.push(Math.round(performance.now()-started));
    }
    expect((await db.prepare('SELECT COUNT(*)::int AS count FROM tasks_v3 WHERE city_id=?').get(city.id))?.count).toBe(count);
    console.info('SPRINT_READ_SCALE',JSON.stringify({tasks:count,phases:count===200?2:20_000,queriesPerSample:3,historyLimit:1,listLimit:50,sampleMs:times}));
  }finally{await db.close();}
},60_000);
