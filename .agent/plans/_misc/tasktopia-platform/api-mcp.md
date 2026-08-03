# HTTP, MCP и realtime contracts

## Общий принцип

`HTTP controller -> application command/query <- MCP tool`

HTTP и MCP являются адаптерами. Они используют одинаковые схемы, authorization context, domain errors, транзакции и idempotency store.

## Auth surfaces

### Web session

- Secure, HttpOnly, SameSite cookie.
- Email verification обязательна перед созданием production API key.
- CSRF/origin protection для изменяющих HTTP endpoints.

### MCP token MVP

- Пользователь создаёт named token в `/settings/integrations`.
- Секрет показывается один раз.
- Формат prefix: `ttp_mcp_...`.
- В БД хранится только hash, prefix/start, scopes, expiration, last used и revoke state.
- Передача: `Authorization: Bearer <token>`; допустим настраиваемый `x-api-key` для клиентов без Bearer header.
- Rate limit на key и country.
- Scopes:
  - `country:read`;
  - `projects:write`;
  - `sprints:write`;
  - `tasks:read`;
  - `tasks:write`;
  - `comments:write`.

Перед публичным multi-user релизом MCP authorization переводится на OAuth 2.1 с Protected Resource Metadata, Authorization Server Metadata и PKCE. Персональный token остаётся режимом локальной/доверенной интеграции.

## MCP transport

- Endpoint: `POST|GET /mcp`.
- Transport: Streamable HTTP.
- Origin allowlist проверяется до MCP session.
- Local server bind: `127.0.0.1` по умолчанию.
- SDK version pinned; имена методов регистрации сверяются с официальной документацией при реализации.
- WebSocket используется UI-клиентом, но не заменяет MCP transport.

## Общие поля mutation tools

```ts
type MutationMeta = {
  idempotencyKey: string; // UUID или stable caller key
  requestSource?: string; // имя агента/интеграции
};

type MutationResult<T> = {
  data: T;
  worldVersion: number;
  operation?: {
    id: string;
    status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  };
};
```

## MVP MCP tools

### Country/read

#### `country.get_current`

Возвращает country id/name, seed fingerprint, world version, project summary и active operations. Полный seed наружу не нужен.

#### `operation.get`

Input: `operationId`. Используется для city/worldgen jobs.

### Projects/cities

#### `project.create`

Input:

```ts
{
  name: string;
  description?: string;
  externalKey?: string;
  cityName?: string;
  idempotencyKey: string;
}
```

Result сразу содержит project и operation. City placement выполняется worker, поэтому состояние может быть `GENERATING`; повтор команды не создаёт второй город.

#### `project.list`

Фильтры status, pagination. Возвращает city readiness и active sprint.

#### `project.get`

Input: `projectId | externalKey`. Возвращает plan summary, city, sprint counts и task stats.

#### `project.update`

Разрешает менять name, description и plan fields. Географию не меняет.

#### `project.archive`

Архивирует рабочую сущность; город остаётся на карте и визуально помечается архивным.

### Sprints/districts

#### `sprint.create`

Input:

```ts
{
  projectId: string;
  name: string;
  goal?: string;
  capacitySp?: number; // default 14, allowed 1..26 MVP
  startsAt?: string;
  endsAt?: string;
  activate?: boolean;
  idempotencyKey: string;
}
```

Создаёт sprint и district allocation operation. `activate=true` допустимо, только если у проекта нет active sprint.

#### `sprint.activate`

Input: `sprintId`, `idempotencyKey`. Гарантирует единственный active sprint проекта.

#### `sprint.complete`

Не требует завершения всех задач, но возвращает warning/confirmation policy. В MCP MVP лучше требовать `allowIncomplete: true` для явного подтверждения.

#### `sprint.list`, `sprint.get`

Возвращают capacity/planned SP, district status, tasks by status.

### Tasks/buildings

#### `task.create`

