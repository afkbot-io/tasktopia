import { AppService } from "./app-service";
import { config } from "./config";
import { createDb } from "./db";
import { auditWorld } from "./world/world-audit";

type CountryRow = { id: string; name: string; seed: number };

async function main(): Promise<void> {
  const runId = process.env.REGENERATION_RUN_ID?.trim();
  if (!runId || !/^[a-zA-Z0-9._:-]{4,80}$/.test(runId)) {
    throw new Error("REGENERATION_RUN_ID is required (4-80 safe characters)");
  }

  const db = await createDb(config.databaseUrl);
  const service = new AppService(db);
  const failures: Array<{ country: string; error: string }> = [];
  try {
    const countries = await db.prepare("SELECT id, name, seed FROM countries ORDER BY created_at, id").all<CountryRow>();
    console.log(JSON.stringify({ event: "world-regeneration.started", runId, countries: countries.length }));

    for (const [index, country] of countries.entries()) {
      try {
        const before = await auditWorld(db, service, country.id);
        const result = await service.regenerateCountry(country.id, {
          confirmName: country.name,
          idempotencyKey: `release:${runId}:${country.id}`,
        });
        const after = await auditWorld(db, service, country.id);
        if (after.violations.length > 0) {
          throw new Error(`world audit failed: ${after.violations.map((violation) => violation.code).join(", ")}`);
        }
        console.log(JSON.stringify({
          event: "world-regeneration.completed",
          index: index + 1,
          total: countries.length,
          country: country.name,
          previousSeed: country.seed,
          seed: result.seed,
          cities: result.cities,
          districts: result.districts,
          tasks: result.tasks,
          violationsBefore: before.violations.length,
          violationsAfter: after.violations.length,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ country: country.name, error: message });
        console.error(JSON.stringify({ event: "world-regeneration.failed", country: country.name, error: message }));
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length}/${countries.length} world regenerations failed`);
    }
    console.log(JSON.stringify({ event: "world-regeneration.finished", runId, countries: countries.length }));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
