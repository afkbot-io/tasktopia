import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { createMcpServer, type McpIdentity } from "../src/server/mcp";
import { enqueueWorldGenerationJob, processNextWorldGenerationJob } from "../src/server/world-generation-jobs";

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
      userId: owner.user.id, countryId: owner.user.countryId, countryRole: "OWNER",
      tokenId: crypto.randomUUID(), scopes: ["country:read"],
    };
    const server = await createMcpServer(db, new AppService(db), identity);
    const client = new Client({ name: "generation-boundary-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const ownPending = await client.callTool({ name: "world_generation.get", arguments: { jobId: pending.id } });
      expect(ownPending.isError).not.toBe(true);
      expect(ownPending.structuredContent).toMatchObject({ result: { id: pending.id, status: "PENDING" } });

      await processNextWorldGenerationJob(db, new AppService(db), "mcp-boundary-worker");
      const ownCompleted = await client.callTool({ name: "world_generation.get", arguments: { jobId: pending.id } });
      expect(ownCompleted.structuredContent).toMatchObject({
        result: { id: pending.id, status: "COMPLETED", result: { name: "MCP queued city" } },
      });

      for (const jobId of [foreignJob.id, crypto.randomUUID()]) {
        const hidden = await client.callTool({ name: "world_generation.get", arguments: { jobId } });
        expect(hidden.isError).toBe(true);
        expect(JSON.parse((hidden.content[0] as { text: string }).text)).toMatchObject({ code: "NOT_FOUND" });
      }
    } finally {
      await client.close();
      await server.close();
    }
  }, 20_000);
});
