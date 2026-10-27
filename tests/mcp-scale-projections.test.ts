import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db, type Row } from "../src/server/db";
import { blockTaskGeometry, readActiveBlockLayout, synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import type { Cell, TaskDto } from "../src/shared/contracts";

describe("task projections hydrate only requested authored blocks", { timeout: 60_000 }, () => {
  let db: Db, counted: Db, countryId: string, cityId: string, task: TaskDto;
  let expected: Map<string, { origin: Cell; footprint: Cell[]; entrance: Cell; accessPath: Cell[] }>;
  const reads: Array<{ query: string; rows: number }> = [];
  beforeAll(async () => {
    db = await createTestDb();
    const owner = await registerUser(db, { email: "selected-blocks@example.test", name: "Selected blocks", password: "password123" });
    countryId = owner.user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const writer = new AppService(db);
    const city = await writer.createCity(countryId, { name: "Canonical blocks", idempotencyKey: "selected-city" });
    cityId = city.id;
    const district = await writer.createDistrict(countryId, { cityId, name: "Canonical district", activate: true, idempotencyKey: "selected-district" });
    task = await writer.createTask(countryId, { cityId, districtId: district.id, title: "Selected task", estimate: 1, idempotencyKey: "selected-task" });
    await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||jsonb_build_object(
      'id',gen_random_uuid()::text,'task_number',0,'title','Unrelated task '||n))).*
      FROM tasks_v3 t CROSS JOIN generate_series(1,59) n WHERE t.id=?`).run(task.id);
    await db.prepare("UPDATE tasks_v3 SET status='IN_PROGRESS',progress=40 WHERE id=?").run(task.id);
    await synchronizeCityBlocks(db, countryId, cityId);
    const layout = (await readActiveBlockLayout(db, cityId))!;
    expect(layout.blocks.length).toBeGreaterThan(3);
    expected = blockTaskGeometry(layout);
    counted = {
      prepare(query) {
        const statement = db.prepare(query);
        const read = async <T>(operation: () => Promise<T>) => {
          const result = await operation();
          reads.push({ query, rows: Array.isArray(result) ? result.length : result ? 1 : 0 });
          return result;
        };
        return { all: <T extends Row>(...args: unknown[]) => read(() => statement.all<T>(...args)),
          get: <T extends Row>(...args: unknown[]) => read(() => statement.get<T>(...args)),
          run: (...args) => statement.run(...args) };
      },
      exec: query => db.exec(query), transaction: callback => db.transaction(callback), close: async () => undefined,
    };
  });
  afterAll(async () => { await db?.close(); });

  it.each(["card", "page", "comment", "progress"] as const)("%s does not hydrate the full city's placements or road network", async operation => {
    reads.length = 0;
    const service = new AppService(counted);
    if (operation === "card") {
      const card = await service.getTaskCard(countryId, task.id);
      const geometry = expected.get(task.id)!;
      expect(card).toMatchObject({ id: task.id, origin: geometry.origin, footprint: geometry.footprint,
        entrance: geometry.entrance, accessPath: geometry.accessPath });
    } else if (operation === "page") {
      const page = await service.listTaskPage(countryId, { cityId, limit: 7 });
      expect(page.items).toHaveLength(7);
      expect(page.nextCursor).toBeTruthy();
      for (const item of page.items) expect(item.origin).toEqual(expected.get(item.id)!.origin);
    } else if (operation === "comment") {
      expect(await service.addTaskComment(countryId, { taskId: task.id, body: "Bounded comment", idempotencyKey: "bounded-comment" }, "compact"))
        .toMatchObject({ kind: "task.command-result", id: task.id });
    } else {
      expect(await service.updateTaskStatus(countryId, { taskId: task.id, status: "IN_PROGRESS", progress: 52, idempotencyKey: "bounded-progress" }, "compact"))
        .toMatchObject({ kind: "task.command-result", id: task.id, progress: 52 });
    }
    expect(reads.filter(read => read.query.includes("AS placements") && read.query.includes("AS road")),
      "A bounded task read must not fetch all city placements/roads").toEqual([]);
    const blockReads = reads.filter(read => read.query.includes("AS selected_placements"));
    expect(blockReads.length).toBeGreaterThan(0);
    expect(blockReads.reduce((sum, read) => sum + read.rows, 0)).toBeLessThanOrEqual(operation === "page" ? 7 : 3);
  });

  it("keeps complete geometry identical to the canonical active layout", async () => {
    const service = new AppService(counted);
    const tasks = await service.listTasks(countryId);
    expect(tasks).toHaveLength(60);
    for (const current of tasks) {
      const geometry = expected.get(current.id)!;
      expect({ origin: current.origin, footprint: current.footprint, entrance: current.entrance, accessPath: current.accessPath })
        .toEqual({ origin: geometry.origin, footprint: geometry.footprint, entrance: geometry.entrance, accessPath: geometry.accessPath });
    }
  });

  it.each(["document", "checklist", "defect"] as const)("%s commands validate only their own rows, not full task history", async operation => {
    reads.length = 0;
    const service = new AppService(counted);
    if (operation === "document") {
      const document = await service.upsertTaskDocument(countryId, { taskId: task.id, fileName: "architecture.md", content: "# Actual architecture",
        idempotencyKey: "bounded-document" });
      expect(document).toMatchObject({ taskId: task.id, fileName: "architecture.md", content: "# Actual architecture" });
    } else if (operation === "checklist") {
      const items = await service.replaceTaskChecklist(countryId, { taskId: task.id, items: [{ title: "Verify bounded read" }], idempotencyKey: "bounded-checklist" });
      expect(items).toHaveLength(1);
      const item = await service.updateTaskChecklistItem(countryId, { taskId: task.id, itemId: items[0]!.id, done: true, idempotencyKey: "bounded-checklist-item" });
      expect(item).toMatchObject({ id: items[0]!.id, done: true });
    } else {
      const defect = await service.createTaskDefect(countryId, { taskId: task.id, title: "Bounded defect", reproductionSteps: "Open task",
        actualResult: "Unbounded read", expectedResult: "Own collection only", idempotencyKey: "bounded-defect" });
      expect(defect).toMatchObject({ taskId: task.id, status: "OPEN" });
      expect(await service.updateTaskDefect(countryId, { defectId: defect.id, status: "IN_PROGRESS", idempotencyKey: "bounded-defect-status" }))
        .toMatchObject({ id: defect.id, status: "IN_PROGRESS" });
    }
    expect(reads.filter(read => /AS comments|AS events|AS documents|AS checklist/.test(read.query)),
      "A narrow command must not hydrate every child collection").toEqual([]);
  });

  it.each(["rename", "assign", "dependency-add", "dependency-remove"] as const)("%s hydrates full history once only for its legacy response", async operation => {
    const dependencyId = [...expected.keys()].find(id => id !== task.id)!;
    if (operation === "dependency-remove") await db.prepare(`INSERT INTO task_dependencies_v1(task_id,depends_on_task_id,created_at)
      VALUES(?,?,now()) ON CONFLICT DO NOTHING`).run(task.id, dependencyId);
    reads.length = 0;
    const service = new AppService(counted);
    const result = operation === "rename" ? await service.renameTask(countryId, { taskId: task.id, title: "Renamed task", idempotencyKey: "bounded-rename" })
      : operation === "assign" ? await service.assignTask(countryId, { taskId: task.id, assigneeUserId: null, idempotencyKey: "bounded-assign" })
      : operation === "dependency-add" ? await service.addTaskDependency(countryId, { taskId: task.id, dependsOnTaskId: dependencyId, idempotencyKey: "bounded-dependency-add" })
      : await service.removeTaskDependency(countryId, { taskId: task.id, dependsOnTaskId: dependencyId, idempotencyKey: "bounded-dependency-remove" });
    expect(result).toMatchObject({ id: task.id, comments: expect.any(Array), events: expect.any(Array), documents: expect.any(Array) });
    expect(reads.filter(read => read.query.includes("AS comments") && read.query.includes("AS events"))).toHaveLength(1);
  });
});
