# Аудит генерации и загрузки мира: производительность и границы runtime

**Дата среза:** 2026-08-21
**Коммит:** `a0534a6f99a223191025669e11d1e85a3843f56f`
**Метод:** статическая трассировка текущего кода и миграций. Production cardinality, `pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)`, CPU/GPU-профили и нагрузочный стенд в этот аудит не входили. Поэтому оценки сложности и query amplification доказаны структурой кода, а абсолютные latency/throughput должны быть измерены отдельно.

## Краткий вывод

Основа правильная, но текущая реализация ещё не достигает архитектуры «seeded terrain один раз, поверх него только authoritative overlay»:

- terrain уже не передаётся по сети и детерминированно строится на клиенте;
- chunk payload уже компактирует дороги, поверхности и районы в runs;
- сервер имеет process-local L1, разделяемый PostgreSQL L2 и transactional invalidation;
- web, MCP и полная перегенерация запускаются отдельными Node runtime.

Главные оставшиеся проблемы:

1. `/api/world/viewport` объединяет HTTP, но не работу: до 100 чанков проходят независимый `getChunkPayload`, отдельные проверки версии/L2, spatial queries, публикацию и retention.
2. Клиент сначала синхронно рисует seeded terrain, затем worker снова вычисляет те же terrain cells, после чего Pixi уничтожает первую terrain texture и запекает вторую вместе с roads/surfaces.
3. Полная генерация мира вынесена в `world`, но обычные `city.create`, `district.create`, `task.create` всё ещё исполняют CPU/SQL-тяжёлую генерацию внутри MCP runtime и общей PostgreSQL.
4. Whole-country `roadCache`/`surfaceCache` не имеют cross-runtime invalidation/version tagging. После мутации из MCP web может пересобрать atlas из устаревших дорог.
5. Каноническое хранение всё ещё координатно тяжёлое: одна строка на road cell; массивы district/task/feature cells в JSONB; district geometry дополнительно поддерживается сразу в двух chunk projections.

Redis сейчас не реализован и не является первым исправлением. Сначала нужно убрать fan-out, двойную terrain-работу, несогласованные process caches и лишнюю write amplification. После этого Redis может быть полезен только как удаляемый hot-cache/distributed singleflight, но не как источник истины.

## 1. Полный путь генерации и публикации мира

### 1.1 Обычная mutation из MCP

1. MCP runtime создаёт один `AppService` и передаёт его MCP handler (`src/server/index.ts:100-103`, `src/server/index.ts:126-127`, `src/server/mcp-http.ts:9-10`).
2. MCP tools синхронно вызывают production-генератор: `city.create -> service.createCity`, `district.create -> service.createDistrict`, `task.create -> service.createTask` (`src/server/mcp.ts:152-154`, `src/server/mcp.ts:188-190`, `src/server/mcp.ts:239-269`).
3. `mutate` берёт `FOR UPDATE` на строке страны и держит транзакцию на время всего callback генератора (`src/server/app-service.ts:808-838`).
4. `createCity` выбирает центр и bounds, пишет город, A*-маршрутизирует и публикует highway/arterial/collector, features и архив, затем проверяет связность (`src/server/app-service.ts:2828-2954`).
5. `createDistrict` читает существующие районы/дороги/задачи/features, подбирает terrain-safe site, при необходимости строит подъезд и сохраняет всю территорию в `cells_json` (`src/server/app-service.ts:3840-3964`).
6. `createTask` выбирает visual/building, сканирует занятые footprints, пытается существующие lots, а при отсутствии места вызывает рост района; затем пишет task footprint/access, документы и green feature (`src/server/app-service.ts:4420-4675`).
7. Рост района многократно использует whole-country lists/maps, строит complex и road segments, а затем целиком переписывает `districts_v3.cells_json`/`lots_json` (`src/server/app-service.ts:3151-3239`, `src/server/app-service.ts:3247-3274`, `src/server/app-service.ts:3575-3616`).
8. `addRoadPath` держит in-memory cell map, но пишет каждый road cell отдельным UPSERT Promise, после чего отдельными UPDATE пересчитывает masks (`src/server/app-service.ts:2038-2123`, `src/server/app-service.ts:2144-2161`).
9. После callback любая domain mutation увеличивает глобальный `countries.world_version`, пишет durable event и в той же транзакции удаляет затронутые published chunks (`src/server/app-service.ts:798-805`, `src/server/app-service.ts:828-836`). L1 invalidation и event publication происходят после commit (`src/server/app-service.ts:851-857`).

