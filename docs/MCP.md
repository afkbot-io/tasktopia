# MCP и API

Endpoint: `POST /mcp`, транспорт Streamable HTTP.

```json
{
  "mcpServers": {
    "tasktopia": {
      "url": "https://tasktopia.example.com/mcp",
      "headers": { "Authorization": "Bearer ttp_mcp_..." }
    }
  }
}
```

Ключ перевыпускается в настройках аккаунта и показывается только один раз. В SQLite хранится только SHA-256 hash. Ключ персональный: перевыпуск отзывает предыдущий активный ключ пользователя, а команды выполняются от его имени в выбранной стране. Новый ключ получает scopes `country:read`, `cities:write`, `districts:write`, `tasks:read`, `tasks:write`, `comments:write`.

## Основные инструменты

- `country.get_current`, `country.list`, `country.select`
- `city.list`, `city.get`, `city.create`
- `district.list`, `district.create`, `district.activate`, `district.complete`
- `task.list`, `task.get`, `task.create`
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

`assigneeEmail` необязателен, но указанный человек должен быть зарегистрирован и состоять в палате выбранной страны. Создателем задачи автоматически становится владелец персонального MCP-ключа. Назначение можно позже изменить через `task.assign`.

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

Все изменяющие операции требуют уникальный `idempotencyKey`. Повтор с тем же payload возвращает сохранённый результат; тот же ключ с другим payload даёт `CONFLICT`. Команда, размещение объекта, событие и idempotency result сохраняются одной SQLite-транзакцией.

Каждое изменение увеличивает `worldVersion` и создаёт событие. Создание задачи, смена стадии, комментарий и назначение ответственного также попадают в неизменяемую хронику с аккаунтом автора. Веб получает `world:event` через Socket.IO, перечитывает authoritative bootstrap/chunks и перерисовывает карту.

Ресурсы:

- `tasktopia://country/current`
- `tasktopia://catalog/buildings`

Проверка живого сервера:

```bash
npm run seed
npm run dev
npm run smoke:mcp
```
