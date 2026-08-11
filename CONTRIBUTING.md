# Вклад в Tasktopia

Спасибо за желание развивать Tasktopia. Предпочтительны небольшие PR с одной
понятной целью, тестом наблюдаемого поведения и обновлением документации.

## Начало работы

```bash
npm ci
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
npm run seed
npm run dev
```

Создайте ветку от актуального `main`, опишите проблему и критерий готовности.
Не добавляйте секреты, production dumps, `node_modules`, coverage и временные
результаты Playwright.

## Перед PR

```bash
npm run test:db:start
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:db:stop
```

Для UI добавьте или обновите Playwright-проверку. Для изменений генерации мира
запустите `npm run test:worldgen` отдельным этапом после обычного набора и E2E.
Не запускайте тяжёлый worldgen одновременно с ними.

## Графический пак

Новый runtime PNG не принимается отдельно от manifest, семантического ключа и
проверки в мире. Обязательный контракт:

1. Прочитать `assets/pixel-city-pack-v4/docs/GENERATION-SPEC.md`.
2. Подготовить пять стадий здания или законченный ambient-вариант.
3. Зарегистрировать source digest и metadata.
4. Запустить `npm run assets:build && npm run assets:verify`.
5. Проверить native `1x`, nearest-neighbour preview и реальную карту.

Нельзя добавлять antialiasing, blur, другой ракурс, runtime AI generation или
незарегистрированный fallback.

## Контракты

- Изменение API/MCP требует тестов и обновления `docs/MCP.md`/`public/ai.md`.
- Миграция PostgreSQL только добавляется новым номером; применённые файлы не
  переписываются.
- Realtime-событие, меняющее карту, обязано содержать точный `affectedBounds`.
- Все изменяющие MCP-операции должны оставаться идемпотентными.

Отправляя contribution, вы соглашаетесь распространять его по MIT License
проекта.