### 1.2 Полная перегенерация

- `regenerateCountry` создаёт временную страну с новым детерминированным seed, тем же production `AppService` последовательно replay-ит города, районы и задачи, а при переполнении создаёт временные continuation districts (`src/server/app-service.ts:967-1063`).
- После успешной генерации он переносит geometry/building identity в исходные rows, целиком заменяет roads/features, синхронизирует archive и удаляет временную страну (`src/server/app-service.ts:1065-1149`). Всё находится внутри внешнего `mutate`, то есть failure откатывает замену.
- Release CLI обходит страны последовательно, делает audit before, до 3 attempts, audit after внутри транзакции и пропускает audit-clean миры без `REGENERATION_FORCE=1` (`src/server/regenerate-worlds.ts:9-99`, `src/server/world-regeneration-runner.ts:21-30`).
- На момент исходного аудита nginx направлял `POST /api/countries/:id/regenerate` прямо в runtime `3003`. В реализованной целевой схеме nginx направляет HTTP-команду в web `3000`, web сохраняет durable job, а runtime `3003` исполняет её без удержания HTTP-запроса; `/mcp` остаётся на `3002`.

## 2. Что хранится поклеточно и покоординатно

| Данные | Каноническое хранение | Производные данные | Вывод |
|---|---|---|---|
| Terrain | Только `countries.seed`; cells не хранятся (`migrations/postgres/0001_initial.sql:20-27`) | `terrainAt(seed,x,y)` на клиенте/сервере | Уже соответствует seeded architecture. |
| Roads | Одна PostgreSQL row на каждую клетку: `(country_id,x,y,mask,structure,road_class)` (`migrations/postgres/0001_initial.sql:154-160`) | Runs только внутри published chunk payload | Главный источник point-row count и write amplification. |
| City | Scalar center + `bounds_json` (`migrations/postgres/0001_initial.sql:108-114`) | Atlas projection | Bounds читаются JSON casts без spatial/expression index. |
| District | Один потенциально большой `cells_json` и `lots_json` на район (`migrations/postgres/0001_initial.sql:116-124`) | `world_chunk_entities_v11` membership и `world_chunk_district_cells_v1` с cell arrays по chunk (`migrations/postgres/0001_initial.sql:171-201`, `migrations/postgres/0016_chunk_local_district_cells.sql:4-42`) | Geometry хранится/расширяется дублированно. |
| Task/building/park | Scalar origin/entrance + `footprint_json` + `access_json` (`migrations/postgres/0001_initial.sql:126-139`, `migrations/postgres/0013_task_visual_kind.sql:1-22`) | Entity-to-chunk memberships в `world_chunk_entities_v11` | Для небольших footprints приемлемо; wide `SELECT t.*` тянет также большие semantic fields. |
| World feature | Scalar origin + footprint/access JSON arrays (`migrations/postgres/0001_initial.sql:162-169`, `migrations/postgres/0003_feature_ownership.sql:1-3`) | Entity-to-chunk memberships | Та же схема, что у tasks. |
| Surfaces | Отдельной canonical table нет | Вычисляются `buildSurfaceMap` из roads/cities/districts/tasks/features (`src/server/world/city-generation.ts:316-400`) | Экономит storage, но переносит CPU в cold chunk/atlas path. |
| Decorations | Не хранятся | Детерминированно строятся в browser worker | Правильная граница ответственности. |
| Published chunk | JSONB + content hash, ключ `(country,chunk,lod)` (`migrations/postgres/0014_published_chunk_payloads.sql:1-13`) | PostgreSQL L2, максимум 2048 недавно построенных rows на страну | Удаляемая проекция, не canonical state. |

DTO parser просто приводит JSON к TypeScript типу без runtime validation (`src/server/app-service.ts:440-485`). Это делает DB constraints/backfill audit особенно важными при изменении формата geometry.

## 3. Путь viewport/chunk payload

### 3.1 Первый кадр на клиенте

