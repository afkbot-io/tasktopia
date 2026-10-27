import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { createHash } from "node:crypto";
import { AppService, DomainError } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { enqueueWorldGenerationJob, getWorldGenerationJob, PostgresWorldGenerationDispatcher,
  processNextWorldGenerationJob, type WorldGenerationOperation } from "../src/server/world-generation-jobs";
import { runWithGenerationRequestSignal } from "../src/server/generation-request-context";

const commands = [
  ["task.set_status", "updateTaskStatus"], ["task.transfer", "transferTask"],
  ["task.delete", "deleteTask"], ["city.delete", "deleteCity"],
  ["district.delete", "deleteDistrict"], ["district.complete", "completeDistrict"],
] as const;

describe("compatible durable spatial commands", { timeout: 20_000 }, () => {
  let db: Db; let countryId: string;
  beforeEach(async () => {
    db = await createTestDb();
    countryId = (await registerUser(db, { email: "spatial-jobs@example.test", name: "Commands", password: "password123" })).user.countryId;
  });
  afterEach(async () => db?.close());

  it.each(commands)("dispatches %s once and keeps it invisible to the old worker", async (operation, method) => {
    const payload = { taskId: crypto.randomUUID(), districtId: crypto.randomUUID(), idempotencyKey: "spatial-command" };
    const job = await enqueueWorldGenerationJob(db, countryId, operation as WorldGenerationOperation, payload.idempotencyKey, payload);
    const retry = await enqueueWorldGenerationJob(db, countryId, operation as WorldGenerationOperation, payload.idempotencyKey, payload);
    expect(retry.id).toBe(job.id); expect(job.status).toBe("PENDING");
    expect(await db.prepare("SELECT status FROM world_generation_jobs_v1 WHERE id=?").get(job.id)).toMatchObject({ status: "QUEUED" });
    const oldWorkerCandidates = () => db.prepare("SELECT id FROM world_generation_jobs_v1 WHERE status IN ('PENDING','RUNNING')").all();
    expect(await oldWorkerCandidates()).toEqual([]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execute = vi.fn(async () => { await gate; return { operation, applied: true }; });
    const regenerateCountry = vi.fn();
    const service = { [method]: execute, regenerateCountry } as unknown as AppService;
    const running = processNextWorldGenerationJob(db, service, "spatial-worker");
    try {
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce(), { interval: 10 });
      expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "RUNNING", attempts: 1 });
      expect(await db.prepare("SELECT status FROM world_generation_jobs_v1 WHERE id=?").get(job.id)).toMatchObject({ status: "EXECUTING" });
      expect(await oldWorkerCandidates()).toEqual([]);
      expect(await processNextWorldGenerationJob(db, service, "second-worker")).toBe(false);
    } finally { release(); await running; }
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "COMPLETED", result: { operation, applied: true } });
    expect(regenerateCountry).not.toHaveBeenCalled();
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 0);
    try {
      expect(await dispatcher.execute(countryId, operation as WorldGenerationOperation, payload.idempotencyKey, payload)).toMatchObject({ applied: true });
      expect(execute).toHaveBeenCalledOnce();
    } finally { await dispatcher.close(); }
  });

  it("sanitizes worker errors when persisting, reading and replaying a failed job", async () => {
    const payload = { name: "Private error", idempotencyKey: "private-worker-error" };
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    await db.prepare("UPDATE world_generation_jobs_v1 SET max_attempts=1 WHERE id=?").run(job.id);
    const cause = new Error("PRIVATE database connection and credentials");
    const log = vi.fn();
    await processNextWorldGenerationJob(db, { createCity: vi.fn().mockRejectedValue(cause) } as unknown as AppService, "failed-worker", undefined, log);
    expect(log).toHaveBeenCalledWith(cause);
    const safe = { code: "GENERATION_FAILED", message: "Генерация завершилась с ошибкой" };
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "FAILED", error: safe });
    expect(JSON.stringify(await db.prepare("SELECT error_json FROM world_generation_jobs_v1 WHERE id=?").get(job.id))).not.toContain("PRIVATE");
    // Existing installations may already have saved an unsafe error message.
    await db.prepare("UPDATE world_generation_jobs_v1 SET error_json=?::jsonb WHERE id=?")
      .run(JSON.stringify({ code: "GENERATION_FAILED", message: cause.message }), job.id);
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ error: safe });
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 0);
    try { await expect(dispatcher.execute(countryId, "city.create", payload.idempotencyKey, payload)).rejects.toMatchObject(safe); }
    finally { await dispatcher.close(); }
  });

  it("preserves a safe domain failure without retrying it or publishing it to the internal-error logger", async () => {
    const payload = { name: "Domain error", idempotencyKey: "domain-worker-error" };
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", payload.idempotencyKey, payload);
    const log = vi.fn();
    await processNextWorldGenerationJob(db, { createCity: vi.fn().mockRejectedValue(new DomainError("INVALID_INPUT", "Некорректный город")) } as unknown as AppService, "domain-worker", undefined, log);
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "FAILED", attempts: 1, error: { code: "INVALID_INPUT", message: "Некорректный город" } });
    expect(log).not.toHaveBeenCalled();
  });

  it("replays pre-upgrade synchronous status and transfer receipts without changing their hashes or effects", async () => {
    const worker = new AppService(db);
    const city = await worker.createCity(countryId, { name: "Upgrade city", idempotencyKey: "upgrade-city" });
    const first = await worker.createDistrict(countryId, { cityId: city.id, name: "Source district", activate: true, idempotencyKey: "upgrade-first" });
    const second = await worker.createDistrict(countryId, { cityId: city.id, name: "Target district", idempotencyKey: "upgrade-second" });
    const task = await worker.createTask(countryId, { cityId: city.id, districtId: first.id, title: "Upgrade task", estimate: 1, idempotencyKey: "upgrade-task" });
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 0);
    const frontend = new AppService(db, undefined, undefined, dispatcher);
    const status = { taskId: task.id, status: "STARTED" as const, actor: "Original caller", idempotencyKey: "before-upgrade-status" };
    const transfer = { taskId: task.id, targetDistrictId: second.id, actor: "Original caller", idempotencyKey: "before-upgrade-transfer" };
    const receipt = (operation: string, key: string) => db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND operation=? AND idempotency_key=?")
      .get(countryId, operation, key);
    try {
      await worker.updateTaskStatus(countryId, status, "compact");
      const originalStatusReceipt = await receipt("task.status.v3", status.idempotencyKey);
      const beforeStatus = await worker.getCountry(countryId);
      const statusJob = await frontend.updateTaskStatus(countryId, status, "compact").then(() => { throw Error("Expected durable acceptance"); }, error => {
        expect(error.code).toBe("GENERATION_PENDING"); return error.job;
      });
      await processNextWorldGenerationJob(db, worker, "upgrade-worker");
      expect(await getWorldGenerationJob(db, statusJob.id)).toMatchObject({ status: "COMPLETED", result: { id: task.id, status: "STARTED" } });
      expect(await receipt("task.status.v3", status.idempotencyKey)).toEqual(originalStatusReceipt);
      expect((await worker.getCountry(countryId)).worldVersion).toBe(beforeStatus.worldVersion);

      await worker.transferTask(countryId, transfer);
      const originalTransferReceipt = await receipt("task.transfer.v1", transfer.idempotencyKey);
      const beforeTransfer = await worker.getCountry(countryId);
      const transferJob = await frontend.transferTask(countryId, transfer, "compact").then(() => { throw Error("Expected durable acceptance"); }, error => {
        expect(error.code).toBe("GENERATION_PENDING"); return error.job;
      });
      await processNextWorldGenerationJob(db, worker, "upgrade-worker");
      expect(await getWorldGenerationJob(db, transferJob.id)).toMatchObject({ status: "COMPLETED", result: { id: task.id, districtId: second.id } });
      expect(await receipt("task.transfer.v1", transfer.idempotencyKey)).toEqual(originalTransferReceipt);
      expect((await worker.getCountry(countryId)).worldVersion).toBe(beforeTransfer.worldVersion);
    } finally { await dispatcher.close(); }
  });

  it("cancels only the disconnected waiter and retains the accepted command and another caller", async () => {
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 5_000, 10);
    const first = new AbortController(), second = new AbortController();
    const input = { name: "Surviving command", idempotencyKey: "cancel-coalesced" };
    const a = runWithGenerationRequestSignal(first.signal, () => dispatcher.execute(countryId, "city.create", input.idempotencyKey, input))
      .then(value => ({ value }), error => ({ error }));
    const b = runWithGenerationRequestSignal(second.signal, () => dispatcher.execute(countryId, "city.create", input.idempotencyKey, input))
      .then(value => ({ value }), error => ({ error }));
    try {
      await vi.waitFor(() => expect(dispatcher.runtimeStats()).toMatchObject({ observers: 1, waiters: 2 }), { interval: 10 });
      first.abort();
      expect(await a).toMatchObject({ error: { code: "GENERATION_PENDING", job: { status: "PENDING" } } });
      expect(dispatcher.runtimeStats()).toMatchObject({ observers: 1, waiters: 1 });
      expect(getEventListeners(first.signal, "abort")).toHaveLength(0);
      const createCity = vi.fn().mockResolvedValue({ name: input.name });
      await processNextWorldGenerationJob(db, { createCity } as unknown as AppService, "surviving-worker");
      expect(await b).toMatchObject({ value: { name: input.name } });
      expect(createCity).toHaveBeenCalledOnce();
      expect(dispatcher.runtimeStats()).toMatchObject({ observers: 0, waiters: 0 });
      expect(getEventListeners(second.signal, "abort")).toHaveLength(0);
    } finally { await dispatcher.close(); await Promise.allSettled([a, b]); }
  });

  it("does not enqueue a command whose request was already cancelled", async () => {
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 5_000);
    const controller = new AbortController(); controller.abort();
    try {
      await expect(runWithGenerationRequestSignal(controller.signal, () => dispatcher.execute(countryId, "city.create", "cancelled-before-acceptance", { name: "Cancelled", idempotencyKey: "cancelled-before-acceptance" })))
        .rejects.toMatchObject({ code: "CANCELLED" });
      expect(await db.prepare("SELECT id FROM world_generation_jobs_v1 WHERE country_id=?").all(countryId)).toEqual([]);
      expect(dispatcher.runtimeStats()).toMatchObject({ observers: 0, waiters: 0 });
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally { await dispatcher.close(); }
  });

  it("retries a transient spatial failure in the storage queue that old workers cannot claim", async () => {
    const input = { taskId: crypto.randomUUID(), idempotencyKey: "new-command-retry" };
    const job = await enqueueWorldGenerationJob(db, countryId, "task.delete", input.idempotencyKey, input);
    const deleteTask = vi.fn().mockRejectedValueOnce(new Error("Transient worker interruption"))
      .mockResolvedValueOnce({ deleted: true });
    const worker = { deleteTask } as unknown as AppService;
    await processNextWorldGenerationJob(db, worker, "retry-first");
    expect(await db.prepare("SELECT status,attempts FROM world_generation_jobs_v1 WHERE id=?").get(job.id))
      .toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(await db.prepare("SELECT id FROM world_generation_jobs_v1 WHERE status IN ('PENDING','RUNNING')").all()).toEqual([]);
    await processNextWorldGenerationJob(db, worker, "retry-second");
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "COMPLETED", attempts: 2, result: { deleted: true } });
  });

  it("preserves FIFO across legacy and spatial queues in the current worker", async () => {
    const first = await enqueueWorldGenerationJob(db, countryId, "task.delete", "fifo-new", { taskId: crypto.randomUUID(), idempotencyKey: "fifo-new" });
    const second = await enqueueWorldGenerationJob(db, countryId, "city.create", "fifo-old", { name: "Second", idempotencyKey: "fifo-old" });
    await db.prepare("UPDATE world_generation_jobs_v1 SET created_at=now()-interval '1 minute' WHERE id=?").run(first.id);
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const worker = { deleteTask: vi.fn(async () => { calls.push("new"); await gate; return { deleted: true }; }),
      createCity: vi.fn(async () => { calls.push("old"); return { name: "Second" }; }) } as unknown as AppService;
    const running = processNextWorldGenerationJob(db, worker, "fifo-first");
    try {
      await vi.waitFor(() => expect(calls).toEqual(["new"]), { interval: 10 });
      expect(await processNextWorldGenerationJob(db, worker, "fifo-blocked")).toBe(false);
      expect(await getWorldGenerationJob(db, second.id)).toMatchObject({ status: "PENDING", attempts: 0 });
    } finally { release(); await running; }
    await processNextWorldGenerationJob(db, worker, "fifo-next");
    expect(calls).toEqual(["new", "old"]);
  });

  it("recovers an expired final district completion from its legacy command receipt without repeating it", async () => {
    const input = { districtId: crypto.randomUUID(), idempotencyKey: "complete-final-recovery" };
    const job = await enqueueWorldGenerationJob(db, countryId, "district.complete", input.idempotencyKey, input);
    const response = { id: input.districtId, status: "COMPLETED" };
    const requestHash = createHash("sha256").update(JSON.stringify({ districtId: input.districtId })).digest("hex");
    await db.prepare("INSERT INTO idempotency (country_id,operation,idempotency_key,request_hash,response_json,created_at) VALUES (?,?,?,?,?::jsonb,now())")
      .run(countryId, "district.complete.v3", input.idempotencyKey, requestHash, JSON.stringify(response));
    await db.prepare("UPDATE world_generation_jobs_v1 SET status='EXECUTING',attempts=max_attempts,locked_at=now()-interval '2 minutes',locked_by='lost-worker' WHERE id=?").run(job.id);
    const completeDistrict = vi.fn();
    await processNextWorldGenerationJob(db, { completeDistrict } as unknown as AppService, "final-recovery", 1000);
    expect(await getWorldGenerationJob(db, job.id)).toMatchObject({ status: "COMPLETED", attempts: 3, result: response });
    expect(completeDistrict).not.toHaveBeenCalled();
  });
});
