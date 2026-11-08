import {expect,test,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createDb,transaction} from '../../src/server/db';
import {registerUser} from '../../src/server/auth';
import {AppService} from '../../src/server/app-service';
import {readActiveBlockLayout,synchronizeCityBlocks} from '../../src/server/world/active-block-layout';
import type {CityTransportFurniture} from '../../src/shared/city-transport-furniture';
import {roadAtlasSurfaceTile} from '../../src/shared/road-atlas';

async function centre(page:Page,point:{x:number;y:number},precision=24){
  const host=page.locator('.world-canvas'),canvas=host.locator('canvas');
  for(let step=0;step<40;step++){
    const pose=await host.evaluate(el=>{const d=(el as HTMLElement).dataset;return{x:Number(d.cameraWorldX),y:Number(d.cameraWorldY),scale:Number(d.renderScale)};});
    const box=(await canvas.boundingBox())!,dx=(pose.x-point.x)*8*pose.scale,dy=(pose.y-point.y)*8*pose.scale;
    if(Math.abs(dx)<precision&&Math.abs(dy)<precision)return;
    const f=Math.min(1,box.width*.3/Math.max(1,Math.abs(dx)),box.height*.3/Math.max(1,Math.abs(dy)));
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+dx*f,box.y+box.height/2+dy*f,{steps:6});await page.mouse.up();
    await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15000});
  }
  throw new Error('Normal pan could not reveal the canonical transport furniture');
}

async function airportPixels(page:Page,cells:{x:number;y:number}[]){
  const tiles=cells.map(cell=>roadAtlasSurfaceTile('PAVEMENT',cell.x,cell.y,15)),shot=(await page.screenshot()).toString('base64');
  return page.evaluate(async({tiles,shot,cells})=>{
    const decode=async(src:string)=>{const image=new Image();image.src=src;await image.decode();const c=document.createElement('canvas');
      c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height);};
    const screen=await decode(`data:image/png;base64,${shot}`),atlas=await decode(`/game-assets/v5/${tiles[0]!.url}`);
    const host=document.querySelector<HTMLElement>('.world-canvas')!,d=host.dataset,box=host.querySelector('canvas')!.getBoundingClientRect();
    const scale=Number(d.renderScale),cx=Number(d.cameraWorldX),cy=Number(d.cameraWorldY),sx=screen.width/innerWidth,sy=screen.height/innerHeight;
    const pairs:{tileIndex:number;expected:number[];actual:number[]}[]=[];
    for(const [tileIndex,cell] of cells.entries())for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      const tile=tiles[tileIndex]!;
      const px=Math.floor((box.x+box.width/2+((cell.x-cx)*8+x+.5)*scale)*sx),py=Math.floor((box.y+box.height/2+((cell.y-cy)*8+y+.5)*scale)*sy);
      if(px<0||py<0||px>=screen.width||py>=screen.height)throw new Error('Native airport pixel probe is outside the viewport');
      const a=((tile.sourceY+y)*atlas.width+tile.sourceX+x)*4,b=(py*screen.width+px)*4;
      pairs.push({tileIndex,expected:[...atlas.data.slice(a,a+3)],actual:[...screen.data.slice(b,b+3)]});
    }
    // The existing world light multiplies each color channel. Fit that one
    // uniform tint; a stretched atlas cannot reproduce the native8x8 pattern.
    const tint=[0,1,2].map(c=>pairs.reduce((n,p)=>n+p.expected[c]!*p.actual[c]!,0)/pairs.reduce((n,p)=>n+p.expected[c]!**2,0));
    const tileMatches=cells.map((_,index)=>pairs.filter(p=>p.tileIndex===index&&p.expected.every((v,c)=>Math.abs(v*tint[c]!-p.actual[c]!)<=2.5)).length);
    return {matches:Math.min(...tileMatches),tileMatches,samples:64,tiles:cells.length,tint,scale};
  },{tiles,shot,cells});
}

