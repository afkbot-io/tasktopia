import { AppService } from "../src/server/app-service";
import { loginUser, registerUser } from "../src/server/auth";
import { config } from "../src/server/config";
import { createDb, transaction } from "../src/server/db";
import { seedCompactCity } from "../src/server/fixtures/representative-country";

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
  await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
  await db.prepare("UPDATE countries SET seed = ?, world_version = 1 WHERE id = ?").run(424_242, user.countryId);
});

await seedCompactCity(service, user.countryId, {
  key: "browser-test", name: "Riverside", includeTaskMaterials: true,
});
console.log("Test data is ready: 1 compact city, 3 districts, 40 numbered building/park tasks.");
await db.close();
