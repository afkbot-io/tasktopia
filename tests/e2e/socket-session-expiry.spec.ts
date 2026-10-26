import { expect, test, type Page } from '@playwright/test';
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


test('explicit logout stops scoped recovery while the real server reply is held', async ({ page }, info) => {
  const base = new URL(String(info.project.use.baseURL));
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(base.hostname);
  const newBootstrap: number[] = [], newEvents: number[] = [], consoleErrors: string[] = [], pageErrors: string[] = [];
  let observationTruncated = false, logoutIntent = false, initialReplay = false;
  let tokenReads = 0, tokenStatus: number | undefined, tokenOutcome = 'not-started', tokenFailure: string | undefined;
  let logoutCalls = 0, logoutStatus: number | undefined, logoutHeld = false, logoutFulfilled = false, logoutFailure: string | undefined;
  let releaseTokens!: () => void, releaseLogout!: () => void;
  const tokensGate = new Promise<void>(resolve => { releaseTokens = resolve; });
  const logoutGate = new Promise<void>(resolve => { releaseLogout = resolve; });
  const record = <T,>(rows: T[], value: T) => { if (rows.length < 32) rows.push(value); else observationTruncated = true; };
  page.on('request', request => {
    if (!logoutIntent) return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/bootstrap') record(newBootstrap, Date.now());
    if (path === '/api/events') record(newEvents, Date.now());
  });
  page.on('response', response => {
    if (!logoutIntent && new URL(response.url()).pathname === '/api/events' && response.status() === 200) initialReplay = true;
  });
  page.on('console', message => { if (logoutIntent && message.type() === 'error') record(consoleErrors, message.text().slice(0, 500)); });
  page.on('pageerror', error => { if (logoutIntent) record(pageErrors, error.message.slice(0, 500)); });
  // This is an actual successful private read, started before logout. Hold only
  // delivery so its late completion cannot be mistaken for a new auth session.
  await page.route('**/api/tokens', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    tokenReads++;
    try {
      const response = await route.fetch({ headers: { ...route.request().headers(), 'accept-encoding': 'identity' }, timeout: 10_000 });
      tokenStatus = response.status(); tokenOutcome = 'held'; await tokensGate;
      await route.fulfill({ response }); tokenOutcome = 'delivered';
    } catch (error) { tokenFailure = error instanceof Error && error.name === 'TimeoutError' ? 'TimeoutError' : 'RouteError'; tokenOutcome = 'cancelled'; await route.abort().catch(() => undefined); }
  });
  await page.route('**/api/auth/logout', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    logoutCalls++;
    try {
      // routes.ts awaits session deletion and the real Socket.IO disconnect
      // hook before returning200. No fabricated auth response or socket frame.
      const response = await route.fetch({ timeout: 10_000 });
      logoutStatus = response.status(); logoutHeld = true; await logoutGate;
      await route.fulfill({ response }); logoutFulfilled = true;
    } catch (error) { logoutFailure = error instanceof Error && error.name === 'TimeoutError' ? 'TimeoutError' : 'RouteError'; await route.abort().catch(() => undefined); }
  });
  try {
    expect((await page.request.post('/api/auth/login', { data: {
      email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo',
    } })).status()).toBe(200);
    const bootstrap = await (await page.request.get('/api/bootstrap')).json();
    expect(bootstrap.country.id).toBeTruthy();
    await page.goto(`/?countryId=${encodeURIComponent(bootstrap.country.id)}`);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect.poll(() => initialReplay).toBe(true);
    await page.getByRole('button', { name: /^Настройки аккаунта/ }).click();
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect.poll(() => tokenOutcome).toBe('held'); expect(tokenStatus).toBe(200); expect(tokenReads).toBeGreaterThan(0);
    logoutIntent = true;
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
    await expect.poll(() => logoutHeld).toBe(true); expect(logoutStatus).toBe(200);
    // Bounded negative observation while the server has revoked the session
    // but the explicit UI logout promise still has no response. Real clock.
    await page.waitForTimeout(1000);
    expect(newBootstrap, 'Explicit logout must not start a new bootstrap for the revoked country/session').toEqual([]);
    expect(newEvents, 'Explicit logout must not restart scoped event replay').toEqual([]);
    expect(logoutFulfilled).toBe(false);
    await expect(page.locator('.app-shell, .task-entry, .world-canvas, #task-title')).toHaveCount(0);
    await expect(page.getByRole('status')).toBeVisible();
    releaseLogout();
    const signIn = page.getByRole('heading', { name: 'Войти в Tasktopia', exact: true });
    await expect(signIn).toBeVisible();
    await expect(page.locator('.app-shell, .task-entry, .world-canvas, #task-title')).toHaveCount(0);
    // Settle the pre-logout real200 private read only after anonymous UI owns
    // the screen. Cancellation is valid too; neither outcome may resurrect it.
    releaseTokens(); await expect.poll(() => ['delivered', 'cancelled'].includes(tokenOutcome)).toBe(true);
    await page.waitForTimeout(350);
    await expect(signIn).toBeVisible();
    await expect(page.locator('.app-shell, .task-entry, .world-canvas, #task-title')).toHaveCount(0);
    expect(newBootstrap).toEqual([]); expect(newEvents).toEqual([]);
    expect(logoutCalls).toBe(1); expect(logoutFulfilled).toBe(true); expect(logoutFailure).toBeUndefined();
    expect(consoleErrors).toEqual([]); expect(pageErrors).toEqual([]); expect(observationTruncated).toBe(false);
  } finally {
    try {
      await info.attach('explicit-logout-pending.json', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        logoutIntent, initialReplay, logoutCalls, logoutStatus, logoutHeld, logoutFulfilled, logoutFailure,
        tokenReads, tokenStatus, tokenOutcome, tokenFailure, newBootstrap, newEvents, consoleErrors, pageErrors, observationTruncated,
      }, null, 2)) });
    } finally {
      releaseTokens(); releaseLogout();
      try { await page.unrouteAll({ behavior: 'wait' }); }
      finally { expect((await page.request.post('/api/auth/logout', { timeout: 5000 })).status()).toBe(200); }
    }
  }
});


