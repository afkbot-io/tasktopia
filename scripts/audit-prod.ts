// Explicit operator audit. Never migrates or repairs the database. A nonzero
// exit status is a release gate, not just a warning printed in a successful job.
import { AppService } from "../src/server/app-service";
import { createDb } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = await createDb(url, { migrate: false, maxConnections: 1 });
  try {
    const failures = await db.transaction(async () => {
      await db.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      const service = new AppService(db);
      const countries = await db.prepare("SELECT id,name,seed FROM countries ORDER BY created_at,id")
        .all<{ id: string; name: string; seed: number }>();
      let count = 0;
      for (const country of countries) {
        const audit = await auditWorld(db, service, country.id);
        console.log(JSON.stringify({ countryId: country.id, name: country.name, seed: country.seed,
          metrics: audit.metrics, violations: audit.violations }));
        count += audit.violations.length;
      }
      return count;
    });
    if (failures) { console.error(`World audit failed: ${failures} violations`); process.exitCode = 1; }
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
