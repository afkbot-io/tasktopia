import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import {
  authenticateMcpToken,
  createCountry,
  createMcpToken,
  inviteCountryMember,
  registerUser,
  setActiveCountry,
} from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { createMcpServer } from "../src/server/mcp";

describe("MCP explicit country context", () => {
  let client: Client | undefined;
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await client?.close();
    await db.close();
  });

  it("reads a task from the requested country without changing the account's active country", async () => {
    const registered = await registerUser(db, {
      email: "mcp-context@example.com",
      name: "MCP Context",
      password: "password-context",
    });
    const activeCountryId = registered.user.countryId;
    const requestedCountryId = await createCountry(db, registered.user.id, "Requested country");
    const service = new AppService(db);
    const city = await service.createCity(requestedCountryId, {
      name: "Requested city",
      idempotencyKey: "mcp-context-city",
    });
    const district = await service.createDistrict(requestedCountryId, {
      cityId: city.id,
      name: "Requested district",
      activate: true,
      idempotencyKey: "mcp-context-district",
    });
    const task = await service.createTask(requestedCountryId, {
      cityId: city.id,
      districtId: district.id,
      title: "Read through explicit country context",
      estimate: 1,
      idempotencyKey: "mcp-context-task",
    });
    await setActiveCountry(db, registered.user.id, activeCountryId);
    const token = await createMcpToken(db, activeCountryId, "Explicit context", registered.user.id);
    const identity = await authenticateMcpToken(db, `Bearer ${token.token}`);
    expect(identity).not.toBeNull();

    const server = await createMcpServer(db, service, identity!);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "explicit-country-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "task.get",
      arguments: { countryId: requestedCountryId, taskId: task.id },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      result: { id: task.id, title: "Read through explicit country context" },
    });

    for (const [name, arguments_] of [
      ["country.update_profile", {
        countryId: requestedCountryId,
        goal: "Explicitly routed country goal",
        idempotencyKey: "mcp-context-country-profile",
      }],
      ["city.rename", {
        countryId: requestedCountryId,
        cityId: city.id,
        name: "Explicitly routed city",
        idempotencyKey: "mcp-context-city-rename",
      }],
      ["district.rename", {
        countryId: requestedCountryId,
        districtId: district.id,
        name: "Explicitly routed district",
        idempotencyKey: "mcp-context-district-rename",
      }],
      ["task.add_comment", {
        countryId: requestedCountryId,
        taskId: task.id,
        body: "Explicitly routed comment",
        idempotencyKey: "mcp-context-task-comment",
      }],
      ["archive.record_create", {
        countryId: requestedCountryId,
        kind: "PROJECT",
        title: "Explicitly routed archive record",
        idempotencyKey: "mcp-context-archive-record",
      }],
    ] as const) {
      const mutation = await client.callTool({ name, arguments: arguments_ });
      expect(mutation.isError, `${name} must use the requested country`).not.toBe(true);
    }

    expect(await service.getCountry(requestedCountryId)).toMatchObject({ goal: "Explicitly routed country goal" });
    expect(await service.listCities(requestedCountryId)).toContainEqual(expect.objectContaining({ name: "Explicitly routed city" }));
    expect(await service.listDistricts(requestedCountryId)).toContainEqual(expect.objectContaining({ name: "Explicitly routed district" }));
    expect((await service.getTask(requestedCountryId, task.id)).comments)
      .toContainEqual(expect.objectContaining({ body: "Explicitly routed comment" }));
    expect(await service.listArchiveRecords(requestedCountryId))
      .toContainEqual(expect.objectContaining({ title: "Explicitly routed archive record" }));

    const resource = await client.readResource({ uri: `tasktopia://countries/${requestedCountryId}` });
    const countryResource = resource.contents[0];
    if (!countryResource || !("text" in countryResource)) throw new Error("Country resource must return JSON text");
    expect(countryResource.text).toContain("Requested country");
    expect(await db.prepare("SELECT active_country_id FROM users WHERE id = ?").get(registered.user.id))
      .toEqual({ active_country_id: activeCountryId });

    const inaccessible = await registerUser(db, {
      email: "mcp-context-inaccessible@example.com",
      name: "MCP Context Inaccessible",
      password: "password-inaccessible",
    });
    for (const [name, arguments_] of [
      ["country.get", { countryId: inaccessible.user.countryId }],
      ["city.list", { countryId: inaccessible.user.countryId }],
      ["district.list", { countryId: inaccessible.user.countryId }],
      ["task.list", { countryId: inaccessible.user.countryId }],
      ["archive.get", { countryId: inaccessible.user.countryId }],
      ["archive.record_list", { countryId: inaccessible.user.countryId }],
    ] as const) {
      const denied = await client.callTool({ name, arguments: arguments_ });
      expect(denied.isError, `${name} must reject an inaccessible country`).toBe(true);
      expect(JSON.stringify(denied.content)).toContain("COUNTRY_ACCESS_DENIED");
    }
    expect(await db.prepare("SELECT active_country_id FROM users WHERE id = ?").get(registered.user.id))
      .toEqual({ active_country_id: activeCountryId });
  }, 90_000);

  it("publishes countryId as required context for every country-scoped tool", async () => {
    const registered = await registerUser(db, {
      email: "mcp-schema@example.com",
      name: "MCP Schema",
      password: "password-schema",
    });
    const token = await createMcpToken(db, registered.user.countryId, "Explicit schema", registered.user.id);
    const identity = await authenticateMcpToken(db, `Bearer ${token.token}`);
    expect(identity).not.toBeNull();

    const server = await createMcpServer(db, new AppService(db), identity!);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "explicit-country-schema-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const tools = (await client.listTools()).tools;
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("country.get");
    expect(names).not.toContain("country.get_current");
    expect(names).not.toContain("country.select");
    for (const tool of tools) {
      if (tool.name === "country.list") continue;
      expect(tool.inputSchema.required, `${tool.name} must require countryId`).toContain("countryId");
    }
    expect((await client.listResourceTemplates()).resourceTemplates.map((resource) => resource.uriTemplate))
      .toContain("tasktopia://countries/{countryId}");
    expect((await client.listResources()).resources.map((resource) => resource.uri))
      .not.toContain("tasktopia://country/current");
  });

  it("authorizes the requested country instead of the country selected in the web UI", async () => {
    const owner = await registerUser(db, {
      email: "explicit-owner@example.com",
      name: "Explicit Owner",
      password: "password-owner",
    });
    const foreignOwner = await registerUser(db, {
      email: "foreign-owner@example.com",
      name: "Foreign Owner",
      password: "password-foreign",
    });
    await inviteCountryMember(
      db,
      foreignOwner.user.countryId,
      foreignOwner.user.id,
      owner.user.email,
      "VIEWER",
    );
    const token = await createMcpToken(db, owner.user.countryId, "Owner context", owner.user.id);
    await setActiveCountry(db, owner.user.id, foreignOwner.user.countryId);
    const identity = await authenticateMcpToken(db, `Bearer ${token.token}`);
    expect(identity).not.toBeNull();

    const service = new AppService(db);
    const server = await createMcpServer(db, service, identity!);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "explicit-country-role-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "city.create",
      arguments: {
        countryId: owner.user.countryId,
        name: "Owner country city",
        idempotencyKey: "explicit-owner-city",
      },
    });

    expect(result.isError).not.toBe(true);
    expect(await service.listCities(owner.user.countryId)).toEqual([
      expect.objectContaining({ name: "Owner country city" }),
    ]);
    expect(await db.prepare("SELECT active_country_id FROM users WHERE id = ?").get(owner.user.id))
      .toEqual({ active_country_id: foreignOwner.user.countryId });

    const viewerWrite = await client.callTool({
      name: "city.create",
      arguments: {
        countryId: foreignOwner.user.countryId,
        name: "Forbidden viewer city",
        idempotencyKey: "explicit-viewer-city",
      },
    });
    expect(viewerWrite.isError).toBe(true);
    expect(JSON.stringify(viewerWrite.content)).toContain("FORBIDDEN_SCOPE");
    expect(await service.listCities(foreignOwner.user.countryId)).toEqual([]);

    const inaccessible = await registerUser(db, {
      email: "inaccessible-owner@example.com",
      name: "Inaccessible Owner",
      password: "password-inaccessible",
    });
    const inaccessibleRead = await client.callTool({
      name: "country.get",
      arguments: { countryId: inaccessible.user.countryId },
    });
    expect(inaccessibleRead.isError).toBe(true);
    expect(JSON.stringify(inaccessibleRead.content)).toContain("COUNTRY_ACCESS_DENIED");
  }, 20_000);
});
