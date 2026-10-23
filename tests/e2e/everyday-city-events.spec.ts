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
      const key = crypto.randomUUID(); await f.call('task.set_status', { taskId: task.id, status: 'COMPLETED' }, key);
      await expect(f.host).toHaveAttribute('data-cinematic-phases', /CONSTRUCT:WORK/);
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

test('delayed MCP transfer resumes a helicopter carry without replaying an opening on reload', async ({ page }, info) => {
  test.setTimeout(90000); const f = await everydayFixture(page), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await f.focus(f.pendingSchool);
    await expect(f.host).toHaveAttribute('data-ambient-assets', 'ready');
    // This isolated transfer still starts with a genuinely completed home.
    await f.service.activateDistrict(f.user.countryId, f.pendingHome.districtId, crypto.randomUUID());
    await f.panFocus(f.pendingHome);
    await f.call('task.set_status', { taskId: f.pendingHome.id, status: 'COMPLETED' });
    await expect(f.host).toHaveAttribute('data-cinematic-phases', /CONSTRUCT:WORK/);
    await expect(f.host).toHaveAttribute('data-everyday-event', 'OPEN_BUILDING', { timeout: 15000 });
    await expect(f.host).toHaveAttribute('data-city-cinematics', '0');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(f.host).toHaveAttribute('data-everyday-event', '');
    await expect(f.host).toHaveAttribute('data-everyday-visitors', '0');
    await expect(f.host).toHaveAttribute('data-transit-role', '');
    await expect(f.host).toHaveAttribute('data-transit-phase', '');
    await expect(f.host).toHaveAttribute('data-transit-vehicle', '');
    await expect(f.host).toHaveAttribute('data-animation-active', 'false');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const home = await f.service.getTask(f.user.countryId, f.pendingHome.id); expect(home.stage).toBe(5); await f.panFocus(home);
    // Hold the real post-transfer scene beyond the original carry window.
    // The renderer must resume a flight instead of jumping from lift to land.
    const scenePattern = /\/api\/countries\/[^/]+\/cities\/[^/]+\/scene(?:\?|$)/;
    let releaseScene!: () => void, delayedScene = false;
    const sceneGate = new Promise<void>(resolve => { releaseScene = resolve; });
    await page.route(scenePattern, async route => {
      const response = await route.fetch(); delayedScene = true; await sceneGate; await route.fulfill({ response });
    });
    const cinematicFrames=await observeCinematics(f.host);
    const transferStarted = performance.now();
    try {
      await f.call('task.transfer', { taskId: home.id, targetDistrictId: f.pendingSchool.districtId });
      await expect(f.host).toHaveAttribute('data-cinematic-phases', /TRANSFER:LIFT/);
      await page.waitForTimeout(Math.max(0, 4500 - (performance.now() - transferStarted)));
      expect(delayedScene).toBe(true); releaseScene();
      await expect.poll(async()=> (await cinematicFrames.frames()).some(frame=>frame.states.some(state=>state.taskId===home.id&&state.kind==='TRANSFER'&&state.phase==='CARRY'&&state.oldVisible&&!state.targetVisible&&state.aircraftVisible))).toBe(true);
    } finally { await writeFile(info.outputPath('delayed-transfer-frames.json'),JSON.stringify(await cinematicFrames.frames(),null,2));releaseScene(); await page.unroute(scenePattern); }
    await expect(f.host).toHaveAttribute('data-city-cinematics', '0', { timeout: 10000 });
    expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
    await page.reload(); await openMapCity(page); await expect(f.host).toHaveAttribute('data-city-scene-commit', 'atomic', { timeout: 30000 });
    expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
    expect(errors).toEqual([]);
  } finally { await f.cleanup(); }
});

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
    const f = await everydayFixture(page), seen = new Set<string>(), evidence: Record<string, unknown>[] = [], frames: Record<string, unknown>[] = [];
    try {
      await f.focus(f.tasks[0]!); await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
      for (let attempt = 0; attempt < 9 && seen.size < 1; attempt++) {
        const next = Number(await f.host.getAttribute('data-road-event-next-start')); await seek(page, f.host, next + 300);
        const kind = (await f.host.getAttribute('data-road-event'))!;
        const startedAt = Number(await f.host.getAttribute('data-road-event-server-now'));
        if (kind !== targetKind) { await page.clock.fastForward(35000); await page.clock.runFor(100); continue; }
        expect(await f.host.getAttribute('data-road-service-arrived')).toBe('false');
        expect(await f.host.getAttribute('data-road-cargo-loaded')).toBe('false');
        expect(Number(await f.host.getAttribute('data-road-closed-cells'))).toBe(3);
        let arrived = false, loaded = false;
        for (let i = 0; i < 31; i++) {
          await page.clock.runFor(1000); const state = await safe(f.host);
          if (frames.length < 31) frames.push({ step: i + 1, startedAt, serverNow: state.roadEventServerNow,
            kind: state.roadEvent, phase: state.roadEventPhase, arrived: state.roadServiceArrived, loaded: state.roadCargoLoaded,
            closedCells: state.roadClosedCells, responders: state.roadResponders, trips: state.roadResponseTrips,
            fixedSteps: state.mobilityFixedSteps, safety: [state.mobilityVehicleUnsafeTotal, state.mobilityPedestrianUnsafeTotal,
              state.mobilityVehiclePedestrianUnsafeTotal, state.wrongWayCars, state.walkerOffPath] });
          arrived ||= state.roadServiceArrived === 'true';
          loaded ||= state.roadCargoLoaded === 'true';
          if (i === 12 || kind === 'BREAKDOWN' && loaded && i === 18) await page.screenshot({ path: info.outputPath(`${kind.toLowerCase()}-${i}.png`) });
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
      try { await info.attach(`${targetKind.toLowerCase()}-service-frames`, { body: JSON.stringify({ targetKind, frames, evidence }), contentType: 'application/json' }); }
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
    await page.clock.fastForward(Math.max(50, target - now)); await page.clock.runFor(100);
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
type EverydayObservedNode=HTMLElement&{__qaEveryday?:{arrivals:number;animals:number;fetched:boolean;scattered:boolean;samples:EverydaySample[];observer:MutationObserver}};
async function observeEveryday(host:Locator,taskId:string){
  await host.evaluate((el,taskId)=>{
    const node=el as EverydayObservedNode;node.__qaEveryday?.observer.disconnect();
    let signature='';
    const read=()=>{const d=node.dataset,record=node.__qaEveryday!;if(d.everydayTask!==taskId||!d.everydayEvent)return;
      record.arrivals=Math.max(record.arrivals,Number(d.everydayArrived??0));record.animals=Math.max(record.animals,Number(d.everydayAnimals??0));
      record.fetched||=d.dogCarrying==='true';record.scattered||=d.birdsScattered==='true';
      const sample={kind:d.everydayEvent,phase:d.everydayPhase??'',areaReady:d.everydayAreaReady==='true',
        arrivals:Number(d.everydayArrived??0),animals:Number(d.everydayAnimals??0),fetched:d.dogCarrying==='true',scattered:d.birdsScattered==='true'};
      const next=JSON.stringify(sample);
      if(next!==signature){signature=next;record.samples.push({...sample,serverNow:Number(d.roadEventServerNow)});if(record.samples.length>64)record.samples.shift();}
    };
    const observer=new MutationObserver(read);
    node.__qaEveryday={arrivals:0,animals:0,fetched:false,scattered:false,samples:[],observer};
    observer.observe(node,{attributes:true,attributeFilter:['data-everyday-event','data-everyday-phase','data-everyday-area-ready','data-everyday-arrived','data-everyday-animals','data-dog-carrying','data-birds-scattered']});
    read();
  },taskId);
  return ()=>host.evaluate(el=>{const r=(el as EverydayObservedNode).__qaEveryday!;return {arrivals:r.arrivals,animals:r.animals,fetched:r.fetched,scattered:r.scattered,samples:r.samples};});
}

clockSceneTest('six everyday scenes use actual residents and approaches', async ({ page }, info) => {
  test.setTimeout(720000); await page.setViewportSize({ width: 1440, height: 1100 }); await installSceneClock(page);
  const f = await everydayFixture(page), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const seen = new Set<string>(), samples: Record<string, unknown>[] = [], unavailable: Record<string, unknown>[] = [];
  try {
    await f.focus(f.tasks[0]!);
    await page.locator('.world-menu > summary').click();
    const prefs = page.locator('.world-preferences:visible'); await prefs.locator('> summary').click();
    await prefs.getByLabel('Детализация').selectOption('NORMAL');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
    await setSceneLife(page, false);
    const drainCarriers=async()=>{
      await page.clock.runFor(2000);
      for(let i=0;i<30&&Number(await f.host.getAttribute('data-transit-passengers'))>0;i++)await page.clock.runFor(1000);
      await expect(f.host).toHaveAttribute('data-transit-passengers','0');await safe(f.host);
    };
    for (let attempt = 0; attempt < 36 && seen.size < 6; attempt++) {
      const start = (Math.floor(Number(await f.host.getAttribute('data-road-event-server-now')) / 75_000) + 1) * 75_000 + 8000;
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
        await setSceneLife(page,false);await drainCarriers();continue;
      }
      const id = preparation.everydayPlannedTask, task = f.tasks.find(t => t.id === id);
      expect(task, `No planned task ${id}`).toBeTruthy(); await f.panFocus(task!, true, { settlePausedBefore: start });
      const observed=await observeEveryday(f.host,id!);
      await seek(page, f.host, start + 350); await page.clock.runFor(1000);
      const kind = await f.host.getAttribute('data-everyday-event');
      if (!kind) await writeFile(info.outputPath('missing-scene.json'), JSON.stringify({ start, task, data: await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })) }, null, 2));
      expect(kind).toBeTruthy();
      const visitors = Number(await f.host.getAttribute('data-everyday-visitors'));
      // A calendar slot can choose a campus without reachable idle children.
      // Try a later real slot, as the school-bus test does; each of the six
      // kinds still must complete with actual visitors and physical arrivals.
      if (seen.has(kind!) || visitors === 0) {
        if (visitors === 0) unavailable.push({ kind, taskId: id, reason: 'no-reachable-idle-residents' });
        await setSceneLife(page, false); await seek(page, f.host, start + 44_200);
        await drainCarriers();
        await writeFile(info.outputPath('everyday-unavailable-slots.json'), JSON.stringify(unavailable, null, 2));
        await safe(f.host); continue;
      }
      expect(visitors).toBeGreaterThan(0);
      let arrivals = 0, animals = 0, fetched = false, scattered = false;
      // Include the final arrivals before LEAVE; a 32-second prefix can miss
      // a real arrival near the end of the 34-second approach/activity period.
      for (let i = 0; i < 20; i++) {
        await page.clock.runFor(2000); const state = await safe(f.host);
        arrivals = Math.max(arrivals, Number(state.everydayArrived));
        animals = Math.max(animals, Number(state.everydayAnimals));
        fetched ||= state.dogCarrying === 'true'; scattered ||= state.birdsScattered === 'true';
        if (i === 8) await page.screenshot({ path: info.outputPath(`everyday-${kind!.toLowerCase()}.png`) });
      }
      const actualFrames=await observed();arrivals=Math.max(arrivals,actualFrames.arrivals);animals=Math.max(animals,actualFrames.animals);
      fetched||=actualFrames.fetched;scattered||=actualFrames.scattered;
      await writeFile(info.outputPath(`everyday-${kind!.toLowerCase()}-observation.json`), JSON.stringify({ arrivals, animals, fetched, scattered, observed:actualFrames, state: await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })) }, null, 2));
      if (!arrivals) await writeFile(info.outputPath('missing-arrival.json'), JSON.stringify(await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })), null, 2));
      expect(arrivals, `${kind} residents never arrived`).toBeGreaterThan(0);
      if (kind === 'DOG' || kind === 'BIRDS') expect(animals).toBeGreaterThan(0);
      if (kind === 'DOG') expect(fetched).toBe(true);
      seen.add(kind!);
      samples.push({ kind, arrivals, animals, fetched, scattered, state: await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })) });
      await writeFile(info.outputPath('everyday-scenes-progress.json'), JSON.stringify(samples, null, 2));
      // Complete the real physical steps only until the published event end.
      // A fixed extra14s kept rendering after expiry and exhausted WebKit's
      // aggregate wall budget after all six arrivals had already passed.
      for (let step = 0; step < 14 && Number(await f.host.getAttribute('data-road-event-server-now')) < start + 44_200; step++) {
        await page.clock.runFor(1000); await safe(f.host);
      }
      await seek(page, f.host, start + 44_200);
      await expect(f.host).toHaveAttribute('data-everyday-event', '');
      await setSceneLife(page, false);
      // Cancellation must finish real carrier motion before skipping the next
      // dead interval; synthetic epoch jumps cannot evacuate a physical body.
      await drainCarriers();
    }
    expect(seen).toEqual(new Set(['SCHOOL', 'KINDERGARTEN', 'MARKET', 'SPORT', 'DOG', 'BIRDS']));
    expect(Number(await f.host.getAttribute('data-school-buses'))).toBeGreaterThan(0);
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
    await page.context().setOffline(true); await page.waitForTimeout(1200); await page.context().setOffline(false);
    await expect(f.host).toHaveAttribute('data-everyday-event', '', { timeout: 20000 });
    await f.panFocus(f.pendingHome); await f.service.activateDistrict(f.user.countryId, f.pendingHome.districtId, crypto.randomUUID());
    await f.call('task.set_status', { taskId: f.pendingHome.id, status: 'COMPLETED' });
    await expect(f.host).toHaveAttribute('data-everyday-event', 'OPEN_BUILDING', { timeout: 15000 });
    await f.call('task.delete', { taskId: f.pendingHome.id, confirmTitle: f.pendingHome.title });
    await expect(f.host).toHaveAttribute('data-everyday-event', '');
    await expect(f.host).toHaveAttribute('data-city-cinematics', '0', { timeout: 10000 });
    expect((await f.service.listTasks(f.user.countryId)).some(task => task.id === f.pendingHome.id)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.context().setOffline(false); await f.cleanup(); }
});


