import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { BootstrapDto, RealtimeEvent } from '../../src/shared/contracts';
import type { TaskListPageDto } from '../../src/shared/task-read-contracts';
import type { CityNews, CityNewsItem } from '../../src/shared/city-news';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });

async function session(page: Page) {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(process.env.E2E_BASE_URL!).hostname);
  const email = process.env.E2E_CATALOG_FIXTURE_EMAIL ?? 'demo@tasktopia.local';
  expect((await page.request.post('/api/auth/login', { data: { email, password: process.env.E2E_CATALOG_FIXTURE_EMAIL ? 'local-city-scale-fixture-only' : 'tasktopia-demo' } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json() as BootstrapDto;
  const tasks = await (await page.request.get(`/api/tasks/list-page?${new URLSearchParams({ countryId: bootstrap.country.id, limit: '50' })}`)).json() as TaskListPageDto;
  expect(tasks.items.length).toBeGreaterThan(1);
  return { bootstrap, tasks };
}
function event(task: TaskListPageDto['items'][number], id: number, kind: CityNewsItem['kind'] = 'COMMENT'): CityNewsItem {
  return { taskId: task.id, taskNumber: task.taskNumber, title: task.title, cityId: task.cityId, cityName: task.cityName, kind, count: 1, lastEventId: id, at: new Date(Date.UTC(2026, 9, 16, 10, 0, id % 60)).toISOString(), unread: true };
}
const response = (items: CityNewsItem[], unreadCount = items.filter(item => item.unread).length, nextCursor: string | null = null): CityNews => ({ items, unreadCount, nextCursor, nextBefore: nextCursor ? items.at(-1)!.lastEventId : null });
async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('Уведомления', { exact: true }).click();
  return page.getByRole('region', { name: 'Уведомления', exact: true });
}

test('touch: просмотр и открытие задачи не отмечают новости прочитанными, явное сохранение повторяется после отказа', async ({ page }, info) => {
  const { tasks } = await session(page); let items = [event(tasks.items[0]!, 77), event(tasks.items[0]!, 66), event(tasks.items[1]!, 55, 'MATERIAL')];
  const writes: number[][] = []; let fail = true;
  await page.route('**/api/city-news?*', route => {
    const limit = Number(new URL(route.request().url()).searchParams.get('limit'));
    return route.fulfill({ json: response(items.slice(0, limit), items.filter(item => item.unread).length) });
  });
  await page.route('**/api/city-news/read', route => {
    const ids = (route.request().postDataJSON() as { eventIds: number[] }).eventIds; writes.push(ids);
    if (fail) return route.fulfill({ status: 503, json: { message: 'Проверка повтора' } });
    const selected = items.filter(item => ids.includes(item.lastEventId));
    items = items.map(item => ({ ...item, unread: item.unread && !selected.some(read => read.taskId === item.taskId && read.kind === item.kind && read.lastEventId >= item.lastEventId) }));
    return route.fulfill({ json: { ok: true } });
  });
  let panel = await open(page); await expect(panel.locator('li')).toHaveCount(3);
  expect(await panel.locator('[data-news-key]').evaluateAll(nodes => new Set(nodes.map(node => node.getAttribute('data-news-key'))).size)).toBe(3);
  await panel.locator('li').last().scrollIntoViewIfNeeded();
  // The previous visibility observer acknowledged a card after 400ms.
  await page.waitForTimeout(600); expect(writes).toEqual([]);
  await panel.locator('.news-task').first().click(); await expect(page.getByRole('dialog')).toBeVisible(); expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Уведомления', { exact: true }).click(); panel = page.getByRole('region', { name: 'Уведомления', exact: true });
  await panel.getByRole('button', { name: 'История', exact: true }).click(); await expect(panel.locator('li')).toHaveCount(3);
  await panel.locator('[data-event="77"]').getByRole('button', { name: /^Отметить прочитанным:/ }).click();
  await expect(panel.getByText('Не удалось сохранить прочтение.', { exact: false })).toBeVisible();
  await expect(panel.locator('[data-unread="true"]')).toHaveCount(3); expect(writes).toEqual([[77]]);
  fail = false; await panel.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(panel.locator('[data-unread="true"]')).toHaveCount(1); expect(writes).toEqual([[77], [77]]);
  await expect(panel.getByText('Прочтение сохранено.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(panel.getByRole('navigation', { name: 'Страницы уведомлений' })).toBeInViewport({ ratio: 1 });
  expect((await new AxeBuilder({ page }).include('.news-feed').analyze()).violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: info.outputPath('news-explicit-320.png') });
});

test('touch: типы и cursor-страницы ограничены пятьюдесятью карточками, прочтение страницы отправляет реальные id', async ({ page }) => {
  const { tasks } = await session(page); const all = Array.from({ length: 80 }, (_, index) => event(tasks.items[index % tasks.items.length]!, 1000 - index, index % 2 ? 'MATERIAL' : 'COMMENT'));
  const writes: number[][] = []; const reads: URL[] = [];
  await page.route('**/api/city-news?*', route => {
    const url = new URL(route.request().url()); reads.push(url); const kind = url.searchParams.get('kind');
    const selected = kind ? all.filter(item => item.kind === kind) : all; const start = Number(url.searchParams.get('cursor') ?? 0), limit = Number(url.searchParams.get('limit'));
    return route.fulfill({ json: response(selected.slice(start, start + limit), selected.length, start + limit < selected.length ? String(start + limit) : null) });
  });
  await page.route('**/api/city-news/read', route => { writes.push((route.request().postDataJSON() as { eventIds: number[] }).eventIds); return route.fulfill({ json: { ok: true } }); });
  const panel = await open(page); await expect(panel.locator('li')).toHaveCount(50);
  const first = await panel.locator('[data-event]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-event'))));
  const pager = panel.getByRole('navigation', { name: 'Страницы уведомлений' }); await pager.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(pager.getByRole('status')).toHaveText('Страница 2'); await expect(panel.locator('li')).toHaveCount(30);
  await pager.getByRole('button', { name: 'Назад', exact: true }).click(); await expect(panel.locator('li')).toHaveCount(50);
  expect(await panel.locator('[data-event]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-event'))))).toEqual(first);
  await panel.getByRole('combobox', { name: 'Тип уведомлений' }).selectOption('COMMENT'); await expect(panel.locator('li')).toHaveCount(40);
  await expect(pager.getByRole('status')).toHaveText('Страница 1'); await expect(page.locator('.world-digest .notification-count')).toHaveAttribute('aria-label', '80 непрочитанных'); expect(await panel.locator('li').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('Новый комментарий')]));
  await panel.getByRole('combobox', { name: 'Тип уведомлений' }).selectOption(''); await expect(panel.locator('li')).toHaveCount(50);
  await expect(pager.getByRole('status')).toHaveText('Страница 1');
  await panel.getByRole('button', { name: 'Отметить страницу прочитанной', exact: true }).click(); await expect.poll(() => writes.length).toBe(1); expect(writes[0]).toEqual(first);
  expect(reads.every(url => url.searchParams.has('countryId') && Number(url.searchParams.get('limit')) <= 50 && !url.searchParams.has('before'))).toBe(true);
});

