import { expect, test, type Page, type Locator } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { everydayFixture } from './everyday-city-fixture';
import { ASSET_REVISION, BUILDING_CATALOG } from '../../src/shared/catalog';
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
    const data = await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset }));
    await writeFile(info.outputPath('initial-state.json'), JSON.stringify(data, null, 2));
    await page.screenshot({ path: info.outputPath('everyday-native-city.png') });
    expect(data.everydayKinds?.split(',')).toEqual(expect.arrayContaining(['SCHOOL', 'KINDERGARTEN', 'MARKET', 'SPORT', 'DOG', 'BIRDS']));
    expect(Number(data.transitStops)).toBeGreaterThanOrEqual(2);
    expect(f.tasks.filter(t => BUILDING_CATALOG.find(b => b.key === t.visualAssetKey)?.educationKind && t.stage === 5)).toHaveLength(6);
    expect(forbidden).toEqual([]); expect(errors).toEqual([]);
  } finally { await f.cleanup(); }
});

test('fresh MCP completions open every institution after the construction reveal and never replay on reload', async ({ page }, info) => {
  test.setTimeout(160000); const f = await everydayFixture(page), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await f.focus(f.pendingSchool);
    const shop = f.tasks.find(t => t.stage === 4 && BUILDING_CATALOG.find(b => b.key === t.visualAssetKey)?.serviceRole === 'SHOP')!;
    const fire = f.tasks.find(t => t.stage === 4 && BUILDING_CATALOG.find(b => b.key === t.visualAssetKey)?.serviceRole === 'FIRE')!;
    for (const [task, kind] of [[f.pendingSchool, 'OPEN_SCHOOL'], [f.pendingKindergarten, 'OPEN_KINDERGARTEN'], [shop, 'OPEN_SHOP'], [fire, 'OPEN_FIRE'], [f.pendingHome, 'OPEN_BUILDING']] as const) {
      await f.service.activateDistrict(f.user.countryId, task.districtId, crypto.randomUUID());
      await f.panFocus(task);
      const key = crypto.randomUUID(); await f.call('task.set_status', { taskId: task.id, status: 'COMPLETED' }, key);
      await expect(f.host).toHaveAttribute('data-cinematic-phases', /CONSTRUCT:WORK/);
      await expect(f.host).toHaveAttribute('data-everyday-event', kind, { timeout: 15000 });
      await expect(f.host).toHaveAttribute('data-city-cinematics', '0');
      const episode = await f.host.getAttribute('data-everyday-episode-id');
      await f.call('task.set_status', { taskId: task.id, status: 'COMPLETED' }, key);
      await expect(f.host).toHaveAttribute('data-everyday-episode-id', episode!);
      await page.screenshot({ path: info.outputPath(`${kind.toLowerCase()}.png`) });
      await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(f.host).toHaveAttribute('data-everyday-event', '');
      await expect(f.host).toHaveAttribute('data-transit-passengers', '0');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    const home = await f.service.getTask(f.user.countryId, f.pendingHome.id); await f.panFocus(home);
    // Hold the real post-transfer scene beyond the original carry window.
    // The renderer must resume a flight instead of jumping from lift to land.
    const scenePattern = /\/api\/countries\/[^/]+\/cities\/[^/]+\/scene(?:\?|$)/;
    let releaseScene!: () => void, delayedScene = false;
    const sceneGate = new Promise<void>(resolve => { releaseScene = resolve; });
    await page.route(scenePattern, async route => {
      const response = await route.fetch(); delayedScene = true; await sceneGate; await route.fulfill({ response });
    });
    const transferStarted = performance.now();
    try {
      await f.call('task.transfer', { taskId: home.id, targetDistrictId: f.pendingSchool.districtId });
      await expect(f.host).toHaveAttribute('data-cinematic-phases', /TRANSFER:LIFT/);
      await page.waitForTimeout(Math.max(0, 4500 - (performance.now() - transferStarted)));
      expect(delayedScene).toBe(true); releaseScene();
      await expect(f.host).toHaveAttribute('data-cinematic-phases', /TRANSFER:CARRY/);
    } finally { releaseScene(); await page.unroute(scenePattern); }
    await expect(f.host).toHaveAttribute('data-city-cinematics', '0', { timeout: 10000 });
    expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
    await page.reload(); await openMapCity(page); await expect(f.host).toHaveAttribute('data-city-scene-commit', 'atomic', { timeout: 30000 });
    expect(await f.host.getAttribute('data-everyday-event')).not.toMatch(/^OPEN_/);
    expect(errors).toEqual([]);
  } finally { await f.cleanup(); }
});