clockSceneTest('public bus completes an actual boarding, directed trip and safe alighting', async ({ page }, info) => {
  test.setTimeout(210000); await installSceneClock(page); const f = await everydayFixture(page);
  try {
    await f.focus(f.tasks[0]!); await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
    const now = Number(await f.host.getAttribute('data-road-event-server-now'));
    // This minute starts30s into a road window; an80s physical trip can be
    // observed before the next roadside scene preempts the bus.
    let minute = Math.floor(now / 60000) + 1; while (minute % 3 !== 2 || ![30_000, 390_000].includes(minute * 60_000 % 450_000)) minute++;
    await seek(page, f.host, minute * 60000 + 300);
    const phases = new Set<string>();
    for (let i = 0; i < 80 && Number(await f.host.getAttribute('data-transit-alighted')) === 0; i++) {
      await page.clock.runFor(1000); phases.add((await f.host.getAttribute('data-transit-phase'))!);
      if (i % 5 === 0) await safe(f.host);
    }
    const state = await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
    await writeFile(info.outputPath('bus-round-trip.json'), JSON.stringify({ phases: [...phases], state }, null, 2));
    expect(Number(state.transitBoarded)).toBeGreaterThan(0); expect(Number(state.transitAlighted)).toBeGreaterThan(0);
    expect([...phases]).toEqual(expect.arrayContaining(['ARRIVE', 'BOARD', 'TRAVEL', 'ALIGHT']));
    await safe(f.host); await page.screenshot({ path: info.outputPath('bus-alighting.png') });
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
    await f.focus(f.tasks[0]!); await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
    const kinds = (await f.host.getAttribute('data-everyday-kinds'))!.split(',').sort();
    // Ordinary traffic can delay passengers beyond a finite boarding window.
    // Exercise up to three scheduled ceremonies in the same live city, recording
    // empty/cancelled trips too; never replace a real doorway arrival with a lease.
    const deliveryBudgetMs = 44_000 + 80_000 + 60_000;
    const journeys: Record<string, unknown>[] = [], progress: Record<string, unknown>[] = [];
    let deliveredTask: typeof f.tasks[number] | undefined;
    for (let episode = 0; episode < 3 && !deliveredTask; episode++) {
      let window = Math.floor(Number(await f.host.getAttribute('data-road-event-server-now')) / 75_000) + 1;
      while (window % kinds.length !== kinds.indexOf('SCHOOL')) window++;
      const start = window * 75_000 + 8000;
      // Skip synthetic dead time with life disabled, preserving physical poses.
      // Clock jumps must not strand unrelated historical passengers.
      await setSceneLife(page, false); await seek(page, f.host, start - 2000); await setSceneLife(page, true);
      await expect(f.host).toHaveAttribute('data-everyday-planned-kind', 'SCHOOL');
      const taskId = await f.host.getAttribute('data-everyday-planned-task'), task = f.tasks.find(t => t.id === taskId);
      expect(task).toBeTruthy(); await f.panFocus(task!, true);
      await seek(page, f.host, Number(await f.host.getAttribute('data-everyday-next-start')) + 300);
      await expect(f.host).toHaveAttribute('data-everyday-event', 'SCHOOL');
      const deliveryStartedAt = Number(await f.host.getAttribute('data-road-event-server-now'));
      const before = await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      for (let i = 0; i < deliveryBudgetMs / 1000 && Number(await f.host.getAttribute('data-school-bus-arrived')) === Number(before.schoolBusArrived); i++) {
        await page.clock.runFor(1000);
        if (i % 5 === 0) {
          await safe(f.host); progress.push({ episode, ...(await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }))) });
          await writeFile(info.outputPath('school-bus-progress.json'), JSON.stringify(progress, null, 2));
        }
        // Once both the ceremony and possible bus run have expired, a trip
        // without a school visit cannot become a doorway arrival later.
        if (i >= (44_000 + 80_000) / 1000 && await f.host.getAttribute('data-transit-role') !== 'SCHOOL_BUS'
          && Number(await f.host.getAttribute('data-school-bus-visits')) === 0) break;
      }
      const state = await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
      const deliveryElapsedMs = Number(state.roadEventServerNow) - deliveryStartedAt;
      journeys.push({ episode, taskId, deliveryBudgetMs, deliveryElapsedMs, before, state });
      await writeFile(info.outputPath('school-bus-delivery-budget.json'), JSON.stringify(journeys, null, 2));
      expect(deliveryElapsedMs).toBeLessThanOrEqual(deliveryBudgetMs + 1000); await safe(f.host);
      if (Number(state.schoolBusArrived) > Number(before.schoolBusArrived)) {
        expect(Number(state.schoolBusBoarded)).toBeGreaterThan(Number(before.schoolBusBoarded));
        expect(Number(state.schoolBusAlighted)).toBeGreaterThan(Number(before.schoolBusAlighted));
        expect(Number(state.schoolBusVisits)).toBeGreaterThan(0); deliveredTask = task;
        await writeFile(info.outputPath('school-bus-doorway.json'), JSON.stringify(state, null, 2));
      }
    }
    expect(deliveredTask, 'No child reached the real doorway in three scheduled school episodes').toBeTruthy();
    await page.screenshot({ path: info.outputPath('school-bus-doorway.png') });
    await f.service.activateDistrict(f.user.countryId, deliveredTask!.districtId, crypto.randomUUID());
    await f.call('task.delete', { taskId: deliveredTask!.id, confirmTitle: deliveredTask!.title }); await page.clock.runFor(500);
    await expect(f.host).toHaveAttribute('data-school-bus-visits', '0'); await safe(f.host);
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
    const data=await f.host.evaluate(el=>{
      const d=(el as HTMLElement).dataset;
      return {worldQuality:d.worldQuality,frameLimit:d.frameLimit,citySceneCommit:d.citySceneCommit,
        cameraPresentationPending:d.cameraPresentationPending,cityCinematics:d.cityCinematics,
        cinematicPhases:d.cinematicPhases,cinematicWorkers:d.cinematicWorkers,cinematicState:d.cinematicState?.slice(0,6000),
        everydayEvent:d.everydayEvent,everydayTask:d.everydayTask,everydayEpisodeId:d.everydayEpisodeId,
        everydaySkip:d.everydaySkip,everydayAreaReady:d.everydayAreaReady,loadError:d.loadError,
        mobilityReady:d.mobilityReady,ambientAssets:d.ambientAssets};
    });
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
    const key=crypto.randomUUID();
    await f.call('task.set_status',{taskId:f.pendingSchool.id,status:'COMPLETED'},key);
    await expect(f.host).toHaveAttribute('data-cinematic-phases',new RegExp(`${f.pendingSchool.id}:CONSTRUCT:WORK`));
    const beforeQuality=await capture('accepted-normal-work');
    expect(beforeQuality.cinematicPhases).toContain(`${f.pendingSchool.id}:CONSTRUCT:WORK`);
    expect(Number(beforeQuality.cityCinematics)).toBeGreaterThan(0);
    // The preferences panel is already open, so no navigation action races the shot.
    await quality.selectOption('ECONOMY');
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
