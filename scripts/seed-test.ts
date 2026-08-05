import { AppService } from "../src/server/app-service";
import { loginUser, registerUser } from "../src/server/auth";
import { config } from "../src/server/config";
import { createDb, transaction } from "../src/server/db";
import type { DistrictArchetype } from "../src/shared/contracts";

const db = await createDb(config.databaseUrl);
const service = new AppService(db);
const email = "demo@tasktopia.local";
const password = "tasktopia-demo";
let user;
try {
  user = (await registerUser(db, { email, password, name: "Тестовый правитель" })).user;
} catch {
  user = (await loginUser(db, email, password)).user;
}

await transaction(db, async () => {
  await db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Тестовый правитель", user.id);
  await db.prepare("UPDATE countries SET name = ? WHERE id = ?").run("Тестовая страна", user.countryId);
  await db.prepare("DELETE FROM world_features_v6 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
  await db.prepare("UPDATE countries SET seed = ?, world_version = 1 WHERE id = ?").run(424_242, user.countryId);
});

const city = await service.createCity(user.countryId, { name: "Riverside", idempotencyKey: "test-city" });
const archetypes: DistrictArchetype[] = ["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"];
for (let index = 0; index < 10; index += 1) {
  const district = await service.createDistrict(user.countryId, {
            cityId: city.id,
            name: `Тестовый район ${index + 1}`,
            archetype: archetypes[index % archetypes.length],
            capacitySp: 40,
            activate: index === 0,
            idempotencyKey: `test-district-${index}`,
          });
  for (let taskIndex = 0; taskIndex < 2; taskIndex += 1) {
    await service.createTask(user.countryId, {
                              cityId: city.id,
                              districtId: district.id,
                              title: `Задача района ${index + 1}.${taskIndex + 1}`,
                              estimate: 1,
                              idempotencyKey: `test-task-${index}-${taskIndex}`,
                            });
  }
}

console.log("Test data is ready: 1 city, 10 districts, 20 tasks.");
await db.close();
