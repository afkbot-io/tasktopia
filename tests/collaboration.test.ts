import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import {
  authenticateMcpToken,
  countryRole,
  createCountry,
  createMcpToken,
  inviteCountryMember,
  listAccessibleCountries,
  listCountryMembers,
  registerUser,
  removeCountryMember,
  setActiveCountry,
} from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";

describe("countries, chamber and personal task history", () => {
  let db: Db;

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => await db.close());

  it("shares a country with a registered account without transferring ownership", async () => {
    const owner = await registerUser(db, { email: "owner@example.com", name: "Owner Person", password: "password-owner" });
    const member = await registerUser(db, { email: "member@example.com", name: "Member Person", password: "password-member" });
    const secondCountryId = await createCountry(db, owner.user.id, "Second country");

    expect(await inviteCountryMember(db, secondCountryId, owner.user.id, "missing@example.com")).toBeNull();
    const invited = await inviteCountryMember(db, secondCountryId, owner.user.id, "MEMBER@example.com");
    expect(invited).toMatchObject({ userId: member.user.id, role: "MEMBER" });
    expect(await countryRole(db, member.user.id, secondCountryId)).toBe("MEMBER");
    expect(await countryRole(db, owner.user.id, secondCountryId)).toBe("OWNER");
    expect((await listCountryMembers(db, secondCountryId)).map((person) => person.role)).toEqual(["OWNER", "MEMBER"]);
    expect((await listAccessibleCountries(db, member.user.id)).map((country) => country.id)).toContain(secondCountryId);
    expect(await setActiveCountry(db, member.user.id, secondCountryId)).toBe("MEMBER");
    expect(await removeCountryMember(db, secondCountryId, owner.user.id)).toBe(false);
    expect(await removeCountryMember(db, secondCountryId, member.user.id)).toBe(true);
  });

  it("reissues a personal MCP key and follows the account's selected country", async () => {
    const owner = await registerUser(db, { email: "mcp@example.com", name: "MCP Person", password: "password-mcp" });
    const secondCountryId = await createCountry(db, owner.user.id, "MCP second country");
    const first = await createMcpToken(db, secondCountryId, "First", owner.user.id);
    const second = await createMcpToken(db, secondCountryId, "Second", owner.user.id);

    expect(await authenticateMcpToken(db, `Bearer ${first.token}`)).toBeNull();
    expect(await authenticateMcpToken(db, `Bearer ${second.token}`)).toMatchObject({
      userId: owner.user.id, countryId: secondCountryId, countryRole: "OWNER",
    });
    await setActiveCountry(db, owner.user.id, owner.user.countryId);
    expect(await authenticateMcpToken(db, second.token)).toBeNull();
    expect(await authenticateMcpToken(db, `Bearer ${second.token}`)).toMatchObject({ countryId: owner.user.countryId });
  });

  it("issues least-privilege expiring tokens and caps a viewer at read scopes", async () => {
    const owner = await registerUser(db, { email: "scope-owner@example.com", name: "Scope Owner", password: "password-owner" });
    const viewer = await registerUser(db, { email: "scope-viewer@example.com", name: "Scope Viewer", password: "password-viewer" });
    await inviteCountryMember(db, owner.user.countryId, owner.user.id, viewer.user.email, "VIEWER");
    await setActiveCountry(db, viewer.user.id, owner.user.countryId);

    const token = await createMcpToken(db, owner.user.countryId, "Read tasks", viewer.user.id, {
                      scopes: ["country:read", "tasks:read"], expiresInDays: 30,
                    });
    expect(await authenticateMcpToken(db, `Bearer ${token.token}`)).toMatchObject({
      countryRole: "VIEWER", scopes: ["country:read", "tasks:read"],
    });
    expect(new Date(token.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    await expect(createMcpToken(db, owner.user.countryId, "Illegal write", viewer.user.id, {
                      scopes: ["country:read", "tasks:write"], expiresInDays: 30,
                    })).rejects.toThrowError(/scopes/);

    await db.prepare("UPDATE mcp_tokens SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1_000).toISOString(), token.id);
    expect(await authenticateMcpToken(db, `Bearer ${token.token}`)).toBeNull();

    const malformed = await createMcpToken(db, owner.user.countryId, "Malformed storage", owner.user.id);
    await db.prepare("UPDATE mcp_tokens SET scopes_json = ? WHERE id = ?").run('["country:read","unknown:write"]', malformed.id);
    expect(await authenticateMcpToken(db, `Bearer ${malformed.token}`)).toBeNull();
  });

  it("records creator, responsible person and an immutable task chronicle", async () => {
    const owner = await registerUser(db, { email: "author@example.com", name: "Task Author", password: "password-author" });
    const member = await registerUser(db, { email: "worker@example.com", name: "Task Worker", password: "password-worker" });
    await inviteCountryMember(db, owner.user.countryId, owner.user.id, member.user.email);
    const service = new AppService(db);
    const city = await service.createCity(owner.user.countryId, { name: "Chronicle City", idempotencyKey: "chronicle-city" });
    const district = await service.createDistrict(owner.user.countryId, { cityId: city.id, name: "Chronicle District", activate: true, idempotencyKey: "chronicle-district" });
    let task = await service.createTask(owner.user.countryId, {
                      cityId: city.id, districtId: district.id, title: "Build an accountable home", estimate: 2,
                      creatorUserId: owner.user.id, assigneeUserId: member.user.id, idempotencyKey: "chronicle-task",
                    });
    expect(task.creator?.name).toBe("Task Author");
    expect(task.assignee?.name).toBe("Task Worker");
    expect(task.events?.map((event) => event.type)).toEqual(["CREATED"]);

    task = await service.updateTaskStatus(owner.user.countryId, {
                      taskId: task.id, status: "STARTED", actor: "Task Worker", actorUserId: member.user.id, idempotencyKey: "chronicle-start",
                    });
    task = await service.addTaskComment(owner.user.countryId, {
                      taskId: task.id, body: "Foundation accepted", actor: "Task Worker", actorUserId: member.user.id, idempotencyKey: "chronicle-comment",
                    });
    task = await service.assignTask(owner.user.countryId, {
                      taskId: task.id, assigneeUserId: null, actor: "Task Author", actorUserId: owner.user.id, idempotencyKey: "chronicle-unassign",
                    });
    expect(task.assignee).toBeNull();
    expect(task.events?.map((event) => event.type)).toEqual(["CREATED", "STATUS_CHANGED", "COMMENT_ADDED", "ASSIGNEE_CHANGED"]);
    expect(task.events?.[1]?.actorUserId).toBe(member.user.id);
  });
});
