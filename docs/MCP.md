# MCP и API

Production endpoint: `https://tasktopia.online/mcp`. Транспорт — Streamable HTTP. Сервер использует актуальный MCP `2026-07-28` и принимает stateless-клиенты `2025-11-25` в режиме совместимости. `POST` передаёт JSON-RPC, а `GET`/`DELETE` обслуживаются транспортным lifecycle.

Самодостаточная публичная инструкция, которую можно передать ИИ без доступа к репозиторию: [https://tasktopia.online/ai.md](https://tasktopia.online/ai.md).

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

Ключ создаётся в разделе MCP и показывается только один раз. В PostgreSQL хранится только SHA-256 hash. Новый персональный ключ отзывает предыдущий активный ключ пользователя, а команды выполняются от его имени в выбранной стране. Принимается только точный заголовок `Authorization: Bearer ttp_mcp_...`: `X-API-Key`, bare token, cookie и query-параметры отклоняются. Эти персональные ключи не являются OAuth-токенами, поэтому endpoint не публикует фиктивный OAuth discovery.

При выпуске выбираются срок `30 | 90 | 365` дней и непустое подмножество scopes:

- `country:read` — страны, города, районы и MCP resources; полный `city.get` дополнительно требует `tasks:read` из-за списка задач;
- `cities:write` — создание и переименование городов;
- `districts:write` — создание, переименование и смена состояния районов;
- `tasks:read` — чтение задач;
- `tasks:write` — создание, переименование, назначение и смена стадии задач;
- `comments:write` — добавление комментариев.

Глава страны и министр могут выбрать любые scopes. Наблюдателю доступны только `country:read` и `tasks:read`. Сервер заново проверяет активную страну и текущую роль на каждом MCP HTTP-запросе, поэтому сохранённые в старом ключе write-scopes не дают наблюдателю право записи. Истёкший, отозванный, повреждённый или пустой по разрешениям ключ отклоняется. Существующие ключи с `expires_at = NULL` продолжают работать до отзыва; все новые имеют явный срок.

## Основные инструменты

- `country.get_current`, `country.list`, `country.select`
- `city.list`, `city.get`, `city.create`, `city.rename`
- `district.list`, `district.create`, `district.rename`, `district.activate`, `district.complete`
- `task.list`, `task.get`, `task.create`, `task.rename`
- `task.set_status`, `task.report_progress`, `task.add_comment`, `task.assign`

## Минимальный сценарий

Создать город:

```json
{
  "name": "Northpoint",
  "description": "Основной продуктовый город",
  "idempotencyKey": "northpoint-v1"
}
```

Создать и активировать район:

```json
{
  "cityId": "<uuid города>",
  "name": "Release Quarter",
  "goal": "Подготовить релиз",
  "capacitySp": 14,
  "archetype": "NEW_BUILD",
  "activate": true,
  "idempotencyKey": "release-quarter-v1"
}
```

`archetype` необязателен: `NEW_BUILD | PRIVATE | MIXED_URBAN | COMMERCIAL | CIVIC`. Без него сервер выводит тип из названия/цели района, morphology города и уже существующей застройки. Архетип влияет на участки и автоматический выбор зданий, но не меняет смысл явно переданного `buildingHint`.

Добавить задачу в активный район:

```json
{
  "cityId": "<uuid города>",
  "title": "Открыть районную аптеку",
  "description": "Каталог, поиск и карточка лекарства",
  "estimate": 3,
  "priority": "HIGH",
  "assigneeEmail": "member@example.com",
  "idempotencyKey": "task-pharmacy-v1"
}
```

`districtId` у `task.create` необязателен: без него используется активный район города. `buildingHint` позволяет запросить конкретный ключ из `tasktopia://catalog/buildings`; если вариант не подходит оценке или нарушает квоту, сервер возвращает явную ошибку.

`assigneeEmail` необязателен, но указанный человек должен быть зарегистрирован и состоять в правительстве выбранной страны. Создателем задачи автоматически становится владелец персонального MCP-ключа. Назначение можно позже изменить через `task.assign`.

Отправить прогресс:

```json
{
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

Ресурсы:

- `tasktopia://country/current`
- `tasktopia://catalog/buildings`

Оба ресурса требуют `country:read`.

Проверка живого сервера:

```bash
npm run seed
npm run dev
npm run smoke:mcp
```
