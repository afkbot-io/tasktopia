import { expect, test, type Page } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createDb } from '../../src/server/db';
import { AppService } from '../../src/server/app-service';
import { registerUser } from '../../src/server/auth';
import { taskLink } from '../../src/client/task-navigation';
import type { WorldFeatureDto } from '../../src/shared/contracts';

async function sitePoint(page:Page,feature:WorldFeatureDto){
  const host=page.locator('.world-canvas'),canvas=host.locator('canvas');
  const camera=()=>host.evaluate(el=>{const d=(el as HTMLElement).dataset;return {x:Number(d.cameraWorldX),y:Number(d.cameraWorldY),scale:Number(d.renderScale)};});
  const cell={x:feature.origin.x+3,y:feature.origin.y+1.5};
  for(let step=0;step<40;step++){
    const pose=await camera(),box=(await canvas.boundingBox())!,dx=(pose.x-cell.x)*8*pose.scale,dy=(pose.y-cell.y)*8*pose.scale;
    if(Math.abs(dx)<24&&Math.abs(dy)<24)break;
    // Keep every real gesture within the viewport, including Firefox pointer
    // capture and narrow phones. A giant drag can leave the browser window.
    const fraction=Math.min(1,box.width*.3/Math.max(1,Math.abs(dx)),box.height*.3/Math.max(1,Math.abs(dy)));
    const center={x:box.x+box.width/2,y:box.y+box.height/2};
    await page.mouse.move(center.x,center.y);await page.mouse.down();
    await page.mouse.move(center.x+dx*fraction,center.y+dy*fraction,{steps:6});await page.mouse.up();
    await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15_000});
  }
  // The public map gesture suppresses taps for 500ms after a pan.
  await page.waitForTimeout(520);
  const current=await camera(),box=(await canvas.boundingBox())!;
  const point={x:box.x+box.width/2+(cell.x-current.x)*8*current.scale,y:box.y+box.height/2+(cell.y-current.y)*8*current.scale};
  expect(point.x).toBeGreaterThan(box.x);expect(point.x).toBeLessThan(box.x+box.width);
  expect(point.y).toBeGreaterThan(box.y);expect(point.y).toBeLessThan(box.y+box.height);
  return point;
}

