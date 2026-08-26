import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { createMcpServer, type McpIdentity } from "../src/server/mcp";
import {
  enqueueWorldGenerationJob,
  PostgresWorldGenerationDispatcher,
  processNextWorldGenerationJob,
} from "../src/server/world-generation-jobs";

describe("MCP generation polling boundary", () => {
  let db: Db;

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db?.close(); });

  it("returns pending and completed own jobs while hiding foreign and missing jobs", async () => {
    const owner = await registerUser(db, { email: "mcp-jobs@example.test", name: "MCP Jobs", password: "password123" });
    const foreign = await registerUser(db, { email: "mcp-foreign@example.test", name: "MCP Foreign", password: "password123" });
    const pending = await enqueueWorldGenerationJob(db, owner.user.countryId, "city.create", "mcp-job", {
      name: "MCP queued city", idempotencyKey: "mcp-job",
    });
    const foreignJob = await enqueueWorldGenerationJob(db, foreign.user.countryId, "city.create", "mcp-foreign-job", {
      name: "Foreign MCP city", idempotencyKey: "mcp-foreign-job",
    });
    const identity: McpIdentity = {
      userId: owner.user.id,
      tokenId: crypto.randomUUID(), scopes: ["country:read"],
    };
    const server = await createMcpServer(db, new AppService(db), identity);
    const client = new Client({ name: "generation-boundary-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const ownPending = await client.callTool({ name: "world_generation.get", arguments: { countryId: owner.user.countryId, jobId: pending.id } });
      expect(ownPending.isError).not.toBe(true);
      expect(ownPending.structuredContent).toMatchObject({ result: { id: pending.id, status: "PENDING" } });

      await processNextWorldGenerationJob(db, new AppService(db), "mcp-boundary-worker");
      const ownCompleted = await client.callTool({ name: "world_generation.get", arguments: { countryId: owner.user.countryId, jobId: pending.id } });
      expect(ownCompleted.structuredContent).toMatchObject({
        result: { id: pending.id, status: "COMPLETED", result: { name: "MCP queued city" } },
      });

      for (const jobId of [foreignJob.id, crypto.randomUUID()]) {
        const hidden = await client.callTool({ name: "world_generation.get", arguments: { countryId: owner.user.countryId, jobId } });
        expect(hidden.isError).toBe(true);
        expect(JSON.parse((hidden.content[0] as { text: string }).text)).toMatchObject({ code: "NOT_FOUND" });
      }
    } finally {
      await client.close();
      await server.close();
    }
  }, 20_000);

  it("creates a task through MCP when optional task fields are omitted and replays it idempotently", async () => {
    const owner = await registerUser(db, {
      email: "mcp-task-create@example.test", name: "MCP Task Create", password: "password123",
    });
    const setupService = new AppService(db);
    const city = await setupService.createCity(owner.user.countryId, {
      name: "MCP task city", idempotencyKey: "mcp-task-city",
    });
    const district = await setupService.createDistrict(owner.user.countryId, {
      cityId: city.id, name: "MCP task district", activate: true, idempotencyKey: "mcp-task-district",
    });
    const dispatchedService = new AppService(
      db, undefined, "data/uploads", new PostgresWorldGenerationDispatcher(db, 0, 1),
    );
    const identity: McpIdentity = {
      userId: owner.user.id,
      tokenId: crypto.randomUUID(),
      scopes: ["tasks:read", "tasks:write"],
    };
    const server = await createMcpServer(db, dispatchedService, identity);
    const client = new Client({ name: "task-create-idempotency-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const request = {
      countryId: owner.user.countryId,
      cityId: city.id,
      districtId: district.id,
      title: "Task without optional fields",
      estimate: 1,
      idempotencyKey: "mcp-task-without-optionals",
    };

    try {
      const accepted = await client.callTool({ name: "task.create", arguments: request });
      expect(JSON.parse((accepted.content[0] as { text: string }).text)).toMatchObject({
        status: "accepted",
        job: { operation: "task.create", status: "PENDING", idempotencyKey: request.idempotencyKey },
      });

      const persisted = await db.prepare(`SELECT payload_json FROM world_generation_jobs_v1
        WHERE country_id = ? AND operation = 'task.create' AND idempotency_key = ?`)
        .get<{ payload_json: Record<string, unknown> }>(owner.user.countryId, request.idempotencyKey);
      expect(persisted?.payload_json).toMatchObject({
        cityId: request.cityId,
        districtId: request.districtId,
        title: request.title,
        estimate: request.estimate,
        idempotencyKey: request.idempotencyKey,
      });
      expect(persisted?.payload_json).not.toHaveProperty("dueAt");
      expect(persisted?.payload_json).not.toHaveProperty("assigneeUserId");

      await processNextWorldGenerationJob(db, setupService, "mcp-task-worker");
      const replay = await client.callTool({ name: "task.create", arguments: request });
      expect(replay.isError).not.toBe(true);
      const created = (replay.structuredContent as {
        result?: { id: string; title: string };
      } | undefined)?.result;
      expect(created).toMatchObject({ title: request.title });

      const taskCount = await db.prepare("SELECT COUNT(*)::integer AS count FROM tasks_v3 WHERE title = ?")
        .get<{ count: number }>(request.title);
      expect(taskCount?.count).toBe(1);
      const jobCount = await db.prepare(`SELECT COUNT(*)::integer AS count FROM world_generation_jobs_v1
        WHERE country_id = ? AND operation = 'task.create' AND idempotency_key = ?`)
        .get<{ count: number }>(owner.user.countryId, request.idempotencyKey);
      expect(jobCount?.count).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  }, 20_000);
});
