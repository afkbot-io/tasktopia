import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, transaction } from "../src/server/db";
import { freezePermanentSiteGeometry, readPermanentSiteFeatures } from "../src/server/world/permanent-task-sites";

it("upgrades occupied MOVE parcels without deleting history and allows their reuse", async () => {
  const db = await createTestDb();
  try { await transaction(db, async () => {
    const schema = `relocation_${randomUUID().replaceAll("-", "")}`, directory = join(process.cwd(), "migrations/postgres");
    await db.exec(`CREATE SCHEMA "${schema}"`);
    await db.exec(`SET LOCAL search_path TO "${schema}"`);
    for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name) && name < "0038_").sort()) {
      await db.exec(await readFile(join(directory, name), "utf8"));
    }
    const countryId = (await registerUser(db, { email: "released@example.test", name: "Released", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const service = new AppService(db);
    const city = await service.createCity(countryId, { name: "Historical city", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "First", activate: true, idempotencyKey: "first" });
    const next = await service.createDistrict(countryId, { cityId: city.id, name: "Next", idempotencyKey: "next" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Moved work", estimate: 1, idempotencyKey: "work" });
    const placement = (await db.prepare("SELECT * FROM task_placements_v1 WHERE task_id=?").get(task.id))!;
    await service.transferTask(countryId, { taskId: task.id, targetDistrictId: next.id, idempotencyKey: "move" });
    const markerId = randomUUID(), timestamp = new Date().toISOString();
    await db.prepare(`INSERT INTO site_markers_v1(id,layout_id,block_id,slot_key,kind,target_task_id,snapshot_json,asset_variant,created_at,updated_at)
      VALUES(?,?,?,?,'RELOCATED',?,?::jsonb,'compact-relocation',?,?)`).run(markerId, placement.layout_id, placement.block_id, placement.slot_key,
        task.id, JSON.stringify({ taskNumber: task.taskNumber, title: task.title, buildingFamily: task.buildingType, lastStage: task.stage }), timestamp, timestamp);
    await freezePermanentSiteGeometry(db, countryId);
    const before = await db.prepare("SELECT * FROM site_markers_v1 WHERE id=?").get(markerId);
    await db.exec(await readFile(join(directory, "0038_reusable_relocated_sites.sql"), "utf8"));
    expect(await db.prepare("SELECT * FROM site_markers_v1 WHERE id=?").get(markerId)).toEqual(before);
    expect(await readPermanentSiteFeatures(db, countryId)).toEqual([]);
    const replacement = await new AppService(db).createTask(countryId, { cityId: city.id, districtId: district.id, title: "Replacement", estimate: 1, idempotencyKey: "replacement" });
    expect(replacement.origin).toEqual(task.origin);
    expect(await db.prepare("SELECT * FROM site_markers_v1 WHERE id=?").get(markerId)).toEqual(before);
    expect((await service.getTask(countryId, task.id)).districtId).toBe(next.id);
    await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
    await db.exec(`DROP SCHEMA "${schema}" CASCADE`);
  }); } finally { await db.close(); }
}, 30_000);