1. Bootstrap/manifest передаёт seed, generator version, world revision, chunk size и view bounds (`src/server/app-service.ts:870-938`, `src/shared/contracts.ts:46-53`).
2. Камера вычисляет только видимый chunk range и center-first plan (`src/client/components/WorldCanvas.tsx:2575-2598`).
3. Для каждого wanted chunk сразу вызывается `primeSeedGround`; DETAIL синхронно проходит 64×64 cells, рисует `Graphics.rect` и генерирует отдельную texture (`src/client/components/WorldCanvas.tsx:1630-1653`, `src/client/components/WorldCanvas.tsx:1672-1689`, `src/client/components/WorldCanvas.tsx:2402`).
4. Клиент делает один viewport request для прямоугольника missing chunks, если он не больше 100 (`src/client/components/WorldCanvas.tsx:2157-2177`). При failure остаётся individual chunk fallback (`src/client/components/WorldCanvas.tsx:2403-2409`, `src/client/components/WorldCanvas.tsx:2223-2248`).

### 3.2 Серверный viewport

- Endpoint разрешает rectangle до `12×12`, максимум 100 chunks (`src/server/routes.ts:380-395`).
- Затем он создаёт 100 независимых Promise и вызывает `service.getChunkPayload` для каждой координаты (`src/server/routes.ts:397-408`). У viewport нет combined ETag; ответ всегда собирается полностью.
- Каждый `getChunkPayload` отдельно:
  - читает всю row страны ради `world_version` (`src/server/app-service.ts:5042-5051`);
  - проверяет process L1; для version mismatch отдельно валидирует L2 hash (`src/server/app-service.ts:5052-5067`);
  - отдельно читает PostgreSQL L2 row (`src/server/app-service.ts:5069-5081`);
  - deduplicate-ит build только внутри одного Node process и exact `(chunk,lod,worldVersion)` (`src/server/app-service.ts:5083-5098`).

### 3.3 Cold build

Для каждого missing chunk сервер независимо запускает:

- bounded road query;
- chunk-local district projection query;
- city bounds query с 96-cell halo в DETAIL;
- task/feature membership queries;
- defect aggregation;
- surface generation;
- run compaction, JSON stringify + SHA-256;
- transactional publish + per-country retention.

Это видно в `src/server/app-service.ts:5133-5288`. Spatial helper queries находятся в `src/server/app-service.ts:1157-1164` и `src/server/app-service.ts:1456-1507`; публикация и retention — в `src/server/app-service.ts:5101-5129`.

### 3.4 Browser materialization и второй ground bake

- Payload v2 содержит road/surface/cell runs, но tasks/features и decoration task footprints остаются cell arrays (`src/shared/contracts.ts:375-395`).
- До двух workers раскрывают runs, **повторно** вычисляют terrain cells и генерируют decorations (`src/client/chunk-materializer.ts:38-67`, `src/client/chunk-materializer-worker.ts:12-17`, `src/shared/world-chunk-payload.ts:8-55`).
- После ответа `createGroundView` снова рисует весь terrain плюс surfaces/roads в новую RenderTexture (`src/client/components/WorldCanvas.tsx:1572-1626`). `installGround -> removeGround` уничтожает seeded texture и заменяет её authoritative texture (`src/client/components/WorldCanvas.tsx:1551-1560`, `src/client/components/WorldCanvas.tsx:1656-1667`).

Итого: сеть terrain уже не несёт, но CPU/GPU path всё ещё делает terrain дважды и не использует overlays как самостоятельный слой.

## 4. PostgreSQL queries и индексы

### Уже совпадает с read shape

- Published chunk exact lookup/upsert покрыт primary key `(country_id,chunk_x,chunk_y,lod)` (`migrations/postgres/0014_published_chunk_payloads.sql:1-10`).
- Retention ordering покрыт `(country_id,published_at DESC)` (`migrations/postgres/0015_published_chunk_retention.sql:1-2`).
- Chunk entity lookup имеет `(country_id,entity_kind,chunk_x,chunk_y)` (`migrations/postgres/0001_initial.sql:171-179`).
- District chunk-cell rows имеют matching primary key и отдельный `district_id` index для trigger delete (`migrations/postgres/0016_chunk_local_district_cells.sql:4-15`).
- Defect aggregation имеет task/status indexes (`migrations/postgres/0004_ai_work_model.sql:30-43`, `migrations/postgres/0005_incident_response.sql:8-10`).

### Не совпадает или дублирует работу

