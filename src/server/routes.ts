import type { FastifyInstance } from "fastify";
import type { AppService } from "./app-service";
import { DomainError } from "./app-service";
import { transaction, type Db } from "./db";
import {
  countryRole,
  createCountry,
  createMcpToken,
  EmailAlreadyRegisteredError,
  inviteCountryMember,
  listAccessibleCountries,
  listCountryMembers,
  loginUser,
  logout,
  registerUser,
  removeCountryMember,
  requireUser,
  SESSION_COOKIE,
  setActiveCountry,
  updateAccountName,
} from "./auth";
import { BUILDING_CATALOG } from "../shared/catalog";
import { config } from "./config";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().trim().email({ message: "Введите корректный email" }).max(254, { message: "Email слишком длинный" }),
  name: z.string().trim().min(2, { message: "Имя должно содержать минимум 2 символа" }).max(60, { message: "Имя слишком длинное" }),
  password: z.string().min(8, { message: "Пароль должен содержать минимум 8 символов" }).max(128, { message: "Пароль слишком длинный" }),
}).strict();
const loginSchema = z.object({
  email: z.string().trim().email({ message: "Введите корректный email" }).max(254, { message: "Email слишком длинный" }),
  password: z.string().min(1, { message: "Введите пароль" }).max(128, { message: "Пароль слишком длинный" }),
}).strict();
const tokenSchema = z.object({ name: z.string().trim().min(1).max(80).optional() }).strict();
const countrySchema = z.object({ name: z.string().trim().min(2).max(100) }).strict();
const accountSchema = z.object({ name: z.string().trim().min(2).max(60) }).strict();
const invitationSchema = z.object({ email: z.string().trim().email().max(254) }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError("INVALID_INPUT", result.error.issues[0]?.message ?? "Некорректные данные");
  return result.data;
}

