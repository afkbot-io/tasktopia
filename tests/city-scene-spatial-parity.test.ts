import { afterEach, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import * as spatial from "../src/server/world/scene-spatial-index";

let db: Db;
afterEach(async () => { vi.restoreAllMocks(); await db?.close(); });

it("keeps the exact full-city wire content when replacing repeated global scans with page candidates", async () => {
  db = await createTestDb();
  const countryId = (await registerUser(db, { email: "scene-parity@example.test", name: "Scene", password: "password123" })).user.countryId;
  await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
  const service = new AppService(db);
  const city = await service.createCity(countryId, { name: "Spatial parity", idempotencyKey: "city" });
  const district = await service.createDistrict(countryId, { cityId: city.id, name: "Cross-page", activate: true, idempotencyKey: "district" });
  const first = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Origin", estimate: 1, idempotencyKey: "task" });
  await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||jsonb_build_object(
    'id',gen_random_uuid()::text,'task_number',0,'title','Parity '||n,
    'service_role',NULL,'service_trigger',NULL,'service_role_assigned',false))).*
    FROM tasks_v3 t CROSS JOIN generate_series(2,100) n WHERE t.id=?`).run(first.id);
  await synchronizeCityBlocks(db, countryId, city.id);
  const indexed = await new AppService(db).getCityScene(countryId, city.id);
  expect(indexed.chunks.length).toBeGreaterThan(4);
  expect(new Set(indexed.chunks.flatMap(chunk => chunk.tasks.map(task => task.id))).size).toBe(100);
  // The previous implementation passed the whole snapshot into every page.
  // Reuse that public projection to compare complete wire content, including
  // surfaces, paths, planned parcels, plaques, hashes and decoration halos.
  vi.spyOn(spatial, "createSceneSpatialIndex").mockImplementation(source => ({ forChunk: () => source }));
  const reference = await new AppService(db).getCityScene(countryId, city.id);
  expect(indexed).toEqual(reference);
}, 30_000);
