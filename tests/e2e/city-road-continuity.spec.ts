import { expect,test,type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createDb } from '../../src/server/db';
import { registerUser } from '../../src/server/auth';
import { AppService } from '../../src/server/app-service';
import { readCountryRoads } from '../../src/server/world/intercity-road-store';
import { INTERCITY_ROAD_PLANNER_VERSION } from '../../src/server/world/intercity-road-planner';
import { expandRoadRuns,expandSurfaceRuns } from '../../src/shared/world-cell-runs';
import { CityRoadPadding } from '../../src/client/city-road-padding';
import { isBuildableTerrain,terrainAt } from '../../src/shared/world-terrain';
import { roadAtlasTile } from '../../src/shared/road-atlas';
import { roadMarkingAxis } from '../../src/shared/road-profile';
import type { CitySceneDto } from '../../src/shared/city-scene-contract';
import type { RoadCellDto } from '../../src/shared/contracts';
import { decodeOrthogonalRoadRuns } from '../../src/shared/semantic-road';
import { openMapPlanet } from './map-navigation';
import {projectPlanetAtlas} from '../../src/shared/planet-atlas';
import type {PlanetAtlasDto} from '../../src/shared/planet-atlas-contract';
import {compactPlanetCities} from '../../src/client/planet-presentation';
import {projectPlanetGroundRoads} from '../../src/shared/planet-ground-road-projection';
import {planPlanetGroundRoadRaster} from '../../src/client/planet-ground-road-raster';

// Pixel probes below capture the native raster explicitly. Repeated automatic
// readbacks otherwise stall the hosted software GPU during ordinary gestures.
test.use({trace:{mode:'retain-on-failure',snapshots:false,screenshots:false,sources:true}});

async function actualCityRoadPixels(page:Page,scene:CitySceneDto,seed:number){
  const host=page.locator('.world-canvas'),canvas=host.locator('canvas');
  for(let i=0;i<8&&Number(await host.getAttribute('data-render-scale'))<4;i++){
    const before=Number(await host.getAttribute('data-render-scale'));
    const box=(await canvas.boundingBox())!;
    await canvas.dispatchEvent('wheel',{deltaY:-250,clientX:box.x+box.width/2,clientY:box.y+box.height/2,bubbles:true});
    await expect.poll(async()=>Number(await host.getAttribute('data-render-scale'))).toBeGreaterThan(before);
    await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15000});
  }
  // Terrain presentation readiness does not mean the smooth wheel zoom has
  // finished. Sample a settled native4x frame, so metadata and screenshot use
  // the same transform (as in the existing transport/art pixel checks).
  await expect.poll(async()=>Number(await host.getAttribute('data-render-scale')),{timeout:15000}).toBe(4);
  await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15000});
  await expect(host).toHaveAttribute('data-ground-bake-queue','0',{timeout:15000});
  const view=await host.evaluate(el=>{const d=(el as HTMLElement).dataset,c=el.querySelector('canvas')!;
    return{x:Number(d.cameraWorldX),y:Number(d.cameraWorldY),scale:Number(d.renderScale),width:c.clientWidth,height:c.clientHeight};});
  expect(view.scale).toBeGreaterThanOrEqual(3);
  const padding=new CityRoadPadding(scene,p=>isBuildableTerrain(terrainAt(seed,p.x,p.y).terrain)),residents=new Map(scene.chunks.map(c=>[`${c.chunkX},${c.chunkY}`,c]));
  const roads=new Map<string,RoadCellDto>(),crossings=new Set<string>();
  const dx=view.width/(16*view.scale),dy=view.height/(16*view.scale),size=scene.chunkSize;
  for(let y=Math.floor((view.y-dy)/size)-1;y<=Math.floor((view.y+dy)/size)+1;y++)for(let x=Math.floor((view.x-dx)/size)-1;x<=Math.floor((view.x+dx)/size)+1;x++){
    const resident=residents.get(`${x},${y}`),extra=resident?undefined:padding.get(x,y);
    for(const c of resident?expandRoadRuns(resident.roadRuns):extra?.roads??[])roads.set(`${c.x},${c.y}`,c);
    for(const c of resident?expandSurfaceRuns(resident.surfaceRuns):extra?.surfaces??[])if(c.kind==='CROSSWALK')crossings.add(`${c.x},${c.y}`);
  }
  const candidates=[...roads.values()].filter(c=>c.roadClass===scene.intercityRoads[0]!.roadClass&&c.widthCells===3&&c.structure==='ROAD'
    &&Math.abs(c.x+.5-view.x)<dx-2&&Math.abs(c.y+.5-view.y)<dy-2&&!crossings.has(`${c.x},${c.y}`)&&!roadMarkingAxis(roads,c))
    .slice(0,64).map(cell=>({cell,tile:roadAtlasTile(process.env.E2E_ROAD_PIXEL_WRONG_CLASS==='true'?{...cell,roadClass:'LOCAL'}:cell),wrong:roadAtlasTile({...cell,roadClass:'LOCAL'})}));
  expect(candidates.length).toBeGreaterThanOrEqual(2);
  const shot=(await canvas.screenshot()).toString('base64');
  return page.evaluate(async({shot,candidates,view})=>{
    const decode=async(src:string)=>{const image=new Image();image.src=src;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height);};
    const screen=await decode(`data:image/png;base64,${shot}`),atlas=await decode(`/game-assets/v5/${candidates[0]!.tile.url}`),sx=screen.width/view.width,sy=screen.height/view.height;
    const samples=candidates.map(({cell,tile,wrong})=>{
      let matches=0,wrongMatches=0;
      for(let y=0;y<8;y++)for(let x=0;x<8;x++){
        const px=Math.floor((view.width/2+((cell.x-view.x)*8+x+.5)*view.scale)*sx),py=Math.floor((view.height/2+((cell.y-view.y)*8+y+.5)*view.scale)*sy),actual=(py*screen.width+px)*4;
        for(const [frame,isWrong] of [[tile,false],[wrong,true]] as const){
          const expected=((frame.sourceY+y)*atlas.width+frame.sourceX+x)*4;
          if([0,1,2].every(c=>Math.abs(screen.data[actual+c]!-atlas.data[expected+c]!)<=1)){if(isWrong)wrongMatches++;else matches++;}
        }
      }
      return{cell,matches,wrongMatches};
    });
    return{scale:view.scale,samples,best:[...samples].sort((a,b)=>b.matches-a.matches)[0]!};
  },{shot,candidates,view});
}

