import type { IncomingHttpHeaders } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { BUILDING_CATALOG } from "../shared/catalog";
import type { AppService } from "./app-service";
import { DomainError } from "./app-service";
import type { Db } from "./db";
import { authenticateMcpToken, listAccessibleCountries, setActiveCountry } from "./auth";
import type { CountryRole } from "../shared/contracts";

type McpIdentity = { userId: string; countryId: string; countryRole: CountryRole; tokenId: string; scopes: string[] };

function response(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
}

function failure(error: unknown) {
  const code = error instanceof DomainError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof DomainError ? error.message : "Внутренняя ошибка MCP";
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }] };
}

function requireScope(identity: McpIdentity, scope: string): void {
  if (!identity.scopes.includes(scope)) throw new DomainError("FORBIDDEN_SCOPE", `Токену не хватает scope ${scope}`);
}

export function getMcpIdentity(db: Db, headers: IncomingHttpHeaders): McpIdentity | null {
  return authenticateMcpToken(db, headers.authorization ?? headers["x-api-key"]);
}

export function createMcpServer(db: Db, service: AppService, identity: McpIdentity): McpServer {
  const server = new McpServer({ name: "tasktopia", version: "0.7.0" });
  const actor = db.prepare("SELECT name FROM users WHERE id = ?").get(identity.userId) as { name: string } | undefined;
  const actorName = actor?.name ?? "Участник палаты";
  const resolveMember = (email: string | undefined): string | undefined => {
    if (!email) return undefined;
    const row = db.prepare(`SELECT u.id FROM users u JOIN country_members cm ON cm.user_id = u.id
      WHERE cm.country_id = ? AND u.email = ?`).get(identity.countryId, email.trim().toLowerCase()) as { id: string } | undefined;
    if (!row) throw new DomainError("ASSIGNEE_NOT_MEMBER", "Ответственный должен быть зарегистрирован и состоять в палате страны");
    return row.id;
  };
  const cityCreateSchema = {
    name: z.string().min(2).max(100), description: z.string().max(4000).optional(),
    morphology: z.enum(["BALANCED", "DENSE_CORE", "GARDEN_CITY", "POLYCENTRIC"]).optional(),
    idempotencyKey: z.string().min(4).max(160),
  };
  const districtCreateSchema = {
    cityId: z.string().uuid(), name: z.string().min(2).max(100), goal: z.string().max(2000).optional(),
    capacitySp: z.number().int().min(1).max(26).optional(), activate: z.boolean().optional(),
    archetype: z.enum(["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"]).optional(),
    idempotencyKey: z.string().min(4).max(160),
  };

  server.registerTool("country.get_current", { description: "Получить текущую страну и состояние квадратного мира.", inputSchema: {} }, async () => {
    try {
      requireScope(identity, "country:read");
      return response({ country: service.getCountry(identity.countryId), cities: service.listCities(identity.countryId) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("country.list", { description: "Получить все страны, доступные этому аккаунту.", inputSchema: {} }, async () => {
    try {
      requireScope(identity, "country:read");
      return response(listAccessibleCountries(db, identity.userId).map((access) => ({
        ...service.getCountry(access.id), role: access.role, memberCount: access.memberCount,
      })));
    } catch (error) { return failure(error); }
  });

  server.registerTool("country.select", {
    description: "Выбрать страну для всех следующих MCP-команд этого аккаунта.",
    inputSchema: { countryId: z.string().uuid() },
  }, async ({ countryId }) => {
    try {
      requireScope(identity, "country:read");
      const role = setActiveCountry(db, identity.userId, countryId);
      if (!role) throw new DomainError("FORBIDDEN", "У аккаунта нет доступа к этой стране");
      return response({ country: service.getCountry(countryId), role, activeForNextRequest: true });
    } catch (error) { return failure(error); }
  });

  server.registerTool("city.list", { description: "Получить города текущей страны.", inputSchema: {} }, async () => {
    try { requireScope(identity, "country:read"); return response(service.listCities(identity.countryId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.get", { description: "Получить город, районы и задачи.", inputSchema: { cityId: z.string().uuid() } }, async ({ cityId }) => {
    try {
      requireScope(identity, "country:read");
      const city = service.listCities(identity.countryId).find((item) => item.id === cityId);
      if (!city) throw new DomainError("NOT_FOUND", "Город не найден");
      return response({ city, districts: service.listDistricts(identity.countryId, cityId), tasks: service.listTasks(identity.countryId).filter((task) => task.cityId === cityId) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("city.create", { description: "Создать город, его территорию, улицы и соединение с дорожной сетью страны.", inputSchema: cityCreateSchema }, async (input) => {
    try { requireScope(identity, "cities:write"); return response(service.createCity(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.list", { description: "Получить районы, при необходимости только одного города.", inputSchema: { cityId: z.string().uuid().optional() } }, async ({ cityId }) => {
    try { requireScope(identity, "country:read"); return response(service.listDistricts(identity.countryId, cityId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.create", { description: "Создать расширяемый район с улицами, тротуарами и архетипом застройки. Если archetype не передан, сервер выберет его по цели района и характеру города.", inputSchema: districtCreateSchema }, async (input) => {
    try { requireScope(identity, "districts:write"); return response(service.createDistrict(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.activate", { description: "Сделать район активным.", inputSchema: { districtId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) } }, async ({ districtId, idempotencyKey }) => {
    try { requireScope(identity, "districts:write"); return response(service.activateDistrict(identity.countryId, districtId, idempotencyKey)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.complete", { description: "Закрыть район, когда все его задачи завершены; после этого район больше не расширяется.", inputSchema: { districtId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) } }, async ({ districtId, idempotencyKey }) => {
    try { requireScope(identity, "districts:write"); return response(service.completeDistrict(identity.countryId, districtId, idempotencyKey)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.list", { description: "Получить задачи, при необходимости только одного района.", inputSchema: { districtId: z.string().uuid().optional() } }, async ({ districtId }) => {
    try { requireScope(identity, "tasks:read"); return response(service.listTasks(identity.countryId, districtId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.get", { description: "Получить задачу, здание и комментарии.", inputSchema: { taskId: z.string().uuid() } }, async ({ taskId }) => {
    try { requireScope(identity, "tasks:read"); return response(service.getTask(identity.countryId, taskId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.create", {
    description: "Создать задачу в районе; сервер детерминированно выберет здание и при необходимости расширит район.",
    inputSchema: {
      cityId: z.string().uuid(), districtId: z.string().uuid().optional(),
      title: z.string().min(2).max(160), description: z.string().max(8000).optional(),
      estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6)]),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(), dueAt: z.string().datetime().optional(),
      buildingHint: z.string().max(100).optional(), assigneeEmail: z.string().email().optional(),
      idempotencyKey: z.string().min(4).max(160),
    },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      return response(service.createTask(identity.countryId, {
        cityId: input.cityId, districtId: input.districtId, title: input.title, description: input.description,
        estimate: input.estimate, priority: input.priority, dueAt: input.dueAt, buildingHint: input.buildingHint,
        creatorUserId: identity.userId, assigneeUserId: resolveMember(input.assigneeEmail), idempotencyKey: input.idempotencyKey,
      }));
    } catch (error) { return failure(error); }
  });

  const statusInput = {
    taskId: z.string().uuid(), status: z.enum(["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"]),
    progress: z.number().int().min(0).max(100).optional(), comment: z.string().max(8000).optional(), idempotencyKey: z.string().min(4).max(160),
  };
  server.registerTool("task.set_status", { description: "Перевести задачу на следующую строительную стадию.", inputSchema: statusInput }, async (input) => {
    try { requireScope(identity, "tasks:write"); return response(service.updateTaskStatus(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.report_progress", {
    description: "Обновить процент и статус задачи с обязательным комментарием.",
    inputSchema: { ...statusInput, progress: z.number().int().min(0).max(100), comment: z.string().min(1).max(8000) },
  }, async (input) => {
    try { requireScope(identity, "tasks:write"); return response(service.updateTaskStatus(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.add_comment", {
    description: "Добавить комментарий без изменения стадии.",
    inputSchema: { taskId: z.string().uuid(), body: z.string().min(1).max(8000), idempotencyKey: z.string().min(4).max(160) },
  }, async (input) => {
    try { requireScope(identity, "comments:write"); return response(service.addTaskComment(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.assign", {
    description: "Назначить ответственного из палаты страны или снять назначение.",
    inputSchema: { taskId: z.string().uuid(), assigneeEmail: z.string().email().nullable(), idempotencyKey: z.string().min(4).max(160) },
  }, async ({ taskId, assigneeEmail, idempotencyKey }) => {
    try {
      requireScope(identity, "tasks:write");
      return response(service.assignTask(identity.countryId, {
        taskId, assigneeUserId: assigneeEmail ? resolveMember(assigneeEmail) ?? null : null,
        actor: actorName, actorUserId: identity.userId, idempotencyKey,
      }));
    } catch (error) { return failure(error); }
  });

  server.registerResource("current-country", "tasktopia://country/current", { mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ country: service.getCountry(identity.countryId), cities: service.listCities(identity.countryId) }, null, 2) }],
  }));
  server.registerResource("building-catalog", "tasktopia://catalog/buildings", { mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(BUILDING_CATALOG, null, 2) }],
  }));

  return server;
}

export { StreamableHTTPServerTransport };
