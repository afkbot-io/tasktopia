import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { createMcpToken, inviteCountryMember, registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerMcpHttp } from "../src/server/mcp-http";
import { PostgresWorldGenerationDispatcher, processNextWorldGenerationJob } from "../src/server/world-generation-jobs";
import type { McpScope, TaskDto } from "../src/shared/contracts";

type Reply = Awaited<ReturnType<Client["callTool"]>>;
type Job = { id: string; countryId: string; operation: string; status: string; result?: Record<string, unknown> };
const data = <T>(reply: Reply): T => {
  expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
  return (reply.structuredContent as { result: T }).result;
};

describe("actual HTTP SDK durable spatial commands", { timeout: 30_000 }, () => {
  let db: Db, app: FastifyInstance, worker: AppService, dispatcher: PostgresWorldGenerationDispatcher;
  let owner: Client, countryReader: Client, taskReader: Client, writeOnly: Client;
  let countryId: string, foreignCountryId: string, ownerId: string, cityId: string, firstId: string, secondId: string;
  let ownerAuthorization: string;
  let moving: TaskDto, deleting: TaskDto;
  const clients: Client[] = [];
  const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: { countryId, ...args } });
  const poll = (client: Client, id: string, view?: string) => call(client, "world_generation.get", { jobId: id, ...(view ? { view } : {}) });
  const events = async () => Number((await db.prepare("SELECT COUNT(*) AS count FROM events WHERE country_id=?").get<{ count: string }>(countryId))!.count);
  const accepted = (reply: Reply, operation: string) => {
    const value = data<{ status: string; job: Job }>(reply);
    expect(value).toMatchObject({ status: "accepted", job: { countryId, operation, status: "PENDING" } });
    expect(value.job).not.toHaveProperty("payload");
    return value.job;
  };

  beforeAll(async () => {
    db = await createTestDb(); worker = new AppService(db);
    const account = await registerUser(db, { email: "async-http-owner@example.test", name: "Async owner", password: "password123" });
    countryId = account.user.countryId; ownerId = account.user.id;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const city = await worker.createCity(countryId, { name: "Async command city", idempotencyKey: "async-http-city" }); cityId = city.id;
    firstId = (await worker.createDistrict(countryId, { cityId, name: "First sprint", activate: true, idempotencyKey: "async-http-first" })).id;
    secondId = (await worker.createDistrict(countryId, { cityId, name: "Second sprint", idempotencyKey: "async-http-second" })).id;
    moving = await worker.createTask(countryId, { cityId, districtId: firstId, title: "Moving task", estimate: 1, idempotencyKey: "async-http-moving" });
    deleting = await worker.createTask(countryId, { cityId, districtId: firstId, title: "Deleting task", estimate: 1, idempotencyKey: "async-http-deleting" });
    dispatcher = new PostgresWorldGenerationDispatcher(db, 0);
    app = Fastify(); registerMcpHttp(app, db, new AppService(db, undefined, "data/uploads", dispatcher), "http://localhost:3000");
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const connect = async (label: string, scopes?: McpScope[]) => {
      const user = label === "owner" ? account : await registerUser(db, { email: `async-http-${label}@example.test`, name: label, password: "password123" });
      if (label !== "owner") await inviteCountryMember(db, countryId, ownerId, user.user.email, label === "write" ? "MEMBER" : "VIEWER");
      if (label === "country") foreignCountryId = user.user.countryId;
      const token = await createMcpToken(db, user.user.countryId, label, user.user.id, { scopes });
      if (label === "owner") ownerAuthorization = `Bearer ${token.token}`;
      const client = new Client({ name: `async-http-${label}`, version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token.token}` } } }));
      clients.push(client); return client;
    };
    owner = await connect("owner"); countryReader = await connect("country", ["country:read"]);
    taskReader = await connect("task", ["tasks:read"]); writeOnly = await connect("write", ["tasks:write"]);
  });
  afterAll(async () => { for (const client of clients) await client.close(); await app?.close(); await dispatcher?.close(); await db?.close(); });

  it("keeps confirmation guards effective in the worker and rejects unauthorized admission", async () => {
    const beforeEvents = await events();
    expect((await call(countryReader, "task.delete", { taskId: deleting.id, confirmTitle: deleting.title, idempotencyKey: "async-denied" })).isError).toBe(true);
    const guards = [
      { name: "city.delete", args: { cityId, confirmName: "Wrong confirmation" } },
      { name: "district.delete", args: { districtId: secondId, confirmName: "Wrong confirmation" } },
      { name: "task.delete", args: { taskId: deleting.id, confirmTitle: "Wrong confirmation" } },
    ];
    for (const [index, guard] of guards.entries()) {
      const job = accepted(await call(owner, guard.name, { ...guard.args, idempotencyKey: `async-wrong-confirmation-${index}` }), guard.name);
      expect(await events()).toBe(beforeEvents);
      expect(await processNextWorldGenerationJob(db, worker, "async-failed-guard")).toBe(true);
      expect(data<Job>(await poll(owner, job.id))).toMatchObject({ countryId, status: "FAILED", error: { code: "CONFIRMATION_MISMATCH" } });
    }
    expect(await events()).toBe(beforeEvents);
    expect((await worker.listCities(countryId)).map(city => city.id)).toContain(cityId);
    expect((await worker.listDistricts(countryId, cityId)).map(district => district.id)).toContain(secondId);
    expect((await worker.getTask(countryId, deleting.id)).id).toBe(deleting.id);
  });

  it("admits an authorized write-only member without granting read permission", async () => {
    const job = accepted(await call(writeOnly, "task.set_status", { taskId: deleting.id, status: "PLANNING", resultMode: "compact", idempotencyKey: "async-write-only" }), "task.set_status");
    expect((await poll(writeOnly, job.id)).isError).toBe(true);
    expect(await processNextWorldGenerationJob(db, worker, "async-write-only-worker")).toBe(true);
    expect(data<Job>(await poll(taskReader, job.id, "compact"))).toMatchObject({ status: "COMPLETED", result: { id: deleting.id, status: "PLANNING" } });
    expect((await worker.getTask(countryId, deleting.id)).assignee).toBeNull();
  });

  it("executes all six operations only in the worker and replays full/compact results without a second mutation", async () => {
    const operations = [
      { name: "task.set_status", args: { taskId: moving.id, status: "STARTED", resultMode: "compact" },
        before: async () => expect(await worker.getTask(countryId, moving.id)).toMatchObject({ status: "PLANNING", assignee: null }),
        after: async () => expect(await worker.getTask(countryId, moving.id)).toMatchObject({ status: "STARTED", assignee: { id: ownerId } }),
        result: { kind: "task.command-result", id: moving.id, status: "STARTED" } },
      { name: "task.transfer", args: { taskId: moving.id, targetDistrictId: secondId, resultMode: "compact" },
        before: async () => expect(await worker.getTask(countryId, moving.id)).toMatchObject({ districtId: firstId }),
        after: async () => expect(await worker.getTask(countryId, moving.id)).toMatchObject({ id: moving.id, taskNumber: moving.taskNumber, districtId: secondId, status: "STARTED" }),
        result: { kind: "task.command-result", id: moving.id, districtId: secondId } },
      { name: "task.delete", args: { taskId: deleting.id, confirmTitle: deleting.title },
        before: async () => expect((await worker.getTask(countryId, deleting.id)).id).toBe(deleting.id),
        after: async () => expect(await db.prepare("SELECT id FROM tasks_v3 WHERE id=?").get(deleting.id)).toBeUndefined(), result: { deleted: true, taskId: deleting.id } },
      { name: "district.complete", args: { districtId: firstId },
        before: async () => expect((await worker.listDistricts(countryId, cityId)).find(d => d.id === firstId)?.status).toBe("ACTIVE"),
        after: async () => expect((await worker.listDistricts(countryId, cityId)).find(d => d.id === firstId)?.status).toBe("COMPLETED"), result: { id: firstId, status: "COMPLETED" } },
      { name: "district.delete", args: { districtId: secondId, confirmName: "Second sprint" },
        before: async () => expect((await worker.getTask(countryId, moving.id)).id).toBe(moving.id),
        after: async () => { expect(await db.prepare("SELECT id FROM tasks_v3 WHERE id=?").get(moving.id)).toBeUndefined(); expect((await worker.listDistricts(countryId, cityId)).find(d => d.id === secondId)?.status).toBe("ABANDONED"); },
        result: { deleted: true, districtId: secondId, tasksDeleted: 1 } },
      { name: "city.delete", args: { cityId, confirmName: "Async command city" },
        before: async () => expect((await worker.listCities(countryId)).some(city => city.id === cityId)).toBe(true),
        after: async () => expect(await worker.listCities(countryId)).toEqual([]), result: { deleted: true, cityId } },
    ];
    for (const [index, operation] of operations.entries()) {
      const idempotencyKey = `async-http-op-${index}`, args = { ...operation.args, idempotencyKey };
      const beforeEvents = await events();
      const job = accepted(await call(owner, operation.name, args), operation.name);
      await operation.before(); expect(await events()).toBe(beforeEvents);
      expect(data<Job>(await poll(owner, job.id))).toMatchObject({ id: job.id, countryId, status: "PENDING" });
      const allowed = operation.name.startsWith("task.") ? taskReader : countryReader;
      const denied = operation.name.startsWith("task.") ? countryReader : taskReader;
      expect((await poll(denied, job.id)).isError).toBe(true);
      expect((await poll(writeOnly, job.id)).isError).toBe(true);
      expect((await call(owner, "world_generation.get", { countryId: foreignCountryId, jobId: job.id })).isError).toBe(true);
      expect(await processNextWorldGenerationJob(db, worker, `async-http-worker-${index}`)).toBe(true);
      await operation.after(); expect(await events()).toBe(beforeEvents + 1);
      const complete = data<Job>(await poll(allowed, job.id, "compact"));
      expect(complete).toMatchObject({ id: job.id, countryId, status: "COMPLETED", result: operation.result });
      expect(complete).not.toHaveProperty("payload");
      const compactReplay = data<Record<string, unknown>>(await call(owner, operation.name, args));
      expect(compactReplay).toMatchObject(operation.result);
      if ("resultMode" in operation.args) {
        expect(compactReplay).not.toHaveProperty("comments");
        const full = data<Record<string, unknown>>(await call(owner, operation.name, { ...args, resultMode: "full" }));
        expect(full).toMatchObject({ id: moving.id, comments: expect.any(Array) });
        expect(full).not.toHaveProperty("kind");
        expect(data<Job>(await poll(allowed, job.id)).result).toMatchObject({ id: moving.id, comments: expect.any(Array) });
      }
      expect(await events()).toBe(beforeEvents + 1);
      expect(await processNextWorldGenerationJob(db, worker, "async-http-no-duplicate")).toBe(false);
      const count = await db.prepare("SELECT COUNT(*) AS count FROM world_generation_jobs_v1 WHERE country_id=? AND operation=? AND idempotency_key=?")
        .get<{ count: string }>(countryId, operation.name, idempotencyKey);
      expect(Number(count?.count)).toBe(1);
      const receiptOperation = { "task.set_status": "task.status.v3", "task.transfer": "task.transfer.v1", "task.delete": "task.delete.v1",
        "district.complete": "district.complete.v3", "district.delete": "district.delete.v1", "city.delete": "city.delete.v1" }[operation.name];
      expect(Number((await db.prepare("SELECT COUNT(*) AS count FROM idempotency WHERE country_id=? AND operation=? AND idempotency_key=?")
        .get<{ count: string }>(countryId, receiptOperation, idempotencyKey))?.count)).toBe(1);
    }
  });

  it("releases an actual SDK caller's waiter on transport close while preserving the committed job", async () => {
    const waitingDispatcher = new PostgresWorldGenerationDispatcher(db, 5_000, 50);
    const waitingApp = Fastify();
    registerMcpHttp(waitingApp, db, new AppService(db, undefined, "data/uploads", waitingDispatcher), "http://localhost:3000");
    const base = await waitingApp.listen({ host: "127.0.0.1", port: 0 });
    const client = new Client({ name: "async-aborted-wait", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    const key = "async-client-disconnected", beforeEvents = await events();
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: ownerAuthorization } } }));
      const pending = call(client, "city.create", { name: "Surviving queued city", idempotencyKey: key }).catch(error => error as Error);
      await vi.waitFor(() => expect(waitingDispatcher.runtimeStats()).toMatchObject({ waiters: 1, observers: 1 }), { timeout: 1_000 });
      const job = await db.prepare("SELECT id FROM world_generation_jobs_v1 WHERE country_id=? AND idempotency_key=?").get<{ id: string }>(countryId, key);
      expect(job?.id).toEqual(expect.any(String));
      await client.close();
      await vi.waitFor(() => expect(waitingDispatcher.runtimeStats()).toMatchObject({ waiters: 0, observers: 0 }), { timeout: 1_000 });
      expect(await pending).toBeInstanceOf(Error);
      expect(data<Job>(await poll(owner, job!.id))).toMatchObject({ status: "PENDING", countryId });
      expect(await events()).toBe(beforeEvents);
      expect(await processNextWorldGenerationJob(db, worker, "async-after-disconnect")).toBe(true);
      expect(data<Job>(await poll(owner, job!.id))).toMatchObject({ status: "COMPLETED", result: { name: "Surviving queued city" } });
      expect(await events()).toBe(beforeEvents + 1);
      expect(await processNextWorldGenerationJob(db, worker, "async-after-disconnect-duplicate")).toBe(false);
    } finally { await client.close(); await waitingDispatcher.close(); await waitingApp.close(); }
  });

});
