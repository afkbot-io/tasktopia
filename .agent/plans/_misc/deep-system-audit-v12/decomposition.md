# Decomposition

## Decomposition verdict

- Recommended shape: hybrid reviewable slices in one working branch.
- Reason: аудит общий, но исправления можно проверять по независимым границам данных, transport, rendering и finish.
- Main risk: общие контракты затрагивают сервер, клиент и тесты одновременно.

## Dependency graph

`V12-1 inventory -> V12-2 data integrity -> V12-3 transport security -> V12-4 client/runtime -> V12-5 finish`

## Slices

1. **V12-1 — Entity and contract inventory**: read-only карта сущностей, transitions и ownership; проверка — references/findings.
2. **V12-2 — Data and generator integrity**: schema, migration, spatial membership, roads/zoning/asphalt; проверка — disposable SQLite and focused tests.
3. **V12-3 — Transport and security**: HTTP/MCP/socket authorization, validation, rate-limit/error contracts; проверка — integration/security tests.
4. **V12-4 — Chunked client runtime**: request lifecycle, LOD, partial invalidation, render/update budget; проверка — unit/build/E2E.
5. **V12-5 — Cleanup and finish**: stale paths, dependency audit, docs, QA, changelog and full gate.

Срезы выполняются последовательно, потому что это один уже изменённый dirty worktree; отдельные stacked branches создали бы конфликтующий overhead без независимого релиза.
