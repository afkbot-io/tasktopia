import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { readFile } from "node:fs/promises";

describe("country lifetime task numbers", { timeout: 30_000 }, () => {
  let db: Db; let service: AppService; let countryId: string; let cityId: string; let districtId: string;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    countryId = (await registerUser(db, { email: "lifetime-numbers@example.test", name: "Task numbers", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    cityId = (await service.createCity(countryId, { name: "Number city", idempotencyKey: "number-city" })).id;
    districtId = (await service.createDistrict(countryId, { cityId, name: "Number district", activate: true, idempotencyKey: "number-district" })).id;
  });
  afterEach(async () => { await db?.close(); });
  const create = (key: string) => service.createTask(countryId, { cityId, districtId, title: `Task ${key}`, estimate: 1, idempotencyKey: key });

  it("never reuses the highest number after the last task is deleted", async () => {
    const original = await create("original");
    await service.deleteTask(countryId, { taskId: original.id, confirmTitle: original.title, idempotencyKey: "delete-original" });
    const replacement = await create("replacement");
    expect(replacement.taskNumber).toBeGreaterThan(original.taskNumber);
    expect((await service.listWorldFeatures(countryId))[0]?.siteMarker?.snapshot.taskNumber).toBe(original.taskNumber);
  });

  it("serializes concurrent task creation into unique increasing numbers", async () => {
    const tasks = await Promise.all(Array.from({ length: 6 }, (_, index) => create(`concurrent-${index}`)));
    const numbers = tasks.map(task => task.taskNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(tasks.map(task => task.id)).size).toBe(6);
  });

  it("protects legacy MAX+1 writers and limits the explicit restore override to its transaction", async () => {
    const task = await create("legacy-template");
    const template = await db.prepare("SELECT * FROM tasks_v3 WHERE id=?").get(task.id);
    await db.prepare("UPDATE countries SET task_number_counter=100 WHERE id=?").run(countryId);
    const insert = async (number: number) => Number((await db.prepare(`INSERT INTO tasks_v3
      SELECT (jsonb_populate_record(NULL::tasks_v3,?::jsonb || jsonb_build_object('id',?::text,'task_number',?::integer))).*
      RETURNING task_number`).get(JSON.stringify(template), crypto.randomUUID(), number))?.task_number);
    await db.transaction(async () => {
      await db.exec("SET LOCAL tasktopia.preserve_task_numbers='on'");
      expect(await insert(2)).toBe(2);
    });
    // This is the exact legacy writer's proposed MAX(active)+1 after rollback.
    const max = Number((await db.prepare(`SELECT COALESCE(MAX(task.task_number),0)+1 AS next
      FROM tasks_v3 task JOIN cities_v3 city ON city.id=task.city_id WHERE city.country_id=?`).get(countryId))?.next);
    expect(max).toBe(3);
    expect(await insert(max)).toBe(101);
    expect(Number((await db.prepare("SELECT task_number_counter FROM countries WHERE id=?").get(countryId))?.task_number_counter)).toBe(101);
    // Untrusted explicit inserts cannot resurrect an older, currently unused number either.
    expect(await insert(3)).toBe(102);
  });

  it("backfills the lifetime counter from permanent sites, deleted receipts and nested event history without rewriting them", async () => {
    const task = await create("pre-upgrade");
    await db.exec(`DROP TRIGGER tasks_v3_country_number_allocator ON tasks_v3;
      DROP FUNCTION allocate_country_task_number_v1();
      ALTER TABLE tasks_v3 ALTER COLUMN task_number DROP DEFAULT;
      ALTER TABLE countries DROP COLUMN task_number_counter,DROP COLUMN generation_last_served_at;
      DROP INDEX world_generation_jobs_v1_country_fifo_idx;
      DROP INDEX task_events_v7_task_created_idx;
      DROP INDEX task_defects_v18_task_created_idx;
      DROP INDEX task_attachments_v1_task_created_idx;`);
    await db.prepare("UPDATE tasks_v3 SET task_number=41 WHERE id=?").run(task.id);
    await service.deleteTask(countryId, { taskId: task.id, confirmTitle: task.title, idempotencyKey: "pre-upgrade-delete" });
    const historicalReceipt = { id: crypto.randomUUID(), taskNumber: 77, title: "Deleted historical task" };
    await db.prepare(`INSERT INTO idempotency(country_id,operation,idempotency_key,request_hash,response_json,created_at)
      VALUES(?,'task.create.v3','historical-number','unchanged-hash',?::jsonb,now())`).run(countryId, JSON.stringify(historicalReceipt));
    await db.prepare(`INSERT INTO events(country_id,type,world_version,payload_json,created_at)
      VALUES(?,'task.deleted',1,?::jsonb,now())`).run(countryId, JSON.stringify({ building: { taskNumber: 99 } }));
    await db.exec(await readFile("migrations/postgres/0043_task_numbers_queue_and_read_indexes.sql", "utf8"));
    expect(Number((await db.prepare("SELECT task_number_counter FROM countries WHERE id=?").get(countryId))?.task_number_counter)).toBe(99);
    expect((await create("post-upgrade")).taskNumber).toBe(100);
    const stored = await db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND idempotency_key='historical-number'").get(countryId);
    expect(stored?.request_hash).toBe("unchanged-hash");
    expect(stored?.response_json).toEqual(historicalReceipt);
    expect((await service.listWorldFeatures(countryId))[0]?.siteMarker?.snapshot.taskNumber).toBe(41);
  });
});