clockSceneTest('tow loading and water repair wait for actual service arrivals, drive and reopen safely', async ({ page }, info) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1440, height: 1100 }); await installSceneClock(page);
  const f = await everydayFixture(page), seen = new Set<string>(), evidence: Record<string, unknown>[] = [];
  try {
    await f.focus(f.tasks[0]!); await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 2000).toISOString()));
    for (let attempt = 0; attempt < 9 && seen.size < 2; attempt++) {
      const next = Number(await f.host.getAttribute('data-road-event-next-start')); await seek(page, f.host, next + 300);
      const kind = (await f.host.getAttribute('data-road-event'))!;
      const startedAt = Number(await f.host.getAttribute('data-road-event-server-now'));
      if (!['BREAKDOWN', 'WATER'].includes(kind)) { await page.clock.fastForward(35000); await page.clock.runFor(100); continue; }
      expect(await f.host.getAttribute('data-road-service-arrived')).toBe('false');
      expect(await f.host.getAttribute('data-road-cargo-loaded')).toBe('false');
      expect(Number(await f.host.getAttribute('data-road-closed-cells'))).toBe(3);
      let arrived = false, loaded = false;
      for (let i = 0; i < 31; i++) {
        await page.clock.runFor(1000); const state = await safe(f.host);
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
    expect(seen).toEqual(new Set(['BREAKDOWN', 'WATER']));
    await writeFile(info.outputPath('road-service-arrivals.json'), JSON.stringify(evidence, null, 2));
  } finally { await f.cleanup(); }
});

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
    for (let attempt = 0; attempt < 36 && seen.size < 6; attempt++) {
      const start = (Math.floor(Number(await f.host.getAttribute('data-road-event-server-now')) / 75_000) + 1) * 75_000 + 8000;
      await seek(page, f.host, start - 2000); await setSceneLife(page, true);
      const id = await f.host.getAttribute('data-everyday-planned-task'), task = f.tasks.find(t => t.id === id);
      expect(task, `No planned task ${id}`).toBeTruthy(); await f.panFocus(task!, true);
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
        await page.clock.runFor(2000);
        for (let i = 0; i < 30 && Number(await f.host.getAttribute('data-transit-passengers')) > 0; i++) await page.clock.runFor(1000);
        await expect(f.host).toHaveAttribute('data-transit-passengers', '0');
        await writeFile(info.outputPath('everyday-unavailable-slots.json'), JSON.stringify(unavailable, null, 2));
        await safe(f.host); continue;
      }
      expect(visitors).toBeGreaterThan(0);
      let arrivals = 0, animals = 0, fetched = false, scattered = false;
      for (let i = 0; i < 16; i++) {
        await page.clock.runFor(2000); const state = await safe(f.host);
        arrivals = Math.max(arrivals, Number(state.everydayArrived));
        animals = Math.max(animals, Number(state.everydayAnimals));
        fetched ||= state.dogCarrying === 'true'; scattered ||= state.birdsScattered === 'true';
        if (i === 8) await page.screenshot({ path: info.outputPath(`everyday-${kind!.toLowerCase()}.png`) });
      }
      await writeFile(info.outputPath(`everyday-${kind!.toLowerCase()}-observation.json`), JSON.stringify({ arrivals, animals, fetched, scattered, state: await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })) }, null, 2));
      if (!arrivals) await writeFile(info.outputPath('missing-arrival.json'), JSON.stringify(await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })), null, 2));
      expect(arrivals, `${kind} residents never arrived`).toBeGreaterThan(0);
      if (kind === 'DOG' || kind === 'BIRDS') expect(animals).toBeGreaterThan(0);
      if (kind === 'DOG') expect(fetched).toBe(true);
      seen.add(kind!);
      samples.push({ kind, arrivals, animals, fetched, scattered, state: await f.host.evaluate(el => ({ ...(el as HTMLElement).dataset })) });
      await writeFile(info.outputPath('everyday-scenes-progress.json'), JSON.stringify(samples, null, 2));
      await page.clock.runFor(14000); await seek(page, f.host, start + 44_200);
      await expect(f.host).toHaveAttribute('data-everyday-event', '');
      await setSceneLife(page, false);
      // Cancellation must finish real carrier motion before skipping the next
      // dead interval; synthetic epoch jumps cannot evacuate a physical body.
      for (let i = 0; i < 30 && Number(await f.host.getAttribute('data-transit-passengers')) > 0; i++) await page.clock.runFor(1000);
      await expect(f.host).toHaveAttribute('data-transit-passengers', '0'); await safe(f.host);
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
    await f.focus(f.pendingSchool); await f.service.activateDistrict(f.user.countryId, f.pendingSchool.districtId, crypto.randomUUID());
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
  const errors: string[] = [], standalone: string[] = [], atlasHashes: string[] = [], scales: number[] = [];
  const atlasReads: Promise<void>[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/\/props\/[^/]+\.png/.test(r.url())) standalone.push(r.url()); });
  page.on('response', response => {
    if (response.url().includes(`/revisions/${ASSET_REVISION}/atlas/props-v1.png`) && response.ok())
      atlasReads.push(response.body().then(body => { atlasHashes.push(createHash('sha256').update(body).digest('hex')); })
        .catch(error => { errors.push(String(error)); }));
  });
  const expectedAtlas = createHash('sha256').update(readFileSync('public/game-assets/v5/atlas/props-v1.png')).digest('hex');
  const f = await everydayFixture(page);
  try {
    await f.focus(f.tasks[0]!);
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
    await writeFile(info.outputPath('sprite-projection-runtime.json'), JSON.stringify({ assetRevision: ASSET_REVISION, expectedAtlas, atlasHashes, scales, errors, standalone }, null, 2));
  } finally { await f.cleanup(); }
});