```ts
{
  projectId: string;
  sprintId?: string; // без него используется active sprint проекта
  title: string;
  description?: string;
  estimate: 1 | 2 | 3 | 6;
  priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  dueAt?: string;
  externalKey?: string;
  buildingHint?: {
    category?: string;
    catalogKey?: string;
  };
  idempotencyKey: string;
}
```

Создаёт task в `PLANNING`. Building assignment может завершиться в той же команде или отдельным operation, но результат всегда содержит состояние назначения.

#### `task.update`

Изменяет title, description, priority, estimate или due date. Изменение estimate после начала работы не меняет footprint автоматически; оно создаёт review warning.

#### `task.set_status`

Input: `taskId`, `status`, optional `comment`, `idempotencyKey`. Проверяет state machine.

#### `task.report_progress`

Input: `taskId`, `percent`, обязательный `comment`, optional `status`, `idempotencyKey`. Создаёт progress record и comment одной транзакцией.

#### `task.add_comment`

Input: `taskId`, `body`, optional metadata, `idempotencyKey`.

#### `task.reopen`

Input: `taskId`, target status, обязательная причина. Отдельный audit event.

#### `task.list`, `task.get`

Фильтры project/sprint/status/priority/due window. `task.get` включает comments cursor, transitions и building state.

## Не добавлять в MVP

- универсальный `execute_sql` или `update_anything`;
- инструменты, принимающие произвольный JSON без schema;
- `task.delete` с физическим удалением;
- ручное указание hex coordinates обычным MCP-клиентом;
- tool, который одновременно создаёт country/project/sprint/tasks без промежуточных ошибок и идемпотентности.

Позже можно добавить `plan.import`, но как orchestrated command с dry-run, validation report и ограничением размера.

## MCP resources

- `tasktopia://country/current`
- `tasktopia://projects`
- `tasktopia://projects/{projectId}`
- `tasktopia://sprints/{sprintId}`
- `tasktopia://tasks/{taskId}`
- `tasktopia://tasks/{taskId}/comments`
- `tasktopia://operations/{operationId}`
- `tasktopia://catalog/buildings`

World chunks не являются главным MCP resource: это renderer payload, который AI обычно не должен читать.

## Domain error contract

```ts
type DomainError = {
  code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN_SCOPE"
    | "NOT_FOUND"
    | "CONFLICT"
    | "INVALID_TRANSITION"
    | "NO_ACTIVE_SPRINT"
    | "CAPACITY_EXCEEDED"
    | "PLACEMENT_UNAVAILABLE"
    | "OPERATION_PENDING"
    | "RATE_LIMITED";
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  correlationId: string;
};
```

Raw stack traces, SQL errors и token fragments никогда не возвращаются MCP-клиенту.

## HTTP read API для веба

- `GET /api/bootstrap`
- `GET /api/countries/current/snapshot?sinceVersion=`
- `GET /api/chunks/:chunkQ/:chunkR`
- `GET /api/projects`
- `GET /api/projects/:id`
- `GET /api/sprints/:id`
- `GET /api/tasks/:id`
- `GET /api/tasks/:id/comments?cursor=`
- Better Auth endpoints
- API key create/list/revoke endpoints

Веб не вызывает project/sprint/task mutation endpoints. Если внутренние endpoints нужны для MCP adapter, они не публикуются UI client bundle.

## Idempotency

- Уникальный индекс `(country_id, tool_name, idempotency_key)`.
- Сохраняются request hash, final status и response DTO.
- Тот же key + тот же hash возвращает исходный ответ.
- Тот же key + другой payload возвращает `CONFLICT`.
- Pending request возвращает operation, а не стартует второй job.
- Retention минимум 30 дней для MCP mutations.

## Audit

Для каждой мутации сохраняются actor user/key, tool, entity ids, correlation id, before/after summary, event ids и timestamp. Секреты и полные описания задач не копируются в технические логи без необходимости.

