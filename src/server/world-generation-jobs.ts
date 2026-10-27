import type { GenerationDispatcherStats, GenerationWorkerStats, WorldGenerationQueueStats } from "./runtime-stat-contracts";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import type { AppService } from "./app-service";
import { DomainError } from "./app-service";
import type { Db } from "./db";
import { now } from "./db";
import { startBackgroundPoll } from "./background-poll";
import { currentGenerationRequestSignal } from "./generation-request-context";

export type WorldGenerationOperation = "city.create" | "district.create" | "task.create" | "country.regenerate"
  | "task.set_status" | "task.transfer" | "task.delete" | "city.delete" | "district.delete" | "district.complete";
export type WorldGenerationJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type WorldGenerationJob = {
  id: string;
  countryId: string;
  operation: WorldGenerationOperation;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: WorldGenerationJobStatus;
  attempts: number;
  maxAttempts: number;
  result?: unknown;
  error?: { code: string; message: string };
};

export class GenerationPendingError extends DomainError {
  constructor(public readonly job: WorldGenerationJob) {
    super("GENERATION_PENDING", `Генерация принята в очередь: ${job.id}`);
  }
}

type Row = Record<string, unknown>;
const RECEIPT_OPERATIONS: Record<WorldGenerationOperation, string> = {
  "city.create": "city.create.v3", "district.create": "district.create.v3",
  "task.create": "task.create.v3", "country.regenerate": "country.regenerate.v1",
  "task.set_status": "task.status.v3", "task.transfer": "task.transfer.v1", "task.delete": "task.delete.v1",
  "city.delete": "city.delete.v1", "district.delete": "district.delete.v1", "district.complete": "district.complete.v3",
};
const LEGACY_OPERATIONS = new Set<WorldGenerationOperation>(["city.create", "district.create", "task.create", "country.regenerate"]);
const GENERATION_FAILED_MESSAGE = "Генерация завершилась с ошибкой";
const GENERATION_CHANNEL = "tasktopia_generation_job_v1";
type GenerationWaiter = {
  resolve(job: WorldGenerationJob): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  abortCleanup?: () => void;
};
type GenerationObservation = {
  current: WorldGenerationJob;
  waiters: Set<GenerationWaiter>;
  poll?: ReturnType<typeof startBackgroundPoll>;
};

/** Completion notifications only accelerate the canonical bounded DB fallback. */
export async function subscribeToWorldGenerationJobs(
  databaseUrl: string,
  onJob: (jobId: string) => void,
  onError: (error: unknown) => void = () => undefined,
): Promise<{ close(): Promise<void> }> {
  const listener = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  let subscription: Awaited<ReturnType<typeof listener.listen>>;
  try {
    subscription = await listener.listen(GENERATION_CHANNEL, jobId => {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
        void Promise.resolve().then(() => onJob(jobId)).catch(onError).catch(() => undefined);
      }
    });
  } catch (error) {
    await listener.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }
  return { async close() {
    try { await subscription.unlisten(); } finally { await listener.end({ timeout: 5 }); }
  } };
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonCompatiblePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function jobFromRow(row: Row): WorldGenerationJob {
  const error = row.error_json == null ? undefined : json<{ code: string; message: string }>(row.error_json);
  return {
    id: String(row.id), countryId: String(row.country_id), operation: String(row.operation) as WorldGenerationOperation,
    idempotencyKey: String(row.idempotency_key), payload: json<Record<string, unknown>>(row.payload_serialized ?? row.payload_json),
    status: (row.status === "QUEUED" ? "PENDING" : row.status === "EXECUTING" ? "RUNNING" : String(row.status)) as WorldGenerationJobStatus,
    attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
    ...(row.result_json == null ? {} : { result: json(row.result_json) }),
    ...(error ? { error: error.code === "GENERATION_FAILED" ? { code: error.code, message: GENERATION_FAILED_MESSAGE } : error } : {}),
  };
}

