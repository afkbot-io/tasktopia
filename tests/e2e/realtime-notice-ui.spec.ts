import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createDb} from '../../src/server/db';
import {registerUser} from '../../src/server/auth';
import {AppService} from '../../src/server/app-service';

test('real MCP notices coalesce, leave compact map space and preserve their latest expiry and task link',async({page},info)=>{
  test.setTimeout(90_000);
  const database=process.env.E2E_DATABASE_URL!,origin=process.env.E2E_BASE_URL!;
  expect(['127.0.0.1','localhost']).toContain(new URL(database).hostname);
  expect(['127.0.0.1','localhost']).toContain(new URL(origin).hostname);
  const db=await createDb(database,{migrate:false}),service=new AppService(db);
  let owner:Awaited<ReturnType<typeof registerUser>>['user']|undefined,mcp:Client|undefined;
  const errors:string[]=[],failures:string[]=[],reads:string[]=[],writes:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&/\/(api|game-assets)\//.test(r.url()))failures.push(`${r.status()} ${r.url()}`);});
  page.on('request',r=>{const path=new URL(r.url()).pathname;
    if(r.method()==='GET'&&/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);
    if(r.method()!=='GET'&&/\/tasks(?:\/|$)/.test(path))writes.push(`${r.method()} ${path}`);
  });
  try{
    const {user}=await registerUser(db,{email:`notice-${randomUUID()}@example.test`,name:'Уведомления QA',password:'password123'});owner=user;
    await db.prepare('UPDATE countries SET seed=1 WHERE id=?').run(user.countryId);
    const city=await service.createCity(user.countryId,{name:'Город уведомлений',idempotencyKey:'city'});
    const district=await service.createDistrict(user.countryId,{cityId:city.id,name:'Район',activate:true,idempotencyKey:'district'});
    const tasks:Awaited<ReturnType<AppService['createTask']>>[]=[];
    for(let i=0;i<3;i++)tasks.push(await service.createTask(user.countryId,{cityId:city.id,districtId:district.id,
      title:`Объект ${i+1}: ${'длинное название для проверки доступности и высоты карточки '.repeat(3)}`.slice(0,160),visualKind:'BUILDING',estimate:1,idempotencyKey:`task${i}`}));
    expect((await page.request.post('/api/auth/login',{data:{email:user.email,password:'password123'}})).ok()).toBe(true);
    const tokenResponse=await page.request.post('/api/tokens',{data:{name:'Owned notices QA',scopes:['tasks:read','tasks:write'],expiresInDays:30}});
    expect(tokenResponse.ok()).toBe(true);const token=await tokenResponse.json();
    mcp=new Client({name:'notices-qa',version:'1.0'});
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp',origin),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}}}));
    const call=async(name:string,args:Record<string,unknown>)=>{
      const result=await mcp!.callTool({name,arguments:{countryId:user.countryId,...args,idempotencyKey:randomUUID()}});
      expect(result.isError,JSON.stringify(result.content)).not.toBe(true);return result;
    };
    const status=async(index:number,value:string)=>call('task.set_status',{taskId:tasks[index]!.id,status:value,resultMode:'compact'});
    const rename=async(index:number,prefix:string)=>{
      const task=tasks[index]!,title=`${prefix}: ${task.title}`.slice(0,160);
      await call('task.rename',{taskId:task.id,title});tasks[index]={...task,title};
    };
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(`/?${new URLSearchParams({countryId:user.countryId,cityId:city.id})}`);
    const host=page.locator('.world-canvas'),cards=page.locator('.realtime-notice'),visible=page.locator('.realtime-notice:visible');
    await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30000});
    await expect(host).toHaveAttribute('data-mobility-ready','true',{timeout:30000});
    const retained=await host.locator('canvas').elementHandle();
    await status(0,'STARTED');await status(0,'IN_PROGRESS');await status(0,'TESTING');
    await expect(cards).toHaveCount(1);
    await expect(cards.locator('.realtime-notice-compact-title')).toHaveText(`№${tasks[0]!.taskNumber}: Приёмка`);
    const stageReads=reads.filter(p=>p.endsWith('/scene')).length;expect(stageReads).toBe(1);
    await status(2,'STARTED');
    // Structural status changes may legitimately take longer than the toast's
    // lifetime. Use actual lightweight MCP edits for the three-group burst.
    await rename(0,'Актуальное A');await rename(1,'Актуальное B');await rename(2,'Актуальное C');
    await expect(cards).toHaveCount(3);
    const viewport=page.viewportSize()!,mobile=viewport.width<=600;
    if(info.project.use.isMobile)expect(viewport.width).toBeLessThan(500);
    await expect(visible).toHaveCount(mobile?1:3);
    const latest=cards.last(),box=(await latest.boundingBox())!,toolbar=(await page.locator('.map-toolbar').boundingBox())!,nav=(await page.locator('.map-level-nav').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(toolbar.y+toolbar.height);
    expect(box.y+box.height).toBeLessThan(nav.y);
    const close=(await latest.getByRole('button',{name:'Закрыть уведомление'}).boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(44);expect(close.height).toBeGreaterThanOrEqual(44);
    await expect(latest.locator('.realtime-notice-content')).toHaveAccessibleName(new RegExp(tasks[2]!.title.slice(0,20)));
    if(mobile){
      expect(box.height).toBeLessThanOrEqual(96);
      // Hidden historical groups must not leave focusable buttons on phones.
      await expect(cards.first().locator('.realtime-notice-content')).toBeHidden();
      await cards.first().locator('.realtime-notice-content').evaluate(el=>el.focus());
      await expect(cards.first().locator('.realtime-notice-content')).not.toBeFocused();
      await page.setViewportSize({width:1440,height:900});await expect(visible).toHaveCount(3);
      await page.setViewportSize(viewport);await expect(visible).toHaveCount(1);
    }
    await page.screenshot({path:info.outputPath('notices-map.png')});
    await call('task.delete',{taskId:tasks[0]!.id,confirmTitle:tasks[0]!.title});
    await expect(cards.last().locator('.realtime-notice-compact-title')).toHaveText(`№${tasks[0]!.taskNumber}: Снесено`);
    await expect(cards.filter({hasText:`№${tasks[0]!.taskNumber}: Снесено`})).toHaveCount(1);
    expect(await cards.count()).toBeLessThanOrEqual(3);await expect(cards.last().locator('.realtime-notice-content')).toBeDisabled();
    const dismiss=cards.last().getByRole('button',{name:'Закрыть уведомление'});
    if(mobile)await dismiss.click();else{await dismiss.focus();await page.keyboard.press('Enter');}
    await rename(2,'Открытие C');
    await expect(cards.last().locator('.realtime-notice-compact-title')).toHaveText(`№${tasks[2]!.taskNumber}: Новое название`);
    let release!:()=>void,started=false;const pending=new Promise<void>(resolve=>{release=resolve;});
    await page.route(`**/api/tasks/${tasks[2]!.id}/card?*`,async route=>{started=true;await pending;await route.continue().catch(()=>undefined);});
    try{
      await cards.last().locator('.realtime-notice-content').click();
      await expect.poll(()=>started).toBe(true);
      await expect(page.getByRole('status')).toContainText('Загружаем задачу');
      await expect(page.locator('#task-title')).toHaveCount(0);
      release();await expect(page.locator('#task-title')).toHaveText(tasks[2]!.title);
    }finally{release();}
    await expect(page).toHaveURL(new RegExp(`taskId=${tasks[2]!.id}`));
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    // The old seven-second timer may expire, but cannot remove the replacement.
    await status(2,'IN_PROGRESS');
    const fresh=page.locator('.realtime-notice').last();
    await expect(fresh.locator('.realtime-notice-compact-title')).toHaveText(`№${tasks[2]!.taskNumber}: Строительство`);
    const oldId=await fresh.getAttribute('data-notice-id');
    await page.waitForTimeout(5500);
    await status(2,'TESTING');
    await expect(fresh.locator('.realtime-notice-compact-title')).toHaveText(`№${tasks[2]!.taskNumber}: Приёмка`);
    const newId=await fresh.getAttribute('data-notice-id');expect(newId).not.toBe(oldId);
    await page.waitForTimeout(2000);
    await expect(page.locator(`[data-notice-id="${newId}"]`)).toBeVisible();
    await expect(page.locator(`[data-notice-id="${newId}"]`)).toHaveCount(0,{timeout:6500});
    expect(await retained!.evaluate(el=>el.isConnected)).toBe(true);
    expect(reads.filter(p=>/\/world\/viewport|\/chunks\//.test(p))).toEqual([]);
    expect(errors).toEqual([]);expect(failures).toEqual([]);expect(writes).toEqual([]);
    await info.attach('notice-evidence',{body:JSON.stringify({viewport,box,close,oldId,newId,stageReads,reads,writes,errors,failures}),contentType:'application/json'});
  }finally{
    await page.close();await mcp?.close();
    if(owner){await db.prepare('DELETE FROM countries WHERE id=?').run(owner.countryId);await db.prepare('DELETE FROM users WHERE id=?').run(owner.id);}await db.close();
  }
});
