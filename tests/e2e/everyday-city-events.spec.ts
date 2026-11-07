import { captureOwnedCityFailure } from './owned-city-failure';
import { observeCinematics } from './city-cinematic-observer';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { everydayFixture } from './everyday-city-fixture';
import { BUILDING_CATALOG } from '../../src/shared/catalog';
import { rainPose } from '../../src/client/city-everyday-life';
import { openMapCity } from './map-navigation';
import { installSceneClock, clockSceneTest } from './city-scene-clock';
import { sceneClockStepTowardStart } from '../scene-clock-step';
import { isSchoolBusAttemptTerminal } from '../school-bus-attempt';
import { isEverydayAttemptExpiredWithoutArrival } from '../everyday-attempt';

// Long fixed-step journeys already save native checkpoints and telemetry.
// Repeated automatic DOM/canvas snapshots produced a 306 MiB failure artifact
// in addition to software rendering cost; retain calls, sources and failures.
test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false, sources: true } });

test('real city exposes six education families, safe event pads and connected transit stops', async ({ page }, info) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [], forbidden: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/\/api\/(world\/viewport|chunks\/)/.test(r.url())) forbidden.push(r.url()); });
  const f = await everydayFixture(page);
  try {
    await f.open();
    // Mobility publishes readiness before the first everyday frame. Wait for
    // that separate compiled director before asserting its full inventory.
    await expect(f.host).toHaveAttribute('data-everyday-kinds', /.+/, { timeout: 15000 });
    const data = await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
    await writeFile(info.outputPath('initial-state.json'), JSON.stringify(data, null, 2));
    await page.screenshot({ path: info.outputPath('everyday-native-city.png') });
    expect(data.everydayKinds?.split(',')).toEqual(expect.arrayContaining(['SCHOOL', 'KINDERGARTEN', 'MARKET', 'SPORT', 'DOG', 'BIRDS']));
    expect(Number(data.transitStops)).toBeGreaterThanOrEqual(2);
    expect(f.tasks.filter(t => BUILDING_CATALOG.find(b => b.key === t.visualAssetKey)?.educationKind && t.stage === 5)).toHaveLength(6);
    expect(forbidden).toEqual([]); expect(errors).toEqual([]);
  } finally { await f.cleanup(); }
});

for (const kind of ['OPEN_SCHOOL', 'OPEN_KINDERGARTEN', 'OPEN_SHOP', 'OPEN_FIRE', 'OPEN_BUILDING'] as const) {
  test(`fresh MCP completion reveals ${kind} once after construction and never replays on reload`, async ({ page }, info) => {
    test.setTimeout(90000); const f = await everydayFixture(page), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await f.focus(f.pendingSchool);
      await expect(f.host).toHaveAttribute('data-ambient-assets', 'ready');
      const targets = {
        OPEN_SCHOOL: f.pendingSchool, OPEN_KINDERGARTEN: f.pendingKindergarten, OPEN_BUILDING: f.pendingHome,
        OPEN_SHOP: f.tasks.find(t => t.stage === 4 && BUILDING_CATALOG.find(b => b.key === t.visualAssetKey)?.serviceRole === 'SHOP')!,
        OPEN_FIRE: f.tasks.find(t => t.stage === 4 && BUILDING_CATALOG.find(b => b.key === t.visualAssetKey)?.serviceRole === 'FIRE')!,
      };
      const task = targets[kind]; expect(task.stage).toBe(4);
      await f.service.activateDistrict(f.user.countryId, task.districtId, crypto.randomUUID());
      await f.panFocus(task);
      const cinematicFrames = await observeCinematics(f.host);
      const key = crypto.randomUUID(); await f.call('task.set_status', { taskId: task.id, status: 'COMPLETED' }, key);
      await expect.poll(async () => (await cinematicFrames.frames()).some(frame => frame.states.some(state =>
        state.taskId === task.id && state.kind === 'CONSTRUCT' && state.phase === 'WORK'))).toBe(true);
      await expect(f.host).toHaveAttribute('data-everyday-event', kind, { timeout: 15000 });
      await expect(f.host).toHaveAttribute('data-city-cinematics', '0');
      expect((await f.service.getTask(f.user.countryId, task.id)).stage).toBe(5);
      const episode = await f.host.getAttribute('data-everyday-episode-id');
      await f.call('task.set_status', { taskId: task.id, status: 'COMPLETED' }, key);
      await expect(f.host).toHaveAttribute('data-everyday-episode-id', episode!);
      await page.screenshot({ path: info.outputPath(`${kind.toLowerCase()}.png`) });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(f.host).toHaveAttribute('data-everyday-event', '');
      await expect(f.host).toHaveAttribute('data-everyday-visitors', '0');
      await expect(f.host).toHaveAttribute('data-transit-role', '');
      await expect(f.host).toHaveAttribute('data-transit-phase', '');
      await expect(f.host).toHaveAttribute('data-transit-vehicle', '');
      await expect(f.host).toHaveAttribute('data-animation-active', 'false');
      // Safe passenger evacuation uses physics steps. Reduced motion pauses
      // those steps; the real-mobility regression covers recovery after resume.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.reload(); await openMapCity(page); await expect(f.host).toHaveAttribute('data-city-scene-commit', 'atomic', { timeout: 30000 });
      expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
      expect(errors).toEqual([]);
    } finally { await f.cleanup(); }
  });
}

for(const offscreen of [false,true]){
clockSceneTest(offscreen?'delayed MCP transfer carries to a real offscreen destination without replaying an opening':'delayed MCP transfer resumes a helicopter carry without replaying an opening on reload', async ({ page }, info) => {
  test.setTimeout(90000); await installSceneClock(page);
  const f = await everydayFixture(page), errors: string[] = [], forbidden:string[]=[]; page.on('pageerror', e => errors.push(e.message));
  page.on('request',r=>{if(/\/api\/(world\/viewport|chunks\/)/.test(r.url()))forbidden.push(new URL(r.url()).pathname);});
  try {
    // Construction has its own five fresh MCP opening regressions above.
    // This transfer starts from a genuinely completed home before loading the
    // browser; unrelated construction/rendering does not consume its90s cap.
    const home = await f.service.updateTaskStatus(f.user.countryId,{taskId:f.pendingHome.id,status:'COMPLETED',idempotencyKey:crypto.randomUUID()});
    expect(home.stage).toBe(5);
    await f.focus(home);await f.panFocus(home);
    await expect(f.host).toHaveAttribute('data-ambient-assets', 'ready');
    await expect(f.host).toHaveAttribute('data-city-cinematics', '0');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(f.host).toHaveAttribute('data-everyday-event', '');
    await expect(f.host).toHaveAttribute('data-everyday-visitors', '0');
    await expect(f.host).toHaveAttribute('data-transit-role', '');
    await expect(f.host).toHaveAttribute('data-transit-phase', '');
    await expect(f.host).toHaveAttribute('data-transit-vehicle', '');
    await expect(f.host).toHaveAttribute('data-animation-active', 'false');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Подготовка выше идёт с работающим clock; только перенос использует
    // фиксированные RAF. Реальный ответ и renderer не подменяются.
    await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
    // Держим реальную сцену за пределами исходного окна CARRY.
    // Между шагами часы неподвижны: decode/worker не расходуют бюджет анимации.
    const scenePattern = /\/api\/countries\/[^/]+\/cities\/[^/]+\/scene(?:\?|$)/;
    let releaseScene!: () => void, delayedScene = false;
    const sceneGate = new Promise<void>(resolve => { releaseScene = resolve; });
    await page.route(scenePattern, async route => {
      const response = await route.fetch(); delayedScene = true; await sceneGate; await route.fulfill({ response });
    });
    const cinematicFrames = await observeCinematics(f.host);
    const carryVisible = async () => (await cinematicFrames.frames()).some(frame => frame.states.some(state =>
      state.taskId === home.id && state.kind === 'TRANSFER' && state.phase === 'CARRY'
      && state.oldVisible && !state.targetVisible && state.aircraftVisible));
    let beginSteps = 0, readinessSteps = 0;
    try {
      const destination=offscreen?f.tasks.filter(task=>task.id!==home.id).sort((a,b)=>
        Math.hypot(b.origin.x-home.origin.x,b.origin.y-home.origin.y)-Math.hypot(a.origin.x-home.origin.x,a.origin.y-home.origin.y))[0]!:f.pendingSchool;
      await f.call('task.transfer', { taskId: home.id, targetDistrictId: destination.districtId });
      const moved=await f.service.getTask(f.user.countryId,home.id);
      const target=await f.host.evaluate((el,bounds)=>{
        const d=(el as HTMLElement).dataset,c=el.querySelector('canvas')!,size=8*Number(d.renderScale),x=Number(d.cameraWorldX),y=Number(d.cameraWorldY);
        return {bounds,camera:{x,y,scale:Number(d.renderScale),width:c.clientWidth,height:c.clientHeight},
          visible:bounds.minX<x+c.clientWidth/size/2&&bounds.maxX>x-c.clientWidth/size/2
            &&bounds.minY<y+c.clientHeight/size/2&&bounds.maxY>y-c.clientHeight/size/2};
      },{minX:Math.min(...moved.footprint.map(p=>p.x)),maxX:Math.max(...moved.footprint.map(p=>p.x)),minY:Math.min(...moved.footprint.map(p=>p.y)),maxY:Math.max(...moved.footprint.map(p=>p.y))});
      await info.attach('transfer-destination',{body:JSON.stringify({offscreen,target}),contentType:'application/json'});
      if(offscreen)expect(target.visible,'The regression needs a real destination outside the current viewport').toBe(false);
      await expect.poll(async () => {
        if ((await cinematicFrames.frames()).some(frame => frame.states.some(state => state.taskId === home.id && state.kind === 'TRANSFER'))) return true;
        if (beginSteps >= 32) return false;
        await page.clock.runFor(16); beginSteps++;
        return (await cinematicFrames.frames()).some(frame => frame.states.some(state => state.taskId === home.id && state.kind === 'TRANSFER'));
      }, { timeout: 15000, intervals: [100], message: 'Реальный MCP/WebSocket должен начать перенос за 32 native clock шага' }).toBe(true);
      await page.clock.runFor(4500);
      await expect(f.host).toHaveAttribute('data-cinematic-phases', /TRANSFER:LIFT/);
      await expect.poll(() => delayedScene, { timeout: 15000 }).toBe(true); releaseScene();
      await expect.poll(async () => {
        if (await carryVisible()) return true;
        if (readinessSteps >= 100) return false;
        await page.clock.runFor(16); readinessSteps++;
        return carryVisible();
      }, { timeout: 15000, intervals: [100], message: 'Реальный delayed target должен возобновить видимый CARRY за 100 native clock шагов' }).toBe(true);
      // Даже при всех 32+100 шагах ready наступает не позднее 6612ms,
      // оставляя >=680ms CARRY до прежнего hard deadline 7700ms.
      // Настоящие RAF после ready обязаны сохранить видимый полёт.
      await page.clock.runFor(100);
      expect(JSON.parse((await f.host.getAttribute('data-cinematic-state')) ?? '[]')).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: home.id, kind: 'TRANSFER', phase: 'CARRY', oldVisible: true, targetVisible: false, aircraftVisible: true }),
      ]));
      if(offscreen)await page.screenshot({path:info.outputPath('offscreen-carry.png')});
      await page.clock.runFor(3200);
    } finally { await writeFile(info.outputPath('delayed-transfer-frames.json'),JSON.stringify(await cinematicFrames.frames(),null,2));releaseScene(); await page.unroute(scenePattern); }
    await expect(f.host).toHaveAttribute('data-city-cinematics', '0', { timeout: 10000 });
    expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
    await page.clock.resume();
    await page.reload(); await openMapCity(page); await expect(f.host).toHaveAttribute('data-city-scene-commit', 'atomic', { timeout: 30000 });
    expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
    expect(errors).toEqual([]);expect(forbidden).toEqual([]);
  } finally { await f.cleanup(); }
});
}

