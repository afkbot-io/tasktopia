import { performance } from "node:perf_hooks";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { seedDenseDemo } from "../src/server/fixtures/dense-demo";
import { createDb } from "../src/server/db";
import { auditWorld, type WorldAuditViolation } from "../src/server/world/world-audit";

const seeds = (process.env.REVIEW_SEEDS ?? "1,7,42,99,777,4096,65537,123456,424242,999983")
  .split(",")
  .map(Number)
  .filter(Number.isInteger);

const results: Array<{
  seed: number;
  generationMs: number;
  roads?: number;
  bridges?: number;
  uniqueBuildingTypes?: number;
  violations: WorldAuditViolation[];
}> = [];

for (const seed of seeds) {
  const db = createDb(":memory:");
  const violations: WorldAuditViolation[] = [];
  const startedAt = performance.now();
  try {
    const registered = await registerUser(db, {
      email: `soak-${seed}@tasktopia.local`,
      name: `Soak ${seed}`,
      password: "soak-password-123",
    });
    db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(seed, registered.user.countryId);
    const service = new AppService(db);
    seedDenseDemo(service, registered.user.countryId);
    const audit = auditWorld(db, service, registered.user.countryId);
    violations.push(...audit.violations);
    if (audit.metrics.cities !== 3 || audit.metrics.districts !== 9 || audit.metrics.tasks !== 90) {
      violations.push({ code: "ENTITY_COUNTS", message: `${audit.metrics.cities}/${audit.metrics.districts}/${audit.metrics.tasks}` });
    }
    if (audit.metrics.uniqueBuildingTypes < 20) {
      violations.push({ code: "LOW_BUILDING_DIVERSITY", message: `Только ${audit.metrics.uniqueBuildingTypes} типов` });
    }
    results.push({
      seed,
      generationMs: Math.round(performance.now() - startedAt),
      roads: audit.metrics.roads,
      bridges: audit.metrics.bridges,
      uniqueBuildingTypes: audit.metrics.uniqueBuildingTypes,
      violations,
    });
  } catch (error) {
    violations.push({ code: "GENERATION_FAILED", message: error instanceof Error ? error.message : String(error) });
    results.push({ seed, generationMs: Math.round(performance.now() - startedAt), violations });
  } finally {
    db.close();
  }
}

const failed = results.filter((result) => result.violations.length > 0);
console.log(JSON.stringify({
  seeds: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  totalGenerationMs: results.reduce((sum, result) => sum + result.generationMs, 0),
  maximumGenerationMs: Math.max(...results.map((result) => result.generationMs)),
  results,
}, null, 2));
if (failed.length > 0) process.exitCode = 1;

