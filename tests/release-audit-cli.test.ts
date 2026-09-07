import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";

const exec = promisify(execFile);
describe("operator world audit exit status", () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db.close(); });
  it("fails closed on invalid geometry and does not repair it or mutate task records", async () => {
    const { user } = await registerUser(db, { email: "audit@example.com", password: "safe-test-password", name: "Audit", countryName: "Audit" });
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "City", idempotencyKey: "city" });
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "Sprint", activate: true, idempotencyKey: "sprint" });
    const task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: "Preserved", estimate: 1, idempotencyKey: "task" });
    await db.prepare("DELETE FROM task_placements_v1 WHERE task_id=?").run(task.id);
    const schema = (await db.prepare("SELECT current_schema() AS name").get<{ name: string }>())!.name;
    const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test");
    url.searchParams.set("options", `-csearch_path=${schema}`);
    const result = await exec(process.execPath, ["--import", "tsx", "scripts/audit-prod.ts"], {
      env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 30_000,
    }).then(value => ({ code: 0, ...value }), error => ({ code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string }));
    expect(result.code, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toMatch(/TASK_WITHOUT_PLACEMENT|MISSING_TASK_PLACEMENT|PLACEMENT/);
    expect(await db.prepare("SELECT id,title FROM tasks_v3 WHERE id=?").get(task.id)).toEqual({ id: task.id, title: "Preserved" });
    expect(await db.prepare("SELECT task_id FROM task_placements_v1 WHERE task_id=?").get(task.id)).toBeUndefined();
  });
});
