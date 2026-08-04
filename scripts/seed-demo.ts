import { randomUUID } from "node:crypto";
import { AppService } from "../src/server/app-service";
import { createMcpToken, loginUser, registerUser } from "../src/server/auth";
import { config } from "../src/server/config";
import { createDb, transaction } from "../src/server/db";
import { REPRESENTATIVE_SEED, seedRepresentativeCountry } from "../src/server/fixtures/representative-country";

const db = await createDb(config.databaseUrl);
const service = new AppService(db);
const email = "demo@tasktopia.local";
const password = "tasktopia-demo";

let user;
try {
  user = (await registerUser(db, { email, password, name: "Городская команда" })).user;
} catch {
  user = (await loginUser(db, email, password)).user;
}
// `npm run seed` owns the local showcase country. Rebuild only its generated
// world so fixture revisions cannot collide with old idempotency payloads;
// account, sessions, memberships and personal MCP credentials remain intact.
await transaction(db, async () => {
  await db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Городская команда", user.id);
  await db.prepare("UPDATE countries SET name = ? WHERE id = ?").run("Страна Tasktopia", user.countryId);
  await db.prepare("DELETE FROM world_features_v6 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
  await db.prepare("UPDATE countries SET seed = ?, world_version = 1 WHERE id = ?").run(REPRESENTATIVE_SEED, user.countryId);
});

const fixture = await seedRepresentativeCountry(service, user.countryId);
const token = await createMcpToken(db, user.countryId, `Local token ${randomUUID().slice(0, 6)}`);
if (process.env.SEED_PRINT_TOKEN !== "false") {
  console.log(JSON.stringify({
    login: { email, password },
    fixture: { cities: fixture.cities.length, districts: fixture.districts.length, tasks: fixture.tasks.length },
    mcp: { endpoint: `http://${config.HOST}:${config.PORT}/mcp`, token: token.token },
  }, null, 2));
} else {
  console.log(`Local data is ready: ${fixture.cities.length} cities, ${fixture.districts.length} districts, ${fixture.tasks.length} tasks.`);
}
await db.close();