- `roads_v3` primary key уже равен `(country_id,x,y)`, а `roads_v3_country_position_idx` дублирует тот же B-tree (`migrations/postgres/0001_initial.sql:154-160`). Chunk read задаёт независимые `x BETWEEN` и `y BETWEEN` (`src/server/app-service.ts:5146-5151`); B-tree эффективно использует leading range, но второй range на больших extent может остаться filter.
- `citiesInBounds` выполняет четыре JSON text extraction/casts; есть только `(country_id,created_at,id)` index (`src/server/app-service.ts:1157-1164`, `migrations/postgres/0001_initial.sql:108-114`).
- Task/feature/district membership refresh triggers удаляют по `(entity_kind,entity_id)`, но оба индекса `world_chunk_entities_v11` начинаются с `country_id` (`migrations/postgres/0001_initial.sql:171-179`, `migrations/postgres/0001_initial.sql:181-243`).
- `tasksInBounds` делает `SELECT DISTINCT t.*`, хотя chunk output использует только render/geometry subset (`src/server/app-service.ts:1480-1492`, `src/server/app-service.ts:5256-5263`). `t.*` включает длинные analysis/architecture/design/plan поля (`migrations/postgres/0004_ai_work_model.sql:17-24`).
- Старый district membership trigger и новый district cell projection оба полностью раскрывают `cells_json`; runtime district reads используют только новый projection (`migrations/postgres/0001_initial.sql:181-201`, `migrations/postgres/0016_chunk_local_district_cells.sql:17-42`, `src/server/app-service.ts:1456-1478`).

## 5. Кэши и invalidation

### Существующее

- Server L1: unbounded-by-country `roadCache`, `surfaceCache`, `knownWorldVersions`, `countryAtlasCache`; bounded chunk LRU 512; per-process pending-build singleflight (`src/server/app-service.ts:684-696`, `src/server/app-service.ts:717-735`).
- Shared L2: PostgreSQL `world_chunk_payloads_v1`, limit 2048 rows **на страну**, enforced after every publish (`src/server/app-service.ts:5109-5128`).
- Chunk invalidation классифицирует metadata/status/structural events и удаляет bounded или all rows в одной canonical transaction (`src/server/app-service.ts:737-790`, `src/server/app-service.ts:820-857`).
- Browser: decoded chunks 48, compact payloads 160, GPU grounds 96; status-only events patch entities без ground refetch, bounds-based events сбрасывают только intersecting chunks (`src/client/components/WorldCanvas.tsx:78-84`, `src/client/components/WorldCanvas.tsx:2647-2774`).
- Cross-runtime relay передаёт через PostgreSQL `NOTIFY` только durable event id; web перечитывает row и отправляет Socket.IO (`src/server/world-event-relay.ts:5-27`, `src/server/index.ts:104-120`).

### Существенная несогласованность

Web subscriber не передаёт внешний event обратно в `AppService`: он только делает `io.emit` (`src/server/index.ts:104-120`). `roadCells` и `surfaceCells` возвращают unversioned process cache (`src/server/app-service.ts:1820-1829`, `src/server/app-service.ts:1864-1879`). `getCountryAtlas` замечает новый global worldVersion и начинает rebuild, но получает roads/surfaces из этих старых caches (`src/server/app-service.ts:1174-1187`). Поэтому MCP mutation может оставить web atlas собранным из нового task/district state и старой дороги/поверхности.

Chunk L1 защищён лучше: каждый read сначала получает текущий `world_version`, а stale L1 сверяется с shared projection (`src/server/app-service.ts:5049-5067`). Для road/surface/atlas такой version check отсутствует.

`NOTIFY` сам по себе не является replay. Event row durable, но subscriber слушает только новые notifications; failure `pg_notify` лишь логируется (`src/server/index.ts:100-103`, `src/server/world-event-relay.ts:13-21`). Клиент использует только Socket.IO event (`src/client/App.tsx:172-204`), хотя API уже умеет `GET /api/events?after=` (`src/server/routes.ts:659-664`). Потерянный notify/restart web runtime может оставить уже открытый tab без invalidation до следующей полной загрузки.

## 6. Приоритетные findings и конкретные исправления

### P1 — viewport fan-out остаётся N-chunk pipeline

**Evidence:** `src/server/routes.ts:380-408`, `src/server/app-service.ts:5042-5288`.
**Impact:** даже warm L1 viewport делает до 100 country reads; warm PostgreSQL L2 — до 200 reads; cold path добавляет несколько spatial queries и write transaction на каждый chunk. `Promise.all` запускает всё сразу, а web pool ограничен 10 connections (`src/server/db.ts:134-145`, `docker-compose.yml:30-36`).
**Fix:** добавить `AppService.getViewportPayload`:

