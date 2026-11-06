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
  test.setTimeout(process.env.CI?240_000:120_000);await installSceneClock(page);
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
  // Preserve the12s idle admission bound. A real higher-priority owner can
  // defer this scene until its bounded30s response and the next retry finish.
  let deferredByOwner=false;
  for(let step=0;step<90&&!await world.getAttribute('data-city-life-episode-id');step++){
    const owners=JSON.parse((await world.getAttribute('data-city-event-owners'))!) as {priority:number}[];
    deferredByOwner ||= owners.some(owner=>owner.priority>1);
    if(step===24)expect(deferredByOwner,'Delayed admission needs an observed shared owner').toBe(true);
    await page.clock.runFor(500);
  }
  await expect(world).toHaveAttribute('data-city-life-phase', /^(ARRIVING|ACTIVITY)$/);
  const plan = JSON.parse((await world.getAttribute('data-city-life-plan'))!) as CityLifePlan;
  const recipe=cityEventRecipe(plan.recipeId!);
  expect(recipe?.channel).toBe('NEIGHBOURHOOD');
  if(!recipe||recipe.channel!=='NEIGHBOURHOOD')throw new Error('A completed native site needs a registered neighbourhood recipe');
  const canonical = g.tasks.find(task => task.id === plan.taskId)!;expect(canonical.status).toBe('COMPLETED');expect(canonical.stage).toBe(5);
  type Participant = { id: string; position: Cell; visit?: { id: string; arrived: boolean } };
  const people = async () => JSON.parse((await world.getAttribute('data-city-life-actors'))!) as Participant[];
  const initial = await people();expect(initial.length).toBeGreaterThan(0);
  for (const actor of initial) expect((await world.getAttribute('data-agent-ids'))!.split(',')).toContain(actor.id);
  // Deliver every frame; fastForward would skip physical travel and must never
  // be used to manufacture the evidence of arrival or departure.
  const approach:unknown[]=[];
  for (let step = 0; step < 64 && await world.getAttribute('data-city-life-phase') === 'ARRIVING'; step++) {
    approach.push(await world.evaluate(node=>{const d=(node as HTMLElement).dataset;return{now:d.roadEventServerNow,steps:d.mobilityFixedSteps,
      phase:d.cityLifePhase,actors:d.cityLifeActors,active:d.animationActive,preparing:d.movementPreparing,cancelled:d.cityLifeCancelled};}));
    await page.clock.runFor(500);
  }
  const approachPath=info.outputPath('physical-approach.json');await writeFile(approachPath,JSON.stringify(approach,null,2));
  await info.attach('physical-approach',{path:approachPath,contentType:'application/json'});
  await expect(world).toHaveAttribute('data-city-life-episode-id', plan.id);
  await expect(world).toHaveAttribute('data-city-life-phase', 'ACTIVITY');
  const arrived = await people();expect(arrived.map(actor => actor.id)).toEqual(initial.map(actor => actor.id));
  expect(arrived.every(actor => actor.visit?.id === plan.id && actor.visit.arrived)).toBe(true);
  await page.screenshot({ path: info.outputPath('physical-neighbourhood-activity.png') });
  const actions:string[]=[];
  for (let step = 0; step < 28 && await world.getAttribute('data-city-life-phase') === 'ACTIVITY'; step++) {
    const cue=await world.evaluate(node=>{const d=(node as HTMLElement).dataset;return {recipe:d.cityLifeRecipe,action:d.cityLifeAction,step:Number(d.cityLifeActionStep)};});
    expect(cue.recipe).toBe(recipe.id);
    if(actions.length===cue.step)actions.push(cue.action!);
    await page.clock.runFor(500);
  }
  expect(actions).toEqual(recipe.steps);
  await expect(world).toHaveAttribute('data-city-life-episode-id', plan.id);await expect(world).toHaveAttribute('data-city-life-phase', 'LEAVING');
  await expect(world).toHaveAttribute('data-city-life-action','');
  const leaving = await people();
  for (let step = 0; step < 24 && await world.getAttribute('data-city-life-episode-id') === plan.id; step++) await page.clock.runFor(500);
  await expect(world).not.toHaveAttribute('data-city-life-episode-id', plan.id);
  expect(Number(await world.getAttribute('data-city-life-completed'))).toBeGreaterThan(0);
  // The phase changes immediately; the director publishes its bounded debug
  // snapshot every250ms when a replacement keeps the lease count unchanged.
  // Advance one publication interval, well before the old75s lease expires.
  await page.clock.runFor(250);
  const owners = JSON.parse((await world.getAttribute('data-city-event-owners'))!) as { id: string }[];expect(owners.some(owner => owner.id === plan.id)).toBe(false);
  for (const metric of ['data-mobility-vehicle-unsafe-total', 'data-mobility-pedestrian-unsafe-total', 'data-mobility-vehicle-pedestrian-unsafe-total']) await expect(world).toHaveAttribute(metric, '0');
  expect(writes).toEqual([]);expect(errors).toEqual([]);
  expect(reads.filter(path => path.endsWith('/scene'))).toHaveLength(1);expect(reads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
  await info.attach('physical-neighbourhood', { body: JSON.stringify({ plan, actions, initial, arrived, leaving, owners, writes, reads, errors }), contentType: 'application/json' });
});