export function requestErrorStatus(error: unknown): number {
  const uniqueConflict = String((error as { code?: string }).code).includes("SQLITE_CONSTRAINT_UNIQUE");
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

export function registerRoutes(app: FastifyInstance, db: Db, service: AppService): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || !request.url.startsWith("/api/")) return;
    const origin = request.headers.origin;
    if (!origin) return;
    const forwardedHost = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "").split(",")[0]!.trim();
    let originHost = "";
    try { originHost = new URL(origin).host; } catch { /* rejected below */ }
    if (origin !== config.APP_ORIGIN && originHost !== forwardedHost) {
      await reply.code(403).send({ error: "INVALID_ORIGIN", message: "Запрос отправлен с недоверенного origin" });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const uniqueConflict = String((error as { code?: string }).code).includes("SQLITE_CONSTRAINT_UNIQUE");
    const status = requestErrorStatus(error);
    const message = status === 500 ? "Внутренняя ошибка сервера"
      : uniqueConflict ? "Такая запись уже существует"
        : error instanceof Error ? error.message : "Ошибка запроса";
    if (status === 500) request.log.error({ err: error }, "Unhandled request error");
    reply.code(status).send({ error: error instanceof DomainError ? error.code : "REQUEST_FAILED", message });
  });

  app.get("/health", async () => {
    db.prepare("SELECT 1").get();
    return { status: "ok", version: "0.7.0", uptime: Math.round(process.uptime()) };
  });

  app.post("/api/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(registerSchema, request.body);
    let result;
    try {
      result = await registerUser(db, body);
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) throw new DomainError("CONFLICT", error.message);
      throw error;
    }
    reply.setCookie(SESSION_COOKIE, result.session, {
      path: "/", httpOnly: true, sameSite: "lax", secure: config.secureCookie, maxAge: 30 * 24 * 60 * 60,
    });
    return { user: result.user };
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(loginSchema, request.body);
    let result;
    try {
      result = await loginUser(db, body.email, body.password);
    } catch (error) {
      if (error instanceof Error && error.message === "Неверный email или пароль") throw new DomainError("UNAUTHENTICATED", error.message);
      throw error;
    }
    reply.setCookie(SESSION_COOKIE, result.session, {
      path: "/", httpOnly: true, sameSite: "lax", secure: config.secureCookie, maxAge: 30 * 24 * 60 * 60,
    });
    return { user: result.user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    logout(db, request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/bootstrap", async (request, reply) => {
    const user = requireUser(db, request, reply);
    return user ? service.getBootstrap(user) : reply;
  });

  app.patch("/api/account", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = parse(accountSchema, request.body);
    updateAccountName(db, user.id, body.name);
    return { user: { id: user.id, email: user.email, name: body.name } };
  });

  app.get("/api/countries", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    return listAccessibleCountries(db, user.id).map((access) => ({
      ...service.getCountry(access.id), role: access.role, memberCount: access.memberCount,
    }));
  });

  app.post("/api/countries", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = parse(countrySchema, request.body);
    const countryId = createCountry(db, user.id, body.name);
    return { ...service.getCountry(countryId), role: "OWNER", memberCount: 1 };
  });

  app.post("/api/countries/:countryId/select", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    const role = setActiveCountry(db, user.id, countryId);
    if (!role) throw new DomainError("FORBIDDEN", "У вас нет доступа к этой стране");
    return service.getBootstrap({ ...user, countryId, countryRole: role });
  });

  app.delete("/api/countries/:countryId", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    if (countryRole(db, user.id, countryId) !== "OWNER") throw new DomainError("FORBIDDEN", "Удалять страну может только её основатель");
    const remaining = listAccessibleCountries(db, user.id).filter((country) => country.id !== countryId);
    if (remaining.length === 0) throw new DomainError("CONFLICT", "Нельзя удалить единственную доступную страну");
    transaction(db, () => {
      const tokenUsers = db.prepare("SELECT DISTINCT user_id FROM mcp_tokens WHERE country_id = ? AND user_id IS NOT NULL").all(countryId) as Array<{ user_id: string }>;
      for (const tokenUser of tokenUsers) {
        const fallback = db.prepare("SELECT country_id FROM country_members WHERE user_id = ? AND country_id <> ? ORDER BY created_at LIMIT 1")
          .get(tokenUser.user_id, countryId) as { country_id: string } | undefined;
        if (fallback) db.prepare("UPDATE mcp_tokens SET country_id = ? WHERE country_id = ? AND user_id = ?").run(fallback.country_id, countryId, tokenUser.user_id);
      }
      db.prepare("DELETE FROM countries WHERE id = ? AND user_id = ?").run(countryId, user.id);
      setActiveCountry(db, user.id, remaining[0]!.id);
    });
    return { ok: true, activeCountryId: remaining[0]!.id };
  });

  app.get("/api/countries/:countryId/members", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    if (!countryRole(db, user.id, countryId)) throw new DomainError("FORBIDDEN", "У вас нет доступа к палате этой страны");
    return listCountryMembers(db, countryId);
  });

  app.post("/api/countries/:countryId/members", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const countryId = parse(z.string().uuid(), (request.params as { countryId: string }).countryId);
    if (countryRole(db, user.id, countryId) !== "OWNER") throw new DomainError("FORBIDDEN", "Состав палаты меняет только основатель страны");
    const body = parse(invitationSchema, request.body);
    const memberBefore = listCountryMembers(db, countryId).find((entry) => entry.email === body.email.toLowerCase());
    if (memberBefore) throw new DomainError("CONFLICT", "Этот человек уже состоит в палате");
    const member = inviteCountryMember(db, countryId, user.id, body.email);
    if (!member) throw new DomainError("NOT_FOUND", "Пользователь с таким email ещё не зарегистрирован");
    return member;
  });

  app.delete("/api/countries/:countryId/members/:userId", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const params = request.params as { countryId: string; userId: string };
    const countryId = parse(z.string().uuid(), params.countryId);
    const userId = parse(z.string().uuid(), params.userId);
    if (countryRole(db, user.id, countryId) !== "OWNER") throw new DomainError("FORBIDDEN", "Состав палаты меняет только основатель страны");
    if (!removeCountryMember(db, countryId, userId)) throw new DomainError("NOT_FOUND", "Участник палаты не найден");
    return { ok: true };
  });

  // One camera action legitimately fetches dozens of immutable/read-only
  // chunks. Keep their budget separate so ordinary panning cannot lock out
  // bootstrap, token and task requests, while still bounding abusive traffic.
  app.get("/api/chunks/:chunkX/:chunkY", {
    config: { rateLimit: { max: 600, timeWindow: "1 minute", groupId: "world-chunks" } },
  }, async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const params = request.params as { chunkX: string; chunkY: string };
    const chunkX = Number(params.chunkX);
    const chunkY = Number(params.chunkY);
    if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) || Math.abs(chunkX) > 10000 || Math.abs(chunkY) > 10000) {
      throw new DomainError("INVALID_INPUT", "Некорректные координаты чанка");
    }
    return service.getChunk(user.countryId, chunkX, chunkY);
  });

  app.get("/api/tasks/:taskId", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const taskId = parse(z.string().uuid(), (request.params as { taskId: string }).taskId);
    return service.getTask(user.countryId, taskId);
  });

  app.get("/api/events", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const after = Number((request.query as { after?: string }).after ?? 0);
    return service.listEvents(user.countryId, Number.isFinite(after) ? after : 0);
  });

  app.get("/api/catalog", async (request, reply) => {
    const user = requireUser(db, request, reply);
    return user ? BUILDING_CATALOG : reply;
  });

  app.get("/api/tokens", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    return db.prepare("SELECT id, name, token_prefix AS prefix, scopes_json, expires_at AS expiresAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt, created_at AS createdAt FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC")
      .all(user.id).map((row) => ({ ...row, scopes: JSON.parse(String((row as Record<string, unknown>).scopes_json)), scopes_json: undefined }));
  });

  app.post("/api/tokens", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const body = parse(tokenSchema, request.body ?? {});
    return createMcpToken(db, user.countryId, body.name ?? "Персональный MCP", user.id);
  });

  app.delete("/api/tokens/:tokenId", async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return reply;
    const tokenId = parse(z.string().uuid(), (request.params as { tokenId: string }).tokenId);
    db.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?").run(new Date().toISOString(), tokenId, user.id);
    return { ok: true };
  });
}
