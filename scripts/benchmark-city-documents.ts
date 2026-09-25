import { createTestDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { readCityReport } from "../src/server/city-report-read";
import { readCityNews } from "../src/server/city-news-read";
// Запуск: npx tsx scripts/benchmark-city-documents.ts. Данные живут в отдельной
// временной схеме; никаких вызовов генерации большой карты или рабочих API.
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
const target = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !target.pathname.endsWith("_test")
)
  throw new Error("Разрешена только локальная тестовая база");
const db = await createTestDb(databaseUrl);
try {
  const { user } = await registerUser(db, {
    email: "bench@example.test",
    name: "Bench",
    password: "password123",
  });
  const s = new AppService(db);
  const c = user.countryId;
  const city = await s.createCity(c, { name: "Bench", idempotencyKey: "c" });
  await s.createDistrict(c, {
    cityId: city.id,
    name: "Bench",
    activate: true,
    idempotencyKey: "d",
  });
  const task = await s.createTask(c, {
    cityId: city.id,
    title: "Bench",
    estimate: 1,
    idempotencyKey: "t",
  });
  await db
    .prepare(
      `INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||jsonb_build_object('id','bench-'||n,'task_number',100+n,'status','COMPLETED','description',repeat('x',8000)))).* FROM tasks_v3 t CROSS JOIN generate_series(1,2000) n WHERE t.id=?`,
    )
    .run(task.id);
  await db
    .prepare(
      `INSERT INTO events(country_id,type,world_version,payload_json,created_at) SELECT ?,'task.status_changed',1,jsonb_build_object('taskId','bench-'||n,'status','COMPLETED'),CURRENT_TIMESTAMP FROM generate_series(1,2000) n CROSS JOIN generate_series(1,5) m`,
    )
    .run(c);
  for (const [name, run] of [
    ["report", () => readCityReport(db, user.id, c, null, null, false, 0, 7)],
    ["news", () => readCityNews(db, user.id, c, false, null)],
  ] as const) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const t = performance.now();
      const r = await run();
      times.push(Math.round(performance.now() - t));
      if (!r) throw Error("missing");
    }
    console.log(name, JSON.stringify(times));
  }
} finally {
  await db.close();
}