1. один country/version snapshot;
2. process-L1 lookup по всем keys;
3. один PostgreSQL `SELECT ... WHERE country_id=? AND lod=? AND chunk_x BETWEEN ... AND chunk_y BETWEEN ...` для L2 и stale-hash validation;
4. один viewport-scoped spatial snapshot (roads, districts, tasks, features, cities, defects) по union bounds, затем partition по chunk;
5. cold builds с bounded concurrency 2–4, не `Promise.all(100)`;
6. batch upsert всех новых payloads под одной version check; retention один раз после batch или отдельным maintenance job.

**Verification:** cold/warm 1, 9, 25 и 100 chunks; query count; p50/p95/p99; pool wait; DB CPU/IO; payload bytes; concurrent 20 viewers; mutation race во время batch.

### P1 — terrain вычисляется и запекается дважды

**Evidence:** `src/client/components/WorldCanvas.tsx:1572-1689`, `src/client/components/WorldCanvas.tsx:2402`, `src/shared/world-chunk-payload.ts:8-17`.
**Impact:** 100 DETAIL seed chunks означают до 409,600 main-thread cell draws ещё до authoritative overlay; затем worker повторяет 409,600 `terrainAt`, а Pixi снова создаёт terrain sprites/texture. Первая GPU texture уничтожается. «Синхронный первый кадр» может сам стать long task на широком viewport/слабом устройстве.
**Fix:** разделить ownership визуальных слоёв:

- immutable `terrainGround` keyed by `(terrainSeed,generatorVersion,assetRevision,chunk,lod)`;
- transparent `infrastructureOverlay` только roads/surfaces;
- entities/decorations отдельным существующим слоем;
- worker раскрывает runs и decorations, но не возвращает `ChunkDto.terrain`, если terrain texture уже есть;
- critical center chunk строится сразу, background seed chunks — через `requestAnimationFrame` budget/OffscreenCanvas; не запускать synchronous bake для всех wanted microtasks одновременно;
- authoritative response заменяет только overlay/entities, а не terrain texture.

**Verification:** Chrome Performance trace (long tasks, main-thread ms), worker CPU, texture create/destroy count, GPU memory, first terrain frame, first overlay frame, pan back cache hit, DETAIL/OVERVIEW transition.

### P1 — cross-runtime road/surface cache incoherence

**Evidence:** `src/server/index.ts:100-120`, `src/server/app-service.ts:684-690`, `src/server/app-service.ts:1174-1187`, `src/server/app-service.ts:1820-1879`.
**Impact:** MCP/world mutation и web read живут в разных `AppService`; local commit invalidates только local maps. Atlas и любая generator operation в другом runtime могут использовать старую whole-country road graph.
**Fix:** сделать cache entry `{worldVersion,value}` и проверять version перед reuse; дополнительно добавить `AppService.applyExternalEvent(event)` и вызывать его в каждом runtime subscriber до дальнейшей обработки. Structural events очищают roads/surfaces/atlas; metadata events не должны это делать. Для защиты от пропущенного NOTIFY version-tag остаётся обязательным.

**Verification:** два `AppService`/два процесса: warm road+surface+atlas в A, road mutation в B, затем atlas/generation в A обязаны видеть новую дорогу. Отдельно симулировать пропущенный NOTIFY.

### P1 — обычная генерация не отделена от MCP и общей БД — закрыто

**Исходное evidence:** до исправления `city.create`, `district.create` и `task.create` выполнялись внутри MCP runtime, а regenerate route шёл прямо в world. Теперь web/MCP dispatcher сохраняет все четыре команды в `world_generation_jobs_v1`, и только world worker исполняет геометрию; HTTP regenerate проходит через web boundary и возвращает DTO либо `202` с polling id.
**Impact:** отдельный event loop защищает web от прямого MCP CPU stall, но createTask/createDistrict/createCity всё ещё выполняют A*, whole-country scans и many-row writes внутри MCP request. Они конкурируют с web за PostgreSQL CPU/IO и могут держать country `FOR UPDATE` всю генерацию. Остановка `world` сейчас не останавливает обычную генерацию — значит граница `world runtime owns generation` фактически не реализована.

**Fix:** ввести durable `world_generation_jobs`/command queue в PostgreSQL. MCP валидирует scope/idempotency и создаёт command; `world` claims job через `FOR UPDATE SKIP LOCKED`, выполняет geometry transaction и публикует event/result. Для совместимости MCP может bounded-wait за result, а затем возвращать operation id; новый contract сразу возвращает accepted operation. Unique `(country,operation,idempotency_key)` сохраняет текущую семантику.

