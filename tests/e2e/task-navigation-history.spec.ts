import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { BootstrapDto } from '../../src/shared/contracts';
import type { TaskCardDto, TaskListPageDto } from '../../src/shared/task-read-contracts';
import { openMapCity } from './map-navigation';

async function fixture(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo' } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json() as BootstrapDto;
  const list = await (await page.request.get(`/api/tasks/list-page?countryId=${bootstrap.country.id}&limit=2`)).json() as TaskListPageDto;
  const [a, b] = list.items;
  const card = await (await page.request.get(`/api/tasks/${a.id}/card?countryId=${bootstrap.country.id}`)).json() as TaskCardDto;
  await page.route(`**/api/tasks/${a.id}/card?*`, route => route.fulfill({ json: { ...card, counts: { ...card.counts, dependencies: 1 } } }));
  await page.route(`**/api/tasks/${a.id}/collections/dependencies?*`, route => route.fulfill({ json: {
    kind: 'task.collection-page', version: 1, countryId: bootstrap.country.id, taskId: a.id, collection: 'dependencies',
    items: [{ id: b.id, taskNumber: b.taskNumber, title: b.title, status: b.status }], nextCursor: null,
  } }));
  return { bootstrap, a, b };
}

test('task A → dependency B → browser Back/Forward restores the city camera without rereading geography', async ({ page }, info) => {
  const { a, b } = await fixture(page), errors: string[] = [], sceneReads: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/\/scene(?:\?|$)/.test(request.url())) sceneReads.push(request.url()); });
  await page.goto('/'); await openMapCity(page);
  const world = page.locator('.world-canvas'); await expect(world).toHaveAttribute('data-city-scene-commit', 'atomic');
  await world.locator('canvas').focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => history.state?.view?.cityView?.center?.x)).toBeTruthy();
  const pose = await page.evaluate(() => history.state.view.cityView) as { center: { x: number; y: number }; scale: number };
  const search = page.getByRole('combobox', { name: 'Поиск здания по номеру или названию' });
  await search.fill(`#${a.taskNumber}`); await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1); await search.press('Enter');
  await expect(page.locator('#task-title')).toHaveText(a.title); await expect(page).toHaveURL(new RegExp(`/task/${a.taskNumber}\\?`));
  await page.getByRole('link', { name: `#${b.taskNumber} · ${b.title}`, exact: true }).click();
  await expect(page.locator('#task-title')).toHaveText(b.title); await expect(page).toHaveURL(new RegExp(`/task/${b.taskNumber}\\?`));
  await page.goBack(); await expect(page.locator('#task-title')).toHaveText(a.title);
  await page.goBack(); await expect(page.locator('.task-modal')).toHaveCount(0);
  await expect.poll(async () => {
    const x = Number(await world.getAttribute('data-camera-world-x')), y = Number(await world.getAttribute('data-camera-world-y'));
    return Math.abs(x - pose.center.x) < .3 && Math.abs(y - pose.center.y) < .3;
  }).toBe(true);
  await page.goForward(); await expect(page.locator('#task-title')).toHaveText(a.title);
  await page.goForward(); await expect(page.locator('#task-title')).toHaveText(b.title);
  expect(sceneReads).toHaveLength(1); expect(errors).toEqual([]);
  await info.attach('navigation', { body: Buffer.from(JSON.stringify({ pose, sceneReads, errors })), contentType: 'application/json' });
});

test('Back cancels a pending dependency card and its late response cannot reopen it', async ({ page }) => {
  const { bootstrap, a, b } = await fixture(page);
  let release!: () => void, started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/tasks/${b.id}/card?*`, async route => { started = true; await gate; await route.continue().catch(() => undefined); });
  await page.goto(`/task/${a.taskNumber}?countryId=${bootstrap.country.id}&taskId=${a.id}`);
  await expect(page.locator('#task-title')).toHaveText(a.title);
  await page.getByRole('link', { name: `#${b.taskNumber} · ${b.title}`, exact: true }).click();
  await expect.poll(() => started).toBe(true); await expect(page.getByRole('status')).toContainText('Загружаем задачу');
  await expect(page).toHaveURL(new RegExp(`taskId=${b.id}`));
  await page.goBack(); await expect(page.locator('#task-title')).toHaveText(a.title); release();
  await expect(page.locator('#task-title')).toHaveText(a.title); await expect(page.locator('.map-region, canvas')).toHaveCount(0);
});

