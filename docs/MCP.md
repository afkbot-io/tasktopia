# MCP и API

Production endpoint: `https://tasktopia.online/mcp`. Транспорт — Streamable HTTP. Сервер использует актуальный MCP `2026-07-28` и принимает stateless-клиенты `2025-11-25` в режиме совместимости. `POST` передаёт JSON-RPC, а `GET`/`DELETE` обслуживаются транспортным lifecycle.

Самодостаточная публичная инструкция, которую можно передать ИИ без доступа к репозиторию: [https://tasktopia.online/ai.md](https://tasktopia.online/ai.md).

Готовый Codex skill для выбора проектного контекста, постановки задач и ведения прогресса: [https://tasktopia.online/skills/tasktopia-progress/SKILL.md](https://tasktopia.online/skills/tasktopia-progress/SKILL.md). Установка и правила вызова приведены в публичной AI-инструкции.

## Внутренний API обзорной карты

Аутентифицированный браузер получает обзор страны через `GET /api/country-atlas`.
Это не MCP resource и не замена `country.get_current`/`city.list`: endpoint
предназначен только для UI. Контракт `schemaVersion: 5` содержит `terrainSeed`,
общие `bounds`, города с обязательным `labelAnchor` и районы с обязательным
`progress` (`0..100`). Природные клетки в ответ не входят — браузер
восстанавливает их из canonical seed.

Ответ использует ETag и `Cache-Control: private, max-age=30,
stale-while-revalidate=300`. Клиент сначала рисует schema-gated snapshot из
`sessionStorage`, затем обязательно выполняет conditional revalidation.
Комментарии и невизуальные поля snapshot не инвалидируют; статус задачи
патчит здание и агрегат района, структурные события города/района/задачи
пересобирают проекцию.

## Быстрое подключение

1. В Tasktopia откройте кнопку «MCP-интеграции» или «Подключить MCP».
2. Скопируйте URL `https://tasktopia.online/mcp`.
3. Создайте персональный ключ с минимально необходимыми scopes.
4. В MCP-клиенте выберите Streamable HTTP и передайте `Authorization: Bearer <ключ>`.

Ключ нельзя добавлять в query string или хранить в открытом конфигурационном файле. Используйте secret storage клиента. Каждый метод `/mcp` требует действующий Bearer-ключ; запрос без него получает `401` и стандартный `WWW-Authenticate: Bearer` challenge.

```json
{
  "mcpServers": {
    "tasktopia": {
      "url": "https://tasktopia.online/mcp",
      "headers": { "Authorization": "Bearer ttp_mcp_..." }
    }
  }
}
```

Ключ создаётся в разделе MCP и показывается только один раз. В PostgreSQL хранится только SHA-256 hash. Новый персональный ключ отзывает предыдущий активный ключ пользователя, а команды выполняются от его имени в явно указанной стране. Принимается только точный заголовок `Authorization: Bearer ttp_mcp_...`: `X-API-Key`, bare token, cookie и query-параметры отклоняются. Эти персональные ключи не являются OAuth-токенами, поэтому endpoint не публикует фиктивный OAuth discovery.

При выпуске выбираются срок `30 | 90 | 365` дней и непустое подмножество scopes:

- `country:read` — страны, города, районы и MCP resources; полный `city.get` дополнительно требует `tasks:read` из-за списка задач;
- `cities:write` — профиль страны и Государственный архив, создание, обновление, переименование и безопасное удаление городов;
- `districts:write` — создание, обновление, переименование, смена состояния и безопасное удаление районов;
- `tasks:read` — чтение задач;
- `tasks:write` — создание/уточнение задач и связанных дефектов, назначение, смена стадии и безопасное удаление задач;
- `comments:write` — добавление комментариев.

Глава страны и министр могут выбрать любые scopes. Наблюдателю доступны только `country:read` и `tasks:read`. `country.list` не требует контекста; каждый другой MCP tool принимает обязательный `countryId`. Сервер заново проверяет членство и текущую роль пользователя именно в этой стране на каждом вызове, поэтому `countryId` нельзя использовать для обхода доступа, а страна, выбранная в веб-интерфейсе, не влияет на MCP. Истёкший, отозванный, повреждённый или пустой по разрешениям ключ отклоняется. Существующие ключи с `expires_at = NULL` продолжают работать до отзыва; все новые имеют явный срок.

## Основные инструменты

- `country.get`, `country.list`, `country.update_profile`
- `archive.get`, `archive.record_list`, `archive.record_create`, `archive.record_update`, `archive.record_delete`
- `city.list`, `city.get`, `city.create`, `city.update`, `city.rename`, `city.delete`
- `district.list`, `district.create`, `district.update`, `district.rename`, `district.activate`, `district.complete`, `district.delete`
- `task.list`, `task.get`, `task.create`, `task.update_fields`, `task.rename`, `task.delete`
- `world_generation.get` — состояние принятой фоновой генерации по `jobId`
- `task.defect_create`, `task.defect_update`
- `task.set_status`, `task.report_progress`, `task.add_comment`, `task.assign`
- `task.document_list`, `task.document_upsert`, `task.document_delete`
- `task.checklist_replace`, `task.checklist_item_update`
- `task.activity`, `task.dependency_add`, `task.dependency_remove`, `task.link_add`, `task.link_remove`, `task.attachment_add`, `task.attachment_list`

## Фоновая генерация

`city.create`, `district.create`, `task.create` и `country.regenerate` сначала сохраняют durable job с уникальным `(country, operation, idempotencyKey)`. MCP ограниченно ждёт результат. Если геометрия успела построиться, контракт не меняется; если ожидание превысило `GENERATION_WAIT_MS`, вызов остаётся успешным и возвращает:

```json
{
  "status": "accepted",
  "job": { "id": "<uuid>", "operation": "task.create", "status": "PENDING" }
}
```

Это не ошибка и не повод повторять write с новым ключом. Опрашивайте `world_generation.get` с тем же `job.id`; `COMPLETED` содержит `result`, окончательный `FAILED` — безопасные `error.code/message`. Повтор исходной команды с тем же idempotency key и тем же payload возвращает тот же job/result; другой payload даёт `CONFLICT`.

## Минимальный сценарий

Создать город:

```json
{
  "countryId": "<uuid страны>",
  "name": "Northpoint",
  "description": "Основной продуктовый город",
  "idempotencyKey": "northpoint-v1"
}
```

Создать и активировать район:

```json
{
  "countryId": "<uuid страны>",
  "cityId": "<uuid города>",
  "name": "Release Quarter",
  "goal": "Подготовить релиз",
  "capacitySp": 14,
  "archetype": "NEW_BUILD",
  "activate": true,
  "idempotencyKey": "release-quarter-v1"
}
```

`archetype` необязателен: `NEW_BUILD | PRIVATE | MIXED_URBAN | COMMERCIAL | CIVIC`. `PRIVATE` сохранён как стабильный legacy-код и теперь означает район низко- и среднеэтажных ЖК; `NEW_BUILD` означает средне- и высокоэтажные ЖК. Отдельных частных домов в активном каталоге нет. Без архетипа сервер выводит тип из названия/цели района, morphology города и уже существующей застройки. Архетип влияет на участки и автоматический выбор зданий, но не меняет смысл явно переданного `buildingHint`.

`capacitySp` — только положительный ориентир нагрузки. Сервер не блокирует задачи при его превышении: допустимая загрузка зависит от длительности итерации, размера команды и распределения исполнителей. `district.list`, `city.get`, `task.create` и `task.delete` возвращают `workload`: ориентир `targetSp`, общую оценку `plannedSp`, незавершённую `openSp`, число задач и `overTargetBySp`. MCP-агент показывает эти данные пользователю, но не создаёт новый район без его решения.

Удаление использует отдельные destructive-инструменты и точное подтверждение текущего названия: `task.delete` принимает `confirmTitle`, а `district.delete` и `city.delete` — `confirmName`. Район удаляется вместе с задачами и принадлежащими ему парками/декором; активный район передаёт активность следующему плановому. Город удаляется с районами, задачами, городскими features и локальными улицами; сохраняются только highway и настоящие сквозные компоненты общей дорожной сети.

Добавить задачу в активный район:

```json
{
  "countryId": "<uuid страны>",
  "cityId": "<uuid города>",
  "title": "Открыть районную аптеку",
  "description": "Каталог, поиск и карточка лекарства",
  "workItemType": "TASK",
  "acceptanceCriteria": "Основные сценарии и ошибки покрыты проверками",
  "estimate": 3,
  "priority": "HIGH",
  "assigneeEmail": "member@example.com",
  "assigneeRole": "backend-lead",
  "forUserEmail": "product-owner@example.com",
  "idempotencyKey": "task-pharmacy-v1"
}
```

`districtId` у `task.create` необязателен: без него используется активный район города. `buildingHint` позволяет запросить конкретный ключ из `tasktopia://catalog/buildings`; если вариант нарушает квоту или несовместим с архитектурой района, сервер возвращает явную ошибку. Ключи `landmark-*` — не готовый декор: это уникальные здания задач, которые проходят те же пять стадий вместе со статусом задачи. В одном городе может существовать только одна такая задача-ориентир; Государственный архив остаётся отдельным объектом страны.

`assigneeEmail` необязателен, но указанный человек должен быть зарегистрирован и состоять в правительстве переданной страны. `assigneeRole` фиксирует роль исполнителя в конкретной работе (`backend-lead`, `qa`, `ai-agent:codex`), а `forUserEmail` — зарегистрированного заказчика/владельца результата. Создателем задачи автоматически становится владелец персонального MCP-ключа; создатель, исполнитель и заказчик могут различаться. Назначение и роль можно позже изменить через `task.assign`, заказчика — через `task.update_fields`.

Материалы реализации хранятся как документы задачи. После создания агент
заполняет `system-analysis.md`, `architecture.md`, `design-system.md` и
`implementation-plan.md` через `task.document_upsert`; при необходимости
добавляет другие kebab-case `.md`. По согласованному плану агент вызывает
`task.checklist_replace`, а по ходу работы отмечает пункты через
`task.checklist_item_update`. Человек просматривает документы, чек-лист, MR и
историю в карточке, но не редактирует задачу вручную в UI.

Зависимости задаются через `task.dependency_add/remove` только между задачами
одного города. Commit, MR/PR, CI run и другие постоянные HTTP(S)-артефакты
связываются через `task.link_add/remove`. Логи, скриншоты и другие файлы агент
передаёт в Base64 через `task.attachment_add`, а перед повторным добавлением
проверяет `task.attachment_list`. Полная хроника доступна через `task.activity`.

`country.update_profile`, `city.update`, `district.update` и `task.update_fields`
меняют только переданные поля и сохраняют ID. Пустая строка очищает текст,
`deadline: null`/`dueAt: null` снимает дату. Тип задачи:
`TASK | BUG | RELEASE | HOTFIX`. Связанные наблюдения создаются отдельно через
`task.defect_create` с шагами, фактическим и ожидаемым результатом, а затем
ведутся `task.defect_update` по отдельному циклу `OPEN → IN_PROGRESS → VERIFYING → FIXED`.
Во время обычного исправления родительская задача остаётся в `TESTING` со своим
прогрессом; завершение задачи блокируется, пока любой связанный дефект не `FIXED`.

Отправить прогресс:

```json
{
  "countryId": "<uuid страны>",
  "taskId": "<uuid задачи>",
  "status": "IN_PROGRESS",
  "progress": 55,
  "comment": "Основной сценарий готов, завершаем обработку ошибок",
  "idempotencyKey": "task-pharmacy-progress-55"
}
```

Допустимый порядок:

`PLANNING → STARTED → IN_PROGRESS → TESTING → COMPLETED`

Пропуск стадий запрещён. Возврат разрешён только `TESTING → IN_PROGRESS` и требует комментарий.

Значения прогресса по умолчанию: планирование `0%`, начало работы `0%`, работа `50%`, тестирование `90%`, завершение `100%`. Явный процент внутри допустимого диапазона стадии сохраняется.

## Надёжность

Все изменяющие операции требуют уникальный `idempotencyKey`. Повтор с тем же payload возвращает сохранённый результат; тот же ключ с другим payload даёт `CONFLICT`. Команда, размещение объекта, событие и idempotency result сохраняются одной PostgreSQL-транзакцией с блокировкой строки страны, поэтому конкурентные изменения геометрии не пересекаются.

Каждое изменение увеличивает `worldVersion` и создаёт событие. Создание задачи, смена стадии, комментарий и назначение ответственного также попадают в неизменяемую хронику с аккаунтом автора. Веб получает `world:event` через Socket.IO. Пространственные события содержат `payload.affectedBounds` (`minX`, `minY`, `maxX`, `maxY`), поэтому клиент перечитывает только пересекающиеся чанки. Открытый план повторяет только свои scoped-запросы; структурные изменения перечитывают лёгкий bootstrap со счётчиками и bounds. Если границы отсутствуют, применяется безопасная полная инвалидация резидентных чанков.

Внутренний session-auth endpoint `/api/chunks/:x/:y?lod=overview|detail` отдаёт компактный `ChunkPayloadDto` клиенту, запросившему vendor `Accept` version 2: terrain и decorations детерминированно восстанавливаются браузерными Worker'ами. На rollout-окно запрос без vendor-заголовка получает полный render-ready `ChunkDto` для совместимости с уже открытой вкладкой предыдущего релиза; ETag разделён по representation и ответ содержит `Vary: Accept`. Ответ приватный; актуальная версия события передаётся отдельно в `X-World-Version`, включая 304. Endpoint не является MCP resource/API для внешних агентов.

Ресурсы:

- `tasktopia://countries/{countryId}`
- `tasktopia://catalog/buildings`

Оба ресурса требуют `country:read`.

Проверка живого сервера:

```bash
npm run seed
npm run dev
npm run smoke:mcp
```

Локальный `npm run seed` ограничен одним городом, 10 районами и 30 задачами,
чтобы проверка MCP не зависела от тяжёлой showcase-генерации.
