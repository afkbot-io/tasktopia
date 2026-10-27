import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createMcpToken, registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerMcpHttp } from "../src/server/mcp-http";
import type { TaskDto } from "../src/shared/contracts";

let db: Db;
let app: FastifyInstance;
let client: Client;
let service: AppService;
let countryId: string;
let task: TaskDto;
const existingBody = "Persisted history ".repeat(4);
const result = <T>(response: Awaited<ReturnType<Client["callTool"]>>): T => {
  expect(response.structuredContent).toHaveProperty("result");
  return (response.structuredContent as { result: T }).result;
};

beforeAll(async () => {
  db = await createTestDb();
  service = new AppService(db);
  const owner = await registerUser(db, { email: "mcp-large-history@example.test", name: "Large history", password: "password123" });
  countryId = owner.user.countryId;
  await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
  const city = await service.createCity(countryId, { name: "History city", idempotencyKey: "history-city" });
  const district = await service.createDistrict(countryId, { cityId: city.id, name: "History sprint", activate: true, idempotencyKey: "history-district" });
  task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Large history task", estimate: 1, idempotencyKey: "history-task" });
  await db.prepare(`INSERT INTO task_comments_v3(id,task_id,body,actor,created_at)
    SELECT gen_random_uuid()::text,?,?,'History fixture',now()+n*interval '1 microsecond'
    FROM generate_series(1,10000) n`).run(task.id, existingBody);
  const token = await createMcpToken(db, countryId, "History HTTP contract", owner.user.id, { scopes: ["tasks:read", "comments:write"] });
  app = Fastify();
  registerMcpHttp(app, db, service, "http://localhost:3000");
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  client = new Client({ name: "large-history-contract", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token.token}` } },
  }));
}, 60_000);
afterAll(async () => { await client?.close(); await app?.close(); await db?.close(); });

it("keeps real HTTP MCP reads and commands bounded with 10000 comments and replays full compatibility exactly once", async () => {
  const observations: Record<string, number> = { fixtureComments: 10_000, existingCommentBodyBytes: Buffer.byteLength(existingBody) };
  const call = async (name: string, args: Record<string, unknown>) => {
    const started = performance.now();
    const response = await client.callTool({ name, arguments: { countryId, taskId: task.id, ...args } }, { timeout: 15_000 });
    expect(response.isError, JSON.stringify(response.isError ? response.content : undefined)).not.toBe(true);
    return { response, elapsedMs: performance.now() - started, bytes: Buffer.byteLength(JSON.stringify(response)) };
  };
  const compact = await call("task.get", { view: "compact" });
  expect(compact.response.structuredContent).toMatchObject({ result: { kind: "task.card", id: task.id, counts: { comments: 10_000 } } });
  expect(result(compact.response)).not.toHaveProperty("comments");
  expect(compact.bytes).toBeLessThan(25_000);
  observations.compactReadBytes = compact.bytes; observations.compactReadMs = compact.elapsedMs;

  const command = { body: "Exactly one HTTP comment after a large history", idempotencyKey: "large-history-one-comment" };
  const accepted = await call("task.add_comment", { ...command, resultMode: "compact" });
  expect(accepted.response.structuredContent).toMatchObject({ result: { kind: "task.command-result", id: task.id } });
  expect(accepted.bytes).toBeLessThan(4096);
  observations.compactCommandBytes = accepted.bytes; observations.compactCommandMs = accepted.elapsedMs;
  const readReceipt = () => db.prepare(`SELECT request_hash,response_json FROM idempotency
    WHERE country_id=? AND operation='task.comment.v3' AND idempotency_key=?`).get(countryId, command.idempotencyKey);
  const receipt = await readReceipt();
  expect(receipt?.response_json).toMatchObject({ receiptVersion: 2, entityKind: "task", entityId: task.id });
  observations.storedReceiptBytes = Buffer.byteLength(JSON.stringify(receipt?.response_json));
  expect(observations.storedReceiptBytes).toBeLessThan(512);
  const version = (await service.getCountry(countryId)).worldVersion;

  const replay = await call("task.add_comment", { ...command, resultMode: "full" });
  const full = result<TaskDto>(replay.response);
  expect(full.id).toBe(task.id);
  expect(full.comments).toHaveLength(10_001);
  const comments = full.comments!;
  expect(new Set(comments.map(comment => comment.id)).size).toBe(10_001);
  expect(comments.filter(comment => comment.body === existingBody)).toHaveLength(10_000);
  expect(comments.filter(comment => comment.body === command.body)).toHaveLength(1);
  expect(await readReceipt()).toEqual(receipt);
  expect((await service.getCountry(countryId)).worldVersion).toBe(version);
  const persisted = await db.prepare(`SELECT
    (SELECT COUNT(*)::integer FROM task_comments_v3 WHERE task_id=?) AS comments,
    (SELECT COUNT(*)::integer FROM task_events_v7 WHERE task_id=? AND event_type='COMMENT_ADDED') AS events`)
    .get<{ comments: number; events: number }>(task.id, task.id);
  expect(persisted).toEqual({ comments: 10_001, events: 1 });
  observations.fullCompatibilityBytes = replay.bytes; observations.fullCompatibilityMs = replay.elapsedMs;
  observations.storedComments = persisted!.comments; observations.storedCommentEvents = persisted!.events;
  console.info("MCP_HTTP_LARGE_HISTORY", JSON.stringify(observations));
}, 30_000);
