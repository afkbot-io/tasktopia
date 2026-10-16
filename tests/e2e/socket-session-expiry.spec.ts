import { expect, test } from '@playwright/test';
import type { TaskListPageDto } from '../../src/shared/task-read-contracts';

test('server session revocation removes the private card and returns to sign-in', async ({ page }) => {
  let connectedReplay = false;
  page.on('request', request => { if (request.url().includes('/api/events?after=')) connectedReplay = true; });
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket, sockets = new Set<WebSocket>(), upgraded = new Set<WebSocket>();
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes('/socket.io')) sockets.add(this);
      }
      override send(data: string | Blob | BufferSource) {
        super.send(data); if (data === '5') upgraded.add(this);
      }
    };
    Object.assign(window, { qaRevokeSocket: () => {
      let sent = 0;
      for (const socket of sockets) if (socket.readyState === NativeSocket.OPEN && upgraded.has(socket)) {
        socket.dispatchEvent(new MessageEvent('message', { data: '41' })); sent++;
      }
      return sent;
    } });
  });
  expect((await page.request.post('/api/auth/login', { data: {
    email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo',
  } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  const tasks = await (await page.request.get(`/api/tasks/list-page?countryId=${bootstrap.country.id}&limit=1`)).json() as TaskListPageDto;
  const task = tasks.items[0]; expect(task).toBeTruthy();
  await page.goto(`/task/${task.taskNumber}?countryId=${bootstrap.country.id}&taskId=${task.id}`);
  await expect(page.locator('#task-title')).toHaveText(task.title);
  await expect.poll(() => connectedReplay).toBe(true);
  await page.route('**/api/bootstrap', route => route.fulfill({ status: 401, json: { error: 'Session expired' } }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaRevokeSocket(): number }).qaRevokeSocket())).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Войти в Tasktopia' })).toBeVisible();
  await expect(page.locator('#task-title')).toHaveCount(0);
});

test('real session logout removes an already open card through the server disconnect', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: {
    email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo',
  } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  const tasks = await (await page.request.get(`/api/tasks/list-page?countryId=${bootstrap.country.id}&limit=1`)).json() as TaskListPageDto;
  const task = tasks.items[0];
  let connected = false;
  page.on('request', request => { if (request.url().includes('/api/events?after=')) connected = true; });
  await page.goto(`/task/${task.taskNumber}?countryId=${bootstrap.country.id}&taskId=${task.id}`);
  await expect(page.locator('#task-title')).toHaveText(task.title);
  await expect.poll(() => connected).toBe(true);
  expect((await page.request.post('/api/auth/logout')).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Войти в Tasktopia' })).toBeVisible();
  await expect(page.locator('#task-title')).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill(process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local');
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo');
  await page.getByRole('button', { name: 'Открыть страну', exact: true }).click();
  await expect(page.locator('#task-title')).toHaveText(task.title);
  await expect(page.locator('.map-region, canvas')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/task/${task.taskNumber}\\?`));
});
