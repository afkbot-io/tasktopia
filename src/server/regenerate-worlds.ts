import { AppService } from "./app-service";
import { config } from "./config";
import { createDb, transaction } from "./db";
import { auditWorld } from "./world/world-audit";
import { reconcileWorldRegeneration } from "./world-regeneration-runner";

type CountryRow = { id: string; name: string; seed: number };

async function main(): Promise<void> {
  const runId = process.env.REGENERATION_RUN_ID?.trim();
  if (!runId || !/^[a-zA-Z0-9._:-]{4,80}$/.test(runId)) {
    throw new Error("REGENERATION_RUN_ID is required (4-80 safe characters)");
  }
  const maxAttempts = Number(process.env.REGENERATION_MAX_ATTEMPTS ?? "3");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("REGENERATION_MAX_ATTEMPTS must be an integer from 1 to 10");
  }
  const forceValue = process.env.REGENERATION_FORCE?.trim() ?? "0";
  if (forceValue !== "0" && forceValue !== "1") {
    throw new Error("REGENERATION_FORCE must be 0 or 1");
  }
  const force = forceValue === "1";

  const db = await createDb(config.databaseUrl);
  const service = new AppService(db);
  const failures: Array<{ country: string; error: string }> = [];
  try {
    const countries = await db.prepare("SELECT id, name, seed FROM countries ORDER BY created_at, id").all<CountryRow>();
    console.log(JSON.stringify({ event: "world-regeneration.started", runId, countries: countries.length }));

    for (const [index, country] of countries.entries()) {
      try {
        const before = await auditWorld(db, service, country.id);
        const reconciliation = await reconcileWorldRegeneration(before.violations, maxAttempts, async (candidateAttempt) => (
          await transaction(db, async () => {
            const regenerated = await service.regenerateCountry(country.id, {
              confirmName: country.name,
              idempotencyKey: `release:${runId}:${country.id}:attempt:${candidateAttempt}`,
            });
            // The publishing service intentionally keeps chunk caches until the
            // outer transaction commits. Audit through a fresh reader so the
            // pre-commit validation observes the replacement geometry instead
            // of the previous world's cached chunks.
            const audit = await auditWorld(db, new AppService(db), country.id);
            if (audit.violations.length > 0) {
              throw new Error(`world audit failed: ${audit.violations.map((violation) => violation.code).join(", ")}`);
            }
            return { result: regenerated, after: audit };
          })
        ), (failedAttempt, error) => {
          console.warn(JSON.stringify({
            event: "world-regeneration.retrying",
            country: country.name,
            attempt: failedAttempt,
            nextAttempt: failedAttempt + 1,
            maxAttempts,
            error: error.message,
          }));
        }, force);
        if (reconciliation.status === "preserved") {
          console.log(JSON.stringify({
            event: "world-regeneration.preserved",
            index: index + 1,
            total: countries.length,
            country: country.name,
            seed: country.seed,
            violationsBefore: 0,
            reason: "existing-world-valid",
          }));
          continue;
        }
        const { attempt, value: { result, after } } = reconciliation;
        console.log(JSON.stringify({
          event: "world-regeneration.completed",
          index: index + 1,
          total: countries.length,
          country: country.name,
          attempts: attempt,
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
