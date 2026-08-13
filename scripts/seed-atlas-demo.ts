import { AppService } from "../src/server/app-service";
import { loginUser } from "../src/server/auth";
import { config } from "../src/server/config";
import { createDb, transaction } from "../src/server/db";
import type { TaskStatus } from "../src/shared/contracts";

const databaseHost = new URL(config.databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(databaseHost)) {
  throw new Error("Atlas demo seed is local-only");
}

const db = await createDb(config.databaseUrl);
const service = new AppService(db);
const user = (await loginUser(db, "demo@tasktopia.local", "tasktopia-demo")).user;
const cityNames = ["Riverside", "Pinegate", "Harborview", "Stonebridge", "Northbank", "Eastmere", "Meadowrun", "Southport"];

await transaction(db, async () => {
  await db.prepare("UPDATE countries SET name = ?, seed = ?, world_version = 1 WHERE id = ?").run("Страна восьми городов", 814_227, user.countryId);
  await db.prepare("DELETE FROM world_features_v6 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
});

const statusPaths: TaskStatus[][] = [
  ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"],
  ["STARTED", "IN_PROGRESS", "TESTING"],
  ["STARTED", "IN_PROGRESS"],
  ["STARTED"],
  [],
];

for (let cityIndex = 0; cityIndex < cityNames.length; cityIndex += 1) {
  const city = await service.createCity(user.countryId, {
    name: cityNames[cityIndex]!,
    morphology: cityIndex === 0 ? "DENSE_CORE" : cityIndex % 3 === 0 ? "POLYCENTRIC" : "BALANCED",
    idempotencyKey: `atlas-demo-city-${cityIndex}`,
  });
  for (let districtIndex = 0; districtIndex < 3; districtIndex += 1) {
    const district = await service.createDistrict(user.countryId, {
      cityId: city.id,
      name: `Новые высотки ${districtIndex + 1}`,
      archetype: "NEW_BUILD",
      capacitySp: 26,
      activate: true,
      idempotencyKey: `atlas-demo-district-${cityIndex}-${districtIndex}`,
    });
    for (let buildingIndex = 0; buildingIndex < 5; buildingIndex += 1) {
      let task = await service.createTask(user.countryId, {
        cityId: city.id,
        districtId: district.id,
        title: `Построить новую высотку ${buildingIndex + 1}`,
        estimate: 3,
        idempotencyKey: `atlas-demo-building-${cityIndex}-${districtIndex}-${buildingIndex}`,
      });
      const statuses = districtIndex < 2
        ? statusPaths[0]!
        : statusPaths[(cityIndex + buildingIndex) % statusPaths.length]!;
      for (const status of statuses) {
        task = await service.updateTaskStatus(user.countryId, {
          taskId: task.id,
          status,
          actor: "Atlas demo",
          idempotencyKey: `atlas-demo-stage-${task.id}-${status}`,
        });
      }
    }
    if (districtIndex < 2) {
      await service.completeDistrict(user.countryId, district.id, `atlas-demo-district-complete-${cityIndex}-${districtIndex}`);
    }
  }
}

console.log(`Atlas demo is ready: ${cityNames.length} cities, 3 districts per city, 5 V5 buildings per district.`);
await db.close();