async function logoutRecoveryProfile(page: Page) {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(process.env.E2E_BASE_URL!).hostname);
  expect((await page.request.post('/api/auth/login', { data: {
    email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo',
  } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  await page.goto(`/?countryId=${encodeURIComponent(bootstrap.country.id)}`);
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button', { name: /^Настройки аккаунта/ }).click();
  await page.getByRole('button', { name: 'Профиль', exact: true }).click();
  return bootstrap;
}
function logoutFaultEvidence(page: Page, status: 503 | 401, faultPath: '/api/auth/logout' | '/api/bootstrap') {
  const data = { intentionalHttpResponses: 0, intentionalHttpConsole: [] as string[], unexpectedConsole: [] as string[], pageErrors: [] as string[], truncated: false };
  const add = (rows: string[], text: string) => { if (rows.length < 32) rows.push(text.slice(0, 500)); else data.truncated = true; };
  page.on('console', message => {
    if (message.type() !== 'error') return;
    let path = ''; try { path = new URL(message.location().url).pathname; } catch { /* Missing browser location stays unclassified. */ }
    const statusText = status === 503 ? /\b503\b/ : /\b401\b/;
    add(path === faultPath && statusText.test(message.text()) ? data.intentionalHttpConsole : data.unexpectedConsole, message.text());
  });
  page.on('response', response => { if (new URL(response.url()).pathname === faultPath && response.status() === status) data.intentionalHttpResponses++; });
  page.on('pageerror', error => add(data.pageErrors, error.message));
  return data;
}
async function loginAgainAfterLogoutRecovery(page: Page) {
  await page.getByLabel('Email', { exact: true }).fill(process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local');
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo');
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/auth/login');
  await page.getByRole('button', { name: 'Открыть страну', exact: true }).click();
  expect((await response).status()).toBe(200); await expect(page.locator('.app-shell')).toBeVisible();
}

test('logout failure before server revocation recovers the real session and supports a later logout and login', async ({ page }, info) => {
  const evidence = logoutFaultEvidence(page, 503, '/api/auth/logout');
  let failNext = true, logoutCalls = 0, realForwards = 0, replayResponses = 0, retryStatus: number | undefined;
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/events' && response.status() === 200) replayResponses++; });
  await page.route('**/api/auth/logout', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    logoutCalls++;
    if (failNext) { failNext = false; await route.fulfill({ status: 503, json: { message: 'Controlled logout failure before server revoke' } }); }
    else { realForwards++; await route.continue(); }
  });
  try {
    const original = await logoutRecoveryProfile(page); await expect.poll(() => replayResponses).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Не удалось подтвердить выход. Повторите проверку подключения.');
    await expect(page.locator('.app-shell, .task-entry, .world-canvas, #task-title')).toHaveCount(0);
    expect(logoutCalls).toBe(1); expect(realForwards).toBe(0);
    if (info.project.name === 'auth-logout-chromium') {
      const viewport = page.viewportSize();
      try { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath('logout-recoverable-390.png') }); }
      finally { if (viewport) await page.setViewportSize(viewport); }
    }
    const beforeRetryReplay = replayResponses;
    const retry = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap');
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    const result = await retry; retryStatus = result.status(); expect(retryStatus).toBe(200);
    const restored = await result.json(); expect(restored.user.id).toBe(original.user.id); expect(restored.country.id).toBe(original.country.id);
    await expect(page.locator('.app-shell')).toBeVisible(); await expect.poll(() => replayResponses).toBeGreaterThan(beforeRetryReplay);
    await page.getByRole('button', { name: /^Настройки аккаунта/ }).click(); await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    const loggedOut = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/logout');
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click(); expect((await loggedOut).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Войти в Tasktopia', exact: true })).toBeVisible();
    expect(realForwards).toBe(1); const beforeLoginReplay = replayResponses;
    await loginAgainAfterLogoutRecovery(page); await expect.poll(() => replayResponses).toBeGreaterThan(beforeLoginReplay);
    expect(evidence.intentionalHttpResponses).toBe(1); expect(evidence.unexpectedConsole).toEqual([]); expect(evidence.pageErrors).toEqual([]); expect(evidence.truncated).toBe(false);
  } finally {
    try { await info.attach('logout-before-revoke-recovery.json', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ logoutCalls, realForwards, retryStatus, replayResponses, ...evidence }, null, 2)) }); }
    finally { try { await page.unrouteAll({ behavior: 'wait' }); } finally { expect((await page.request.post('/api/auth/logout', { timeout: 5000 })).status()).toBe(200); } }
  }
});

