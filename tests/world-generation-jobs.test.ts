import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import {
  enqueueWorldGenerationJob,
  getWorldGenerationJob,
  PostgresWorldGenerationDispatcher,
  processNextWorldGenerationJob,
} from "../src/server/world-generation-jobs";

describe("durable world generation jobs", { timeout: 20_000 }, () => {
  let db: Db;
  let countryId: string;

  beforeEach(async () => {
    db = await createTestDb();
    countryId = (await registerUser(db, {
      email: "generation-jobs@example.com", name: "Jobs", password: "password123",
    })).user.countryId;
  });
  afterEach(async () => db?.close());

  it("claims one idempotent command once and publishes its result", async () => {
    const payload = { name: "Queued city", idempotencyKey: "queued-city" };
    const first = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    const duplicate = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    expect(duplicate.id).toBe(first.id);

    const service = new AppService(db);
    const claims = await Promise.all([
      processNextWorldGenerationJob(db, service, "worker-a"),
      processNextWorldGenerationJob(db, service, "worker-b"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await getWorldGenerationJob(db, first.id)).toMatchObject({
      status: "COMPLETED", attempts: 1, result: { name: "Queued city" },
    });
    const cityCount = await db.prepare("SELECT COUNT(*) AS count FROM cities_v3 WHERE country_id=?").get<{ count: string }>(countryId);
    expect(Number(cityCount?.count)).toBe(1);
  });

  it("retries a failed lease safely and lets the dispatcher return the completed result", async () => {
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 5_000, 10);
    const result = dispatcher.execute<{ name: string }>(countryId, "city.create", "retry-city", {
      name: "Retry city", idempotencyKey: "retry-city",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    await processNextWorldGenerationJob(db, new AppService(db), "worker-retry");

    await expect(result).resolves.toMatchObject({ name: "Retry city" });
  });

  it("returns a failed attempt to the queue and completes it idempotently on retry", async () => {
    const payload = { name: "Recovered city", idempotencyKey: "recovered-city" };
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    const createCity = vi.fn()
      .mockRejectedValueOnce(new Error("worker process died"))
      .mockResolvedValueOnce({ name: payload.name });
    const service = { createCity } as unknown as AppService;

    await processNextWorldGenerationJob(db, service, "worker-first");
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "PENDING", attempts: 1 });
    await processNextWorldGenerationJob(db, service, "worker-second");
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({
      status: "COMPLETED", attempts: 2, result: { name: payload.name },
    });
  });

  it("returns an accepted job contract when bounded waiting expires", async () => {
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 0, 1);
    const pending = dispatcher.execute(countryId, "city.create", "accepted-city", {
      idempotencyKey: "accepted-city", name: "Accepted city",
    });
    await expect(pending).rejects.toMatchObject({
      code: "GENERATION_PENDING",
      job: { countryId, operation: "city.create", status: "PENDING" },
    });
  });

  it("compares idempotent payloads canonically instead of depending on object key order", async () => {
    const first = await enqueueWorldGenerationJob(db, countryId, "city.create", "canonical-city", {
      idempotencyKey: "canonical-city", profile: { goal: "ship", description: "fast" }, name: "Canonical city",
    });
    const duplicate = await enqueueWorldGenerationJob(db, countryId, "city.create", "canonical-city", {
      name: "Canonical city", profile: { description: "fast", goal: "ship" }, idempotencyKey: "canonical-city",
    });
    expect(duplicate.id).toBe(first.id);
  });

  it("normalizes undefined optional fields before persisting and comparing an idempotent payload", async () => {
    const payload = {
      cityId: crypto.randomUUID(),
      title: "Queued task",
      estimate: 2,
      dueAt: undefined,
      assigneeUserId: undefined,
      forUserId: undefined,
      parkVariant: undefined,
      idempotencyKey: "task-with-omitted-optionals",
    };

    const first = await enqueueWorldGenerationJob(
      db, countryId, "task.create", payload.idempotencyKey, payload,
    );
    const duplicate = await enqueueWorldGenerationJob(
      db, countryId, "task.create", payload.idempotencyKey, payload,
    );

    expect(duplicate.id).toBe(first.id);
    expect(first.payload).toEqual({
      cityId: payload.cityId,
      title: payload.title,
      estimate: payload.estimate,
      idempotencyKey: payload.idempotencyKey,
    });
    const count = await db.prepare(`SELECT COUNT(*)::integer AS count FROM world_generation_jobs_v1
      WHERE country_id = ? AND operation = ? AND idempotency_key = ?`)
      .get<{ count: number }>(countryId, "task.create", payload.idempotencyKey);
    expect(count?.count).toBe(1);
  });

  it("still rejects a reused key when the normalized payload changes", async () => {
    const idempotencyKey = "task-normalized-conflict";
    await enqueueWorldGenerationJob(db, countryId, "task.create", idempotencyKey, {
      title: "Original task", dueAt: undefined, idempotencyKey,
    });

    await expect(enqueueWorldGenerationJob(db, countryId, "task.create", idempotencyKey, {
      title: "Changed task", dueAt: undefined, idempotencyKey,
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const nullKey = "task-null-remains-meaningful";
    await enqueueWorldGenerationJob(db, countryId, "task.create", nullKey, {
      title: "Null-sensitive task", dueAt: undefined, idempotencyKey: nullKey,
    });
    await expect(enqueueWorldGenerationJob(db, countryId, "task.create", nullKey, {
      title: "Null-sensitive task", dueAt: null, idempotencyKey: nullKey,
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("heartbeats a long-running job so another worker cannot reclaim its lease", async () => {
    const payload = { name: "Slow city", idempotencyKey: "slow-city" };
    await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    const slowService = {
      createCity: vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 120));
        return { name: payload.name };
      }),
    } as unknown as AppService;
    const first = processNextWorldGenerationJob(db, slowService, "worker-slow", 30);
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    expect(await processNextWorldGenerationJob(db, slowService, "worker-impatient", 30)).toBe(false);
    await expect(first).resolves.toBe(true);
    expect(slowService.createCity).toHaveBeenCalledTimes(1);
  });
});
