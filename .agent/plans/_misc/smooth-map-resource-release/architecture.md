# Architecture

## Current boundary

Один `loadVisible` ждёт всю пачку HTTP, удаляет старый ground, ждёт `Assets.load`, затем строит все чанки и сущности. Camera events запускают конкурирующие ревизии; client cache содержит только active range, server LRU — 64 записи для обоих LOD.

## Target boundary

- Request identity: `country:x:y:lod`; одинаковые promises дедуплицируются.
- Resident data cache и rendered ground cache ограничены независимо.
- Visible range имеет приоритет; каждый готовый chunk коммитится отдельно.
- Старый ground остаётся до готовности replacement; eviction происходит только вне viewport и после swap.
- LOD имеет hysteresis и не меняется от колебаний около одного порога.
- Texture contract загружается до создания Sprite; renderer получает `Texture`, а не выполняет cache lookup на каждую клетку.
- UI first-frame state принадлежит WorldCanvas, а не только React Suspense.

## Alternatives

- Полный canvas snapshot во время загрузки: отклонён как маскировка, не решает request/cache churn.
- Загружать весь мир: отклонено из-за памяти и исходного требования чанков.
- Увеличить только серверный cache: отклонено; не исправляет чёрные кадры и отмены клиента.

## Rollout and rollback

- Без миграций БД; rollback — предыдущий image/commit.
- Перед deploy создаётся PostgreSQL dump.
- Compose limits применяются только Tasktopia; второй проект наблюдается, но его конфигурация не меняется без необходимости.
