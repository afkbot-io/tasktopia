import { describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";

describe("task history SQL locality", () => {
  it("reads one task's comments without scanning unrelated task history", async ({ task: testCase }) => {
    const db = await createTestDb();
    try {
      const user = (await registerUser(db, { email: "history-index@example.test", name: "History", password: "password123" })).user;
      await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
      const service = new AppService(db);
      const city = await service.createCity(user.countryId, { name: "History city", idempotencyKey: "city" });
      const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "District", activate: true, idempotencyKey: "district" });
      const first = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: "Selected task", estimate: 1, idempotencyKey: "first" });
      const other = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: "Unrelated history", estimate: 1, idempotencyKey: "other" });
      // Only business history rows are expanded; spatial state is authored by
      // the same real service used by production.
      await db.prepare(`INSERT INTO task_comments_v3(id,task_id,body,actor,created_at)
        SELECT md5(? || n::text)::uuid::text,CASE WHEN n=1 THEN ? ELSE ? END,'History fixture','SQL review',now()
        FROM generate_series(1,10001) n`).run(first.id,first.id,other.id);
      await db.exec("ANALYZE task_comments_v3");
      const planRows = await db.transaction(async () => {
        await db.exec("SET TRANSACTION READ ONLY");
        await db.exec("SET LOCAL statement_timeout='5s'");
        return db.prepare("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM task_comments_v3 WHERE task_id=? ORDER BY created_at").all(first.id);
      });
      const plan = planRows[0]!["QUERY PLAN"] as Array<{ Plan: Record<string, unknown>; "Execution Time": number }>;
      const nodes: Record<string, unknown>[] = [];
      const visit = (node: Record<string, unknown>) => { nodes.push(node); for (const child of (node.Plans ?? []) as Record<string, unknown>[]) visit(child); };
      visit(plan[0]!.Plan);
      Object.assign(testCase.meta,{ sql: { rows: 10001, selectedRows: 1, plan: plan[0] } });
      const scan = nodes.find(node => node["Relation Name"] === "task_comments_v3")!;
      expect(scan["Node Type"]).toMatch(/Index/);
      expect(scan["Actual Rows"]).toBe(1);
      expect((await service.getTask(user.countryId, first.id)).comments).toHaveLength(1);
    } finally { await db.close(); }
  }, 30_000);
});
