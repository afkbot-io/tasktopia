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
    await page.getByLabel('Поиск здания по номеру или названию').fill(String(task.taskNumber));
    if (pausedClock) await page.clock.runFor(400);
    await page.locator('.task-search-results button').first().click();
    await expect(page.locator('#task-title')).toContainText(task.title);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click(); await ready();
  };
  const cleanup = async () => { await page.close(); await client.close(); await db.prepare('DELETE FROM countries WHERE id=?').run(user.countryId); await db.prepare('DELETE FROM users WHERE id=?').run(user.id); await db.close(); };
  return { db, service, user, city, tasks, pendingSchool, pendingKindergarten, pendingHome, call, host, open, focus, panFocus, cleanup };
  } catch (error) {
    await ownedClient?.close();
    if (ownedUser) { await db.prepare('DELETE FROM countries WHERE id=?').run(ownedUser.countryId); await db.prepare('DELETE FROM users WHERE id=?').run(ownedUser.id); }
    await db.close(); throw error;
  }
}