async function actualRoadPixels(page:Page){
  const shot=(await page.screenshot()).toString('base64');
  return page.evaluate(async screenshot=>{
    const decode=async(src:string)=>{const image=new Image();image.src=src;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d')!;context.drawImage(image,0,0);return context.getImageData(0,0,image.width,image.height);};
    const screen=await decode(`data:image/png;base64,${screenshot}`),sx=screen.width/innerWidth,sy=screen.height/innerHeight;
    let sampled=0,matches=0,sourceOpaque=0;const ids:string[]=[],rendering:string[]=[],misses:unknown[]=[];
    const images=[...document.querySelectorAll<SVGImageElement>('.planet-ground-road-raster')];
    for(const image of images){
      const matrix=image.getScreenCTM();if(!matrix)continue;
      ids.push(...JSON.parse(image.dataset.groundRoadIds!));rendering.push(getComputedStyle(image).imageRendering);
      const pixels=await decode(image.href.baseVal),opaque:number[]=[];
      for(let i=0;i<pixels.data.length;i+=4)if(pixels.data[i+3]===255)opaque.push(i/4);
      sourceOpaque+=opaque.length;
      const filter=getComputedStyle(image.closest('.planet-countries')!).filter;
      const brightness=Number(/brightness\(([0-9.]+)\)/.exec(filter)?.[1]??1);
      for(let n=0;n<Math.min(96,opaque.length);n++){
        const index=opaque[Math.floor(n*opaque.length/Math.min(96,opaque.length))]!,px=index%pixels.width,py=Math.floor(index/pixels.width);
        const wx=image.x.baseVal.value+(px+.5)/pixels.width*image.width.baseVal.value;
        const wy=image.y.baseVal.value+(py+.5)/pixels.height*image.height.baseVal.value;
        const x=Math.floor((matrix.a*wx+matrix.c*wy+matrix.e)*sx),y=Math.floor((matrix.b*wx+matrix.d*wy+matrix.f)*sy);
        if(x<2||y<2||x>=screen.width-2||y>=screen.height-2)continue;
        sampled++;const expected=[0,1,2].map(c=>Math.min(255,Math.round(pixels.data[index*4+c]!*brightness)));
        let match=false;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const offset=((y+dy)*screen.width+x+dx)*4;
          if(expected.every((value,c)=>Math.abs(screen.data[offset+c]!-value)<=2))match=true;
        }
        if(match)matches++;else if(misses.length<5)misses.push({x,y,expected,actual:[...screen.data.slice((y*screen.width+x)*4,(y*screen.width+x)*4+4)]});
      }
    }
    return {images:images.length,ids,rendering,sourceOpaque,sampled,matches,misses};
  },shot);
}

