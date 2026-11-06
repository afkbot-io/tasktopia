import { expect,test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDb } from '../../src/server/db';
import { registerUser } from '../../src/server/auth';
import { AppService } from '../../src/server/app-service';
import { readCountryRoads } from '../../src/server/world/intercity-road-store';
import { decodeOrthogonalRoadRuns } from '../../src/shared/semantic-road';
import { openMapPlanet } from './map-navigation';

test('canonical road survives city growth, task close and planet return without extra city reads',async ({page},info) => {
  test.setTimeout(90_000);
  const database=process.env.E2E_DATABASE_URL!,origin=process.env.E2E_BASE_URL!;
  expect(['127.0.0.1','localhost']).toContain(new URL(database).hostname);
  expect(['127.0.0.1','localhost']).toContain(new URL(origin).hostname);
  const db=await createDb(database,{migrate:false}),service=new AppService(db);
  let owner:Awaited<ReturnType<typeof registerUser>>['user']|undefined;
  const errors:string[]=[],failures:string[]=[],reads:string[]=[],writes:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',r=>{if(r.status()>=400&&/\/(api|game-assets)\//.test(r.url()))failures.push(`${r.status()} ${r.url()}`);});
  page.on('request',r=>{const p=new URL(r.url()).pathname;
    if(r.method()==='GET'&&/\/scene$|\/world\/viewport|\/chunks\//.test(p))reads.push(p);
    if(r.method()!=='GET'&&/\/tasks(?:\/|$)/.test(p))writes.push(`${r.method()} ${p}`);
  });
  try {
    const {user}=await registerUser(db,{email:`road-${randomUUID()}@example.test`,name:'Дороги QA',password:'password123'});owner=user;
    await db.prepare('UPDATE countries SET seed=1 WHERE id=?').run(user.countryId);
    const cities=[],districts=[],tasks=[];
    for(let i=0;i<2;i++) {
      const city=await service.createCity(user.countryId,{name:`Связанный город ${i+1}`,idempotencyKey:`city${i}`});cities.push(city);
      const district=await service.createDistrict(user.countryId,{cityId:city.id,name:'Большой район',activate:true,idempotencyKey:`district${i}`});districts.push(district);
      tasks.push(await service.createTask(user.countryId,{cityId:city.id,districtId:district.id,title:`Первый дом ${i+1}`,estimate:1,idempotencyKey:`task${i}`}));
    }
    const accepted=(await readCountryRoads(db,user.countryId))!;
    expect(accepted.plan.plannerVersion).toBe(3);expect(accepted.plan.routes).toHaveLength(1);
    for(let i=0;i<35;i++)await service.createTask(user.countryId,{cityId:cities[0]!.id,districtId:districts[0]!.id,title:`Рост ${i}`,estimate:1,idempotencyKey:`growth${i}`});
    expect((await readCountryRoads(db,user.countryId))!.plan.routes).toEqual(accepted.plan.routes);
    const first=await service.getTask(user.countryId,tasks[0]!.id),scene=await service.getCityScene(user.countryId,cities[0]!.id);
    expect(scene.intercityRoads).toEqual(accepted.plan.routes);
    // Route orientation follows IDs, so its first outside point may belong
    // to the remote city. Review our local exit within the existing clamp.
    const distance=(p:{x:number;y:number})=>Math.max(scene.city.bounds.minX-p.x,0,p.x-scene.city.bounds.maxX)
      +Math.max(scene.city.bounds.minY-p.y,0,p.y-scene.city.bounds.maxY);
    const exit=decodeOrthogonalRoadRuns(accepted.plan.routes[0]!.geometry).filter(p=>distance(p)>0)
      .sort((a,b)=>distance(a)-distance(b)||a.y-b.y||a.x-b.x)[0]!;
    expect(exit).toBeDefined();
    const canonical=await db.prepare('SELECT * FROM country_road_snapshots_v1 WHERE country_id=?').get(user.countryId);
    expect((await page.request.post('/api/auth/login',{data:{email:user.email,password:'password123'}})).ok()).toBe(true);
    await page.goto(`/?${new URLSearchParams({countryId:user.countryId,cityId:cities[0]!.id})}`);
    const host=page.locator('.world-canvas');
    await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30_000});
    await expect(host).toHaveAttribute('data-intercity-road-routes','1');
    const search=page.getByRole('combobox',{name:'Поиск здания по номеру или названию'});
    await search.fill(`#${first.taskNumber}`);await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);await search.press('Enter');
    await expect(page.locator('#task-title')).toContainText(first.title);
    await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15_000});
    const canvas=await host.locator('canvas').elementHandle();
    const pose=async()=>host.evaluate(el=>{const d=(el as HTMLElement).dataset;return{x:d.cameraWorldX,y:d.cameraWorldY,scale:d.renderScale};});
    const before=await pose();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    await expect.poll(pose).toEqual(before);
    for(let i=0;i<8;i++) {
      const current=await pose(),box=(await host.locator('canvas').boundingBox())!,scale=8*Number(current.scale);
      const dx=(Number(current.x)-exit.x)*scale,dy=(Number(current.y)-exit.y)*scale;
      if(Math.abs(dx)<24&&Math.abs(dy)<24)break;
      const f=Math.min(1,box.width*.3/Math.max(1,Math.abs(dx)),box.height*.3/Math.max(1,Math.abs(dy)));
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      await page.mouse.move(box.x+box.width/2+dx*f,box.y+box.height/2+dy*f,{steps:6});await page.mouse.up();
      await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15_000});
    }
    await expect.poll(async()=>host.evaluate((el,p)=>{const d=(el as HTMLElement).dataset,c=el.querySelector('canvas')!,s=8*Number(d.renderScale);
      return Math.abs((Number(d.cameraWorldX)-p.x)*s)<c.clientWidth/2-12&&Math.abs((Number(d.cameraWorldY)-p.y)*s)<c.clientHeight/2-80;},exit)).toBe(true);
    await expect(host).toHaveAttribute('data-ground-bake-queue','0',{timeout:15_000});
    await page.mouse.move(8,8);await page.screenshot({path:info.outputPath('city-road.png')});
    await openMapPlanet(page);await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true',{timeout:30_000});
    const overview=await (await page.request.get(`/api/countries/${user.countryId}/overview`)).json();
    expect(overview.groundRoads.routes.map((route:{id:string})=>route.id)).toEqual(accepted.plan.routes.map(route=>route.id));
    await page.screenshot({path:info.outputPath('planet-road.png')});
    const target=page.locator(`.planet-city-targets [data-city-id="${cities[0]!.id}"]`);
    await target.click();await expect(page.locator('.planet-atlas')).toHaveAttribute('data-globe-zoom','3.00');
    await page.screenshot({path:info.outputPath('country-road.png')});
    await target.focus();await page.keyboard.press('Enter');
    await expect(host).toBeVisible();await expect(page.locator('.map-level-transition')).toHaveCount(0);
    await expect(host).toHaveAttribute('data-intercity-road-routes','1');
    expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
    expect(reads.filter(p=>p.endsWith('/scene'))).toHaveLength(1);
    expect(reads.filter(p=>/\/world\/viewport|\/chunks\//.test(p))).toEqual([]);
    expect(errors).toEqual([]);expect(failures).toEqual([]);expect(writes).toEqual([]);
    expect(await db.prepare('SELECT * FROM country_road_snapshots_v1 WHERE country_id=?').get(user.countryId)).toEqual(canonical);
    const evidence=JSON.stringify({routes:accepted.plan.routes,exit,reads,errors,failures,writes});
    await writeFile(info.outputPath('road-continuity.json'),evidence);
    await info.attach('road-continuity',{body:evidence,contentType:'application/json'});
  } finally {
    if(owner){await db.prepare('DELETE FROM countries WHERE id=?').run(owner.countryId);await db.prepare('DELETE FROM users WHERE id=?').run(owner.id);}
    await db.close();
  }
});
