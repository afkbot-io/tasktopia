import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { createCountry, createMcpToken, registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerMcpHttp } from "../src/server/mcp-http";

type Page = { kind: string; items: Array<Record<string, unknown>>; nextCursor: string | null };

describe("bounded MCP project metadata without scene materialization", { timeout: 30_000 }, () => {
  let db: Db, app: FastifyInstance, service: AppService, client: Client, countryId: string, cityId: string, districtId: string;
  const result = <T>(reply: Awaited<ReturnType<Client["callTool"]>>): T => {
    expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
    return (reply.structuredContent as { result: T }).result;
  };
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: { countryId, ...args } });

  beforeAll(async () => {
    db = await createTestDb(); service = new AppService(db);
    const owner = await registerUser(db, { email: "mcp-metadata@example.test", name: "Metadata", password: "password123" });
    countryId = owner.user.countryId;
    await createCountry(db, owner.user.id, "Another country");
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const city = await service.createCity(countryId, { name: "Metadata city", idempotencyKey: "metadata-city" });
    cityId = city.id;
    const district = await service.createDistrict(countryId, { cityId, name: "First sprint", activate: true, idempotencyKey: "metadata-first" });
    districtId = district.id;
    await service.createDistrict(countryId, { cityId, name: "Second sprint", idempotencyKey: "metadata-second" });
    await service.createTask(countryId, { cityId, districtId, title: "Planned task", estimate: 3, idempotencyKey: "metadata-task" });
    for (const key of ["one", "two"]) await service.createArchiveRecord(countryId, { kind: "CONVENTION", title: `Rule ${key}`, body: "Private long reference ".repeat(1000), idempotencyKey: `metadata-${key}` });
    const token = await createMcpToken(db, countryId, "Metadata", owner.user.id);
    app = Fastify(); registerMcpHttp(app, db, service, "http://localhost:3000");
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    client = new Client({ name: "metadata-pages", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token.token}` } } }));
  });
  afterAll(async () => { await client?.close(); await app?.close(); await db?.close(); });

  it("pages accessible country metadata while keeping the original full list", async () => {
    const legacy = result<unknown[]>(await client.callTool({ name: "country.list", arguments: {} }));
    const first = result<Page>(await client.callTool({ name: "country.list", arguments: { view: "compact", limit: 1 } }));
    expect(first).toMatchObject({ kind: "country.list-page", items: [expect.objectContaining({ id: expect.any(String), role: expect.any(String) })] });
    expect(first.nextCursor).not.toBeNull();
    const second = result<Page>(await client.callTool({ name: "country.list", arguments: { view: "compact", limit: 1, cursor: first.nextCursor } }));
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(2);
    expect(legacy).toHaveLength(2);
    expect(first.items[0]).not.toHaveProperty("productContext");
  });

  it("returns compact country/city cards without reading all tasks or district geometry", async () => {
    const tasks = vi.spyOn(service, "listTasks").mockRejectedValue(new Error("Full task catalog must not be read"));
    const districts = vi.spyOn(service, "listDistricts").mockRejectedValue(new Error("Scene geometry must not be read"));
    try {
      expect(result(await call("country.get", { view: "compact" }))).toMatchObject({ kind: "country.card", country: { id: countryId }, counts: { cities: expect.any(Number) } });
      const card = result<Record<string, unknown>>(await call("city.get", { cityId, view: "compact" }));
      expect(card).toMatchObject({ kind: "city.card", city: { id: cityId, taskCount: 1, districtCount: 2 } });
      expect(card).not.toHaveProperty("tasks");
      expect(card).not.toHaveProperty("districts");
    } finally { tasks.mockRestore(); districts.mockRestore(); }
  });

  it("pages city and district metadata with grouped workload and no cells/lots", async () => {
    const cityPage = result<Page>(await call("city.list", { view: "compact", limit: 1 }));
    expect(cityPage).toMatchObject({ kind: "city.list-page", items: [{ id: cityId, taskCount: 1, districtCount: 2 }] });
    const first = result<Page>(await call("district.list", { cityId, view: "compact", limit: 1 }));
    expect(first).toMatchObject({ kind: "district.list-page", items: [{ id: districtId, workload: { taskCount: 1, plannedSp: 3, openSp: 3 } }] });
    expect(first.items[0]).not.toHaveProperty("cells"); expect(first.items[0]).not.toHaveProperty("lots");
    const next = result<Page>(await call("district.list", { cityId, view: "compact", limit: 1, cursor: first.nextCursor }));
    expect(next.items).toHaveLength(1); expect(next.nextCursor).toBeNull();
    expect(next.items[0]?.id).not.toBe(first.items[0]?.id);
    const invalid = await call("district.list", { view: "compact", limit: 1, cursor: first.nextCursor });
    expect(invalid.isError).toBe(true);
  });

  it("pages archive metadata and reads exactly one full record through MCP", async () => {
    const first = result<Page>(await call("archive.record_list", { view: "compact", limit: 1 }));
    expect(first).toMatchObject({ kind: "archive.record-page", items: [expect.objectContaining({ title: "Rule one", bodyLength: expect.any(Number) })] });
    expect(first.items[0]).not.toHaveProperty("body");
    const next = result<Page>(await call("archive.record_list", { view: "compact", limit: 1, cursor: first.nextCursor }));
    expect(next.items).toHaveLength(1); expect(next.nextCursor).toBeNull();
    const single = result(await call("archive.record_get", { recordId: first.items[0]!.id }));
    expect(single).toMatchObject({ id: first.items[0]!.id, body: "Private long reference ".repeat(1000).trim() });
  });
});
