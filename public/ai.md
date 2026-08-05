# Tasktopia AI integration guide

Version: 1.7.0
Last updated: 2026-08-05  
Public guide: https://tasktopia.online/ai.md  
MCP endpoint: https://tasktopia.online/mcp

Tasktopia turns work into a living country. Countries contain cities, cities
contain districts, and every task is represented by a building.

This document is intended for AI agents and developers integrating through the
Model Context Protocol (MCP).

## Work model: what every entity means

Tasktopia is not only a visualization. Its hierarchy is the working context an
AI must preserve:

| Entity | Project-management meaning | Use it for |
| --- | --- | --- |
| Country | An independent project, product, or workspace | The top-level goal, access boundary, and portfolio context |
| City | A long-lived project association, product direction, epic, or subproject | Grouping work that shares one stable domain and outcome |
| District | A sprint, iteration, milestone, phase, or bounded work package | A goal and advisory workload target for the current delivery cycle |
| Task/building | One concrete, verifiable unit of work | An outcome with acceptance criteria, estimate, owner, and progress |

Do not create a city for one task, use a district as a label, or move work into
an arbitrary entity because its ID is convenient. When the country, city, or
district is ambiguous, read the available hierarchy and ask the user before a
write. A city is the association between a task stream and its project
direction; it is normally longer-lived than a sprint.

## Install the progress-management skill

A production-ready Codex skill is published at:

`https://tasktopia.online/skills/tasktopia-progress/SKILL.md`

It adds context resolution, mandatory clarification rules, task-writing
templates, evidence-based progress reporting, blocking workflow, safe status
transitions, and completion gates. Install it globally for the current user:

```bash
mkdir -p ~/.codex/skills/tasktopia-progress/agents
curl -fsS https://tasktopia.online/skills/tasktopia-progress/SKILL.md \
  -o ~/.codex/skills/tasktopia-progress/SKILL.md
curl -fsS https://tasktopia.online/skills/tasktopia-progress/agents/openai.yaml \
  -o ~/.codex/skills/tasktopia-progress/agents/openai.yaml
```

Start a new Codex task after installation so the skill catalog is refreshed.
Invoke it explicitly when needed:

```text
Используй $tasktopia-progress. Проверь текущий проект, найди нужное направление
и итерацию, затем поставь задачу и веди её прогресс по фактическим результатам.
```

The skill does not contain a personal key. Configure the MCP endpoint and
Bearer key separately as described below. Other agents can use the same
`SKILL.md` as a system/workflow instruction even if they do not support the
Codex skill directory convention.

## Quick start

1. Sign in at https://tasktopia.online.
2. Open the account panel and create a personal MCP key.
3. Copy the key immediately. Its secret is shown only once.
4. Configure an MCP client with the endpoint and an Authorization header.
5. Call `country.get_current`, then read the relevant city, district, and task
   before making changes.

Generic client configuration:

```json
{
  "mcpServers": {
    "tasktopia": {
      "url": "https://tasktopia.online/mcp",
      "headers": {
        "Authorization": "Bearer <PERSONAL_MCP_KEY>"
      }
    }
  }
}
```

The key begins with `ttp_mcp_`. Use the exact `Authorization: Bearer ...`
format. Query-string tokens, cookies, `X-API-Key`, and bare tokens are not
accepted.

## Transport and protocol

- Transport: MCP Streamable HTTP at `https://tasktopia.online/mcp`.
- Current protocol: MCP 2026-07-28.
- Compatibility: stateless MCP 2025-11-25 clients are accepted.
- HTTP methods: `POST` for JSON-RPC; `GET` and `DELETE` are part of the
  Streamable HTTP transport lifecycle.
- Each request must carry the personal Bearer key.
- Send `Content-Type: application/json` for JSON-RPC requests.
- Browser clients must originate from `https://tasktopia.online`.

Tasktopia currently uses user-created personal API keys. It does not advertise
an OAuth authorization-server flow. Do not attempt OAuth discovery for this
endpoint.

## Permissions

A key can contain any combination of these scopes:

| Scope | Allows |
| --- | --- |
| `country:read` | Read the selected country and list available countries |
| `cities:write` | Create, rename, and delete cities |
| `districts:write` | Create, rename, activate, complete, and delete districts |
| `tasks:read` | Read tasks and task details |
| `tasks:write` | Create, update, report progress, assign, and delete tasks |
| `comments:write` | Add task comments |

Request only the permissions an integration needs. A key is bound to its owner.
The selected country belongs to the account, not to an individual key, so
`country.select` affects later MCP requests made by every key of that account.

## Safe agent workflow

Follow this sequence unless the user explicitly asks for something else:

1. Call `country.get_current`.
2. If needed, call `country.list` and then `country.select`.
3. Call `city.list`; do not invent city IDs.
4. Call `district.list` for the relevant city.
5. Call `task.list` and `task.get` before updating an existing task.
6. Make the smallest requested change.
7. Re-read the changed entity and report the result to the user.

