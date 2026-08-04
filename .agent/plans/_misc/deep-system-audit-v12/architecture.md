# Architecture

## Current boundary

React/Pixi клиент получает лёгкий bootstrap и ленивые plan-данные через Fastify. Мир читается чанками из `AppService`; SQLite хранит доменные и spatial-сущности, а `world_chunk_entities_v11` индексирует membership. Socket.IO сообщает события с affected bounds. MCP использует отдельные hashed bearer tokens и тот же domain service.

## Target boundary

Сохранить один доменный источник истины в `AppService`, строгую country boundary во всех transport-путях и chunk-first read model. Полный мир не должен появляться ни в bootstrap, ни в клиентском state. Realtime должен инвалидировать только затронутые чанки, а плановые панели — только нужный уровень дерева.

## Alternatives considered

- Отдельный spatial engine/PostGIS: преждевременно для текущего single-node SQLite продукта.
- Полный snapshot cache: ускоряет повторное чтение, но возвращает большой memory/invalidations blast radius.
- WebGL scene rebuild на каждое событие: проще, но нарушает требование плавности.

## Rollout and rollback

Изменения должны быть совместимыми с существующей SQLite schema. Новые read indexes/backfills обязаны быть идемпотентными. Клиентские оптимизации должны сохранять detail LOD и fallback после ошибок чанка. Проверки выполняются на disposable DB; пользовательская `data/tasktopia.db` не изменяется.