clockSceneTest('paused native pan shows two distant institutions without task navigation and spends exactly 400ms each', async ({ page }, info) => {
  test.setTimeout(90000); await page.setViewportSize({ width: 720, height: 640 }); await installSceneClock(page);
  const f = await everydayFixture(page);
  try {
    await f.focus(f.pendingSchool);
    await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('cityId') === f.city.id);
    await expect(page.locator('.task-modal')).toHaveCount(0);
    await expect(f.host).toHaveAttribute('data-camera-presentation-pending', 'false');
    const institutions = f.tasks.filter(task => BUILDING_CATALOG.find(asset => asset.key === task.visualAssetKey)?.educationKind);
    const center = (task: typeof institutions[number]) => ({ x: task.footprint.reduce((sum, cell) => sum + cell.x + .5, 0) / task.footprint.length,
      y: task.footprint.reduce((sum, cell) => sum + cell.y + .5, 0) / task.footprint.length });
    const pair = institutions.flatMap(first => institutions.filter(second => first.id !== second.id).map(second => ({ first, second,
      distance: Math.hypot(center(first).x - center(second).x, center(first).y - center(second).y) }))).sort((a, b) => b.distance - a.distance)[0]!;
    expect(pair.distance).toBeGreaterThan(20);
    await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
    const evidence = [];
    for (const task of [pair.first, pair.second]) {
      const before = await page.evaluate(() => ({ now: Date.now(), url: location.href, historyLength: history.length }));
      await f.panFocus(task, true);
      const after = await page.evaluate(() => ({ now: Date.now(), url: location.href, historyLength: history.length, task: history.state?.task }));
      expect(after.now - before.now).toBe(400);
      expect(after.url).toBe(before.url); expect(after.historyLength).toBe(before.historyLength); expect(after.task).toBeUndefined();
      await expect(page.locator('.task-modal')).toHaveCount(0);
      await expect(f.host).toHaveAttribute('data-camera-presentation-pending', 'false');
      const visible = await f.host.evaluate((el, footprint) => {
        const host = el as HTMLElement, canvas = host.querySelector('canvas')!, scale = Number(host.dataset.renderScale) * 8;
        const x = Number(host.dataset.cameraWorldX), y = Number(host.dataset.cameraWorldY);
        return footprint.every(cell => (cell.x - x) * scale + canvas.clientWidth / 2 >= 0
          && (cell.x + 1 - x) * scale + canvas.clientWidth / 2 <= canvas.clientWidth
          && (cell.y - y) * scale + canvas.clientHeight / 2 >= 0
          && (cell.y + 1 - y) * scale + canvas.clientHeight / 2 <= canvas.clientHeight);
      }, task.footprint);
      expect(visible, `Institution #${task.taskNumber} must actually be in the viewport`).toBe(true);
      evidence.push({ taskId: task.id, before, after, visible });
    }
    await writeFile(info.outputPath('paused-native-pan.json'), JSON.stringify({ distance: pair.distance, evidence }, null, 2));
  } finally { await f.cleanup(); }
});

clockSceneTest('paused scene preparation advances a released renderer frame before the planned event', async ({ page }, info) => {
  test.setTimeout(90000); await page.setViewportSize({ width: 720, height: 640 }); await installSceneClock(page);
  const f = await everydayFixture(page);
  type PanFrameGate = { read: () => { now: number; installedAt: number; releasedAt: number | null; pendingAtRelease: boolean;
    held: number; delivered: number; registered: number }; restore: () => void };
  try {
    const institutions = f.tasks.filter(task => BUILDING_CATALOG.find(asset => asset.key === task.visualAssetKey)?.educationKind);
    const center = (task: typeof institutions[number]) => ({ x: task.footprint.reduce((sum, cell) => sum + cell.x + .5, 0) / task.footprint.length,
      y: task.footprint.reduce((sum, cell) => sum + cell.y + .5, 0) / task.footprint.length });
    const pair = institutions.flatMap(first => institutions.filter(second => first.id !== second.id).map(second => ({ first, second,
      distance: Math.hypot(center(first).x - center(second).x, center(first).y - center(second).y) }))).sort((a, b) => b.distance - a.distance)[0]!;
    expect(pair.distance).toBeGreaterThan(20); await f.focus(pair.first);
    await expect(f.host).toHaveAttribute('data-camera-presentation-pending', 'false');
    const before = await f.host.evaluate((el, footprint) => {
      const host = el as HTMLElement, canvas = host.querySelector('canvas')!, scale = Number(host.dataset.renderScale) * 8;
      const x = Number(host.dataset.cameraWorldX), y = Number(host.dataset.cameraWorldY);
      return { url: location.href, historyLength: history.length, canonicalTasks: host.dataset.canonicalTaskCount,
        visible: footprint.every(cell => (cell.x - x) * scale + canvas.clientWidth / 2 >= 24
          && (cell.x + 1 - x) * scale + canvas.clientWidth / 2 <= canvas.clientWidth - 24
          && (cell.y - y) * scale + canvas.clientHeight / 2 >= 24
          && (cell.y + 1 - y) * scale + canvas.clientHeight / 2 <= canvas.clientHeight - 24) };
    }, pair.second.footprint);
    expect(before.visible, 'The regression must require an actual camera pan').toBe(false);
    await expect.poll(() => f.host.evaluate(el => {
      const d = (el as HTMLElement).dataset, now = Number(d.roadEventServerNow), start = Number(d.everydayNextStart);
      return d.ambientAssets === 'ready' && Number.isFinite(now) && Number.isFinite(start) && start > now + 2400;
    }), { timeout: 15_000, message: 'The real everyday director must publish a future event before the controlled clock pause' }).toBe(true);
    await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
    const serverNow = Number(await f.host.getAttribute('data-road-event-server-now'));
    const eventStart = Number(await f.host.getAttribute('data-everyday-next-start'));
    expect(Number.isFinite(serverNow) && Number.isFinite(eventStart)).toBe(true);
    expect(eventStart, 'The selected real event must still be in the future').toBeGreaterThan(serverNow + 400);
    await page.evaluate(() => {
      const target = window as Window & { __qaPanFrameGate?: PanFrameGate };
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
      const held = new Map<number, FrameRequestCallback>(), releasedFrames = new Map<number, number>();
      const data = { installedAt: Date.now(), releasedAt: null as number | null, pendingAtRelease: false, held: 0, delivered: 0, registered: 0 };
      let stopped = false;
      const pending = () => document.querySelector<HTMLElement>('.world-canvas')?.dataset.cameraPresentationPending === 'true';
      const gatedRequest: typeof request = callback => {
        const renderer = /WorldCanvas(?:[-.]|\/)/.test(new Error().stack ?? '');
        if (renderer) data.registered++;
        const id = request.call(window, time => {
          if (!stopped && renderer && pending()) { held.set(id, callback); data.held++; return; }
          callback.call(window, time);
        });
        return id;
      };
      const gatedCancel: typeof cancel = id => {
        held.delete(id); cancel.call(window, releasedFrames.get(id) ?? id); releasedFrames.delete(id);
      };
      const release = () => {
        stopped = true;
        for (const [id, callback] of held) releasedFrames.set(id, request.call(window, time => {
          releasedFrames.delete(id); data.delivered++; callback.call(window, time);
        }));
        held.clear();
      };
      window.requestAnimationFrame = gatedRequest; window.cancelAnimationFrame = gatedCancel;
      // The fixed400ms horizon cannot run this timer or its following RAF.
      // Delivery still uses the real renderer callback and paused browser clock.
      const releaseTimer = setTimeout(() => { data.releasedAt = Date.now(); data.pendingAtRelease = pending(); release(); }, 401);
      target.__qaPanFrameGate = { read: () => ({ ...data, now: Date.now() }), restore: () => {
        clearTimeout(releaseTimer); release();
        if (window.requestAnimationFrame === gatedRequest) window.requestAnimationFrame = request;
        if (window.cancelAnimationFrame === gatedCancel) window.cancelAnimationFrame = cancel;
      } };
    });
    const preparation = await f.panFocus(pair.second, true, { settlePausedBefore: eventStart });
    const gate = await page.evaluate(() => {
      const gate = (window as Window & { __qaPanFrameGate?: PanFrameGate }).__qaPanFrameGate;
      if (!gate) throw new Error('The real renderer frame gate was not installed');
      return gate.read();
    });
    expect(gate.registered).toBeGreaterThan(0); expect(gate.held).toBeGreaterThan(0);
    expect(gate.releasedAt! - gate.installedAt).toBe(401); expect(gate.pendingAtRelease).toBe(true); expect(gate.delivered).toBeGreaterThan(0);
    expect(preparation?.extraFrames).toBeGreaterThan(0); expect(preparation?.wallElapsedMs).toBeLessThan(15_000);
    expect(page.url()).toBe(before.url);
    expect(await page.evaluate(() => history.length)).toBe(before.historyLength);
    await expect(f.host).toHaveAttribute('data-canonical-task-count', before.canonicalTasks!);
    await expect(f.host).toHaveAttribute('data-camera-presentation-pending', 'false');
    await expect(page.locator('.task-modal')).toHaveCount(0);
    await writeFile(info.outputPath('released-paused-camera.json'), JSON.stringify({ targetTask: pair.second.id, before, gate, preparation }, null, 2));
    await page.screenshot({ path: info.outputPath('released-paused-camera.png') });
  } finally {
    if (!page.isClosed()) {
      const gate = await page.evaluate(() => {
        const gate = (window as Window & { __qaPanFrameGate?: PanFrameGate }).__qaPanFrameGate;
        const state = gate?.read(); gate?.restore(); return state;
      });
      if (gate) await info.attach('paused-renderer-frame-gate', { body: JSON.stringify(gate), contentType: 'application/json' });
    }
    await f.cleanup();
  }
});

