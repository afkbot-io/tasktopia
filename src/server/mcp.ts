import type { IncomingHttpHeaders } from "node:http";
import { createMcpHandler, McpServer, type AuthInfo, type McpHttpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { BUILDING_CATALOG } from "../shared/catalog";
import type { AppService } from "./app-service";
import { DomainError } from "./app-service";
import type { Db } from "./db";
import { authenticateMcpToken, listAccessibleCountries, setActiveCountry } from "./auth";
import type { CountryRole, McpScope, TaskDto } from "../shared/contracts";
import { config } from "./config";
import { APP_VERSION } from "./version";

export type McpIdentity = { userId: string; countryId: string; countryRole: CountryRole; tokenId: string; scopes: McpScope[] };
export type McpAuthentication = { identity: McpIdentity; authInfo: AuthInfo };

/** Shareable web link to the task card; humans open it in the app. */
function taskUrl(task: Pick<TaskDto, "taskNumber">): string {
  return `${config.APP_ORIGIN}/task/${task.taskNumber}`;
}

function response(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
}

function failure(error: unknown) {
  const code = error instanceof DomainError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof DomainError ? error.message : "Внутренняя ошибка MCP";
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }] };
}

function requireScope(identity: McpIdentity, scope: McpScope): void {
  if (!identity.scopes.includes(scope)) throw new DomainError("FORBIDDEN_SCOPE", `Токену не хватает scope ${scope}`);
}

export async function getMcpAuthentication(db: Db, headers: IncomingHttpHeaders): Promise<McpAuthentication | null> {
  const identity = await authenticateMcpToken(db, headers.authorization);
  if (!identity) return null;
  const authorization = headers.authorization;
  if (Array.isArray(authorization)) return null;
  const token = authorization?.replace(/^Bearer /i, "") ?? "";
  return {
    identity,
    authInfo: {
      token,
      clientId: `tasktopia-personal-key:${identity.tokenId}`,
      scopes: identity.scopes,
      extra: { tasktopiaIdentity: identity },
    },
  };
}

