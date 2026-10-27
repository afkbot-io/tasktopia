/** Реальный локальный HTTP/auth MCP: 10000 задач, concurrency1/4/8,
 * полный keyset обход, совместимые фильтры и штатный лимит90/min.
 * URI/пароли/токены не сохраняются в отчёт. Данные отдельной fixture-схемы.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { AppService } from "../src/server/app-service";
import { createMcpToken } from "../src/server/auth";
import { createDb, type Db, type Row } from "../src/server/db";
import { registerMcpHttp } from "../src/server/mcp-http";
import { PostgresWorldGenerationDispatcher, startWorldGenerationWorker, subscribeToWorldGenerationJobs } from "../src/server/world-generation-jobs";

assert.ok(Number(process.versions.node.split(".")[0]) >= 24);
const uri = process.env.TEST_DATABASE_URL;
assert.ok(uri, "TEST_DATABASE_URL is required");
const target = new URL(uri);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  && (target.pathname.endsWith("_test") || /^\/mcp_scale_\d{8}$/.test(target.pathname)) && !target.search,
  "Only a local dedicated benchmark database is accepted");
const folder = ".builder/mcp-scale-10000-20261028/performance";
const fixture = JSON.parse(await readFile(`${folder}/fixture.json`, "utf8")) as {
  schema: string; countryId: string; userId: string; tasks: number;
  selected: Array<{ taskId: string; cityId: string; districtId: string }>;
};
assert.equal(fixture.schema, "mcp_scale_20261028");
assert.equal(fixture.tasks, 10_000);

type QueryStats = { queries: number; rows: number; sqlBytes: number; selectedPlacements: number; selectedBlocks: number; fullLayouts: number };
type CallStats = { requests: number; responseBytes: number; queries: QueryStats[] };
const queryContext = new AsyncLocalStorage<QueryStats>();
const callContext = new AsyncLocalStorage<CallStats>();
const emptyStats = (): QueryStats => ({ queries: 0, rows: 0, sqlBytes: 0, selectedPlacements: 0, selectedBlocks: 0, fullLayouts: 0 });
const distribution = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  return { samples: values.length, p50: ordered[Math.ceil(ordered.length * .5) - 1] ?? 0,
    p95: ordered.length >= 20 ? ordered[Math.ceil(ordered.length * .95) - 1]! : null, max: ordered.at(-1) ?? 0 };
};
const safeMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/[a-z]+:\/\/[^\s"']+/gi, "[endpoint]").slice(0, 400);

/** Stricter than production: at most80 real requests in any61s window.
 * Admission happens outside timed batches, preserving actual concurrency. */
class WindowAdmission {
  private starts: number[] = [];
  waitedMs = 0;
  async reserve(count: number) {
    assert.ok(count >= 1 && count <= 80);
    const start = performance.now();
    for (;;) {
      const now = Date.now(); this.starts = this.starts.filter(value => now - value < 61_000);
      if (this.starts.length + count <= 80) { this.starts.push(...Array.from({ length: count }, () => now)); break; }
      console.log(JSON.stringify({ event: "rate-window-admission", waitMs: Math.max(1, this.starts[0]! + 61_050 - now) }));
      await pause(Math.max(1, this.starts[0]! + 61_050 - now));
    }
    this.waitedMs += performance.now() - start;
  }
}

