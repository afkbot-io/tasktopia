import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestDb, transaction } from "../src/server/db";
import { registerUser } from "../src/server/auth";

it("upgrades the populated pre-world schema without moving tasks or rewriting history", async () => {
  const db = await createTestDb(), schema = `world_upgrade_${randomUUID().replaceAll("-", "")}`;
  const directory = join(process.cwd(), "migrations/postgres");
  const files = (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  try {
    await transaction(db, async () => {
      await db.exec(`CREATE SCHEMA "${schema}"`);
      await db.exec(`SET LOCAL search_path TO "${schema}"`);
      for (const file of files.filter(name => name < "0030_")) await db.exec(await readFile(join(directory, file), "utf8"));
      const { user } = await registerUser(db, { email: "upgrade@example.test", name: "Upgrade", password: "migration-password" });
      const city = randomUUID(), district = randomUUID(), task = randomUUID(), timestamp = new Date().toISOString();
      await db.prepare(`INSERT INTO cities_v3(id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
        VALUES (?,?,'Preserved city','ACTIVE',13,27,'{"minX":-8,"minY":4,"maxX":64,"maxY":96}'::jsonb,'old',?)`).run(city,user.countryId,timestamp);
      await db.prepare(`INSERT INTO districts_v3(id,city_id,name,status,spatial_bounds_json,growth_direction,color,created_at)
        VALUES (?,?,'Preserved district','ACTIVE','{"minX":13,"minY":27,"maxX":20,"maxY":35}'::jsonb,'E','#fff',?)`).run(district,city,timestamp);
      await db.prepare(`INSERT INTO tasks_v3(id,task_number,city_id,district_id,title,description,estimate,status,progress,
        building_type,platform_type,visual_kind,visual_asset_key,work_item_type,created_at,updated_at)
        VALUES (?,85,?,?,'Preserved task','Original text',3,'TESTING',90,'compact-apartment-v1','YARD',
        'BUILDING','compact-apartment-v1','HOTFIX',?,?)`).run(task,city,district,timestamp,timestamp);
      await db.prepare("INSERT INTO task_comments_v3(id,task_id,body,actor,created_at) VALUES (?,?,'Original comment','Tester',?)").run(randomUUID(),task,timestamp);
      await db.prepare("INSERT INTO task_events_v7(task_id,actor_label,event_type,details_json,created_at) VALUES (?,'Tester','STATUS_CHANGED','{}'::jsonb,?)").run(task,timestamp);
      await db.prepare("INSERT INTO task_defects_v18(id,task_id,title,status,created_at,updated_at) VALUES (?,?,'Original defect','VERIFYING',?,?)").run(randomUUID(),task,timestamp,timestamp);
      const tables = ["users","countries","country_members","cities_v3","districts_v3","tasks_v3","task_comments_v3","task_events_v7","task_defects_v18","events"];
      const snapshot = async () => Promise.all(tables.map(table => db.prepare(
        `SELECT to_jsonb(t) - 'terrain_profile_json' AS row FROM "${table}" t ORDER BY (to_jsonb(t) - 'terrain_profile_json')::text`).all()));
      const before = await snapshot();
      for (const file of files.filter(name => name >= "0030_")) await db.exec(await readFile(join(directory, file), "utf8"));
      expect(await snapshot()).toEqual(before);
      expect(await db.prepare("SELECT terrain_profile_json FROM countries WHERE id=?").get(user.countryId)).toEqual({ terrain_profile_json: null });
      for (const table of ["personal_planet_geography_v1","city_railway_corridors_v1","task_share_previews"])
        expect(await db.prepare(`SELECT count(*)::int AS count FROM "${table}"`).get()).toEqual({ count: 0 });
      await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await db.exec(`DROP SCHEMA "${schema}" CASCADE`);
    });
  } finally { await db.close(); }
});
