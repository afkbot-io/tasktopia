/** Read-only export of the already isolated release-capacity fixtures.
 * Never creates a schema, migrates, seeds, updates statistics or changes rows. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDb, type Row } from "../src/server/db";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import type { BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";
import { TASK_STAGE, type TaskStatus, type Rect } from "../src/shared/contracts";
import type { ConstructionStage } from "../src/shared/block-world";

const tier = process.env.SPRINT_REPLAY_TIER ?? "b";
if (tier !== "b" && tier !== "c") throw new Error("Only the existing isolated B/C fixtures may be exported");
const fixtures = {
  b: { schema: "release_perf_20260905_b", cityId: "181bd20d-0c66-40c2-9a8e-e41672b60e96", nextTaskNumber: 221 },
  c: { schema: "release_perf_20260905_c", cityId: "0c81f626-fb9f-4dc8-9e81-5abbc79c145f", nextTaskNumber: 967 },
} as const;
const fixture = fixtures[tier];
const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_test") || url.search) {
  throw new Error("Export requires an explicit local test database without connection overrides");
}
const db = await createDb(url.toString(), { schema: fixture.schema, migrate: false, maxConnections: 1 });
try {
  const replay = await db.transaction(async () => {
    await db.exec("SET TRANSACTION READ ONLY");
    const city = await db.prepare(`SELECT city.id,city.country_id,city.center_x,city.center_y,country.seed
      FROM cities_v3 city JOIN countries country ON country.id=city.country_id WHERE city.id=?`).get<Row>(fixture.cityId);
    if (!city) throw new Error("The expected existing fixture city is absent");
    const previous = await readActiveBlockLayout(db, fixture.cityId);
    if (!previous) throw new Error("The fixture has no active layout");
    const tasks = await db.prepare(`SELECT id,district_id,task_number,status,visual_kind,visual_asset_key,visual_auto,
      building_type,requested_building_family FROM tasks_v3 WHERE city_id=? ORDER BY task_number,id`).all<Row>(fixture.cityId);
    const districts = await db.prepare("SELECT id,archetype FROM districts_v3 WHERE city_id=? ORDER BY created_at,id").all<Row>(fixture.cityId);
    const otherCities = await db.prepare("SELECT bounds_json FROM city_layouts_v1 WHERE country_id=? AND city_id<>? AND status='ACTIVE'")
      .all<{ bounds_json: Rect }>(city.country_id, fixture.cityId);
    const input: BlockLayoutCompilerInput = {
      countryId: String(city.country_id), cityId: fixture.cityId, seed: Number(city.seed), revision: previous.revision + 1,
      origin: { x: Number(city.center_x), y: Number(city.center_y) }, previous,
      districts: districts.map(district => ({
        id: String(district.id), archetype: String(district.archetype),
        sequence: previous.districtLayouts.find(layout => layout.districtId === district.id)!.sequence,
        tasks: tasks.filter(task => task.district_id === district.id).map(task => ({
          id: String(task.id), taskNumber: Number(task.task_number), buildingFamily: String(task.building_type),
          facadeVariant: "south", autoVisualKind: Boolean(task.visual_auto),
          ...(task.requested_building_family ? { requestedFamily: String(task.requested_building_family) } : {}),
          constructionStage: TASK_STAGE[String(task.status) as TaskStatus] as ConstructionStage,
          visualKind: task.visual_kind === "PARK" ? task.visual_asset_key === "urban-lake" ? "WATER"
            : task.visual_asset_key === "urban-parking" ? "PARKING" : "PARK" : "BUILDING",
        })),
      })),
    };
    return { fixture: `release-capacity-${tier}`, source: "existing isolated local fixture; read-only transaction",
      nextTaskNumber: fixture.nextTaskNumber, otherCityBounds: otherCities.map(city => city.bounds_json), input };
  });
  const output = resolve(`tests/fixtures/sprint-layout-${tier}.json`);
  await writeFile(output, `${JSON.stringify(replay)}\n`);
  console.log(JSON.stringify({ output, districts: replay.input.districts.length,
    tasks: replay.input.districts.reduce((count, district) => count + district.tasks.length, 0),
    blocks: replay.input.previous!.blocks.length, schema: fixture.schema }));
} finally {
  await db.close();
}
