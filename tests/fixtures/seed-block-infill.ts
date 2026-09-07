import assert from "node:assert/strict";
import { createDb } from "../../src/server/db";
import { registerUser } from "../../src/server/auth";
import { AppService } from "../../src/server/app-service";
import type { TaskStatus } from "../../src/shared/contracts";

const schema = "block_infill_20260906";
const url = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
assert.ok(process.env.E2E_BLOCK_INFILL_FIXTURE === "true" && url.hostname === "127.0.0.1"
  && url.port === "5432" && url.pathname === "/tasktopia_test"
  && url.searchParams.get("options") === `-csearch_path=${schema}`);
const base = new URL(url); base.search = "";
const admin = await createDb(base.toString(), { migrate: false, maxConnections: 1 });
try {
  // Deliberately not IF NOT EXISTS: never reuse or reset a populated fixture.
  await admin.exec("CREATE SCHEMA block_infill_20260906");
} finally { await admin.close(); }
const db = await createDb(url.toString(), { maxConnections: 1 });
try {
  assert.equal((await db.prepare("SELECT current_schema() AS name").get<{ name: string }>())?.name, schema);
  const result = await db.transaction(async () => {
    const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo", name: "Infill QA", countryName: "Кварталы · заполнение" });
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "Разнообразные кварталы", idempotencyKey: "infill-city" });
    const statuses: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
    for (let sprint = 0; sprint < 3; sprint++) {
      const district = await service.createDistrict(user.countryId, { cityId: city.id, name: `Район ${sprint + 1}`, idempotencyKey: `infill-d-${sprint}` });
      await service.activateDistrict(user.countryId, district.id, `infill-active-${sprint}`);
      for (let n = 0; n < 32; n++) {
        const task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
          title: `Застройка ${sprint + 1}.${n + 1}`, estimate: 1, idempotencyKey: `infill-${sprint}-${n}` });
        const target = [5, 5, 5, 3, 1][n % 5]!;
        for (let phase = 2; phase <= target; phase++) await service.updateTaskStatus(user.countryId, {
          taskId: task.id, status: statuses[phase - 1]!, actor: "Infill QA", idempotencyKey: `infill-${sprint}-${n}-${phase}` });
      }
      process.stderr.write(`Seeded district ${sprint + 1}/3\n`);
    }
    const scene = await service.getCityScene(user.countryId, city.id);
    return { countryId: user.countryId, cityId: city.id, chunks: scene.chunks.length, schema };
  });
  process.stdout.write(JSON.stringify(result));
} finally { await db.close(); }
