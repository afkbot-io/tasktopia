import { expect, it } from "vitest";
import Fastify from "fastify";
import cookiePlugin from "@fastify/cookie";
import { createTestDb } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
import { AppService } from "../src/server/app-service";
import { readCityReport } from "../src/server/city-report-read";
import { readCityNews, readNewsCards } from "../src/server/city-news-read";
import { reportGroup, taskAttention } from "../src/shared/city-report";
it("reads scoped documents, atomically assigns starts, and preserves unseen news pages", async () => {
  const db = await createTestDb();
  const app = Fastify();
  try {
    await app.register(cookiePlugin);
    const service = new AppService(db);
    await registerRoutes(app, db, service);
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "documents@example.test",
        name: "Mayor",
        password: "password123",
        passwordConfirmation: "password123",
        countryName: "Documents",
        cityName: "City",
      },
    });
    expect(registered.statusCode).toBe(200);
    const raw = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(";")[0]!;
    const b = (
      await app.inject({ url: "/api/bootstrap", headers: { cookie } })
    ).json();
    const c = b.country.id,
      u = b.user.id;
    await service.createDistrict(c, {
      cityId: b.initialCity.id,
      name: "Active",
      activate: true,
      idempotencyKey: "docs-district",
    });
    const task = await service.createTask(c, {
      cityId: b.initialCity.id,
      title: "A task",
      estimate: 1,
      idempotencyKey: "docs-task",
    });
    const input = {
      taskId: task.id,
      status: "STARTED" as const,
      actorUserId: u,
      idempotencyKey: "docs-start",
    };
    const started = await service.updateTaskStatus(c, input);
    expect(started.assignee?.id).toBe(u);
    expect((await service.updateTaskStatus(c, input)).assignee?.id).toBe(u);
    expect(
      started.events?.filter((e) => e.type === "ASSIGNEE_CHANGED"),
    ).toHaveLength(1);
    const report = await readCityReport(db, u, c, null, null, false, 0, 7);
    expect(report?.counts.working).toBe(1);
    expect(report?.items[0]?.assignee).toBe("Mayor");
    expect(
      await readCityReport(db, "foreign", c, null, null, false, 0, 7),
    ).toBeUndefined();
    expect(
      (
        await app.inject({
          url: `/api/city-report?countryId=${c}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `/api/city-report?countryId=${c}` })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: `/api/city-report?countryId=${crypto.randomUUID()}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: `/api/city-report?countryId=${c}&offset=-1`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400);
    await db
      .prepare(
        `INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||jsonb_build_object('id','news-fixture-'||n,'task_number',1000+n,'title','Task '||n))).* FROM tasks_v3 t CROSS JOIN generate_series(1,76) n WHERE t.id=?`,
      )
      .run(task.id);
    await db
      .prepare(
        `INSERT INTO events(country_id,type,world_version,payload_json,created_at) SELECT ?,'task.defect_created',1,jsonb_build_object('taskId','news-fixture-'||n),CURRENT_TIMESTAMP FROM generate_series(1,26) n`,
      )
      .run(c);
    await db
      .prepare(
        "UPDATE tasks_v3 SET status='COMPLETED' WHERE id='news-fixture-76'",
      )
      .run();
    await db
      .prepare(
        `INSERT INTO events(country_id,type,world_version,payload_json,created_at) SELECT ?,'task.status_changed',1,jsonb_build_object('taskId','news-fixture-76','status','COMPLETED'),CURRENT_TIMESTAMP FROM generate_series(1,2)`,
      )
      .run(c);
    const completedReport = await readCityReport(
      db,
      u,
      c,
      null,
      null,
      false,
      0,
      7,
    );
    expect(completedReport?.counts.completedPeriod).toBe(1);
    expect(completedReport?.counts.completed).toBe(1);
    // Remove only the additional completion events so the news fixture stays 27 cards.
    await db
      .prepare(
        "DELETE FROM events WHERE country_id=? AND payload_json->>'taskId'='news-fixture-76'",
      )
      .run(c);
    const first = await readCityReport(db, u, c, null, null, false, 0, 7);
    expect(first?.total).toBe(77);
    expect(first?.items).toHaveLength(50);
    expect(first?.nextOffset).toBe(50);
    const second = await readCityReport(db, u, c, null, null, false, 50, 7);
    expect(second?.items).toHaveLength(27);
    expect(second?.nextOffset).toBeNull();
    const news = (await readCityNews(db, u, c, false, null))!;
    expect(news.items).toHaveLength(20);
    expect(news.unreadCount).toBe(27);
    await readNewsCards(
      db,
      u,
      c,
      news.items.map((i) => i.lastEventId),
    );
    expect((await readCityNews(db, u, c, false, null))!.unreadCount).toBe(7);
    const history = (await readCityNews(db, u, c, true, null))!;
    expect(history.items).toHaveLength(20);
    expect(history.items.every((i) => !i.unread)).toBe(true);
    expect(
      (await readCityNews(db, u, c, true, history.nextBefore))!.items,
    ).toHaveLength(7);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/city-news/read",
          headers: { cookie },
          payload: { countryId: crypto.randomUUID(), eventIds: [1] },
        })
      ).statusCode,
    ).toBe(403);
    expect(await readCityNews(db, "foreign", c, true, null)).toBeUndefined();
    await db
      .prepare(
        `INSERT INTO task_defects_v18(id,task_id,title,description,reproduction_steps,actual_result,expected_result,status,created_at,updated_at) VALUES (?,'news-fixture-76','Repair after opening','','Open','Broken','Works','OPEN',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      )
      .run(crypto.randomUUID());
    const attention = await readCityReport(db, u, c, null, null, true, 0, 7);
    expect(
      attention?.items.find((item) => item.id === "news-fixture-76")?.defects,
    ).toBe(1);
    expect(attention?.counts.completed).toBe(1);
  } finally {
    await app.close();
    await db.close();
  }
}, 30000);
it("keeps acceptance in work and groups attention reasons without duplicating a task", () => {
  expect(reportGroup("TESTING")).toBe(0);
  expect(reportGroup("PLANNING")).toBe(1);
  expect(reportGroup("COMPLETED")).toBe(2);
  const task = {
    id: "t",
    taskNumber: 1,
    title: "T",
    status: "TESTING" as const,
    progress: 90,
    cityName: "C",
    districtName: "D",
    assignee: null,
    dueAt: "2000-01-01",
    defects: 2,
    dependencies: 1,
  };
  expect(taskAttention(task)).toHaveLength(5);
  expect(taskAttention({ ...task, status: "COMPLETED" })).toEqual([
    "Нужен ремонт · 2",
  ]);
  expect(taskAttention({ ...task, status: "COMPLETED", defects: 0 })).toEqual(
    [],
  );
});

it("MCP start assigns the authenticated actor and another actor cannot steal ownership", async () => {
  const { Client } = await import("@modelcontextprotocol/client");
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  const { createMcpServer } = await import("../src/server/mcp");
  const { registerUser } = await import("../src/server/auth");
  const db = await createTestDb();
  try {
    const owner = await registerUser(db, {
      email: "mcp-start@example.test",
      name: "Starter",
      password: "password123",
    });
    const other = await registerUser(db, {
      email: "mcp-other@example.test",
      name: "Other",
      password: "password123",
    });
    const c = owner.user.countryId,
      service = new AppService(db);
    const city = await service.createCity(c, {
      name: "MCP city",
      idempotencyKey: "mcp-city",
    });
    await db
      .prepare(
        "INSERT INTO country_members(country_id,user_id,role,created_at) VALUES (?,?,'MEMBER',CURRENT_TIMESTAMP)",
      )
      .run(c, other.user.id);
    await service.createDistrict(c, {
      cityId: city.id,
      name: "Active",
      activate: true,
      idempotencyKey: "mcp-start-district",
    });
    const task = await service.createTask(c, {
      cityId: city.id,
      title: "Start through MCP",
      estimate: 1,
      idempotencyKey: "mcp-start-task",
    });
    const server = await createMcpServer(db, service, {
      userId: owner.user.id,
      tokenId: crypto.randomUUID(),
      scopes: ["tasks:write", "country:read"],
    });
    const client = new Client({ name: "start-test", version: "1.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const result = await client.callTool({
        name: "task.set_status",
        arguments: {
          countryId: c,
          taskId: task.id,
          status: "STARTED",
          idempotencyKey: "mcp-start-op",
        },
      });
      expect(result.isError).not.toBe(true);
      expect((await service.getTask(c, task.id)).assignee?.id).toBe(
        owner.user.id,
      );
      await service.updateTaskStatus(c, {
        taskId: task.id,
        status: "STARTED",
        actorUserId: other.user.id,
        idempotencyKey: "other-start",
      });
      expect((await service.getTask(c, task.id)).assignee?.id).toBe(
        owner.user.id,
      );
      const second = await service.createTask(c, {
        cityId: city.id,
        title: "Explicit owner",
        estimate: 1,
        assigneeUserId: other.user.id,
        idempotencyKey: "explicit-owner-task",
      });
      const updated = await service.updateTaskStatus(c, {
        taskId: second.id,
        status: "STARTED",
        actorUserId: owner.user.id,
        idempotencyKey: "explicit-owner-start",
      });
      expect(updated.assignee?.id).toBe(other.user.id);
      const third = await service.createTask(c, {
        cityId: city.id,
        title: "Concurrent start",
        estimate: 1,
        idempotencyKey: "concurrent-task",
      });
      await Promise.all(
        [owner.user.id, other.user.id].map((actorUserId, n) =>
          service.updateTaskStatus(c, {
            taskId: third.id,
            status: "STARTED",
            actorUserId,
            idempotencyKey: `concurrent-${n}`,
          }),
        ),
      );
      expect(
        (await service.getTask(c, third.id)).events?.filter(
          (e) => e.type === "ASSIGNEE_CHANGED",
        ),
      ).toHaveLength(1);
      await db
        .prepare(
          "UPDATE country_members SET role='VIEWER' WHERE country_id=? AND user_id=?",
        )
        .run(c, other.user.id);
      const fourth = await service.createTask(c, {
        cityId: city.id,
        title: "Viewer cannot start",
        estimate: 1,
        idempotencyKey: "viewer-task",
      });
      await expect(
        service.updateTaskStatus(c, {
          taskId: fourth.id,
          status: "STARTED",
          actorUserId: other.user.id,
          idempotencyKey: "viewer-start",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await service.getTask(c, fourth.id)).status).toBe("PLANNING");
    } finally {
      await client.close();
      await server.close();
    }
  } finally {
    await db.close();
  }
}, 30000);
