import { randomUUID } from "node:crypto";
import { AppService } from "../src/server/app-service";
import { createMcpToken, loginUser, registerUser } from "../src/server/auth";
import { config } from "../src/server/config";
import { createDb } from "../src/server/db";
import { REPRESENTATIVE_SEED, seedRepresentativeCountry } from "../src/server/fixtures/representative-country";

const db = createDb(config.databasePath);
const service = new AppService(db);
const email = "demo@tasktopia.local";
const password = "tasktopia-demo";

let user;
let created = false;
try {
  user = (await registerUser(db, { email, password, name: "Demo Mayor" })).user;
  created = true;
} catch {
  user = (await loginUser(db, email, password)).user;
}
if (created) db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(REPRESENTATIVE_SEED, user.countryId);

const fixture = seedRepresentativeCountry(service, user.countryId);
const token = createMcpToken(db, user.countryId, `Demo token ${randomUUID().slice(0, 6)}`);
if (process.env.SEED_PRINT_TOKEN !== "false") {
  console.log(JSON.stringify({
    login: { email, password },
    fixture: { cities: fixture.cities.length, districts: fixture.districts.length, tasks: fixture.tasks.length },
    mcp: { endpoint: `http://${config.HOST}:${config.PORT}/mcp`, token: token.token },
  }, null, 2));
} else {
  console.log(`Demo data is ready: ${fixture.cities.length} cities, ${fixture.districts.length} districts, ${fixture.tasks.length} tasks.`);
}
db.close();
