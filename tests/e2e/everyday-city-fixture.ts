import { expect, type Page } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { AppService } from '../../src/server/app-service';
import { createDb } from '../../src/server/db';
import { registerUser } from '../../src/server/auth';
import { BUILDING_CATALOG } from '../../src/shared/catalog';
import type { TaskDto, TaskStatus } from '../../src/shared/contracts';
import { taskLink } from '../../src/client/task-navigation';
import { openMapCity } from './map-navigation';

export async function everydayFixture(page: Page) {
  const database = process.env.E2E_DATABASE_URL!;
  expect(['127.0.0.1', 'localhost']).toContain(new URL(database).hostname);
  expect(['127.0.0.1', 'localhost']).toContain(new URL(process.env.E2E_BASE_URL!).hostname);
  const db = await createDb(database, { migrate: false }), service = new AppService(db);
  let ownedUser: Awaited<ReturnType<typeof registerUser>>['user'] | undefined, ownedClient: Client | undefined;
  try {
  const { user } = await registerUser(db, { email: `everyday-${crypto.randomUUID()}@example.test`, name: 'Жизнь города QA', password: 'password123' });
  ownedUser = user;
  await db.prepare('UPDATE countries SET seed=? WHERE id=?').run(424242, user.countryId);
  const city = await service.createCity(user.countryId, { name: 'Город учебных зданий и событий', idempotencyKey: crypto.randomUUID() });
  const tasks: TaskDto[] = [], families = BUILDING_CATALOG.filter(b => b.educationKind).map(b => b.key);
  const statuses: TaskStatus[] = ['STARTED', 'IN_PROGRESS', 'TESTING', 'COMPLETED'];
  const add = async (family: string, stage: number, park = false) => {
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: family, archetype: 'NEW_BUILD', capacitySp: 100,
      activate: false, idempotencyKey: crypto.randomUUID() });
    await service.activateDistrict(user.countryId, district.id, crypto.randomUUID());
    let task: TaskDto | undefined;
    for (let attempt = 0; attempt < 12 && !task; attempt++) {
      try { task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: `QA ${family}`,
        estimate: park ? 6 : 1, ...(park ? { visualKind: 'PARK', parkVariant: family } : { visualKind: 'BUILDING', buildingHint: family }), idempotencyKey: `${district.id}:target` }); }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'INFRASTRUCTURE_RESERVATION_CONFLICT') throw error;
        await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: `Инфраструктура ${family}/${attempt}`, estimate: 1, idempotencyKey: crypto.randomUUID() });
      }
    }
    expect(task).toBeTruthy();
    for (let i = 0; i < stage - 1; i++) task = await service.updateTaskStatus(user.countryId, { taskId: task!.id, status: statuses[i]!, idempotencyKey: crypto.randomUUID() });
    tasks.push(task!); return task!;
  };
  for (const family of families) await add(family, 5);
  await add('urban-formal', 5, true); await add('urban-community', 5, true);
  for (const role of ['SHOP', 'FIRE'] as const) await add(BUILDING_CATALOG.find(b => b.serviceRole === role)!.key, 4);
  const pendingSchool = await add('compact-modern-school-v1', 4);
  const pendingKindergarten = await add('compact-color-kindergarten-v1', 4);
  const pendingHome = await add('compact-apartment-v1', 4);
  expect((await page.request.post('/api/auth/login', { data: { email: user.email, password: 'password123' } })).ok()).toBe(true);
  const tokenResult = await page.request.post('/api/tokens', { data: { name: 'Everyday live QA', scopes: ['tasks:read', 'tasks:write'], expiresInDays: 30 } });
  expect(tokenResult.ok()).toBe(true); const token = await tokenResult.json();
  const client = new Client({ name: 'everyday-live-qa', version: '1.0.0' });
  ownedClient = client;
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', process.env.E2E_BASE_URL), { requestInit: { headers: { Authorization: `Bearer ${token.token}` } } }));
  const call = async (name: string, args: Record<string, unknown>, idempotencyKey = crypto.randomUUID()) => {
    const result = await client.callTool({ name, arguments: { countryId: user.countryId, idempotencyKey, ...args } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    return JSON.parse((result.content as { type: string; text: string }[]).find(c => c.type === 'text')!.text);
  };
  const host = page.locator('.world-canvas');
  const ready = async () => { await expect(host).toHaveAttribute('data-city-scene-commit', 'atomic', { timeout: 30000 }); await expect(host).toHaveAttribute('data-mobility-ready', 'true', { timeout: 30000 }); };
  const open = async () => { await page.goto('/'); await openMapCity(page); await ready(); };
  const focus = async (task: TaskDto) => { await page.goto(taskLink(user.countryId, task)); await expect(page.locator('#task-title')).toContainText(task.title);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click(); await ready(); };
  const panFocus = async (task: TaskDto, pausedClock = false) => {
    // Search opens a card; closing it intentionally restores the preceding
    // map pose. These scene tests need a real pan without changing history.
    await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('countryId') === user.countryId && url.searchParams.get('cityId') === task.cityId);
    await expect(page.locator('.task-modal')).toHaveCount(0);
    const bounds = task.siteBounds ?? {
      minX: Math.min(...task.footprint.map(cell => cell.x)), maxX: Math.max(...task.footprint.map(cell => cell.x)),
      minY: Math.min(...task.footprint.map(cell => cell.y)), maxY: Math.max(...task.footprint.map(cell => cell.y)),
    };
    const canvas = host.locator('canvas'), box = await canvas.boundingBox(); expect(box).not.toBeNull();
    const camera = await host.evaluate(el => {
      const host = el as HTMLElement, canvas = host.querySelector('canvas')!;
      return { x: Number(host.dataset.cameraWorldX), y: Number(host.dataset.cameraWorldY), scale: Number(host.dataset.renderScale), width: canvas.clientWidth, height: canvas.clientHeight };
    });
    const dx = (camera.x - (bounds.minX + bounds.maxX + 1) / 2) * 8 * camera.scale;
    const dy = (camera.y - (bounds.minY + bounds.maxY + 1) / 2) * 8 * camera.scale;
    const tilePixels = 8 * camera.scale;
    const alreadyVisible = (bounds.minX - camera.x) * tilePixels + camera.width / 2 >= 24
      && (bounds.maxX + 1 - camera.x) * tilePixels + camera.width / 2 <= camera.width - 24
      && (bounds.minY - camera.y) * tilePixels + camera.height / 2 >= 24
      && (bounds.maxY + 1 - camera.y) * tilePixels + camera.height / 2 <= camera.height - 24;
    const drags = alreadyVisible ? 0 : Math.ceil(Math.max(Math.abs(dx) / (box!.width * .3), Math.abs(dy) / (box!.height * .3)));
    expect(drags, 'Native scene pan must fit a bounded sequence of viewport gestures').toBeLessThanOrEqual(12);
    const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    // Accumulate the intended delta. With paused RAF the renderer deliberately
    // retains its old presented pose until terrain for the pending pose is ready.
    for (let index = 0; index < drags; index++) {
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x + dx / drags, start.y + dy / drags, { steps: 12 }); await page.mouse.up();
    }
    // Preserve the original controlled preparation horizon, including when
    // the target was already visible. Never await a paused RAF before this.
    if (pausedClock) await page.clock.runFor(400);
    await ready(); await expect(host).toHaveAttribute('data-camera-presentation-pending', 'false');
    await expect.poll(() => host.evaluate((el, rect) => {
      const host = el as HTMLElement, canvas = host.querySelector('canvas')!, tilePixels = 8 * Number(host.dataset.renderScale);
      const x = Number(host.dataset.cameraWorldX), y = Number(host.dataset.cameraWorldY);
      return (rect.minX - x) * tilePixels + canvas.clientWidth / 2 >= 24
        && (rect.maxX + 1 - x) * tilePixels + canvas.clientWidth / 2 <= canvas.clientWidth - 24
        && (rect.minY - y) * tilePixels + canvas.clientHeight / 2 >= 24
        && (rect.maxY + 1 - y) * tilePixels + canvas.clientHeight / 2 <= canvas.clientHeight - 24;
    }, bounds), { message: `Task #${task.taskNumber} must actually be visible after its native scene pan` }).toBe(true);
  };
  const cleanup = async () => { await page.close(); await client.close(); await db.prepare('DELETE FROM countries WHERE id=?').run(user.countryId); await db.prepare('DELETE FROM users WHERE id=?').run(user.id); await db.close(); };
  return { db, service, user, city, tasks, pendingSchool, pendingKindergarten, pendingHome, call, host, open, focus, panFocus, cleanup };
  } catch (error) {
    await ownedClient?.close();
    if (ownedUser) { await db.prepare('DELETE FROM countries WHERE id=?').run(ownedUser.countryId); await db.prepare('DELETE FROM users WHERE id=?').run(ownedUser.id); }
    await db.close(); throw error;
  }
}
