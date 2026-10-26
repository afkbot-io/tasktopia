import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { readCityNews, readNewsCards } from "../src/server/city-news-read";
import { readFile } from "node:fs/promises";
import type { TaskDto } from "../src/shared/contracts";

describe("durable personal city news", () => {
  let db: Db; let service: AppService; let countryId: string; let userId: string; let task: TaskDto;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    const owner = (await registerUser(db, { email: "personal-news@example.test", name: "News owner", password: "password123" })).user;
    countryId = owner.countryId; userId = owner.id;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const city = await service.createCity(countryId, { name: "News city", idempotencyKey: "news-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "News district", activate: true, idempotencyKey: "news-district" });
    task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "My task", estimate: 1, creatorUserId: userId, idempotencyKey: "news-task" });
  });
  afterEach(async () => { await db?.close(); });

  it("shows actual token-owner comments, material updates and testing without inventing events", async () => {
    await service.addTaskComment(countryId, { taskId: task.id, body: "AI update", actorUserId: userId, idempotencyKey: "news-comment" }, "compact");
    await service.upsertTaskDocument(countryId, { taskId: task.id, fileName: "architecture.md", content: "Material", actorUserId: userId, idempotencyKey: "news-material" });
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING"] as const) await service.updateTaskStatus(countryId, { taskId: task.id, status, actorUserId: userId, idempotencyKey: `news-${status}` }, "compact");
    const news = (await readCityNews(db, userId, countryId, false, null))!;
    expect(news.items.map(item => item.kind)).toEqual(expect.arrayContaining(["COMMENT", "MATERIAL", "TESTING", "ASSIGNED"]));
    const worldIds = new Set((await service.listEvents(countryId)).map(event => event.id));
    expect(news.items.every(item => worldIds.has(item.lastEventId))).toBe(true);
    expect(JSON.stringify(news)).not.toContain("AI update");
    await readNewsCards(db, userId, countryId, news.items.map(item => item.lastEventId));
    expect((await readCityNews(db, userId, countryId, false, null))!.unreadCount).toBe(0);
    expect((await readCityNews(db, userId, countryId, true, null))!.items.every(item => !item.unread)).toBe(true);
  });

  it("keeps adjacent bursts intact at a one-card page boundary with exact timestamp ties", async () => {
    await db.prepare(`INSERT INTO events(country_id,type,world_version,payload_json,created_at)
      VALUES (?,'task.comment_added',1,?::jsonb,date_trunc('second',now())-INTERVAL '2 minutes'+INTERVAL '0.123456 seconds'),
      (?,'task.comment_added',1,?::jsonb,date_trunc('second',now())-INTERVAL '2 minutes'+INTERVAL '0.123456 seconds'),
      (?,'task.fields_updated',1,?::jsonb,date_trunc('second',now())-INTERVAL '1 minute'+INTERVAL '0.123456 seconds'),
      (?,'task.comment_added',1,?::jsonb,date_trunc('second',now())+INTERVAL '0.123456 seconds'),
      (?,'task.comment_added',1,?::jsonb,date_trunc('second',now())+INTERVAL '0.123456 seconds')`).run(countryId, JSON.stringify({ taskId: task.id }), countryId, JSON.stringify({ taskId: task.id }),
        countryId, JSON.stringify({ taskId: task.id, changedFields: ["documents"] }), countryId, JSON.stringify({ taskId: task.id }), countryId, JSON.stringify({ taskId: task.id }));
    const one = await readCityNews(db, userId, countryId, true, null, { limit: 1 });
    expect(one!.items).toHaveLength(1); expect(one!.items[0]).toMatchObject({ kind: "COMMENT", count: 2 });
    expect(one!.nextCursor).toEqual(expect.any(String));
    const two = await readCityNews(db, userId, countryId, true, null, { limit: 1, cursor: one!.nextCursor! });
    expect(two!.items[0]).toMatchObject({ kind: "MATERIAL", count: 1 });
    const three = await readCityNews(db, userId, countryId, true, null, { limit: 1, cursor: two!.nextCursor! });
    expect(three!.items[0]).toMatchObject({ kind: "COMMENT", count: 2 });
    expect(new Set([one!.items[0]!.lastEventId, two!.items[0]!.lastEventId, three!.items[0]!.lastEventId]).size).toBe(3);
    const legacy = await readCityNews(db, userId, countryId, true, one!.items[0]!.lastEventId);
    expect(legacy!.items[0]!.kind).toBe("MATERIAL");
  });
  it("keeps new kinds personal, enforces live membership and never marks foreign event IDs", async () => {
    const stranger = (await registerUser(db, { email: "news-stranger@example.test", name: "Stranger", password: "password123" })).user;
    await db.prepare("INSERT INTO country_members(country_id,user_id,role,created_at) VALUES(?,?,'VIEWER',now())").run(countryId, stranger.id);
    await service.addTaskComment(countryId, { taskId: task.id, body: "My AI action", actorUserId: userId, idempotencyKey: "audience-comment" }, "compact");
    expect((await readCityNews(db, stranger.id, countryId, true, null))!.items.some(item => item.kind === "COMMENT")).toBe(false);
    await service.updateTaskFields(countryId, { taskId: task.id, forUserId: stranger.id, idempotencyKey: "audience-for-user" });
    expect((await readCityNews(db, stranger.id, countryId, true, null))!.items.some(item => item.kind === "COMMENT")).toBe(true);
    const foreign = await db.prepare("INSERT INTO events(country_id,type,world_version,payload_json,created_at) VALUES(?,'task.comment_added',1,?::jsonb,now()) RETURNING id")
      .get(stranger.countryId, JSON.stringify({ taskId: task.id }));
    const before = await service.listEvents(countryId);
    await readNewsCards(db, userId, countryId, [Number(foreign!.id)]);
    expect(await db.prepare("SELECT * FROM notification_reads_v1 WHERE user_id=?").all(userId)).toEqual([]);
    expect(await service.listEvents(countryId)).toEqual(before);
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(countryId, stranger.id);
    expect(await readCityNews(db, stranger.id, countryId, true, null)).toBeUndefined();
    await readNewsCards(db, stranger.id, countryId, (await readCityNews(db, userId, countryId, true, null))!.items.map(item => item.lastEventId));
    expect(await db.prepare("SELECT * FROM notification_reads_v1 WHERE user_id=? AND country_id=?").all(stranger.id,countryId)).toEqual([]);
  });

  it("expands migration CHECK without changing old read keys or rollback-readable watermarks", async () => {
    await db.exec(`ALTER TABLE notification_reads_v1 DROP CONSTRAINT notification_reads_v1_kind_check;
      ALTER TABLE notification_reads_v1 ADD CONSTRAINT notification_reads_v1_kind_check CHECK(kind IN ('COMPLETED','DEFECT','OPENED','ASSIGNED'));
      DROP INDEX IF EXISTS events_city_album_v1_idx;`);
    await db.prepare("INSERT INTO notification_reads_v1(user_id,country_id,task_id,kind,event_id) VALUES(?,?,?,'ASSIGNED',123)").run(userId,countryId,task.id);
    const old = await db.prepare("SELECT * FROM notification_reads_v1").all();
    await db.exec(await readFile("migrations/postgres/0044_personal_news_kinds.sql", "utf8"));
    expect(await db.prepare("SELECT * FROM notification_reads_v1").all()).toEqual(old);
    await service.addTaskComment(countryId, { taskId: task.id, body: "New kind", actorUserId: userId, idempotencyKey: "migration-comment" }, "compact");
    const news = (await readCityNews(db,userId,countryId,true,null))!;
    await readNewsCards(db,userId,countryId,news.items.map(item=>item.lastEventId));
    expect(await db.prepare("SELECT kind FROM notification_reads_v1 WHERE kind='COMMENT'").all()).toEqual([{ kind: "COMMENT" }]);
    // A rollback image's known-kind query remains valid and sees its old row.
    expect(await db.prepare("SELECT * FROM notification_reads_v1 WHERE kind IN ('COMPLETED','DEFECT','OPENED','ASSIGNED')").all()).toEqual(old);
  });

});
