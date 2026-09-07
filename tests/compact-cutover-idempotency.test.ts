import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { enqueueWorldGenerationJob, getWorldGenerationJob, PostgresWorldGenerationDispatcher, processNextWorldGenerationJob } from "../src/server/world-generation-jobs";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import type { TaskDto } from "../src/shared/contracts";
import { blockSlots } from "../src/shared/block-templates";

describe("compact cutover command identity", { timeout: 30_000 }, () => {
  let db: Db;
  let service: AppService;
  let countryId: string;

  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    countryId = (await registerUser(db, { email: "cutover-replay@example.test", name: "Builder", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
  });
  afterEach(async () => { await db?.close(); });

  it("reclaims an old committed task job without duplication and reprojects its retired geometry", async () => {
    const city = await service.createCity(countryId, { name: "Replay city", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "District", activate: true, idempotencyKey: "district" });
    const payload = { cityId: city.id, districtId: district.id, title: "Committed before worker crash", estimate: 1 as const, idempotencyKey: "old-task" };
    const job = await enqueueWorldGenerationJob(db, countryId, "task.create", payload.idempotencyKey, payload);
    await processNextWorldGenerationJob(db, service, "old-worker");
    const task = (await getWorldGenerationJob(db, job.id))!.result as TaskDto;
    const retired = { ...task, buildingType: "retired-large-building", origin: { x: 999, y: 999 },
      footprint: Array.from({ length: 18 * 14 }, (_, index) => ({ x: 999 + index % 18, y: 999 + Math.floor(index / 18) })) };
    // Rehearse the pre-cutover durable record, not a newly invented command key.
    await db.prepare("UPDATE idempotency SET operation=?,response_json=?::jsonb WHERE country_id=? AND idempotency_key=?")
      .run("task.create.v3", JSON.stringify(retired), countryId, payload.idempotencyKey);
    const before = await db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND operation=? AND idempotency_key=?")
      .get(countryId, "task.create.v3", payload.idempotencyKey);
    await db.prepare("UPDATE world_generation_jobs_v1 SET status='RUNNING',result_json=NULL,attempts=1,locked_by='old-worker',locked_at=now()-interval '1 hour' WHERE id=?")
      .run(job.id);

    expect(await processNextWorldGenerationJob(db, service, "new-worker")).toBe(true);
    expect(await service.listTasks(countryId)).toHaveLength(1);
    const replay = (await getWorldGenerationJob(db, job.id))!.result as TaskDto;
    expect(replay.id).toBe(task.id);
    expect(replay.origin).toEqual(task.origin);
    expect(replay.buildingType).toBe(task.buildingType);
    expect(replay.footprint).toHaveLength(36);
    expect(await db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND operation=? AND idempotency_key=?")
      .get(countryId, "task.create.v3", payload.idempotencyKey)).toEqual(before);
  });

  it("rehydrates an old status response without repeating its transition or history", async () => {
    const city = await service.createCity(countryId, { name: "Status city", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "District", activate: true, idempotencyKey: "district" });
    const task = await service.createTask(countryId, { cityId: city.id, title: "Status task", estimate: 1, idempotencyKey: "task" });
    const input = { taskId: task.id, status: "STARTED" as const, idempotencyKey: "old-status" };
    const started = await service.updateTaskStatus(countryId, input);
    await db.prepare("UPDATE idempotency SET response_json=?::jsonb WHERE country_id=? AND operation='task.status.v3' AND idempotency_key=?")
      .run(JSON.stringify({ ...started, buildingType: "retired-large-building", origin: { x: 999, y: 999 }, footprint: Array.from({ length: 252 }, () => ({ x: 999, y: 999 })) }), countryId, input.idempotencyKey);
    const revision = (await readActiveBlockLayout(db, city.id))!.revision;

    const replay = await service.updateTaskStatus(countryId, input);
    expect(replay.footprint).toHaveLength(36);
    expect(replay.origin).toEqual(task.origin);
    expect(replay.status).toBe("STARTED");
    expect(replay.events).toEqual(started.events);
    expect((await readActiveBlockLayout(db, city.id))!.revision).toBe(revision);
    expect((await service.listDistricts(countryId, city.id))[0]!.id).toBe(district.id);
  });

  it("rehydrates already completed dispatched jobs and never recreates a deleted result", async () => {
    const city = await service.createCity(countryId, { name: "Dispatched city", idempotencyKey: "city" });
    await service.createDistrict(countryId, { cityId: city.id, name: "District", activate: true, idempotencyKey: "district" });
    const input = { cityId: city.id, title: "Dispatched task", estimate: 1 as const, idempotencyKey: "dispatched-task" };
    const job = await enqueueWorldGenerationJob(db, countryId, "task.create", input.idempotencyKey, input);
    await processNextWorldGenerationJob(db, service, "worker");
    const current = (await getWorldGenerationJob(db, job.id))!.result as TaskDto;
    await db.prepare("UPDATE world_generation_jobs_v1 SET result_json=?::jsonb WHERE id=?")
      .run(JSON.stringify({ ...current, buildingType: "retired-large-building", origin: { x: 999, y: 999 }, footprint: [] }), job.id);
    const dispatched = new AppService(db, undefined, "data/uploads", new PostgresWorldGenerationDispatcher(db, 0, 1));

    const replay = await dispatched.createTask(countryId, input);
    expect(replay.id).toBe(current.id);
    expect(replay.origin).toEqual(current.origin);
    expect(replay.footprint).toHaveLength(36);
    const deletion = { taskId: current.id, confirmTitle: current.title, idempotencyKey: "delete" };
    const receipt = await service.deleteTask(countryId, deletion);
    await db.prepare("UPDATE idempotency SET operation='task.delete.v1' WHERE country_id=? AND idempotency_key=?")
      .run(countryId, deletion.idempotencyKey);
    expect(await service.deleteTask(countryId, deletion)).toEqual(receipt);
    await expect(dispatched.createTask(countryId, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The non-dispatched entrypoint shares the existing command, not a new insert.
    const storedPayload = (await getWorldGenerationJob(db, job.id))!.payload as typeof input;
    await expect(service.createTask(countryId, storedPayload)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service.listTasks(countryId)).toEqual([]);
    expect((await getWorldGenerationJob(db, job.id))!.status).toBe("COMPLETED");
  });

  it("preserves city, district and regeneration command identities without stale boundaries", async () => {
    const cityInput = { name: "Identity city", idempotencyKey: "old-city" };
    const city = await service.createCity(countryId, cityInput);
    const districtInput = { cityId: city.id, name: "Identity district", activate: true, idempotencyKey: "old-district" };
    const district = await service.createDistrict(countryId, districtInput);
    await service.createTask(countryId, { cityId: city.id, title: "Identity task", estimate: 1, idempotencyKey: "task" });
    await db.prepare("UPDATE idempotency SET operation='city.create.v3',response_json=?::jsonb WHERE country_id=? AND idempotency_key=?")
      .run(JSON.stringify({ ...city, bounds: { minX: 999, minY: 999, maxX: 999, maxY: 999 } }), countryId, cityInput.idempotencyKey);
    await db.prepare("UPDATE idempotency SET operation='district.create.v3',response_json=?::jsonb WHERE country_id=? AND idempotency_key=?")
      .run(JSON.stringify({ ...district, cells: [{ x: 999, y: 999 }], lots: [] }), countryId, districtInput.idempotencyKey);

    expect(await service.createCity(countryId, cityInput)).toEqual((await service.listCities(countryId))[0]);
    const replay = await service.createDistrict(countryId, districtInput);
    expect(replay.id).toBe(district.id);
    expect(replay.lots!.length).toBeGreaterThan(0);
    const layoutBeforeRegeneration = (await readActiveBlockLayout(db, city.id))!;
    const expectedLots = layoutBeforeRegeneration.blocks.flatMap(block => blockSlots(block).map(slot => ({
      id: `${block.id}:${slot.key}`, width: slot.footprintBounds.maxX - slot.origin.x + 1,
      height: slot.footprintBounds.maxY - slot.origin.y + 1,
    })));
    expect(replay.lots!.map(lot => ({ id: lot.id, width: lot.width, height: lot.height }))).toEqual(expectedLots);
    expect(new Set(expectedLots.map(lot => `${lot.width}:${lot.height}`)).size).toBeGreaterThan(1);
    await expect(service.createCity(countryId, { ...cityInput, name: "Different input" })).rejects.toMatchObject({ code: "CONFLICT" });
    const country = await service.getCountry(countryId);
    const regeneration = { confirmName: country.name, idempotencyKey: "old-regeneration" };
    const result = await service.regenerateCountry(countryId, regeneration);
    await db.prepare("UPDATE idempotency SET operation='country.regenerate.v1' WHERE country_id=? AND idempotency_key=?")
      .run(countryId, regeneration.idempotencyKey);
    const revision = (await readActiveBlockLayout(db, city.id))!.revision;
    expect(await service.regenerateCountry(countryId, regeneration)).toEqual(result);
    expect((await readActiveBlockLayout(db, city.id))!.revision).toBe(revision);
    expect(await service.listCities(countryId)).toHaveLength(1);
    expect(await service.listDistricts(countryId, city.id)).toHaveLength(1);
    const deletion = { districtId: district.id, confirmName: district.name, idempotencyKey: "delete-district" };
    const receipt = await service.deleteDistrict(countryId, deletion);
    await db.prepare("UPDATE idempotency SET operation='district.delete.v1' WHERE country_id=? AND idempotency_key=?")
      .run(countryId, deletion.idempotencyKey);
    expect(await service.deleteDistrict(countryId, deletion)).toEqual(receipt);
  });
});
