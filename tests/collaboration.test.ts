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
import { createDb, type Db } from "../src/server/db";

describe("countries, chamber and personal task history", () => {
  let db: Db;

  beforeEach(() => { db = createDb(":memory:"); });
  afterEach(() => db.close());

  it("shares a country with a registered account without transferring ownership", async () => {
    const owner = await registerUser(db, { email: "owner@example.com", name: "Owner Person", password: "password-owner" });
    const member = await registerUser(db, { email: "member@example.com", name: "Member Person", password: "password-member" });
    const secondCountryId = createCountry(db, owner.user.id, "Second country");

    expect(inviteCountryMember(db, secondCountryId, owner.user.id, "missing@example.com")).toBeNull();
    const invited = inviteCountryMember(db, secondCountryId, owner.user.id, "MEMBER@example.com");
    expect(invited).toMatchObject({ userId: member.user.id, role: "MEMBER" });
    expect(countryRole(db, member.user.id, secondCountryId)).toBe("MEMBER");
    expect(countryRole(db, owner.user.id, secondCountryId)).toBe("OWNER");
    expect(listCountryMembers(db, secondCountryId).map((person) => person.role)).toEqual(["OWNER", "MEMBER"]);
    expect(listAccessibleCountries(db, member.user.id).map((country) => country.id)).toContain(secondCountryId);
    expect(setActiveCountry(db, member.user.id, secondCountryId)).toBe("MEMBER");
    expect(removeCountryMember(db, secondCountryId, owner.user.id)).toBe(false);
    expect(removeCountryMember(db, secondCountryId, member.user.id)).toBe(true);
  });

  it("reissues a personal MCP key and follows the account's selected country", async () => {
    const owner = await registerUser(db, { email: "mcp@example.com", name: "MCP Person", password: "password-mcp" });
    const secondCountryId = createCountry(db, owner.user.id, "MCP second country");
    const first = createMcpToken(db, secondCountryId, "First", owner.user.id);
    const second = createMcpToken(db, secondCountryId, "Second", owner.user.id);

    expect(authenticateMcpToken(db, `Bearer ${first.token}`)).toBeNull();
    expect(authenticateMcpToken(db, `Bearer ${second.token}`)).toMatchObject({
      userId: owner.user.id, countryId: secondCountryId, countryRole: "OWNER",
    });
    setActiveCountry(db, owner.user.id, owner.user.countryId);
    expect(authenticateMcpToken(db, second.token)).toMatchObject({ countryId: owner.user.countryId });
  });

  it("records creator, responsible person and an immutable task chronicle", async () => {
    const owner = await registerUser(db, { email: "author@example.com", name: "Task Author", password: "password-author" });
    const member = await registerUser(db, { email: "worker@example.com", name: "Task Worker", password: "password-worker" });
    inviteCountryMember(db, owner.user.countryId, owner.user.id, member.user.email);
    const service = new AppService(db);
    const city = service.createCity(owner.user.countryId, { name: "Chronicle City", idempotencyKey: "chronicle-city" });
    const district = service.createDistrict(owner.user.countryId, { cityId: city.id, name: "Chronicle District", activate: true, idempotencyKey: "chronicle-district" });
    let task = service.createTask(owner.user.countryId, {
      cityId: city.id, districtId: district.id, title: "Build an accountable home", estimate: 2,
      creatorUserId: owner.user.id, assigneeUserId: member.user.id, idempotencyKey: "chronicle-task",
    });
    expect(task.creator?.name).toBe("Task Author");
    expect(task.assignee?.name).toBe("Task Worker");
    expect(task.events?.map((event) => event.type)).toEqual(["CREATED"]);

    task = service.updateTaskStatus(owner.user.countryId, {
      taskId: task.id, status: "STARTED", actor: "Task Worker", actorUserId: member.user.id, idempotencyKey: "chronicle-start",
    });
    task = service.addTaskComment(owner.user.countryId, {
      taskId: task.id, body: "Foundation accepted", actor: "Task Worker", actorUserId: member.user.id, idempotencyKey: "chronicle-comment",
    });
    task = service.assignTask(owner.user.countryId, {
      taskId: task.id, assigneeUserId: null, actor: "Task Author", actorUserId: owner.user.id, idempotencyKey: "chronicle-unassign",
    });
    expect(task.assignee).toBeNull();
    expect(task.events?.map((event) => event.type)).toEqual(["CREATED", "STATUS_CHANGED", "COMMENT_ADDED", "ASSIGNEE_CHANGED"]);
    expect(task.events?.[1]?.actorUserId).toBe(member.user.id);
  });
});
