import { performance } from "node:perf_hooks";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb } from "../src/server/db";
import { GROWTH_DEMO_SEED, seedGrowthDemo } from "../src/server/fixtures/growth-demo";
import { auditWorld } from "../src/server/world/world-audit";
import { cellKey, contains } from "../src/server/world/grid";

const databasePath = process.env.DATABASE_PATH ?? "./data/tasktopia-growth.db";
const districtLimit = Number(process.env.GROWTH_DISTRICTS ?? 10);
const db = createDb(databasePath);
const existing = db.prepare("SELECT u.id, c.id AS country_id FROM users u JOIN countries c ON c.user_id = u.id WHERE u.email = ?")
  .get("growth@tasktopia.local") as { id: string; country_id: string } | undefined;
const registered = existing
  ? { user: { id: existing.id, email: "growth@tasktopia.local", name: "Growth Mayor", countryId: existing.country_id } }
  : await registerUser(db, { email: "growth@tasktopia.local", name: "Growth Mayor", password: "growth-demo-100" });
db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(GROWTH_DEMO_SEED, registered.user.countryId);
const service = new AppService(db);

const startedAt = performance.now();
const fixture = seedGrowthDemo(service, registered.user.countryId, districtLimit);
const generationMs = performance.now() - startedAt;
const audit = auditWorld(db, service, registered.user.countryId);
const roads = db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ?").all(registered.user.countryId) as Array<{ x: number; y: number }>;
const roadKeys = new Set(roads.map(cellKey));

function footprintRoadDistance(task: (typeof fixture.tasks)[number], limit = 8): number {
  for (let distance = 1; distance <= limit; distance += 1) {
    if (task.footprint.some((cell) => {
      for (let dx = -distance; dx <= distance; dx += 1) {
        const dy = distance - Math.abs(dx);
        if (roadKeys.has(cellKey({ x: cell.x + dx, y: cell.y + dy }))) return true;
        if (dy !== 0 && roadKeys.has(cellKey({ x: cell.x + dx, y: cell.y - dy }))) return true;
      }
      return false;
    })) return distance;
  }
  return limit + 1;
}

const footprintDistances = fixture.tasks.map((task) => footprintRoadDistance(task));
const entranceDistances = fixture.tasks.map((task) => task.accessPath.length);
const reachableEntranceDistances = entranceDistances.filter((distance) => distance <= 6);
const unreachableEntrances = audit.violations.filter((violation) => violation.code === "TASK_ENTRANCE_UNREACHABLE");
const city = fixture.city;
const districtSizes = fixture.districts.map((district) => district.cells.length);
const tasksInsideCity = fixture.tasks.every((task) => task.footprint.every((cell) => contains(city.bounds, cell)));
const result = {
  seed: GROWTH_DEMO_SEED,
  cities: audit.metrics.cities,
  districts: fixture.districts.length,
  tasks: fixture.tasks.length,
  cityBounds: city.bounds,
  citySize: { width: city.bounds.maxX - city.bounds.minX + 1, height: city.bounds.maxY - city.bounds.minY + 1 },
  districtCellRange: { min: Math.min(...districtSizes), max: Math.max(...districtSizes), total: districtSizes.reduce((sum, value) => sum + value, 0) },
  roads: audit.metrics.roads,
  bridges: audit.metrics.bridges,
  uniqueBuildingTypes: audit.metrics.uniqueBuildingTypes,
  taskStages: audit.metrics.taskStages,
  access: {
    footprintAdjacentToRoad: footprintDistances.filter((distance) => distance === 1).length,
    footprintNeedsOnePathCell: footprintDistances.filter((distance) => distance === 2).length,
    maximumFootprintRoadDistance: Math.max(...footprintDistances),
    entranceTouchesSidewalk: entranceDistances.filter((distance) => distance === 0).length,
    entranceNeedsPath: entranceDistances.filter((distance) => distance > 0 && distance <= 6).length,
    entranceUnreachable: unreachableEntrances.length,
    maximumReachableEntranceRoadDistance: Math.max(...reachableEntranceDistances),
    entrancePathLengthHistogram: Object.fromEntries(
      [...new Set(reachableEntranceDistances)].sort((left, right) => left - right)
        .map((distance) => [String(distance), reachableEntranceDistances.filter((value) => value === distance).length]),
    ),
    unreachableEntrances,
  },
  tasksInsideCity,
  generationMs: Math.round(generationMs),
  violations: audit.violations,
};

console.log(JSON.stringify(result, null, 2));
db.close();
if (audit.violations.length > 0 || fixture.tasks.length !== fixture.districts.length * 10 || !tasksInsideCity) process.exitCode = 1;