Before creating work, ask only for information that remains genuinely
ambiguous. A compact confirmation should cover: country/project,
city/direction, district/iteration, expected task outcome, acceptance evidence,
estimate, and assignee when assignment matters. If exactly one matching context
exists, the agent may use it after stating the assumption.

For progress-centric operation:

1. Read `task.get` before every update.
2. Use `task.report_progress` after a measurable checkpoint, not on a timer.
3. Base the percentage on completed acceptance criteria or verified artifacts,
   never on effort spent.
4. Record blockers with `task.add_comment` without inflating progress.
5. Enter `TESTING` only after implementation is complete and a verification
   method exists.
6. Enter `COMPLETED` at 100% only after every acceptance criterion is verified.

Exact progress ranges are `PLANNING = 0`, `STARTED = 0`, `IN_PROGRESS = 1–79`,
`TESTING = 80–99`, and `COMPLETED = 100`.

For every retried mutation, reuse the same `idempotencyKey`. Generate a new
idempotency key for a new user intent. Never place the personal MCP key in task
text, comments, logs, or tool arguments.

## Tools

The server exposes 23 tools.

### Countries

#### `country.get_current`

Returns the country currently selected for this account. No arguments.

Required scope: `country:read`.

#### `country.list`

Lists countries available to the owner. No arguments.

Required scope: `country:read`.

#### `country.select`

Selects the country used by subsequent requests.

Arguments:

```json
{ "countryId": "<country-id>" }
```

Required scope: `country:read`.

### Cities

#### `city.list`

Lists cities in the selected country. No arguments.

Required scope: `country:read`.

#### `city.get`

Reads one city.

```json
{ "cityId": "<city-id>" }
```

Required scopes: `country:read` and `tasks:read`.

#### `city.create`

Creates a city in the selected country.

```json
{
  "name": "Payments platform",
  "description": "Optional city goal",
  "morphology": "BALANCED",
  "idempotencyKey": "create-city-payments-v1"
}
```

`description` and `morphology` are optional. `idempotencyKey` is required.
Allowed morphology values are `BALANCED`, `DENSE_CORE`, `GARDEN_CITY`, and
`POLYCENTRIC`. Reuse the same idempotency key when retrying this exact creation.

Required scope: `cities:write`.

#### `city.rename`

Renames an existing city.

```json
{ "cityId": "<city-id>", "name": "New city name", "idempotencyKey": "rename-city-v1" }
```

Required scope: `cities:write`.

#### `city.delete`

Permanently deletes a city and cascades its districts, tasks, comments, and city features. City-local roads are removed; only genuine highway or through-road components are retained as shared infrastructure. The response includes `roadsDeleted`. Pass the exact current name to prevent accidental deletion.

```json
{ "cityId": "<city-id>", "confirmName": "Exact city name", "idempotencyKey": "delete-city-v1" }
```

Required scope: `cities:write`. This operation is destructive; always read the city and ask the user for explicit deletion intent first.

### Districts

#### `district.list`

Lists districts. Omit `cityId` to list districts across all cities in the
selected country.

```json
{ "cityId": "<optional-city-id>" }
```

Required scope: `country:read`.

#### `district.create`

Creates a district.

```json
{
  "cityId": "<city-id>",
  "name": "Northern district",
  "goal": "Ship billing recovery",
  "capacitySp": 40,
  "activate": false,
  "archetype": "COMMERCIAL",
  "idempotencyKey": "create-sprint-12-v1"
}
```

`cityId`, `name`, and `idempotencyKey` are required. Allowed archetypes are
`NEW_BUILD`, `PRIVATE`, `MIXED_URBAN`, `COMMERCIAL`, and `CIVIC`.
`capacitySp` is an optional positive planning target. It never blocks task
creation: sprint duration, team size, parallel owners, and actual workload are
for the team to evaluate. `district.list`, `city.get`, `task.create`, and
`task.delete` expose `workload` with `targetSp`, `plannedSp`, `openSp`,
`taskCount`, and `overTargetBySp`. Do not create an extra district merely
because the target is exceeded.

Required scope: `districts:write`.

#### `district.delete`

Permanently deletes a district and all of its tasks. If the deleted district was active, the oldest planned district becomes active automatically.

```json
{ "districtId": "<district-id>", "confirmName": "Exact district name", "idempotencyKey": "delete-district-v1" }
```

Required scope: `districts:write`. Read the district and its tasks, state the cascade, and require explicit user intent before calling it.

#### `district.rename`

Renames an existing district without changing its geometry or status.

```json
{ "districtId": "<district-id>", "name": "New district name", "idempotencyKey": "rename-district-v1" }
```

Required scope: `districts:write`.

#### `district.activate`

Marks a district as active.

```json
{
  "districtId": "<district-id>",
  "idempotencyKey": "activate-sprint-12-v1"
}
```

Required scope: `districts:write`.

#### `district.complete`

Completes a district.

