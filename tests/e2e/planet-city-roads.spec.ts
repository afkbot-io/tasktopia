import {expect,test,type Page} from '@playwright/test';
import type {CitySceneDto} from '../../src/shared/city-scene-contract';
const world=(page:Page)=>page.locator('.world-canvas');
const camera=(page:Page)=>world(page).evaluate(el=>({x:Number(el.dataset.cameraWorldX),y:Number(el.dataset.cameraWorldY),scale:Number(el.dataset.renderScale)}));
test('каноническая дорога продолжается за резидентную сцену при панорамировании и изменении окна',async({page},info)=>{
 test.skip(process.env.E2E_NAVIGATION_FIXTURE!=='true','Нужен изолированный мир с несколькими городами');
 test.setTimeout(60000);
 await page.request.post('/api/auth/login',{data:{email:'world-validation@tasktopia.local',password:'tasktopia-world-validation'}});
 const bootstrap=await (await page.request.get('/api/bootstrap')).json();
 const scene=await (await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity.id}/scene`)).json() as CitySceneDto;
 expect(scene.intercityRoads.length).toBeGreaterThan(0);
 await page.goto('/');await page.getByRole('navigation',{name:'Уровень карты'}).getByRole('button',{name:'Город',exact:true}).click();
 const host=world(page);await expect(host).toHaveAttribute('data-loading','false',{timeout:45000});
 const initial=await camera(page),endpoints=scene.intercityRoads.flatMap(r=>{let {x,y}=r.geometry.start;const points=[{x,y}];for(const run of r.geometry.runs){x+=(run.direction==='E'?1:run.direction==='W'?-1:0)*run.length;y+=(run.direction==='S'?1:run.direction==='N'?-1:0)*run.length;points.push({x,y});}return points;});
 const target=endpoints.filter(p=>Math.hypot(p.x-initial.x,p.y-initial.y)>80).sort((a,b)=>Math.hypot(a.x-initial.x,a.y-initial.y)-Math.hypot(b.x-initial.x,b.y-initial.y))[0]!;
 expect(target).toBeTruthy();
 const reads:string[]=[],errors:string[]=[];page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.endsWith('/scene')||p.includes('/chunks/')||p.endsWith('/viewport'))reads.push(p);});page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1920,height:1080});
 const canvas=host.locator('canvas'),box=(await canvas.boundingBox())!;
 for(let n=0;n<10;n++) {
  const c=await camera(page),dx=(c.x-target.x)*8*c.scale,dy=(c.y-target.y)*8*c.scale;
  if(Math.hypot(dx,dy)<4)break;
  const ratio=Math.min(1,box.width*.4/Math.max(1,Math.abs(dx)),box.height*.4/Math.max(1,Math.abs(dy)));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx*ratio,box.y+box.height/2+dy*ratio,{steps:5});await page.mouse.up();
 }
 await expect(host).toHaveAttribute('data-camera-padding-road-pending','0');
 await expect.poll(async()=>Number(await host.getAttribute('data-camera-padding-road-cells'))).toBeGreaterThan(0);
 await expect(host).toHaveAttribute('data-camera-padding-visible-untextured','0');
 await page.screenshot({path:info.outputPath('road-continuation.png')});
 await page.setViewportSize({width:390,height:844});await expect(host).toHaveAttribute('data-camera-padding-visible-untextured','0');await page.screenshot({path:info.outputPath('road-mobile.png')});
 expect(reads).toEqual([]);expect(errors).toEqual([]);
 await info.attach('road-evidence',{body:Buffer.from(JSON.stringify({routes:scene.intercityRoads.map(r=>({id:r.id,width:r.widthCells})),initial,target,camera:await camera(page),reads,metrics:await host.evaluate(el=>({roads:el.dataset.cameraPaddingRoadCells,terrain:el.dataset.cameraPaddingMaterial,missing:el.dataset.cameraPaddingVisibleUntextured}))})),contentType:'application/json'});
});