test('touch: отказ ленты убирает старые карточки и повтор доступен с клавиатуры', async ({ page }) => {
  const { tasks } = await session(page); let fail = false;
  await page.route('**/api/city-news?*', route => fail ? route.fulfill({ status: 503, json: { message: 'Недоступно' } }) : route.fulfill({ json: response([event(tasks.items[0]!, 88)]) }));
  const panel = await open(page); await expect(panel.locator('li')).toHaveCount(1); fail = true;
  await panel.getByRole('combobox', { name: 'Тип уведомлений' }).selectOption('COMMENT'); await expect(panel.getByRole('alert')).toContainText('Не удалось получить новости.'); await expect(panel.locator('li')).toHaveCount(0);
  fail = false; await panel.getByRole('button', { name: 'Повторить', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(panel.locator('li')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(page.getByLabel('Уведомления', { exact: true })).toBeFocused();
});

test('touch: новый комментарий остаётся непрочитанным, пока сохраняется прочтение предыдущей серии', async ({ page }) => {
  const { tasks } = await session(page); const task = tasks.items[0]!;
  let items = [event(task, 77), event(task, 66)], release: (() => void) | undefined;
  await page.route('**/api/city-news?*', route => route.fulfill({ json: response(items.slice(0, Number(new URL(route.request().url()).searchParams.get('limit'))), items.filter(item => item.unread).length) }));
  await page.route('**/api/city-news/read', async route => {
    const ids = (route.request().postDataJSON() as { eventIds: number[] }).eventIds; expect(ids).toEqual([77]);
    await new Promise<void>(resolve => { release = resolve; });
    items = items.map(item => ({ ...item, unread: item.lastEventId > 77 }));
    await route.fulfill({ json: { ok: true } });
  });
  try {
  const panel = await open(page); await panel.getByRole('button', { name: 'История', exact: true }).click(); await expect(panel.locator('li')).toHaveCount(2);
  await panel.locator('[data-event="77"]').getByRole('button', { name: /^Отметить прочитанным:/ }).click(); await expect.poll(() => Boolean(release)).toBe(true);
  items = [event(task, 88), ...items]; await page.evaluate(() => window.dispatchEvent(new Event('online'))); await expect(panel.locator('li')).toHaveCount(3);
  release!(); await expect(panel.locator('[data-event="77"]')).toHaveAttribute('data-unread', 'false');
  await expect(panel.locator('[data-event="66"]')).toHaveAttribute('data-unread', 'false'); await expect(panel.locator('[data-event="88"]')).toHaveAttribute('data-unread', 'true');
  } finally { release?.(); }
});

test('touch: запрет записи прочтения убирает ранее показанные карточки', async ({ page }) => {
  const { tasks } = await session(page); let hold = false, release: (() => void) | undefined;
  await page.route('**/api/city-news?*', async route => {
    if (hold && new URL(route.request().url()).searchParams.get('limit') === '50') await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: response([event(tasks.items[0]!, 88)]) });
  });
  await page.route('**/api/city-news/read', route => route.fulfill({ status: 403, json: { message: 'Доступ изменён' } }));
  try {
  const panel = await open(page); await expect(panel.locator('li')).toHaveCount(1);
  hold = true; await page.evaluate(() => window.dispatchEvent(new Event('online'))); await expect.poll(() => Boolean(release)).toBe(true);
  await panel.locator('li').getByRole('button', { name: /^Отметить прочитанным:/ }).click();
  await expect(panel.locator('li')).toHaveCount(0); await expect(panel.getByText('Новости недоступны. Проверьте доступ и повторите загрузку.', { exact: false })).toBeVisible();
  const staleResponse = page.waitForResponse(reply => reply.url().includes('/api/city-news?') && reply.status() === 200);
  release!(); await staleResponse; await page.waitForTimeout(100);
  await expect(panel.locator('li')).toHaveCount(0); await expect(page.locator('.world-digest .notification-count')).toHaveCount(0);
  } finally { release?.(); }
});


test('touch: событие комментария по WebSocket обновляет ленту через revision без автоматического прочтения', async ({ page }) => {
  const { bootstrap, tasks } = await session(page); const task = tasks.items[0]!;
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket, sockets = new Set<WebSocket>();
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); if (String(url).includes('/socket.io')) { sockets.add(this); this.addEventListener('close', () => sockets.delete(this)); } }
    };
    Object.assign(window, {
      qaNewsSockets: () => [...sockets].filter(socket => socket.readyState === NativeSocket.OPEN).length,
      qaNewsFrame: (event: unknown) => { for (const socket of sockets) if (socket.readyState === NativeSocket.OPEN) socket.dispatchEvent(new MessageEvent('message', { data: `42${JSON.stringify(['world:event', event])}` })); },
    });
  });
  let items = [event(task, 77)], reads = 0, writes = 0;
  await page.route('**/api/city-news?*', route => { if (new URL(route.request().url()).searchParams.get('limit') === '50') reads++; return route.fulfill({ json: response(items.slice(0, Number(new URL(route.request().url()).searchParams.get('limit'))), items.length) }); });
  await page.route('**/api/city-news/read', route => { writes++; return route.fulfill({ json: { ok: true } }); });
  const panel = await open(page); await expect(panel.locator('li')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaNewsSockets(): number }).qaNewsSockets())).toBeGreaterThan(0);
  const before = reads; items = [event(task, 88), ...items];
  const update: RealtimeEvent = { id: bootstrap.eventCursor + 1, countryId: bootstrap.country.id, worldVersion: bootstrap.country.worldVersion + 1, type: 'task.comment_added', createdAt: new Date().toISOString(), payload: { taskId: task.id, cityId: task.cityId } };
  await page.evaluate(event => (window as unknown as { qaNewsFrame(event: unknown): void }).qaNewsFrame(event), update);
  await expect(panel.locator('li')).toHaveCount(2); expect(reads - before).toBe(1); expect(writes).toBe(0);
});
