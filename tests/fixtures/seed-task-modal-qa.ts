import { randomUUID } from "node:crypto";
import { AppService } from "../../src/server/app-service";
import { createDb } from "../../src/server/db";

const url = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
const schema = url.searchParams.get("options")?.match(/^-csearch_path=([a-z][a-z0-9_]*)$/)?.[1];
if (process.env.E2E_TASK_MODAL_MUTABLE_FIXTURE !== "true"
  || !["localhost", "127.0.0.1"].includes(url.hostname)
  || url.pathname !== "/tasktopia_test" || !schema || schema === "public") {
  throw new Error("Task modal QA requires an explicit disposable local schema");
}
const [countryId, cityId] = process.argv.slice(2);
if (!countryId || !cityId) throw new Error("Task modal QA requires the authenticated country and city");
const db = await createDb(url.toString(), { migrate: false, maxConnections: 1 });
try {
  const district = await db.prepare(`SELECT d.id FROM districts_v3 d JOIN cities_v3 c ON c.id=d.city_id
    WHERE c.country_id=? AND c.id=? AND d.status IN ('ACTIVE','PLANNED') ORDER BY d.created_at,d.id LIMIT 1`)
    .get<{ id: string }>(countryId, cityId);
  if (!district) throw new Error("The selected test city has no open district");
  const task = await new AppService(db).createTask(countryId, {
    cityId, districtId: district.id, title: `QA task modal availability ${randomUUID()}`,
    description: "Private task detail for availability QA", estimate: 1, idempotencyKey: randomUUID(),
  });
  process.stdout.write(JSON.stringify(task));
} finally { await db.close(); }