test('canonical road survives city growth, task close and planet return without extra city reads',async ({page},info) => {
  test.setTimeout(90_000);
  if(process.env.E2E_ROAD_TALL==='true'&&!info.project.use.isMobile)await page.setViewportSize({width:1440,height:1100});
  const database=process.env.E2E_DATABASE_URL!,origin=process.env.E2E_BASE_URL!;
  expect(['127.0.0.1','localhost']).toContain(new URL(database).hostname);
  expect(['127.0.0.1','localhost']).toContain(new URL(origin).hostname);
  const db=await createDb(database,{migrate:false}),service=new AppService(db);
  let owner:Awaited<ReturnType<typeof registerUser>>['user']|undefined;
  let mcp:Client|undefined,injectAssetFailure=false;
  const expectedFailures:string[]=[];
  const errors:string[]=[],warnings:string[]=[],failures:string[]=[],reads:string[]=[],writes:string[]=[];
  const atlasReads:Promise<PlanetAtlasDto|undefined>[]=[];
  page.on('response',response=>{
    if(new URL(response.url()).pathname==='/api/planet-atlas'&&response.ok())atlasReads.push(response.json().catch(error=>{
      errors.push(`Atlas evidence: ${String(error)}`);return undefined;
    }));
  });
  if(process.env.E2E_ROAD_FAULT==='true')await page.route('**/atlas/road-v2/surface.png',async route=>
    injectAssetFailure?route.fulfill({status:503,body:'Owned QA road material failure'}):route.continue());
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    const expected=message.location().url.endsWith('/atlas/road-v2/surface.png')&&/503/.test(message.text());
    if(message.type()==='warning')warnings.push(message.text());
    // Screenshot readback emits a driver Performance/ReadPixels diagnostic.
    // Preserve it as evidence; actual GL failures and API misuse still fail.
    if(message.type()==='error'&&!expected||message.type()==='warning'&&/passive|Pixi.*deprecat|INVALID_(?:OPERATION|VALUE|ENUM|FRAMEBUFFER)|CONTEXT_LOST|GL_OUT_OF_MEMORY/i.test(message.text()))errors.push(message.text());
  });
  page.on('response',r=>{if(r.status()>=400&&/\/(api|game-assets)\//.test(r.url())){
    if(injectAssetFailure&&r.status()===503&&r.url().endsWith('/atlas/road-v2/surface.png'))expectedFailures.push(r.url());
    else failures.push(`${r.status()} ${r.url()}`);
  }});
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
    expect(accepted.plan.plannerVersion).toBe(INTERCITY_ROAD_PLANNER_VERSION);expect(accepted.plan.routes).toHaveLength(1);
    expect(['COLLECTOR','ARTERIAL']).toContain(accepted.plan.routes[0]!.roadClass);
    for(let i=0;i<35;i++)await service.createTask(user.countryId,{cityId:cities[0]!.id,districtId:districts[0]!.id,title:`Рост ${i}`,estimate:1,idempotencyKey:`growth${i}`});
    expect((await readCountryRoads(db,user.countryId))!.plan.routes).toEqual(accepted.plan.routes);
    const first=await service.getTask(user.countryId,tasks[0]!.id),scene=await service.getCityScene(user.countryId,cities[0]!.id);
    expect(scene.intercityRoads).toEqual(accepted.plan.routes);
    expect(scene.chunks.flatMap(chunk=>expandRoadRuns(chunk.roadRuns))
      .some(road=>road.roadClass===accepted.plan.routes[0]!.roadClass)).toBe(true);
    // Route orientation follows IDs, so its first outside point may belong
    // to the remote city. Review our local exit within the existing clamp.
    const distance=(p:{x:number;y:number})=>Math.max(scene.city.bounds.minX-p.x,0,p.x-scene.city.bounds.maxX)
      +Math.max(scene.city.bounds.minY-p.y,0,p.y-scene.city.bounds.maxY);
    const exit=decodeOrthogonalRoadRuns(accepted.plan.routes[0]!.geometry).filter(p=>distance(p)>0)
      .sort((a,b)=>distance(a)-distance(b)||a.y-b.y||a.x-b.x)[0]!;
    expect(exit).toBeDefined();
    const canonical=await db.prepare('SELECT * FROM country_road_snapshots_v1 WHERE country_id=?').get(user.countryId);
    expect((await page.request.post('/api/auth/login',{data:{email:user.email,password:'password123'}})).ok()).toBe(true);
    await page.addInitScript(()=>localStorage.setItem('tasktopia:world-preferences:v2',JSON.stringify({quality:'NORMAL',cityLife:false,sound:false})));
    if(process.env.E2E_ROAD_FAULT==='true'){
      // Fail the first PLANET load before CITY can warm the same PNG in the
      // browser's decoded image cache. A later route handler cannot evict it.
      injectAssetFailure=true;
      await page.goto(`/?${new URLSearchParams({countryId:user.countryId})}`);
      const alert=page.getByRole('alert').filter({hasText:'Не удалось загрузить графику карты'});
      await expect(alert).toBeVisible();expect(expectedFailures.length).toBeGreaterThan(0);
      injectAssetFailure=false;await alert.getByRole('button',{name:'Повторить',exact:true}).click();await expect(alert).toHaveCount(0);
      await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true',{timeout:30_000});
      await page.locator(`.planet-city-targets [data-city-id="${cities[0]!.id}"]`).focus();await page.keyboard.press('Enter');
    }else await page.goto(`/?${new URLSearchParams({countryId:user.countryId,cityId:cities[0]!.id})}`);
    const host=page.locator('.world-canvas');
    await expect(host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30_000});
    await expect(host).toHaveAttribute('data-intercity-road-routes','1');
    await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15_000});
    const canvas=await host.locator('canvas').elementHandle();
    const pose=async()=>host.evaluate(el=>{const d=(el as HTMLElement).dataset;return{x:d.cameraWorldX,y:d.cameraWorldY,scale:d.renderScale};});
    const search=page.getByRole('combobox',{name:'Поиск здания по номеру или названию'});
    await search.fill(`#${first.taskNumber}`);await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);await search.press('Enter');
    await expect(page.locator('#task-title')).toContainText(first.title);
    // Card content paints before its deferred map focus. Observe that focus
    // and its presentation before saving the pose that dismiss must preserve.
    await expect(host).toHaveAttribute('data-focus-x',String(first.origin.x));
    await expect(host).toHaveAttribute('data-focus-y',String(first.origin.y));
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(host).toHaveAttribute('data-camera-presentation-pending','false',{timeout:15_000});
    const before=await pose();
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();
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
    const cityPixels=await actualCityRoadPixels(page,scene,1);
    await writeFile(info.outputPath('city-road-pixels.json'),JSON.stringify(cityPixels));
    expect(cityPixels.best.matches,JSON.stringify(cityPixels)).toBeGreaterThanOrEqual(60);
    expect(cityPixels.best.wrongMatches).toBeLessThan(cityPixels.best.matches);
    await page.mouse.move(8,8);await page.screenshot({path:info.outputPath('city-road.png')});
    await openMapPlanet(page);
    await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true',{timeout:30_000});
    const planet=page.locator('.planet-atlas');
    const atlas=(await atlasReads.at(-1)!)!;
    expect(atlas).toBeDefined();
    const projected=compactPlanetCities(projectPlanetAtlas(atlas,atlas.geography?.countries[user.countryId]?.sector??0));
    const projectedRoads=projectPlanetGroundRoads(projected),rasterPlan=planPlanetGroundRoadRaster(projected,projectedRoads);
    await writeFile(info.outputPath('planet-road-projection.json'),JSON.stringify({atlas,projectedRoads,
      rejectedRouteIds:rasterPlan.rejectedRouteIds,pixelCount:rasterPlan.pixelCount}));
    await expect(planet).toHaveAttribute('data-ground-road-routes','1');
    await expect(planet).toHaveAttribute('data-ground-road-unavailable','0');
    await expect(planet).toHaveAttribute('data-ground-road-omitted','0');
    const roadBuilds=await planet.getAttribute('data-ground-road-builds');
    const overview=await (await page.request.get(`/api/countries/${user.countryId}/overview`)).json();
    expect(overview.groundRoads.routes.map((route:{id:string})=>route.id)).toEqual(accepted.plan.routes.map(route=>route.id));
    await page.screenshot({path:info.outputPath('planet-road.png')});
    const target=page.locator(`.planet-city-targets [data-city-id="${cities[0]!.id}"]`);
    await target.click();await expect(page.locator('.planet-atlas')).toHaveAttribute('data-globe-zoom','3.00');
    // Review the corridor at the normal close overview. At3x both city labels
    // can cover most of this tiny island on compact screens.
    const roadBox=(await page.locator('.planet-ground-road-raster').boundingBox())!;
    await page.locator('.planet-atlas > svg').dispatchEvent('wheel',{deltaY:-400,
      clientX:roadBox.x+roadBox.width/2,clientY:roadBox.y+roadBox.height/2,bubbles:true});
    await expect(planet).toHaveAttribute('data-globe-zoom','5.47');
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const pixelProbe=await actualRoadPixels(page);
    await writeFile(info.outputPath('road-pixels.json'),JSON.stringify(pixelProbe));
    expect(pixelProbe.ids).toEqual(accepted.plan.routes.map(route=>route.id));expect(pixelProbe.rendering).toEqual(['pixelated']);
    expect(pixelProbe.sampled).toBeGreaterThanOrEqual(8);expect(pixelProbe.matches).toBeGreaterThanOrEqual(5);
    expect(await planet.getAttribute('data-ground-road-builds')).toBe(roadBuilds);
    await page.screenshot({path:info.outputPath('country-road.png')});
    await target.focus();await page.keyboard.press('Enter');
    await expect(host).toBeVisible();await expect(page.locator('.map-level-transition')).toHaveCount(0);
    await expect(host).toHaveAttribute('data-intercity-road-routes','1');
    expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
    expect(reads.filter(p=>p.endsWith('/scene'))).toHaveLength(1);
    expect(reads.filter(p=>/\/world\/viewport|\/chunks\//.test(p))).toEqual([]);
    expect(errors).toEqual([]);expect(failures).toEqual([]);expect(writes).toEqual([]);
    expect(await db.prepare('SELECT * FROM country_road_snapshots_v1 WHERE country_id=?').get(user.countryId)).toEqual(canonical);
    let realtimeEvidence:unknown;
    if(process.env.E2E_ROAD_REALTIME==='true'){
      await openMapPlanet(page);await expect(planet).toHaveAttribute('data-planet-ready','true',{timeout:30_000});
      const tokenResponse=await page.request.post('/api/tokens',{data:{name:'Road realtime QA',scopes:['tasks:read','tasks:write'],expiresInDays:30}});
      expect(tokenResponse.ok()).toBe(true);const token=await tokenResponse.json();
      mcp=new Client({name:'road-realtime-qa',version:'1.0.0'});
      await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp',origin),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}}}));
      const beforeRevision=(await readCountryRoads(db,user.countryId))!.revision;
      let calls=0;
      for(;calls<16;calls++){
        const response=await mcp.callTool({name:'task.create',arguments:{countryId:user.countryId,cityId:cities[0]!.id,districtId:districts[0]!.id,
          title:`Рост через настоящий MCP ${calls}`,estimate:1,idempotencyKey:`mcp-road-growth-${calls}`}});
        expect(response.isError,JSON.stringify(response.content)).not.toBe(true);
        const command=(response.structuredContent as {result:{status?:string}}).result;
        expect(command.status).not.toBe('accepted'); // This isolated web server runs the combined runtime.
        if((await readCountryRoads(db,user.countryId))!.revision>beforeRevision){calls++;break;}
      }
      const updated=(await readCountryRoads(db,user.countryId))!;
      expect(updated.revision).toBeGreaterThan(beforeRevision);expect(updated.plan.routes).toEqual(accepted.plan.routes);
      await expect(page.locator(`.planet-country[data-country-id="${user.countryId}"] .planet-ground-road-raster`))
        .toHaveAttribute('data-ground-road-revision',String(updated.revision),{timeout:30_000});
      await expect(planet).toHaveAttribute('data-planet-ready','true');await expect(planet).toHaveAttribute('data-ground-road-routes','1');
      expect(errors).toEqual([]);expect(failures).toEqual([]);expect(writes).toEqual([]);
      realtimeEvidence={calls,beforeRevision,afterRevision:updated.revision,routeIds:updated.plan.routes.map(route=>route.id)};
    }
    const evidence=JSON.stringify({routes:accepted.plan.routes,exit,cityPixels,pixelProbe,roadBuilds,expectedFailures,realtimeEvidence,reads,errors,warnings,failures,writes});
    await writeFile(info.outputPath('road-continuity.json'),evidence);
    await info.attach('road-continuity',{body:evidence,contentType:'application/json'});
  } finally {
    await info.attach('browser-errors',{body:JSON.stringify({errors,warnings,failures,expectedFailures}),contentType:'application/json'});
    await mcp?.close();
    if(owner){await db.prepare('DELETE FROM countries WHERE id=?').run(owner.countryId);await db.prepare('DELETE FROM users WHERE id=?').run(owner.id);}
    await db.close();
  }
});
