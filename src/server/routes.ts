import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import type { AppService } from "./app-service";
import { DomainError } from "./app-service";
import { transaction, type Db } from "./db";
import {
  countryRole,
  createCountry,
  createMcpToken,
  EmailAlreadyRegisteredError,
  getSessionUser,
  inviteCountryMember,
  listAccessibleCountries,
  listCountryMembers,
  loginUser,
  logout,
  renameCountry,
  removeCountryMember,
  requireUser,
  SESSION_COOKIE,
  setActiveCountry,
  updateAccountName,
} from "./auth";
import { BUILDING_CATALOG } from "../shared/catalog";
import { MCP_SCOPES, type McpScope } from "../shared/contracts";
import { SAFE_HTTP_ERROR_MESSAGES } from "../shared/http-errors";
import { config } from "./config";
import { APP_VERSION } from "./version";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().trim().email({ message: "Введите корректный email" }).max(254, { message: "Email слишком длинный" }),
  name: z.string().trim().min(2, { message: "Имя должно содержать минимум 2 символа" }).max(60, { message: "Имя слишком длинное" }),
  password: z.string().min(8, { message: "Пароль должен содержать минимум 8 символов" }).max(128, { message: "Пароль слишком длинный" }),
  countryName: z.string({ error: "Введите название первой страны" }).trim().min(2, { message: "Название страны должно содержать минимум 2 символа" }).max(100, { message: "Название страны слишком длинное" }),
  cityName: z.string({ error: "Введите название первого города" }).trim().min(2, { message: "Название города должно содержать минимум 2 символа" }).max(100, { message: "Название города слишком длинное" }),
}).strict();
const loginSchema = z.object({
  email: z.string().trim().email({ message: "Введите корректный email" }).max(254, { message: "Email слишком длинный" }),
  password: z.string().min(1, { message: "Введите пароль" }).max(128, { message: "Пароль слишком длинный" }),
}).strict();
const tokenSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  scopes: z.array(z.enum(MCP_SCOPES as [McpScope, ...McpScope[]])).min(1).max(MCP_SCOPES.length).optional(),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(),
}).strict();
const countrySchema = z.object({ name: z.string().trim().min(2).max(100) }).strict();
const countryProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(), description: z.string().max(8000).optional(), goal: z.string().max(4000).optional(),
  productContext: z.string().max(8000).optional(), successCriteria: z.string().max(8000).optional(), constraints: z.string().max(8000).optional(),
  idempotencyKey: z.string().min(4).max(160).optional(),
}).strict();
const cityUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(), description: z.string().max(8000).optional(), goal: z.string().max(4000).optional(),
  acceptanceCriteria: z.string().max(8000).optional(), deadline: z.string().datetime().nullable().optional(), idempotencyKey: z.string().min(4).max(160),
}).strict();
const districtUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(), goal: z.string().max(4000).optional(), description: z.string().max(8000).optional(),
  deadline: z.string().datetime().nullable().optional(), capacitySp: z.number().int().positive().optional(), idempotencyKey: z.string().min(4).max(160),
}).strict();
const taskFieldsSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(), description: z.string().max(8000).optional(),
  workItemType: z.enum(["TASK", "BUG", "RELEASE", "HOTFIX"]).optional(), acceptanceCriteria: z.string().max(8000).optional(),
  systemAnalysis: z.string().max(16000).optional(), architecture: z.string().max(16000).optional(), designSystem: z.string().max(16000).optional(),
  implementationPlan: z.string().max(16000).optional(), estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6)]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(), dueAt: z.string().datetime().nullable().optional(),
  assigneeRole: z.string().trim().max(80).optional(),
  forUserId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(4).max(160),
}).strict();
const defectCreateSchema = z.object({
  title: z.string().trim().min(2).max(160), description: z.string().max(8000).optional(), reproductionSteps: z.string().min(1).max(12000),
  actualResult: z.string().min(1).max(8000), expectedResult: z.string().min(1).max(8000), idempotencyKey: z.string().min(4).max(160),
}).strict();
const defectUpdateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(), description: z.string().max(8000).optional(), reproductionSteps: z.string().trim().min(1).max(12000).optional(),
  actualResult: z.string().trim().min(1).max(8000).optional(), expectedResult: z.string().trim().min(1).max(8000).optional(), status: z.enum(["OPEN", "IN_PROGRESS", "VERIFYING", "FIXED"]).optional(),
  idempotencyKey: z.string().min(4).max(160),
}).strict();
const accountSchema = z.object({ name: z.string().trim().min(2).max(60) }).strict();
const invitationSchema = z.object({ email: z.string().trim().email().max(254), role: z.enum(["MEMBER", "VIEWER"]).default("MEMBER") }).strict();
const deleteCitySchema = z.object({ confirmName: z.string().trim().min(1).max(100), idempotencyKey: z.string().min(1).max(160) }).strict();
const deleteDistrictSchema = z.object({ confirmName: z.string().trim().min(1).max(100), idempotencyKey: z.string().min(1).max(160) }).strict();
const deleteTaskSchema = z.object({ confirmTitle: z.string().trim().min(1).max(160), idempotencyKey: z.string().min(1).max(160) }).strict();
const regenerateCountrySchema = z.object({ confirmName: z.string().trim().min(1).max(100), idempotencyKey: z.string().min(1).max(160) }).strict();
const taskLinkSchema = z.object({
  url: z.string().trim().min(8).max(2000), title: z.string().trim().max(200).optional(), idempotencyKey: z.string().min(4).max(160),
}).strict();
const taskLinkRemoveSchema = z.object({
  url: z.string().trim().min(8).max(2000), idempotencyKey: z.string().min(4).max(160),
}).strict();
const attachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(200), mimeType: z.string().trim().max(120).optional(),
  contentBase64: z.string().min(1), idempotencyKey: z.string().min(4).max(160),
}).strict();
const attachmentDeleteSchema = z.object({ idempotencyKey: z.string().min(4).max(160) }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError("INVALID_INPUT", result.error.issues[0]?.message ?? "Некорректные данные");
  return result.data;
}

