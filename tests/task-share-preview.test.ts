import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { serializeRequest } from "../src/server/request-logging";
import cookie from "@fastify/cookie";
import { expect,it } from "vitest";
import { createTestDb } from "../src/server/db";
import { AppService } from "../src/server/app-service";
import { registerRoutes } from "../src/server/routes";
import { taskShareImageSvg } from "../src/server/task-share-image";
import { taskShareExcerpt, taskSharePublicText } from "../src/shared/task-share-preview";
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
    expect(html.body).not.toContain("Share country"); expect(html.body).not.toContain("Share city");
    expect(html.body).toContain('name="twitter:card"');expect(html.body).toContain(`/task/${task.taskNumber}?countryId=`);
    const memberLink = await app.inject({url,headers:{cookie:session}});
    expect(memberLink.statusCode).toBe(302);
    expect(memberLink.headers["location"]).toContain(`/task/${task.taskNumber}?countryId=${bootstrap.country.id}&taskId=${task.id}`);
    expect(memberLink.headers["cache-control"]).toBe("private, no-store");
    expect(memberLink.body).not.toContain("PRIVATE_TAIL");
    await db.prepare("UPDATE tasks_v3 SET description='NEW_PRIVATE_TEXT' WHERE id=?").run(task.id);
    expect((await app.inject({url})).body).not.toContain("NEW_PRIVATE_TEXT");
    const outsider=await app.inject({method:"POST",url:"/api/auth/register",payload:{email:"outsider-share@example.com",name:"Other",password:"password-123",passwordConfirmation:"password-123",countryName:"Other country",cityName:"Other city"}});
    expect(outsider.statusCode).toBe(200);
    const outsiderRaw=outsider.headers["set-cookie"]!;
    const outsiderCookie=(Array.isArray(outsiderRaw)?outsiderRaw[0]!:outsiderRaw).split(";")[0]!;
    expect((await app.inject({url,headers:{cookie:outsiderCookie}})).statusCode).toBe(200);
    expect((await app.inject({url,headers:{cookie:"tasktopia_session=expired"}})).statusCode).toBe(200);
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:outsiderCookie},payload})).statusCode).toBe(403);
    await app.inject({method:"DELETE",url:`/api/task-share-previews?countryId=${payload.countryId}&taskId=${task.id}`,headers:{cookie:outsiderCookie}});
    expect((await app.inject({url})).statusCode).toBe(200);
    await app.inject({method:"DELETE",url:`/api/task-share-previews?countryId=${payload.countryId}&taskId=${task.id}`,headers:{cookie:session}});
    expect((await app.inject({url})).statusCode).toBe(404);
    expect((await app.inject({url})).body).not.toContain("quoted");
    expect((await app.inject({url,headers:{cookie:session}})).statusCode).toBe(404);
    const stale=await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload});
    expect(stale.statusCode).toBe(409);
    payload.preview.description=taskShareExcerpt("NEW_PRIVATE_TEXT");
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload})).statusCode).toBe(409);
    payload.requestToken=randomBytes(32).toString("base64url");
    const second=await publish();
    await db.prepare("DELETE FROM country_members WHERE user_id=? AND country_id=?").run(bootstrap.user.id,bootstrap.country.id);
    expect((await app.inject({url:second})).statusCode).toBe(404);
    expect((await app.inject({url:`${second}/image.png`})).statusCode).toBe(404);
    expect((await app.inject({url:"/share/task/invalid"})).statusCode).toBe(404);
    await db.prepare("DELETE FROM tasks_v3 WHERE id=?").run(task.id);
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM task_share_previews WHERE task_id=?").get(task.id)).toEqual({count:0});
    expect((await app.inject({url:second})).statusCode).toBe(404);
    expect((await app.inject({url:`${second}/image.png`})).statusCode).toBe(404);

  } finally {await app.close();await db.close();}
});

it("redacts share capability tokens in actual Fastify request logs",async()=>{
  let output="";
  const stream=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  const app=Fastify({logger:{level:"info",stream,serializers:{req:serializeRequest}}});
  try {
    app.get("/share/task/:token",()=>({ok:true}));
    app.get("/share/task/:token/image.png",()=>({ok:true}));
    const token="sensitive-capability-token";
    await app.inject({url:`/share/task/${token}`});
    await app.inject({url:`/share/task/${token}/image.png`});
    expect(output).toContain("[REDACTED]");expect(output).not.toContain(token);
  } finally {await app.close();}
});

