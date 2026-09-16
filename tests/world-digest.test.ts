import Fastify from "fastify";
import cookiePlugin from "@fastify/cookie";
import { expect, it } from "vitest";
import { createTestDb } from "../src/server/db";
import { AppService } from "../src/server/app-service";
import { registerRoutes } from "../src/server/routes";
import { readWorldDigest } from "../src/server/world-digest-read";
it("bounds the digest, joins current ownership and rejects anonymous or foreign access", async () => {
  const db = await createTestDb(); const app = Fastify();
  try {
    await app.register(cookiePlugin); const service = new AppService(db); await registerRoutes(app,db,service);
    const registered = await app.inject({ method:"POST", url:"/api/auth/register", payload:{email:"digest@example.com",name:"Digest",password:"password-123",passwordConfirmation:"password-123",countryName:"Digest",cityName:"Digest city"} });
    expect(registered.statusCode).toBe(200);
    const raw = registered.headers["set-cookie"]!; const cookie = (Array.isArray(raw)?raw[0]!:raw).split(";")[0]!;
    const bootstrap = (await app.inject({url:"/api/bootstrap",headers:{cookie}})).json();
    const countryId = bootstrap.country.id, userId = bootstrap.user.id;
    const url = `/api/world-digest?countryId=${countryId}`;
    const baseline = await app.inject({url,headers:{cookie}});
    expect(baseline.headers["cache-control"]).toBe("private, no-store");
    expect(Math.abs(Number(baseline.headers["x-tasktopia-server-time"])-Date.now())).toBeLessThan(1000);
    expect(baseline.json()).toMatchObject({baseline:true,items:[]});
    expect((await app.inject({url})).statusCode).toBe(401);
    expect((await app.inject({url:url.replace(countryId,crypto.randomUUID()),headers:{cookie}})).statusCode).toBe(403);
    expect((await app.inject({url:url+"&after=-1",headers:{cookie}})).statusCode).toBe(400);
    expect((await app.inject({url:"/api/world-digest",headers:{cookie}})).statusCode).toBe(400);
    await service.createDistrict(countryId,{cityId:bootstrap.initialCity.id,name:"District",activate:true,idempotencyKey:"digest-district"});
    const task = await service.createTask(countryId,{cityId:bootstrap.initialCity.id,title:"Current title",estimate:1,idempotencyKey:"digest-task"});
    await db.prepare(`INSERT INTO events(country_id,type,world_version,payload_json,created_at)
      SELECT ?,'task.defect_created',1,?::jsonb,CURRENT_TIMESTAMP FROM generate_series(1,1005)`).run(countryId,JSON.stringify({taskId:task.id,building:{title:"OLD_SECRET_TITLE"}}));
    const digest = (await app.inject({url:url+`&after=${baseline.json().cursor}`,headers:{cookie}})).json();
    expect(digest).toMatchObject({baseline:false,truncated:true,totals:{COMPLETED:0,DEFECT:1000,OPENED:0}});
    expect(digest.items).toHaveLength(1);
    expect(digest.items[0]).toMatchObject({taskId:task.id,title:"Current title",kind:"DEFECT",count:1000});
    expect(JSON.stringify(digest)).not.toContain("OLD_SECRET_TITLE");
    expect((await readWorldDigest(db,userId,countryId,digest.cursor))!.items).toEqual([]);
    // Read-model fixture: distinct task identities without running unrelated terrain generation.
    await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,
      to_jsonb(t)||jsonb_build_object('id','digest-fixture-'||n,'task_number',1000+n,'title','Task '||n))).*
      FROM tasks_v3 t CROSS JOIN generate_series(1,26) n WHERE t.id=?`).run(task.id);
    await db.prepare(`INSERT INTO events(country_id,type,world_version,payload_json,created_at)
      SELECT ?,'task.status_changed',1,jsonb_build_object('taskId','digest-fixture-'||n,'status','COMPLETED'),CURRENT_TIMESTAMP
      FROM generate_series(1,26) n`).run(countryId);
    const many = (await readWorldDigest(db,userId,countryId,digest.cursor))!;
    expect(many.items).toHaveLength(20);
    expect(many.totals.COMPLETED).toBe(26);
    await db.prepare("DELETE FROM tasks_v3 WHERE id LIKE 'digest-fixture-%'").run();
    await db.prepare("UPDATE tasks_v3 SET service_role='RAILWAY' WHERE id=?").run(task.id);
    await db.prepare("INSERT INTO events(country_id,type,world_version,payload_json,created_at) VALUES (?,'task.status_changed',1,?::jsonb,CURRENT_TIMESTAMP)").run(countryId,JSON.stringify({taskId:task.id,status:"COMPLETED"}));
    expect((await readWorldDigest(db,userId,countryId,digest.cursor))!.items[0]!.kind).toBe("OPENED");
    await db.prepare("UPDATE events SET created_at=CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE country_id=?").run(countryId);
    expect((await readWorldDigest(db,userId,countryId,0))!.items).toEqual([]);
    await db.prepare("UPDATE events SET created_at=CURRENT_TIMESTAMP WHERE country_id=?").run(countryId);
    await service.deleteTask(countryId,{taskId:task.id,confirmTitle:task.title,idempotencyKey:"digest-delete"});
    expect((await readWorldDigest(db,userId,countryId,0))!.items).toEqual([]);
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(countryId,userId);
    expect((await app.inject({url,headers:{cookie}})).statusCode).toBe(401);
    expect(await readWorldDigest(db,userId,countryId,0)).toBeUndefined();
  } finally { await app.close(); await db.close(); }
});
