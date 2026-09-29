import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { changeAccountPassword, createMcpToken, getSessionUser, loginUser, registerUser, authenticateMcpToken } from "../src/server/auth";

describe("account password lifecycle", () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db.close(); });
  it("requires current password and revokes every session and MCP credential", async () => {
    const first = await registerUser(db, { email: "security@example.test", name: "Mayor", password: "old-password-123" });
    const second = await loginUser(db, first.user.email, "old-password-123");
    const token = await createMcpToken(db, first.user.countryId, "Test", first.user.id);
    expect(await changeAccountPassword(db, first.user.id, "wrong", "new-password-123")).toBe(false);
    expect(await getSessionUser(db, first.session)).not.toBeNull();
    expect(await changeAccountPassword(db, first.user.id, "old-password-123", "new-password-123")).toBe(true);
    expect(await getSessionUser(db, first.session)).toBeNull();
    expect(await getSessionUser(db, second.session)).toBeNull();
    expect(await authenticateMcpToken(db, `Bearer ${token.token}`)).toBeNull();
    await expect(loginUser(db, first.user.email, "old-password-123")).rejects.toThrow();
    expect((await loginUser(db, first.user.email, "new-password-123")).user.id).toBe(first.user.id);
  });
  it("serializes concurrent changes so the previous password works only once", async () => {
    const first = await registerUser(db, { email: "race@example.test", name: "Mayor", password: "old-password-123" });
    const results = await Promise.all([changeAccountPassword(db, first.user.id, "old-password-123", "new-password-123"), changeAccountPassword(db, first.user.id, "old-password-123", "another-password-123")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

import { issueRecoveryCodes, recoverAccount } from "../src/server/account-recovery";
describe("one-use recovery codes", () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db.close(); });
  it("stores only hashes, rotates codes and consumes the whole set once", async () => {
    const account = await registerUser(db, { email: "recovery@example.test", name: "Mayor", password: "old-password-123" });
    expect(await issueRecoveryCodes(db, account.user.id, "wrong")).toBeNull();
    const old = (await issueRecoveryCodes(db, account.user.id, "old-password-123"))!;
    const codes = (await issueRecoveryCodes(db, account.user.id, "old-password-123"))!;
    expect(codes).toHaveLength(8);
    const stored = JSON.stringify(await db.prepare("SELECT * FROM account_recovery_codes").all());
    expect(stored).not.toContain(codes[0]);
    expect(await recoverAccount(db, account.user.email, old[0]!, "new-password-123")).toBeNull();
    expect(await recoverAccount(db, "another@example.test", codes[0]!, "new-password-123")).toBeNull();
    const results = await Promise.all(codes.slice(0,2).map(code => recoverAccount(db, account.user.email, code, "new-password-123")));
    expect(results.filter(Boolean)).toEqual([account.user.id]);
    expect(await getSessionUser(db, account.session)).toBeNull();
    expect(await db.prepare("SELECT * FROM account_recovery_codes").all()).toHaveLength(0);
    expect((await loginUser(db, account.user.email, "new-password-123")).user.id).toBe(account.user.id);
  });
});