it("publishes selected geography and a revocable PNG without exposing hidden context", async () => {
  const db = await createTestDb(), app = Fastify();
  try {
    await app.register(cookie); const service = new AppService(db); await registerRoutes(app, db, service);
    const registered = await app.inject({method:"POST",url:"/api/auth/register",payload:{email:"og-geo@example.com",name:"OG",password:"password-123",passwordConfirmation:"password-123",countryName:"Страна теста",cityName:"Город теста"}});
    const raw = registered.headers["set-cookie"]!; const session = (Array.isArray(raw)?raw[0]!:raw).split(";")[0]!;
    const b = (await app.inject({url:"/api/bootstrap",headers:{cookie:session}})).json();
    await service.createDistrict(b.country.id,{cityId:b.initialCity.id,name:"Тайный район",activate:true,idempotencyKey:"og-district"});
    const task = await service.createTask(b.country.id,{cityId:b.initialCity.id,title:"Новая библиотека",description:"Открываем библиотеку. mail@example.com https://private.example token=supersecret",estimate:1,idempotencyKey:"og-task"});
    const query = `countryId=${b.country.id}&taskId=${task.id}`;
    expect((await app.inject({url:`/api/task-share-previews?${query}`})).statusCode).toBe(401);
    const draft = await app.inject({url:`/api/task-share-previews?${query}`,headers:{cookie:session}});
    expect(draft.statusCode).toBe(200);
    const preview = draft.json();
    expect(preview.location).toEqual({country:"Страна теста",city:"Город теста",district:"Тайный район"});
    expect(preview.description).not.toMatch(/mail@example|private.example|supersecret/);
    preview.location.district = null; preview.description = "Книги для всех";
    const payload = {countryId:b.country.id,taskId:task.id,requestToken:randomBytes(32).toString("base64url"),preview};
    const published = await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload});
    expect(published.statusCode).toBe(200);
    const path = new URL(published.json().url).pathname;
    const html = await app.inject({url:path});
    expect(html.body).toContain("Страна теста"); expect(html.body).toContain("Город теста"); expect(html.body).not.toContain("Тайный район");
    expect(html.body).toContain('property="og:image"'); expect(html.body).toContain('content="summary_large_image"');
    const png = await app.inject({url:`${path}/image.png`});
    expect(png.statusCode).toBe(200); expect(png.headers["content-type"]).toContain("image/png");
    expect(png.rawPayload.subarray(1,4).toString()).toBe("PNG");
    expect(png.rawPayload.readUInt32BE(16)).toBe(1200); expect(png.rawPayload.readUInt32BE(20)).toBe(630);
    await db.prepare("UPDATE cities_v3 SET name='PRIVATE_RENAME' WHERE id=?").run(b.initialCity.id);
    expect((await app.inject({url:path})).body).not.toContain("PRIVATE_RENAME");
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload})).json().url).toBe(published.json().url);
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload:{...payload,preview:{...preview,description:"Changed"}}})).statusCode).toBe(409);
    expect((await app.inject({method:"POST",url:"/api/task-share-previews",headers:{cookie:session},payload:{...payload,requestToken:randomBytes(32).toString("base64url"),preview:{...preview,location:{...preview.location,city:"Forged"}}}})).statusCode).toBe(409);
    await app.inject({method:"DELETE",url:`/api/task-share-previews?${query}`,headers:{cookie:session}});
    expect((await app.inject({url:path})).statusCode).toBe(404);
    expect((await app.inject({url:`${path}/image.png`})).statusCode).toBe(404);
  } finally { await app.close(); await db.close(); }
});

it("redacts common sensitive text before truncation and escapes image markup",()=>{
  expect(taskSharePublicText('[Документ](https://private.example/a) email@example.com пароль=hidden api_key=secret Bearer abcdef')).toBe('Документ [email скрыт] [секрет скрыт] [секрет скрыт] [секрет скрыт]');
  expect(taskSharePublicText("Authorization: Bearer secret-token")).toBe("[секрет скрыт]");
  expect(taskSharePublicText('<script>secret</script> Добрый день\u202e')).toBe('Добрый день');
  const svg=taskShareImageSvg({taskNumber:12,title:'<image href="https://evil">',description:'<script>bad</script>',location:{country:null,city:null,district:null}});
  expect(svg).not.toContain('<image');expect(svg).not.toContain('<script>');expect(svg).not.toContain('СТРАНА');
});
