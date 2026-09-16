import type { FastifyInstance } from "fastify";
import { createHash,randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db";
import { requireUser } from "./auth";
import { config } from "./config";
import { taskShareExcerpt } from "../shared/task-share-preview";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
const scope=z.object({countryId:z.string().uuid(),taskId:z.string().uuid()});
const publication=scope.extend({requestToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),preview:z.object({taskNumber:z.number().int().positive(),title:z.string().max(240),description:z.string().max(400)})});
export async function registerTaskShareRoutes(app:FastifyInstance,db:Db):Promise<void> {
  app.post("/api/task-share-previews",async(request,reply)=>{
    const user=await requireUser(db,request,reply);if(!user)return;
    const parsed=publication.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_SHARE"});
    const {countryId,taskId}=parsed.data;
    const token=parsed.data.requestToken ?? randomBytes(32).toString("base64url");
    // Publishing is explicit. Store only the excerpt approved at this moment;
    // subsequent private edits do not silently republish themselves.
    const row=await db.prepare(`SELECT t.task_number,t.title,t.description FROM tasks_v3 t
      JOIN cities_v3 city ON city.id=t.city_id
      JOIN country_members member ON member.country_id=city.country_id AND member.user_id=?
      WHERE t.id=? AND city.country_id=?`).get<{task_number:number;title:string;description:string}>(user.id,taskId,countryId);
    if(!row)return reply.code(403).send({error:"FORBIDDEN"});
    const approved=parsed.data.preview;
    if(approved.taskNumber!==row.task_number || approved.title!==taskShareExcerpt(row.title,120) || approved.description!==taskShareExcerpt(row.description))
      return reply.code(409).send({error:"PREVIEW_CHANGED",message:"Задача изменилась. Откройте её заново и проверьте превью перед публикацией."});
    await db.prepare(`INSERT INTO task_share_previews(token_hash,task_id,publisher_id,country_id,task_number,title,description)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(token_hash) DO NOTHING`).run(hash(token),taskId,user.id,countryId,row.task_number,taskShareExcerpt(row.title,120),taskShareExcerpt(row.description));
    const stored=await db.prepare(`SELECT task_id,publisher_id,country_id,title,description,revoked_at FROM task_share_previews WHERE token_hash=?`)
      .get<{task_id:string;publisher_id:string;country_id:string;title:string;description:string;revoked_at:string|null}>(hash(token));
    if(!stored || stored.revoked_at || stored.task_id!==taskId || stored.publisher_id!==user.id || stored.country_id!==countryId
      || stored.title!==approved.title || stored.description!==approved.description)
      return reply.code(409).send({error:"SHARE_REQUEST_CONFLICT",message:"Эта ссылка уже отозвана или относится к другой публикации. Создайте новое превью."});
    return reply.header("Cache-Control","private, no-store").send({url:`${config.APP_ORIGIN}/share/task/${token}`});
  });
  app.delete("/api/task-share-previews",async(request,reply)=>{
    const user=await requireUser(db,request,reply);if(!user)return;
    const parsed=scope.safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:"INVALID_SHARE"});
    await db.prepare(`UPDATE task_share_previews SET revoked_at=now() WHERE task_id=? AND country_id=? AND publisher_id=? AND revoked_at IS NULL`)
      .run(parsed.data.taskId,parsed.data.countryId,user.id);
    return reply.header("Cache-Control","private, no-store").send({revoked:true});
  });
  app.get<{Params:{token:string}}>("/share/task/:token",async(request,reply)=>{
    const token=request.params.token;
    const row=/^[A-Za-z0-9_-]{43}$/.test(token) ? await db.prepare(`SELECT s.* FROM task_share_previews s
      JOIN country_members member ON member.user_id=s.publisher_id AND member.country_id=s.country_id
      JOIN tasks_v3 t ON t.id=s.task_id JOIN cities_v3 city ON city.id=t.city_id AND city.country_id=s.country_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL`).get<{task_id:string;country_id:string;task_number:number;title:string;description:string}>(hash(token)) : undefined;
    const title=row?`#${row.task_number} · ${row.title}`:"Tasktopia · ссылка недоступна";
    const description=row?.description||"Откройте Tasktopia, чтобы просмотреть доступные вам задачи.";
    const url=`${config.APP_ORIGIN}/share/task/${token}`;
    const target=row?`${config.APP_ORIGIN}/task/${row.task_number}?countryId=${encodeURIComponent(row.country_id)}&taskId=${encodeURIComponent(row.task_id)}`:config.APP_ORIGIN;
    return reply.code(row?200:404).type("text/html; charset=utf-8").header("Cache-Control","private, no-store")
      .header("X-Robots-Tag","noindex, nofollow").header("Referrer-Policy","no-referrer")
      .send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="/share-preview.css"><meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"></head><body><main><h1>${escape(title)}</h1><p>${escape(description)}</p><a href="${escape(target)}">Открыть Tasktopia</a></main></body></html>`);
  });
}