export async function enqueueWorldGenerationJob(
  db: Db,
  countryId: string,
  operation: WorldGenerationOperation,
  idempotencyKey: string,
  payload: Record<string, unknown>,
): Promise<WorldGenerationJob> {
  const timestamp = now();
  const normalizedPayload = jsonCompatiblePayload(payload);
  await db.prepare(`INSERT INTO world_generation_jobs_v1
    (id, country_id, operation, idempotency_key, payload_json, payload_serialized, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)
    ON CONFLICT (country_id, operation, idempotency_key) DO NOTHING`)
    .run(randomUUID(), countryId, operation, idempotencyKey, JSON.stringify(normalizedPayload),
      // The DB adapter parses strings starting with {/[ as JSON parameters.
      // Leading JSON whitespace keeps this TEXT value and its original key
      // order intact; JSON.parse and the DB equality constraint accept it.
      LEGACY_OPERATIONS.has(operation) ? null : ` ${JSON.stringify(normalizedPayload)}`,
      LEGACY_OPERATIONS.has(operation) ? "PENDING" : "QUEUED", timestamp, timestamp);
  const row = await db.prepare(`SELECT * FROM world_generation_jobs_v1
    WHERE country_id = ? AND operation = ? AND idempotency_key = ?`).get(countryId, operation, idempotencyKey) as Row | undefined;
  if (!row) throw new Error("World generation job was not persisted");
  if (canonicalJson(json(row.payload_json)) !== canonicalJson(normalizedPayload)) {
    throw new DomainError("CONFLICT", "Этот idempotencyKey уже использован с другими данными генерации");
  }
  return jobFromRow(row);
}

export async function getWorldGenerationJob(db: Db, jobId: string): Promise<WorldGenerationJob | undefined> {
  const row = await db.prepare("SELECT * FROM world_generation_jobs_v1 WHERE id = ?").get(jobId) as Row | undefined;
  return row ? jobFromRow(row) : undefined;
}

const queueObservations = new WeakMap<Db, { leaseMs: number; value?: WorldGenerationQueueStats; pending?: Promise<WorldGenerationQueueStats> }>();
/** Active queues only; process-local TTL/coalescing keeps operator polling cheap. */
export async function readWorldGenerationQueueStats(db: Db, leaseMs = 15 * 60_000): Promise<WorldGenerationQueueStats> {
  if (!Number.isFinite(leaseMs) || leaseMs < 1) throw new DomainError("INVALID_INPUT", "Некорректная длительность generation lease");
  let observation = queueObservations.get(db);
  if (!observation || observation.leaseMs !== leaseMs) { observation = { leaseMs }; queueObservations.set(db, observation); }
  if (observation.value && Date.now() - observation.value.sampledAt < 5000) return { ...observation.value };
  if (!observation.pending) {
    const active = observation;
    active.pending = (async () => {
      const row = await db.prepare(`SELECT COUNT(*) FILTER(WHERE status IN ('PENDING','QUEUED'))::int AS pending,
        COUNT(*) FILTER(WHERE status IN ('RUNNING','EXECUTING'))::int AS running,
        COUNT(*) FILTER(WHERE status IN ('RUNNING','EXECUTING') AND locked_at<now()-(?*INTERVAL '1 millisecond'))::int AS expired,
        EXTRACT(EPOCH FROM (now()-MIN(created_at) FILTER(WHERE status IN ('PENDING','QUEUED'))))*1000 AS oldest_age
        FROM world_generation_jobs_v1 WHERE status IN ('PENDING','RUNNING','QUEUED','EXECUTING')`).get<Row>(leaseMs);
      const value: WorldGenerationQueueStats = { sampledAt: Date.now(), pending: Number(row?.pending ?? 0), running: Number(row?.running ?? 0),
        expiredRunning: Number(row?.expired ?? 0), oldestPendingAgeMs: row?.oldest_age == null ? null : Math.max(0, Number(row.oldest_age)) };
      active.value = value; return value;
    })().finally(() => { active.pending = undefined; });
  }
  const pending = observation.pending;
  if (!pending) throw new Error("Queue observation was not started");
  return { ...await pending };
}

