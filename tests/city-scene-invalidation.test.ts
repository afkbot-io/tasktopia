import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppService } from '../src/server/app-service';
import { registerUser } from '../src/server/auth';
import { createTestDb, type Db } from '../src/server/db';
import type { RealtimeEvent } from '../src/shared/contracts';

describe('city scene cache content and publication fences', { timeout: 30_000 }, () => {
  let db: Db;
  let countryId: string;
  let writer: AppService;
  let reader: AppService;
  const events: RealtimeEvent[] = [];
  beforeEach(async () => {
    db = await createTestDb();
    countryId = (await registerUser(db, { email: 'scene-cache@example.test', name: 'Cache', password: 'password123' })).user.countryId;
    await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(countryId);
    events.length = 0;
    reader = new AppService(db);
    writer = new AppService(db, event => events.push(event));
  });
  afterEach(async () => { vi.restoreAllMocks(); await db?.close(); });

  async function city(name: string) {
    const city = await writer.createCity(countryId, { name, idempotencyKey: name });
    const district = await writer.createDistrict(countryId, { cityId: city.id, name, activate: true, idempotencyKey: `${name}-district` });
    const task = await writer.createTask(countryId, { cityId: city.id, districtId: district.id, title: name, estimate: 1, idempotencyKey: `${name}-task` });
    return { city, task };
  }

  it('advances comment and document publication fences without rebuilding spatial content', async () => {
    const a = await city('Alpha');
    const before = await reader.getCityScene(countryId, a.city.id);
    await writer.addTaskComment(countryId, { taskId: a.task.id, body: 'New comment', idempotencyKey: 'comment' });
    reader.acceptExternalEvent(events.at(-1)!);
    const commented = await reader.getCityScene(countryId, a.city.id);
    expect(commented.chunks[0]!.publishedVersion).toBe(before.chunks[0]!.publishedVersion + 1);
    expect(commented.sceneRevision).toBe(before.sceneRevision);
    expect(commented.chunks[0]!.tasks).toBe(before.chunks[0]!.tasks);
    await writer.upsertTaskDocument(countryId, { taskId: a.task.id, fileName: 'review.md', title: 'Review', content: 'Material', idempotencyKey: 'document' });
    reader.acceptExternalEvent(events.at(-1)!);
    const documented = await reader.getCityScene(countryId, a.city.id);
    expect(documented.chunks[0]!.tasks).toBe(before.chunks[0]!.tasks);
    expect(documented.chunks[0]!.publishedVersion).toBe(commented.chunks[0]!.publishedVersion + 1);
  });

  it('refreshes the affected city and preserves another city after a local title update', async () => {
    const a = await city('Alpha'), b = await city('Beta');
    const oldA = await reader.getCityScene(countryId, a.city.id), oldB = await reader.getCityScene(countryId, b.city.id);
    await writer.renameTask(countryId, { taskId: a.task.id, title: 'Changed title', idempotencyKey: 'rename' });
    reader.acceptExternalEvent(events.at(-1)!);
    const nextA = await reader.getCityScene(countryId, a.city.id), nextB = await reader.getCityScene(countryId, b.city.id);
    expect(nextA.sceneRevision).not.toBe(oldA.sceneRevision);
    expect(nextA.chunks.flatMap(c => c.tasks).find(t => t.id === a.task.id)?.title).toBe('Changed title');
    expect(nextB.sceneRevision).toBe(oldB.sceneRevision);
    expect(nextB.chunks[0]!.tasks).toBe(oldB.chunks[0]!.tasks);
  });

  it('never promotes across an unknown event gap, even when the latest event is a comment', async () => {
    const a = await city('Alpha');
    const before = await reader.getCityScene(countryId, a.city.id);
    await writer.renameTask(countryId, { taskId: a.task.id, title: 'Missed rename', idempotencyKey: 'missed' });
    await writer.addTaskComment(countryId, { taskId: a.task.id, body: 'Later comment', idempotencyKey: 'later' });
    reader.acceptExternalEvent(events.at(-1)!);
    const after = await reader.getCityScene(countryId, a.city.id);
    expect(after.chunks[0]!.publishedVersion).toBe(before.chunks[0]!.publishedVersion + 2);
    expect(after.chunks.flatMap(c => c.tasks).find(t => t.id === a.task.id)?.title).toBe('Missed rename');
  });

  it('invalidates both ends when the committed event changes transport topology', async () => {
    const a = await city('Alpha'), b = await city('Beta');
    const oldA = await reader.getCityScene(countryId, a.city.id), oldB = await reader.getCityScene(countryId, b.city.id);
    await writer.renameTask(countryId, { taskId: a.task.id, title: 'Topology update', idempotencyKey: 'transport' });
    reader.acceptExternalEvent({ ...events.at(-1)!, payload: { ...events.at(-1)!.payload, transportTopologyChanged: true } });
    const nextA = await reader.getCityScene(countryId, a.city.id), nextB = await reader.getCityScene(countryId, b.city.id);
    expect(nextA.chunks[0]!.tasks).not.toBe(oldA.chunks[0]!.tasks);
    expect(nextB.chunks[0]!.tasks).not.toBe(oldB.chunks[0]!.tasks);
  });

  it('keeps an unrelated country layout warm and ignores delayed duplicate invalidations', async () => {
    const a = await city('Alpha');
    const foreign = (await registerUser(db, { email: 'foreign-cache@example.test', name: 'Foreign', password: 'password123' })).user.countryId;
    await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(foreign);
    const b = await writer.createCity(foreign, { name: 'Foreign city', idempotencyKey: 'foreign-city' });
    const district = await writer.createDistrict(foreign, { cityId: b.id, name: 'Foreign district', activate: true, idempotencyKey: 'foreign-district' });
    const task = await writer.createTask(foreign, { cityId: b.id, districtId: district.id, title: 'Foreign task', estimate: 1, idempotencyKey: 'foreign-task' });
    const beforeA = await reader.getCityScene(countryId, a.city.id), beforeB = await reader.getCityScene(foreign, b.id);
    await reader.getTask(foreign, task.id);
    await writer.renameTask(countryId, { taskId: a.task.id, title: 'Local change', idempotencyKey: 'local-change' });
    const rename = events.at(-1)!;
    reader.acceptExternalEvent(rename);
    const queries = vi.spyOn(db, 'prepare');
    await reader.getTask(foreign, task.id);
    expect(queries.mock.calls.some(([sql]) => sql.includes('SELECT l.*,') && sql.includes('jsonb_agg'))).toBe(false);
    expect(await reader.getCityScene(foreign, b.id)).toBe(beforeB);
    const afterA = await reader.getCityScene(countryId, a.city.id);
    expect(afterA.sceneRevision).not.toBe(beforeA.sceneRevision);
    reader.acceptExternalEvent(rename);
    expect(await reader.getCityScene(countryId, a.city.id)).toBe(afterA);
  });
});
