import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import fastifyCookie from "@fastify/cookie";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { authenticateMcpToken, createCountry, createMcpToken, inviteCountryMember, registerUser, setActiveCountry } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { createMcpServer, type McpIdentity } from "../src/server/mcp";
import { registerRoutes } from "../src/server/routes";
import type { TaskDto } from "../src/shared/contracts";

describe("MCP explicit-country permanent sprint transfer", { timeout: 30_000 }, () => {
  let db: Db, service: AppService, identity: McpIdentity, viewerIdentity: McpIdentity;
  let countryId: string, activeCountryId: string, foreignCountryId: string, targetDistrictId: string;
  let foreignDistrictId: string, crossCityDistrictId: string, task: TaskDto;
  const sessions: Array<{ client: Client; server: Awaited<ReturnType<typeof createMcpServer>> }> = [];
  const connect = async (caller = identity) => {
    const server = await createMcpServer(db, service, caller);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "permanent-transfer-contract", version: "1.0.0" });
    await client.connect(clientTransport); sessions.push({ client, server });
    return client;
  };
  const request = () => ({ countryId, taskId: task.id, targetDistrictId, idempotencyKey: "mcp-transfer-once" });
  beforeAll(async () => {
    db = await createTestDb(); service = new AppService(db);
    const owner = await registerUser(db, { email: "mcp-transfer-owner@example.test", name: "Owner", password: "password123" });
    const viewer = await registerUser(db, { email: "mcp-transfer-viewer@example.test", name: "Viewer", password: "password123" });
    activeCountryId = owner.user.countryId; foreignCountryId = viewer.user.countryId;
    countryId = await createCountry(db, owner.user.id, "Explicit transfer country");
    await inviteCountryMember(db, countryId, owner.user.id, viewer.user.email, "VIEWER");
    for (const scope of [countryId, foreignCountryId]) await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(scope);
    const project = async (scope: string, key: string) => {
      const city = await service.createCity(scope, { name: `Project ${key}`, idempotencyKey: `city-${key}` });
      const district = await service.createDistrict(scope, { cityId: city.id, name: `Sprint ${key}`, activate: true, idempotencyKey: `district-${key}` });
      return { city, district };
    };
    const home = await project(countryId, "home"), foreign = await project(foreignCountryId, "foreign"), other = await project(countryId, "other");
    targetDistrictId = (await service.createDistrict(countryId, { cityId: home.city.id, name: "Next sprint", idempotencyKey: "next-sprint" })).id;
    foreignDistrictId = foreign.district.id; crossCityDistrictId = other.district.id;
    task = await service.createTask(countryId, { cityId: home.city.id, districtId: home.district.id, title: "Durable task", estimate: 1, idempotencyKey: "durable-task" });
    await setActiveCountry(db, owner.user.id, activeCountryId);
    const token = await createMcpToken(db, activeCountryId, "Transfer", owner.user.id, { scopes: ["tasks:read", "tasks:write"] });
    identity = (await authenticateMcpToken(db, `Bearer ${token.token}`))!;
    // A token can retain write scope from its own country; current target-country
    // membership must still reject it after role resolution.
    viewerIdentity = { userId: viewer.user.id, tokenId: crypto.randomUUID(), scopes: ["tasks:read", "tasks:write"] };
  });
  afterAll(async () => {
    for (const session of sessions) { await session.client.close(); await session.server.close(); }
    await db?.close();
  });

  it("advertises a strict explicit-country tool and rejects malformed calls before mutation", async () => {
    const client = await connect(), tools = (await client.listTools()).tools;
    const transfer = tools.find(tool => tool.name === "task.transfer");
    expect(transfer).toBeDefined();
    expect(transfer!.inputSchema.required).toEqual(expect.arrayContaining(["countryId", "taskId", "targetDistrictId", "idempotencyKey"]));
    expect(transfer!.inputSchema.additionalProperties).toBe(false);
    expect(transfer!.annotations).toMatchObject({ idempotentHint: true });
    expect(tools.find(tool => tool.name === "task.delete")!.description).not.toMatch(/освободить.*участок/);
    const missingCountry = { taskId: task.id, targetDistrictId, idempotencyKey: "missing-country" };
    for (const args of [missingCountry, { ...request(), taskId: "bad" }, { ...request(), targetDistrictId: "bad" },
      { ...request(), idempotencyKey: "x" }, { ...request(), comment: "x".repeat(4001) }, { ...request(), stage: 5 }]) {
      const result = await client.callTool({ name: "task.transfer", arguments: args });
      expect(result.isError).toBe(true);
    }
    expect((await service.getTask(countryId, task.id)).districtId).toBe(task.districtId);
    expect(await service.listWorldFeatures(countryId)).toEqual([]);
  });

  it("checks token scope, live membership and target ownership without exposing or changing another project", async () => {
    for (const caller of [{ ...identity, scopes: ["tasks:read"] as McpIdentity["scopes"] }, viewerIdentity]) {
      const result = await (await connect(caller)).callTool({ name: "task.transfer", arguments: request() });
      expect(result.isError).toBe(true); expect(JSON.stringify(result.content)).toContain("FORBIDDEN_SCOPE");
    }
    const client = await connect();
    for (const [args, code] of [
      [{ ...request(), countryId: foreignCountryId }, "COUNTRY_ACCESS_DENIED"],
      [{ ...request(), targetDistrictId: foreignDistrictId }, "NOT_FOUND"],
      [{ ...request(), targetDistrictId: crossCityDistrictId }, "INVALID_INPUT"],
    ] as const) {
      const result = await client.callTool({ name: "task.transfer", arguments: args });
      expect(result.isError).toBe(true); expect(JSON.stringify(result.content)).toContain(code);
      expect(JSON.stringify(result.content)).not.toContain("Project foreign");
    }
    expect((await service.getTask(countryId, task.id)).districtId).toBe(task.districtId);
    expect(await service.listWorldFeatures(countryId)).toEqual([]);
  });

  it("moves once across reconnects, preserves the canonical identity and returns country-scoped human links", async () => {
    let client = await connect();
    const result = await client.callTool({ name: "task.transfer", arguments: { ...request(), comment: "Next sprint" } });
    expect(result.isError).not.toBe(true);
    const moved = (result.structuredContent as { result: TaskDto & { url: string } }).result;
    expect(moved).toMatchObject({ id: task.id, taskNumber: task.taskNumber, cityId: task.cityId, districtId: targetDistrictId, stage: task.stage });
    expect(moved.origin).not.toEqual(task.origin);
    const link = new URL(moved.url);
    expect(link.pathname).toBe(`/task/${task.taskNumber}`);
    expect(Object.fromEntries(link.searchParams)).toEqual({ countryId, taskId: task.id });
    await client.close(); client = await connect();
    const replay = await client.callTool({ name: "task.transfer", arguments: { ...request(), comment: "Next sprint" } });
    expect(replay.structuredContent).toEqual(result.structuredContent);
    const current = await client.callTool({ name: "task.get", arguments: { countryId, taskId: task.id } });
    expect(current.structuredContent).toEqual(result.structuredContent);
    // A real authenticated HTTP retry scopes country separately, unlike the MCP envelope.
    const app = Fastify(); await app.register(fastifyCookie); await registerRoutes(app, db, service); await app.ready();
    try {
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "mcp-transfer-owner@example.test", password: "password123" } });
      const cookies = login.headers["set-cookie"]!;
      const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
      await setActiveCountry(db, identity.userId, countryId);
      const httpRetry = await app.inject({ method: "POST", url: `/api/tasks/${task.id}/transfer`, headers: { cookie },
        payload: { targetDistrictId, idempotencyKey: request().idempotencyKey, comment: "Next sprint" } });
      expect(httpRetry.statusCode).toBe(200);
      expect(httpRetry.json()).toMatchObject({ id: task.id, districtId: targetDistrictId, origin: moved.origin });
    } finally { await setActiveCountry(db, identity.userId, activeCountryId); await app.close(); }
    expect(await service.listWorldFeatures(countryId)).toEqual([expect.objectContaining({
      origin: task.origin, siteMarker: expect.objectContaining({ kind: "RELOCATED", targetTaskId: task.id, permanent: true }),
    })]);
    expect((await service.listEvents(countryId, 0)).filter(event => event.type === "task.transferred")).toHaveLength(1);
    expect(await db.prepare("SELECT active_country_id FROM users WHERE id=?").get(identity.userId)).toEqual({ active_country_id: activeCountryId });
  });

  it("also returns canonical country and UUID links from task creation and link mutations", async () => {
    const client = await connect();
    const created = await client.callTool({ name: "task.create", arguments: {
      countryId, cityId: task.cityId, districtId: targetDistrictId, title: "Linked follow-up", estimate: 1, idempotencyKey: "linked-follow-up",
    } });
    expect(created.isError).not.toBe(true);
    const value = (created.structuredContent as { result: TaskDto & { url: string } }).result;
    expect(Object.fromEntries(new URL(value.url).searchParams)).toEqual({ countryId, taskId: value.id });
    for (const name of ["task.link_add", "task.link_remove"]) {
      const result = await client.callTool({ name, arguments: { countryId, taskId: value.id, url: "https://example.test/review/1", idempotencyKey: name } });
      expect(result.isError).not.toBe(true);
      expect((result.structuredContent as { result: { url: string } }).result.url).toBe(value.url);
    }
  });
});
