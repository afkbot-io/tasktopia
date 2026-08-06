import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const smokeEmail = process.env.SMOKE_EMAIL ?? "demo@tasktopia.local";
const smokePassword = process.env.SMOKE_PASSWORD ?? "tasktopia-demo";
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
});
if (!login.ok) throw new Error(`Login failed: ${login.status} ${await login.text()}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Login response did not contain a session cookie");

const tokenResponse = await fetch(`${baseUrl}/api/tokens`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ name: "Automated MCP smoke test" }),
});
if (!tokenResponse.ok) throw new Error(`Token creation failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
const { id: tokenId, token } = await tokenResponse.json() as { id: string; token: string };

const client = new Client({ name: "tasktopia-smoke", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});

try {
  await client.connect(transport);
  if (client.getProtocolEra() !== "modern") throw new Error(`Expected modern MCP era, got ${client.getProtocolEra()}`);
  const tools = await client.listTools();
  const expected = [
    "country.get_current", "country.list", "country.select", "country.update_profile",
    "city.list", "city.get", "city.create", "city.update", "city.rename", "city.delete",
    "district.list", "district.create", "district.update", "district.rename", "district.activate", "district.complete", "district.delete",
    "task.list", "task.get", "task.create", "task.update_fields", "task.defect_create", "task.defect_update", "task.rename", "task.delete", "task.set_status", "task.report_progress", "task.add_comment", "task.assign",
  ];
  if (tools.tools.length !== expected.length) throw new Error(`Expected ${expected.length} MCP tools, got ${tools.tools.length}`);
  for (const name of expected) {
    if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Missing MCP tool: ${name}`);
  }
  const missingId = "00000000-0000-4000-8000-000000000001";
  for (const [name, arguments_] of [
    ["city.rename", { cityId: missingId, name: "Renamed city", idempotencyKey: "smoke-rename-city" }],
    ["district.rename", { districtId: missingId, name: "Renamed district", idempotencyKey: "smoke-rename-district" }],
    ["task.rename", { taskId: missingId, title: "Renamed task", idempotencyKey: "smoke-rename-task" }],
    ["city.delete", { cityId: missingId, confirmName: "Missing city", idempotencyKey: "smoke-delete-city" }],
    ["district.delete", { districtId: missingId, confirmName: "Missing district", idempotencyKey: "smoke-delete-district" }],
    ["task.delete", { taskId: missingId, confirmTitle: "Missing task", idempotencyKey: "smoke-delete-task" }],
  ] as const) {
    const result = await client.callTool({ name, arguments: arguments_ });
    if (!result.isError || !JSON.stringify(result.content).includes("NOT_FOUND")) throw new Error(`${name} did not reach its protected domain handler`);
  }
  const result = await client.callTool({ name: "country.get_current", arguments: {} });
  if (result.isError) throw new Error(`country.get_current failed: ${JSON.stringify(result.content)}`);
  const currentCountry = await client.readResource({ uri: "tasktopia://country/current" });
  const buildingCatalog = await client.readResource({ uri: "tasktopia://catalog/buildings" });
  if (currentCountry.contents.length === 0 || buildingCatalog.contents.length === 0) {
    throw new Error("Modern MCP client did not receive both resources");
  }
  console.log(`MCP smoke passed (${tools.tools.length} tools).`);
} finally {
  await client.close();
}

const legacyClient = new Client({ name: "tasktopia-legacy-smoke", version: "1.0.0" });
const legacyTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});
try {
  await legacyClient.connect(legacyTransport);
  if (legacyClient.getProtocolEra() !== "legacy") throw new Error(`Expected legacy MCP era, got ${legacyClient.getProtocolEra()}`);
  if ((await legacyClient.listTools()).tools.length !== 29) throw new Error("Legacy MCP client did not receive all tools");
  console.log("Legacy 2025 MCP fallback passed.");
} finally {
  await legacyClient.close();
}

async function expectRejectedAuthentication(headers: Record<string, string>, label: string): Promise<void> {
  const rejectedClient = new Client({ name: `tasktopia-${label}`, version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  const rejectedTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers } });
  let rejected = false;
  try {
    await rejectedClient.connect(rejectedTransport);
  } catch {
    rejected = true;
  } finally {
    await rejectedClient.close().catch(() => undefined);
  }
  if (!rejected) throw new Error(`${label} authentication was unexpectedly accepted`);
}
await expectRejectedAuthentication({ authorization: token }, "bare-token");
await expectRejectedAuthentication({ "x-api-key": token }, "x-api-key");
console.log("Only Authorization Bearer credentials were accepted.");

const unauthenticated = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
if (unauthenticated.status !== 401 || !unauthenticated.headers.get("www-authenticate")?.startsWith("Bearer")) {
  throw new Error("Unauthenticated MCP request did not return a Bearer challenge");
}
for (const method of ["GET", "POST", "DELETE"] as const) {
  const invalidOrigin = await fetch(`${baseUrl}/mcp`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      origin: "https://attacker.example",
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    body: method === "POST" ? "{}" : undefined,
  });
  if (invalidOrigin.status !== 403) {
    throw new Error(`Invalid MCP Origin for ${method} returned ${invalidOrigin.status}, expected 403`);
  }
}
console.log("Bearer challenge and Origin validation passed.");

const revokeResponse = await fetch(`${baseUrl}/api/tokens/${tokenId}`, { method: "DELETE", headers: { cookie } });
if (!revokeResponse.ok) throw new Error(`Token revocation failed: ${revokeResponse.status} ${await revokeResponse.text()}`);
const revokedClient = new Client({ name: "tasktopia-revoked-smoke", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
const revokedTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});
let rejected = false;
try {
  await revokedClient.connect(revokedTransport);
} catch {
  rejected = true;
} finally {
  await revokedClient.close().catch(() => undefined);
}
if (!rejected) throw new Error("Revoked MCP token was unexpectedly accepted");
console.log("Revoked MCP token was rejected as expected.");

const readOnlyTokenResponse = await fetch(`${baseUrl}/api/tokens`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({
    name: "Read-only MCP smoke test",
    scopes: ["country:read", "tasks:read"],
    expiresInDays: 30,
  }),
});
if (!readOnlyTokenResponse.ok) {
  throw new Error(`Read-only token creation failed: ${readOnlyTokenResponse.status} ${await readOnlyTokenResponse.text()}`);
}
const { id: readOnlyTokenId, token: readOnlyToken } = await readOnlyTokenResponse.json() as {
  id: string;
  token: string;
};
const readOnlyClient = new Client({ name: "tasktopia-read-only-smoke", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
const readOnlyTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${readOnlyToken}` } },
});
let readOnlyRevokeFailure = "";
try {
  await readOnlyClient.connect(readOnlyTransport);
  const currentCountry = await readOnlyClient.callTool({ name: "country.get_current", arguments: {} });
  if (currentCountry.isError) {
    throw new Error(`Read-only country.get_current failed: ${JSON.stringify(currentCountry.content)}`);
  }
  const forbiddenMutation = await readOnlyClient.callTool({
    name: "city.create",
    arguments: {
      name: "Forbidden smoke city",
      districtCount: 1,
      idempotencyKey: `read-only-smoke-${Date.now()}`,
    },
  });
  if (!forbiddenMutation.isError) throw new Error("Read-only MCP token unexpectedly created a city");
  const forbiddenDelete = await readOnlyClient.callTool({
    name: "task.delete",
    arguments: { taskId: "00000000-0000-4000-8000-000000000001", confirmTitle: "Missing task", idempotencyKey: "scope-delete-task" },
  });
  if (!forbiddenDelete.isError || !JSON.stringify(forbiddenDelete.content).includes("FORBIDDEN_SCOPE")) throw new Error("Read-only token reached task.delete");
  console.log("Read-only MCP scopes were enforced as expected.");
} finally {
  await readOnlyClient.close().catch(() => undefined);
  const revokeReadOnlyResponse = await fetch(`${baseUrl}/api/tokens/${readOnlyTokenId}`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!revokeReadOnlyResponse.ok) {
    readOnlyRevokeFailure = `Read-only token revocation failed: ${revokeReadOnlyResponse.status} ${await revokeReadOnlyResponse.text()}`;
  }
}
if (readOnlyRevokeFailure) throw new Error(readOnlyRevokeFailure);

