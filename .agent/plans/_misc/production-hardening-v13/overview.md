# Production hardening V13

## Goal

Закрыть остатки V12: управляемые MCP scopes/expiry, read-only роль, cursor pagination городов, пакетный возобновляемый spatial backfill и безопасная декомпозиция entity reconciliation карты.

## Scope

- Новые MCP-токены: выбранные scopes, 30/90/365 дней, серверная проверка разрешений роли.
- Роль `VIEWER`; legacy `MEMBER` остаётся редактором.
- Новый cursor endpoint для городов плана с лимитом 1–100; старый массив остаётся совместимым.
- Spatial backfill порциями с durable progress и атомарным завершением.
- Generic entity reconciler вне `WorldCanvas`, unit coverage и прежний runtime contract.
- UI, MCP docs, QA, changelog и полная проверка малого мира.

## Non-goals

- OAuth/JWT и внешняя identity platform.
- Горизонтальное масштабирование SQLite.
- Тяжёлые миры в default test gate.
- Полная перепись Pixi renderer за один этап.

## Acceptance criteria

- Token secret хранится только как hash; срок и scopes валидируются и отображаются.
- Viewer не может получить write scope; owner/member сохраняют текущие возможности.
- Истёкший/отозванный/недостаточно scoped token отклоняется тестами.
- Plan UI проходит все страницы cursor endpoint без geometry payload.
- Backfill возобновляется по progress cursor и не оставляет пропущенных membership.
- Entity reconciler заменяет только изменённые views и уничтожает удалённые.
- Typecheck, lint, coverage, build, E2E, MCP, assets, scale и audit проходят.

## Current status

Реализация и документация завершены. Полный малый gate зелёный; обязательных пунктов V13 не осталось.

## Risks

- Расширение CHECK роли требует совместимой table migration.
- Неправильный cursor может пропустить города с одинаковым `created_at`.
- Backfill batching не должен публиковать неполный spatial read model.
- Выделение reconciler не должно изменить Pixi destruction semantics.

## Finish checklist

- [x] Контракты и миграции реализованы.
- [x] UI и MCP security paths покрыты.
- [x] Pagination/backfill/reconciler покрыты.
- [x] Документация синхронизирована.
- [x] Fresh full gate зелёный.
