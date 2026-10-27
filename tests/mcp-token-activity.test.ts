import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticateMcpToken, countryRole, createMcpToken, registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { MCP_SCOPES } from "../src/shared/contracts";

describe("MCP token activity is bounded telemetry with fresh authorization", () => {
  let db: Db;
  let userId: string;
  let countryId: string;
  let key: Awaited<ReturnType<typeof createMcpToken>>;
  beforeAll(async () => {
    db = await createTestDb();
    // A real row trigger counts physical UPDATEs, including writes of the same
    // timestamp. Statement counts and final timestamps alone would miss WAL churn.
    await db.exec(`CREATE TABLE token_activity_test_audit(token_id text NOT NULL);
      CREATE FUNCTION audit_token_activity_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO token_activity_test_audit(token_id) VALUES(NEW.id); RETURN NEW; END $$;
      CREATE TRIGGER token_activity_test AFTER UPDATE OF last_used_at ON mcp_tokens
        FOR EACH ROW EXECUTE FUNCTION audit_token_activity_test()`);
  });
  beforeEach(async () => {
    const owner = await registerUser(db, { email: `${randomUUID()}@token-activity.test`, name: "Token activity", password: "password123" });
    userId = owner.user.id; countryId = owner.user.countryId;
    key = await createMcpToken(db, countryId, "Activity contract", userId);
  });
  afterAll(async () => { await db?.close(); });
  const authenticate = () => authenticateMcpToken(db, `Bearer ${key.token}`);
  const touches = async () => Number((await db.prepare("SELECT COUNT(*) AS count FROM token_activity_test_audit WHERE token_id=?")
    .get<{ count: string }>(key.id))!.count);
  const lastUsed = async () => (await db.prepare("SELECT last_used_at FROM mcp_tokens WHERE id=?")
    .get<{ last_used_at: string | null }>(key.id))!.last_used_at;

  it("authenticates fifty parallel reads with one physical activity update and the same identity", async () => {
    expect(await lastUsed()).toBeNull();
    const results = await Promise.all(Array.from({ length: 50 }, authenticate));
    for (const identity of results) expect(identity).toEqual({ userId, tokenId: key.id, scopes: [...MCP_SCOPES] });
    expect(await touches()).toBe(1);
    expect(await lastUsed()).not.toBeNull();
    await Promise.all(Array.from({ length: 10 }, authenticate));
    expect(await touches()).toBe(1);
  });

  it("refreshes an old activity timestamp once and then keeps the same window bounded", async () => {
    await db.prepare("UPDATE mcp_tokens SET last_used_at=now()-interval '61 seconds' WHERE id=?").run(key.id);
    const old = await lastUsed();
    await db.prepare("DELETE FROM token_activity_test_audit WHERE token_id=?").run(key.id);
    await Promise.all(Array.from({ length: 50 }, authenticate));
    expect(await touches()).toBe(1);
    expect(Date.parse((await lastUsed())!)).toBeGreaterThan(Date.parse(old!));
    await authenticate();
    expect(await touches()).toBe(1);
  });

  it("applies rotation revocation on the next read without changing the revoked key's telemetry", async () => {
    expect(await authenticate()).not.toBeNull();
    const used = await lastUsed();
    const replacement = await createMcpToken(db, countryId, "Rotated activity contract", userId);
    expect(await authenticate()).toBeNull();
    expect(await lastUsed()).toBe(used);
    expect(await touches()).toBe(1);
    expect(await authenticateMcpToken(db, `Bearer ${replacement.token}`)).toMatchObject({ userId, tokenId: replacement.id });
  });

  it("applies expiry on the next read during the activity window", async () => {
    expect(await authenticate()).not.toBeNull();
    const used = await lastUsed();
    await db.prepare("UPDATE mcp_tokens SET expires_at=now()-interval '1 second' WHERE id=?").run(key.id);
    expect(await authenticate()).toBeNull();
    expect(await lastUsed()).toBe(used);
    expect(await touches()).toBe(1);
  });

  it.each([{ scopes: [] }, { scopes: ["country:read", "unknown-scope"] }, { scopes: { scopes: ["country:read"] } }, { scopes: "not-json" }])(
    "does not record successful activity for malformed stored scopes $scopes", async ({ scopes }) => {
      await db.prepare("UPDATE mcp_tokens SET scopes_json=?::jsonb WHERE id=?").run(JSON.stringify(scopes), key.id);
      expect(await authenticate()).toBeNull();
      expect(await touches()).toBe(0);
      expect(await lastUsed()).toBeNull();
    });

  it("reads changed scopes and target-country membership during the same telemetry window", async () => {
    expect(await authenticate()).not.toBeNull();
    await db.prepare("UPDATE mcp_tokens SET scopes_json=?::jsonb WHERE id=?").run(JSON.stringify(["tasks:read"]), key.id);
    expect(await authenticate()).toEqual({ userId, tokenId: key.id, scopes: ["tasks:read"] });
    expect(await countryRole(db, userId, countryId)).toBe("OWNER");
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(countryId, userId);
    expect(await countryRole(db, userId, countryId)).toBeNull();
    // Personal authentication is independent of the UI country. Tool handlers
    // still have to check current target-country membership on every request.
    expect(await authenticate()).toEqual({ userId, tokenId: key.id, scopes: ["tasks:read"] });
    expect(await touches()).toBe(1);
  });
});