test('a lost real logout reply reaches its deadline and rechecks revoked authentication before a fresh login', async ({ page }, info) => {
  const evidence = logoutFaultEvidence(page, 401, '/api/bootstrap');
  let release!: () => void; const heldReply = new Promise<void>(resolve => { release = resolve; });
  let serverStatus: number | undefined, serverReplyHeld = false, deliverySettled = false, deliveryAborted = false;
  let replayResponses = 0, retryStatus: number | undefined, confirmedStatus: number | undefined, alertAfterMs: number | undefined, beforeRetry = false, extraBootstrapBeforeRetry = 0;
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/events' && response.status() === 200) replayResponses++; });
  page.on('request', request => { if (beforeRetry && new URL(request.url()).pathname === '/api/bootstrap') extraBootstrapBeforeRetry++; });
  await page.route('**/api/auth/logout', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch({ timeout: 10_000 }); serverStatus = response.status(); serverReplyHeld = true;
    await heldReply;
    try { await route.fulfill({ response }); } catch { deliveryAborted = true; }
    finally { deliverySettled = true; }
  });
  try {
    const original = await logoutRecoveryProfile(page); await expect.poll(() => replayResponses).toBeGreaterThan(0);
    beforeRetry = true; const clickedAt = Date.now();
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
    await expect.poll(() => serverReplyHeld).toBe(true); expect(serverStatus).toBe(200);
    // Native clock: the actual App logout owner deadline, no fake timers or synthetic401.
    await expect(page.getByRole('alert')).toHaveText('Не удалось подтвердить выход. Повторите проверку подключения.', { timeout: 17_000 });
    alertAfterMs = Date.now() - clickedAt; expect(alertAfterMs).toBeGreaterThanOrEqual(14_500); expect(alertAfterMs).toBeLessThanOrEqual(17_000);
    await expect(page.locator('.app-shell, .task-entry, .world-canvas, #task-title')).toHaveCount(0); expect(extraBootstrapBeforeRetry).toBe(0);
    beforeRetry = false;
    const retry = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap');
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    retryStatus = (await retry).status(); expect(retryStatus).toBe(401);
    await expect(page.getByRole('heading', { name: 'Войти в Tasktopia', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toHaveCount(0);
    await expect(page.locator('.app-shell, .task-entry, .world-canvas, #task-title')).toHaveCount(0);
    const beforeLoginReplay = replayResponses; await loginAgainAfterLogoutRecovery(page); await expect.poll(() => replayResponses).toBeGreaterThan(beforeLoginReplay);
    // The revoked response must not clear the fresh login owner or its cookie.
    release(); await expect.poll(() => deliverySettled).toBe(true); await expect(page.locator('.app-shell')).toBeVisible();
    const confirmed = await page.request.get('/api/bootstrap'); confirmedStatus = confirmed.status(); expect(confirmedStatus).toBe(200);
    const current = await confirmed.json(); expect(current.user.id).toBe(original.user.id); expect(current.country.id).toBe(original.country.id);
    expect(evidence.intentionalHttpResponses).toBe(1); expect(evidence.unexpectedConsole).toEqual([]); expect(evidence.pageErrors).toEqual([]); expect(evidence.truncated).toBe(false);
  } finally {
    try { await info.attach('logout-after-revoke-timeout-recovery.json', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ serverStatus, serverReplyHeld, deliverySettled, deliveryAborted, alertAfterMs, retryStatus, confirmedStatus, extraBootstrapBeforeRetry, replayResponses, ...evidence }, null, 2)) }); }
    finally { release(); try { await page.unrouteAll({ behavior: 'wait' }); } finally { expect((await page.request.post('/api/auth/logout', { timeout: 5000 })).status()).toBe(200); } }
  }
});
