import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService, DomainError } from "../src/server/app-service";
import { createHash } from "node:crypto";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import {
  enqueueWorldGenerationJob,
  getWorldGenerationJob,
  PostgresWorldGenerationDispatcher,
  processNextWorldGenerationJob,
  subscribeToWorldGenerationJobs,
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
    await vi.waitFor(async () => {
      const queued = await db.prepare(`SELECT status FROM world_generation_jobs_v1
        WHERE country_id = ? AND operation = ? AND idempotency_key = ?`)
        .get<{ status: string }>(countryId, "city.create", "retry-city");
      expect(queued?.status).toBe("PENDING");
    }, { timeout: 5_000, interval: 10 });
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

  it("recovers a committed command after its final worker attempt lost the result", async () => {
    const payload = { name: "Final recovery", idempotencyKey: "final-committed" };
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    const service = new AppService(db);
    const city = await service.createCity(countryId, job.payload as Parameters<AppService["createCity"]>[1]);
    await db.prepare(`UPDATE world_generation_jobs_v1 SET status='RUNNING', attempts=max_attempts,
      locked_by='dead-worker', locked_at=now()-interval '20 minutes' WHERE id=?`).run(job.id);
    expect(await processNextWorldGenerationJob(db, service, "recovery-worker")).toBe(true);
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "COMPLETED", attempts: 3, result: { id: city.id } });
    const count = await db.prepare("SELECT COUNT(*)::integer AS count FROM cities_v3 WHERE country_id=?").get<{ count: number }>(countryId);
    expect(count?.count).toBe(1);
  });

  it("terminates an expired final attempt without repeating an uncommitted command", async () => {
    const payload = { name: "Never committed", idempotencyKey: "final-uncommitted" };
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    await db.prepare(`UPDATE world_generation_jobs_v1 SET status='RUNNING', attempts=max_attempts,
      locked_by='dead-worker', locked_at=now()-interval '20 minutes' WHERE id=?`).run(job.id);
    const createCity = vi.fn();
    expect(await processNextWorldGenerationJob(db, { createCity } as unknown as AppService, "recovery-worker")).toBe(true);
    expect(createCity).not.toHaveBeenCalled();
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "FAILED", attempts: 3, error: { code: "GENERATION_LEASE_EXPIRED" } });
  });

  it("never recovers another payload stored under a conflicting idempotency key", async () => {
    const payload = { name: "Expected city", idempotencyKey: "final-conflict" };
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    await db.prepare(`INSERT INTO idempotency(country_id,operation,idempotency_key,request_hash,response_json,created_at)
      VALUES(?,'city.create.v3',?,?,?::jsonb,now())`).run(countryId, payload.idempotencyKey,
      createHash("sha256").update(JSON.stringify({ name: "Other city" })).digest("hex"), JSON.stringify({ id: "unrelated" }));
    await db.prepare(`UPDATE world_generation_jobs_v1 SET status='RUNNING', attempts=max_attempts,
      locked_by='dead-worker', locked_at=now()-interval '20 minutes' WHERE id=?`).run(job.id);
    const createCity = vi.fn();
    expect(await processNextWorldGenerationJob(db, { createCity } as unknown as AppService, "recovery-worker")).toBe(true);
    expect(createCity).not.toHaveBeenCalled();
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "FAILED", error: { code: "CONFLICT" } });
  });

  it("does not retry a deterministic domain failure as a transient worker error", async () => {
    const payload = { name: "No capacity", idempotencyKey: "domain-no-retry" };
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    const createCity = vi.fn().mockRejectedValue(new DomainError("CAPACITY_EXCEEDED", "No available site"));
    await processNextWorldGenerationJob(db, { createCity } as unknown as AppService, "domain-worker");
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "FAILED", attempts: 1, error: { code: "CAPACITY_EXCEEDED" } });
    expect(await processNextWorldGenerationJob(db, { createCity } as unknown as AppService, "next-worker")).toBe(false);
    expect(createCity).toHaveBeenCalledTimes(1);
  });

  it("shares status polling between concurrent identical callers while keeping individual wait limits", async () => {
    let statusReads = 0;
    const observedDb: Db = {
      prepare(query) {
        const statement = db.prepare(query);
        return { ...statement, async get(...parameters) {
          if (query === "SELECT * FROM world_generation_jobs_v1 WHERE id = ?") statusReads += 1;
          return statement.get(...parameters);
        } };
      },
      exec: db.exec.bind(db), transaction: db.transaction.bind(db), close: db.close.bind(db),
    };
    const dispatcher = new PostgresWorldGenerationDispatcher(observedDb, 80, 10);
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => dispatcher.execute(
      countryId, "city.create", "shared-polling", { name: "Shared polling", idempotencyKey: "shared-polling" })));
    expect(results).toHaveLength(12);
    for (const result of results) expect(result).toMatchObject({ status: "rejected", reason: { code: "GENERATION_PENDING" } });
    expect(statusReads).toBeLessThanOrEqual(16);
  });

  it("uses a committed completion notification without waiting for the slow fallback poll", async () => {
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 1_000, 10_000);
    const subscription = await subscribeToWorldGenerationJobs(process.env.TEST_DATABASE_URL!, id => dispatcher.notify(id));
    try {
      const pending = dispatcher.execute<{ name: string }>(countryId, "city.create", "notify-completion",
        { name: "Notification result", idempotencyKey: "notify-completion" });
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      await vi.waitFor(async () => {
        expect(await db.prepare("SELECT id FROM world_generation_jobs_v1 WHERE country_id=? AND idempotency_key=?")
          .get(countryId, "notify-completion")).toBeDefined();
      }, { interval: 10 });
      await processNextWorldGenerationJob(db,
        { createCity: vi.fn().mockResolvedValue({ name: "Notification result" }) } as unknown as AppService, "notification-worker");
      expect(await outcome).toEqual({ value: { name: "Notification result" } });
    } finally { await subscription.close(); await dispatcher.close(); }
  });

  it("allows a later caller to keep waiting after the first caller reaches its deadline", async () => {
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 120, 10);
    const payload = { name: "Independent deadlines", idempotencyKey: "independent-deadlines" };
    const first = dispatcher.execute(countryId, "city.create", payload.idempotencyKey, payload)
      .then(value => ({ value }), error => ({ error }));
    await new Promise<void>(resolve => setTimeout(resolve, 80));
    const second = dispatcher.execute(countryId, "city.create", payload.idempotencyKey, payload)
      .then(value => ({ value }), error => ({ error }));
    expect(await first).toMatchObject({ error: { code: "GENERATION_PENDING" } });
    await processNextWorldGenerationJob(db,
      { createCity: vi.fn().mockResolvedValue({ name: payload.name }) } as unknown as AppService, "deadline-worker");
    expect(await second).toEqual({ value: { name: payload.name } });
    await dispatcher.close();
  });

  it("releases all waiting callers and stops status polling when the dispatcher closes", async () => {
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 3_000, 10);
    const prepare = vi.spyOn(db, "prepare");
    const pending = dispatcher.execute(countryId, "city.create", "close-waiter",
      { name: "Close waiter", idempotencyKey: "close-waiter" }).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(prepare.mock.calls.some(([query]) => query === "SELECT * FROM world_generation_jobs_v1 WHERE id = ?")).toBe(true),
      { interval: 10 });
    await dispatcher.close();
    expect(await pending).toMatchObject({ error: { code: "GENERATION_PENDING" } });
    const count = prepare.mock.calls.length;
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    expect(prepare.mock.calls).toHaveLength(count);
  });

  it("waits for the old country transaction before deciding that the final attempt has no receipt", async () => {
    const payload = { name: "In-flight receipt", idempotencyKey: "in-flight-receipt" };
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    await db.prepare(`UPDATE world_generation_jobs_v1 SET status='RUNNING', attempts=max_attempts,
      locked_by='dead-worker', locked_at=now()-interval '20 minutes' WHERE id=?`).run(job.id);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let acquired!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const previousCommand = db.transaction(async () => {
      await db.prepare("SELECT id FROM countries WHERE id=? FOR UPDATE").get(countryId);
      acquired();
      await gate;
      await db.prepare(`INSERT INTO idempotency(country_id,operation,idempotency_key,request_hash,response_json,created_at)
        VALUES(?,'city.create.v3',?,?,?::jsonb,now())`).run(countryId, job.idempotencyKey,
        createHash("sha256").update(JSON.stringify(job.payload)).digest("hex"), JSON.stringify({ name: payload.name }));
    });
    await locked;
    const createCity = vi.fn();
    try {
      // Fair claiming skips the locked country instead of blocking another one.
      expect(await processNextWorldGenerationJob(db, { createCity } as unknown as AppService, "receipt-worker")).toBe(false);
    } finally { release(); await previousCommand; }
    expect(await processNextWorldGenerationJob(db, { createCity } as unknown as AppService, "receipt-worker")).toBe(true);
    expect(createCity).not.toHaveBeenCalled();
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "COMPLETED", result: { name: payload.name } });
  });

  it("does not create a new polling observer when enqueue completes during shutdown", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let inserted!: () => void;
    const insertedSignal = new Promise<void>(resolve => { inserted = resolve; });
    let statusReads = 0;
    const delayedDb: Db = {
      prepare(query) {
        const statement = db.prepare(query);
        return { ...statement,
          async run(...parameters) {
            const result = await statement.run(...parameters);
            if (query.startsWith("INSERT INTO world_generation_jobs_v1")) { inserted(); await gate; }
            return result;
          },
          async get(...parameters) {
            if (query === "SELECT * FROM world_generation_jobs_v1 WHERE id = ?") statusReads += 1;
            return statement.get(...parameters);
          },
        };
      }, exec: db.exec.bind(db), transaction: db.transaction.bind(db), close: db.close.bind(db),
    };
    const dispatcher = new PostgresWorldGenerationDispatcher(delayedDb, 80, 10);
    const pending = dispatcher.execute(countryId, "city.create", "enqueue-during-close",
      { name: "Closing enqueue", idempotencyKey: "enqueue-during-close" }).then(value => ({ value }), error => ({ error }));
    await insertedSignal;
    await dispatcher.close();
    release();
    expect(await pending).toMatchObject({ error: { code: "GENERATION_PENDING" } });
    expect(statusReads).toBe(0);
  });

  it("gives another country a turn before draining the older country's backlog", async () => {
    const otherCountry = (await registerUser(db, { email: "fair-queue@example.com", name: "Fair queue", password: "password123" })).user.countryId;
    const jobs = [];
    for (const [index, scope] of [countryId, countryId, countryId, otherCountry].entries()) {
      const payload = { name: `Command ${index}`, idempotencyKey: `fair-${index}` };
      const job = await enqueueWorldGenerationJob(db, scope, "city.create", payload.idempotencyKey, payload);
      await db.prepare("UPDATE world_generation_jobs_v1 SET created_at=? WHERE id=?").run(new Date(1_000 + index * 1_000).toISOString(), job.id);
      jobs.push(job);
    }
    const commands: string[] = [];
    const service = { createCity: vi.fn(async (_country: string, input: { name: string }) => {
      commands.push(input.name); return { name: input.name };
    }) } as unknown as AppService;
    for (let index = 0; index < jobs.length; index += 1) await processNextWorldGenerationJob(db, service, "fair-worker");
    expect(commands).toEqual(["Command 0", "Command 3", "Command 1", "Command 2"]);
  });

  it("keeps the next country command queued while its predecessor is running", async () => {
    const otherCountry = (await registerUser(db, { email: "fifo-country@example.com", name: "FIFO country", password: "password123" })).user.countryId;
    const jobs = [];
    for (const [index, scope] of [countryId, countryId, otherCountry].entries()) {
      const payload = { name: `FIFO ${index}`, idempotencyKey: `fifo-${index}` };
      const job = await enqueueWorldGenerationJob(db, scope, "city.create", payload.idempotencyKey, payload);
      await db.prepare("UPDATE world_generation_jobs_v1 SET created_at=? WHERE id=?").run(new Date(1_000 + index * 1_000).toISOString(), job.id);
      jobs.push(job);
    }
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const commands: string[] = [];
    const service = { createCity: vi.fn(async (_country: string, input: { name: string }) => {
      commands.push(input.name); if (input.name === "FIFO 0") await gate;
      return { name: input.name };
    }) } as unknown as AppService;
    const first = processNextWorldGenerationJob(db, service, "fifo-first");
    try {
      await vi.waitFor(() => expect(commands).toEqual(["FIFO 0"]), { interval: 10 });
      expect(await processNextWorldGenerationJob(db, service, "fifo-next")).toBe(true);
      expect(commands).toEqual(["FIFO 0", "FIFO 2"]);
      expect(await processNextWorldGenerationJob(db, service, "fifo-third")).toBe(false);
    } finally { release(); await first; }
    await processNextWorldGenerationJob(db, service, "fifo-last");
    expect(commands).toEqual(["FIFO 0", "FIFO 2", "FIFO 1"]);
  });
});
