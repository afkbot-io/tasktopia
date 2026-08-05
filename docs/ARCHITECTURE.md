# Архитектура и сущности

Tasktopia: React/PixiJS → Fastify HTTP/Socket.IO/MCP → доменный `AppService` → асинхронный пул PostgreSQL 16. Геометрия мира хранится отдельно от read model чанков; terrain и часть поверхностей вычисляются детерминированно по seed.

Регистрация вызывает единый `AppService.onboardUser`: аккаунт, session, страна и необязательный первый город создаются внутри одной транзакции. HTTP-route только валидирует вход и не собирает доменный workflow самостоятельно. Вложенные мутации откладывают realtime-публикацию и cache invalidation до commit внешней транзакции; rollback очищает изменённые in-memory индексы.

## Карта сущностей

| Семейство | Сущности | Владелец и граница | Жизненный цикл |
| --- | --- | --- | --- |
| Identity | `users`, `sessions` | пользователь; session хранится только как SHA-256 hash | register/login → restore → expire/logout/delete |
| Access | `countries`, `country_members` | глава `OWNER`, министр `MEMBER`, наблюдатель `VIEWER`; все чтения мира ограничены выбранной страной | create → invite/select → revoke member → delete country |
| MCP | `mcp_tokens` | персональный token; права = текущая роль ∩ scopes, новые expiry 30/90/365 дней | issue → use/last-used → reissue/revoke/expire |
| City | `cities_v3` | `country_id` | create active → расширение bounds районами; archive зарезервирован контрактом |
| District | `districts_v3` | город выбранной страны | planned → active → completed; один active на город |
| Task | `tasks_v3` | район и город одной страны | planning → started → in-progress → testing → completed |
| History | `task_comments_v3`, `task_events_v7` | задача; actor может ссылаться на пользователя | append-only; удаляется каскадом только вместе с задачей |
| World | `roads_v3`, `world_features_v6` | страна; feature может принадлежать городу, району и родительской area | создаются/расширяются генератором; районные и дочерние features удаляются каскадом |
| Spatial read model | `world_chunk_entities_v11` | страна + chunk + entity kind/id | trigger insert/update/delete и одноразовый backfill |
| Integration log | `idempotency`, `events` | страна | mutation+event+response фиксируются одной транзакцией |
| Legacy | `projects`, `sprints`, `tasks`, `task_comments`, `roads` | старая hex-модель | runtime не читает; таблицы сохранены для недеструктивной совместимости/экспорта |

## Инварианты

- Transport не принимает `countryId` как доверенную границу мира: HTTP использует session active country, MCP — заново аутентифицированный персональный token.
- Чужие city/district/task id возвращают `404`/`403` без геометрии или данных другой страны.
- Изменяющие MCP-команды требуют `idempotencyKey`; запись домена, `worldVersion`, event и сохранённый ответ коммитятся атомарно.
- `/mcp` обслуживается официальным web-standard MCP v2 server handler через streaming Fetch→Fastify bridge: основной протокол `2026-07-28`, stateless fallback `2025-11-25`. Аутентификация принимает только персональный `Authorization: Bearer ttp_mcp_...`; Origin проверяется для всех transport methods. Отдельный Hono/Node adapter не используется, поэтому runtime не зависит от несовместимого framework major override.
- Районы четырёхсвязны, не пересекаются и находятся внутри актуальных city bounds. Footprint задач не пересекаются с дорогой, водой и друг другом; вход имеет короткий путь к пешеходной сети.
- `NEW_BUILD` и `PRIVATE` используют квартальные шаблоны; полный видимый asphalt (дороги, asphalt platforms и driveways) не превышает 20% района.
- `world_chunk_entities_v11` использует математический floor и корректно индексирует отрицательные координаты. Geometry UPDATE и DELETE удаляют старое membership.

## Чтение и производительность карты

`/api/bootstrap` отдаёт только identity, выбранную страну, первый город, общие bounds, counters, chunk size и asset version. План загружает города стабильными cursor-страницами `/api/plan/cities-page` по `(created_at, id)`, затем районы выбранного города, затем задачи выбранного района. Старый массив `/api/plan/cities` сохранён для совместимости. Геометрия приходит только из `/api/chunks/:x/:y?lod=overview|detail`.

Overview содержит 256 terrain samples, ограниченный набор общих PATH-связей и не содержит decorations, world features, nearby-city expansion или описаний задач; detail содержит 4096 клеток и только 128-символьный `descriptionPreview`, а полное описание читается из task detail. JSON-ответы от 1 KiB сжимаются Brotli/gzip. Клиент держит только viewport + 0,25 viewport prefetch и загружает до шести чанков одновременно. Параллельные чтения одного chunk/LOD объединяются; законченные ответы хранятся в LRU до 160 записей, а готовый ground — до 96 чанков. Обычное панорамирование не отменяет уже начатое полезное чтение, но адресная realtime-инвалидация отменяет устаревший запрос изменённого чанка. Detail/overview переключается с гистерезисом, а старый ground удаляется только после готовности замены. Сервер держит LRU до 64 готовых чанков; структурные события очищают cache страны, а status event — только пересекающиеся ключи.

Pixi canvas живёт весь срок выбранной страны. До первого готового ground поверх canvas остаётся явный loader; последующие чтения показывают компактный неблокирующий индикатор поверх сохранённого кадра, а базовый фон предотвращает открытие пустой области при быстром панорамировании. Общий `entity-reconciler` обновляет entity-слои по id/signature: неизменённые здания, районы, декор и world features не уничтожаются при панорамировании или единичном status event. Движущиеся агенты также reconcile-ятся по стабильному session ID и сохраняют позицию/маршрут между загрузками чанков; overview только скрывает слой. Один bounded BFS строит маршрут на его границе, а не каждый animation frame. Самолёт расположен в отдельном screen-space слое и не масштабируется вместе с миром.

Перегенерация страны использует transactional shadow build: временная страна изолирует полный повторный запуск production-генератора, после чего геометрия копируется в существующие semantic rows. Это сохраняет внешние ID и append-only историю и исключает публикацию частично перестроенного мира.

## Realtime и отзыв доступа

Socket.IO проверяет HttpOnly session на handshake и помещает соединение только в комнату выбранной страны. Каждую минуту long-lived соединение повторно проверяет session и active country. Событие несёт `affectedBounds`; клиент перечитывает только пересекающиеся resident chunks и игнорирует событие другой страны. Удаление участника из правительства отключает его соединения этой страны, logout отключает все сокеты session user.

## Миграции и эксплуатационные границы

Версионные SQL-миграции применяются до старта HTTP под PostgreSQL advisory lock; имя и SHA-256 фиксируются в `schema_migrations`, изменение уже применённого файла останавливает запуск. JSON-геометрия хранится в `jsonb`, а chunk membership поддерживается триггерами insert/update/delete. Одноразовый CLI читает legacy SQLite только в read-only режиме, импортирует dependency-ordered batches в пустую PostgreSQL-схему и сверяет counts/constraints; исходный файл не удаляется. PostgreSQL допускает несколько процессов приложения, но для распределённого realtime всё ещё нужны общий Socket.IO broker и межпроцессная invalidation.
