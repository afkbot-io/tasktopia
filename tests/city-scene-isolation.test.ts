import { afterEach, expect, it } from 'vitest';
import { AppService } from '../src/server/app-service';
import { createTestDb, type Db } from '../src/server/db';
import { registerUser } from '../src/server/auth';
import { readActiveBlockLayout } from '../src/server/world/active-block-layout';
let db: Db;
afterEach(async () => { await db?.close(); });
it('scopes all city materials before rendering, even with a shared country chunk cache', async () => {
  db = await createTestDb();
  const service = new AppService(db);
  const countryId = (await registerUser(db, { email: 'isolated-city@test.local', name: 'Scene', password: 'password123' })).user.countryId;
  await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(countryId);
  const a = await service.createCity(countryId, { name: 'Viewed', idempotencyKey: 'city-a' });
  const b = await service.createCity(countryId, { name: 'Neighbour', idempotencyKey: 'city-b' });
  const da = await service.createDistrict(countryId, { cityId: a.id, name: 'Local', activate: true, idempotencyKey: 'district-a' });
  const dbb = await service.createDistrict(countryId, { cityId: b.id, name: 'Foreign', activate: true, idempotencyKey: 'district-b' });
  const local = await service.createTask(countryId, { cityId: a.id, districtId: da.id, title: 'Local task', estimate: 1, idempotencyKey: 'task-a' });
  const foreign = await service.createTask(countryId, { cityId: b.id, districtId: dbb.id, title: 'Foreign task', estimate: 1, idempotencyKey: 'task-b' });
  const ruined = await service.createTask(countryId, { cityId: b.id, districtId: dbb.id, title: 'Foreign ruin', estimate: 1, idempotencyKey: 'ruin-b' });
  await service.deleteTask(countryId, { taskId: ruined.id, confirmTitle: ruined.title, idempotencyKey: 'delete-b' });
  const la = (await readActiveBlockLayout(db, a.id))!, lb = (await readActiveBlockLayout(db, b.id))!;
  // Force the same loaded envelope; membership, not camera boundaries, must isolate cities.
  const bounds = { minX: Math.min(la.bounds.minX, lb.bounds.minX), minY: Math.min(la.bounds.minY, lb.bounds.minY),
    maxX: Math.max(la.bounds.maxX, lb.bounds.maxX), maxY: Math.max(la.bounds.maxY, lb.bounds.maxY) };
  await db.prepare('UPDATE cities_v3 SET bounds_json=?::jsonb WHERE id=?').run(JSON.stringify(bounds), a.id);
  const reader = new AppService(db);
  await reader.getChunkPayload(countryId, Math.floor(foreign.origin.x / 64), Math.floor(foreign.origin.y / 64));
  const scene = await reader.getCityScene(countryId, a.id);
  expect(new Set(scene.chunks.flatMap(c => c.tasks.map(t => t.id)))).toEqual(new Set([local.id]));
  expect(scene.chunks.flatMap(c => c.districts).every(d => d.cityId === a.id)).toBe(true);
  expect(scene.chunks.flatMap(c => c.worldFeatures).every(f => f.cityId === a.id)).toBe(true);
  expect(scene.roadContext?.segments).toEqual(la.roadNetwork.segments);
  const foreignBlocks = new Set(lb.blocks.map(b => b.id));
  expect(scene.chunks.flatMap(c => c.blockPlaques ?? []).some(p => foreignBlocks.has(p.id))).toBe(false);
  expect(scene.chunks.flatMap(c => c.plannedSites ?? []).some(p => [...foreignBlocks].some(id => p.id.startsWith(id)))).toBe(false);
  const adjacent = await reader.getCityScene(countryId, b.id);
  expect(new Set(adjacent.chunks.flatMap(c => c.tasks.map(t => t.id)))).toEqual(new Set([foreign.id]));
  expect(adjacent.chunks.flatMap(c => c.worldFeatures).some(f => f.siteMarker?.kind === 'RUINED')).toBe(true);
  const country = await service.getCountry(countryId);
  await service.regenerateCountry(countryId, { confirmName: country.name, idempotencyKey: 'rebuild-isolated' });
  const rebuiltA = (await readActiveBlockLayout(db, a.id))!, rebuiltB = (await readActiveBlockLayout(db, b.id))!;
  for (const left of rebuiltA.blocks) for (const right of rebuiltB.blocks) {
    expect(left.origin.x + left.width <= right.origin.x || right.origin.x + right.width <= left.origin.x
      || left.origin.y + left.height <= right.origin.y || right.origin.y + right.height <= left.origin.y).toBe(true);
  }
  expect((await service.listTasks(countryId)).map(task => task.id).sort()).toEqual([local.id, foreign.id].sort());
  for (const [city, task] of [[a, local], [b, foreign]] as const) {
    const rebuilt = await service.getCityScene(countryId, city.id);
    expect(new Set(rebuilt.chunks.flatMap(chunk => chunk.tasks.map(item => item.id)))).toEqual(new Set([task.id]));
  }
}, 30000);
