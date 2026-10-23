import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { BootstrapDto, TaskCommentDto } from '../../src/shared/contracts';
import type { TaskCardDto, TaskCollectionPageDto, TaskListPageDto } from '../../src/shared/task-read-contracts';

test('a compact card opens first, then pages 1000 comments with retry and bounded visible rows', async ({ page }, info) => {
  const errors: string[] = [], reads: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.url().includes('/api/tasks/')) reads.push(request.url()); });
  expect((await page.request.post('/api/auth/login', { data: { email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo' } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json() as BootstrapDto;
  const tasks = await (await page.request.get(`/api/tasks/list-page?countryId=${bootstrap.country.id}&limit=1`)).json() as TaskListPageDto;
  const task = tasks.items[0];
  const card = await (await page.request.get(`/api/tasks/${task.id}/card?countryId=${bootstrap.country.id}`)).json() as TaskCardDto;
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/tasks/${task.id}/card?*`, async route => { await held; await route.fulfill({ json: { ...card, counts: { ...card.counts, comments: 1000 } } }); });
  let failNext = true;
  await page.route(`**/api/tasks/${task.id}/collections/comments?*`, async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'), start = cursor ? Number(cursor.slice(5)) : 0;
    if (start === 50 && failNext) { failNext = false; await route.fulfill({ status: 503, json: { message: 'Временно недоступно' } }); return; }
    const items: TaskCommentDto[] = Array.from({ length: 50 }, (_, i) => ({ id: `comment-${start + i}`, taskId: task.id,
      actor: 'Проверка', createdAt: card.updatedAt, body: `Комментарий ${start + i + 1}` }));
    await route.fulfill({ json: { kind: 'task.collection-page', version: 1, countryId: bootstrap.country.id, taskId: task.id, collection: 'comments', items, nextCursor: start + 50 < 1000 ? `page-${start + 50}` : null } });
  });
  await page.goto(`/task/${task.taskNumber}?countryId=${bootstrap.country.id}&taskId=${task.id}`);
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.locator('.task-load-state')).toContainText('Загружаем задачу');
  expect(reads.some(url => url.includes('/collections/comments'))).toBe(false); release();
  await expect(page.locator('#task-title')).toHaveText(task.title);
  expect(reads.filter(url => new RegExp(`/api/tasks/${task.id}(?:\\?|$)`).test(url))).toEqual([]);
  expect(reads.some(url => url.includes('/collections/comments'))).toBe(false);
  await page.getByRole('tab', { name: /Обсуждение/ }).click();
  await expect(page.locator('.comments article')).toHaveCount(50);
  await expect(page.locator('.comments')).toContainText('Комментарий 1');
  await page.getByRole('button', { name: 'Следующая страница: Ход работы' }).click();
  await expect(page.locator('.comments')).toContainText('Временно недоступно');
  await page.locator('.comments').getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('.comments article')).toHaveCount(50);
  await expect(page.locator('.comments')).toContainText('Комментарий 51');
  await page.getByRole('button', { name: 'Предыдущая страница: Ход работы' }).click();
  await expect(page.locator('.comments')).toContainText('Комментарий 1');
  expect(errors).toEqual([]);
  await info.attach('task-card-paging', { body: Buffer.from(JSON.stringify({ comments: 1000, maximumVisibleComments: 50, reads, errors })), contentType: 'application/json' });
});

test('an open task refreshes renamed and deleted dependency targets received through WebSocket', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket, sockets = new Set<WebSocket>(), upgraded = new Set<WebSocket>();
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); if (String(url).includes('/socket.io')) { sockets.add(this); this.addEventListener('close', () => { sockets.delete(this); upgraded.delete(this); }); } }
      override send(data: string | Blob | BufferSource) { super.send(data); if (data === '5') upgraded.add(this); }
    };
    Object.assign(window, { qaCardSockets: () => [...sockets].filter(socket => socket.readyState === NativeSocket.OPEN && upgraded.has(socket)).length,
      qaCardEvent: (event: unknown) => { for (const socket of sockets) if (socket.readyState === NativeSocket.OPEN && upgraded.has(socket)) socket.dispatchEvent(new MessageEvent('message', { data: `42${JSON.stringify(['world:event', event])}` })); } });
  });
  expect((await page.request.post('/api/auth/login', { data: { email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo' } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json() as BootstrapDto;
  const tasks = await (await page.request.get(`/api/tasks/list-page?countryId=${bootstrap.country.id}&limit=2`)).json() as TaskListPageDto;
  const [a, b] = tasks.items;
  const card = await (await page.request.get(`/api/tasks/${a.id}/card?countryId=${bootstrap.country.id}`)).json() as TaskCardDto;
  let title = b.title, deleted = false;
  await page.route(`**/api/tasks/${a.id}/card?*`, route => route.fulfill({ json: { ...card, counts: { ...card.counts, dependencies: deleted ? 0 : 1 } } }));
  await page.route(`**/api/tasks/${a.id}/collections/dependencies?*`, route => route.fulfill({ json: { kind: 'task.collection-page', version: 1, countryId: bootstrap.country.id, taskId: a.id, collection: 'dependencies', items: deleted ? [] : [{ id: b.id, taskNumber: b.taskNumber, title, status: b.status }], nextCursor: null } }));
  await page.goto(`/task/${a.taskNumber}?countryId=${bootstrap.country.id}&taskId=${a.id}`);
  await expect(page.getByRole('link', { name: `#${b.taskNumber} · ${title}`, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaCardSockets(): number }).qaCardSockets())).toBeGreaterThan(0);
  const emit = (type: string, offset: number) => page.evaluate(event => (window as unknown as { qaCardEvent(event: unknown): void }).qaCardEvent(event), { id: bootstrap.eventCursor + offset, worldVersion: bootstrap.country.worldVersion + offset, countryId: bootstrap.country.id, type, payload: { taskId: b.id, cityId: b.cityId }, createdAt: new Date().toISOString() });
  title = 'Новое имя зависимости'; await emit('task.renamed', 1);
  await expect(page.getByRole('link', { name: `#${b.taskNumber} · ${title}`, exact: true })).toBeVisible();
  deleted = true; await emit('task.deleted', 2);
  await expect(page.getByRole('link', { name: `#${b.taskNumber} · ${title}`, exact: true })).toHaveCount(0);
  await expect(page.locator('#task-title')).toHaveText(a.title);
});

test('task history shows allowed old and new values with real account labels and hides internal fields', async ({ page, hasTouch }, info) => {
  const errors: string[] = [], reads: URL[] = [];
  page.on('pageerror', error => errors.push(error.message));
  expect((await page.request.post('/api/auth/login', { data: { email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo' } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json() as BootstrapDto;
  const listing = await page.request.get(`/api/tasks/list-page?${new URLSearchParams({ countryId: bootstrap.country.id, limit: '50' })}`);
  expect(listing.ok()).toBe(true);
  const tasks = await listing.json() as TaskListPageDto;
  const task = tasks.items[0]!;
  expect(task).toBeTruthy();
  const cardResponse = await page.request.get(`/api/tasks/${task.id}/card?countryId=${bootstrap.country.id}`);
  expect(cardResponse.ok()).toBe(true);
  const card = await cardResponse.json() as TaskCardDto;
  expect(card.counts.events).toBeGreaterThan(0);
  const historyPath = `/api/tasks/${task.id}/collections/events`;
  const originalResponse = await page.request.get(`${historyPath}?${new URLSearchParams({ countryId: bootstrap.country.id, limit: '50' })}`);
  expect(originalResponse.ok()).toBe(true);
  const originalPage = await originalResponse.json() as TaskCollectionPageDto<'events'>;
  expect(originalPage.items.length).toBeGreaterThan(0);
  const forbidden = ['PRIVATE_HISTORY_MARKDOWN_BEFORE', 'PRIVATE_HISTORY_MARKDOWN_AFTER', 'PRIVATE_HISTORY_TOKEN_BEFORE', 'PRIVATE_HISTORY_TOKEN_AFTER', 'PRIVATE_HISTORY_INTERNAL_BEFORE', 'PRIVATE_HISTORY_INTERNAL_AFTER'];
  const afterTitle = 'Проверенный новый заголовок хроники';
  const changes = [
    { field: 'title', before: task.title, after: afterTitle },
    { field: 'progress', before: 30, after: 80 },
    { field: 'status', before: 'IN_PROGRESS', after: 'TESTING' },
    { field: 'assignee', before: null, after: bootstrap.user.id, afterLabel: bootstrap.user.name },
    { field: 'description', before: `# ${forbidden[0]}`, after: `# ${forbidden[1]}` },
    { field: 'actorUserId', before: null, after: bootstrap.user.id },
    { field: 'token', before: forbidden[2], after: forbidden[3] },
    { field: 'systemAnalysis', before: forbidden[4], after: forbidden[5] },
  ];
  const controlled: TaskCollectionPageDto<'events'> = { ...originalPage, items: originalPage.items.map((event, index) => index === 0
    ? { ...event, type: 'FIELDS_UPDATED', actor: bootstrap.user.name, actorUserId: bootstrap.user.id, details: { changes, internalToken: forbidden[2] } } : event) };
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === historyPath) reads.push(url); });
  await page.route(`**${historyPath}?*`, route => route.fulfill({ json: controlled }));
  await page.goto(`/task/${task.taskNumber}?countryId=${bootstrap.country.id}&taskId=${task.id}`);
  await expect(page.locator('#task-title')).toHaveText(card.title);
  expect(reads).toHaveLength(0);
  const tab = page.getByRole('tab', { name: 'История', exact: true });
  if (hasTouch) await tab.tap(); else await tab.click();
  const panel = page.getByRole('tabpanel', { name: 'История', exact: true });
  await expect(panel).toBeVisible();
  const articles = panel.locator('.task-history article');
  await expect(articles).toHaveCount(controlled.items.length);
  const entry = articles.first(), lines = entry.locator('.task-history-change');
  await expect(lines).toHaveCount(4);
  const expected = [
    { label: 'Название', before: task.title, after: afterTitle },
    { label: 'Прогресс', before: '30%', after: '80%' },
    { label: 'Этап', before: 'В работе', after: 'Приёмка' },
    { label: 'Ответственный', before: 'Не задано', after: bootstrap.user.name },
  ];
  for (const change of expected) {
    const row = lines.filter({ hasText: new RegExp(`^${change.label}:`) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('span').nth(0)).toHaveText(change.before);
    await expect(row.locator('span').nth(1)).toHaveText(change.after);
    await expect(row).toContainText('→');
  }
  for (const marker of [...forbidden, bootstrap.user.id, 'actorUserId', 'internalToken', 'systemAnalysis']) await expect(panel).not.toContainText(marker);
  await expect(panel).not.toContainText(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  expect(reads).toHaveLength(1);
  expect(reads[0]!.searchParams.get('countryId')).toBe(bootstrap.country.id);
  expect(reads[0]!.searchParams.get('limit')).toBe('50');
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('task-history-values.png') });
  const evidencePath = info.outputPath('task-history-values.json');
  await writeFile(evidencePath, JSON.stringify({ realCard: true, realPageShape: true, controlledEventFields: ['type', 'actor', 'actorUserId', 'details'], expected, visibleChanges: await lines.allTextContents(), forbiddenVisible: false, eventReads: reads.map(url => ({ countryId: url.searchParams.get('countryId'), limit: url.searchParams.get('limit') })), errors }, null, 2));
  await info.attach('task-history-values', { path: evidencePath, contentType: 'application/json' });
});
