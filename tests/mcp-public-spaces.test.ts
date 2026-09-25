import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createMcpServer } from "../src/server/mcp";
import { createTestDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { TASK_PARK_VARIANTS } from "../src/shared/task-park-catalog";
import type { TaskDto } from "../src/shared/contracts";

it("automatically selects artwork and validates the strict MCP creation contract", async () => {
  const db = await createTestDb();
  const service = new AppService(db);
  const { user } = await registerUser(db, { email: "park-mcp@example.test", name: "Parks", password: "password123" });
  const server = await createMcpServer(db, service, { userId: user.id, tokenId: crypto.randomUUID(), scopes: ["tasks:read", "tasks:write"] });
  const client = new Client({ name: "park-contract-test", version: "1.0.0" });
  try {
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
    const city = await service.createCity(user.countryId, { name: "Public space MCP", idempotencyKey: "city" });
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "Sprint", activate: true, idempotencyKey: "district" });
    const [transport, peer] = InMemoryTransport.createLinkedPair();
    await server.connect(peer); await client.connect(transport);
    const tool = (await client.listTools()).tools.find(t => t.name === "task.create")!;
    expect(tool.inputSchema.required).toContain("countryId");
    expect(tool.inputSchema.properties).not.toHaveProperty("parkVariant");
    const args = { countryId: user.countryId, cityId: city.id, districtId: district.id, title: "Monument", estimate: 1, idempotencyKey: "park-once" };
    const created = await client.callTool({ name: "task.create", arguments: args });
    expect(created.isError).not.toBe(true);
    const task = (created.structuredContent as { result: TaskDto }).result;
    expect(task).toMatchObject({ stage: 1 });
    expect(task.footprint.length).toBeGreaterThan(0);
    expect((await client.callTool({ name: "task.create", arguments: args })).structuredContent).toEqual(created.structuredContent);
    expect((await client.callTool({ name: "task.get", arguments: { countryId: user.countryId, taskId: task.id } })).structuredContent).toMatchObject({ result: {
      id: task.id, taskNumber: task.taskNumber, visualKind: task.visualKind, visualAssetKey: task.visualAssetKey, footprint: task.footprint,
    } });
    for (const invalid of [{ ...args, parkVariant: "toString", idempotencyKey: "bad-variant" }, { ...args, visualKind: "BUILDING", idempotencyKey: "bad-kind" }, { ...args, countryId: undefined, idempotencyKey: "bad-scope" }]) {
      expect((await client.callTool({ name: "task.create", arguments: invalid })).isError).toBe(true);
    }
    expect(await service.listTasks(user.countryId)).toHaveLength(1);
    const constraint = await db.prepare("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='tasks_v3'::regclass AND conname='tasks_v3_park_asset_check'").get<{ definition: string }>();
    expect(constraint!.definition.match(/urban-[a-z]+/g)).toEqual([...TASK_PARK_VARIANTS]);
  } finally { await client.close(); await server.close(); await db.close(); }
}, 30_000);