for (const targetKind of ['BREAKDOWN', 'WATER'] as const) {
  clockSceneTest(`${targetKind} service waits for actual arrival, drives and reopens safely`, async ({ page }, info) => {
    test.setTimeout(180000); await page.setViewportSize({ width: 1440, height: 1100 }); await installSceneClock(page);
    const f = await everydayFixture(page), seen = new Set<string>(), evidence: Record<string, unknown>[] = [], frames: Record<string, unknown>[] = [], windows:Record<string,unknown>[]=[];
    try {
      await f.focus(f.tasks[0]!); await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
      // Nine calendar windows may contain only one target kind. Observe up
      // to three genuine target dispatches within the original180s wall bound.
      let targetAttempts=0;
      for (let attempt = 0; attempt < 21 && targetAttempts<3 && seen.size < 1; attempt++) {
        const next = Number(await f.host.getAttribute('data-road-event-next-start')); await seek(page, f.host, next + 300);
        const kind = (await f.host.getAttribute('data-road-event'))!;
        const startedAt = Number(await f.host.getAttribute('data-road-event-server-now'));
        windows.push({attempt,startedAt,kind});
        if (kind !== targetKind) { await page.clock.fastForward(35000); await page.clock.runFor(100); continue; }
        targetAttempts++;
        expect(await f.host.getAttribute('data-road-service-arrived')).toBe('false');
        expect(await f.host.getAttribute('data-road-cargo-loaded')).toBe('false');
        expect(Number(await f.host.getAttribute('data-road-closed-cells'))).toBe(3);
        const admitted = await safe(f.host), phases = new Set<string>();
        let arrived = false, loaded = false;
        // The public server clock can slew backwards by10%. Deliver every
        // physical frame until31s of that clock elapsed, within35 one-second
        // browser steps; the service's30s lifetime and wall deadline stay fixed.
        for (let i = 0; i < 35; i++) {
          await page.clock.runFor(1000); const state = await safe(f.host);
          if (state.roadEvent === kind) phases.add(state.roadEventPhase!);
          if (frames.length < 105) frames.push({ attempt, targetAttempt:targetAttempts, step: i + 1, startedAt, serverNow: state.roadEventServerNow,
            kind: state.roadEvent, phase: state.roadEventPhase, arrived: state.roadServiceArrived, loaded: state.roadCargoLoaded,
            closedCells: state.roadClosedCells, responders: state.roadResponders, trips: state.roadResponseTrips,
            fixedSteps: state.mobilityFixedSteps, safety: [state.mobilityVehicleUnsafeTotal, state.mobilityPedestrianUnsafeTotal,
              state.mobilityVehiclePedestrianUnsafeTotal, state.wrongWayCars, state.walkerOffPath] });
          arrived ||= state.roadServiceArrived === 'true';
          loaded ||= state.roadCargoLoaded === 'true';
          if (i === 12 || kind === 'BREAKDOWN' && loaded && i === 18) await page.screenshot({ path: info.outputPath(`${kind.toLowerCase()}-${i}.png`) });
          if(Number(state.roadEventServerNow)>=startedAt+31_000)break;
        }
        expect(Number(await f.host.getAttribute('data-road-event-server-now'))).toBeGreaterThanOrEqual(startedAt+31_000);
        if (!arrived || kind === 'BREAKDOWN' && !loaded) {
          // Dispatch admits a directed route, not a guaranteed travel time
          // through live traffic. A fully observed safe expiry is a negative
          // attempt. A tow truck arriving in CLEAR may also lack its required
          // four physical loading seconds. Neither partial case is a success;
          // still require arrival AND loading within the bounded target attempts.
          const expired = await safe(f.host);
          expect(phases).toEqual(new Set(['ARRIVE', 'WORK', 'CLEAR']));
          expect(expired.roadEvent).toBe(''); expect(expired.roadClosedCells).toBe('0');
          expect(expired.roadResponders).toBe('0');
          expect(Number(expired.mobilityFixedSteps) - Number(admitted.mobilityFixedSteps)).toBeGreaterThanOrEqual(500);
          evidence.push({ kind, arrived, loaded, reason: arrived ? 'expired-before-loading' : 'expired-before-arrival', admitted, expired });
          await writeFile(info.outputPath('road-service-arrivals.json'), JSON.stringify(evidence, null, 2));
          continue;
        }
        expect(arrived, `${kind} service never arrived`).toBe(true); if (kind === 'BREAKDOWN') expect(loaded).toBe(true);
        // ServerWorldClock slews backwards corrections at at most10%; use its
        // observed epoch for expiry after exercising the real fixed-step route.
        await seek(page, f.host, startedAt + 31_000);
        await expect(f.host).toHaveAttribute('data-road-closed-cells', '0'); await expect(f.host).toHaveAttribute('data-road-event', '');
        seen.add(kind); evidence.push({ kind, arrived, loaded, trips: await f.host.getAttribute('data-road-response-trips') });
      }
      expect(seen).toEqual(new Set([targetKind]));
      await writeFile(info.outputPath('road-service-arrivals.json'), JSON.stringify(evidence, null, 2));
    } finally {
      try { await info.attach(`${targetKind.toLowerCase()}-service-frames`, { body: JSON.stringify({ targetKind, windows, frames, evidence }), contentType: 'application/json' }); }
      finally { await f.cleanup(); }
    }
  });
}

