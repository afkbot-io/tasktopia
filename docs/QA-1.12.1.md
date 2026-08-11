# QA 1.12.1

## Release gate

1. В чистом checkout выполнить `npm ci`.
2. Поднять development PostgreSQL:
   `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`.
3. Проверить `npm run seed` и запуск `npm run dev` против `127.0.0.1:5432`;
   seed должен создать ровно 1 город, 10 районов и 30 задач.
4. Поднять изолированную тестовую БД командой `npm run test:db:start`.
5. Выполнить `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build`, `npm run test:e2e`, `npm run assets:verify`.
6. После обычного gate отдельно выполнить `npm run test:worldgen` и
   `npm run test:scale`; не запускать их параллельно с E2E.
7. Проверить `docker compose config` для self-host env: app слушает только
   `127.0.0.1:3000`, production PostgreSQL не имеет published ports.
8. Собрать и запустить чистый Docker Compose project на отдельном loopback
   порту; `/health` должен вернуть версию `1.12.1`.
9. Выполнить `bash -n`/ShellCheck для install/update scripts, `actionlint` для
   CI и `npm audit --audit-level=high`.
10. После tag/deploy проверить public `/health`, `/ai.md`, MCP unauthenticated
    contract, CDN asset revision, контейнерные healthchecks и отсутствие новых
    error-логов.
11. После повторной сборки убедиться, что URL предыдущей asset revision всё ещё
    возвращает `200`, а в volume остаётся не больше трёх канонических ревизий.

## Cleanup evidence

- `assets/generated-v2` и `archive/static-prototype` не импортировались V4
  builder, runtime, tests или документацией текущего продукта.
- `assets/pixel-city-pack-v3` остаётся: V4 builder читает из него канонические
  base tiles/props, поэтому это source dependency, а не мёртвое legacy.
