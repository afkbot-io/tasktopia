import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, transaction } from "../src/server/db";
import { citySceneChunkRange } from "../src/shared/city-capacity";

it("reads the actual city/occupied-port envelope with a read-only SQL snapshot", async () => {
  const shell = readFileSync(new URL("../deploy/compact-release-preflight.sh", import.meta.url), "utf8");
  const query = shell.match(/compact_release_query "(WITH city_scene_layouts AS \([\s\S]*?city_scene_counts);"/)![1]!;
  const db = await createTestDb();
  try {
    const countryId = (await registerUser(db, { email: "scene-capacity-preflight@example.test", name: "Capacity", password: "password123" })).user.countryId;
    const required = () => transaction(db, async () => {
      await db.exec("SET TRANSACTION READ ONLY");
      return String(Object.values((await db.prepare(query).get())!)[0]);
    });
    expect(await required()).toBe("1");
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const service = new AppService(db);
    const city = await service.createCity(countryId, { name: "Read-only extent", idempotencyKey: "extent-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Extent district", activate: true, idempotencyKey: "extent-district" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Extent task", estimate: 1, idempotencyKey: "extent-task" });
    const placement = (await db.prepare(`SELECT b.id,b.parameters_json,p.slot_key FROM task_placements_v1 p
      JOIN city_blocks_v1 b ON b.id=p.block_id JOIN city_layouts_v1 l ON l.id=p.layout_id AND l.status='ACTIVE' WHERE p.task_id=?`)
      .get<{ id: string; parameters_json: Record<string, unknown>; slot_key: string }>(task.id))!;
    const bounds = { minX: -64, minY: -64, maxX: 63, maxY: 63 };
    // Metadata-policy fixture only; this is not a manufactured 10k geometry proof.
    await db.prepare("UPDATE cities_v3 SET bounds_json=?::jsonb WHERE id=?").run(JSON.stringify(bounds), city.id);
    expect(await required()).toBe(String(citySceneChunkRange(bounds).count));
    for (const count of [255, 256, 257, 4096, 4097]) {
      const policyBounds = { minX: 0, minY: 0, maxX: count * 64 - 1, maxY: 63 };
      await db.prepare("UPDATE cities_v3 SET bounds_json=?::jsonb WHERE id=?").run(JSON.stringify(policyBounds), city.id);
      expect(await required()).toBe(String(count));
    }
    await db.prepare("UPDATE cities_v3 SET bounds_json=?::jsonb WHERE id=?").run(JSON.stringify(bounds), city.id);
    const far = { x: 16384, y: 0 }, plan = { approach: [], pier: [], waterPath: [], berth: far };
    const setPlans = (slot: string, value: unknown) => db.prepare("UPDATE city_blocks_v1 SET parameters_json=?::jsonb WHERE id=?")
      .run(JSON.stringify({ ...placement.parameters_json, slotRoles: { [slot]: "PORT" }, slotPortPlans: { [slot]: value } }), placement.id);
    await setPlans("unoccupied-slot", plan);
    expect(await required()).toBe("4");
    await setPlans(placement.slot_key, plan);
    expect(await required()).toBe(String(citySceneChunkRange({ ...bounds, maxX: far.x + 2 }).count));
    await setPlans(placement.slot_key, { ...plan, berth: { x: "16384", y: 0 } });
    expect(await required()).toBe("invalid");
    await setPlans(placement.slot_key, { ...plan, waterPath: {} });
    expect(await required()).toBe("invalid");
    // Canonical city bounds already reject fractions in PostgreSQL. A malformed
    // persisted port point reaches this preflight and must fail closed as well.
    await setPlans(placement.slot_key, { ...plan, berth: { x: 0.5, y: 0 } });
    expect(await required()).toBe("invalid");
  } finally { await db.close(); }
}, 30_000);

it("counts other PostgreSQL clients, including idle observers, while excluding its own backend", async () => {
  const shell = readFileSync(new URL("../deploy/compact-release-preflight.sh", import.meta.url), "utf8");
  const query = shell.match(/compact_release_other_clients\(\) \{\s+compact_release_query "([\s\S]*?)"/)![1]!;
  const db = await createTestDb(), observer = await createTestDb();
  try {
    const observerPid = (await observer.prepare("SELECT pg_backend_pid() AS pid").get<{ pid: number }>())!.pid;
    await transaction(db, async () => {
      await db.exec("SET TRANSACTION READ ONLY");
      const ownPid = (await db.prepare("SELECT pg_backend_pid() AS pid").get<{ pid: number }>())!.pid;
      expect(Number((await db.prepare(query).get<{ count: string }>())!.count)).toBeGreaterThanOrEqual(1);
      // Keep the exact production predicate and inspect only backend IDs, so
      // other parallel local tests cannot make the expected total flaky.
      const projection = query.replace("count(*)", "COALESCE(json_agg(pid),'[]'::json) AS pids");
      const pids = (await db.prepare(projection).get<{ pids: number[] }>())!.pids;
      expect(pids).toContain(observerPid);
      expect(pids).not.toContain(ownPid);
    });
  } finally { await observer.close(); await db.close(); }
}, 10_000);
