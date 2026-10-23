import { expect, test } from '@playwright/test';
import type { BootstrapDto, RealtimeEvent } from '../../src/shared/contracts';
import { openMapCity } from './map-navigation';

test('retries a failed second history page before committing a newer WebSocket arrival', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket, sockets = new Set<WebSocket>(), upgraded = new Set<WebSocket>();
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes('/socket.io')) {
          sockets.add(this); this.addEventListener('close', () => { sockets.delete(this); upgraded.delete(this); });
        }
      }
      override send(data: string | Blob | BufferSource) { super.send(data); if (data === '5') upgraded.add(this); }
    };
    Object.assign(window, {
      qaWorldSockets: () => [...sockets].filter(socket => socket.readyState === NativeSocket.OPEN && upgraded.has(socket)).length,
      qaWorldFrame: (event: unknown) => {
        for (const socket of sockets) if (socket.readyState === NativeSocket.OPEN && upgraded.has(socket))
          socket.dispatchEvent(new MessageEvent('message', { data: `42${JSON.stringify(['world:event', event])}` }));
      },
    });
    localStorage.setItem('tasktopia:world-preferences:v2', JSON.stringify({ quality: 'NORMAL', cityLife: true, sound: false }));
  });
  const errors: string[] = [], cursors: number[] = [];
  page.on('pageerror', error => errors.push(error.message));
  expect((await page.request.post('/api/auth/login', { data: {
    email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo',
  } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json() as BootstrapDto;
  let release!: () => void;
  const heldFailure = new Promise<void>(resolve => { release = resolve; });
  let failed = false;
  const event = (offset: number): RealtimeEvent => ({
    id: bootstrap.eventCursor + offset, worldVersion: bootstrap.country.worldVersion + offset,
    countryId: bootstrap.country.id, createdAt: new Date().toISOString(), type: 'task.comment_added',
    payload: { taskId: 'replay-test-task', cityId: bootstrap.initialCity?.id },
  });
  await page.route('**/api/events?after=*', async route => {
    const after = Number(new URL(route.request().url()).searchParams.get('after'));
    cursors.push(after);
    if (after === bootstrap.eventCursor) {
      await route.fulfill({ json: Array.from({ length: 500 }, (_, i) => event(i + 1)) }); return;
    }
    if (after === bootstrap.eventCursor + 500 && !failed) {
      failed = true; await heldFailure;
      await route.fulfill({ status: 503, json: { error: 'Controlled history interruption' } }); return;
    }
    await route.fulfill({ json: after < bootstrap.eventCursor + 501 ? [event(501)] : [] });
  });
  await page.goto('/'); await openMapCity(page);
  await expect.poll(() => cursors).toEqual([bootstrap.eventCursor, bootstrap.eventCursor + 500]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaWorldSockets(): number }).qaWorldSockets())).toBeGreaterThan(0);
  await page.evaluate(value => (window as unknown as { qaWorldFrame(event: unknown): void }).qaWorldFrame(value), event(501));
  await expect(page.getByRole('button', { name: 'Настройки аккаунта, подключение', exact: true })).toBeVisible();
  release();
  await expect.poll(() => cursors).toEqual([
    bootstrap.eventCursor, bootstrap.eventCursor + 500, bootstrap.eventCursor, bootstrap.eventCursor + 500,
  ]);
  await expect(page.getByRole('button', { name: 'Настройки аккаунта, в сети', exact: true })).toBeVisible();
  await expect(page.locator('.world-canvas')).toHaveAttribute('data-city-scene-commit', 'atomic');
  expect(errors).toEqual([]);
  await info.attach('replay-recovery', { body: Buffer.from(JSON.stringify({ confirmedCursor: bootstrap.eventCursor, requests: cursors, newerFrame: event(501).id, errors })), contentType: 'application/json' });
});
