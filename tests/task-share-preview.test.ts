import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { serializeRequest } from "../src/server/request-logging";
import cookie from "@fastify/cookie";
import { expect,it } from "vitest";
import { createTestDb } from "../src/server/db";
import { AppService } from "../src/server/app-service";
import { registerRoutes } from "../src/server/routes";
import { taskShareExcerpt } from "../src/shared/task-share-preview";
it("normalizes bounded Unicode excerpts without links or image destinations",()=>{
  expect(taskShareExcerpt("# Hello **world** [link](https://secret) ![x](private.png) <b>ok</b>")).toBe("Hello world link ok");
  expect(Array.from(taskShareExcerpt("🚀".repeat(250))).length).toBe(200);
});
it("publishes server HTML only explicitly and supports revocation and access removal",async()=>{
  const db=await createTestDb(),app=Fastify();
  try {
    await app.register(cookie);const service=new AppService(db);await registerRoutes(app,db,service);
    const response=await app.inject({method:"POST",url:"/api/auth/register",payload:{email:"share@example.com",name:"Share",password:"password-123",passwordConfirmation:"password-123",countryName:"Share country",cityName:"Share city"}});
    expect(response.statusCode).toBe(200);
    const raw=response.headers["set-cookie"]!;const session=(Array.isArray(raw)?raw[0]!:raw).split(";")[0]!;
    const bootstrap=(await app.inject({url:"/api/bootstrap",headers:{cookie:session}})).json();
    await service.createDistrict(bootstrap.country.id,{cityId:bootstrap.initialCity.id,name:"Share district",activate:true,idempotencyKey:"share-district"});
    const task=await service.createTask(bootstrap.country.id,{cityId:bootstrap.initialCity.id,title:'A "quoted" title <script>alert(1)</script>',description:"**Brief** "+"x".repeat(250)+"PRIVATE_TAIL",estimate:1,idempotencyKey:"share-task"});
    const payload={requestToken:randomBytes(32).toString("base64url"),countryId:bootstrap.country.id,taskId:task.id,preview:{taskNumber:task.taskNumber,title:taskShareExcerpt(task.title,120),description:taskShareExcerpt(task.description)}};
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",payload})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload:{...payload,countryId:crypto.randomUUID()}})).statusCode).toBe(403);
    const publish=async()=>{
      const result=await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session,host:"evil.example"},payload});
      expect(result.statusCode).toBe(200);expect(result.json().url).not.toContain("evil.example");return new URL(result.json().url).pathname;
    };
    const [url,repeated]=await Promise.all([publish(),publish()]);expect(repeated).toBe(url);
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM task_share_previews WHERE task_id=?").get(task.id)).toEqual({count:1});
    const html=await app.inject({url});expect(html.statusCode).toBe(200);
    expect(html.headers["cache-control"]).toBe("private, no-store");
    expect(html.body).toContain('property="og:title"');expect(html.body).toContain(`#${task.taskNumber}`);
    expect(html.body).toContain("&quot;quoted&quot;");expect(html.body).not.toContain("<script>");expect(html.body).not.toContain("PRIVATE_TAIL");
    expect(html.body).toContain('name="twitter:card"');expect(html.body).toContain(`/task/${task.taskNumber}?countryId=`);
    await db.prepare("UPDATE tasks_v3 SET description='NEW_PRIVATE_TEXT' WHERE id=?").run(task.id);
    expect((await app.inject({url})).body).not.toContain("NEW_PRIVATE_TEXT");
    const outsider=await app.inject({method:"POST",url:"/api/auth/register",payload:{email:"outsider-share@example.com",name:"Other",password:"password-123",passwordConfirmation:"password-123",countryName:"Other country",cityName:"Other city"}});
    expect(outsider.statusCode).toBe(200);
    const outsiderRaw=outsider.headers["set-cookie"]!;
    const outsiderCookie=(Array.isArray(outsiderRaw)?outsiderRaw[0]!:outsiderRaw).split(";")[0]!;
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:outsiderCookie},payload})).statusCode).toBe(403);
    await app.inject({method:"DELETE",url:`/api/task-share-previews?countryId=${payload.countryId}&taskId=${task.id}`,headers:{cookie:outsiderCookie}});
    expect((await app.inject({url})).statusCode).toBe(200);
    await app.inject({method:"DELETE",url:`/api/task-share-previews?countryId=${payload.countryId}&taskId=${task.id}`,headers:{cookie:session}});
    expect((await app.inject({url})).statusCode).toBe(404);
    expect((await app.inject({url})).body).not.toContain("quoted");
    const stale=await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload});
    expect(stale.statusCode).toBe(409);
    payload.preview.description=taskShareExcerpt("NEW_PRIVATE_TEXT");
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload})).statusCode).toBe(409);
    payload.requestToken=randomBytes(32).toString("base64url");
    const second=await publish();
    await db.prepare("DELETE FROM country_members WHERE user_id=? AND country_id=?").run(bootstrap.user.id,bootstrap.country.id);
    expect((await app.inject({url:second})).statusCode).toBe(404);
    expect((await app.inject({url:"/share/task/invalid"})).statusCode).toBe(404);
    await db.prepare("DELETE FROM tasks_v3 WHERE id=?").run(task.id);
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM task_share_previews WHERE task_id=?").get(task.id)).toEqual({count:0});
    expect((await app.inject({url:second})).statusCode).toBe(404);

  } finally {await app.close();await db.close();}
});

it("redacts share capability tokens in actual Fastify request logs",async()=>{
  let output="";
  const stream=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  const app=Fastify({logger:{level:"info",stream,serializers:{req:serializeRequest}}});
  try {
    app.get("/share/task/:token",()=>({ok:true}));
    const token="sensitive-capability-token";
    await app.inject({url:`/share/task/${token}`});
    expect(output).toContain("[REDACTED]");expect(output).not.toContain(token);
  } finally {await app.close();}
});