test('native permanent airport/rail furniture follows real MCP readiness, survives preferences and clears a demolished owner',async({page},info)=>{
  test.setTimeout(150000);
  if(info.project.use.isMobile)expect(page.viewportSize()!.width).toBeLessThan(500);
  else await page.setViewportSize({width:1440,height:1100});
  const database=process.env.E2E_DATABASE_URL!,origin=process.env.E2E_BASE_URL!;
  expect(['127.0.0.1','localhost']).toContain(new URL(database).hostname);expect(['127.0.0.1','localhost']).toContain(new URL(origin).hostname);
  const db=await createDb(database,{migrate:false}),service=new AppService(db);
  let owner:Awaited<ReturnType<typeof registerUser>>['user']|undefined,mcp:Client|undefined;
  const errors:string[]=[],failures:string[]=[],reads:string[]=[],writes:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{
    if(message.type()==='error'||message.type()==='warning'&&/passive|Pixi.*deprecat|INVALID_(?:OPERATION|VALUE|ENUM)|CONTEXT_LOST|GL_OUT_OF_MEMORY/i.test(message.text()))errors.push(message.text());
  });
  page.on('response',r=>{if(r.status()>=400&&/\/(api|game-assets)\//.test(r.url()))failures.push(`${r.status()} ${r.url()}`);});
  page.on('request',r=>{const p=new URL(r.url()).pathname;if(r.method()==='GET'&&/\/scene$|\/world\/viewport|\/chunks\//.test(p))reads.push(p);
    if(r.method()!=='GET'&&/\/tasks(?:\/|$)/.test(p))writes.push(`${r.method()} ${p}`);});
  try{
    const {user}=await registerUser(db,{email:`furniture-${randomUUID()}@example.test`,name:'Транспортные детали QA',password:'password123'});owner=user;
    await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(user.countryId);
    const city=await service.createCity(user.countryId,{name:'Транспорт одного большого района',idempotencyKey:'city'});
    const district=await service.createDistrict(user.countryId,{cityId:city.id,name:'Один район',activate:true,idempotencyKey:'district'});
    const first=await service.createTask(user.countryId,{cityId:city.id,districtId:district.id,title:'Первый дом',estimate:1,idempotencyKey:'first'});
    await transaction(db,async()=>{
      await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||r.value)).*
        FROM tasks_v3 t CROSS JOIN jsonb_array_elements(?::jsonb) WITH ORDINALITY r(value,ordinality)
        WHERE t.id=? ORDER BY r.ordinality`).run(JSON.stringify(Array.from({length:199},(_,i)=>({id:randomUUID(),task_number:0,title:`Дом ${i+2}`,
        status:'COMPLETED',progress:100,visual_auto:true,service_role_assigned:false,service_role:null,service_trigger:null}))),first.id);
      await db.prepare("UPDATE tasks_v3 SET status='COMPLETED',progress=100 WHERE id=?").run(first.id);
      await synchronizeCityBlocks(db,user.countryId,city.id);
    });
    let tasks=await service.listTasks(user.countryId);
    const airport=tasks.find(t=>t.serviceRole==='AIRPORT')!,station=tasks.find(t=>t.serviceRole==='RAILWAY')!;
    expect(airport).toBeTruthy();expect(station).toBeTruthy();
    // Owned fixture setup only. The observed transition itself goes through MCP.
    await db.prepare("UPDATE tasks_v3 SET status='TESTING',progress=95 WHERE id IN (?,?)").run(airport.id,station.id);
    await synchronizeCityBlocks(db,user.countryId,city.id);
    const before=(await service.getCityScene(user.countryId,city.id)),layout=(await readActiveBlockLayout(db,city.id))!;
    expect(before.airports?.[0]?.plan).toBeTruthy();expect(before.railway).toBeTruthy();
    expect((await page.request.post('/api/auth/login',{data:{email:user.email,password:'password123'}})).ok()).toBe(true);
    const tokenResponse=await page.request.post('/api/tokens',{data:{name:'Owned furniture QA',scopes:['tasks:read','tasks:write'],expiresInDays:30}});
    expect(tokenResponse.ok()).toBe(true);const token=await tokenResponse.json();
    mcp=new Client({name:'furniture-qa',version:'1.0'});await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp',origin),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}}}));
    const call=async(name:string,args:Record<string,unknown>)=>{const result=await mcp!.callTool({name,arguments:{countryId:user.countryId,...args,idempotencyKey:randomUUID()}});
      expect(result.isError,JSON.stringify(result.content)).not.toBe(true);};
    await page.addInitScript(()=>localStorage.setItem('tasktopia:world-preferences:v2',JSON.stringify({quality:'NORMAL',cityLife:false,sound:false})));
    await page.emulateMedia({reducedMotion:'reduce'});
    const url=`/?${new URLSearchParams({countryId:user.countryId,cityId:city.id})}`;
    await page.goto(url);const host=page.locator('.world-canvas');
    await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30000});
    await expect(host).toHaveAttribute('data-canonical-task-count','200');await expect(host).toHaveAttribute('data-transport-furniture','[]');
    const canvas=await host.locator('canvas').elementHandle();
    for(const task of [airport,station])await call('task.set_status',{taskId:task.id,status:'COMPLETED',progress:100,resultMode:'compact'});
    await expect(host).toHaveAttribute('data-transport-furniture-ready','2',{timeout:30000});
    const props=JSON.parse((await host.getAttribute('data-transport-furniture'))!) as CityTransportFurniture[];
    expect(props.map(prop=>prop.kind)).toEqual(['airport-windsock','rail-platform-clock']);
    tasks=await service.listTasks(user.countryId);
    for(const prop of props)for(const task of tasks)expect(task.footprint.some(p=>p.x===prop.origin.x&&p.y===prop.origin.y)).toBe(false);
    const current=await service.getCityScene(user.countryId,city.id);
    expect(current.airports?.map(site=>site.plan)).toEqual(before.airports?.map(site=>site.plan));
    expect(current.railway&&{...current.railway,stage:4,running:false}).toEqual(before.railway);
    const afterLayout=(await readActiveBlockLayout(db,city.id))!;
    expect(afterLayout.blocks).toEqual(layout.blocks);
    expect(afterLayout.placements.map(p=>[p.taskId,p.blockId,p.slotKey,p.buildingFamily,p.facadeVariant,p.serviceRole]))
      .toEqual(layout.placements.map(p=>[p.taskId,p.blockId,p.slotKey,p.buildingFamily,p.facadeVariant,p.serviceRole]));
    await expect.poll(async()=>Number(await host.getAttribute('data-airport-native-material-tiles'))).toBeGreaterThan(500);
    const airfield=current.airports![0]!.plan!.airfield,probe={x:airfield.minX+5,y:airfield.minY+11};
    await centre(page,{x:probe.x+.5,y:probe.y+.5},1);await host.locator('canvas').focus();
    for(let i=0;i<9;i++)await page.keyboard.press('+');
    await expect(host).toHaveAttribute('data-camera-presentation-pending','false');await expect(host).toHaveAttribute('data-ground-bake-queue','0',{timeout:15000});
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    // WebKit can return an older compositor PNG after its DOM/RAF already
    // reached the new pose. Keep 60/64 per native tile; the airfield edge also
    // rejects a plausible flat-pattern match at an intermediate zoom.
    const probes=[probe,{x:airfield.minX,y:probe.y}];
    let pixelProof=await airportPixels(page,probes);
    const pixelCaptures=[pixelProof];
    if(pixelProof.matches<60)await expect.poll(async()=>{
      pixelProof=await airportPixels(page,probes);pixelCaptures.push(pixelProof);return pixelProof.matches;
    },{timeout:15000,message:'Both native airport tiles must be visible at the presented camera pose'}).toBeGreaterThanOrEqual(60);
    expect(pixelProof.matches,JSON.stringify(pixelProof)).toBeGreaterThanOrEqual(60);expect(pixelProof.scale).toBeGreaterThanOrEqual(3);
    expect(pixelProof.tint.every(value=>value>.2&&value<1.2)).toBe(true);
    for(const prop of props){await centre(page,{x:prop.origin.x+.5,y:prop.origin.y});await page.mouse.move(8,8);
      await expect(host).toHaveAttribute('data-ground-bake-queue','0',{timeout:15000});
      await page.screenshot({path:info.outputPath(`${prop.kind}.png`)});}
    const stable=await host.getAttribute('data-transport-furniture'),builds=await host.getAttribute('data-airport-ground-builds');
    await host.locator('canvas').focus();await page.keyboard.press('+');await page.keyboard.press('-');
    await expect(host).toHaveAttribute('data-transport-furniture',stable!);await expect(host).toHaveAttribute('data-airport-ground-builds',builds!);
    let preferences=page.locator('.map-toolbar-actions > nav > .world-preferences');
    if(!await preferences.isVisible()){await page.locator('.world-menu > summary').click();preferences=page.locator('.mobile-menu-tools .world-preferences');}
    await preferences.locator(':scope > summary').click();await preferences.getByLabel('Жизнь города',{exact:true}).check();
    await preferences.getByLabel('Детализация').selectOption('ECONOMY');
    await expect(host).toHaveAttribute('data-world-quality','ECONOMY');await expect(host).toHaveAttribute('data-transport-furniture',stable!);
    await expect(host).toHaveAttribute('data-transport-furniture-ready','2');await page.keyboard.press('Escape');
    expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
    await page.reload();await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30000});
    await expect(host).toHaveAttribute('data-transport-furniture',stable!);await expect(host).toHaveAttribute('data-transport-furniture-ready','2');
    await call('task.delete',{taskId:airport.id,confirmTitle:airport.title});
    await expect.poll(async()=>JSON.parse((await host.getAttribute('data-transport-furniture'))??'[]').map((p:CityTransportFurniture)=>p.taskId)).toEqual([station.id]);
    expect(reads.filter(p=>/\/world\/viewport|\/chunks\//.test(p))).toEqual([]);expect(errors).toEqual([]);expect(failures).toEqual([]);expect(writes).toEqual([]);
    await info.attach('furniture-evidence',{body:JSON.stringify({props,pixelProof,pixelCaptures,builds,reads,errors,failures,writes,viewport:page.viewportSize()}),contentType:'application/json'});
  }finally{await page.close();await mcp?.close();if(owner){await db.prepare('DELETE FROM countries WHERE id=?').run(owner.countryId);await db.prepare('DELETE FROM users WHERE id=?').run(owner.id);}await db.close();}
});
