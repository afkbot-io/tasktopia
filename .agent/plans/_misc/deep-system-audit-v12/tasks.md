# Tasks

- [completed] Инвентаризировать сущности, схемы, контракты, маршруты, события и тесты. Verification: `docs/ARCHITECTURE.md` and entity matrix.
- [completed] Проверить SQLite schema/migrations/spatial index и добавить integrity tests. Verification: focused Vitest, negative coordinates and disposable DB checks.
- [completed] Проверить auth, country isolation, input validation, CSRF, headers, rate limits, MCP scopes и Socket.IO rooms. Verification: HTTP tests, live headers, MCP smoke and security scan.
- [completed] Проверить generator, zoning, asphalt, roads, growth and one-city/ten-district budget. Verification: coverage suite, audit and `npm run test:scale`.
- [completed] Проверить client chunk lifecycle, LOD races, invalidation, plan loading and render performance; исправить подтверждённые проблемы. Verification: typecheck, build chunks and Playwright.
- [completed] Проверить stale code, dependencies, test separation and docs drift. Verification: repository search, clean npm audit and docs review.
- [completed] Выполнить fresh finish gate и заполнить итог аудита. Verification: typecheck, lint, 54-test coverage, build, 343 assets, scale, Playwright, MCP and diff check.