async function runBenchmark() {
  await mkdir(folder, { recursive: true });
  const label = process.argv.find(value => value.startsWith("--label="))?.slice(8) ?? "http-candidate";
  const smoke = process.argv.includes("--smoke");
  assert.match(label, /^[a-z0-9-]{1,40}$/);
  const sources = ["src/server/app-service.ts", "src/server/world/active-block-layout.ts", "src/server/task-list-read.ts",
    "src/server/mcp.ts", "src/server/mcp-http.ts", "src/server/mcp-read-models.ts", "src/server/auth.ts", "src/server/world-generation-jobs.ts",
    "src/server/db.ts", "src/server/task-detail-read.ts", "src/server/task-collection-read.ts", "src/server/task-read-schemas.ts",
    "src/shared/task-read-contracts.ts", "migrations/postgres/0045_task_page_indexes.sql", "migrations/postgres/0046_async_spatial_commands.sql",
    "migrations/postgres/0047_generation_command_serialization.sql", "scripts/benchmark-mcp-http-scale.ts"];
  const fingerprints = () => Promise.all(sources.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])).then(Object.fromEntries);
  const budgets = { acceptanceConcurrency: 4, readP95Ms: 500, commentP95Ms: 750, pageHttpBytes: 128 * 1024,
    receiptHttpBytesExclusive: 4 * 1024, compactSelectedPlacements: 1, pageSelectedPlacements: 50, fullLayouts: 0 };
  const diagnosticTargets = { cardP95Ms: 200, pageP95Ms: 200, commentP95Ms: 300, eventLoopP95Ms: 50 };
  const report: Record<string, unknown> = { localOnly: true, transport: "real TCP HTTP /mcp + StreamableHTTPClientTransport + bearer authentication",
    node: process.version, tasks: 10_000, cities: 10, tasksPerCity: 1000, samplesPerOperationAndConcurrency: 20,
    poolConnections: 4, productionRateLimitPerMinute: 90, admissionLimitPer61Seconds: 80, smoke,
    eventLoopSamplingResolutionMs: 1, eventLoopExcludesAdmissionWait: true, budgets, diagnosticTargets, startedAt: new Date().toISOString() };
  if (smoke) report.samplesPerOperationAndConcurrency = 1;
  report.sourceFingerprints = await fingerprints();
  const db = await createDb(uri!, { schema: fixture.schema, maxConnections: 4 });
  const requestStats = new Map<string, QueryStats>();
  const measured: Db = {
    prepare(query) {
      const statement = db.prepare(query);
      const record = async <T>(operation: () => Promise<T>): Promise<T> => {
        const value = await operation(); const stats = queryContext.getStore();
        if (stats) {
          const rows = (Array.isArray(value) ? value : value && typeof value === "object" && "rows" in value ? value.rows : value ? [value] : []) as Row[];
          stats.queries++; stats.rows += rows.length; stats.sqlBytes += Buffer.byteLength(JSON.stringify(value) ?? "");
          for (const row of rows) if (Array.isArray(row.selected_placements)) { stats.selectedPlacements += row.selected_placements.length; stats.selectedBlocks++; }
          if (query.includes("AS placements") && query.includes("AS road")) stats.fullLayouts++;
        }
        return value;
      };
      return { all: <T extends Row>(...args: unknown[]) => record(() => statement.all<T>(...args)),
        get: <T extends Row>(...args: unknown[]) => record(() => statement.get<T>(...args)), run: (...args) => record(() => statement.run(...args)) };
    },
    exec: query => db.exec(query), transaction: callback => db.transaction(callback), close: async () => undefined,
  };
  const dispatcher = new PostgresWorldGenerationDispatcher(measured, 55_000);
  const service = new AppService(measured, undefined, undefined, dispatcher);
  const app = Fastify({ logger: false, bodyLimit: 20_000_000 });
  await app.register(rateLimit, { max: 5000, timeWindow: "1 minute" });
  app.addHook("onRequest", (request, _reply, done) => {
    const id = String(request.headers["x-benchmark-id"] ?? request.id), stats = emptyStats();
    requestStats.set(id, stats); queryContext.run(stats, done);
  });
  const handler = registerMcpHttp(app, measured, service, "http://localhost:3000");
  let client: Client | undefined, worker: ChildProcess | undefined;
  let listener: Awaited<ReturnType<typeof subscribeToWorldGenerationJobs>> | undefined;
  const admission = new WindowAdmission();
  const httpCodes: Record<string, number> = {};
  try {
    const count = (await db.prepare("SELECT count(*)::integer AS count FROM tasks_v3 task JOIN cities_v3 city ON city.id=task.city_id WHERE city.country_id=?")
      .get<{ count: number }>(fixture.countryId))!.count;
    assert.equal(count, 10_000);
    const token = await createMcpToken(db, fixture.countryId, "Локальный HTTP benchmark", fixture.userId);
    worker = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--worker"], { env: process.env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Local worker startup deadline")), 15_000);
      worker!.once("message", message => { clearTimeout(timer); assert.ok((message as { ready?: boolean }).ready); resolve(); });
      worker!.once("error", reject);
      worker!.once("exit", code => { if (code !== null && code !== 0) reject(new Error("Local worker failed")); });
    });
    listener = await subscribeToWorldGenerationJobs(uri!, id => dispatcher.notify(id));
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token.token}` } },
      fetch: async (input, init) => {
        const call = callContext.getStore();
        if (!call) await admission.reserve(1);
        const id = randomUUID(), headers = new Headers(init?.headers); headers.set("x-benchmark-id", id);
        const response = await fetch(input, { ...init, headers });
        const bytes = (await response.clone().arrayBuffer()).byteLength;
        httpCodes[response.status] = (httpCodes[response.status] ?? 0) + 1;
        if (call) { call.requests++; call.responseBytes += bytes; call.queries.push(requestStats.get(id) ?? emptyStats()); }
        requestStats.delete(id);
        return response;
      },
    });
    client = new Client({ name: "http-scale-10000", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(transport); await client.listTools();
    type ToolResponse = Awaited<ReturnType<Client["callTool"]>>;
    const call = async (name: string, args: Record<string, unknown>) => {
      const stats: CallStats = { requests: 0, responseBytes: 0, queries: [] };
      const start = performance.now();
      const result = await callContext.run(stats, () => client!.callTool({ name, arguments: { countryId: fixture.countryId, ...args } }));
      assert.ok(!result.isError, "MCP tool failed: " + name);
      assert.equal(stats.requests, 1, "A measured tool must issue exactly one admitted HTTP request");
      assert.ok(stats.queries.reduce((sum, item) => sum + item.queries, 0) > 0, "Request SQL tracing must remain active");
      return { result, elapsedMs: performance.now() - start, stats };
    };
    const data = <T>(result: ToolResponse) => (result.structuredContent as { result: T }).result;
    const targetTask = fixture.selected[0]!;
    const beforeComments = (await db.prepare(`SELECT
      (SELECT count(*)::integer FROM task_comments_v3 WHERE task_id=?) AS comments,
      (SELECT count(*)::integer FROM task_events_v7 WHERE task_id=? AND event_type='COMMENT_ADDED') AS events`)
      .get<{ comments: number; events: number }>(targetTask.taskId, targetTask.taskId))!;
    // Warm SDK tool-schema caches outside measurements and charge every request.
    await admission.reserve(1); await call("task.get", { taskId: targetTask.taskId, view: "compact" });
    const phases: unknown[] = []; report.phases = phases;
    for (const concurrency of smoke ? [1] : [1, 4, 8]) {
      for (const operation of smoke ? ["card"] as const : ["card", "page", "comment"] as const) {
        const samples: Array<{ elapsedMs: number; stats: CallStats }> = [];
        const sampleCount = smoke ? 1 : 20;
        // Admit a complete phase before starting its native event-loop timer.
        // No rate-window pause occurs inside the continuously monitored phase.
        await admission.reserve(sampleCount);
        const delay = monitorEventLoopDelay({ resolution: 1 }); delay.enable();
        for (let sample = 0; sample < sampleCount; sample += concurrency) {
          const count = Math.min(concurrency, sampleCount - sample);
          const batch = await Promise.all(Array.from({ length: count }, (_, offset) => {
            const args = operation === "card" ? { taskId: targetTask.taskId, view: "compact" }
              : operation === "page" ? { limit: 50 }
              : { taskId: targetTask.taskId, body: "Локальный HTTP нагрузочный комментарий", resultMode: "compact", idempotencyKey: `http-${label}-${Date.now()}-${concurrency}-${sample + offset}` };
            return call(operation === "card" ? "task.get" : operation === "page" ? "task.list_page" : "task.add_comment", args);
          }));
          samples.push(...batch);
          for (const sample of batch) {
            const stats = sample.stats.queries;
            assert.equal(stats.reduce((sum, item) => sum + item.fullLayouts, 0), 0, "Compact HTTP path hydrated a full city layout");
            assert.ok(stats.reduce((sum, item) => sum + item.selectedPlacements, 0) <= (operation === "page" ? 50 : 1), "Geometry selection exceeded the requested tasks");
          }
        }
        delay.disable();
        const sums = (key: keyof QueryStats) => samples.map(sample => sample.stats.queries.reduce((sum, item) => sum + item[key], 0));
        const phase = { operation, concurrency, elapsedMs: distribution(samples.map(sample => sample.elapsedMs)),
          decodedHttpBytes: distribution(samples.map(sample => sample.stats.responseBytes)), sqlQueries: distribution(sums("queries")),
          sqlRows: distribution(sums("rows")), sqlBytes: distribution(sums("sqlBytes")), selectedPlacements: distribution(sums("selectedPlacements")),
          selectedBlocks: distribution(sums("selectedBlocks")), eventLoopSamples: delay.count,
          eventLoopP95Ms: delay.count >= 20 ? delay.percentile(95) / 1e6 : null,
          eventLoopMaxMs: delay.count ? delay.max / 1e6 : null, heapUsedBytes: process.memoryUsage().heapUsed };
        phases.push(phase); console.log(JSON.stringify({ event: "http-phase", ...phase }));
        if (!smoke) {
          if (concurrency === budgets.acceptanceConcurrency) assert.ok(phase.elapsedMs.p95 !== null
            && phase.elapsedMs.p95 <= (operation === "comment" ? budgets.commentP95Ms : budgets.readP95Ms), "HTTP latency budget exceeded: " + operation);
          if (operation === "page") assert.ok(phase.decodedHttpBytes.max <= budgets.pageHttpBytes, "Page HTTP payload budget exceeded");
          if (operation === "comment") assert.ok(phase.decodedHttpBytes.max < budgets.receiptHttpBytesExclusive, "Receipt HTTP payload budget exceeded");
        }
      }
    }

    const afterComments = (await db.prepare(`SELECT
      (SELECT count(*)::integer FROM task_comments_v3 WHERE task_id=?) AS comments,
      (SELECT count(*)::integer FROM task_events_v7 WHERE task_id=? AND event_type='COMMENT_ADDED') AS events`)
      .get<{ comments: number; events: number }>(targetTask.taskId, targetTask.taskId))!;
    const expectedComments = smoke ? 0 : 60;
    assert.equal(afterComments.comments - beforeComments.comments, expectedComments);
    assert.equal(afterComments.events - beforeComments.events, expectedComments);
    report.mutations = { commentsAdded: expectedComments, commentEventsAdded: expectedComments, duplicates: 0 };

    const traversals: unknown[] = []; report.pagination = traversals;
    for (const scope of smoke ? ["number"] as const
      : ["all", "city", "district", "combined", "search", "absent", "number", "empty-status", "empty-priority", "empty-kind", "assignee"] as const) {
      const number = (await db.prepare("SELECT task_number FROM tasks_v3 WHERE id=?").get<{ task_number: number }>(targetTask.taskId))!.task_number;
      const args: Record<string, unknown> = scope === "combined" ? { cityId: targetTask.cityId, districtId: targetTask.districtId, status: "PLANNING", priority: "NORMAL", workItemType: "TASK" }
        : scope === "city" ? { cityId: targetTask.cityId } : scope === "district" ? { districtId: targetTask.districtId }
        : scope === "empty-status" ? { status: "COMPLETED" } : scope === "empty-priority" ? { priority: "CRITICAL" }
        : scope === "empty-kind" ? { workItemType: "BUG" } : scope === "assignee" ? { assigneeUserId: fixture.userId }
        : scope === "search" ? { q: "MCP scale task 1." } : scope === "absent" ? { q: "absent-title-10000" } : scope === "number" ? { q: `#${number}` } : {};
      const where = scope === "combined" ? "AND task.city_id=? AND task.district_id=? AND task.status='PLANNING' AND task.priority='NORMAL' AND task.work_item_type='TASK'"
        : scope === "city" ? "AND task.city_id=?" : scope === "district" ? "AND task.district_id=?"
        : scope === "empty-status" ? "AND task.status='COMPLETED'" : scope === "empty-priority" ? "AND task.priority='CRITICAL'"
        : scope === "empty-kind" ? "AND task.work_item_type='BUG'" : scope === "assignee" ? "AND task.assignee_user_id=?"
        : scope === "search" ? "AND task.title ILIKE 'MCP scale task 1.%'" : scope === "absent" ? "AND false" : scope === "number" ? "AND task.task_number=?" : "";
      const parameters = scope === "combined" ? [targetTask.cityId, targetTask.districtId] : scope === "city" ? [targetTask.cityId]
        : scope === "district" ? [targetTask.districtId] : scope === "assignee" ? [fixture.userId] : scope === "number" ? [number] : [];
      const expected = (await db.prepare(`SELECT task.id FROM tasks_v3 task JOIN cities_v3 city ON city.id=task.city_id
        WHERE city.country_id=? ${where} ORDER BY task.updated_at DESC,task.id DESC`).all<{ id: string }>(fixture.countryId, ...parameters)).map(row => row.id);
      const actual: string[] = []; let cursor: string | undefined; let pages = 0;
      do {
        await admission.reserve(1);
        const page = data<{ items: Array<{ id: string }>; nextCursor: string | null }>((await call("task.list_page", { ...args, limit: 100, ...(cursor ? { cursor } : {}) })).result);
        actual.push(...page.items.map(item => item.id)); cursor = page.nextCursor ?? undefined; pages++;
        assert.ok(pages <= 101, "Unexpected pagination cycle");
      } while (cursor);
      assert.deepEqual(actual, expected, "HTTP pagination lost, duplicated or reordered tasks for " + scope);
      assert.equal(new Set(actual).size, actual.length);
      traversals.push({ scope, pages, tasks: actual.length, duplicates: 0, matchesIndependentSqlIdsAndOrder: true });
      console.log(JSON.stringify({ event: "pagination-complete", scope, tasks: actual.length, pages }));
    }

    if (!smoke) {
    // A real heavy stage command executes in another Node process while MCP
    // serves reads. The country still contains10000 canonical task placements.
    const candidate = (await db.prepare("SELECT id FROM tasks_v3 WHERE city_id=? AND status='PLANNING' ORDER BY task_number LIMIT 1")
      .get<{ id: string }>(targetTask.cityId))!;
    const key = `http-heavy-${label}-${Date.now()}`;
    const beforeEvents = Number((await db.prepare("SELECT count(*)::integer AS count FROM task_events_v7 WHERE task_id=? AND event_type='STATUS_CHANGED'").get<{ count: number }>(candidate.id))!.count);
    await admission.reserve(9);
    const stage = call("task.set_status", { taskId: candidate.id, status: "STARTED", idempotencyKey: key, resultMode: "compact" })
      .then(result => ({ result }), error => ({ error }));
    let observedExecuting = false;
    const queuedAt = performance.now();
    while (performance.now() - queuedAt < 15_000) {
      const state = await db.prepare("SELECT status FROM world_generation_jobs_v1 WHERE country_id=? AND operation='task.set_status' AND idempotency_key=?")
        .get<{ status: string }>(fixture.countryId, key);
      if (state?.status === "EXECUTING") { observedExecuting = true; break; }
      if (state?.status === "COMPLETED" || state?.status === "FAILED") break;
      await pause(5);
    }
    assert.ok(observedExecuting, "Worker must be observed executing before concurrent reads begin");
    const duringReads = await Promise.all(Array.from({ length: 8 }, () => call("task.get", { taskId: targetTask.taskId, view: "compact" })));
    const completedStage = await stage;
    if ("error" in completedStage) throw completedStage.error;
    const job = await db.prepare("SELECT id,status,attempts FROM world_generation_jobs_v1 WHERE country_id=? AND operation='task.set_status' AND idempotency_key=?")
      .get<{ id: string; status: string; attempts: number }>(fixture.countryId, key);
    assert.equal(job?.status, "COMPLETED"); assert.equal(job.attempts, 1);
    await admission.reserve(1); await call("task.set_status", { taskId: candidate.id, status: "STARTED", idempotencyKey: key, resultMode: "compact" });
    const afterEvents = Number((await db.prepare("SELECT count(*)::integer AS count FROM task_events_v7 WHERE task_id=? AND event_type='STATUS_CHANGED'").get<{ count: number }>(candidate.id))!.count);
    assert.equal(afterEvents - beforeEvents, 1);
    report.heavyStage = { separateWorkerProcess: worker.pid !== process.pid, observedExecutingBeforeReads: observedExecuting,
      jobCompleted: true, attempts: job.attempts,
      idempotentStageEvents: afterEvents - beforeEvents, readsDuringJobMs: distribution(duringReads.map(sample => sample.elapsedMs)) };

    // Separate instance, same unmodified production route: verify90 allowed
    // requests followed by429, without consuming the benchmark's own window.
    const probe = Fastify({ logger: false }); await probe.register(rateLimit, { max: 5000, timeWindow: "1 minute" });
    const probeHandler = registerMcpHttp(probe, db, service, "http://localhost:3000");
    try {
      const probeBase = await probe.listen({ host: "127.0.0.1", port: 0 }); const codes: number[] = [];
      for (let request = 0; request < 91; request++) {
        const response = await fetch(`${probeBase}/mcp`, { method: "GET" }); codes.push(response.status); await response.arrayBuffer();
      }
      assert.ok(codes.slice(0, 90).every(code => code === 401)); assert.equal(codes[90], 429);
      report.rateLimit = { first90Unauthenticated: 401, request91: 429, productionGuardUnchanged: true };
    } finally { await probeHandler.close(); await probe.close(); }
    }
    report.httpCodes = httpCodes; report.admissionWaitMs = admission.waitedMs;
    report.finishedSourceFingerprints = await fingerprints();
    report.sourcesUnchangedDuringMeasurement = JSON.stringify(report.sourceFingerprints) === JSON.stringify(report.finishedSourceFingerprints);
    if (!smoke) assert.ok(report.sourcesUnchangedDuringMeasurement, "Production sources changed; repeat once after final source freeze");
    report.status = smoke ? "SMOKE_PASS" : "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = safeMessage(error); process.exitCode = 1;
  } finally {
    await client?.close().catch(() => undefined); await listener?.close(); await dispatcher.close();
    if (worker) {
      worker.kill("SIGTERM");
      await Promise.race([new Promise(resolve => { if (worker!.exitCode !== null) resolve(undefined); else worker!.once("exit", resolve); }), pause(10_000)]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }
    await handler.close(); await app.close(); await db.close();
    report.finishedAt = new Date().toISOString();
    await writeFile(`${folder}/${label}.json`, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ event: "http-benchmark-complete", status: report.status, phases: (report.phases as unknown[] | undefined)?.length ?? 0 }));
  }
}

if (process.argv.includes("--worker")) {
  const db = await createDb(uri, { schema: fixture.schema, maxConnections: 4 });
  const worker = startWorldGenerationWorker(db, new AppService(db), "local-http-benchmark-worker", () => undefined);
  process.send?.({ ready: true });
  process.once("SIGTERM", () => { void worker.close().then(() => db.close()).then(() => process.exit(0)); });
} else {
  await runBenchmark();
}