Дополнительно generation read model должен использовать bounded `tasksInBounds/featuresInBounds/districtsInBounds`, а не загружать всю страну и фильтровать в JS: текущий `localSurfaceCells` делает именно full lists (`src/server/app-service.ts:1889-1922`), `tryGrowComplex` повторяет full task/feature/district sets (`src/server/app-service.ts:3247-3274`), `createTask` строит occupied set из всех задач (`src/server/app-service.ts:4489-4499`).

**Verification:** long createTask при одновременных `/health`, bootstrap и 100-chunk cold viewport; PostgreSQL wait events; country lock duration; cancellation/retry; worker crash/restart; duplicate idempotency key; two countries in parallel.

### P1 — atlas cold path остаётся full-country request-time rebuild

**Historical evidence (removed in Country Atlas v6):** прежний atlas miss загружал все cities/districts/tasks/features, road map и surface map, строил `districtOwnerByCell` и формировал full schema-v5 DTO. Указанные ранее `CountryAtlasCanvas`, contract, terrain и projection modules удалены после перехода на bounded overview v3.
**Impact:** первый atlas request после restart/eviction платит за whole-country surface generation. Cache keyed глобальным worldVersion (`src/server/app-service.ts:1174-1177`), а `createEvent` увеличивает его даже для comments/profile (`src/server/app-service.ts:798-805`), поэтому негеометрическое событие может инициировать полный rebuild.
**Implemented direction:** compact country overview использует planet-derived bounded terrain, semantic city miniatures, revision hash и scoped cache. Полные road/surface/building arrays и `sourceCell` отсутствуют в COUNTRY wire contract.

**Verification:** atlas cold/warm after process restart, comment, assignee change, task stage, road mutation и full regeneration; size/parse/render p95 на largest country.

### P1 — district geometry поддерживается двумя projections; refresh delete не индексирован

**Evidence:** legacy trigger `migrations/postgres/0001_initial.sql:181-201`; новый projection trigger `migrations/postgres/0016_chunk_local_district_cells.sql:17-42`; runtime read только `src/server/app-service.ts:1456-1478`; growth rewrite `src/server/app-service.ts:3602-3605`. Task/feature/legacy district deletes используют `(entity_kind,entity_id)`, но matching index отсутствует (`migrations/postgres/0001_initial.sql:171-179`, `migrations/postgres/0001_initial.sql:203-243`).
**Impact:** каждое изменение большого `cells_json` дважды полностью раскрывает JSON и переписывает memberships; task/feature refresh delete деградирует с ростом projection table.
**Fix:** после compatibility audit удалить legacy `DISTRICT` rows/triggers/function из `world_chunk_entities_v11`; добавить index `(entity_kind,entity_id)` для TASK/FEATURE refresh либо включать country в delete. Перевести `world_chunk_district_cells_v1.cells_json` на тот же run/mask format, что wire v2, чтобы не дублировать coordinate objects.

**Verification:** `EXPLAIN (ANALYZE,BUFFERS)` trigger deletes; update района на 4k/20k/100k cells; projection equality before/after migration; negative coordinates.

### P2 — roads: point rows, duplicate index и row-at-a-time writes

**Evidence:** `migrations/postgres/0001_initial.sql:154-160`, `src/server/app-service.ts:2038-2123`, `src/server/app-service.ts:2144-2161`, `src/server/app-service.ts:5146-5151`.
**Impact:** wide road corridor создаёт множество UPSERT/UPDATE; duplicate B-tree увеличивает storage/write cost; `(country,x,y)` не является идеальным access path для двух range dimensions.
**Fix, короткий горизонт:** удалить duplicate `roads_v3_country_position_idx` после `EXPLAIN`/dependency check; добавить generated `chunk_x=floor(x/64)`, `chunk_y=floor(y/64)` и covering index `(country_id,chunk_x,chunk_y)`; писать corridor и masks одним `INSERT ... SELECT FROM unnest(...) ON CONFLICT` и set-based UPDATE.

**Fix, целевой горизонт:** хранить canonical road centerlines/segments и строить derived road-cell chunk projection. Не удалять `roads_v3` до того, как A*, masks, traffic graph и audits научатся работать от segment graph и parity test докажет cell-for-cell equivalence. Task/feature footprints обычно малы и не обязаны мигрировать одновременно.

### P2 — city overlap и wide canonical reads

