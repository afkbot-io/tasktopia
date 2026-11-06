import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createDb,transaction} from '../../src/server/db';
import {registerUser} from '../../src/server/auth';
import {AppService} from '../../src/server/app-service';
import {readActiveBlockLayout,synchronizeCityBlocks} from '../../src/server/world/active-block-layout';
import {BUILDING_CATALOG} from '../../src/shared/catalog';
import {taskLink} from '../../src/client/task-navigation';
import {quarterCharacterFor} from '../../src/shared/city-quarter-character';

// Automatic canvas snapshots read back the full native phone raster on every
// assertion. Keep native DPR and the explicit artwork captures below instead.
test.use({trace:{mode:'retain-on-failure',snapshots:false,screenshots:false,sources:true}});

test('one real district renders three persistent quarter characters through normal camera gestures',async({page},info)=>{
  test.setTimeout(120000);
  const database=process.env.E2E_DATABASE_URL!,origin=process.env.E2E_BASE_URL!;
  expect(['127.0.0.1','localhost']).toContain(new URL(database).hostname);
  expect(['127.0.0.1','localhost']).toContain(new URL(origin).hostname);
  const db=await createDb(database,{migrate:false}),service=new AppService(db);
  let ownedUser:Awaited<ReturnType<typeof registerUser>>['user']|undefined;
  const errors:string[]=[],failures:string[]=[],reads:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',r=>{if(r.status()>=400&&/\/(api|game-assets)\//.test(r.url()))failures.push(`${r.status()} ${r.url()}`);});
  page.on('request',r=>{const p=new URL(r.url()).pathname;if(r.method()==='GET'&&/\/scene$|\/world\/viewport|\/chunks\//.test(p))reads.push(p);});
  try{
    const {user}=await registerUser(db,{email:`quarter-${randomUUID()}@example.test`,name:'Характер кварталов QA',password:'password123'});ownedUser=user;
    await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(user.countryId);
    const city=await service.createCity(user.countryId,{name:'Три характера одного района',idempotencyKey:'city'});
    const district=await service.createDistrict(user.countryId,{cityId:city.id,name:'Один большой район',archetype:'NEW_BUILD',activate:true,idempotencyKey:'district'});
    const first=await service.createTask(user.countryId,{cityId:city.id,districtId:district.id,title:'Начало города',estimate:1,idempotencyKey:'first'});
    await transaction(db,async()=>{
      await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||r.value)).*
        FROM tasks_v3 t CROSS JOIN jsonb_array_elements(?::jsonb) WITH ORDINALITY r(value,ordinality)
        WHERE t.id=? ORDER BY r.ordinality`).run(JSON.stringify(Array.from({length:599},(_,i)=>({id:randomUUID(),task_number:0,
        title:`Дом ${i+2}`,status:'COMPLETED',progress:100,visual_auto:true,service_role_assigned:false,service_role:null,service_trigger:null}))),first.id);
      await db.prepare("UPDATE tasks_v3 SET status='COMPLETED',progress=100 WHERE id=?").run(first.id);
      await synchronizeCityBlocks(db,user.countryId,city.id);
    });
    const layout=(await readActiveBlockLayout(db,city.id))!,blocks=new Map(layout.blocks.map(b=>[b.id,b]));
    const homeKeys=new Set(BUILDING_CATALOG.filter(b=>b.category==='HOUSE'&&!b.serviceRole&&b.footprint.width===6&&b.footprint.height===6).map(b=>b.key));
    const homes=layout.placements.filter(p=>!p.serviceRole&&homeKeys.has(p.buildingFamily));
    const selected=['TERRACOTTA','SLATE','GARDENS'].map(character=>homes.filter(p=>blocks.get(p.blockId)!.parameters.quarterCharacter===character)
      .sort((a,b)=>{const aa=blocks.get(a.blockId)!.origin,bb=blocks.get(b.blockId)!.origin;
        return Math.abs(aa.x-city.center.x)+Math.abs(aa.y-city.center.y)-Math.abs(bb.x-city.center.x)-Math.abs(bb.y-city.center.y);})[0]!);
    expect(selected.every(Boolean)).toBe(true);expect(layout.placements).toHaveLength(600);expect(layout.districtLayouts).toHaveLength(1);
    for(const block of layout.blocks)expect(block.parameters.quarterCharacter).toBe(quarterCharacterFor(layout.seed,block));
    const initial=await service.getTask(user.countryId,selected[0]!.taskId);
    expect((await page.request.post('/api/auth/login',{data:{email:user.email,password:'password123'}})).ok()).toBe(true);
    await page.goto(taskLink(user.countryId,initial));await expect(page.locator('#task-title')).toContainText(initial.title);
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    const host=page.locator('.world-canvas'),canvas=page.getByLabel('Интерактивная карта города',{exact:true});
    await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30000});
    await expect(host).toHaveAttribute('data-canonical-task-count','600',{timeout:30000});
    await expect(host).toHaveAttribute('data-mobility-ready','true',{timeout:30000});
    const retained=await host.locator('canvas').elementHandle(),evidence=[];
    for(const chosen of selected){
      const task=await service.getTask(user.countryId,chosen.taskId),target={x:task.origin.x+3,y:task.origin.y+3};
      for(let drag=0;drag<40;drag++){
        const before=await host.evaluate(el=>{const d=(el as HTMLElement).dataset;return{x:Number(d.cameraWorldX),y:Number(d.cameraWorldY),scale:Number(d.renderScale)};});
        const box=(await canvas.boundingBox())!,dx=(before.x-target.x)*8*before.scale,dy=(before.y-target.y)*8*before.scale;
        // The evidence needs the whole building inside the native viewport.
        // Repeated micro-drags to its exact centre add software-GPU work while
        // proving no additional camera or artwork behaviour.
        if(Math.abs(dx)<box.width/2-32&&Math.abs(dy)<box.height/2-64)break;
        const f=Math.min(1,box.width*.32/Math.max(1,Math.abs(dx)),box.height*.32/Math.max(1,Math.abs(dy)));
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
        // Two actual pointer moves cross the drag threshold and reach the
        // same endpoint. Extra intermediate native phone rasters consumed
        // the120s host budget after all three artwork captures already passed.
        await page.mouse.move(box.x+box.width/2+dx*f,box.y+box.height/2+dy*f,{steps:2});await page.mouse.up();
        await expect.poll(async()=>{const now=await host.evaluate(el=>{const d=(el as HTMLElement).dataset;return{x:Number(d.cameraWorldX),y:Number(d.cameraWorldY)};});
          return Math.abs(now.x-before.x)+Math.abs(now.y-before.y);}).toBeGreaterThan(.1);
        await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15000});
      }
      await expect.poll(async()=>host.evaluate((el,p)=>{const d=(el as HTMLElement).dataset,c=el.querySelector('canvas')!,s=8*Number(d.renderScale);
        return Math.abs((Number(d.cameraWorldX)-p.x)*s)<c.clientWidth/2-32&&Math.abs((Number(d.cameraWorldY)-p.y)*s)<c.clientHeight/2-64;},target)).toBe(true);
      await expect(host).toHaveAttribute('data-ground-bake-queue','0',{timeout:15000});
      await expect(host).toHaveAttribute('data-world-object-depth-errors','0');
      const character=String(blocks.get(chosen.blockId)!.parameters.quarterCharacter);
      // Mouse-driven phone emulation can hover the final drag endpoint. Move
      // the pointer out of the map before comparing the unobscured artwork.
      await page.mouse.move(8,8);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
      await page.screenshot({path:info.outputPath(`${character.toLowerCase()}-city.png`)});
      evidence.push({character,taskId:task.id,family:task.buildingType,blockId:chosen.blockId});
    }
    expect(await retained!.evaluate(el=>el.isConnected)).toBe(true);
    expect(reads.filter(p=>p.endsWith('/scene'))).toHaveLength(1);
    expect(reads.filter(p=>/\/world\/viewport|\/chunks\//.test(p))).toEqual([]);
    expect(errors).toEqual([]);expect(failures).toEqual([]);
    await info.attach('quarter-character-evidence',{body:JSON.stringify({evidence,reads,errors,failures}),contentType:'application/json'});
    const after=(await readActiveBlockLayout(db,city.id))!;expect(after).toEqual(layout);
  }finally{if(ownedUser){await db.prepare('DELETE FROM countries WHERE id=?').run(ownedUser.countryId);await db.prepare('DELETE FROM users WHERE id=?').run(ownedUser.id);}await db.close();}
});