```json
{
  "districtId": "<district-id>",
  "idempotencyKey": "complete-sprint-12-v1"
}
```

Required scope: `districts:write`.

### Tasks and buildings

#### `task.list`

Lists tasks. Omit `districtId` to list across the selected context.

```json
{ "districtId": "<optional-district-id>" }
```

Required scope: `tasks:read`.

#### `task.get`

Reads one task with its current state.

```json
{ "taskId": "<task-id>" }
```

Required scope: `tasks:read`.

#### `task.create`

Creates a task/building.

```json
{
  "cityId": "<city-id>",
  "districtId": "<optional-district-id>",
  "title": "Add retry policy",
  "description": "Optional acceptance context",
  "estimate": 3,
  "priority": "HIGH",
  "dueAt": "2026-08-12T12:00:00.000Z",
  "assigneeEmail": "person@example.com",
  "idempotencyKey": "create-task-retry-policy-v1"
}
```

Required fields: `cityId`, `title`, `estimate`, and `idempotencyKey`. Allowed
estimates are `1`, `2`, `3`, or `6`. Allowed priorities are `LOW`, `NORMAL`,
`HIGH`, and `CRITICAL`.

`buildingHint` is an optional exact building key. Read
`tasktopia://catalog/buildings` first and use only a compatible catalog key;
omit the field when no exact building was requested.

Required scope: `tasks:write`.

#### `task.delete`

Permanently deletes one task/building and releases its planned lot so a later task can reuse it.

```json
{ "taskId": "<task-id>", "confirmTitle": "Exact task title", "idempotencyKey": "delete-task-v1" }
```

Required scope: `tasks:write`. Read the task first and require explicit deletion intent.

#### `task.rename`

Renames a task and the title associated with its building. The change is added
to the task event history.

```json
{ "taskId": "<task-id>", "title": "New task title", "idempotencyKey": "rename-task-v1" }
```

Required scope: `tasks:write`.

#### `task.set_status`

Moves a task to a valid workflow state. Optionally records progress and a
comment in the same operation.

```json
{
  "taskId": "<task-id>",
  "status": "IN_PROGRESS",
  "progress": 35,
  "comment": "API contract implemented",
  "idempotencyKey": "task-status-api-contract-v1"
}
```

Required scope: `tasks:write`.

#### `task.report_progress`

Reports status, progress, and a progress comment together.

```json
{
  "taskId": "<task-id>",
  "status": "IN_PROGRESS",
  "progress": 70,
  "comment": "Tests pass; browser QA remains",
  "idempotencyKey": "task-progress-browser-qa-v1"
}
```

Required scope: `tasks:write`.

#### `task.add_comment`

Adds a comment without changing task status.

```json
{
  "taskId": "<task-id>",
  "body": "Blocked pending access approval",
  "idempotencyKey": "comment-access-blocker-v1"
}
```

Required scope: `comments:write`.

#### `task.assign`

Assigns a task by account email. Set `assigneeEmail` to `null` to unassign.

```json
{
  "taskId": "<task-id>",
  "assigneeEmail": "person@example.com",
  "idempotencyKey": "assign-task-person-v1"
}
```

Required scope: `tasks:write`.

## Resources

### `tasktopia://country/current`

Returns the current country and its cities. Use it to orient an agent before
planning work.

Required scope: `country:read`.

### `tasktopia://catalog/buildings`

Returns the supported building catalog used by task visualization.

Required scope: `country:read`.

## Responses and errors

Successful tools return structured MCP content. The primary machine-readable
payload is under `structuredContent.result`; a JSON text representation is also
provided for clients that consume text content.

Transport-level failures:

- `401 Unauthorized`: missing, malformed, expired, or revoked Bearer key;
- `403 Forbidden`: a browser Origin is not allowed;
- `429 Too Many Requests`: rate limit reached; wait before retrying;

Validated tool calls return protocol-level MCP results. Missing scopes, invalid
or inaccessible IDs, conflicts, invalid transitions, and domain validation
failures are returned as MCP tool results with `isError: true`, not as HTTP
`403`, `404`, or `409`. Inspect the returned error content and never silently
assume a mutation succeeded.

On ambiguous network failure, read the entity before retrying. If a retry is
still necessary, reuse the original `idempotencyKey`.

## Agent rules

- Confirm the selected country before writing.
- Never guess entity IDs or silently create substitute entities.
- Preserve the user's hierarchy: country → city → district → task/building.
- Prefer one small, verifiable mutation at a time.
- Respect task transition rules reported by the server.
- Do not mark work complete merely because code was generated.
- After a mutation, verify the resulting entity and explain what changed.
- Treat the personal MCP key as a password and never expose it in output.

## Human links

- Application: https://tasktopia.online
- MCP guide: https://tasktopia.online/ai.md
- Progress skill: https://tasktopia.online/skills/tasktopia-progress/SKILL.md
- MCP endpoint: https://tasktopia.online/mcp
