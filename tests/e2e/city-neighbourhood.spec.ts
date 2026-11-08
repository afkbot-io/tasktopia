import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { CitySceneDto } from '../../src/shared/city-scene-contract';
import type { Cell } from '../../src/shared/contracts';
import { cityLifeSites, type CityLifePlan } from '../../src/client/city-life';
import { clockSceneTest, installSceneClock } from './city-scene-clock';
import { pauseInstalledClock } from './city-clock-control';
import { sceneWalkGeometry } from './city-scene-walk-fixture';
import { cityEventRecipe } from '../../src/client/city-event-recipes';
import {everydayFixture} from './everyday-city-fixture';
import { neighbourhoodAdmissionDeadline, NEIGHBOURHOOD_ADMISSION_WORLD_MS } from '../neighbourhood-admission';

test.use({ trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true } });
test.afterEach(async({page},info)=>{
  if(page.isClosed())return;
  if(!await page.locator('.world-canvas').count())return;
  const state=await page.locator('.world-canvas').evaluate(node=>({...((node as HTMLElement).dataset)})).catch(()=>undefined);
  if(state){const path=info.outputPath('physical-final-state.json');await writeFile(path,JSON.stringify(state,null,2));
    await info.attach('physical-final-state',{path,contentType:'application/json'});}
});
test('a real MCP status update reaches rendered task metadata without breaking the retained city',async({page},info)=>{
  test.setTimeout(120000);
  const f=await everydayFixture(page),errors:string[]=[],reads:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='GET'&&/\/scene$|\/world\/viewport|\/chunks\//.test(path))reads.push(path);});
  try{
    const task=f.pendingHome;await f.focus(task);
    const canvas=await f.host.locator('canvas').elementHandle();expect(canvas).not.toBeNull();
    const key=crypto.randomUUID();await f.call('task.set_status',{taskId:task.id,status:'COMPLETED'},key);
    await expect.poll(async()=>JSON.parse(await f.host.getAttribute('data-realtime-rendered-tasks')??'[]') as {taskId:string;stage:number}[])
      .toContainEqual({taskId:task.id,stage:5});
    await expect(f.host).toHaveAttribute('data-city-cinematics','0',{timeout:20000});
    expect((await f.service.getTask(f.user.countryId,task.id)).status).toBe('COMPLETED');
    await expect(f.host).toHaveAttribute('data-mobility-ready','true',{timeout:30000});
    await expect(f.host).toHaveAttribute('data-movement-preparing','false',{timeout:30000});
    expect(await canvas!.evaluate(node=>node.isConnected)).toBe(true);
    await f.call('task.set_status',{taskId:task.id,status:'COMPLETED'},key);
    await expect(f.host).toHaveAttribute('data-city-cinematics','0');
    for(const metric of ['data-mobility-vehicle-unsafe-total','data-mobility-pedestrian-unsafe-total','data-mobility-vehicle-pedestrian-unsafe-total'])
      await expect(f.host).toHaveAttribute(metric,'0');
    expect(reads.filter(path=>/\/world\/viewport|\/chunks\//.test(path))).toEqual([]);expect(errors).toEqual([]);
    await info.attach('real-mcp-metadata-update',{body:JSON.stringify({taskId:task.id,stage:5,canvasRetained:true,reads,errors}),contentType:'application/json'});
  }finally{await f.cleanup();}
});
clockSceneTest('a completed neighbourhood uses real residents through arrival, activity and physical departure without task writes', async ({ page, hasTouch }, info) => {
  // Software WebKit must deliver all physical frames, including approach and
  // departure. This runner allowance does not alter simulation deadlines or
  // the separate native latency/input budgets; fastForward stays forbidden.
  // Up to three complete natural admissions can include safe cancellation
  // during arrival or departure. Keep24s/12s world deadlines and every frame;
  // the wall guard covers those three journeys plus shared-owner deferrals.
  test.setTimeout(process.env.CI?720_000:240_000);await installSceneClock(page);
  await page.addInitScript(() => localStorage.setItem('tasktopia:world-preferences:v2', JSON.stringify({ quality: 'NORMAL', cityLife: false, sound: false })));
  expect((await page.request.post('/api/auth/login', { data: { email: 'demo@tasktopia.local', password: 'tasktopia-demo' } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  const scene = await (await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity.id}/scene`)).json() as CitySceneDto;
  const g = sceneWalkGeometry(scene), sites = cityLifeSites(g.tasks, g.walkGraph, new Set([...g.blockedCells, ...g.roads.keys()]));
  // This positive journey observes a completed home's real arrival/work/exit.
  // A large edge park may have no available nearby adult while a bus boards;
  // unavailable/long approaches have separate public controller regressions.
  const task = g.tasks.find(task => !task.serviceRole && task.visualKind!=='PARK' && sites.some(site => site.taskId === task.id))!;expect(task).toBeTruthy();
  const epoch = Math.floor(Date.UTC(2035, 0, 1) / 180_000) * 180_000 + 42_000;
  await page.route('**/api/**', async route => {
    const response = await route.fetch({ headers: { ...route.request().headers(), 'accept-encoding': 'identity' } });
    await route.fulfill({ response, headers: { ...response.headers(), 'cache-control': 'no-store', 'x-tasktopia-server-time': String(epoch) } });
  });
  const writes: string[] = [], errors: string[] = [], reads: string[] = [];
  page.on('request', request => { const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && path.startsWith('/api/')) writes.push(path);
    if (/\/scene$|\/world\/viewport|\/chunks\//.test(path)) reads.push(path);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/task/${task.taskNumber}?countryId=${bootstrap.country.id}&taskId=${task.id}`);
  await expect(page.locator('#task-title')).toBeVisible();await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const world = page.locator('.world-canvas');await expect(world).toHaveAttribute('data-loading', 'false', { timeout: 45_000 });
  await expect(world).toHaveAttribute('data-mobility-ready', 'true', { timeout: 15_000 });await expect(world).toHaveAttribute('data-movement-preparing', 'false');
  await pauseInstalledClock(page);
  let preferences = page.locator('.map-toolbar-actions > nav > .world-preferences');
  if (!await preferences.isVisible()) {
    const menu = page.locator('.world-menu');
    if (await menu.getAttribute('open') === null) { if (hasTouch) await menu.locator(':scope > summary').tap();else await menu.locator(':scope > summary').click(); }
    preferences = menu.locator('.mobile-menu-tools .world-preferences');
  }
  await preferences.locator(':scope > summary').click();await preferences.getByLabel('Жизнь города').setChecked(true);await page.keyboard.press('Escape');
  const menu=page.locator('.world-menu');
  if(await menu.isVisible()&&await menu.getAttribute('open')!==null){
    if(hasTouch)await menu.locator(':scope > summary').tap();else await menu.locator(':scope > summary').click();
  }
  type Participant = { id: string; position: Cell; visit?: { id: string; arrived: boolean } };
  const people = async () => JSON.parse((await world.getAttribute('data-city-life-actors'))!) as Participant[];
  let plan!:CityLifePlan,initial:Participant[]=[],arrived:Participant[]=[],leaving:Participant[]=[];
  let completed=false;const actions:string[]=[];
  const approach:unknown[]=[],attempts:unknown[]=[],episodeIds=new Set<string>();
  const admissions:unknown[]=[];
  // A real crossing may cancel arrival at24s or physical departure at12s.
  // Observe up to three whole natural admissions in the same city; a finished
  // lease alone is never a positive journey and cancelled IDs cannot replay.
  for(let attempt=0;attempt<3;attempt++){
    // Preserve12s of owner-free world time. EVERYDAY can legitimately own
    // this approach for44s; a frozen15s locator poll cannot expire that lease.
    const admissionState=()=>world.evaluate(node=>{const d=(node as HTMLElement).dataset;
      return{now:Number(d.roadEventServerNow),id:d.cityLifeEpisodeId,phase:d.cityLifePhase,
        owners:JSON.parse(d.cityEventOwners??'[]') as {id:string;priority:number;until:number}[]};});
    const startedAt=(await admissionState()).now;let blockingUntil=startedAt;
    const admission={attempt,startedAt,deadline:neighbourhoodAdmissionDeadline(startedAt),samples:[] as Awaited<ReturnType<typeof admissionState>>[]};
    admissions.push(admission);
    // The public world clock can slew-10%; keep every physical frame and a
    // bounded sample count even if its telemetry stops advancing.
    const maxSteps=Math.ceil(NEIGHBOURHOOD_ADMISSION_WORLD_MS/(500*.9))+2;
    for(let step=0;step<maxSteps;step++){
      const state=await admissionState();admission.samples.push(state);
      expect(Number.isFinite(state.now),'Admission requires a published world clock').toBe(true);
      if(state.id)break;
      for(const owner of state.owners)if(owner.priority>1&&Number.isFinite(owner.until)&&owner.until>state.now)
        blockingUntil=Math.max(blockingUntil,owner.until);
      admission.deadline=neighbourhoodAdmissionDeadline(startedAt,blockingUntil);
      if(state.now>=admission.deadline)break;
      await page.clock.runFor(500);
    }
    await writeFile(info.outputPath('physical-admissions.json'),JSON.stringify(admissions,null,2));
    await expect(world).toHaveAttribute('data-city-life-phase', /^(ARRIVING|ACTIVITY)$/);
    plan=JSON.parse((await world.getAttribute('data-city-life-plan'))!) as CityLifePlan;
    expect(episodeIds.has(plan.id),'A cancelled episode must not replay').toBe(false);episodeIds.add(plan.id);
    const canonical=g.tasks.find(task=>task.id===plan.taskId)!;expect(canonical.status).toBe('COMPLETED');expect(canonical.stage).toBe(5);
    initial=await people();expect(initial.length).toBeGreaterThan(0);
    for(const actor of initial)expect((await world.getAttribute('data-agent-ids'))!.split(',')).toContain(actor.id);
    const before=await world.evaluate(node=>{const d=(node as HTMLElement).dataset;return{cancelled:Number(d.cityLifeCancelled),completed:Number(d.cityLifeCompleted),steps:Number(d.mobilityFixedSteps)};});
    // Deliver every frame; fastForward cannot manufacture physical travel.
    for(let step=0;step<64&&await world.getAttribute('data-city-life-episode-id')===plan.id&&await world.getAttribute('data-city-life-phase')==='ARRIVING';step++){
      approach.push(await world.evaluate(node=>{const d=(node as HTMLElement).dataset;return{now:d.roadEventServerNow,steps:d.mobilityFixedSteps,
        phase:d.cityLifePhase,actors:d.cityLifeActors,active:d.animationActive,preparing:d.movementPreparing,cancelled:d.cityLifeCancelled};}));
      await page.clock.runFor(500);
    }
    const current=await world.evaluate(node=>({...((node as HTMLElement).dataset)}));
    const record:Record<string,unknown>={plan,initial,before,current};attempts.push(record);
    if(current.cityLifeEpisodeId===plan.id){
      const recipe=cityEventRecipe(plan.recipeId!);
      expect(recipe?.channel).toBe('NEIGHBOURHOOD');
      if(!recipe||recipe.channel!=='NEIGHBOURHOOD')throw new Error('A completed native site needs a registered neighbourhood recipe');
      await expect(world).toHaveAttribute('data-city-life-phase','ACTIVITY');
      arrived=await people();expect(arrived.map(actor=>actor.id)).toEqual(initial.map(actor=>actor.id));
      expect(arrived.every(actor=>actor.visit?.id===plan.id&&actor.visit.arrived)).toBe(true);
      await page.screenshot({path:info.outputPath('physical-neighbourhood-activity.png')});
      actions.length=0;
      for(let step=0;step<28&&await world.getAttribute('data-city-life-episode-id')===plan.id&&await world.getAttribute('data-city-life-phase')==='ACTIVITY';step++){
        const cue=await world.evaluate(node=>{const d=(node as HTMLElement).dataset;return{recipe:d.cityLifeRecipe,action:d.cityLifeAction,step:Number(d.cityLifeActionStep)};});
        expect(cue.recipe).toBe(recipe.id);if(actions.length===cue.step)actions.push(cue.action!);
        await page.clock.runFor(500);
      }
      if(await world.getAttribute('data-city-life-episode-id')===plan.id){
        expect(actions).toEqual(recipe.steps);
        await expect(world).toHaveAttribute('data-city-life-episode-id',plan.id);
        await expect(world).toHaveAttribute('data-city-life-phase','LEAVING');
        await expect(world).toHaveAttribute('data-city-life-action','');
        leaving=await people();
        const leavingAt=Number(await world.getAttribute('data-road-event-server-now')),departure:unknown[]=[];
        //12s belongs to the public world clock. Its-10% slew needs at most28
        // half-second browser steps; no appointment lifetime is extended.
        for(let step=0;step<28&&await world.getAttribute('data-city-life-episode-id')===plan.id
          &&Number(await world.getAttribute('data-road-event-server-now'))<leavingAt+12_000;step++){
          departure.push(await world.evaluate(node=>{const d=(node as HTMLElement).dataset;return{now:d.roadEventServerNow,
            phase:d.cityLifePhase,actors:d.cityLifeActors,steps:d.mobilityFixedSteps,completed:d.cityLifeCompleted,cancelled:d.cityLifeCancelled};}));
          await page.clock.runFor(500);
        }
        await expect(world).not.toHaveAttribute('data-city-life-episode-id',plan.id);
        // Counters and owner lists publish every250ms even if a replacement
        // keeps the lease count unchanged. Do not sample stale terminal metadata.
        await page.clock.runFor(250);
        const terminal=await world.evaluate(node=>({...((node as HTMLElement).dataset)}));
        expect(Number(terminal.roadEventServerNow)-leavingAt).toBeLessThanOrEqual(13_000);
        completed=Number(terminal.cityLifeCompleted)>before.completed;
        Object.assign(record,{arrived,leaving,actions:[...actions],leavingAt,departure,terminal,
          outcome:completed?'PHYSICAL_DEPARTURE_COMPLETED':'CANCELLED_DURING_DEPARTURE'});
      }else{
        Object.assign(record,{arrived,actions:[...actions],outcome:'CANCELLED_DURING_ACTIVITY'});
        await page.clock.runFor(250);
      }
    }else{
      Object.assign(record,{terminal:current,outcome:'CANCELLED_DURING_ARRIVAL'});
      await page.clock.runFor(250);
    }
    const terminal=await world.evaluate(node=>({...((node as HTMLElement).dataset)}));
    record.terminal=terminal;
    const owners=JSON.parse(terminal.cityEventOwners??'[]') as {id:string}[];
    expect(owners.some(owner=>owner.id===plan.id)).toBe(false);
    expect(Number(terminal.mobilityFixedSteps)).toBeGreaterThan(before.steps);
    for(const metric of ['mobilityVehicleUnsafeTotal','mobilityPedestrianUnsafeTotal','mobilityVehiclePedestrianUnsafeTotal','wrongWayCars','walkerOffPath'])expect(terminal[metric]).toBe('0');
    await writeFile(info.outputPath('physical-attempts.json'),JSON.stringify(attempts,null,2));
    if(completed){expect(Number(terminal.cityLifeCompleted)).toBe(before.completed+1);break;}
    expect(Number(terminal.cityLifeCancelled)).toBeGreaterThan(before.cancelled);
    expect(Number(terminal.cityLifeCompleted)).toBe(before.completed);
    expect(terminal.animationActive).toBe('true');expect(terminal.movementPreparing).toBe('false');
  }
  const approachPath=info.outputPath('physical-approach.json');await writeFile(approachPath,JSON.stringify(approach,null,2));
  await info.attach('physical-approach',{path:approachPath,contentType:'application/json'});
  expect(completed,'No real physical departure completed in three natural admissions').toBe(true);
  const owners = JSON.parse((await world.getAttribute('data-city-event-owners'))!) as { id: string }[];expect(owners.some(owner => owner.id === plan.id)).toBe(false);
  for (const metric of ['data-mobility-vehicle-unsafe-total', 'data-mobility-pedestrian-unsafe-total', 'data-mobility-vehicle-pedestrian-unsafe-total']) await expect(world).toHaveAttribute(metric, '0');
  expect(writes).toEqual([]);expect(errors).toEqual([]);
  expect(reads.filter(path => path.endsWith('/scene'))).toHaveLength(1);expect(reads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
  await info.attach('physical-neighbourhood', { body: JSON.stringify({ plan, actions, initial, arrived, leaving, owners, attempts, writes, reads, errors }), contentType: 'application/json' });
});
