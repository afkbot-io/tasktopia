import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { createMcpToken, inviteCountryMember, registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerMcpHttp } from "../src/server/mcp-http";
import { enqueueWorldGenerationJob, PostgresWorldGenerationDispatcher } from "../src/server/world-generation-jobs";
import type { McpScope, TaskDto } from "../src/shared/contracts";

describe("MCP public read authorization and safe failures", { timeout: 30_000 }, () => {
  let db: Db, app: FastifyInstance, service: AppService, countryId: string, task: TaskDto;
  let countryReader: Client, taskReader: Client, owner: Client, legacyReader: Client;
  const clients: Client[] = [];
  const privateText = "private internal connection sentinel";
  const data = (reply: Awaited<ReturnType<Client["callTool"]>>) => (reply.structuredContent as { result: Record<string, unknown> }).result;
  const poll = (client: Client, jobId: string) => client.callTool({ name: "world_generation.get", arguments: { countryId, jobId } });

  beforeAll(async () => {
    db = await createTestDb();
    const holder = await registerUser(db, { email: "mcp-read-owner@example.test", name: "Owner", password: "password123" });
    const countries = await registerUser(db, { email: "mcp-country-reader@example.test", name: "Countries", password: "password123" });
    const tasks = await registerUser(db, { email: "mcp-task-reader@example.test", name: "Tasks", password: "password123" });
    countryId = holder.user.countryId;
    for (const reader of [countries, tasks]) await inviteCountryMember(db, countryId, holder.user.id, reader.user.email, "VIEWER");
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const setup = new AppService(db);
    const city = await setup.createCity(countryId, { name: "Scoped city", idempotencyKey: "read-security-city" });
    const district = await setup.createDistrict(countryId, { cityId: city.id, name: "Scoped sprint", activate: true, idempotencyKey: "read-security-district" });
    task = await setup.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Private task material", systemAnalysis: privateText, estimate: 1, idempotencyKey: "read-security-task" });
    service = new AppService(db, undefined, "data/uploads", new PostgresWorldGenerationDispatcher(db, 0));
    app = Fastify(); registerMcpHttp(app, db, service, "http://localhost:3000");
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const connect = async (userId: string, homeCountry: string, scopes?: McpScope[]) => {
      const token = await createMcpToken(db, homeCountry, "Read boundary", userId, { scopes });
      const client = new Client({ name: "mcp-read-security", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token.token}` } } }));
      if (scopes?.length === 1 && scopes[0] === "country:read") {
        legacyReader = new Client({ name: "mcp-read-security-legacy", version: "1.0.0" });
        await legacyReader.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token.token}` } } }));
        clients.push(legacyReader);
      }
      clients.push(client); return client;
    };
    owner = await connect(holder.user.id, countryId);
    countryReader = await connect(countries.user.id, countries.user.countryId, ["country:read"]);
    taskReader = await connect(tasks.user.id, tasks.user.countryId, ["tasks:read"]);
  });
  afterAll(async () => { for (const client of clients) await client.close(); await app?.close(); await db?.close(); });

  it.each(["PENDING", "COMPLETED"])("requires task read permission for a %s task-generation job", async status => {
    const job = await enqueueWorldGenerationJob(db, countryId, "task.create", `scope-job-${status}`, { title: task.title, systemAnalysis: privateText });
    if (status === "COMPLETED") await db.prepare("UPDATE world_generation_jobs_v1 SET status='COMPLETED',result_json=?::jsonb WHERE id=?").run(JSON.stringify({ id: task.id }), job.id);
    const denied = await poll(countryReader, job.id);
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain(privateText);
    const allowed = await poll(taskReader, job.id);
    expect(allowed.isError).not.toBe(true);
    expect(data(allowed)).toMatchObject({ id: job.id, status });
    expect(data(allowed)).not.toHaveProperty("payload");
    if (status === "COMPLETED") expect(data(allowed).result).toMatchObject({ id: task.id });
  });

  it("omits private input from both durable acceptance and country-job polling", async () => {
    const accepted = await owner.callTool({ name: "city.create", arguments: { countryId, name: "Accepted city", description: privateText, idempotencyKey: "accepted-public-job" } });
    expect(accepted.isError).not.toBe(true);
    const result = data(accepted) as { status: string; job: { id: string } };
    expect(result.status).toBe("accepted");
    expect(result.job).not.toHaveProperty("payload");
    expect(JSON.stringify(result)).not.toContain(privateText);
    const polled = await poll(countryReader, result.job.id);
    expect(polled.isError).not.toBe(true);
    expect(data(polled)).not.toHaveProperty("payload");
  });

  it("redacts historical unexpected generation errors at the public polling boundary", async () => {
    const job = await enqueueWorldGenerationJob(db, countryId, "city.create", "historical-public-error", { name: "Historical city" });
    await db.prepare("UPDATE world_generation_jobs_v1 SET status='FAILED',error_json=?::jsonb WHERE id=?").run(JSON.stringify({ code: "GENERATION_FAILED", message: privateText }), job.id);
    const reply = await poll(countryReader, job.id);
    expect(reply.isError).not.toBe(true);
    expect(data(reply)).toMatchObject({ status: "FAILED", error: { code: "GENERATION_FAILED" } });
    expect(JSON.stringify(reply)).not.toContain(privateText);
  });

  it("redacts unexpected resource errors without weakening resource authorization", async () => {
    const broken = vi.spyOn(service, "listCities").mockRejectedValueOnce(new Error(privateText));
    try {
      const error = await countryReader.readResource({ uri: `tasktopia://countries/${countryId}` }).catch(value => value as Error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(privateText);
    } finally { broken.mockRestore(); }
    await expect(taskReader.readResource({ uri: `tasktopia://countries/${countryId}` })).rejects.toThrow();
  });

  it("keeps compact pages and nested complexity limits consistent for modern and legacy HTTP clients", async () => {
    let nested: unknown = null;
    for (let depth = 0; depth < 512; depth++) nested = { child: nested };
    for (const client of [countryReader, legacyReader]) {
      const page = await client.callTool({ name: "country.list", arguments: { view: "compact", limit: 1 } });
      expect(data(page)).toMatchObject({ kind: "country.list-page", items: expect.any(Array) });
      const valid = await client.callTool({ name: "country.get", arguments: { countryId, extra: nested } });
      expect(valid.isError).not.toBe(true);
      const rejected = await client.callTool({ name: "country.get", arguments: { countryId, extra: { nested: Array.from({ length: 5000 }, () => ({ leaf: true })) } } });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected.content)).toContain("10000");
      expect((await client.callTool({ name: "country.get", arguments: { countryId } })).isError).not.toBe(true);
    }
  });
});
