import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";

// Regeneration density scan: builds the 29-task incident workload, then
// regenerates the country repeatedly (each regen rolls a fresh random seed)
// and reports the post-regen fill rate. Run: npx tsx scripts/scan-regen.ts [count]
const runs = Number(process.argv[2] ?? 8);

for (let index = 0; index < runs; index += 1) {
  const db = await createTestDb();
  try {
    const registered = await registerUser(db, {
      email: `regen-scan-${index}@tasktopia.local`,
      name: "Scan",
      password: "scan-password",
    });
    const countryId = registered.user.countryId;
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(900_001 + index * 61_337, countryId);
    const service = new AppService(db);
    const city = await service.createCity(countryId, { name: "Regentown", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id,
      name: "Спальный",
      archetype: "NEW_BUILD",
      capacitySp: 32,
      activate: true,
      idempotencyKey: "district",
    });
    for (let taskIndex = 0; taskIndex < 29; taskIndex += 1) {
      await service.createTask(countryId, {
        cityId: city.id,
        districtId: district.id,
        title: `Однотипная задача ${taskIndex + 1}`,
        estimate: 1,
        idempotencyKey: `task-${taskIndex}`,
      });
    }
    const before = (await service.listDistricts(countryId)).find((item) => item.id === district.id)!;
    await service.regenerateCountry(countryId, { confirmName: "Scan: страна", idempotencyKey: `regenerate-${index}` });
    const after = (await service.listDistricts(countryId)).find((item) => item.id === district.id)!;
    const audit = await auditWorld(db, service, countryId);
    const rate = (d: typeof before) => d.lots.length === 0 ? 1 : d.lots.filter((lot) => lot.taskId).length / d.lots.length;
    console.log(JSON.stringify({
      run: index,
      fillBefore: rate(before),
      lotsBefore: before.lots.length,
      fillAfter: rate(after),
      lotsAfter: after.lots.length,
      violations: audit.violations.map((violation) => violation.code),
    }));
  } finally {
    await db.close();
  }
}