test('touch-sized everyday city keeps preferences, sound opt-in, motion cancellation and read-only task controls usable', async ({ page, hasTouch }, info) => {
  test.setTimeout(90000); await page.setViewportSize({ width: 390, height: 844 }); const f = await everydayFixture(page);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await f.focus(f.pendingSchool);
    await f.service.activateDistrict(f.user.countryId, f.pendingSchool.districtId, crypto.randomUUID());
    const menu = page.locator('.world-menu > summary'); if (hasTouch) await menu.tap(); else await menu.click();
    const prefs = page.locator('.world-preferences:visible'); if (hasTouch) await prefs.locator('> summary').tap(); else await prefs.locator('> summary').click();
    await prefs.getByLabel('Детализация').selectOption('ECONOMY'); await prefs.getByLabel('Звуки города').check();
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await f.call('task.set_status', { taskId: f.pendingSchool.id, status: 'COMPLETED' });
    await expect(f.host).toHaveAttribute('data-everyday-event', 'OPEN_SCHOOL', { timeout: 15000 });
    await page.screenshot({ path: info.outputPath('mobile-school-opening.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(f.host).toHaveAttribute('data-everyday-event', '');
    await expect(f.host).toHaveAttribute('data-city-audio-voices', '0'); await expect(f.host).toHaveAttribute('data-city-umbrellas', '0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await f.panFocus(await f.service.getTask(f.user.countryId, f.pendingSchool.id));
    expect(await page.getByRole('button', { name: /Создать задачу|Назначить|Редактировать задачу|Удалить задачу|Завершить задачу/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await f.cleanup(); }
});


async function seek(page: Page, host: Locator, target: number) {
  for (let i = 0; i < 4; i++) {
    const now = Number(await host.getAttribute('data-road-event-server-now'));
    if (now >= target) return;
    await page.clock.fastForward(sceneClockStepTowardStart(now,target)); await page.clock.runFor(100);
  }
}
async function safe(host: Locator) {
  const state = await host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
  expect([state.mobilityVehicleUnsafeTotal, state.mobilityPedestrianUnsafeTotal,
    state.mobilityVehiclePedestrianUnsafeTotal, state.wrongWayCars, state.walkerOffPath]).toEqual(['0', '0', '0', '0', '0']);
  return state;
}
async function setSceneLife(page: Page, on: boolean) {
  await page.locator('.world-menu > summary').click(); const prefs = page.locator('.world-preferences:visible'); await prefs.locator('> summary').click();
  await prefs.getByLabel('Жизнь города').setChecked(on); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.clock.runFor(100);
}

type EverydaySample={kind:string;phase:string;areaReady:boolean;arrivals:number;animals:number;fetched:boolean;scattered:boolean;serverNow:number};
type EverydayObservedNode=HTMLElement&{__qaEveryday?:{arrivals:number;animals:number;fetched:boolean;scattered:boolean;
  activityArrivals:boolean;eligibleActivity:boolean;assetsUnavailable:boolean;invalidTelemetry:boolean;truncated:boolean;samples:EverydaySample[];observer:MutationObserver;
  taskId?:string;episodeId?:string;ended?:{episodeId:string;serverNow:number;nextEpisodeId:string}}};
async function observeEveryday(host:Locator,scheduledStartMs:number){
  await host.evaluate((el,scheduledStartMs)=>{
    const node=el as EverydayObservedNode;node.__qaEveryday?.observer.disconnect();
    let signature='';
    const read=()=>{const d=node.dataset,record=node.__qaEveryday!;
      record.assetsUnavailable||=d.ambientAssets!=='ready';
      if(record.episodeId&&d.everydayEpisodeId!==record.episodeId){
        record.ended??={episodeId:record.episodeId,serverNow:Number(d.roadEventServerNow),nextEpisodeId:d.everydayEpisodeId??''};return;
      }
      // Panning changes the local candidate set. Bind the actual admission,
      // not the earlier camera's planned task, and retain only that episode.
      const now=Number(d.roadEventServerNow);
      if(!d.everydayTask||!d.everydayEvent||now<scheduledStartMs||now>=scheduledStartMs+44_000)return;
      record.taskId??=d.everydayTask;
      record.episodeId??=d.everydayEpisodeId;
      record.invalidTelemetry||=!['true','false'].includes(d.everydayAreaReady??'')
        ||!Number.isFinite(Number(d.everydayArrived))||!Number.isFinite(Number(d.everydayAnimals));
      record.arrivals=Math.max(record.arrivals,Number(d.everydayArrived??0));record.animals=Math.max(record.animals,Number(d.everydayAnimals??0));
      record.fetched||=d.dogCarrying==='true';record.scattered||=d.birdsScattered==='true';
      const sample={kind:d.everydayEvent,phase:d.everydayPhase??'',areaReady:d.everydayAreaReady==='true',
        arrivals:Number(d.everydayArrived??0),animals:Number(d.everydayAnimals??0),fetched:d.dogCarrying==='true',scattered:d.birdsScattered==='true'};
      record.activityArrivals||=sample.phase==='ACTIVITY'&&sample.arrivals>0;
      record.eligibleActivity||=sample.phase==='ACTIVITY'&&sample.arrivals>0&&sample.areaReady;
      const next=JSON.stringify(sample);
      if(next!==signature){signature=next;record.samples.push({...sample,serverNow:Number(d.roadEventServerNow)});
        if(record.samples.length>64){record.truncated=true;record.samples.shift();}}
    };
    const observer=new MutationObserver(read);
    node.__qaEveryday={arrivals:0,animals:0,fetched:false,scattered:false,activityArrivals:false,eligibleActivity:false,assetsUnavailable:false,invalidTelemetry:false,truncated:false,samples:[],observer};
    observer.observe(node,{attributes:true,attributeFilter:['data-everyday-event','data-everyday-episode-id','data-everyday-task','data-everyday-phase','data-everyday-area-ready','data-everyday-arrived','data-everyday-animals','data-dog-carrying','data-birds-scattered','data-ambient-assets']});
    read();
  },scheduledStartMs);
  return ()=>host.evaluate(el=>{const r=(el as EverydayObservedNode).__qaEveryday!;return {taskId:r.taskId,episodeId:r.episodeId,arrivals:r.arrivals,animals:r.animals,fetched:r.fetched,scattered:r.scattered,
    activityArrivals:r.activityArrivals,eligibleActivity:r.eligibleActivity,assetsUnavailable:r.assetsUnavailable,invalidTelemetry:r.invalidTelemetry,truncated:r.truncated,samples:r.samples,ended:r.ended};});
}

clockSceneTest('six everyday scenes use actual residents and approaches', async ({ page }, info) => {
  // Six real40s approaches already require240s of fixed-step simulation.
  // CI39935303498 WebKit completed four of them in541s wall time before
  // timing out during SPORT. Keep every frame/physics step and arrival
  // assertion; this is the aggregate software-renderer QA deadline only.
  test.setTimeout(1200000); await page.setViewportSize({ width: 1440, height: 1100 }); await installSceneClock(page);
  const f = await everydayFixture(page), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const seen = new Set<string>(), samples: Record<string, unknown>[] = [], unavailable: Record<string, unknown>[] = [];
  try {
    await page.addInitScript(()=>localStorage.setItem('tasktopia:world-preferences:v2',JSON.stringify({quality:'NORMAL',cityLife:false,sound:false})));
    let canonicalCount:string|undefined,previousStart=0;
    for (let attempt = 0; attempt < 36 && seen.size < 6; attempt++) {
      // Admission is local to the visible city. Waiting at the campus can
      // qualify schools forever but can never observe an offscreen park.
      // Visit the real context before asking for the next ordinary window;
      // no event, participant or selected kind is forced by the test.
      const wanted = ['SCHOOL','KINDERGARTEN','MARKET','SPORT','DOG','BIRDS'].find(kind => !seen.has(kind))!;
      const contexts = f.tasks.filter(task => task.stage === 5 && (wanted === 'SCHOOL' || wanted === 'KINDERGARTEN'
        ? BUILDING_CATALOG.find(building => building.key === task.visualAssetKey)?.educationKind === wanted
        : task.visualKind === 'PARK'));
      expect(contexts.length, `No real context for ${wanted}`).toBeGreaterThan(0);
      // Each natural window starts through real navigation in the same
      // unchanged city. A preceding slot's random bus evacuation is a separate
      // cancellation journey, not a prerequisite for this scene's art/arrival.
      // No actor, selected event kind or physics step is injected.
      await page.clock.resume();await f.focus(contexts[attempt % contexts.length]!);
      await page.clock.pauseAt(await page.evaluate(()=>new Date(Date.now()+2000).toISOString()));
      await expect(f.host).toHaveAttribute('data-transit-passengers','0');
      const count=(await f.host.getAttribute('data-canonical-task-count'))!;
      expect(Number(count)).toBeGreaterThanOrEqual(f.tasks.length);
      canonicalCount??=count;expect(count).toBe(canonicalCount);
      const context=contexts[attempt % contexts.length]!;
      // A visible parcel at the edge can leave its activity pad outside the
      // admission area. Center the real context through the normal camera pan.
      const centerBefore=(Math.floor(Number(await f.host.getAttribute('data-road-event-server-now'))/75_000)+1)*75_000+8000;
      await f.panFocus(context,true,{center:true,settlePausedBefore:centerBefore});
      const bounds=context.siteBounds??{minX:Math.min(...context.footprint.map(c=>c.x)),maxX:Math.max(...context.footprint.map(c=>c.x)),
        minY:Math.min(...context.footprint.map(c=>c.y)),maxY:Math.max(...context.footprint.map(c=>c.y))};
      const centered=await f.host.evaluate(el=>({x:Number((el as HTMLElement).dataset.cameraWorldX),y:Number((el as HTMLElement).dataset.cameraWorldY)}));
      expect(Math.abs(centered.x-(bounds.minX+bounds.maxX+1)/2)).toBeLessThan(.5);
      expect(Math.abs(centered.y-(bounds.minY+bounds.maxY+1)/2)).toBeLessThan(.5);
      const start = Math.max(previousStart+75_000,(Math.floor(Number(await f.host.getAttribute('data-road-event-server-now')) / 75_000) + 1) * 75_000 + 8000);
      previousStart=start;
      await info.attach('natural-window-context',{body:JSON.stringify({attempt,wanted,start,cityId:f.city.id,
        canonicalCount:count,revision:await f.host.getAttribute('data-city-scene-revision')}),contentType:'application/json'});
      // Clock/readback latency can consume the last two seconds before start.
      // Prepare near the beginning of the real window, not its final moments.
      await seek(page, f.host, start - 7000); await setSceneLife(page, true);
      const preparation=await safe(f.host);
      if(!preparation.everydayPlannedTask){
        // After start the director intentionally consumes/skips the plan rather
        // than replaying an offscreen event. Only that expired preparation may
        // be retried; a missing plan before start remains a failing assertion.
        expect(Number(preparation.roadEventServerNow),'Missing future plan before its start').toBeGreaterThanOrEqual(start);
        unavailable.push({reason:'preparation-crossed-window-start',start,state:preparation});
        await writeFile(info.outputPath('everyday-unavailable-slots.json'),JSON.stringify(unavailable,null,2));
        await setSceneLife(page,false);continue;
      }
      const plannedId = preparation.everydayPlannedTask, task = f.tasks.find(t => t.id === plannedId);
      expect(task, `No planned task ${plannedId}`).toBeTruthy(); await f.panFocus(task!, true, { settlePausedBefore: start });
      const observed=await observeEveryday(f.host,start);
      await seek(page, f.host, start + 350); await page.clock.runFor(1000);
      const kind = await f.host.getAttribute('data-everyday-event');
      if (!kind) await writeFile(info.outputPath('missing-scene.json'), JSON.stringify({ start, task, data: await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })) }, null, 2));
      expect(kind).toBeTruthy();
      const initial = await safe(f.host), visitors = Number(initial.everydayVisitors);
      const admission=await observed(),id=initial.everydayTask;
      expect(f.tasks.some(task=>task.id===id&&task.stage===5)).toBe(true);
      expect(admission.taskId).toBe(id);expect(admission.episodeId).toBe(initial.everydayEpisodeId);
      // A calendar slot can choose a campus without reachable idle children.
      // Try a later real slot, as the school-bus test does; each of the six
      // kinds still must complete with actual visitors and physical arrivals.
      if (seen.has(kind!) || visitors === 0) {
        if (visitors === 0) unavailable.push({ kind, taskId: id, reason: 'no-reachable-idle-residents' });
        await setSceneLife(page, false); await seek(page, f.host, start + 44_200);
        await writeFile(info.outputPath('everyday-unavailable-slots.json'), JSON.stringify(unavailable, null, 2));
        await safe(f.host); continue;
      }
      expect(visitors).toBeGreaterThan(0);
      let arrivals = 0, animals = 0, fetched = false, scattered = false;
      // Include the final arrivals before LEAVE; a 32-second prefix can miss
      // a real arrival near the end of the 34-second approach/activity period.
      for (let i = 0; i < 20; i++) {
        await page.clock.runFor(2000); const state = await safe(f.host);
        if(state.everydayEpisodeId===initial.everydayEpisodeId){
          arrivals = Math.max(arrivals, Number(state.everydayArrived));
          animals = Math.max(animals, Number(state.everydayAnimals));
          fetched ||= state.dogCarrying === 'true'; scattered ||= state.birdsScattered === 'true';
        }
        if (i === 8) await page.screenshot({ path: info.outputPath(`everyday-${kind!.toLowerCase()}.png`) });
      }
      // Complete the real physical steps only until the published event end.
      // A fixed extra14s kept rendering after expiry and exhausted WebKit's
      // aggregate wall budget after all six arrivals had already passed.
      for (let step = 0; step < 14 && Number(await f.host.getAttribute('data-road-event-server-now')) < start + 44_200; step++) {
        await page.clock.runFor(1000); await safe(f.host);
      }
      const actualFrames=await observed();arrivals=Math.max(arrivals,actualFrames.arrivals);animals=Math.max(animals,actualFrames.animals);
      fetched||=actualFrames.fetched;scattered||=actualFrames.scattered;
      const terminal = await safe(f.host);
      await writeFile(info.outputPath(`everyday-${kind!.toLowerCase()}-observation.json`), JSON.stringify({ start, taskId:id, initial, arrivals, animals, fetched, scattered, observed:actualFrames, state: terminal }, null, 2));
      if (!arrivals) await writeFile(info.outputPath('missing-arrival.json'), JSON.stringify(terminal, null, 2));
      // A visit token admits a route, not an arrival deadline. Only a fully
      // observed natural expiry may remain an unqualified calendar attempt;
      // all six positive scenes are still due within the original36 slots.
      if (!arrivals && isEverydayAttemptExpiredWithoutArrival({ scheduledStartMs:start,kind:kind!,taskId:id!,initial,terminal,observed:actualFrames,errors })) {
        expect(errors).toEqual([]);
        unavailable.push({kind,taskId:id,reason:'expired-before-arrival',start,initial,observed:actualFrames,terminal});
        await writeFile(info.outputPath('everyday-unavailable-slots.json'),JSON.stringify(unavailable,null,2));
        await setSceneLife(page,false);await seek(page,f.host,start+44_200);
        continue;
      }
      expect(arrivals, `${kind} residents never arrived`).toBeGreaterThan(0);
      // The view deliberately hides animals while another physical resident
      // occupies the pad. Such a slot cannot qualify the animal rendering.
      // A single eligible frame, missing assets or incomplete observations
      // keeps the original failing oracle; all six positive scenes remain due.
      if ((kind === 'DOG' || kind === 'BIRDS') && animals === 0 && actualFrames.activityArrivals
        && !actualFrames.eligibleActivity && !actualFrames.assetsUnavailable && !actualFrames.invalidTelemetry && !actualFrames.truncated) {
        expect(errors).toEqual([]);
        unavailable.push({kind,taskId:id,reason:'pad-occupied-during-arrival',observed:actualFrames});
        await writeFile(info.outputPath('everyday-unavailable-slots.json'),JSON.stringify(unavailable,null,2));
        await setSceneLife(page,false);await seek(page,f.host,start+44_200);
        continue;
      }
      if (kind === 'DOG' || kind === 'BIRDS') expect(animals).toBeGreaterThan(0);
      if (kind === 'DOG') expect(fetched).toBe(true);
      seen.add(kind!);
      samples.push({ kind, arrivals, animals, fetched, scattered, state: await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })) });
      await writeFile(info.outputPath('everyday-scenes-progress.json'), JSON.stringify(samples, null, 2));
      await seek(page, f.host, start + 44_200);
      // The director can admit another real site in this same window as soon
      // as the observed scene expires. Qualify its owner cleanup, not an idle
      // gap that the product does not promise between independent scenes.
      await expect(f.host).not.toHaveAttribute('data-everyday-episode-id', initial.everydayEpisodeId!);
      const owners=JSON.parse(await f.host.getAttribute('data-city-event-owners')??'[]') as {id:string}[];
      expect(owners.some(owner=>owner.id===initial.everydayEpisodeId)).toBe(false);
      await setSceneLife(page, false);
    }
    expect(seen).toEqual(new Set(['SCHOOL', 'KINDERGARTEN', 'MARKET', 'SPORT', 'DOG', 'BIRDS']));
    // All six walking/animal scenes are qualified above. A school slot may
    // legitimately have only walking children; the separate real school-bus
    // journey requires boarding, driving, alighting and school arrival.
    expect(errors).toEqual([]);
    await writeFile(info.outputPath('everyday-scenes.json'), JSON.stringify(samples, null, 2));
    await writeFile(info.outputPath('everyday-unavailable-slots.json'), JSON.stringify(unavailable, null, 2));
  } finally { await f.cleanup(); }
});