**Evidence:** JSON casts в `src/server/app-service.ts:1157-1164`; only country/created index в `migrations/postgres/0001_initial.sql:108-114`; `SELECT DISTINCT t.*` в `src/server/app-service.ts:1480-1492`.
**Impact:** city halo query и task reads тянут лишние TOAST/semantic data на каждый cold chunk.
**Fix:** scalar/generated `min_x,min_y,max_x,max_y` либо PostgreSQL range/PostGIS column с matching overlap index; узкие render rows вместо `t.*`/`f.*`; отдельный geometry projection DTO.

### P2 — published payload retention и cache memory не ограничены байтами

**Evidence:** L1 limit 512, PostgreSQL limit 2048 rows per country (`src/server/app-service.ts:691-696`); retention выполняется после каждого publish и сортирует country rows (`src/server/app-service.ts:5119-5128`); road/surface/atlas/version maps не имеют LRU (`src/server/app-service.ts:684-690`).
**Impact:** retention добавляет latency каждому cold build; many countries могут хранить `2048 × variable JSONB` без global byte/age ceiling; whole-country maps остаются в process навсегда.

**Fix:** maintenance job с age + global byte budget, retention один раз на batch; weighted LRU для process maps; метрики `pg_total_relation_size`, TOAST, cache bytes/hit/miss/evictions/build waiters. Индекс `(country_id,content_hash)` сейчас не используется для lookup (`migrations/postgres/0014_published_chunk_payloads.sql:12-13`, `src/server/app-service.ts:5060-5071`) и может быть удалён после подтверждения.

### P2 — event relay имеет durable row, но не durable delivery

**Evidence:** `src/server/world-event-relay.ts:7-21`, `src/server/index.ts:100-120`, `src/client/App.tsx:172-204`, при этом replay endpoint уже есть (`src/server/routes.ts:659-664`).
**Impact:** failed `pg_notify`, web restart или gap между subscription/startup может оставить открытый browser cache без события.

**Fix:** subscriber хранит last processed event id и при startup/notification читает диапазон `events WHERE id > cursor ORDER BY id`; browser при connect передаёт last event id и получает replay. `NOTIFY` остаётся wake-up, не delivery channel.

## 7. Нужен ли Redis

### Текущее состояние

Redis отсутствует: нет dependency (`package.json:45-60`), config/env (`src/server/config.ts:9-25`) и Compose service (`docker-compose.yml:1-160`). Shared L2 уже реализован в PostgreSQL, а cross-runtime event wake-up — через PostgreSQL `NOTIFY`.

### Рекомендация

Не добавлять Redis до P1 fixes выше. Он не устранит 100 отдельных country reads, повторные spatial queries, per-chunk retention, двойной terrain bake или stale unversioned maps.

После исправления batch path допустим **опциональный fail-open Redis** только для:

1. **Distributed singleflight lease** `chunk-build:{country}:{x}:{y}:{lod}:{worldVersion}` через short `SET NX PX`. Проигравший process ждёт PostgreSQL L2. Финальная PostgreSQL version check (`src/server/app-service.ts:5101-5108`) остаётся обязательной; Redis lock не даёт correctness.
2. **Immutable compressed blob by content hash** `chunk-content:{hash}` с TTL/weighted eviction. Locator `(country,chunk,lod)->hash` должен быть versioned и восстанавливаться из PostgreSQL. Потеря Redis не должна менять результат.
3. **Горячий atlas payload** by content hash после введения отдельного atlas revision.

Не хранить в Redis canonical roads/district/task state и не строить correctness на pub/sub: текущая проблема missed event требует replay из durable `events`, а не ещё одного lossy channel.

## 8. План реализации по этапам

### Этап A — измеримость и безопасные DB fixes

1. Добавить query-count/pool-wait/chunk-build/cache-size telemetry.
2. Удалить legacy district membership после parity audit; добавить `(entity_kind,entity_id)` index.
3. Добавить city bounds/road chunk access indexes и narrow render selects.
4. Перенести retention из каждого publish в batch/maintenance.
5. Исправить cross-runtime versioned caches и event replay.

### Этап B — настоящий viewport batch

1. Один version snapshot и один L2 read на viewport.
2. Один spatial snapshot на union bounds, partition в памяти.
3. Bounded build concurrency и batch publication.
4. Combined ETag/delta protocol для viewport; client отправляет известные content hashes, сервер возвращает только changed chunks. Combined ETag сам по себе экономит bytes/parse, но не DB CPU, поэтому он идёт после batch SQL.