async function observeNavigation(page: Page) {
  await page.addInitScript(() => {
    const records: unknown[] = [];
    const snapshot = (event: string) => {
      records.push({ event, at: performance.now(), url: location.href, state: structuredClone(history.state), dialogs: document.querySelectorAll('[role="dialog"]').length });
      if (records.length > 200) records.shift();
    };
    const push = history.pushState.bind(history), replace = history.replaceState.bind(history);
    history.pushState = (...args) => { push(...args); snapshot('pushState'); };
    history.replaceState = (...args) => { replace(...args); snapshot('replaceState'); };
    window.addEventListener('popstate', () => snapshot('popstate'));
    document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('[aria-label="Закрыть"]')) snapshot('native-close-click'); }, true);
    Object.assign(window, { qaNavigationTrace: () => records });
  });
}

for (const phase of ['lazy', 'loading', 'ready', 'scene'] as const) test(`touch: news from PLANET closes ${phase} task and Back/Forward never resurrects a cancelled card`, async ({ page }, info) => {
  const { a } = await fixture(page); await observeNavigation(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const gate = { hold: phase === 'loading', started: false, release: () => undefined as void };
  const wait = new Promise<void>(resolve => { gate.release = resolve; });
  let lazyStarted = false, sceneStarted = false;
  if (phase === 'scene') await page.route('**/api/countries/*/cities/*/scene', async route => {
    sceneStarted = true; await wait; await route.continue().catch(() => undefined);
  });
  if (phase === 'lazy') await page.route('**/*TaskModal*', async route => {
    if (route.request().resourceType() === 'script') { lazyStarted = true; await wait; }
    await route.continue().catch(() => undefined);
  });
  await page.route(`**/api/tasks/${a.id}/card?*`, async route => {
    gate.started = true; if (gate.hold) await wait;
    await route.fallback().catch(() => undefined);
  });
  await page.route('**/api/city-news?*', route => route.fulfill({ json: {
    items: [{ taskId: a.id, taskNumber: a.taskNumber, title: a.title, cityId: a.cityId, cityName: a.cityName, kind: 'COMMENT', count: 1, lastEventId: 77, at: new Date().toISOString(), unread: true }],
    unreadCount: 1, nextBefore: null, nextCursor: null,
  } }));
  let writes = 0; await page.route('**/api/city-news/read', route => { writes++; return route.fulfill({ json: { ok: true } }); });
  try {
    await page.goto('/'); await expect(page.locator('.planet-atlas')).toBeVisible();
    await page.getByLabel('Уведомления', { exact: true }).click(); await page.locator('.news-task').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (phase === 'lazy') { await expect.poll(() => lazyStarted).toBe(true); await expect(page.getByRole('dialog')).toHaveAccessibleName('Загрузка задачи'); }
    else if (phase === 'loading') { await expect.poll(() => gate.started).toBe(true); await expect(page.locator('#task-title')).toHaveCount(0); }
    else await expect(page.locator('#task-title')).toHaveText(a.title);
    if (phase === 'scene') await expect.poll(() => sceneStarted).toBe(true);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    gate.hold = false; gate.release();
    // Let the deliberately late card response settle after its owner closed.
    await page.waitForTimeout(200);
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page).not.toHaveURL(/\/task(?:\/|\?)/);
    expect(await page.evaluate(() => history.state?.task ?? null)).toBeNull();
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.goForward(); await expect(page.locator('#task-title')).toHaveText(a.title); await expect(page).toHaveURL(new RegExp(`taskId=${a.id}`));
      await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page).not.toHaveURL(/\/task(?:\/|\?)/);
    }
    expect(writes).toBe(0); expect(errors).toEqual([]);
  } finally {
    gate.hold = false; gate.release();
    const path = info.outputPath(`news-${phase}-navigation.json`);
    await writeFile(path, JSON.stringify(await page.evaluate(() => ({ url: location.href, state: history.state, dialogs: document.querySelectorAll('[role="dialog"]').length, trace: (window as unknown as { qaNavigationTrace(): unknown[] }).qaNavigationTrace() })), null, 2));
    await info.attach(`news-${phase}-navigation`, { path, contentType: 'application/json' });
  }
});
