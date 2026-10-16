import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { BootstrapDto, RealtimeEvent } from '../../src/shared/contracts';
import type { TaskListPageDto } from '../../src/shared/task-read-contracts';
import { openMapCity } from './map-navigation';

const credentials = () => ({ email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo' });
async function login(page: Page) {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(process.env.E2E_BASE_URL!).hostname);
  expect((await page.request.post('/api/auth/login', { data: credentials() })).ok()).toBe(true);
  return await (await page.request.get('/api/bootstrap')).json() as BootstrapDto;
}
async function observation(page: Page) {
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket, sockets = new Set<WebSocket>(), trace: unknown[] = [];
    const record = (event: string) => { trace.push({ event, at: performance.now(), url: location.href, state: structuredClone(history.state), title: document.title }); if (trace.length > 120) trace.shift(); };
    const push = history.pushState.bind(history), replace = history.replaceState.bind(history);
    history.pushState = (...args) => { push(...args); record('pushState'); };
    history.replaceState = (...args) => { replace(...args); record('replaceState'); };
    window.addEventListener('popstate', () => record('popstate'));
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); if (String(url).includes('/socket.io')) { sockets.add(this); this.addEventListener('close', () => sockets.delete(this)); } }
    };
    Object.assign(window, {
      qaScopeSockets: () => [...sockets].filter(socket => socket.readyState === NativeSocket.OPEN).length,
      qaScopeFrame: (event: unknown) => { for (const socket of sockets) if (socket.readyState === NativeSocket.OPEN) socket.dispatchEvent(new MessageEvent('message', { data: `42${JSON.stringify(['world:event', event])}` })); },
      qaScopeSnapshot: () => ({ url: location.href, state: history.state, title: document.title, trace }),
    });
  });
}
async function save(page: Page, path: string) { await writeFile(path, JSON.stringify(await page.evaluate(() => (window as unknown as { qaScopeSnapshot(): unknown }).qaScopeSnapshot()), null, 2)); }

test('touch: late initial country selection cannot replace the new session after actual logout and login', async ({ page }, info) => {
  const bootstrap = await login(page); await observation(page);
  const foreign = 'a30cbcc1-49bd-4d2f-89f5-2852f6945e27';
  // The foreign reply is controlled: this tests the auth epoch, not real foreign membership.
  const stale: BootstrapDto = { ...bootstrap, country: { ...bootstrap.country, id: foreign, name: 'Просроченный контролируемый мир' }, initialCity: null };
  let release!: () => void, selections = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/countries/${foreign}/select`, async route => {
    const first = ++selections === 1; if (first) await gate;
    await route.fulfill({ json: first ? stale : bootstrap }).catch(() => undefined);
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`/?countryId=${foreign}`); await expect.poll(() => selections).toBe(1);
    await page.getByLabel('Меню', { exact: true }).click(); await page.getByRole('button', { name: 'Аккаунт и настройки', exact: true }).click();
    const logout = page.waitForResponse(response => response.url().endsWith('/api/auth/logout'));
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click(); expect((await logout).ok()).toBe(true);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(credentials().email); await page.getByLabel('Пароль', { exact: true }).fill(credentials().password);
    const authenticated = page.waitForResponse(response => response.url().endsWith('/api/auth/login'));
    await page.getByRole('button', { name: 'Открыть страну', exact: true }).click(); expect((await authenticated).ok()).toBe(true);
    await expect(page.locator('.app-shell')).toBeVisible(); await expect(page).toHaveTitle(`Tasktopia — ${bootstrap.country.name}`);
    const late = page.waitForResponse(response => response.url().endsWith(`/api/countries/${foreign}/select`)); release(); await late;
    // Let the late promise and its dependent React publication effects settle.
    await page.waitForTimeout(350); await expect(page).toHaveTitle(`Tasktopia — ${bootstrap.country.name}`);
    await expect(page.getByText(stale.country.name, { exact: true })).toHaveCount(0);
    const actual = await (await page.request.get('/api/bootstrap')).json() as BootstrapDto; expect(actual.user.id).toBe(bootstrap.user.id); expect(actual.country.id).toBe(bootstrap.country.id);
    expect(errors).toEqual([]);
  } finally { release(); await save(page, info.outputPath('initial-country-auth-epoch.json')); }
});

test('touch: explicit PLANET cancels a held CITY popstate restore before its late scene arrives', async ({ page }, info) => {
  const bootstrap = await login(page); await observation(page);
  const tasks = await (await page.request.get(`/api/tasks/list-page?countryId=${bootstrap.country.id}&limit=1`)).json() as TaskListPageDto;
  const task = tasks.items[0]!; let hold = false, started = 0, delivered = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/countries/*/cities/*/scene', async route => {
    if (hold) {
      started++; await gate;
      const response = await route.fetch(); await route.fulfill({ response }); delivered++;
    } else await route.continue();
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/'); await openMapCity(page); const world = page.locator('.world-canvas'); await expect(world).toHaveAttribute('data-city-scene-commit', 'atomic');
    const search = page.getByRole('combobox', { name: 'Поиск здания по номеру или названию' }); await search.fill(`#${task.taskNumber}`); await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1); await search.press('Enter');
    await expect(page.locator('#task-title')).toHaveText(task.title); await expect(page).toHaveURL(new RegExp(`taskId=${task.id}`));
    await expect.poll(() => page.evaluate(() => (window as unknown as { qaScopeSockets(): number }).qaScopeSockets())).toBeGreaterThan(0);
    hold = true;
    const update: RealtimeEvent = { id: bootstrap.eventCursor + 1, countryId: bootstrap.country.id, worldVersion: bootstrap.country.worldVersion + 1, type: 'world.resync_required', createdAt: new Date().toISOString(), payload: { cityId: task.cityId } };
    await page.evaluate(event => (window as unknown as { qaScopeFrame(event: unknown): void }).qaScopeFrame(event), update);
    await expect.poll(() => started).toBeGreaterThan(0);
    await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page).not.toHaveURL(/\/task(?:\/|\?)/);
    const planet = page.getByRole('navigation', { name: 'Уровень карты' }).getByRole('button', { name: 'Планета', exact: true }); await planet.click();
    await expect(page.locator('.planet-atlas')).toBeVisible();
    hold = false; release(); await expect.poll(() => delivered).toBeGreaterThan(0); await page.waitForTimeout(350);
    await expect(page.locator('.planet-atlas')).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => history.state?.view?.mode)).toBe('PLANET'); expect(new URL(page.url()).searchParams.has('cityId')).toBe(false); expect(errors).toEqual([]);
  } finally { hold = false; release(); await save(page, info.outputPath('popstate-city-cancel-epoch.json')); }
});
