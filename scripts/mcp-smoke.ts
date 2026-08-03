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
