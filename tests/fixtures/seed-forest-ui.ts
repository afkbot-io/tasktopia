import { randomUUID } from "node:crypto";
import { createDb } from "../../src/server/db";
import { AppService } from "../../src/server/app-service";

const database = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
const schema = database.searchParams.get("options")?.match(/^-csearch_path=([a-z][a-z0-9_]*)$/)?.[1];
if (!["127.0.0.1", "localhost"].includes(database.hostname) || database.pathname !== "/tasktopia_test"
  || !schema?.startsWith("forest_ui_") || !/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? "")) {
  throw new Error("Forest UI fixtures require their own local forest_ui_ schema and loopback server");
}
const [countryId, cityId] = process.argv.slice(2);
if (!countryId || !cityId) throw new Error("Pass the fixture country and city IDs");
const db = await createDb(database.href, { migrate: false });
try {
  const service = new AppService(db);
  const run = randomUUID();
  const record = await service.createArchiveRecord(countryId, { kind: "CONVENTION", title: `Хвойный атлас: проверка документа ${run.slice(0, 8)}`, tags: ["Дизайн", "Доступность"],
    body: "#### Правила интерфейса\n\nТёплый текст, хвойные поверхности и **ясные действия**.\n\n> Подпись остаётся читаемой.\n\n- Первый пункт\n- Второй пункт\n\n| Состояние | Значение |\n| --- | --- |\n| Готово | Проверено |\n\n```ts\nconst city = 'Tasktopia';\n```\n\n[Документация](https://tasktopia.online/ai.md)",
    sourceUrl: "https://tasktopia.online/ai.md", idempotencyKey: `forest-archive-${run}` });
  const task = await service.createTask(countryId, { cityId, title: "Локальный участок проверки дизайна", estimate: 1, idempotencyKey: `forest-site-${run}` });
  await service.deleteTask(countryId, { taskId: task.id, confirmTitle: task.title, idempotencyKey: `forest-delete-${run}` });
  process.stdout.write(JSON.stringify({ record, task }));
} finally { await db.close(); }
