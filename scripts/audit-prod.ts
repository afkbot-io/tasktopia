// One-off production audit: runs the same auditWorld used by tests against
// the live database. Reads DATABASE_URL from the environment (inside the app
// container it already points at the postgres service).
import { AppService } from "../src/server/app-service";
import { createDb } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = await createDb(url);
  try {
    const service = new AppService(db);
    const countries = (await db.prepare("SELECT id, name, seed FROM countries ORDER BY created_at").all()) as Array<{ id: string; name: string; seed: number }>;
    for (const country of countries) {
      const audit = await auditWorld(db, service, country.id);
      console.log(`\n=== ${country.name} (seed ${country.seed}) ===`);
      console.log(`metrics: ${JSON.stringify(audit.metrics)}`);
      if (audit.violations.length === 0) console.log("violations: none");
      else for (const v of audit.violations) console.log(`  ${v.code}: ${v.message}`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