export class PostgresWorldGenerationDispatcher {
  private readonly observations = new Map<string, GenerationObservation>();
  private closed = false;
  private readonly counters = { requests: 0, notifications: 0, pollReads: 0, pollErrors: 0, waitTimeouts: 0,
    completedRequests: 0, failedRequests: 0, lastPollSuccessAt: null as number | null, lastPollErrorAt: null as number | null };
  runtimeStats(): GenerationDispatcherStats { return { ...this.counters, closed: this.closed, observers: this.observations.size,
    waiters: [...this.observations.values()].reduce((sum, item) => sum + item.waiters.size, 0) }; }
  constructor(
    private readonly db: Db,
    private readonly waitMs = 30_000,
    private readonly pollMs = 500,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  notify(jobId: string): void { this.counters.notifications++; this.observations.get(jobId)?.poll?.trigger(); }

  private stopObservation(observation: GenerationObservation): void {
    if (this.observations.get(observation.current.id) !== observation) return;
    this.observations.delete(observation.current.id);
    void observation.poll?.close().catch(this.onError).catch(() => undefined);
  }

  private clearWaiter(waiter: GenerationWaiter): void {
    clearTimeout(waiter.timer);
    waiter.abortCleanup?.();
  }

  private wait(job: WorldGenerationJob, signal?: AbortSignal): Promise<WorldGenerationJob> {
    let observation = this.observations.get(job.id);
    if (!observation) {
      observation = { current: job, waiters: new Set() };
      this.observations.set(job.id, observation);
      const watched = observation;
      watched.poll = startBackgroundPoll(async () => {
        this.counters.pollReads++;
        const current = await getWorldGenerationJob(this.db, job.id);
        this.counters.lastPollSuccessAt = Date.now();
        if (!current || this.observations.get(job.id) !== watched) return;
        watched.current = current;
        if (current.status === "PENDING" || current.status === "RUNNING") return;
        for (const waiter of watched.waiters) { this.clearWaiter(waiter); waiter.resolve(current); }
        watched.waiters.clear();
        this.stopObservation(watched);
      }, this.pollMs, error => { this.counters.pollErrors++; this.counters.lastPollErrorAt = Date.now(); this.onError(error); }, { maxBackoffMs: Math.max(2_000, this.pollMs) });
    }
    const watched = observation;
    return new Promise((resolve, reject) => {
      const waiter: GenerationWaiter = { resolve, reject, timer: setTimeout(() => {
        this.counters.waitTimeouts++;
        this.clearWaiter(waiter);
        watched.waiters.delete(waiter);
        reject(new GenerationPendingError(watched.current));
        if (watched.waiters.size === 0) this.stopObservation(watched);
      }, this.waitMs) };
      watched.waiters.add(waiter);
      if (signal) {
        const abort = () => {
          this.clearWaiter(waiter);
          watched.waiters.delete(waiter);
          // Persistence is the acceptance boundary. Disconnecting a caller
          // releases its wait only; the durable command remains for the worker.
          reject(new GenerationPendingError(watched.current));
          if (watched.waiters.size === 0) this.stopObservation(watched);
        };
        waiter.abortCleanup = () => signal.removeEventListener("abort", abort);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const polls: Promise<void>[] = [];
    for (const observation of this.observations.values()) {
      for (const waiter of observation.waiters) {
        this.clearWaiter(waiter);
        waiter.reject(new GenerationPendingError(observation.current));
      }
      observation.waiters.clear();
      if (observation.poll) polls.push(observation.poll.close());
    }
    this.observations.clear();
    await Promise.all(polls);
  }

  async execute<T>(
    countryId: string,
    operation: WorldGenerationOperation,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    this.counters.requests++;
    const signal = currentGenerationRequestSignal();
    if (signal?.aborted) throw new DomainError("CANCELLED", "Запрос отменён до принятия операции");
    const job = await enqueueWorldGenerationJob(this.db, countryId, operation, idempotencyKey, payload);
    let current = job;
    if (current.status === "PENDING" || current.status === "RUNNING") {
      if (this.closed || this.waitMs <= 0 || signal?.aborted) throw new GenerationPendingError(current);
      current = await this.wait(current, signal);
    }
    if (current.status === "FAILED") {
      this.counters.failedRequests++;
      throw new DomainError(current.error?.code ?? "GENERATION_FAILED", current.error?.message ?? "Генерация завершилась с ошибкой");
    }
    this.counters.completedRequests++;
    return current.result as T;
  }
}

async function claimWorldGenerationJob(db: Db, workerId: string, leaseMs: number): Promise<(WorldGenerationJob & { recoveryOnly: boolean }) | undefined> {
  const row = await db.prepare(`WITH country_heads AS (
      SELECT DISTINCT ON (country_id) id FROM world_generation_jobs_v1
      WHERE status IN ('PENDING','RUNNING','QUEUED','EXECUTING') ORDER BY country_id,created_at,id
    ), candidate AS (
      SELECT job.id,job.country_id,job.attempts >= job.max_attempts AS recovery_only
      FROM world_generation_jobs_v1 job JOIN country_heads head ON head.id=job.id
      JOIN countries country ON country.id=job.country_id
      WHERE (job.status IN ('PENDING','QUEUED') AND job.attempts < job.max_attempts)
        OR (job.status IN ('RUNNING','EXECUTING') AND job.locked_at < now() - (? * interval '1 millisecond'))
      ORDER BY country.generation_last_served_at,job.created_at,job.id FOR UPDATE OF country,job SKIP LOCKED LIMIT 1
    ), served AS (
      UPDATE countries country SET generation_last_served_at=clock_timestamp()
      FROM candidate WHERE country.id=candidate.country_id RETURNING country.id
    ) UPDATE world_generation_jobs_v1 job SET
      status=CASE WHEN job.status IN ('QUEUED','EXECUTING') THEN 'EXECUTING' ELSE 'RUNNING' END,
      attempts=job.attempts + CASE WHEN candidate.recovery_only THEN 0 ELSE 1 END,
      locked_at=now(), locked_by=?, updated_at=now()
    FROM candidate,served WHERE job.id=candidate.id AND served.id=candidate.country_id
    RETURNING job.*, candidate.recovery_only`).get(leaseMs, workerId) as Row | undefined;
  return row ? { ...jobFromRow(row), recoveryOnly: row.recovery_only === true } : undefined;
}

async function recoverCommittedFinalAttempt(db: Db, job: WorldGenerationJob): Promise<unknown> {
  return db.transaction(async () => {
    // The previous worker may have committed its command but died before its
    // job receipt. This lock also waits for any still-open command transaction.
    await db.prepare("SELECT id FROM countries WHERE id=? FOR UPDATE").get(job.countryId);
    const receipt = await db.prepare(`SELECT request_hash, response_json FROM idempotency
      WHERE country_id=? AND operation=? AND idempotency_key=?`)
      .get<Row>(job.countryId, RECEIPT_OPERATIONS[job.operation], job.idempotencyKey);
    if (!receipt) throw new DomainError("GENERATION_LEASE_EXPIRED", "Последняя попытка генерации прервана; подтверждённого результата нет");
    const commandPayload = job.operation === "district.complete" ? { districtId: job.payload.districtId } : job.payload;
    const requestHash = createHash("sha256").update(JSON.stringify(commandPayload)).digest("hex");
    if (receipt.request_hash !== requestHash) throw new DomainError("CONFLICT", "Этот idempotencyKey уже использован с другими данными генерации");
    return json(receipt.response_json);
  });
}

async function executeJob(service: AppService, job: WorldGenerationJob): Promise<unknown> {
  const input = job.payload as never;
  if (job.operation === "city.create") return service.createCity(job.countryId, input);
  if (job.operation === "district.create") return service.createDistrict(job.countryId, input);
  if (job.operation === "task.create") return service.createTask(job.countryId, input);
  if (job.operation === "country.regenerate") return service.regenerateCountry(job.countryId, input);
  if (job.operation === "task.set_status") return service.updateTaskStatus(job.countryId, input, "compact");
  if (job.operation === "task.transfer") return service.transferTask(job.countryId, input, "compact");
  if (job.operation === "task.delete") return service.deleteTask(job.countryId, input);
  if (job.operation === "city.delete") return service.deleteCity(job.countryId, input);
  if (job.operation === "district.delete") return service.deleteDistrict(job.countryId, input);
  if (job.operation === "district.complete") return service.completeDistrict(job.countryId, String(job.payload.districtId), job.idempotencyKey);
  throw new DomainError("INVALID_INPUT", "Неподдерживаемая фоновая операция");
}

export async function processNextWorldGenerationJob(
  db: Db,
  service: AppService,
  workerId: string,
  leaseMs = 15 * 60_000,
  onError: (error: unknown) => void = () => undefined,
): Promise<boolean> {
  const job = await claimWorldGenerationJob(db, workerId, leaseMs);
  if (!job) return false;
  const heartbeatEveryMs = Math.max(10, Math.floor(leaseMs / 3));
  const heartbeat = startBackgroundPoll(async () => {
    await db.prepare(`UPDATE world_generation_jobs_v1 SET locked_at=now(), updated_at=now()
      WHERE id=? AND locked_by=? AND status IN ('RUNNING','EXECUTING')`).run(job.id, workerId);
  }, heartbeatEveryMs, onError);
  try {
    const result = job.recoveryOnly ? await recoverCommittedFinalAttempt(db, job) : await executeJob(service, job);
    await db.prepare(`UPDATE world_generation_jobs_v1 SET status='COMPLETED', result_json=?::jsonb,
      error_json=NULL, locked_at=NULL, locked_by=NULL, finished_at=now(), updated_at=now()
      WHERE id=? AND locked_by=?`).run(JSON.stringify(result), job.id, workerId);
  } catch (error) {
    const failure = {
      code: error instanceof DomainError ? error.code : "GENERATION_FAILED",
      message: error instanceof DomainError ? error.message : GENERATION_FAILED_MESSAGE,
    };
    if (!(error instanceof DomainError)) {
      try { onError(error); } catch { /* Logging cannot prevent durable failure/retry publication. */ }
    }
    const terminal = error instanceof DomainError;
    await db.prepare(`UPDATE world_generation_jobs_v1 SET
      status=CASE WHEN attempts >= max_attempts OR ? THEN 'FAILED' WHEN status='EXECUTING' THEN 'QUEUED' ELSE 'PENDING' END,
      error_json=?::jsonb, locked_at=NULL, locked_by=NULL,
      finished_at=CASE WHEN attempts >= max_attempts OR ? THEN now() ELSE NULL END, updated_at=now()
      WHERE id=? AND locked_by=?`).run(terminal, JSON.stringify(failure), terminal, job.id, workerId);
  } finally {
    await heartbeat.close();
  }
  await db.prepare(`SELECT pg_notify('${GENERATION_CHANNEL}', ?)`).get(job.id).catch(onError);
  return true;
}

export function startWorldGenerationWorker(
  db: Db,
  service: AppService,
  workerId = `world-${process.pid}-${randomUUID()}`,
  onError: (error: unknown) => void = () => undefined,
): { close(): Promise<void>; runtimeStats(): GenerationWorkerStats } {
  let closed = false;
  let active = Promise.resolve();
  let running = false; let iterations = 0; let processedCount = 0; let errors = 0; let notBefore = 0;
  let lastSuccessAt: number | null = null; let lastFailureAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pump = () => {
    if (closed) return;
    running = true; iterations++;
    active = processNextWorldGenerationJob(db, service, workerId, undefined, onError).then((processed) => {
      lastSuccessAt = Date.now(); if (processed) processedCount++;
      notBefore = Date.now() + (processed ? 0 : 100);
      if (!closed) timer = setTimeout(pump, processed ? 0 : 100);
    }).catch((error) => {
      errors++; lastFailureAt = Date.now(); notBefore = Date.now() + 500;
      try { onError(error); } catch { /* Observers cannot reject the worker loop. */ }
      if (!closed) timer = setTimeout(pump, 500);
    }).finally(() => { running = false; });
  };
  pump();
  return {
    runtimeStats() { return { closed, running, iterations, processed: processedCount, errors, lastSuccessAt, lastFailureAt, backoffRemainingMs: Math.max(0, notBefore - Date.now()) }; },
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await active.catch(() => undefined);
    },
  };
}