### Этап C — immutable terrain + overlay renderer

1. Развести terrain/infrastructure/entities ownership.
2. Не вычислять terrain повторно в materialization worker.
3. Не уничтожать terrain texture после overlay.
4. Budgeted center-first background generation, GPU/decoded weighted LRU.
5. Atlas terrain оставить client-seeded; atlas overlay публиковать готовым compact snapshot.

### Этап D — generation worker boundary

1. Durable jobs + world worker для create city/district/task и regeneration.
2. Bounded spatial reads вместо whole-country deserialization.
3. Set-based road writes.
4. После профиля решить, нужен ли worker_threads для чистого CPU planner; перенос языка/движка без профиля не нужен.

### Этап E — storage evolution

1. Run/mask district chunk geometry.
2. Canonical road segments + derived cell projection, только с dual-write/parity rollout.
3. Redis/object storage только если production telemetry докажет L2 DB/egress bottleneck после предыдущих этапов.

## 9. Deployment и regeneration readiness

### Что уже готово

- Process/runtime separation и nginx routing описаны и реализованы (`docker-compose.yml:23-152`, `deploy/nginx-tasktopia.conf:122-151`).
- Published chunks disposable и transactionally invalidated (`src/server/app-service.ts:820-857`). Поэтому изменения только read projection/cache не требуют принудительной перегенерации всех миров: достаточно migration/backfill и lazy rebuild.
- Regeneration CLI делает audit before/after, retries и sequential processing (`src/server/regenerate-worlds.ts:28-99`). Geometry/catalog change требует `REGENERATION_FORCE=1`; без него clean worlds сохраняются (`src/server/world-regeneration-runner.ts:21-30`).

### Что было нужно закрыть до production rollout целевой схемы

1. Закрыто: release CLI передаёт `DATABASE_POOL_MAX` в `createDb`.
2. Закрыто: release CLI берёт global advisory lock и использует детерминированный run id.
3. Для storage migration использовать add/backfill/dual-read/parity/switch/drop. Не заставлять generator replay только ради смены encoding.
4. Для generator semantics/catalog выполнить force replay на production copy, audit, visual QA, затем production sequential run. После commit прогреть atlas и critical city chunks ограниченной очередью, не 100-way fan-out.
5. Отдельно проверить failure isolation не только по Node health, но и по PostgreSQL: MCP generation, world replay и web viewport одновременно; budgets по DB CPU, lock wait, pool wait, p95/p99.

## 10. Текущие тесты и недостающие gates

### Покрыто

- Compact/legacy DTO, ETag, L2 reuse и metadata-only hash stability (`tests/auth-routes.test.ts:114-189`).
- Negative coordinates и projection refresh (`tests/spatial-index.test.ts:13-53`).
- District projection row не больше 4096 cells (`tests/migrations-v13.test.ts:39-68`).
- Client cache ceilings, one HTTP viewport intent и наличие rolling metrics (`tests/e2e/map-streaming.spec.ts:129-145`).
- Scale smoke измеряет generation, nine sequential chunks, revisit, RSS и wire reduction (`scripts/worldgen-scale-smoke.ts:10-15`, `scripts/worldgen-scale-smoke.ts:122-206`).

### Не покрыто и должно стать release gate

1. Cold 100-chunk viewport и 20 concurrent viewers: query count, pool wait, p95/p99, DB buffers.
2. Multi-runtime stale road/surface/atlas cache.
3. Missed NOTIFY + event replay.
4. Large-country `EXPLAIN (ANALYZE,BUFFERS)` для roads, city overlap, entity refresh deletes.
5. District update 4k/20k/100k cells и trigger write amplification.
6. Road bulk write/mask parity.
7. Main-thread first terrain frame на low-end CPU и 100 chunks; count terrain computations and texture churn.
8. Atlas cold/warm budgets после restart и после nonvisual event.
9. Regeneration under concurrent read load, global replay lock, resumability и forced full-world audit.

Существующий E2E только проверяет, что metric attributes присутствуют, но не задаёт latency/byte budgets (`tests/e2e/map-streaming.spec.ts:140-144`). Scale smoke по умолчанию покрывает 1 city, 10 districts, 25 tasks и 9 последовательных chunks, а не batch endpoint (`scripts/worldgen-scale-smoke.ts:10-15`, `scripts/worldgen-scale-smoke.ts:122-142`). Это недостаточно для заявления «нагрузки практически нет».