const taskOnlyTokenResponse = await fetch(`${baseUrl}/api/tokens`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ name: "Task-only MCP smoke test", scopes: ["tasks:read"], expiresInDays: 30 }),
});
if (!taskOnlyTokenResponse.ok) {
  throw new Error(`Task-only token creation failed: ${taskOnlyTokenResponse.status} ${await taskOnlyTokenResponse.text()}`);
}
const { id: taskOnlyTokenId, token: taskOnlyToken } = await taskOnlyTokenResponse.json() as { id: string; token: string };
const taskOnlyClient = new Client({ name: "tasktopia-task-only-smoke", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
const taskOnlyTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${taskOnlyToken}` } },
});
let protectedResourceRejected = false;
let taskOnlyRevokeFailure = "";
try {
  await taskOnlyClient.connect(taskOnlyTransport);
  const tasks = await taskOnlyClient.callTool({ name: "task.list", arguments: {} });
  if (tasks.isError) throw new Error(`Task-only task.list failed: ${JSON.stringify(tasks.content)}`);
  try {
    await taskOnlyClient.readResource({ uri: "tasktopia://country/current" });
  } catch {
    protectedResourceRejected = true;
  }
} finally {
  await taskOnlyClient.close().catch(() => undefined);
  const revokeTaskOnlyResponse = await fetch(`${baseUrl}/api/tokens/${taskOnlyTokenId}`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!revokeTaskOnlyResponse.ok) {
    taskOnlyRevokeFailure = `Task-only token revocation failed: ${revokeTaskOnlyResponse.status} ${await revokeTaskOnlyResponse.text()}`;
  }
}
if (taskOnlyRevokeFailure) throw new Error(taskOnlyRevokeFailure);
if (!protectedResourceRejected) throw new Error("MCP resource unexpectedly bypassed country:read scope");
console.log("MCP resource scopes were enforced as expected.");

const countryOnlyTokenResponse = await fetch(`${baseUrl}/api/tokens`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ name: "Country-only MCP smoke test", scopes: ["country:read"], expiresInDays: 30 }),
});
if (!countryOnlyTokenResponse.ok) {
  throw new Error(`Country-only token creation failed: ${countryOnlyTokenResponse.status} ${await countryOnlyTokenResponse.text()}`);
}
const { id: countryOnlyTokenId, token: countryOnlyToken } = await countryOnlyTokenResponse.json() as { id: string; token: string };
const countryOnlyClient = new Client({ name: "tasktopia-country-only-smoke", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
const countryOnlyTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${countryOnlyToken}` } },
});
let countryOnlyRevokeFailure = "";
try {
  await countryOnlyClient.connect(countryOnlyTransport);
  const cities = await countryOnlyClient.callTool({ name: "city.list", arguments: {} });
  if (cities.isError) throw new Error(`Country-only city.list failed: ${JSON.stringify(cities.content)}`);
  const cityRows = (cities.structuredContent as { result?: Array<{ id: string }> } | undefined)?.result;
  if (!cityRows?.[0]?.id) throw new Error("Country-only city.list returned no city for scope test");
  const leakedTasks = await countryOnlyClient.callTool({ name: "city.get", arguments: { cityId: cityRows[0].id } });
  if (!leakedTasks.isError) throw new Error("country:read unexpectedly bypassed tasks:read through city.get");
} finally {
  await countryOnlyClient.close().catch(() => undefined);
  const revoked = await fetch(`${baseUrl}/api/tokens/${countryOnlyTokenId}`, { method: "DELETE", headers: { cookie } });
  if (!revoked.ok) {
    countryOnlyRevokeFailure = `Country-only token revocation failed: ${revoked.status} ${await revoked.text()}`;
  }
}
if (countryOnlyRevokeFailure) throw new Error(countryOnlyRevokeFailure);
console.log("city.get task data requires tasks:read as expected.");
