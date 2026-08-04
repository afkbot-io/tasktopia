# QA

## Preconditions

- Node version satisfies `package.json`.
- Все destructive/runtime проверки используют явный disposable SQLite path.
- Обычная генерация: 1 город, 10 районов, малое число задач.

## Positive scenarios

- Регистрация создаёт пустую страну и безопасную сессию; login/logout/restore работают.
- Владелец и участник видят только доступные страны; plan/chunk/task/MCP соблюдают выбранную страну.
- План лениво раскрывает города, районы и задачи.
- Карта запрашивает bounded набор overview chunks, переключается в detail и не пересоздаёт сцену целиком.
- Событие задачи обновляет только affected bounds и соответствующий plan branch.
- Один город с 10 районами проходит overlap, road connectivity, building access, zoning и asphalt gates.

## Negative scenarios

- Неавторизованный запрос получает 401, чужой id — 404/403 без утечки данных.
- Invalid chunk coordinates/LOD/body дают управляемый 400.
- Reused idempotency key, illegal status transition and incompatible building are rejected.
- Delete/update/cascade не оставляют stale chunk membership.
- Потерянный chunk request/LOD switch не вставляет устаревший ответ в scene.

## Logs and audit checks

- `PRAGMA foreign_key_check` и orphan/index consistency на disposable DB.
- Security headers/cookie flags/error bodies.
- First-load request count and payload size.
- Build chunk sizes and scale smoke timing/RSS.

## Expected results

Все обязательные gates зелёные; недоступный E2E environment отмечается отдельно и не заменяется неподтверждённым утверждением.

## Final evidence

- Typecheck/lint/build: pass.
- Vitest coverage: 16 files, 54 tests; 83.98% statements, 88.53% lines.
- Playwright: 4 pass, 1 explicit growth skip on disposable DB.
- Scale 1/10/25: generation 3322 ms; first 9 detail chunks 36 ms; cached revisit 0 ms; RSS 396 MB / 512 MB.
- World audit 1/10/20: 0 violations; zoning 100%; maximum residential visible asphalt 11.02%.
- Asset audit: 343/343 PNG, 0 violations.
- MCP: 17 tools; revoked token rejected.
- Dependency/security scan: 0 known vulnerabilities; live detail chunk uses Brotli and Helmet headers.
- `git diff --check`: pass.