test('everyday live lifecycle clears hidden, map exit, reconnect and deleted institutions without historical openings', async ({ page }) => {
  test.setTimeout(120000); const f = await everydayFixture(page);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await f.focus(f.pendingSchool); await f.panFocus(f.pendingSchool); await f.service.activateDistrict(f.user.countryId, f.pendingSchool.districtId, crypto.randomUUID());
    await f.call('task.set_status', { taskId: f.pendingSchool.id, status: 'COMPLETED' });
    await expect(f.host).toHaveAttribute('data-everyday-event', 'OPEN_SCHOOL', { timeout: 15000 });
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(f.host).toHaveAttribute('data-everyday-event', ''); await expect(f.host).toHaveAttribute('data-animation-active', 'false');
    await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(f.host).toHaveAttribute('data-animation-active', 'true'); expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
    await page.getByRole('button', { name: 'Планета', exact: true }).click(); await expect(f.host).toHaveAttribute('data-everyday-event', '');
    await openMapCity(page); await expect(f.host).toHaveAttribute('data-animation-active', 'true');
    await f.panFocus(f.pendingKindergarten); await f.service.activateDistrict(f.user.countryId, f.pendingKindergarten.districtId, crypto.randomUUID());
    await f.call('task.set_status', { taskId: f.pendingKindergarten.id, status: 'COMPLETED' });
    await expect(f.host).toHaveAttribute('data-everyday-event', 'OPEN_KINDERGARTEN', { timeout: 15000 });
    const opening = await f.host.getAttribute('data-everyday-episode-id');
    await page.context().setOffline(true); await page.waitForTimeout(1200); await page.context().setOffline(false);
    // Reconnect clears the historical ceremony. A valid ordinary visit may
    // resume in the same visible kindergarten; an idle city is not required.
    await expect(f.host).not.toHaveAttribute('data-everyday-episode-id', opening!, { timeout: 20000 });
    await expect(f.host).not.toHaveAttribute('data-everyday-event', /^OPEN_/);
    await f.panFocus(f.pendingHome); await f.service.activateDistrict(f.user.countryId, f.pendingHome.districtId, crypto.randomUUID());
    await f.call('task.set_status', { taskId: f.pendingHome.id, status: 'COMPLETED' });
    await expect(f.host).toHaveAttribute('data-everyday-event', 'OPEN_BUILDING', { timeout: 15000 });
    await f.call('task.delete', { taskId: f.pendingHome.id, confirmTitle: f.pendingHome.title });
    await expect(f.host).not.toHaveAttribute('data-everyday-task', f.pendingHome.id);
    await expect(f.host).not.toHaveAttribute('data-everyday-event', /^OPEN_/);
    await expect(f.host).toHaveAttribute('data-city-cinematics', '0', { timeout: 10000 });
    expect((await f.service.listTasks(f.user.countryId)).some(task => task.id === f.pendingHome.id)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.context().setOffline(false); await f.cleanup(); }
});


