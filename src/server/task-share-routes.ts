import type { FastifyInstance, FastifyReply } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db";
import { requireUser } from "./auth";
import { config } from "./config";
import { taskShareExcerpt, taskSharePublicText, taskShareLocationText, type TaskShareDraft } from "../shared/task-share-preview";
import { escapeShareHtml as escape, taskShareImage } from "./task-share-image";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const scope = z.object({countryId:z.string().uuid(),taskId:z.string().uuid()});
const location = z.object({country:z.string().max(120).nullable(),city:z.string().max(120).nullable(),district:z.string().max(120).nullable()}).strict();
const base = z.object({taskNumber:z.number().int().positive(),title:z.string().max(240),description:z.string().max(400)});
const publication = scope.extend({requestToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),preview:z.union([base.extend({version:z.literal(2),location}).strict(),base.strict()])});
type Source = {task_number:number;title:string;description:string;country_name:string|null;city_name:string|null;district_name:string|null};
type Snapshot = Source & {task_id:string;country_id:string;publisher_id:string;revoked_at:string|null};
const headers = (reply: FastifyReply) => reply.header("Cache-Control","private, no-store").header("X-Robots-Tag","noindex, nofollow").header("Referrer-Policy","no-referrer").header("X-Content-Type-Options","nosniff");
const publicLocation = (row: Source) => ({country:row.country_name,city:row.city_name,district:row.district_name});
export async function registerTaskShareRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const source = (userId:string,countryId:string,taskId:string) => db.prepare(`SELECT t.task_number,t.title,t.description,c.name AS country_name,city.name AS city_name,d.name AS district_name
    FROM tasks_v3 t JOIN cities_v3 city ON city.id=t.city_id JOIN countries c ON c.id=city.country_id
    LEFT JOIN districts_v3 d ON d.id=t.district_id
    JOIN country_members member ON member.country_id=city.country_id AND member.user_id=?
    WHERE t.id=? AND city.country_id=?`).get<Source>(userId,taskId,countryId);
  const snapshot = (token:string) => /^[A-Za-z0-9_-]{43}$/.test(token) ? db.prepare(`SELECT s.task_id,s.country_id,s.publisher_id,s.task_number,s.title,s.description,s.country_name,s.city_name,s.district_name,s.revoked_at
    FROM task_share_previews s
    JOIN country_members member ON member.user_id=s.publisher_id AND member.country_id=s.country_id
    JOIN tasks_v3 t ON t.id=s.task_id JOIN cities_v3 city ON city.id=t.city_id AND city.country_id=s.country_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL`).get<Snapshot>(hash(token)) : Promise.resolve(undefined);
  app.get("/api/task-share-previews",async(request,reply)=>{
    headers(reply);
    const user=await requireUser(db,request,reply);if(!user)return;
    const parsed=scope.safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:"INVALID_SHARE"});
    const row=await source(user.id,parsed.data.countryId,parsed.data.taskId);if(!row)return reply.code(403).send({error:"FORBIDDEN"});
    return reply.send({version:2,taskNumber:row.task_number,title:taskSharePublicText(row.title,120),description:taskSharePublicText(row.description),location:{country:taskSharePublicText(row.country_name??"",80),city:taskSharePublicText(row.city_name??"",80),district:row.district_name?taskSharePublicText(row.district_name,80):null}} satisfies TaskShareDraft);
  });
  app.post("/api/task-share-previews",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request,reply)=>{
    headers(reply);
    const user=await requireUser(db,request,reply);if(!user)return;
    const parsed=publication.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_SHARE"});
    const {countryId,taskId,preview:approved}=parsed.data;
    const token=parsed.data.requestToken??randomBytes(32).toString("base64url");
    const row=await source(user.id,countryId,taskId);if(!row)return reply.code(403).send({error:"FORBIDDEN"});
    const modern="version" in approved;
    const geography=modern?approved.location:{country:null,city:null,district:null};
    const stored=await db.prepare(`SELECT task_id,publisher_id,country_id,task_number,title,description,country_name,city_name,district_name,revoked_at FROM task_share_previews WHERE token_hash=?`).get<Snapshot>(hash(token));
    const same = (s:Snapshot) => !s.revoked_at && s.task_id===taskId && s.publisher_id===user.id && s.country_id===countryId && s.task_number===approved.taskNumber && s.title===approved.title && s.description===approved.description && s.country_name===geography.country && s.city_name===geography.city && s.district_name===geography.district;
    // A retry returns the same approved snapshot even if private source data changed.
    if(stored) return same(stored)?reply.send({url:`${config.APP_ORIGIN}/share/task/${token}`}):reply.code(409).send({error:"SHARE_REQUEST_CONFLICT",message:"Эта ссылка уже отозвана или относится к другой публикации. Создайте новое превью."});
    const clean=modern?taskSharePublicText:taskShareExcerpt;
    if(approved.taskNumber!==row.task_number || approved.title!==clean(row.title,120)
      || (modern?approved.description!==taskSharePublicText(approved.description):approved.description!==taskShareExcerpt(row.description))
      || Object.entries(geography).some(([key,value])=>value!==null && value!==taskSharePublicText(publicLocation(row)[key as keyof typeof geography]??"",80)))
      return reply.code(409).send({error:"PREVIEW_CHANGED",message:"Данные изменились. Обновите и проверьте превью перед публикацией."});
    await db.prepare(`INSERT INTO task_share_previews(token_hash,task_id,publisher_id,country_id,task_number,title,description,country_name,city_name,district_name)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(token_hash) DO NOTHING`).run(hash(token),taskId,user.id,countryId,row.task_number,approved.title,approved.description,geography.country,geography.city,geography.district);
    const saved=await db.prepare(`SELECT task_id,publisher_id,country_id,task_number,title,description,country_name,city_name,district_name,revoked_at FROM task_share_previews WHERE token_hash=?`).get<Snapshot>(hash(token));
    if(!saved||!same(saved))return reply.code(409).send({error:"SHARE_REQUEST_CONFLICT"});
    return reply.send({url:`${config.APP_ORIGIN}/share/task/${token}`});
  });
  app.delete("/api/task-share-previews",async(request,reply)=>{
    headers(reply);
    const user=await requireUser(db,request,reply);if(!user)return;
    const parsed=scope.safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:"INVALID_SHARE"});
    await db.prepare(`UPDATE task_share_previews SET revoked_at=now() WHERE task_id=? AND country_id=? AND publisher_id=? AND revoked_at IS NULL`).run(parsed.data.taskId,parsed.data.countryId,user.id);
    return reply.send({revoked:true});
  });
  app.get<{Params:{token:string}}>("/share/task/:token/image.png",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request,reply)=>{
    headers(reply);
    const row=await snapshot(request.params.token);if(!row)return reply.code(404).send({error:"SHARE_UNAVAILABLE"});
    const png=await taskShareImage({taskNumber:row.task_number,title:row.title,description:row.description,location:publicLocation(row)});
    if(!png)return reply.code(503).header("Retry-After","2").send({error:"IMAGE_BUSY"});
    if(!await snapshot(request.params.token))return reply.code(404).send({error:"SHARE_UNAVAILABLE"});
    return reply.type("image/png").send(png);
  });
  app.get<{Params:{token:string}}>("/share/task/:token",async(request,reply)=>{
    const token=request.params.token,row=await snapshot(token);
    const title=row?`#${row.task_number} · ${row.title}`:"Tasktopia · ссылка недоступна";
    const geography=row?taskShareLocationText(publicLocation(row)):"";
    const description=row?[row.description,geography].filter(Boolean).join(" · "):"Откройте Tasktopia, чтобы просмотреть доступные вам задачи.";
    const url=`${config.APP_ORIGIN}/share/task/${token}`,image=`${url}/image.png`;
    const target=row?`${config.APP_ORIGIN}/task/${row.task_number}?countryId=${encodeURIComponent(row.country_id)}&taskId=${encodeURIComponent(row.task_id)}`:config.APP_ORIGIN;
    return headers(reply).code(row?200:404).type("text/html; charset=utf-8").send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="/share-preview.css"><meta property="og:type" content="website"><meta property="og:site_name" content="Tasktopia"><meta property="og:locale" content="ru_RU"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta name="twitter:card" content="${row?"summary_large_image":"summary"}"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}">${row?`<meta property="og:image" content="${escape(image)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escape(title+" · "+geography)}"><meta name="twitter:image" content="${escape(image)}"><meta name="twitter:image:alt" content="${escape(title)}">`:""}</head><body><main>${row?`<img class="share-card" src="${escape(image)}" width="1200" height="630" alt="${escape(title)}">`:""}<h1>${escape(title)}</h1>${geography?`<p class="share-location">${escape(geography)}</p>`:""}<p>${escape(row?.description??description)}</p><a href="${escape(target)}">Открыть Tasktopia</a></main></body></html>`);
  });
}
