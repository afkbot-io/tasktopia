import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@tasktopia.local", password: "tasktopia-demo" }),
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

const client = new Client({ name: "tasktopia-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const expected = ["country.list", "country.select", "city.create", "district.create", "district.complete", "task.create", "task.assign", "task.report_progress"];
  for (const name of expected) {
    if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Missing MCP tool: ${name}`);
  }
  const result = await client.callTool({ name: "country.get_current", arguments: {} });
  if (result.isError) throw new Error(`country.get_current failed: ${JSON.stringify(result.content)}`);
  console.log(`MCP smoke passed (${tools.tools.length} tools).`);
} finally {
  await client.close();
}

const revokeResponse = await fetch(`${baseUrl}/api/tokens/${tokenId}`, { method: "DELETE", headers: { cookie } });
if (!revokeResponse.ok) throw new Error(`Token revocation failed: ${revokeResponse.status} ${await revokeResponse.text()}`);
const revokedClient = new Client({ name: "tasktopia-revoked-smoke", version: "1.0.0" });
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
const readOnlyClient = new Client({ name: "tasktopia-read-only-smoke", version: "1.0.0" });
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
const taskOnlyClient = new Client({ name: "tasktopia-task-only-smoke", version: "1.0.0" });
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