clockSceneTest('public bus completes an actual boarding, directed trip and safe alighting', async ({ page }, info) => {
  test.setTimeout(210000); await installSceneClock(page); const f = await everydayFixture(page);
  try {
    // Every independent opening starts before its first service. Otherwise
    // loading with life enabled dispatches a trip before the controlled start,
    // retaining that vehicle's route/position even after service cancellation.
    await page.addInitScript(()=>localStorage.setItem('tasktopia:world-preferences:v2',JSON.stringify({quality:'NORMAL',cityLife:false,sound:false})));
    const attempts:Record<string,unknown>[]=[];let completed=false,previousWindowStart=0;
    // Keep the original80s observation and210s whole-test cap. Three actual
    // admissions may include safe cancellations, but only a real positive
    // boarding/travel/alighting journey can pass this test.
    for(let attempt=0;attempt<3&&!completed;attempt++){
      await page.clock.resume(); await f.focus(f.tasks[0]!); await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
      if(attempt===0){
        // Capture the real owned HTTP scene before the journey; a whole-test
        // timeout cannot run the failure-only attachment reliably.
        const scene=await page.request.get(`/api/countries/${f.user.countryId}/cities/${f.city.id}/scene`,{timeout:5000});
        expect(scene.status()).toBe(200);
        await info.attach('bus-native-scene',{body:await scene.body(),contentType:'application/json'});
      }
      const now = Number(await f.host.getAttribute('data-road-event-server-now'));
      // ROAD and EVERYDAY permit late admission, so enabling life after their
      // nominal start can dispatch a response immediately. Start in the first
      // second of their common450s calendar, before either admission, and let
      // ordinary later events interact with the actual trip below.
      const departureWindowStart = Math.max((Math.floor(now / 450_000) + 1) * 450_000 + 1000, previousWindowStart + 450_000);
      previousWindowStart=departureWindowStart;
      await setSceneLife(page, false);
      await seek(page, f.host, departureWindowStart);
      const prepared = await safe(f.host), preparedAt = Number(prepared.roadEventServerNow);
      expect(prepared.regularBuses,'The controlled first trip must not inherit an earlier bus service').toBe('0');
      expect(prepared.schoolBuses).toBe('0');
      expect(preparedAt).toBeGreaterThanOrEqual(departureWindowStart);
      expect(preparedAt).toBeLessThan(departureWindowStart + 1000);
      // No road director frame has run when life starts disabled; its absent
      // attribute and a cleared attribute both mean no admitted road event.
      expect(prepared.roadEvent??'').toBe(''); expect(prepared.transitPhase).toBe('');
      const baseline = { boarded: Number(prepared.transitBoarded)-Number(prepared.schoolBusBoarded),
        alighted: Number(prepared.transitAlighted)-Number(prepared.schoolBusAlighted) };
      const busState=()=>f.host.evaluate(el=>{const d=(el as HTMLElement).dataset;return{role:d.transitRole,phase:d.transitPhase,
        alighted:Number(d.transitAlighted)-Number(d.schoolBusAlighted)};});
      const phases = new Set<string>();
      await setSceneLife(page, true);
      for (let step = 0; step < 40 && Number(await f.host.getAttribute('data-road-event-server-now')) < preparedAt + 300; step++) {
        await page.clock.runFor(100);const state=await busState();if(state.role==='BUS')phases.add(state.phase!);
      }
      const admission = await safe(f.host);
      await writeFile(info.outputPath('bus-clock-arrangement.json'), JSON.stringify({ now, departureWindowStart, prepared, baseline, admission }, null, 2));
      expect(Number(admission.roadEventServerNow)).toBeGreaterThanOrEqual(preparedAt + 300);
      expect(admission.roadEvent).toBe(''); expect(admission.transitRole).toBe('BUS');
      expect(admission.transitPhase).toMatch(/^(ARRIVE|BOARD)$/);
      // Deliver every frame through the original80s world-clock horizon. Its
      // -10% slew needs at most90 browser seconds; the210s wall cap stays fixed.
      const tripDeadline=Number(admission.roadEventServerNow)+80_000;
      let publicTrip=await busState();
      for (let i = 0; i < 90 && publicTrip.alighted === baseline.alighted
        && Number(await f.host.getAttribute('data-road-event-server-now'))<tripDeadline; i++) {
        await page.clock.runFor(1000);publicTrip=await busState();if(publicTrip.role==='BUS')phases.add(publicTrip.phase!);
        if (i % 5 === 0) await safe(f.host);
      }
      const state = await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      const boarded=Number(state.transitBoarded)-Number(state.schoolBusBoarded)-baseline.boarded;
      const alighted=Number(state.transitAlighted)-Number(state.schoolBusAlighted)-baseline.alighted;
      completed=boarded>0&&alighted>0;
      attempts.push({attempt,completed,outcome:completed?'PASSENGER_ALIGHTED':'NO_PASSENGER_ALIGHTING_IN_80S',phases:[...phases],baseline,tripDeadline,admission,state});
      await writeFile(info.outputPath('bus-round-trip.json'), JSON.stringify({ phases: [...phases], baseline,tripDeadline,state,attempts }, null, 2));
      await safe(f.host);
      if(completed){
        // A later school delivery cannot qualify the regular bus's trip.
        expect(boarded).toBeGreaterThan(0);expect(alighted).toBeGreaterThan(0);
        expect([...phases]).toEqual(expect.arrayContaining(['ARRIVE','BOARD','TRAVEL','ALIGHT']));
        await page.screenshot({path:info.outputPath('bus-alighting.png')});
      }else{
        // A line may be empty, delayed or cancelled within this80s observation.
        // Keep the unfinished passenger trip negative; then open a fresh case.
        expect(Number(state.roadEventServerNow)).toBeGreaterThanOrEqual(tripDeadline);
        expect(alighted).toBe(0);
        expect(state.mapActive).toBe('true');expect(state.animationActive).toBe('true');expect(state.citySceneCommit).toBe('atomic');
        expect(Number(state.mobilityFixedSteps)-Number(admission.mobilityFixedSteps)).toBeGreaterThanOrEqual(500);
      }
    }
    expect(completed,'No regular bus completed a real trip in three bounded openings').toBe(true);
  } catch (error) {
    await captureOwnedCityFailure(info, f.service, f.user.countryId, f.city.id); throw error;
  } finally { await f.cleanup(); }
});

clockSceneTest('rain covers actual walkers, puddles and car splashes then dries completely', async ({ page }, info) => {
  test.setTimeout(90000); await installSceneClock(page); const f = await everydayFixture(page);
  try {
    await f.focus(f.tasks[0]!); await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
    const nextPhase = async (phase: 'RAIN' | 'DRYING' | 'DRY') => {
      const now = Number(await f.host.getAttribute('data-road-event-server-now'));
      const target = Array.from({ length: 600 }, (_, i) => now + (i + 1) * 1000).find(t => rainPose(f.city.id, t).phase === phase && (phase !== 'RAIN' || rainPose(f.city.id, t).intensity > .8));
      expect(target).toBeTruthy(); await seek(page, f.host, target! + 1000); await page.clock.runFor(300);
    };
    await nextPhase('RAIN'); await expect(f.host).toHaveAttribute('data-city-weather', 'RAIN');
    expect(Number(await f.host.getAttribute('data-city-umbrellas'))).toBeGreaterThan(0);
    await page.clock.runFor(2000); await page.screenshot({ path: info.outputPath('everyday-rain.png') }); await safe(f.host);
    await nextPhase('DRYING'); await expect(f.host).toHaveAttribute('data-city-weather', 'DRYING'); await expect(f.host).toHaveAttribute('data-city-umbrellas', '0');
    await nextPhase('DRY'); await expect(f.host).toHaveAttribute('data-city-weather', 'DRY');
    await expect(f.host).toHaveAttribute('data-city-umbrellas', '0');
  } finally { await f.cleanup(); }
});