test('MCP continuation keeps one home and task card, follows realtime progress and preserves the site camera',async({page,hasTouch},info)=>{
  test.setTimeout(180_000);
  const database=process.env.E2E_DATABASE_URL!;
  expect(['127.0.0.1','localhost']).toContain(new URL(database).hostname);
  expect(['127.0.0.1','localhost']).toContain(new URL(process.env.E2E_BASE_URL!).hostname);
  const db=await createDb(database,{migrate:false}),service=new AppService(db);
  const {user}=await registerUser(db,{email:`sprint-chain-${crypto.randomUUID()}@example.test`,name:'Продолжение QA',password:'password123'});
  const mcp=new Client({name:'sprint-chain-browser',version:'1.0.0'});
  const errors:string[]=[],writes:string[]=[],sceneReads:string[]=[];
  try{
    await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(user.countryId);
    const city=await service.createCity(user.countryId,{name:'Город продолжений',idempotencyKey:'city'});
    const first=await service.createDistrict(user.countryId,{cityId:city.id,name:'Первый спринт',activate:true,idempotencyKey:'first'});
    const next=await service.createDistrict(user.countryId,{cityId:city.id,name:'Следующий спринт',idempotencyKey:'next'});
    const task=await service.createTask(user.countryId,{cityId:city.id,districtId:first.id,title:'Одна задача в двух спринтах',estimate:3,idempotencyKey:'task'});
    await service.updateTaskStatus(user.countryId,{taskId:task.id,status:'STARTED',idempotencyKey:'start'});
    await service.updateTaskStatus(user.countryId,{taskId:task.id,status:'IN_PROGRESS',progress:40,idempotencyKey:'progress'});
    expect((await page.request.post('/api/auth/login',{data:{email:user.email,password:'password123'}})).ok()).toBe(true);
    const tokenResponse=await page.request.post('/api/tokens',{data:{name:'Sprint chain QA',scopes:['tasks:read','tasks:write','districts:write'],expiresInDays:30}});
    expect(tokenResponse.ok(),await tokenResponse.text()).toBe(true);
    const token=await tokenResponse.json();
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp',process.env.E2E_BASE_URL),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}}}));
    const call=async(name:string,args:Record<string,unknown>,key=crypto.randomUUID())=>{
      const response=await mcp.callTool({name,arguments:{countryId:user.countryId,idempotencyKey:key,...args}});
      expect(response.isError,JSON.stringify(response.content)).not.toBe(true);
      let value=(response.structuredContent as {result:Record<string,unknown>}).result;
      if(value.status==='accepted'){
        const job=value.job as {id:string};const deadline=Date.now()+45_000;
        do{
          const polled=await mcp.callTool({name:'world_generation.get',arguments:{countryId:user.countryId,jobId:job.id,view:'compact'}});
          expect(polled.isError,JSON.stringify(polled.content)).not.toBe(true);
          value=(polled.structuredContent as {result:Record<string,unknown>}).result;
          if(value.status==='COMPLETED')return value.result;
          expect(value.status).not.toBe('FAILED');
          await new Promise(resolve=>setTimeout(resolve,100));
        }while(Date.now()<deadline);
        throw Error('Continuation background command exceeded the local QA deadline');
      }
      return value;
    };
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{
      const path=new URL(request.url()).pathname;
      if(request.method()!=='GET'&&/^\/api\/(tasks|districts|cities)\//.test(path))writes.push(`${request.method()} ${path}`);
      if(request.method()==='GET'&&/\/scene$|\/api\/world\/viewport|\/api\/chunks\//.test(path))sceneReads.push(path);
    });
    await page.goto(taskLink(user.countryId,task));
    await expect(page.locator('#task-title')).toContainText(task.title);
    await page.getByRole('tab',{name:'Спринты',exact:true}).click();
    await expect(page.getByText('Задача выполняется в одном спринте.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    const host=page.locator('.world-canvas');
    await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:45_000});
    await expect(host).toHaveAttribute('data-mobility-ready','true',{timeout:30_000});
    const canvas=await host.locator('canvas').elementHandle();expect(canvas).not.toBeNull();
    const key=crypto.randomUUID();
    const continued=await call('task.continue',{taskId:task.id,fromDistrictId:first.id,targetDistrictId:next.id,comment:'Оставшаяся работа',resultMode:'compact'},key);
    expect(continued).toMatchObject({id:task.id,taskNumber:task.taskNumber,currentDistrictId:next.id});
    await expect(host).toHaveAttribute('data-continuation-sites','1',{timeout:30_000});
    await call('district.complete',{districtId:first.id});
    await call('district.activate',{districtId:next.id});
    await expect.poll(async()=>JSON.parse(await host.getAttribute('data-development-states')??'[]'))
      .toContainEqual({id:next.id,state:'BUILDING'});
    await expect(host).toHaveAttribute('data-movement-preparing','false',{timeout:30_000});
    const home=await service.getTask(user.countryId,task.id);
    expect(home).toMatchObject({origin:task.origin,footprint:task.footprint,accessPath:task.accessPath,districtId:first.id});
    const feature=(await service.listWorldFeatures(user.countryId)).find(f=>f.continuation?.taskId===task.id)!;
    expect(feature).toBeTruthy();
    const point=await sitePoint(page,feature);
    const camera=()=>host.evaluate(el=>{const d=(el as HTMLElement).dataset;return {x:d.cameraWorldX,y:d.cameraWorldY,scale:d.renderScale};});
    const before=await camera();
    if(hasTouch)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
    await expect(page.locator('#task-title')).toContainText(task.title);
    await expect(page.locator('.task-modal').getByRole('button',{name:/Продолжить|Перенести|Удалить задачу|Изменить статус/})).toHaveCount(0);
    let failedOnce=false;
    await page.route(url=>url.pathname===`/api/tasks/${task.id}/sprints`,async route=>{
      if(!failedOnce){failedOnce=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Временная ошибка истории'})});}
      else await route.continue();
    });
    const tab=page.getByRole('tab',{name:'Спринты',exact:true});
    if(hasTouch)await tab.tap();else{await tab.focus();await page.keyboard.press('Enter');}
    const history=page.locator('.task-sprint-history');
    await expect(history.locator('[role=alert]')).toBeVisible();
    await history.getByRole('button',{name:'Повторить',exact:true}).click();
    await expect(history.locator('.task-sprint-chain li')).toHaveCount(2);
    await expect(history.getByText('Первый спринт',{exact:true})).toHaveCount(2);
    await expect(history.getByText('Зафиксировано при передаче: 40%',{exact:true})).toBeVisible();
    await expect(page.locator('#task-title')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('continuation-history.png'),fullPage:true});
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    await expect.poll(camera).toEqual(before);
    const readsBeforeProgress=sceneReads.length;
    await call('task.set_status',{taskId:task.id,status:'IN_PROGRESS',progress:70});
    await expect.poll(async()=>JSON.parse(await host.getAttribute('data-continuation-states')??'[]'))
      .toContainEqual({id:feature.id,taskId:task.id,outcome:'OPEN',progress:70});
    expect(sceneReads.length).toBe(readsBeforeProgress);
    await call('task.set_status',{taskId:task.id,status:'TESTING',progress:90});
    await call('task.set_status',{taskId:task.id,status:'COMPLETED'});
    await expect.poll(async()=>JSON.parse(await host.getAttribute('data-continuation-states')??'[]'))
      .toContainEqual({id:feature.id,taskId:task.id,outcome:'COMPLETED',progress:100});
    expect(await canvas!.evaluate(node=>node.isConnected)).toBe(true);
    const phases=await service.listTaskSprints(user.countryId,task.id);
    expect(phases.items.map(p=>[p.outcome,p.exitProgress])).toEqual([['CARRIED',40],['COMPLETED',100]]);
    expect((await service.getDistrictWorkload(user.countryId,first.id))).toMatchObject({completedSp:0,carriedOutCount:1});
    expect((await service.getDistrictWorkload(user.countryId,next.id))).toMatchObject({completedSp:3});
    expect(sceneReads.filter(path=>/\/api\/world\/viewport|\/api\/chunks\//.test(path))).toEqual([]);
    expect(writes).toEqual([]);expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath('continuation-world.png'),fullPage:true});
    await info.attach('continuation-evidence',{body:JSON.stringify({viewport:page.viewportSize(),hasTouch,taskId:task.id,taskNumber:task.taskNumber,
      home:task.origin,site:feature.origin,phases:phases.items.map(p=>({outcome:p.outcome,progress:p.exitProgress})),cameraPreserved:true,
      canvasRetained:true,sceneReads,writes,errors}),contentType:'application/json'});
    await call('task.delete',{taskId:task.id,confirmTitle:task.title});
    await expect.poll(async()=>JSON.parse(await host.getAttribute('data-continuation-states')??'[]'))
      .toContainEqual({id:feature.id,taskId:null,outcome:'REMOVED',progress:null});
    const archived=await sitePoint(page,feature);
    if(hasTouch)await page.touchscreen.tap(archived.x,archived.y);else await page.mouse.click(archived.x,archived.y);
    await expect(page.getByRole('heading',{name:'Архивная площадка',exact:true})).toBeVisible();
    await expect(page.getByText(/Задача удалена\. Её связанная площадка сохранена/)).toBeVisible();
    expect(errors).toEqual([]);expect(writes).toEqual([]);
  }finally{
    await page.close();await mcp.close();
    await db.prepare('DELETE FROM countries WHERE id=?').run(user.countryId);
    await db.prepare('DELETE FROM users WHERE id=?').run(user.id);await db.close();
  }
});