export async function createMcpServer(db: Db, service: AppService, identity: McpIdentity): Promise<McpServer> {
  const server = new McpServer({ name: "tasktopia", version: APP_VERSION }, {
    instructions: [
      "Tasktopia turns work into a living country: countries contain cities, cities contain districts, and tasks become buildings.",
      "Start with country.get_current, then read IDs before calling write tools.",
      "Every write requires a stable idempotencyKey. Reuse it only for an identical retry.",
      "District capacitySp is an advisory workload target and never blocks task creation.",
      "Keep project context on the country, epic outcomes on the city, sprint goal and deadline on the district, and executable analysis on the task.",
      "The State Archive is a compact country-level reference, not a city or task backlog. Use archive records for durable project rules, repository/environment links, architecture summaries and reusable templates; keep active work in tasks.",
      "A task workItemType classifies delivery as TASK, BUG, RELEASE or HOTFIX. task defects are linked observations with reproduction, actual and expected results.",
      "Task implementation materials are Markdown documents. Use task.document_upsert for the four standard files and any extra .md files; use task.checklist_replace and task.checklist_item_update to keep execution progress current.",
      "Every task has a human-facing number and url; share the url when reporting to people. Attach merge request links with task.link_add and binary evidence with task.attachment_add. The human UI is read-only; agents own task mutations.",
      "Use task.dependency_add to express task order (must be in the same city); task.activity returns the full audit trail of events, comments, defects, attachments and dependencies.",
      "Linked defects use OPEN -> IN_PROGRESS -> VERIFYING -> FIXED. Keep the parent task in TESTING while an ordinary linked defect is repaired; completion is blocked until every linked defect is FIXED.",
      "Deletion is permanent: read the entity and children, obtain explicit user approval, then pass the exact current confirmName or confirmTitle.",
      "Task stages are PLANNING -> STARTED -> IN_PROGRESS -> TESTING -> COMPLETED; only TESTING -> IN_PROGRESS may move backward and requires a comment.",
    ].join(" "),
    cacheHints: { "tools/list": { ttlMs: 300_000, cacheScope: "private" }, "resources/list": { ttlMs: 300_000, cacheScope: "private" } },
  });
  const actor = await db.prepare("SELECT name FROM users WHERE id = ?").get<{ name: string }>(identity.userId);
  const actorName = actor?.name ?? "Представитель страны";
  const resolveMember = async (email: string | undefined): Promise<string | undefined> => {
    if (!email) return undefined;
    const row = await db.prepare(`SELECT u.id FROM users u JOIN country_members cm ON cm.user_id = u.id
      WHERE cm.country_id = ? AND u.email = ?`).get<{ id: string }>(identity.countryId, email.trim().toLowerCase());
    if (!row) throw new DomainError("ASSIGNEE_NOT_MEMBER", "Ответственный должен быть зарегистрирован и состоять в правительстве страны");
    return row.id;
  };
  const cityCreateSchema = z.object({
    name: z.string().min(2).max(100), description: z.string().max(8000).optional(), goal: z.string().max(4000).optional(),
    acceptanceCriteria: z.string().max(8000).optional(), deadline: z.string().datetime().optional(),
    morphology: z.enum(["BALANCED", "DENSE_CORE", "GARDEN_CITY", "POLYCENTRIC"]).optional(),
    idempotencyKey: z.string().min(4).max(160),
  });
  const districtCreateSchema = z.object({
    cityId: z.string().uuid(), name: z.string().min(2).max(100), goal: z.string().max(4000).optional(),
    description: z.string().max(8000).optional(), deadline: z.string().datetime().optional(),
    capacitySp: z.number().int().positive().optional().describe("Необязательный ориентир нагрузки в SP; не ограничивает число или сумму задач"), activate: z.boolean().optional(),
    archetype: z.enum(["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"]).optional(),
    idempotencyKey: z.string().min(4).max(160),
  });

  server.registerTool("country.get_current", { title: "Current country", description: "Получить текущую страну и состояние квадратного мира.", inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => {
    try {
      requireScope(identity, "country:read");
      return response({ country: await service.getCountry(identity.countryId), archive: await service.getArchive(identity.countryId), cities: await service.listCities(identity.countryId) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("country.list", { title: "List countries", description: "Получить все страны, доступные этому аккаунту.", inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => {
    try {
      requireScope(identity, "country:read");
      return response(await Promise.all((await listAccessibleCountries(db, identity.userId)).map(async (access) => ({
                                                ...await service.getCountry(access.id), role: access.role, memberCount: access.memberCount,
                                              }))));
    } catch (error) { return failure(error); }
  });

  server.registerTool("country.select", {
    description: "Выбрать страну для всех следующих MCP-команд этого аккаунта.",
    inputSchema: z.object({ countryId: z.string().uuid() }),
  }, async ({ countryId }) => {
    try {
      requireScope(identity, "country:read");
      const role = await setActiveCountry(db, identity.userId, countryId);
      if (!role) throw new DomainError("FORBIDDEN", "У аккаунта нет доступа к этой стране");
      return response({ country: await service.getCountry(countryId), role, activeForNextRequest: true });
    } catch (error) { return failure(error); }
  });

  server.registerTool("country.update_profile", {
    description: "Обновить устойчивый контекст страны-проекта: описание, цель, продуктовый контекст, критерии успеха и ограничения.",
    inputSchema: z.object({
      description: z.string().max(8000).optional(), goal: z.string().max(4000).optional(), productContext: z.string().max(8000).optional(),
      successCriteria: z.string().max(8000).optional(), constraints: z.string().max(8000).optional(), idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "cities:write");
      if (identity.countryRole !== "OWNER") throw new DomainError("FORBIDDEN", "Профиль страны изменяет только её глава");
      return response(await service.updateCountryProfile(identity.countryId, input));
    } catch (error) { return failure(error); }
  });

  server.registerTool("city.list", { description: "Получить города текущей страны.", inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => {
    try { requireScope(identity, "country:read"); return response(await service.listCities(identity.countryId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.get", { description: "Получить город, районы и задачи.", inputSchema: z.object({ cityId: z.string().uuid() }), annotations: { readOnlyHint: true } }, async ({ cityId }) => {
    try {
      requireScope(identity, "country:read");
      requireScope(identity, "tasks:read");
      const city = (await service.listCities(identity.countryId)).find((item) => item.id === cityId);
      if (!city) throw new DomainError("NOT_FOUND", "Город не найден");
      const districts = await service.listDistricts(identity.countryId, cityId);
      return response({ city, districts: await Promise.all(districts.map(async (district) => ({ ...district, workload: await service.getDistrictWorkload(identity.countryId, district.id) }))), tasks: (await service.listTasks(identity.countryId)).filter((task) => task.cityId === cityId) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("city.create", { description: "Создать город, его территорию, улицы и соединение с дорожной сетью страны.", inputSchema: cityCreateSchema, annotations: { idempotentHint: true } }, async (input) => {
    try { requireScope(identity, "cities:write"); return response(await service.createCity(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.rename", { description: "Переименовать существующий город.", inputSchema: z.object({ cityId: z.string().uuid(), name: z.string().min(2).max(100), idempotencyKey: z.string().min(4).max(160) }), annotations: { idempotentHint: true } }, async (input) => {
    try { requireScope(identity, "cities:write"); return response(await service.renameCity(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.update", {
    description: "Обновить город-эпик: название, описание, ожидаемый результат, критерии приёмки и срок.",
    inputSchema: z.object({
      cityId: z.string().uuid(), name: z.string().min(2).max(100).optional(), description: z.string().max(8000).optional(),
      goal: z.string().max(4000).optional(), acceptanceCriteria: z.string().max(8000).optional(), deadline: z.string().datetime().nullable().optional(),
      idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "cities:write"); return response(await service.updateCity(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.delete", { description: "Безвозвратно удалить город со всеми районами, задачами и городскими объектами. Для защиты передайте точное текущее название.", inputSchema: z.object({ cityId: z.string().uuid(), confirmName: z.string().min(2).max(100), idempotencyKey: z.string().min(4).max(160) }), annotations: { destructiveHint: true, idempotentHint: true } }, async (input) => {
    try { requireScope(identity, "cities:write"); return response(await service.deleteCity(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.list", { description: "Получить районы, при необходимости только одного города.", inputSchema: z.object({ cityId: z.string().uuid().optional() }), annotations: { readOnlyHint: true } }, async ({ cityId }) => {
    try {
      requireScope(identity, "country:read");
      const districts = await service.listDistricts(identity.countryId, cityId);
      return response(await Promise.all(districts.map(async (district) => ({ ...district, workload: await service.getDistrictWorkload(identity.countryId, district.id) }))));
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.create", { description: "Создать расширяемый район с улицами, тротуарами и архетипом застройки. Если archetype не передан, сервер выберет его по цели района и характеру города.", inputSchema: districtCreateSchema, annotations: { idempotentHint: true } }, async (input) => {
    try { requireScope(identity, "districts:write"); return response(await service.createDistrict(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.rename", { description: "Переименовать существующий район.", inputSchema: z.object({ districtId: z.string().uuid(), name: z.string().min(2).max(100), idempotencyKey: z.string().min(4).max(160) }), annotations: { idempotentHint: true } }, async (input) => {
    try { requireScope(identity, "districts:write"); return response(await service.renameDistrict(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.update", {
    description: "Обновить район-спринт: название, sprint goal, описание, дедлайн и ориентир нагрузки SP.",
    inputSchema: z.object({
      districtId: z.string().uuid(), name: z.string().min(2).max(100).optional(), goal: z.string().max(4000).optional(),
      description: z.string().max(8000).optional(), deadline: z.string().datetime().nullable().optional(),
      capacitySp: z.number().int().positive().optional().describe("Ориентир команды, не серверный лимит"), idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "districts:write"); return response(await service.updateDistrict(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.delete", { description: "Безвозвратно удалить район и все его задачи. Для защиты передайте точное текущее название; если район был активным, сервер активирует следующий плановый.", inputSchema: z.object({ districtId: z.string().uuid(), confirmName: z.string().min(2).max(100), idempotencyKey: z.string().min(4).max(160) }), annotations: { destructiveHint: true, idempotentHint: true } }, async (input) => {
    try { requireScope(identity, "districts:write"); return response(await service.deleteDistrict(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.activate", { description: "Сделать район активным.", inputSchema: z.object({ districtId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }), annotations: { idempotentHint: true } }, async ({ districtId, idempotencyKey }) => {
    try { requireScope(identity, "districts:write"); return response(await service.activateDistrict(identity.countryId, districtId, idempotencyKey)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.complete", { description: "Закрыть район, когда все его задачи завершены; после этого район больше не расширяется.", inputSchema: z.object({ districtId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }), annotations: { idempotentHint: true } }, async ({ districtId, idempotencyKey }) => {
    try { requireScope(identity, "districts:write"); return response(await service.completeDistrict(identity.countryId, districtId, idempotencyKey)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.list", { description: "Получить задачи, при необходимости только одного района.", inputSchema: z.object({ districtId: z.string().uuid().optional() }), annotations: { readOnlyHint: true } }, async ({ districtId }) => {
    try { requireScope(identity, "tasks:read"); return response(await service.listTasks(identity.countryId, districtId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.get", { description: "Получить задачу, Markdown-документы, чек-лист, дефекты, комментарии, MR, файлы и веб-ссылку для людей.", inputSchema: z.object({ taskId: z.string().uuid() }), annotations: { readOnlyHint: true } }, async ({ taskId }) => {
    try {
      requireScope(identity, "tasks:read");
      const task = await service.getTask(identity.countryId, taskId);
      return response({ ...task, url: taskUrl(task) });
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.create", {
    description: "Создать задачу в районе; сервер детерминированно выберет здание и при необходимости расширит район.",
    inputSchema: z.object({
      cityId: z.string().uuid(), districtId: z.string().uuid().optional(),
      title: z.string().min(2).max(160), description: z.string().max(8000).optional(),
      workItemType: z.enum(["TASK", "BUG", "RELEASE", "HOTFIX"]).optional(), acceptanceCriteria: z.string().max(8000).optional(),
      systemAnalysis: z.string().max(16000).optional(), architecture: z.string().max(16000).optional(),
      designSystem: z.string().max(16000).optional(), implementationPlan: z.string().max(16000).optional(),
      estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6)]),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(), dueAt: z.string().datetime().optional(),
      buildingHint: z.string().max(100).optional(), assigneeEmail: z.string().email().optional(),
      visualKind: z.enum(["BUILDING", "PARK"]).optional().describe("PARK создаёт привязанный к задаче парк с теми же пятью стадиями"),
      parkVariant: z.enum(["urban-formal", "urban-community", "urban-central", "urban-botanical", "urban-amusement", "urban-park"]).optional(),
      assigneeRole: z.string().max(80).optional().describe("Роль ответственного, например backend-lead, ai-agent:hermes, qa"),
      forUserEmail: z.string().email().optional().describe("Заказчик/владелец задачи — для кого делается работа"),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      const task = await service.createTask(identity.countryId, {
                                                cityId: input.cityId, districtId: input.districtId, title: input.title, description: input.description,
                                                workItemType: input.workItemType, acceptanceCriteria: input.acceptanceCriteria, systemAnalysis: input.systemAnalysis,
                                                architecture: input.architecture, designSystem: input.designSystem, implementationPlan: input.implementationPlan,
                                                estimate: input.estimate, priority: input.priority, dueAt: input.dueAt, buildingHint: input.buildingHint,
                                                visualKind: input.visualKind, parkVariant: input.parkVariant,
                                                creatorUserId: identity.userId, assigneeUserId: await resolveMember(input.assigneeEmail), assigneeRole: input.assigneeRole,
                                                forUserId: await resolveMember(input.forUserEmail), idempotencyKey: input.idempotencyKey,
                                              });
      return response({ ...task, url: taskUrl(task), workload: await service.getDistrictWorkload(identity.countryId, task.districtId) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.rename", {
    description: "Переименовать задачу и связанное с ней здание.",
    inputSchema: z.object({ taskId: z.string().uuid(), title: z.string().min(2).max(160), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "tasks:write"); return response(await service.renameTask(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.update_fields", {
    description: "Обновить постановку задачи: тип поставки, описание, критерии приёмки, системный анализ, архитектуру, дизайн-систему, план, SP, приоритет, дедлайн, роль ответственного и заказчика. Статус меняйте отдельной командой.",
    inputSchema: z.object({
      taskId: z.string().uuid(), title: z.string().min(2).max(160).optional(), description: z.string().max(8000).optional(),
      workItemType: z.enum(["TASK", "BUG", "RELEASE", "HOTFIX"]).optional(), acceptanceCriteria: z.string().max(8000).optional(),
      systemAnalysis: z.string().max(16000).optional(), architecture: z.string().max(16000).optional(), designSystem: z.string().max(16000).optional(),
      implementationPlan: z.string().max(16000).optional(), estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6)]).optional(),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(), dueAt: z.string().datetime().nullable().optional(),
      assigneeRole: z.string().max(80).optional().describe("Роль ответственного, например backend-lead, ai-agent:hermes, qa"),
      forUserEmail: z.string().email().optional().describe("Заказчик/владелец задачи"),
      idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      const forUserId = input.forUserEmail !== undefined
        ? (input.forUserEmail ? await resolveMember(input.forUserEmail) : undefined)
        : undefined;
      return response(await service.updateTaskFields(identity.countryId, {
        ...input, forUserId, actor: actorName, actorUserId: identity.userId,
      }));
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.defect_create", {
    description: "Зафиксировать связанный дефект внутри задачи с воспроизводимыми шагами и ожидаемым результатом.",
    inputSchema: z.object({
      taskId: z.string().uuid(), title: z.string().min(2).max(160), description: z.string().max(8000).optional(),
      reproductionSteps: z.string().min(1).max(12000), actualResult: z.string().min(1).max(8000), expectedResult: z.string().min(1).max(8000),
      idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "tasks:write"); return response(await service.createTaskDefect(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.defect_update", {
    description: "Вести отдельный цикл связанного дефекта: OPEN → IN_PROGRESS → VERIFYING → FIXED; при неудачной проверке VERIFYING → IN_PROGRESS, при повторном открытии FIXED → OPEN. Родительскую задачу на тестировании не откатывать.",
    inputSchema: z.object({
      defectId: z.string().uuid(), title: z.string().min(2).max(160).optional(), description: z.string().max(8000).optional(),
      reproductionSteps: z.string().trim().min(1).max(12000).optional(), actualResult: z.string().trim().min(1).max(8000).optional(), expectedResult: z.string().trim().min(1).max(8000).optional(),
      status: z.enum(["OPEN", "IN_PROGRESS", "VERIFYING", "FIXED"]).optional(), idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "tasks:write"); return response(await service.updateTaskDefect(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.delete", {
    description: "Безвозвратно удалить задачу и освободить её участок под новую задачу. Для защиты передайте точный текущий заголовок.",
    inputSchema: z.object({ taskId: z.string().uuid(), confirmTitle: z.string().min(2).max(160), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      const deleted = await service.deleteTask(identity.countryId, input);
      return response({ ...deleted, workload: await service.getDistrictWorkload(identity.countryId, deleted.districtId) });
    }
    catch (error) { return failure(error); }
  });

  const statusInput = {
    taskId: z.string().uuid(), status: z.enum(["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"]),
    progress: z.number().int().min(0).max(100).optional(), comment: z.string().max(8000).optional(), idempotencyKey: z.string().min(4).max(160),
  };
  server.registerTool("task.set_status", { description: "Перевести задачу на следующую строительную стадию.", inputSchema: z.object(statusInput), annotations: { idempotentHint: true } }, async (input) => {
    try { requireScope(identity, "tasks:write"); return response(await service.updateTaskStatus(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.report_progress", {
    description: "Обновить процент и статус задачи с обязательным комментарием.",
    inputSchema: z.object({ ...statusInput, progress: z.number().int().min(0).max(100), comment: z.string().min(1).max(8000) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "tasks:write"); return response(await service.updateTaskStatus(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.add_comment", {
    description: "Добавить комментарий без изменения стадии.",
    inputSchema: z.object({ taskId: z.string().uuid(), body: z.string().min(1).max(8000), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "comments:write"); return response(await service.addTaskComment(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.assign", {
    description: "Назначить ответственного из правительства страны или снять назначение. Можно задать роль, например ai-agent:hermes, backend-lead, qa.",
    inputSchema: z.object({
      taskId: z.string().uuid(), assigneeEmail: z.string().email().nullable(),
      assigneeRole: z.string().max(80).optional().describe("Роль ответственного, например backend-lead, ai-agent:hermes, qa"),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async ({ taskId, assigneeEmail, assigneeRole, idempotencyKey }) => {
    try {
      requireScope(identity, "tasks:write");
      return response(await service.assignTask(identity.countryId, {
                                                taskId, assigneeUserId: assigneeEmail ? await resolveMember(assigneeEmail) ?? null : null,
                                                assigneeRole, actor: actorName, actorUserId: identity.userId, idempotencyKey,
                                              }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.activity", {
    description: "Получить полную активность по задаче: события, комментарии, дефекты, вложения и связи с другими задачами (для MCP-агента как audit trail).",
    inputSchema: z.object({ taskId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, async ({ taskId }) => {
    try {
      requireScope(identity, "tasks:read");
      return response(await service.getTaskActivity(identity.countryId, taskId));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.dependency_add", {
    description: "Добавить зависимость задачи от другой задачи в том же городе. Связанная задача должна быть выполнена раньше.",
    inputSchema: z.object({ taskId: z.string().uuid(), dependsOnTaskId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      return response(await service.addTaskDependency(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.dependency_remove", {
    description: "Убрать зависимость задачи от другой задачи.",
    inputSchema: z.object({ taskId: z.string().uuid(), dependsOnTaskId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      return response(await service.removeTaskDependency(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.document_list", {
    description: "Получить четыре стандартных Markdown-документа задачи и дополнительные .md-файлы в порядке показа.",
    inputSchema: z.object({ taskId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, async ({ taskId }) => {
    try {
      requireScope(identity, "tasks:read");
      const task = await service.getTask(identity.countryId, taskId);
      return response({ taskNumber: task.taskNumber, documents: task.documents ?? [] });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.document_upsert", {
    description: "Создать или полностью обновить Markdown-документ задачи. Стандартные имена: system-analysis.md, architecture.md, design-system.md, implementation-plan.md; разрешены дополнительные kebab-case .md-файлы.",
    inputSchema: z.object({
      taskId: z.string().uuid(), fileName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,78}\.md$/),
      title: z.string().min(2).max(100).optional().describe("Обязательно только для дополнительного документа"),
      content: z.string().max(64_000), idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      return response(await service.upsertTaskDocument(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.document_delete", {
    description: "Удалить дополнительный Markdown-документ задачи. Четыре стандартных документа не удаляются: при необходимости очистите их через task.document_upsert.",
    inputSchema: z.object({ taskId: z.string().uuid(), documentId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true, destructiveHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      return response(await service.deleteTaskDocument(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.checklist_replace", {
    description: "Заменить чек-лист задачи целиком, например пунктами из implementation-plan.md. Порядок массива становится порядком выполнения; пустой массив очищает чек-лист.",
    inputSchema: z.object({
      taskId: z.string().uuid(), items: z.array(z.object({ title: z.string().min(1).max(240), done: z.boolean().optional() })).max(50),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      return response(await service.replaceTaskChecklist(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.checklist_item_update", {
    description: "Отметить отдельный пункт чек-листа выполненным/невыполненным или уточнить его название без замены остальных пунктов.",
    inputSchema: z.object({
      taskId: z.string().uuid(), itemId: z.string().uuid(), title: z.string().min(1).max(240).optional(), done: z.boolean().optional(),
      idempotencyKey: z.string().min(4).max(160),
    }).refine((value) => value.title !== undefined || value.done !== undefined, { message: "Передайте title или done" }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      return response(await service.updateTaskChecklistItem(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.link_add", {
    description: "Прикрепить к задаче ссылку на merge request (или другой http/https URL), чтобы она была видна в карточке задачи.",
    inputSchema: z.object({
      taskId: z.string().uuid(), url: z.string().min(8).max(2000), title: z.string().max(200).optional(),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      const task = await service.addTaskLink(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId });
      return response({ taskNumber: task.taskNumber, mergeRequests: task.mergeRequests, url: taskUrl(task) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.link_remove", {
    description: "Убрать ссылку на merge request из задачи.",
    inputSchema: z.object({ taskId: z.string().uuid(), url: z.string().min(8).max(2000), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      const task = await service.removeTaskLink(identity.countryId, { ...input, actor: actorName, actorUserId: identity.userId });
      return response({ taskNumber: task.taskNumber, mergeRequests: task.mergeRequests, url: taskUrl(task) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.attachment_add", {
    description: "Прикрепить к задаче файл любого формата (логи, скриншоты, схемы): имя, необязательный MIME и содержимое в base64.",
    inputSchema: z.object({
      taskId: z.string().uuid(), fileName: z.string().min(1).max(200), mimeType: z.string().max(120).optional(),
      contentBase64: z.string().min(1), idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      requireScope(identity, "tasks:write");
      const attachment = await service.addTaskAttachment(identity.countryId, {
        taskId: input.taskId, fileName: input.fileName, mimeType: input.mimeType,
        content: Buffer.from(input.contentBase64, "base64"),
        actor: actorName, actorUserId: identity.userId, idempotencyKey: input.idempotencyKey,
      });
      return response(attachment);
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.attachment_list", {
    description: "Получить список файлов, прикреплённых к задаче.",
    inputSchema: z.object({ taskId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, async ({ taskId }) => {
    try {
      requireScope(identity, "tasks:read");
      const task = await service.getTask(identity.countryId, taskId);
      return response({ taskNumber: task.taskNumber, attachments: task.attachments ?? [] });
    } catch (error) { return failure(error); }
  });

  server.registerTool("archive.get", {
    description: "Получить Государственный архив страны и текущую стадию его комплекса на карте.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    try { requireScope(identity, "country:read"); return response(await service.getArchive(identity.countryId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_list", {
    description: "Получить компактные устойчивые справки проекта из Государственного архива.",
    inputSchema: z.object({}), annotations: { readOnlyHint: true },
  }, async () => {
    try { requireScope(identity, "tasks:read"); return response(await service.listArchiveRecords(identity.countryId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_create", {
    description: "Добавить в Государственный архив устойчивый контекст, правило, репозиторий, окружение или шаблон. Не используйте архив вместо задачи.",
    inputSchema: z.object({
      kind: z.enum(["PROJECT", "REPOSITORY", "ARCHITECTURE", "CONVENTION", "ENVIRONMENT", "TEMPLATE"]),
      title: z.string().min(2).max(160), body: z.string().max(32000).optional(), sourceUrl: z.string().url().max(2000).optional(),
      tags: z.array(z.string().max(40)).max(10).optional(),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "cities:write"); return response(await service.createArchiveRecord(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_update", {
    description: "Обновить запись Государственного архива.",
    inputSchema: z.object({
      recordId: z.string().uuid(), kind: z.enum(["PROJECT", "REPOSITORY", "ARCHITECTURE", "CONVENTION", "ENVIRONMENT", "TEMPLATE"]).optional(),
      title: z.string().min(2).max(160).optional(), body: z.string().max(32000).optional(), sourceUrl: z.string().url().max(2000).nullable().optional(),
      tags: z.array(z.string().max(40)).max(10).optional(),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "cities:write"); return response(await service.updateArchiveRecord(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_delete", {
    description: "Удалить запись Государственного архива. Для защиты передайте точное текущее название.",
    inputSchema: z.object({ recordId: z.string().uuid(), confirmTitle: z.string().min(2).max(160), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async (input) => {
    try { requireScope(identity, "cities:write"); return response(await service.deleteArchiveRecord(identity.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerResource("current-country", "tasktopia://country/current", { mimeType: "application/json" }, async (uri) => {
    requireScope(identity, "country:read");
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ country: await service.getCountry(identity.countryId), archive: await service.getArchive(identity.countryId), cities: await service.listCities(identity.countryId) }, null, 2) }],
    };
  });
  server.registerResource("building-catalog", "tasktopia://catalog/buildings", { mimeType: "application/json" }, (uri) => {
    requireScope(identity, "country:read");
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(BUILDING_CATALOG, null, 2) }],
    };
  });

  return server;
}

function identityFromAuthInfo(authInfo: AuthInfo | undefined): McpIdentity {
  const identity = authInfo?.extra?.tasktopiaIdentity as McpIdentity | undefined;
  if (!identity?.userId || !identity.countryId || !identity.tokenId || !Array.isArray(identity.scopes)) {
    throw new DomainError("UNAUTHENTICATED", "MCP request не содержит проверенную Tasktopia identity");
  }
  return identity;
}

export function createTasktopiaMcpHandler(db: Db, service: AppService, onerror?: (error: Error) => void): McpHttpHandler {
  return createMcpHandler(
    ({ authInfo }) => createMcpServer(db, service, identityFromAuthInfo(authInfo)),
    { legacy: "stateless", responseMode: "auto", onerror },
  );
}