export function requestErrorStatus(error: unknown): number {
  const uniqueConflict = (error as { code?: string }).code === "23505";
  const middlewareStatus = Number((error as { statusCode?: number }).statusCode);
  if (error instanceof DomainError) {
    if (error.code === "NOT_FOUND") return 404;
    if (error.code === "CONFLICT") return 409;
    if (error.code === "UNAUTHENTICATED") return 401;
    if (error.code === "FORBIDDEN") return 403;
    return 400;
  }
  if (uniqueConflict) return 409;
  if (Number.isInteger(middlewareStatus) && middlewareStatus >= 400 && middlewareStatus <= 599) return middlewareStatus;
  return 500;
}

export type RouteRuntimeHooks = {
  onCountryAccessRevoked?: (countryId: string, userId: string) => Promise<void> | void;
  onUserSessionRevoked?: (userId: string) => Promise<void> | void;
};

export async function registerRoutes(app: FastifyInstance, db: Db, service: AppService, hooks: RouteRuntimeHooks = {}): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || !request.url.startsWith("/api/")) return;
    const origin = request.headers.origin;
    if (!origin) return;
    // APP_ORIGIN is the only trusted browser origin. Raw forwarding headers are
    // client-controlled unless the proxy chain has already been authenticated;
    // accepting them here allowed a caller to make an arbitrary Origin appear
    // same-site by sending the same X-Forwarded-Host value.
    if (origin !== config.APP_ORIGIN) {
      await reply.code(403).send({ error: "INVALID_ORIGIN", message: "Запрос отправлен с недоверенного origin" });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const uniqueConflict = (error as { code?: string }).code === "23505";
    const status = requestErrorStatus(error);
    const message = error instanceof DomainError ? error.message
      : status === 500 ? "Внутренняя ошибка сервера"
        : uniqueConflict ? "Такая запись уже существует"
          : SAFE_HTTP_ERROR_MESSAGES[status] ?? "Ошибка запроса";
    if (status === 500) request.log.error({ err: error }, "Unhandled request error");
    reply.code(status).send({ error: error instanceof DomainError ? error.code : "REQUEST_FAILED", message });
  });

  app.get("/health", async () => {
            await db.prepare("SELECT 1").get();
            return { status: "ok", version: APP_VERSION, uptime: Math.round(process.uptime()) };
          });

  app.post("/api/auth/register", { config: { rateLimit: { max: config.authRateLimitMax, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(registerSchema, request.body);
    let result;
    try {
      result = await service.onboardUser(body);
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) throw new DomainError("CONFLICT", error.message);
      throw error;
    }
    reply.setCookie(SESSION_COOKIE, result.session, {
      path: "/", httpOnly: true, sameSite: "strict", secure: config.secureCookie, maxAge: 30 * 24 * 60 * 60,
    });
    return { user: result.user };
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: config.authRateLimitMax, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(loginSchema, request.body);
    let result;
    try {
      result = await loginUser(db, body.email, body.password);
    } catch (error) {
      if (error instanceof Error && error.message === "Неверный email или пароль") throw new DomainError("UNAUTHENTICATED", error.message);
      throw error;
    }
    reply.setCookie(SESSION_COOKIE, result.session, {
      path: "/", httpOnly: true, sameSite: "strict", secure: config.secureCookie, maxAge: 30 * 24 * 60 * 60,
    });
    return { user: result.user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const user = await getSessionUser(db, token);
    await logout(db, token);
    if (user) await hooks.onUserSessionRevoked?.(user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/bootstrap", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            return user ? await service.getBootstrap(user) : reply;
          });

  app.get("/api/country-atlas", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const atlas = await service.getCountryAtlas(user.countryId);
            const etag = `"${user.countryId}-${atlas.worldVersion}-atlas-${atlas.schemaVersion}"`;
            if (request.headers["if-none-match"] === etag) return reply.code(304).send();
            return reply.header("ETag", etag).header("Cache-Control", "private, no-cache, must-revalidate").send(atlas);
          });

  app.get("/api/plan/cities", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            return user ? await service.listPlanCities(user.countryId) : reply;
          });

  app.get("/api/plan/cities-page", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const query = parse(z.object({
              cursor: z.string().min(1).max(500).optional(),
              limit: z.coerce.number().int().min(1).max(100).default(50),
            }).strict(), request.query);
            return await service.listPlanCitiesPage(user.countryId, query.cursor, query.limit);
          });

  app.get("/api/plan/cities/:cityId/districts", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const cityId = parse(z.string().uuid(), (request.params as { cityId: string }).cityId);
            return await service.listPlanDistricts(user.countryId, cityId);
          });

  app.get("/api/plan/districts/:districtId/tasks", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const districtId = parse(z.string().uuid(), (request.params as { districtId: string }).districtId);
            return await service.listPlanTasks(user.countryId, districtId);
          });

  app.patch("/api/account", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const body = parse(accountSchema, request.body);
    await updateAccountName(db, user.id, body.name);
    return { user: { id: user.id, email: user.email, name: body.name } };
  });

  app.get("/api/countries", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            return Promise.all((await listAccessibleCountries(db, user.id)).map(async (access) => ({
                                                  ...await service.getCountry(access.id), role: access.role, memberCount: access.memberCount,
                                                })));
          });

  app.post("/api/countries", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const body = parse(countrySchema, request.body);
    const countryId = await createCountry(db, user.id, body.name);
    return { ...await service.getCountry(countryId), role: "OWNER", memberCount: 1 };
  });

  app.post("/api/countries/:countryId/select", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    const role = await setActiveCountry(db, user.id, countryId);
    if (!role) throw new DomainError("FORBIDDEN", "У вас нет доступа к этой стране");
    return await service.getBootstrap({ ...user, countryId, countryRole: role });
  });

  app.patch("/api/countries/:countryId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    const body = parse(countryProfileSchema, request.body);
    if (await countryRole(db, user.id, countryId) !== "OWNER") throw new DomainError("FORBIDDEN", "Изменять страну может только её глава");
    const hasProfile = [body.description, body.goal, body.productContext, body.successCriteria, body.constraints].some((value) => value !== undefined);
    return await transaction(db, async () => {
      if (body.name && !await renameCountry(db, user.id, countryId, body.name)) throw new DomainError("FORBIDDEN", "Переименовать страну может только её глава");
      return hasProfile
        ? await service.updateCountryProfile(countryId, { ...body, idempotencyKey: body.idempotencyKey ?? crypto.randomUUID() })
        : await service.getCountry(countryId);
    });
  });

  app.post("/api/countries/:countryId/regenerate", { config: { rateLimit: { max: 2, timeWindow: "1 hour" } } }, async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    if (countryId !== user.countryId || await countryRole(db, user.id, countryId) !== "OWNER") {
      throw new DomainError("FORBIDDEN", "Перегенерировать мир может только глава выбранной страны");
    }
    return await service.regenerateCountry(countryId, parse(regenerateCountrySchema, request.body));
  });

  app.delete("/api/countries/:countryId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    if (await countryRole(db, user.id, countryId) !== "OWNER") throw new DomainError("FORBIDDEN", "Удалять страну может только её глава");
    const remaining = (await listAccessibleCountries(db, user.id)).filter((country) => country.id !== countryId);
    if (remaining.length === 0) throw new DomainError("CONFLICT", "Нельзя удалить единственную доступную страну");
    await transaction(db, async () => {
                              const tokenUsers = await db.prepare("SELECT DISTINCT user_id FROM mcp_tokens WHERE country_id = ? AND user_id IS NOT NULL").all(countryId) as Array<{ user_id: string }>;
                              for (const tokenUser of tokenUsers) {
                                const fallback = await db.prepare("SELECT country_id FROM country_members WHERE user_id = ? AND country_id <> ? ORDER BY created_at LIMIT 1")
                                                                                                      .get(tokenUser.user_id, countryId) as { country_id: string } | undefined;
                                if (fallback) await db.prepare("UPDATE mcp_tokens SET country_id = ? WHERE country_id = ? AND user_id = ?").run(fallback.country_id, countryId, tokenUser.user_id);
                              }
                              await db.prepare("DELETE FROM countries WHERE id = ? AND user_id = ?").run(countryId, user.id);
                              await setActiveCountry(db, user.id, remaining[0]!.id);
                            });
    return { ok: true, activeCountryId: remaining[0]!.id };
  });

  app.get("/api/countries/:countryId/members", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
            if (!await countryRole(db, user.id, countryId)) throw new DomainError("FORBIDDEN", "У вас нет доступа к правительству этой страны");
            return await listCountryMembers(db, countryId);
          });

  app.post("/api/countries/:countryId/members", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    if (await countryRole(db, user.id, countryId) !== "OWNER") throw new DomainError("FORBIDDEN", "Состав правительства меняет только глава страны");
    const body = parse(invitationSchema, request.body);
    const memberBefore = (await listCountryMembers(db, countryId)).find((entry) => entry.email === body.email.toLowerCase());
    if (memberBefore) throw new DomainError("CONFLICT", "Этот человек уже состоит в правительстве");
    const member = await inviteCountryMember(db, countryId, user.id, body.email, body.role);
    if (!member) throw new DomainError("NOT_FOUND", "Пользователь с таким email ещё не зарегистрирован");
    return member;
  });

  app.delete("/api/countries/:countryId/members/:userId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const params = request.params as { countryId: string; userId: string };
    const countryId = parse(z.string().uuid(), params.countryId);
    const userId = parse(z.string().uuid(), params.userId);
    if (await countryRole(db, user.id, countryId) !== "OWNER") throw new DomainError("FORBIDDEN", "Состав правительства меняет только глава страны");
    if (!await removeCountryMember(db, countryId, userId)) throw new DomainError("NOT_FOUND", "Участник правительства не найден");
    await hooks.onCountryAccessRevoked?.(countryId, userId);
    return { ok: true };
  });

  // One camera action legitimately fetches dozens of immutable/read-only
  // chunks. Keep their budget separate so ordinary panning cannot lock out
  // bootstrap, token and task requests, while still bounding abusive traffic.
  app.get("/api/chunks/:chunkX/:chunkY", {
            config: { rateLimit: { max: 600, timeWindow: "1 minute", groupId: "world-chunks" } },
          }, async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const params = request.params as { chunkX: string; chunkY: string };
            const chunkX = Number(params.chunkX);
            const chunkY = Number(params.chunkY);
            if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) || Math.abs(chunkX) > 10000 || Math.abs(chunkY) > 10000) {
              throw new DomainError("INVALID_INPUT", "Некорректные координаты чанка");
            }
            const lod = parse(z.enum(["detail", "overview"]).default("detail"), (request.query as { lod?: string }).lod);
            const chunk = await service.getChunk(user.countryId, chunkX, chunkY, lod === "overview" ? "OVERVIEW" : "DETAIL");
            // Active country is implicit in this route. It must still be part
            // of the validator or two countries at the same world version can
            // incorrectly share a browser's credentialed 304 response.
            const etag = `"${user.countryId}-${chunk.worldVersion}-${chunkX}-${chunkY}-${lod}"`;
            if (request.headers["if-none-match"] === etag) {
              return reply.code(304).send();
            }
            return reply.header("ETag", etag).header("Cache-Control", "private, no-cache, must-revalidate").send(chunk);
          });

  const archiveRecordSchema = z.object({
    kind: z.enum(["PROJECT", "REPOSITORY", "ARCHITECTURE", "CONVENTION", "ENVIRONMENT", "TEMPLATE"]),
    title: z.string().trim().min(2).max(160), body: z.string().max(32000).optional(),
    sourceUrl: z.string().url().max(2000).optional(), tags: z.array(z.string().max(40)).max(10).optional(),
    idempotencyKey: z.string().min(4).max(160),
  }).strict();
  const archiveRecordUpdateSchema = z.object({
    kind: z.enum(["PROJECT", "REPOSITORY", "ARCHITECTURE", "CONVENTION", "ENVIRONMENT", "TEMPLATE"]).optional(),
    title: z.string().trim().min(2).max(160).optional(), body: z.string().max(32000).optional(), sourceUrl: z.string().url().max(2000).nullable().optional(),
    tags: z.array(z.string().max(40)).max(10).optional(), idempotencyKey: z.string().min(4).max(160),
  }).strict();
  const archiveRecordDeleteSchema = z.object({ confirmTitle: z.string().trim().min(1).max(160), idempotencyKey: z.string().min(4).max(160) }).strict();

  app.get("/api/archive", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    return await service.getArchive(user.countryId);
  });

  app.get("/api/archive/records", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    return await service.listArchiveRecords(user.countryId);
  });

  app.get("/api/archive/records/:recordId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const recordId = parse(z.string().uuid(), (request.params as { recordId: string }).recordId);
    return await service.getArchiveRecord(user.countryId, recordId);
  });

  app.post("/api/archive/records", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять Государственный архив");
    return service.createArchiveRecord(user.countryId, parse(archiveRecordSchema, request.body));
  });

  app.patch("/api/archive/records/:recordId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять Государственный архив");
    const recordId = parse(z.string().uuid(), (request.params as { recordId: string }).recordId);
    return service.updateArchiveRecord(user.countryId, { recordId, ...parse(archiveRecordUpdateSchema, request.body) });
  });

  app.delete("/api/archive/records/:recordId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может удалять записи Государственного архива");
    const recordId = parse(z.string().uuid(), (request.params as { recordId: string }).recordId);
    return service.deleteArchiveRecord(user.countryId, { recordId, ...parse(archiveRecordDeleteSchema, request.body) });
  });

  app.get("/api/tasks/search", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const query = parse(z.object({
              q: z.string().trim().min(1).max(160),
              limit: z.coerce.number().int().min(1).max(25).default(10),
            }).strict(), request.query);
            return await service.searchTasks(user.countryId, query.q, query.limit);
          });

  app.get("/api/tasks/:taskId", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
            return await service.getTask(user.countryId, taskId);
          });

  app.get("/api/tasks/:taskId/activity", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
            return await service.getTaskActivity(user.countryId, taskId);
          });

  const dependencySchema = z.object({ dependsOnTaskId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }).strict();

  app.post("/api/tasks/:taskId/dependencies", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять задачи");
    const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
    return service.addTaskDependency(user.countryId, { taskId, ...parse(dependencySchema, request.body), actor: user.name, actorUserId: user.id });
  });

  app.delete("/api/tasks/:taskId/dependencies/:dependsOnTaskId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять задачи");
    const params = request.params as { taskId: string; dependsOnTaskId: string };
    const taskId = parse(z.string().uuid(), params.taskId);
    const dependsOnTaskId = parse(z.string().uuid(), params.dependsOnTaskId);
    const body = parse(z.object({ idempotencyKey: z.string().min(4).max(160) }).strict(), request.body);
    return service.removeTaskDependency(user.countryId, { taskId, dependsOnTaskId, ...body, actor: user.name, actorUserId: user.id });
  });

  app.post("/api/tasks/:taskId/links", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять задачи");
    const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
    return service.addTaskLink(user.countryId, { taskId, ...parse(taskLinkSchema, request.body), actor: user.name, actorUserId: user.id });
  });

  app.delete("/api/tasks/:taskId/links", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять задачи");
    const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
    return service.removeTaskLink(user.countryId, { taskId, ...parse(taskLinkRemoveSchema, request.body), actor: user.name, actorUserId: user.id });
  });

  app.post("/api/tasks/:taskId/attachments", {
    // Attachment payloads are base64 JSON: allow up to ~1.4× the byte cap.
    bodyLimit: Math.ceil(config.maxAttachmentBytes * 1.5),
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять задачи");
    const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
    const body = parse(attachmentSchema, request.body);
    const content = Buffer.from(body.contentBase64, "base64");
    return service.addTaskAttachment(user.countryId, {
      taskId, fileName: body.fileName, mimeType: body.mimeType, content,
      actor: user.name, actorUserId: user.id, idempotencyKey: body.idempotencyKey,
    });
  });

  app.get("/api/attachments/:attachmentId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const attachmentId = parse(z.string().uuid(), (request.params as { attachmentId: string }).attachmentId);
    const { attachment, absolutePath } = await service.getTaskAttachment(user.countryId, attachmentId);
    const encoded = encodeURIComponent(attachment.fileName).replaceAll("'", "%27");
    reply.header("content-type", attachment.mimeType);
    reply.header("content-disposition", `attachment; filename="attachment"; filename*=UTF-8''${encoded}`);
    return reply.send(createReadStream(absolutePath));
  });

  app.delete("/api/attachments/:attachmentId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может удалять файлы");
    const attachmentId = parse(z.string().uuid(), (request.params as { attachmentId: string }).attachmentId);
    return service.deleteTaskAttachment(user.countryId, { attachmentId, ...parse(attachmentDeleteSchema, request.body) });
  });

  app.patch("/api/cities/:cityId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять города");
    const cityId = parse(z.string().uuid(), (request.params as { cityId: string }).cityId);
    return service.updateCity(user.countryId, { cityId, ...parse(cityUpdateSchema, request.body) });
  });

  app.patch("/api/districts/:districtId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять районы");
    const districtId = parse(z.string().uuid(), (request.params as { districtId: string }).districtId);
    return service.updateDistrict(user.countryId, { districtId, ...parse(districtUpdateSchema, request.body) });
  });

  app.patch("/api/tasks/:taskId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять задачи");
    const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
    return service.updateTaskFields(user.countryId, { taskId, ...parse(taskFieldsSchema, request.body), actor: user.name, actorUserId: user.id });
  });

  app.post("/api/tasks/:taskId/defects", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может добавлять дефекты");
    const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
    return service.createTaskDefect(user.countryId, { taskId, ...parse(defectCreateSchema, request.body), actor: user.name, actorUserId: user.id });
  });

  app.patch("/api/defects/:defectId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может изменять дефекты");
    const defectId = parse(z.string().uuid(), (request.params as { defectId: string }).defectId);
    return service.updateTaskDefect(user.countryId, { defectId, ...parse(defectUpdateSchema, request.body), actor: user.name, actorUserId: user.id });
  });

  app.delete("/api/cities/:cityId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может удалять города");
    const cityId = parse(z.string().uuid(), (request.params as { cityId: string }).cityId);
    return await service.deleteCity(user.countryId, { cityId, ...parse(deleteCitySchema, request.body) });
  });

  app.delete("/api/districts/:districtId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может удалять районы");
    const districtId = parse(z.string().uuid(), (request.params as { districtId: string }).districtId);
    return await service.deleteDistrict(user.countryId, { districtId, ...parse(deleteDistrictSchema, request.body) });
  });

  app.delete("/api/tasks/:taskId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    if (user.countryRole === "VIEWER") throw new DomainError("FORBIDDEN", "Наблюдатель не может удалять задачи");
    const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
    return await service.deleteTask(user.countryId, { taskId, ...parse(deleteTaskSchema, request.body) });
  });

  app.get("/api/events", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            const after = Number((request.query as { after?: string }).after ?? 0);
            return await service.listEvents(user.countryId, Number.isFinite(after) ? after : 0);
          });

  app.get("/api/catalog", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            return user ? BUILDING_CATALOG : reply;
          });

  app.get("/api/tokens", async (request, reply) => {
            const user = await requireUser(db, request, reply);
            if (!user) return reply;
            return (await db.prepare("SELECT id, name, token_prefix, scopes_json, expires_at, last_used_at, revoked_at, created_at FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC")
                                                  .all(user.id)).map((row) => {
                                                    const raw = (row as Record<string, unknown>).scopes_json;
                                                    return {
                                                      id: row.id, name: row.name, prefix: row.token_prefix,
                                                      scopes: typeof raw === "string" ? JSON.parse(raw) : raw,
                                                      expiresAt: row.expires_at, lastUsedAt: row.last_used_at,
                                                      revokedAt: row.revoked_at, createdAt: row.created_at,
                                                    };
                                                  });
          });

  app.post("/api/tokens", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const body = parse(tokenSchema, request.body ?? {});
    try {
      return await createMcpToken(db, user.countryId, body.name ?? "Персональный MCP", user.id, {
                                scopes: body.scopes, expiresInDays: body.expiresInDays,
                              });
    } catch (error) {
      if (error instanceof Error && error.message.includes("scopes")) throw new DomainError("FORBIDDEN", error.message);
      throw error;
    }
  });

  app.delete("/api/tokens/:tokenId", async (request, reply) => {
    const user = await requireUser(db, request, reply);
    if (!user) return reply;
    const tokenId = parse(z.string().uuid(), (request.params as { tokenId: string }).tokenId);
    await db.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?").run(new Date().toISOString(), tokenId, user.id);
    return { ok: true };
  });
}