clockSceneTest('school bus delivers children through the real school entrance independently of its street ceremony', async ({ page }, info) => {
  test.setTimeout(900000); await installSceneClock(page); const f = await everydayFixture(page);
  try {
    const schools = f.tasks.filter(task => task.stage === 5 && BUILDING_CATALOG.find(b => b.key === task.visualAssetKey)?.educationKind === 'SCHOOL');
    expect(schools.length).toBeGreaterThan(0);
    type Dropoff={taskId:string;serial:number;alighted:number;serverNow:number};
    type WitnessNode=HTMLElement&{__qaSchoolWitness?:{dropoffs:Dropoff[];invalid:boolean;truncated:boolean;observer:MutationObserver}};
    // A later kindergarten ceremony can start the only successful bus. Bind
    // its real admission and alighting to that destination, rather than
    // attributing a global arrival counter to the earlier planned school.
    const installWitness=()=>f.host.evaluate(el=>{
      const node=el as WitnessNode,admissions=new Map<number,string>();let serial=-1,alighted=Number(node.dataset.schoolBusAlighted??0);
      const read=()=>{
        const d=node.dataset,w=node.__qaSchoolWitness!,next=Number(d.schoolBuses),out=Number(d.schoolBusAlighted);
        if(!Number.isSafeInteger(next)||next<0||!Number.isSafeInteger(out)||out<0)return;
        const previousSerial=serial;
        if(out<alighted||next<serial||serial>=0&&next>serial+1)w.invalid=true;
        if(next!==serial){
          serial=next;
          if(d.transitRole==='SCHOOL_BUS'&&d.schoolBusTask)admissions.set(serial,d.schoolBusTask);
          if(admissions.size>16){w.truncated=true;admissions.delete(admissions.keys().next().value!);}
        }
        if(out>alighted){
          // Alighting may finish and release a run in this same frame. Its
          // cumulative school counter still belongs to the witnessed bus.
          const completedSerial=previousSerial>=0&&previousSerial!==serial?previousSerial:serial;
          const taskId=admissions.get(completedSerial),serverNow=Number(d.roadEventServerNow);
          if(!taskId||!Number.isFinite(serverNow))w.invalid=true;
          else{w.dropoffs.push({taskId,serial:completedSerial,alighted:out,serverNow});if(w.dropoffs.length>16){w.truncated=true;w.dropoffs.shift();}}
        }
        alighted=out;
      };
      const observer=new MutationObserver(read);node.__qaSchoolWitness={dropoffs:[],invalid:false,truncated:false,observer};
      observer.observe(node,{attributes:true,attributeFilter:['data-school-buses','data-school-bus-alighted','data-transit-role','data-transit-phase','data-school-bus-task']});read();
    });
    // Ordinary traffic can delay passengers beyond a finite boarding window.
    // Exercise up to three scheduled ceremonies in the same live city, recording
    // empty/cancelled trips too; never replace a real doorway arrival with a lease.
    const deliveryBudgetMs = 44_000 + 80_000 + 60_000;
    const journeys: Record<string, unknown>[] = [], progress: Record<string, unknown>[] = [];
    let deliveredTask: typeof f.tasks[number] | undefined, previousStart=0;
    for (let episode = 0; episode < 3 && !deliveredTask; episode++) {
      // Open the actual campus for each independent positive journey. An
      // idle fleet retained by a preceding distant pan can legitimately be
      // outside the bounded service area; that continuity has separate QA.
      // Real navigation retains the same backend city, tasks and stop plan.
      await page.clock.resume(); await f.focus(schools[episode % schools.length]!);
      await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
      await installWitness(); await setSceneLife(page, false);
      let start = 0, plannedKind = '';
      // Planning rotates the kinds available in the visible context, rather
      // than the global city inventory. Observe the real local plan first.
      for(let slot=0;slot<6&&plannedKind!=='SCHOOL';slot++){
        start = Math.max((Math.floor(Number(await f.host.getAttribute('data-road-event-server-now')) / 75_000) + 1) * 75_000 + 8000,previousStart+75_000);
        previousStart=start;
        await seek(page, f.host, start - 7000); await setSceneLife(page, true);
        plannedKind = (await f.host.getAttribute('data-everyday-planned-kind'))!;
        progress.push({episode,slot,start,plannedKind});
        if(plannedKind!=='SCHOOL')await setSceneLife(page,false);
      }
      expect(Number(await f.host.getAttribute('data-road-event-server-now')),'School preparation must remain before its scheduled start').toBeLessThan(start);
      await expect(f.host).toHaveAttribute('data-everyday-planned-kind', 'SCHOOL');
      const taskId = await f.host.getAttribute('data-everyday-planned-task'), task = f.tasks.find(t => t.id === taskId);
      expect(task).toBeTruthy(); await f.panFocus(task!, true, {settlePausedBefore:start});
      // Finish preparation with life off. Clearing the incidental regular run
      // keeps its ordinary8s retry gap across the school start, so this positive
      // school journey does not spend most of its wall budget on an unrelated
      // regular route. Actual late BUS handoff has separate public/live coverage.
      await setSceneLife(page,false);await seek(page,f.host,start-1500);await setSceneLife(page,true);
      expect(Number(await f.host.getAttribute('data-road-event-server-now'))).toBeLessThan(start);
      await expect(f.host).toHaveAttribute('data-transit-role','');
      await seek(page, f.host, start + 300);
      await expect(f.host).toHaveAttribute('data-everyday-event', 'SCHOOL');
      const deliveryStartedAt = Number(await f.host.getAttribute('data-road-event-server-now'));
      const before = await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      let sample = before, observedSchoolBus = before.transitRole === 'SCHOOL_BUS';
      // The original184s budget belongs to the world clock. Its -10% slew
      // needs up to205 browser seconds plus two telemetry samples, not184.
      const deliveryDeadline = deliveryStartedAt + deliveryBudgetMs;
      const maximumSteps = Math.ceil(deliveryBudgetMs / .9 / 1000) + 2;
      for (let i = 0; i < maximumSteps && Number(sample.roadEventServerNow) < deliveryDeadline
        && Number(sample.schoolBusArrived) === Number(before.schoolBusArrived); i++) {
        await page.clock.runFor(Math.min(1000,Math.max(100,deliveryDeadline-Number(sample.roadEventServerNow))));
        sample = await f.host.evaluate(el => {
          const d = (el as HTMLElement).dataset;
          return { roadEventServerNow: d.roadEventServerNow, transitRole: d.transitRole, schoolBusVisits: d.schoolBusVisits,
            schoolBusArrived: d.schoolBusArrived, schoolBuses: d.schoolBuses, schoolBusPendingTask: d.schoolBusPendingTask };
        });
        observedSchoolBus ||= sample.transitRole === 'SCHOOL_BUS';
        if (i % 5 === 0) {
          await safe(f.host); progress.push({ episode, ...(await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }))) });
          await writeFile(info.outputPath('school-bus-progress.json'), JSON.stringify(progress, null, 2));
        }
        // Stop an observed cancelled/empty trip only after its scheduled ceremony
        // ended. Keep every physics step for a live bus or a walking child.
        if (isSchoolBusAttemptTerminal({ scheduledStartMs: start, before, current: sample, observedSchoolBus })
          || Number(sample.roadEventServerNow) >= deliveryStartedAt + 44_000 + 80_000
            && sample.transitRole !== 'SCHOOL_BUS' && Number(sample.schoolBusVisits) === 0 && sample.schoolBusPendingTask === '') break;
      }
      const state = await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      const witness=await f.host.evaluate(el=>{const w=(el as WitnessNode).__qaSchoolWitness!;return {dropoffs:w.dropoffs,invalid:w.invalid,truncated:w.truncated};});
      const dropoffs=witness.dropoffs.filter(d=>d.serverNow>=start&&d.alighted>Number(before.schoolBusAlighted));
      const deliveryElapsedMs = Number(state.roadEventServerNow) - deliveryStartedAt;
      journeys.push({ episode, taskId, deliveryBudgetMs, deliveryElapsedMs, before, state, witness,dropoffs });
      await writeFile(info.outputPath('school-bus-delivery-budget.json'), JSON.stringify(journeys, null, 2));
      expect(deliveryElapsedMs).toBeLessThanOrEqual(deliveryBudgetMs + 1000); await safe(f.host);
      if (Number(state.schoolBusArrived) > Number(before.schoolBusArrived)) {
        expect(witness.invalid).toBe(false);expect(witness.truncated).toBe(false);expect(dropoffs.length).toBeGreaterThan(0);
        const targets=new Set(dropoffs.map(d=>d.taskId));
        if(targets.size!==1){progress.push({episode,reason:'overlapping-doorway-targets',dropoffs});continue;}
        const destination=f.tasks.find(t=>targets.has(t.id));
        expect(destination).toBeTruthy();expect(BUILDING_CATALOG.find(b=>b.key===destination!.visualAssetKey)?.educationKind).toMatch(/^(SCHOOL|KINDERGARTEN)$/);
        expect(Number(state.schoolBusBoarded)).toBeGreaterThan(Number(before.schoolBusBoarded));
        expect(Number(state.schoolBusAlighted)).toBeGreaterThan(Number(before.schoolBusAlighted));
        expect(Number(state.schoolBusVisits)).toBeGreaterThan(0); deliveredTask = destination;
        await writeFile(info.outputPath('school-bus-doorway.json'), JSON.stringify({...state,witnessedSchoolTaskId:destination!.id,dropoffs}, null, 2));
      }
    }
    expect(deliveredTask, 'No child reached the real doorway in three scheduled school episodes').toBeTruthy();
    await page.screenshot({ path: info.outputPath('school-bus-doorway.png') });
    await f.service.activateDistrict(f.user.countryId, deliveredTask!.districtId, crypto.randomUUID());
    await f.call('task.delete', { taskId: deliveredTask!.id, confirmTitle: deliveredTask!.title }); await page.clock.runFor(500);
    // MCP and cooperative scene publication finish outside the paused clock.
    // Drive actual frames while keeping the original15s wall deadline.
    const deletionSamples:Record<string,string|undefined>[]=[];
    try{
      await expect.poll(async()=>{
        await page.clock.runFor(16);
        const state=await f.host.evaluate(el=>{
          const d=(el as HTMLElement).dataset;
          return {schoolBusVisits:d.schoolBusVisits,schoolBusArrived:d.schoolBusArrived,canonicalSnapshotPending:d.canonicalSnapshotPending,
            movementPreparing:d.movementPreparing,citySceneRevision:d.citySceneRevision,cinematicPhases:d.cinematicPhases,
            everydayTask:d.everydayTask,transitRole:d.transitRole,mobilityFixedSteps:d.mobilityFixedSteps};
        });
        deletionSamples.push(state);if(deletionSamples.length>16)deletionSamples.shift();return state.schoolBusVisits;
      },{timeout:15_000,intervals:[100]}).toBe('0');
    }finally{await writeFile(info.outputPath('school-deletion-state.json'),JSON.stringify(deletionSamples,null,2));}
    await safe(f.host);
  } catch (error) {
    await captureOwnedCityFailure(info, f.service, f.user.countryId, f.city.id); throw error;
  } finally { await f.cleanup(); }
});

