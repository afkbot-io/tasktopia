import { randomUUID } from "node:crypto";
import type { AppService } from "./app-service";
import { DomainError } from "./app-service";
import type { Db } from "./db";
import { now } from "./db";

export type WorldGenerationOperation = "city.create" | "district.create" | "task.create" | "country.regenerate";
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
  return {
    id: String(row.id), countryId: String(row.country_id), operation: String(row.operation) as WorldGenerationOperation,
    idempotencyKey: String(row.idempotency_key), payload: json<Record<string, unknown>>(row.payload_json),
    status: String(row.status) as WorldGenerationJobStatus, attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
    ...(row.result_json == null ? {} : { result: json(row.result_json) }),
    ...(row.error_json == null ? {} : { error: json<{ code: string; message: string }>(row.error_json) }),
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
    (id, country_id, operation, idempotency_key, payload_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?::jsonb, 'PENDING', ?, ?)
    ON CONFLICT (country_id, operation, idempotency_key) DO NOTHING`)
    .run(randomUUID(), countryId, operation, idempotencyKey, JSON.stringify(normalizedPayload), timestamp, timestamp);
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

export class PostgresWorldGenerationDispatcher {
  constructor(private readonly db: Db, private readonly waitMs = 30_000, private readonly pollMs = 100) {}

  async execute<T>(
    countryId: string,
    operation: WorldGenerationOperation,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const job = await enqueueWorldGenerationJob(this.db, countryId, operation, idempotencyKey, payload);
    const deadline = Date.now() + this.waitMs;
    let current = job;
    while (current.status === "PENDING" || current.status === "RUNNING") {
      if (Date.now() >= deadline) {
        throw new GenerationPendingError(current);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.pollMs));
      current = (await getWorldGenerationJob(this.db, current.id)) ?? current;
    }
    if (current.status === "FAILED") {
      throw new DomainError(current.error?.code ?? "GENERATION_FAILED", current.error?.message ?? "Генерация завершилась с ошибкой");
    }
    return current.result as T;
  }
}

async function claimWorldGenerationJob(db: Db, workerId: string, leaseMs: number): Promise<WorldGenerationJob | undefined> {
  const row = await db.prepare(`UPDATE world_generation_jobs_v1 SET
      status = 'RUNNING', attempts = attempts + 1, locked_at = now(), locked_by = ?, updated_at = now()
    WHERE id = (
      SELECT id FROM world_generation_jobs_v1
      WHERE attempts < max_attempts AND (
        status = 'PENDING' OR (status = 'RUNNING' AND locked_at < now() - (? * interval '1 millisecond'))
      )
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING *`).get(workerId, leaseMs) as Row | undefined;
  return row ? jobFromRow(row) : undefined;
}

async function executeJob(service: AppService, job: WorldGenerationJob): Promise<unknown> {
  const input = job.payload as never;
  if (job.operation === "city.create") return service.createCity(job.countryId, input);
  if (job.operation === "district.create") return service.createDistrict(job.countryId, input);
  if (job.operation === "task.create") return service.createTask(job.countryId, input);
  return service.regenerateCountry(job.countryId, input);
}

export async function processNextWorldGenerationJob(
  db: Db,
  service: AppService,
  workerId: string,
  leaseMs = 15 * 60_000,
): Promise<boolean> {
  const job = await claimWorldGenerationJob(db, workerId, leaseMs);
  if (!job) return false;
  const heartbeatEveryMs = Math.max(10, Math.floor(leaseMs / 3));
  const heartbeat = setInterval(() => {
    void db.prepare(`UPDATE world_generation_jobs_v1 SET locked_at=now(), updated_at=now()
      WHERE id=? AND locked_by=? AND status='RUNNING'`).run(job.id, workerId).catch(() => undefined);
  }, heartbeatEveryMs);
  try {
    const result = await executeJob(service, job);
    await db.prepare(`UPDATE world_generation_jobs_v1 SET status='COMPLETED', result_json=?::jsonb,
      error_json=NULL, locked_at=NULL, locked_by=NULL, finished_at=now(), updated_at=now()
      WHERE id=? AND locked_by=?`).run(JSON.stringify(result), job.id, workerId);
  } catch (error) {
    const failure = {
      code: error instanceof DomainError ? error.code : "GENERATION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
    await db.prepare(`UPDATE world_generation_jobs_v1 SET
      status=CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
      error_json=?::jsonb, locked_at=NULL, locked_by=NULL,
      finished_at=CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END, updated_at=now()
      WHERE id=? AND locked_by=?`).run(JSON.stringify(failure), job.id, workerId);
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

export function startWorldGenerationWorker(
  db: Db,
  service: AppService,
  workerId = `world-${process.pid}-${randomUUID()}`,
  onError: (error: unknown) => void = () => undefined,
): { close(): Promise<void> } {
  let closed = false;
  let active = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pump = () => {
    if (closed) return;
    active = processNextWorldGenerationJob(db, service, workerId).then((processed) => {
      if (!closed) timer = setTimeout(pump, processed ? 0 : 100);
    }).catch((error) => {
      onError(error);
      if (!closed) timer = setTimeout(pump, 500);
    });
  };
  pump();
  return {
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await active.catch(() => undefined);
    },
  };
}
