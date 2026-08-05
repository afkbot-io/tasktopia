# QA релиза 1.2

## Автоматические проверки

```bash
npm run typecheck
npm run lint
npm run test:db:start
npm test
npm test -- --coverage
npm run build
npm run test:e2e
npm run smoke:mcp
npm audit --omit=dev
npm run test:db:stop
```

Обычный gate использует один город, 10 районов и 20 задач. Ресурсная проверка
`npm run test:scale` запускается отдельно и не должна выполняться одновременно с
unit/E2E.

## MCP и публичная инструкция

1. `/ai.md` открывается без авторизации и содержит production endpoint, все 17
   tools и оба resources.
2. Ссылка на `/ai.md` видна, открывается и копируется в настройках MCP на desktop
   и mobile.
3. Актуальный SDK-клиент согласует MCP `2026-07-28`; совместимый клиент работает
   через stateless fallback `2025-11-25`.
4. Принимается только `Authorization: Bearer ttp_mcp_...`. Bare token,
   `X-API-Key`, отозванный ключ и запрос с чужим Origin отклоняются.
5. Ответ без credentials содержит `401` и `WWW-Authenticate: Bearer`.
6. Read-only и task-only ключи не обходят scopes инструментов и resources.

## Регистрация и страны

1. Регистрация требует имя первой страны и города и открывает готовую карту.
2. Ошибка генерации откатывает пользователя, session, страну и город целиком.
3. Основатель может переименовать страну; редактор и наблюдатель получают `403`.
4. На ширинах 375, 768 и 1440 px нет горизонтальной прокрутки; focus trap,
   Escape и возврат фокуса работают в диалогах.

## Карта и генерация

1. Тестовый seed содержит ровно один город, 10 районов и 20 задач.
2. Карта запрашивает viewport и prefetch-ring чанков, а не весь мир.
3. Pan/zoom не пересоздают canvas; overview выключает транспорт и пешеходов.
4. `affectedBounds` инвалидирует только пересекающиеся resident chunks.
5. Генератор сохраняет связность дорог и входов, кварталы новостроек `3×3`,
   разнообразие застройки и лимит полного asphalt не выше 20% жилого района.

## Production smoke

```bash
curl -fsS https://tasktopia.online/health
curl -fsS https://tasktopia.online/ai.md | head
SMOKE_BASE_URL=https://tasktopia.online \
SMOKE_EMAIL='<выделенный-smoke-account>' \
SMOKE_PASSWORD='<пароль>' npm run smoke:mcp
```

После обновления дополнительно проверить `docker compose logs --tail=100 app`,
страницу входа, карту, панель стран и выпуск/отзыв персонального ключа.

## Регрессия пустых запросов — 1.2.1

Проверить действия без request body: переключение страны, исключение участника,
удаление страны, отзыв MCP-ключа и выход из аккаунта. Запрос не должен содержать
`Content-Type: application/json`; интерфейс не должен показывать внутреннее
сообщение Fastify `Body cannot be empty`.