test('authored sprite atlas uses the current revision and stays stable across zoom and compact resize', async ({ page }, info) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 1440, height: 1100 });
  // The production E2E server consumes the verified build. A separate CI job
  // can encode the same pixels differently from the checkout's source PNGs.
  const runtimeManifest = JSON.parse(readFileSync('dist/public/game-assets/v5/manifest.json', 'utf8')) as { assetRevision: string; propAtlas: { path: string } };
  const assetRevision = runtimeManifest.assetRevision;
  expect(assetRevision).toMatch(/^[a-f0-9]{16}$/);
  expect(runtimeManifest.propAtlas.path).toBe('atlas/props-v1.png');
  const errors: string[] = [], standalone: string[] = [], atlasHashes: string[] = [], scales: number[] = [];
  const atlasReads: Promise<void>[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/\/props\/[^/]+\.png/.test(r.url())) standalone.push(r.url()); });
  page.on('response', response => {
    if (response.url().includes(`/revisions/${assetRevision}/atlas/props-v1.png`) && response.ok())
      atlasReads.push(response.body().then(body => { atlasHashes.push(createHash('sha256').update(body).digest('hex')); })
        .catch(error => { errors.push(String(error)); }));
  });
  const expectedAtlas = createHash('sha256').update(readFileSync(`dist/public/game-assets/v5/${runtimeManifest.propAtlas.path}`)).digest('hex');
  const f = await everydayFixture(page);
  try {
    await f.focus(f.tasks[0]!);
    const bootstrap = await page.request.get('/api/bootstrap'); expect(bootstrap.ok()).toBe(true);
    expect(await bootstrap.json()).toMatchObject({ worldManifest: { assetRevision } });
    await expect.poll(() => atlasHashes).toContain(expectedAtlas);
    const canvas = page.locator('.world-canvas canvas');
    const zoom = async (delta: number, target: number, name: string) => {
      const box = (await canvas.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, delta);
      await expect.poll(async () => Number(await f.host.getAttribute('data-render-scale'))).toBeCloseTo(target, 2);
      await page.screenshot({ path: info.outputPath(`sprite-${name}.png`) });
      scales.push(Number(await f.host.getAttribute('data-render-scale'))); await safe(f.host);
      await expect(f.host).toHaveAttribute('data-resident-center-errors', '0');
    };
    await zoom(-1600, 4, 'maximum');
    await zoom(Math.log(4 / 1.6) / .0015, 1.6, 'normal');
    // At the lower wheel boundary the UI deliberately leaves CITY. A fresh
    // entry from PLANET sets the minimum; returning retains the prior camera.
    await f.open();
    await expect(f.host).toHaveAttribute('data-map-active', 'true');
    await expect.poll(async () => Number(await f.host.getAttribute('data-render-scale'))).toBeCloseTo(.8, 2);
    await page.screenshot({ path: info.outputPath('sprite-minimum.png') });
    scales.push(Number(await f.host.getAttribute('data-render-scale'))); await safe(f.host);
    await expect(f.host).toHaveAttribute('data-resident-center-errors', '0');
    await zoom(-1600, 4, 'return-maximum');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(f.host).toHaveAttribute('data-minimum-render-scale', '0.8');
    await page.screenshot({ path: info.outputPath('sprite-compact.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await safe(f.host); await Promise.all(atlasReads);
    await expect(f.host).toHaveAttribute('data-resident-center-errors', '0');
    expect(standalone).toEqual([]); expect(errors).toEqual([]);
    await writeFile(info.outputPath('sprite-projection-runtime.json'), JSON.stringify({ assetRevision, expectedAtlas, atlasHashes, scales, errors, standalone }, null, 2));
  } finally { await f.cleanup(); }
});

// A real public preference change must not cancel an accepted fresh opening.
test('an accepted school construction still opens after a public quality downgrade',async({page},info)=>{
  test.setTimeout(120_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const snapshots:Array<Record<string,unknown>>=[];
  const f=await everydayFixture(page);
  const capture=async(phase:string)=>{
    const data=await f.host.evaluate((el,finish)=>{
      if(finish)(el as HTMLElement & {__qaQualityWorkAction?:{observer:MutationObserver}}).__qaQualityWorkAction?.observer.disconnect();
      const d=(el as HTMLElement).dataset;
      return {worldQuality:d.worldQuality,frameLimit:d.frameLimit,citySceneCommit:d.citySceneCommit,
        cameraPresentationPending:d.cameraPresentationPending,cityCinematics:d.cityCinematics,
        cinematicPhases:d.cinematicPhases,cinematicWorkers:d.cinematicWorkers,cinematicState:d.cinematicState?.slice(0,6000),
        everydayEvent:d.everydayEvent,everydayTask:d.everydayTask,everydayEpisodeId:d.everydayEpisodeId,
        everydaySkip:d.everydaySkip,everydayAreaReady:d.everydayAreaReady,loadError:d.loadError,
        mobilityReady:d.mobilityReady,ambientAssets:d.ambientAssets};
    },phase==='finally');
    if(snapshots.length<6)snapshots.push({phase,...data});
    return data;
  };
  try{
    // Public task-link navigation already places this same school in view.
    // No pan, camera override, clock control or forced animation is needed.
    await f.focus(f.pendingSchool);
    await expect(f.host).toHaveAttribute('data-ambient-assets','ready');
    await expect(f.host).toHaveAttribute('data-camera-presentation-pending','false');
    await f.service.activateDistrict(f.user.countryId,f.pendingSchool.districtId,crypto.randomUUID());
    const preferences=page.locator('.map-toolbar-actions > nav > .world-preferences');
    await expect(preferences).toBeVisible();
    await preferences.locator(':scope > summary').click();
    const quality=preferences.getByLabel('Детализация');
    await expect(quality).toBeVisible();
    await quality.selectOption('NORMAL');
    await expect(f.host).toHaveAttribute('data-world-quality','NORMAL');
    await expect(preferences.getByLabel('Жизнь города')).toBeChecked();
    await expect(preferences.getByLabel('Уменьшить движение')).not.toBeChecked();
    // Arm before MCP; one browser callback witnesses real WORK and changes the public select.
    const hostNode=await f.host.elementHandle();if(!hostNode)throw new Error('Missing original public world host');
    try{await quality.evaluate((selectNode: Element, { hostNode, taskId }: { hostNode: Element; taskId: string }) => {
      if (!(selectNode instanceof HTMLSelectElement) || !(hostNode instanceof HTMLElement)) throw new Error('Expected real quality select and world host');
      const select = selectNode, host = hostNode as HTMLElement & { __qaQualityWorkAction?: { observer: MutationObserver; witness: Record<string, unknown> } };
      if (host.__qaQualityWorkAction) throw new Error('One work action owner is required');
      if (!select.isConnected || select.disabled || select.multiple || !select.getClientRects().length) throw new Error('Quality select must remain visible and enabled');
      const economy = [...select.options].find(option => option.value === 'ECONOMY');
      if (!economy || economy.disabled || select.value !== 'NORMAL' || host.dataset.worldQuality !== 'NORMAL') throw new Error('Expected initial public NORMAL and enabled ECONOMY option');
      const witness = { performed: false, performedPhase: null as string | null, changePhase: null as string | null,
        changeValue: null as string | null, changeEvents: 0, before: null as Record<string, string | undefined> | null, error: null as string | null };
      const snapshot = () => {
        const d = host.dataset;
        return { worldQuality: d.worldQuality, frameLimit: d.frameLimit, citySceneCommit: d.citySceneCommit,
          cameraPresentationPending: d.cameraPresentationPending, cityCinematics: d.cityCinematics,
          cinematicPhases: d.cinematicPhases, cinematicWorkers: d.cinematicWorkers, cinematicState: d.cinematicState?.slice(0, 6000),
          everydayEvent: d.everydayEvent, everydayTask: d.everydayTask, everydayEpisodeId: d.everydayEpisodeId,
          everydaySkip: d.everydaySkip, everydayAreaReady: d.everydayAreaReady, loadError: d.loadError,
          mobilityReady: d.mobilityReady, ambientAssets: d.ambientAssets };
      };
      const phase = () => {
        const state = (JSON.parse(host.dataset.cinematicState ?? '[]') as Array<{ taskId: string; kind: string; phase: string }>).
          find(value => value.taskId === taskId && value.kind === 'CONSTRUCT');
        return state ? `${taskId}:CONSTRUCT:${state.phase}` : null;
      };
      let acted = false;
      const observer = new MutationObserver(() => {
        if (acted) return;
        try {
          if (!host.isConnected || !select.isConnected || economy.parentElement !== select) throw new Error('The original public control was replaced');
          const currentPhase = phase();
          if (currentPhase !== `${taskId}:CONSTRUCT:WORK` || !(Number(host.dataset.cityCinematics) > 0) || !(Number(host.dataset.cinematicWorkers) > 0)) return;
          if (select.value !== 'NORMAL' || host.dataset.worldQuality !== 'NORMAL') throw new Error('WORK must still begin in public NORMAL');
          acted = true; observer.disconnect();
          witness.before = snapshot(); witness.performedPhase = currentPhase;
          const onChange = () => { witness.changeEvents++; witness.changePhase = phase(); witness.changeValue = select.value; };
          select.addEventListener('change', onChange, { capture: true, once: true });
          try {
            // Same public select operation/events as Playwright selectOptions, in this callback.
            select.value = ''; economy.selected = true;
            select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            witness.performed = true;
          } finally { select.removeEventListener('change', onChange, true); }
        } catch (error) { acted = true; observer.disconnect(); witness.error = String(error).slice(0, 400); }
      });
      host.__qaQualityWorkAction = { observer, witness };
      observer.observe(host, { attributes: true, attributeFilter: ['data-cinematic-state', 'data-cinematic-workers', 'data-city-cinematics'] });
    }, {hostNode,taskId:f.pendingSchool.id});}finally{await hostNode.dispose();}
    type WorkWitness={performed:boolean;performedPhase:string|null;changePhase:string|null;changeValue:string|null;changeEvents:number;before:Record<string,string|undefined>|null;error:string|null};
    const readAction=()=>f.host.evaluate(el=>(el as HTMLElement & {__qaQualityWorkAction?:{witness:WorkWitness}}).__qaQualityWorkAction?.witness);
    const key=crypto.randomUUID();
    await f.call('task.set_status',{taskId:f.pendingSchool.id,status:'COMPLETED'},key);
    const marker=`${f.pendingSchool.id}:CONSTRUCT:WORK`;
    await expect.poll(readAction).toMatchObject({performed:true,performedPhase:marker,changePhase:marker,changeValue:'ECONOMY',changeEvents:1,error:null});
    const beforeQuality=(await readAction())!.before!;
    if(snapshots.length<6)snapshots.push({phase:'accepted-normal-work',...beforeQuality});
    expect(beforeQuality.worldQuality).toBe('NORMAL');
    expect(beforeQuality.cinematicPhases).toContain(marker);
    expect(Number(beforeQuality.cityCinematics)).toBeGreaterThan(0);
    expect(Number(beforeQuality.cinematicWorkers)).toBeGreaterThan(0);
    await expect(f.host).toHaveAttribute('data-world-quality','ECONOMY');
    await capture('after-public-economy');
    expect((await f.service.getTask(f.user.countryId,f.pendingSchool.id)).stage).toBe(5);
    await expect(f.host).toHaveAttribute('data-everyday-event','OPEN_SCHOOL',{timeout:15_000});
    await expect(f.host).toHaveAttribute('data-everyday-task',f.pendingSchool.id);
    await expect(f.host).toHaveAttribute('data-city-cinematics','0');
    const episode=await f.host.getAttribute('data-everyday-episode-id');expect(episode).toBeTruthy();
    await capture('school-opened');
    await f.call('task.set_status',{taskId:f.pendingSchool.id,status:'COMPLETED'},key);
    await expect(f.host).toHaveAttribute('data-everyday-episode-id',episode!);
    await page.screenshot({path:info.outputPath('school-opening-after-quality-downgrade.png')});
    await page.reload();await openMapCity(page);
    await expect(f.host).toHaveAttribute('data-city-scene-commit','atomic',{timeout:30_000});
    await expect(f.host).toHaveAttribute('data-mobility-ready','true',{timeout:30_000});
    await expect(f.host).toHaveAttribute('data-ambient-assets','ready');
    await expect(f.host).toHaveAttribute('data-world-quality','ECONOMY');
    expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
    expect((await f.service.getTask(f.user.countryId,f.pendingSchool.id)).stage).toBe(5);
    expect(errors).toEqual([]);
  }finally{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([capture('finally'),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Final public read exceeded1000ms')),1000);})]);}
    catch(error){if(snapshots.length<6)snapshots.push({phase:'finally',unavailable:String(error).slice(0,400)});}
    finally{if(timer)clearTimeout(timer);}
    await info.attach('quality-opening-public-states',{body:JSON.stringify({snapshots,errors,maximumSnapshots:6,taskId:f.pendingSchool.id}),contentType:'application/json'}).catch(()=>{});
    await f.cleanup();
  }
});
