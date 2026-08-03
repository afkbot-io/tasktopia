import { performance } from "node:perf_hooks";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb } from "../src/server/db";
import { GROWTH_DEMO_SEED, seedGrowthDemo } from "../src/server/fixtures/growth-demo";
import { auditWorld } from "../src/server/world/world-audit";
import { cellKey } from "../src/server/world/grid";

const db = createDb(":memory:");
const registered = await registerUser(db, {
  email: "growth-lifecycle@tasktopia.local",
  name: "Growth Lifecycle",
  password: "growth-lifecycle-100",
});
db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(GROWTH_DEMO_SEED, registered.user.countryId);
const service = new AppService(db);

type Snapshot = {
  tasks: Map<string, string>;
  districts: Map<string, string>;
  districtCells: Map<string, Set<string>>;
  roads: Set<string>;
};

function snapshot(): Snapshot {
  const tasks = service.listTasks(registered.user.countryId);
  const districts = service.listDistricts(registered.user.countryId);
  const roads = db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ?").all(registered.user.countryId) as Array<{ x: number; y: number }>;
  return {
    tasks: new Map(tasks.map((task) => [task.id, JSON.stringify({ origin: task.origin, footprint: task.footprint, buildingType: task.buildingType })])),
    districts: new Map(districts.map((district) => [district.id, JSON.stringify(district.cells)])),
    districtCells: new Map(districts.map((district) => [district.name, new Set(district.cells.map(cellKey))])),
    roads: new Set(roads.map(cellKey)),
  };
}

const results: Array<Record<string, unknown>> = [];
let previous: Snapshot | undefined;

for (const districtLimit of [2, 6, 10]) {
  const startedAt = performance.now();
  const fixture = seedGrowthDemo(service, registered.user.countryId, districtLimit);
  const generationMs = Math.round(performance.now() - startedAt);
  const audit = auditWorld(db, service, registered.user.countryId);
  const current = snapshot();
  const changedTasks = previous
    ? [...previous.tasks].filter(([id, value]) => current.tasks.get(id) !== value).map(([id]) => id)
    : [];
  const changedDistrictGeometry = previous
    ? [...previous.districts].filter(([id, value]) => current.districts.get(id) !== value).map(([id]) => id)
    : [];
  const newRoads = previous ? [...current.roads].filter((key) => !previous!.roads.has(key)) : [];
  const newRoadsInsidePreviousDistricts = previous
    ? Object.fromEntries([...previous.districtCells].map(([name, cells]) => [name, newRoads.filter((key) => cells.has(key)).length]))
    : {};
  results.push({
    checkpointTasks: fixture.tasks.length,
    districts: fixture.districts.length,
    districtStatuses: Object.fromEntries(fixture.districts.map((district) => [district.name, district.status])),
    cityBounds: fixture.city.bounds,
    roads: current.roads.size,
    newRoads: newRoads.length,
    newRoadsInsidePreviousDistricts,
    changedTasks,
    changedDistrictGeometry,
    generationMs,
    violations: audit.violations,
  });
  previous = current;
}

console.log(JSON.stringify({ seed: GROWTH_DEMO_SEED, checkpoints: results }, null, 2));
db.close();
if (results.some((result) => {
  const intrusions = Object.values(result.newRoadsInsidePreviousDistricts as Record<string, number>);
  return (result.violations as unknown[]).length > 0
    || (result.changedTasks as string[]).length > 0
    || (result.changedDistrictGeometry as string[]).length > 0
    || intrusions.some((count) => count > 0);
})) {
  process.exitCode = 1;
}
