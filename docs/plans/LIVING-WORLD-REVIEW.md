# Ревью реализации живого мира

База: 9037d2cd53ebb4cf864adce64d190e91c3df36bd. Рабочая ветка codex/living-world-plan. Журнал AI-ревью и исправлений. Итоговая сверка находится в конце; SCM-проверки и approval учитываются отдельно.

## Исправленные замечания

- P11: повторное off/on подсветки сбрасывало полный metadata snapshot. На M это давало82запроса/серию и p95=384/511мс. Scoped cache с TTL60секунд сохраняет снимок; revision/retry/accessrefresh его инвалидируют. Перенос публикации ids/Graphics до paint дал29,9/61,3мс и0запросов. После восстановления PostgreSQL повтор после layout effects прошёл:2browsertests, /tmp/living-world-review-restored-browser.log.
- P09: прибрежная ЖД перекрывала все подходы к морю. Первый коридор теперь выбирается на западной сухопутной стороне; сохранённые не двигаются. Проверены настоящий automaticPORT, конкурентность,16последующих задач, соседний город, сохранение резерва после удаления.
- P09: первый CITY в новой прибрежной стране не создавал личную географию без посещения PLANET. Теперь инициализируется один раз; границы пустой страны фиксируются при первом городе. API/browser/storage проверены.

## Просмотренные границы

Персональное внимание: membership+revision+page читаются одним MVCCstatement; максимум250записей на страницу; нет текстов задач и чужих идентичностей. Клиент публикует только полный snapshot, максимум один restart409, отмена и повторные cursor/ID проверяются. Кеш изолирован по пользователю/стране/городу/ревизии и не превышает минуту.

OG: публикация требует членства и совпадения одобренного отрывка; сохраняется snapshot с hash-токеном. GET проверяет текущее членство автора и наличие задачи; отзыв/delete закрывают доступ. HTML экранирован; URL основан на configured origin; no-store/noindex/no-referrer. Проверка всей цепочки CSRF/index/logger/PWA и UI отдельно ещё должна войти в итоговое ревью.

Сводка: один SQL snapshot, ограничение1001событие/1000обрабатываемых/20карточек, текущие названия и членство,30дней. Личная география: lock строки пользователя, append без изменения существующих записей; вызывающая транзакция/ретраи уже проверялись ранее, финальная проверка всех callsites ещё не завершена.

Миграции0030–0035 просмотрены: новые таблицы/индекс, nullable opt-in profile, уникальность PORT, immutable trigger; отсутствует массовое перемещение старых объектов. Docker/PostgreSQL восстановлены. Изолированный recovery gate прошёл 16.09: обнаружение изменений строк/sequence/schema, независимое восстановление, повторный rollback, восстановление после DROP, отказ на повреждённом архиве. Артефакт: tmp/cutover-database-miqzc2_0/integration-report.json; отдельная репетиция архива M/L выполняется.

| Просмотренный файл | SHA256 |
| --- | --- |
| src/client/components/MapAttention.tsx | 18c9a616cd712945b3488fe33a61eebf27da106035023f6931fb63e1d3720d7f |
| src/client/map-attention-loader.ts | bfb2e98f073a424bc534df7a55cd4551e656cb1cebb7a8bab99ba469213a0fa3 |
| src/server/map-attention-read.ts | bae2a2e5790a0c3e74735050e7c162ece98a8b882012adb9c2537d0596814167 |
| src/server/task-share-routes.ts | 27cb1965e2e8d49c232613dbf9ff3ecfb2483fb5bb9f6148dac47eb4fd28d78c |
| src/server/world-digest-read.ts | 4736612eaeb2601d78257f6eeb5b173ac63c5eed3b4d51f34a4a399683cfc173 |
| src/server/personal-planet-geography.ts | f0f9c6ea8cbbd2f6b86e93c4a35749faa9203cb3744cd020de27b4b42e848bf9 |
| migrations/postgres/0030_task_share_previews.sql | 104689c97fb5d635516a5bafb9f6308978d40278c7f3ee22d3715e78cf81c9e5 |
| migrations/postgres/0031_world_digest_index.sql | add044d2efe6fd119a3ed29e95afd40ba74bfb47209af17a79c0cf8fa570578c |
| migrations/postgres/0032_personal_planet_geography.sql | 599d0ced1104d6d34577060647da15295826f4d66903f464355ef214262f1b3f |
| migrations/postgres/0033_city_railway_corridors.sql | e076a79e0fc51fdcf6f30ddb90b41e09507bddb5cb6c945e62bb22769067d69a |
| migrations/postgres/0034_port_service_role.sql | ff3db2702371823e3de9203735e5965332b09a898241c90f153dd5b4caf097b7 |
| migrations/postgres/0035_world_terrain_profile.sql | 9023e67e534c75afd815d0a76fdcb11c1c55bdd1159b9a474b46e8c1a8f6768f |

Актуальное состояние: все108изменённых/новых исходников src просмотрены (hashes ниже). Остались итоговое ревью тестов/документов/конфигурации/ассетов, полное сопоставление AC, финальные обязательные проверки и MR. Новая правка просмотренного файла требует сверки hash и повторного review затронутой части.

## Дополнительное чтение OG, сводки и уведомлений

TaskSharePreview и TaskModal изолируют состояние по country/task key; publication показывает передаваемый отрывок и сохраняет requestToken при lostresponse, revoke сбрасывает его. PWA исключает /share/task и из precache, и runtimecache через общую константу. Requestlogger маскирует bearerтокен в path. Глобальный onRequest ограничивает browserorigin всех изменяющих APIопераций. WorldDigest использует отдельный user/countrykey и WebLocks для cursor, отмечает просмотр после двух rAF; asyncответ отменяется при сменеscope. transport-invalidation передаёт только hint текущим участникам, данные другого мира в событие не помещает. Эти файлы просмотрены без нового доказанного blocker; общий review всё ещё частичный.

| Файл | SHA256 |
| --- | --- |
| src/client/components/TaskSharePreview.tsx | 92f882e9fcd91d54c55c8b46c6b6ada947f3b98d02a83e44c968e04fe52b75fa |
| src/shared/task-share-preview.ts | 6ad112d9eb1ea3dfedb470fb25463007cd26d3cea7683a3eeb731fc23794794c |
| src/server/request-logging.ts | a634624091856f8cf96148969d6acd5d6764ffe75d05c5d20df3aea76d76b0dc |
| src/client/pwa-cache-policy.ts | e5bd8e8f601a80f6478a70fca8c7e7de59405ce73aea9382c570c101ce862aa9 |
| src/client/pwa-service-worker-source.ts | a3c34aaa11c48f38feab808c68f8ebd1777f97116739cb89f4c1e5b5de4adb4e |
| src/server/index.ts | a40fc7a13185753dcf2669d73e55c1862924c8a85d691196e57444e22b7c2c2f |
| src/client/components/WorldDigest.tsx | e22439ee0624e7661fa313e855c375f2717d54b1475e3e75a8a5c87d8e54ddbd |
| src/client/world-digest-cursor.ts | 63c671c624080f1dca87a8a87d834f5376f5bf823387d8335b989f3efb8b7c24 |
| src/server/transport-invalidation.ts | 4a8db1df74112f00f8622e5472d5ed8e7b11cd9cb18f935f716fb5061d8438a4 |

## Районы, качество, миниатюры и морская инвалидация

Просмотрены adaptive-world-quality/use-atlas-quality/visible-animation/world-preferences, construction-life, district-development/view, DistrictPlans, CityDevelopment read/transport, city-miniature, city-scene-content и country-render-snapshot. Ограничения рабочих8/2, материалов16, заборов48 и miniature12+3 подтверждены источниками; планы декоративных районов строятся из всей сцены, не зависят от панорамирования. Autoquality требует устойчивых окон давления, не реагирует на один долгий кадр. Скрытый CITY проверяет activeRef перед изменением глобального quality.

Найден и исправлен P09-дефект: countryRenderKey не включал seaConnections. Открытие/отзыв удалённого порта не меняло локальные здания, поэтому retainCountryRenderSnapshot оставлял прежнюю сцену и корабли. Добавлены появление, исчезновение и изменение пути в tests/country-render-snapshot.test.ts; RED /tmp/living-world-sea-render-key-red.log, GREEN /tmp/living-world-sea-render-key-green.log. COUNTRY теперь инвалидирует транспортный render snapshot по морским связям, как по AIR/RAIL. Браузерное подтверждение liveобновления на последней сборке ещё нужно после восстановленияБД.

Основные WORLD-GENERATION/ARCHITECTURE/BUILDINGS/QA актуализированы: реальный каталог57семейств, профили,PORT, snapshots/доступ, общие расписания и ссылки на evidence. Архивная square-v8 часть остаётся явно ненормативной. Общий review всё ещё не завершён.

| Файл | SHA256 |
| --- | --- |
| src/client/adaptive-world-quality.ts | 52c478bf56f1a202dbf26c9e8392d848f0d7a90c53b60386c0afd8c1827ca3d0 |
| src/client/use-atlas-quality.ts | 8c9d48f2271ea053e1882f428b0d000f48b7c9a17e6093eb9ba557479c2c6735 |
| src/client/visible-animation.ts | 289b6936c5e69c6fb4d900ba4600e2a0e052bf11286eb09d54937160a6ca4787 |
| src/client/world-preferences.ts | 8ce3536347e1b916be5c140a08cbb95f87f7227a4ffc0dafe844d7cb6d67e0b7 |
| src/client/construction-life.ts | 893c073623a37538960d6d76844074324c1051c8e2986edbd6cc9388e1d21741 |
| src/client/district-development.ts | 16c2e93d2f48f92439bbeb786a94678e7ffed5716d3556fb8c634f85c5255a42 |
| src/client/district-development-view.ts | 6f6deca92c83d1b74155edf65b68fd8ab4ab37a24e82577472001047f8fd1e75 |
| src/client/components/DistrictPlans.tsx | ea6fb337d96df39072f1edecaf3d438a76337625ca56a0b828818e55a2742047 |
| src/server/city-development-read.ts | 11929c5d60d63d31cbeb6736328fea6616fea32038b3044ec17a7dd8c8e58ebe |
| src/server/city-transport-development.ts | b118fb863e79cd558f72bf4c111a54a01d1918f88f6798acec83edc83f3da323 |
| src/shared/city-miniature.ts | b5e22faddfab9f6489f230b080371b8ba91a769a83ed1a792faaada044feb1ba |
| src/client/city-scene-content.ts | 696933eb210e8a582ffbd50de9c9025057abfb8df326b688785901dc0ecdc0cd |
| src/client/country-render-snapshot.ts | f93ff7a47ae375218fae4a768d11707f39420962bcae7dd0d3228feaa3639fb1 |

## Морская инвалидация: проверка жизненного цикла в браузере

Дополнительный сценарий отправляет transport invalidation через настоящий Socket.IO транспорт при обновляемой render-фикстуре overview. Он обнаружил ещё один дефект: cleanup останавливал stopShips, но не удалял HTMLImageElement корабля. Исправлено удаление каждого ship.view; проверены исчезновение и возвращение того же routeId без смены масштаба. /tmp/living-world-sea-cleanup-browser.log:1passed/2.9с. APIавторизация/готовность портов покрыты отдельными настоящими storageтестами, этот сценарий проверяет клиентский lifecycle.

Просмотрены общая сеть endpoints, airalias, порты/океан, offmapпроекция, city-rail-service, серверные часы, port-site-provider, planet-miniature-read и international-air-connections. Сервер использует privateнавигационные резервы только при расчёте и возвращает доступные endpoints. Сохранение исходной сторонности/общего ID подтверждается одним transportSchedule. Общий review всех файлов ещё продолжается.

| Файл | SHA256 |
| --- | --- |
| src/shared/transport-network.ts | 81455a31e08a2d32f4aa8e8ba29dd974c61a935c492e29850cdef4a1f4035d13 |
| src/shared/air-network.ts | 7eef4f71ea5e4520fa0b46f70fc85a54487e41ccd837d4bd7a496ca9141c0195 |
| src/shared/port-routes.ts | 431f11820368108dd2bc163c8ea126d78b01887a6cf6627f79b4d8c19b8d91b4 |
| src/shared/ocean-connectivity.ts | a6d95e387a8caac50918ddb3f4904bde0d2707fc928a33cb331a895d554ab2bb |
| src/shared/transport-offmap-point.ts | efdcefbae19ee6791a3cd4875801450a18b1e1a23a28222368ef4c097eacc44a |
| src/shared/city-rail-service.ts | c9d5af50c4ebfca79504ed06eebf604de6890f6472b6b4be1b06b07196b87f03 |
| src/client/server-world-clock.ts | 240b625e3a67e487afc9ee85ff89034820637d470a486751dee9cf46a4954e85 |
| src/server/world/port-site-provider.ts | 5eb0bee5d21ed1d4d9b5f5719f4d867743512e91a98cc2307c8ac1e68bbd7330 |
| src/server/planet-miniature-read.ts | cc20497274ed6441c20ad06fe4487508fb5f9e420f9de880fa3ff9b7b776b1fd |
| src/server/world/international-air-connections.ts | ac5c92c0b46ff80d8471c6b968b0fd64985f57948ec77d400484dd3326753af0 |
| src/shared/planet-port-transport.ts | 00dde9f0cf1a0472e3578f22f542d2fdcd021f112db0991e2af149bc97d77ab3 |
| src/shared/transport-schedule.ts | 22bcd9bd2fa8d58a05fad8f1461697e2d1a659a973610d237a032f1301944d7e |
| src/client/components/AtlasShips.tsx | 89f2c10776862d3642ce101df4333d56decd73ba003cdba3cca32007cff39a43 |

## Продолжение ревью: маршруты и события порта

Проверены изменённые проекции стран, передача terrainProfile в планировщик дорог,
резервы путей/порта, выбор аэропортов, общие маршруты и часы транспорта, а также
инвалидация сцен. Найден пропуск PORT в map-invalidation: обработчик считал его
обычным зданием, а серверный atlas:invalidate намеренно исключает исходную страну.
Поэтому внутри страны готовность порта могла не обновить соседнюю CITY-сцену.
Регрессионный тест сначала упал (PORT: expected false to be true), затем прошёл
после добавления PORT к транспортным событиям. Дополнительно проверен ответ уже
начатой загрузки соседнего города: устаревшая сцена отбрасывается и загружается заново.
14 тестов в двух файлах прошли; scoped eslint чистый.
Логи: /tmp/living-world-port-invalidation-{red,green,lint}.log.

Отдельно исправлена неограниченная ветка countryOverviewCache при чтении сохранённых
снимков: теперь она ограничена 128 записями, как и ветка генерации. Четыре теста
согласованности, typecheck и scoped eslint прошли. Это не означает, что весь
AppService уже прошёл итоговое ревью.

| Файл | SHA256 |
| --- | --- |
| src/server/world/country-geography.ts | ae18806c7c7fcf7e46feb01189bb2713d835aa9ceb9657da6d32f28772fcd2bc |
| src/server/world/intercity-road-planner.ts | 29a4c0c06ab15165bb413782bf4110804ef4710d1f03325f468ecdae04ff2908 |
| src/server/world/intercity-road-store.ts | 48c3f4254da143cc1dade8e47efbef0a6c1bbca48b328c055c5c5a2e761be1e1 |
| src/server/world/city-airport-connections.ts | b711922e3cde9a15a4679201956895675a18e9036e403aca40c748b227b67fbf |
| src/shared/country-railways.ts | 1ae683c23462fa7ae2c4a175e08e02f9bd58e9a424271c28da8f4c34c1de51c2 |
| src/shared/atlas-grid-transport.ts | e3eb5f59443f20ddb1b62ad6293820cca5633719f7a30a125144f28e620066ba |
| src/shared/planet-surface-transport.ts | 53cd97ef5eb862c958956f7de2abe8acb307f76ecc6094755b686e323e417cb7 |
| src/shared/overview-building-art.ts | 6e7d801ba5eb0e5cbe92f7469cecfeac1fb2e293862b58d966c6de1c324678e9 |
| src/shared/transport-building-art.ts | 288a214537f5c2403f7bba64ad9821322970ca52e09b2bbfb7c7832aa5cf2b48 |
| src/client/city-micro-flights.ts | 2b760e3904ede5dcfa60ac22e47ffd34f654aa6ae8eaefdd4fd0ab227d9690fc |
| src/client/city-railway.ts | 6cc56e08359be6edc19f905d80c547b75726a4760ec140f8fe92940189335233 |
| src/shared/city-railway.ts | a51b552c32ae2830fc68562e8565b3fa5b344f01d75a7e3d3816391c748ea8e9 |
| src/shared/rail-convoy.ts | 103c341346692bcde5766aa55eeb809f85df9d4cfdb4b9fe569882905a4a039d |
| src/client/map-invalidation.ts | 5c0ed60f17f54610757e775f81578a290117bd9474708726b2c6cb68b3a8e395 |
| src/client/world-light-clock.ts | e3689be0d6d945ab91eca67346aa0cd4c8138829422f7877eca11af6c2ba69a2 |
| src/client/components/WorldAmbientLighting.tsx | 82309bb78f3a79cd59e2cb429e0e34e7b323ae13e3e72505f6e6d6f5c9df1fad |
| src/client/city-tree-padding.ts | dbf57a37041c51e81cc08592b83c593ab436d7ee566b7f3764edbe7d2f2ddaef |
| src/shared/world-terrain.ts | 7c712dedab23f322f437e21959ac69af08af9a077c6b47a24628e7e937a4dd4e |
| src/shared/world-chunk-payload.ts | 862dcbaa29db537537c77cd4023838022fb6b94fdbdf8669792d7fa9dede267c |
| src/shared/block-world.ts | ce3d12aea34295add98cc77d039b016ac57f9a893a209e35646d1a5e8141713d |
| src/shared/compact-building-families.ts | 9da139756ff4bac102eaa117f4e22b3d29da1c02239a99ba12af227c6c68756a |

## Композиция карт, контракты и размещение

Прочитан полный diff WorldCanvas, CountryOverviewCanvas, PlanetAtlasCanvas и App:
границы scope, отложенная загрузка необязательных ассетов, остановка скрытого
рендера, сохранение транспортного времени, пересоздание/очистка объектов. В режиме
reduced-motion самолёты и поезда скрывает CSS; статичный корабль перепроецируется
при перемещении камеры. Проверены общий граф и преобразования координат,
компилятор новых кварталов, сохранение старых профилей, резервы ЖД/порта,
добавочные optional-поля контрактов и авторизация новых HTTP-точек.
Новых доказанных blocker после PORT invalidation не найдено в этих diff.
Итоговая проверка AppService, оставшихся файлов, тестов и AC ещё не закончена.

| Файл | SHA256 |
| --- | --- |
| src/client/App.tsx | 5af5392e38b15ee55211324642befce9fd9c064c84c537a5a40cfe7dbb267bed |
| src/client/api.ts | a5770bbe92e09eec3a4e2e35a7ff314daf2a35f15fc7b9b964aa3ebd4ab349f3 |
| src/client/components/CountryOverviewCanvas.tsx | a0dce91e1a3b342c7536cbcfcf48db20d3406ffd0456cca1cc95c99aacb5df95 |
| src/client/components/CountryPanel.tsx | 8d1fb29922f159cc3b451b2fda26ea560aeddbdfeddeb10972f8aabd40ca0b20 |
| src/client/components/MapLegend.tsx | a3339227e5c905a0c5a07533ff315c9b0f5a607db2f6cbbc6d230b2d6b20e110 |
| src/client/components/PlanDrawer.tsx | f08b65c1f713fd583beaeb71e0b1879921348a0817246702db7b54ac438fcb45 |
| src/client/components/PlanetAtlasCanvas.tsx | f9875e7ec235f18ace89b3bdf509405f69f140f73682c3c8284d74dd8ba9a995 |
| src/client/components/TaskModal.tsx | 911c52d760f485bd8b46c4368499af5ac712c0c3f9652d8fbd1d2644858f87c1 |
| src/client/components/WorldCanvas.tsx | 770c5dd81cc50231fd550c13eb551d9976338cb997a5c306971a96e00445c4c1 |
| src/client/country-city-labels.ts | 1ad50040a8fbe7b9cd735771d9e3dcfc4dbce701b570013a03318c4385cfdbf1 |
| src/server/auth.ts | deff55ef8dabc5f9b42e035bca0ae76cd18be7d823e224c25264a67f1ff2178e |
| src/server/routes.ts | b5ded73b690eb953b7ad1df1947869ff3dd38067ddf4f3c61ffac50423f99a82 |
| src/server/world/active-block-layout.ts | d89587f0a415fef3306bd7627756e6607c87dab16cc09a26527423aa0eb1d8ac |
| src/server/world/block-layout-compiler.ts | 3499cd6c2aab9b16aa9217c110740768f2e72ba78b77e18b6e2ebc049bc399d0 |
| src/server/world/compact-city-site.ts | 41f2680fef4608770d01b9ac7ec42671bc7404e8b90c9a67f286a5617cc748fb |
| src/server/world/country-overview.ts | 5dfd0c2310e6db4bfce7c6950fd064c1966337fdd70a7fd84c4858366a225349 |
| src/server/world/world-audit.ts | d7a14360bdbee9abfcc94c26f2457f1a4e7a34c2cb5e6fc87e4b35354d603371 |
| src/shared/block-templates.ts | 324da912fba01067bf698bc2d910f92d152eef111b02304fd9d482b87bedde5d |
| src/shared/city-scene-contract.ts | bf1af4310de5234f54dbac5fe11174b261337c12caebd7e665fca6f597f82828 |
| src/shared/contracts.ts | b789c5e64856a0e1a94c276c8a58f8fb26ae1601c88d93b3efbac41071341746 |
| src/shared/country-overview-contract.ts | cc67ff9a6fcdc5f43ed1c349cdf04fedf8adbcb7d716933134a7e1f8f47cdeb3 |
| src/shared/planet-atlas-contract.ts | bd408e1a3f16ad2b7eee2eea6c9ee1369f87c82a743dea9edd956582016211d9 |
| src/shared/planet-atlas.ts | ce2cf4c34b9db1fbbc2e543e91d0dc325749c3c540f601dd69bf6fc1bf7674c9 |
| src/client/components/MapDependencies.tsx | 59f6473926478c2c5646b7167cb394dd212b690f4dace48f0c042181632790c2 |
| src/client/components/ScheduledAtlasFlights.tsx | e17438f5aa2e5fbf07346247b9aadc55fb35a1ea3e05d9be473f6180582a2ef0 |
| src/client/components/ScheduledAtlasTrains.tsx | 5128ea71dab522e08d312fb8d655e35c31bdcd4ae6564debcef8b68a36e3f8f2 |
| src/client/map-dependencies.ts | 66980ceac18d862de5a5226e1f88fd7f4dce95ae6bb0ff3d87b945d45e9d45c9 |
| src/server/world/city-railway-store.ts | 44606bb8fca63e8d3b429a233efcbdfb981bbdae8ad86e3cb6beb36d29c4b28f |
| src/server/world/port-reservations.ts | cb4ab87fda97099edb787f5858d08a23d44b0e114e4f5aa6e794cf44735af8f9 |
| src/shared/building-profiles.ts | 68f1ddcac70e32965cf04751f16c63797e3343a967636b6cee81ec5675b4e443 |

## Серверные снимки и оставшиеся исходники

Завершено чтение полного diff AppService: повтор целой MVCC-транзакции при
конфликте, публикация кешей только после commit, private-география и транспорт
текущего пользователя, самостоятельный первый прибрежный CITY, расширение
резидентной сцены для причала. Отдельно прочитаны публичная проекция географии,
выделение новых областей, отсечение иностранных маршрутов, интерфейс развития,
пользовательские настройки, портовый рендер и CSS. Проверен CSS reduced-motion,
который скрывает поезда и самолёты при остановленном frame loop.
Новых доказанных blocker в этих файлах не выявлено. Это завершает чтение
изменённых production-исходников; тесты, документация, конфигурация и ассеты
должны быть сверены отдельно перед итоговым review.

| Файл | SHA256 |
| --- | --- |
| src/server/app-service.ts | 1a50d3048e0d06bb025c0b176f8b3816b10fb92409d2a5ca7e35e2803fc73b77 |
| src/client/map-scene-cache.ts | 2d4d75514353b86ab34e93a4dc785a9d9c63074e990596a085472a08edafae0e |
| src/shared/sea-vessel.ts | cc6cb69f8d39ad8c555e65374d2dcc49fdcc1ee3226ff02ef12ed90f79045e55 |
| src/shared/world-terrain-profile.ts | 1239cd5abcc197fae29e4e544619a5e052069174b2210963374332ac4aa95080 |
| src/shared/port-site.ts | 975376fac34465bcd51ed67277c6db04461b2820bffc326b6c533a08f627e201 |
| src/shared/port-ocean-link.ts | f2b6e4a2b3dedbb526b849be7e3b4d06a0884dd68243d00a985cd03bfb25b228 |
| src/shared/map-attention.ts | 13f5b639cd624c93c3359f63615397da15bd99ba16c1f843f55a6b2a354eda61 |
| src/shared/world-digest.ts | 52bd75bce8d005e9822b6fcf96c928a6da0a484ea9eba354fc49e38c4e200d68 |
| src/shared/city-development-policy.ts | c7092635cec8f83081adcf49a88ba12b1bf7b850af60e58edc88612b09433124 |
| src/shared/city-development.ts | 727c8ab254ad353276fa99c32a119adcadac4da76df4f25603d837b4db354ace |
| src/client/components/WorldPreferences.tsx | 9f5f2a1d6b6f43717e8a699ca619dcac70d7303368b9131bdc8982c00b7bb887 |
| src/client/components/CityDevelopmentPanel.tsx | f37f45bb638016143713f67942bfec4d6f66b735fa6b85e11c52e72bf3151b8a |
| src/client/city-port-view.ts | 02db9713c00ba77d97971ff18e58ddfa8efa5384ef06abd721649aa776bd95fc |
| src/server/world/country-foreign-rail.ts | 4426a81c905eabdfb74b4e382185e43b8fd07f7fc7685f83218518a478ab6d01 |
| src/shared/planet-geography.ts | 30321f7855468ac005b4f54618cb4c06fa6e5e61af3f9db9a87973d0d1b848b4 |
| src/client/styles.css | b2e62f394729c43092cbfc33a30b3a42db86e6843d222fc538c19984b2067512 |

## Ревью проверок и локальных инструментов

Просмотрены все изменённые/новые tests и scripts: публичные HTTP/MCP/браузерные сценарии, реальные storage-переходы, rollback фикстур, синтетические render-only сценарии и ограничения размеров/числа объектов. Render-only фикстуры не выдаются за доказательство выдачи инфраструктуры; для неё есть отдельные AppService/storage проверки. Общий запуск регрессий ещё предстоит. Изменения декора публикуются через существующий props atlas; нормализация сохраняет nearest-neighbour и бинарную альфу. Производственные источники не менялись после последней сборки.

| Файл | SHA256 |
| --- | --- |
| scripts/build-construction-worker-art.py | 8a78498e93f9f44cea2e77512c938aaed6420ef275e711ff366cde9e64ba7a50 |
| scripts/build-district-development-art.py | 8604f08b79988737aa3fb9ab02ac007f81ffa14b7126a956409d8a43d73b7e9c |
| scripts/measure-living-world-attention.ts | 659179314c670b0a0d20c013eda5d18fec1faf6b63642ab2687932a7ef0ddf16 |
| scripts/measure-living-world-motion.ts | 9da6f349cce32b6849934f6357c32805a54336545353e8b79132621ff30e591f |
| scripts/measure-living-world-performance.ts | d315c88a005b0f75779deff23fc99047bd017cd9eb11338762b20bf451425cc0 |
| scripts/preview-building-profiles.ts | b7c4944530ebdd700c6ce0a8fc17465bce978e750c8585d3cecdda419c2f9535 |
| scripts/seed-living-world-performance.ts | 35096fe3af8e5bbf7988cffc2a823f41dd52e064cb62f5c043c8a13f0e4ee689 |
| tests/air-network.test.ts | 5c2caf124aa0ca47922a0cb1e31fd2af409bedcdda0d277dd0926eda018e747e |
| tests/app-service.test.ts | 3919bd1e253c92d49e2ec3fd29791f6ab57f5ceeb31e81d36fefa876061a6feb |
| tests/atlas-aircraft.test.tsx | a4ba209ef9895ab034f7a4fd078d453da5e3123ec89083748fc99db035d737e1 |
| tests/atlas-grid-transport.test.ts | ead7e95ac51d220f05a2eadabfb628cf1402c11a4f85e07dd4a413c42eac3703 |
| tests/atlas-transport-fixture.test.ts | 8d83894dc949b1b342a09531965e639b42258e5407f1c88c8df6bf7afa407e0a |
| tests/auth-routes.test.ts | 5f270d5683820fcb8806f2223f62fca8a7fd381b0bd38de400e942e8d1ab1abc |
| tests/auto-port-issuance.test.ts | bc51cb72e8c533c87532b881ca1307eb2b9808f7490180de163c8081df11825a |
| tests/building-profiles.test.ts | 0a0dc8945049a14cca4bfc9ecb58cd127b16ec94e6336711ed2eff63b6d2ffb0 |
| tests/city-airport-connections.test.ts | 5f912f8d0d81ff20523e566b1db221d313884277d21543bc384fd98227c655e0 |
| tests/city-development-policy.test.ts | 9a40b9e078337ae1712920a16f5570cb40e813b0a4beb4cde1aef1ec1ba6f4c7 |
| tests/city-development-read.test.ts | 699905cd52ab7e74e985b226879910534138b79879cf224ec19855e038ec5351 |
| tests/city-development-route.test.ts | 5aa239f747e5be4515068f3038f47e9a272504b94ffb31042a57cf0f9d749508 |
| tests/city-micro-flights.test.ts | 66789c539a77285d39987dc5b8b5027214ace23c3867583feb93ca708509d922 |
| tests/city-miniature.test.ts | 1aef441ad9ebeef833cff19de2467f70aaee68dce39d1d2e109001fbf1f4e2dc |
| tests/city-rail-connections.test.ts | e2c0d04cb8d6cfede3237fc0e351b8753af02829df405b901bc81876184c64ac |
| tests/city-rail-service.test.ts | 42cfacd966163386c1c32de2bcf4acdb587b6ba064ea4087a1195d3a20f4492b |
| tests/city-railway-store.test.ts | e608ac104a1089a78ff30dfcc901e7b2937ef8dc3a329992be50b1ae2cbfc6e9 |
| tests/city-railway.test.ts | e532ae12ecc045f4270a4fa5d382496f00c2b619412144efe582dbbeb90e09c8 |
| tests/city-scene-content.test.ts | 853c7fa7d1f1b6913dff2978b838b7a64d7d9373ddaa8c7614c5806617e340e5 |
| tests/city-transport-development.test.ts | 760a5a0d4e9d0c258941c0f4133e8113e093b253c6916cabe6ba667f8ed7c75c |
| tests/coastal-terrain-storage.test.ts | 0d588aeef0d976279521e63efddc42c924daf633c5d8281590ca8cdcf3451d90 |
| tests/coastal-terrain.test.ts | 5b470ec2af33c2d3319244639b3776b8bfcdcea5a0ea705261684cc1539548d4 |
| tests/compact-city-site.test.ts | 452a453a32a1b26e74ec900a10ef9fa4140920625d0a65aa76a87088130d35a4 |
| tests/construction-life.test.ts | 0604cae41e73bec3a7835c6ce0fd738335c51ed64b98537e4850bcec9878efab |
| tests/country-city-labels.test.ts | a196f828a092d986b3313dc13c0294a2d94177b32edd868a0a3470167a869fc6 |
| tests/country-foreign-rail.test.ts | 0381e7a07629440cc4e03c00c9344f90448ef8e4a97024def0326aacfee3af2c |
| tests/country-foreign-sea.test.ts | 11022c4c45cabb1c16361eb82bceaae3df4eed6971ee3b341c545e0475a6abf7 |
| tests/country-overview-consistency.test.ts | c19edffe2ff7fdf297e734a62a43bfd7d0e2d12b2e9b11fbaee8ff8b64f021ab |
| tests/country-overview-projection.test.ts | ad3f86f23ed02940dbc26530fd3dd533fd62bd20136fcb607de27c384b14f57b |
| tests/country-render-snapshot.test.ts | 8b2a1de77396baa29213e908feff7793a510ba1daac71b5252ceb166d5b541f4 |
| tests/district-development.test.ts | 2ecd722db09b2aa0272b0865a558e149e19319e333434c67c64cbef5f5a78cc0 |
| tests/e2e/aircraft-clock.spec.ts | 7a2a61a1241eacc14e5ef1d5ac8b043b00fee3517afb4fb7f92d4388200fc9da |
| tests/e2e/atlas-pixel-zoom.spec.ts | f435f43efe54fde7adefe56c139011955d4099eaff13933e278db34b6469f4fa |
| tests/e2e/atlas-transport.spec.ts | 1583aabdd9da59eee6144fd1679a98a61ed6be6a89f0ee0044e5247f4cc0b003 |
| tests/e2e/building-profile-city.spec.ts | 1ff46129c634ebedeab056572688e284112b2f02d76d7ed80809854804b2a848 |
| tests/e2e/city-asset-overlap.spec.ts | e569d93b6e85d69346703a0a40d7eda854e08ae1094b6dab8ebc1b69c2d9f5f0 |
| tests/e2e/city-development.spec.ts | 27ce56e17db2965634ff5c170b680e8f773f52dd4019df067612fea63f6bc4dc |
| tests/e2e/city-railway-transfer.spec.ts | 1765f339e59bb6c44a501585b21ec3e9cb8605bd183c3506ebabdef874def72e |
| tests/e2e/city-railway.spec.ts | 360bb915843bcc09b58531e6ae5e6ee00de2967861314866e3eafe04d0e43ada |
| tests/e2e/city-train-clock.spec.ts | 847ab49f38a56c271f395bbd5398aa96668a900248c62760036e6e955b1984d8 |
| tests/e2e/coastal-port.spec.ts | 7ae1679f8a580e71f647a3bffc54f542bdd428b2ec696f09f05579c171ebbd1b |
| tests/e2e/coastal-world.spec.ts | a978c4fc5ef23cdc502bf3171c38e3637149c1a005c5983e7495822c95fad07b |
| tests/e2e/construction-lifecycle.spec.ts | cdf9344e322c4a3c5f7bc272fd38f3efd8587e1e15c2050ff0fa44fde5d74d1b |
| tests/e2e/country-activity.spec.ts | 300998624b46443a3faed8fa346ab1c12d8be6bccdf1ce5906344518d5e0ca6f |
| tests/e2e/country-label-visibility.spec.ts | 017ed8c2cbacf52017c82580bc6a7fa92ef848d9d2305753f882f1df3b95bf5f |
| tests/e2e/district-development.spec.ts | 83fce76234a7792b28d8c993c657d165dcf0dab87de57d3ac6522b935de9c9de |
| tests/e2e/foreign-transport-live.spec.ts | bd360fc06f4385ba74fe307135083a4d7a670fc3c1410312be1aeed724bdc0b4 |
| tests/e2e/map-attention.spec.ts | c3258d7746e1fb3832456a604fd25adc5c84168c28c9182ed8c41ed3cd7f6d0e |
| tests/e2e/overview-trains.spec.ts | 937dbf6cd8ae4e6e27b25983c40b9f7f38f695050d6fa5605e17642455842d33 |
| tests/e2e/planet-sectors.spec.ts | 0459e380e2dc0012f8e54f4aae90fba9aff068edc892282c919e246342ed118a |
| tests/e2e/port-terminal-art.spec.ts | 24352a356115feb0e66bd0354e3763b4c27276ad6cf86a766a6712024d6c89b6 |
| tests/e2e/task-share-preview.spec.ts | 65d29618817f1a51a4e60ea52a579b473dca85beb9b8ef6ed20ad10ce3c9f2eb |
| tests/e2e/world-digest.spec.ts | 1c6d07cbed92ca663bdea39be5fd944ceb785d29b623c1e2057a279fad49fd5c |
| tests/e2e/world-preferences.spec.ts | c979285a9309b32ceb939643ea578a5a492311ac9bbeeadf0a23630edbeac522 |
| tests/fixtures/atlas-transport.ts | 9743b66b6cd19a8ba18a72b8300fd2eec8ae87f289e94fc4d66082e7a4b591e3 |
| tests/fixtures/coastal-ports.ts | 9512bbd5c087dce9896479992141aa2f306af153d738f0f5cb756df5ae7f05b7 |
| tests/international-air-connections.test.ts | 84aa2a5ea7d9655147cf36c9cd0b9780017d4f417704cac351dec16b8e069f1b |
| tests/map-attention-loader.test.ts | 38006f568590f64d81987f47f1166bbcf99cab5ea46c4202a6ada4dd84242994 |
| tests/map-attention-routes.test.ts | 1249b00a70df874b718922c3a76f4b154622e8098d4e5a44598ef2301d419881 |
| tests/map-attention.test.ts | 0cd98e1102d58ee154e25542a3e0d4d1cfe9d1cb649f827d11e35045e8a3a69f |
| tests/map-dependencies.test.ts | 93356cbba9c588aac9ae5109b280cbb33b9a78731415aefbe2e8ccb82880fe92 |
| tests/map-invalidation.test.ts | 38da82506071bd2d9ff344b5f670bcffa6cde3b56b99bd219472aa38560763c2 |
| tests/map-scene-cache.test.ts | f5a2747e4f2f1e3667a919785ce3430a2c54bf2f1115224c41cdb2b6cdd9f9ec |
| tests/ocean-connectivity.test.ts | 9800ec42bd3dcfeaebfaa2d682b6018d11aa3f2625ee5c58142b8b0553db1fc0 |
| tests/personal-planet-geography.test.ts | 48fa996c00b4d9a8fd2dcc3c9f8628d1bb1a828d9bda7eb3064d73abcbdeca21 |
| tests/pixel-city-assets.test.ts | 18ff4b0e31398c1ab1a75bad36ae7ca281129ad0e75637bdea06891a2ad4a140 |
| tests/planet-atlas-route.test.ts | 6975e55c0cbf9f9508328e9ff5abd76fd43843af4482a204d6f61960e16f3f30 |
| tests/planet-geography.test.ts | 9ec159ca1a4f01364f6884d2ba08bdd21bc2983bd438adca7ccd4984033ce91c |
| tests/planet-miniature-read.test.ts | afef33090200552c5a4d6c80381eb198b6c19f6b048aa861b5f1c3c0e0449eb7 |
| tests/port-catalog.test.ts | 0b86405c642254d73a04b090092e40ecafd104a90d71191bb4711c3dd772babb |
| tests/port-compiler.test.ts | 5b2734f024c5641f48e411b961c2ab344c6dd2379fd8bd1f2e816e3e81e92626 |
| tests/port-issuance.test.ts | b09cb151c229e43d6cbbfab7001e2b4dc412fb39c38b3c443b34912bd2510d88 |
| tests/port-ocean-link.test.ts | de8f54abad343b989f7d58c9c2f155fc4cf391413ae6dd3dceea52cf870dce9b |
| tests/port-routes.test.ts | 1ceec2151be1d68dfb4228742e8c43847b14abec36d4cac18ec495fbf144e44f |
| tests/port-service-storage.test.ts | 84ae8472587bff65f66d32afc547c9f63302afb3c237eb252119596b43132733 |
| tests/port-site.test.ts | b4e9fceaff1b607732f428f1f36beb9ef42746f4fbb1f725afd6754bf1c00c76 |
| tests/pwa-contract.test.ts | 598ff6f0cac68d4f27ffa4cebc2f5731ddafbfd1093b44e62d1512fc8dff3a8c |
| tests/rail-convoy.test.ts | f2648ca7da7312d7e1b6c1ccfd3e47bfe2b7e8787687dd8bdca6021af4efb3de |
| tests/sea-connections-storage.test.ts | ced77dffbed022b7e73b47436450b55dec12c8beeb9ad5ca39c79ce5e8806ec5 |
| tests/sea-vessel.test.ts | 1dfa16ceb9263b1fa5dd45f2742e64b346846742aed573d7f9b770d568fb8405 |
| tests/server-world-clock.test.ts | e716e22072ac000cc7153569cfadaf7d253e30feda96b3e5cac57ba70d645a98 |
| tests/task-share-preview.test.ts | 75862d3c32465d768037dfca77687336b013922a40fe766caf3d6bd133063cae |
| tests/transport-invalidation.test.ts | f8a47879ac777477e63b153a47a85dc28583e6d3d4820ba86ca7117aa95a57f8 |
| tests/transport-schedule.test.ts | 26b3344d3c94568408861ce97134bd403214c57f274b5d4d1381d5755882d62e |
| tests/visible-animation.test.ts | 18843adb9858abe1e0e9ffcd69121b7af0f50da44fc54a14b5a4400e240f6e57 |
| tests/world-chunk-payload.test.ts | c5a7d30c2f60a5125f8d2e23218fbeec14515390ddd0df9e7928ea6cf0aba22b |
| tests/world-digest-cursor.test.ts | 8280c5a197ed6a4c91d524c598b29c33504ae6ad69b17821ef181232708edab1 |
| tests/world-digest.test.ts | 886bcf3a877e5b0e764041957684c34a205f4c7cd733b8f2dad7a6a6b634ac4f |
| tests/world-preferences.test.ts | cadb502fc282217b2bd10fd34cd6ce4a378af28741bab1f641cfb8b8f0c22b47 |

## Уточнение регрессионных проверок, 16 сентября

Общий прогон: 1328 passed / 34 failed. Все 34 ошибки закрыты адресным повтором восьми файлов: 53 passed, /tmp/living-world-final-regression-retry.log, exit0. 27 проверкам арта недоставало локального Pillow-окружения. Остальные причины: ожидаемый список миграций до0029, отсутствие SEA в пустой панели, устаревшие числа README, зависимость от порядка выбранных блоков, дробные размеры вместо округления до пикселя и слишком широкий SQL-фильтр. Проверка размеров сохраняет допуск строго полпикселя на каждую сторону; SQL теперь отдельно ограничивает полную карту и компактную проекцию одним запросом каждого типа. Это не новый полный прогон. Scoped ESLint exit0.

Проверка опубликованных ассетов обнаружила stale assetRevision; штатная пересборка выполняется перед повтором asset gate.

| Перепроверенный файл | SHA256 |
| --- | --- |
| tests/atlas-ship-path.test.ts | 93a9ab4a165ec124f61c1731906bdb357f1c066db16283f727acc64adc18b7ff |
| tests/overview-building-art.test.ts | 26aaa4cf2ad7c83dca1e918b5604ead5d6863a0e5d6bd33e1ef1b35247e190a1 |
| tests/detached-district-projection.test.ts | 6b05446585d5e195c90acfcade17d361ef2b55eb752a05b222175b6b3f88b980 |
| tests/city-development-route.test.ts | d0eeec5c3f5e9f9554bd2ae89f135ad6ec6f79d82159045c56137f03bc0fa296 |
| tests/server-read-model.test.ts | 05408acaa7d4066940a96b216b13954081afd8bd806756896a3bd5be4e672351 |
| tests/migrations-v13.test.ts | ad56d45989de2a158071d4706e34f6beb662b9666c31534396a9faf944856fa0 |
| README.md | 357442dbfa5d87a30186a78a2a83016e7b6dc97fd69650589c034174ed096dcc |

## Recovery и публикация ассетов

16.09 штатный assets:build и полный assets:verify завершились exit0. До/после сравнение SHA256 всех runtime PNG: changed0/added0/removed0. Исправлен только stale assetRevision; новые изображения уже были опубликованы ранее. Build приложения и typecheck exit0, /tmp/living-world-final-asset-revision-build.log. Реальный M/L архив восстановлен в новых изолированных контейнерах: 41 таблица, 29045 строк, 3 sequence; независимое восстановление, изменение фикстуры, rollback и повторный rollback с равенством полного snapshot. tmp/cutover-database-3bohv4xf/integration-report.json. Это локальная репетиция, не production deployment.

## Документы и браузерная конфигурация

Просмотрены изменения BUILDINGS, COUNTRIES-AND-ACCESS, WORLD-GENERATION и ARCHITECTURE: каталог57, пять стадий PORT, opt-in COASTAL, неизменность существующих планов, личная география, read models, публичный snapshot OG и расписания соответствуют исходникам. Playwright расширяет существующую WebKit-матрицу preferences/overlap, не исключает старые проверки. Motion-инструмент на mobile начинает CITY дальше от штатного порога выхода; обе сравниваемые версии используют одинаковый setup.

| Файл | SHA256 |
| --- | --- |
| docs/ARCHITECTURE.md | e9f956ea3568e6b59fe48a68c39f9975a68391e166012523ce40c0a03af4367c |
| docs/BUILDINGS.md | bd671b064e1e0a8982f160e858ffb76633984da60ca2ed7e1c2a2ff214345027 |
| docs/COUNTRIES-AND-ACCESS.md | ff70c113dc398f2f368acd2a0a1aeb826e7c4519a1f7271ae7a9a98178d055cf |
| docs/WORLD-GENERATION.md | b44fb07462224d871f70126b21327abfc15a761d420ac5442f728b32cc49cff4 |
| playwright.config.ts | 87513b8566f3ae39b517db92309bd2f56c7e777408d31b519ef538c8d0f86762 |
| scripts/measure-living-world-motion.ts | 9d5d1c544cb679bc64262b84e8b1adb7ba4e93027bd78cbe0072a45aa59c54f8 |

## Лимит запросов локальной общей браузерной серии

24 сценария:16passed/8failed, /tmp/living-world-final-browser-journeys.log. Trace связывает ошибки с429 country-city-scene после30 запросов за минуту на общемIP, а не потерей графики. Добавлен валидируемый CITY_SCENE_RATE_LIMIT_MAX1–1000, default30 сохранён. Playwright задаёт300 своему серверу; пользовательские prod-конфигурации не менялись. Оба scene-route сохраняют groupId, окно1minute и авторизацию. HTTP seam проверяет default,401до лимита и429после;5tests2filespassed. Scopedlint иbuild/typecheckexit0. Браузерный повтор8failed начат отдельно. Новая ручка позволяет явно настраивать лимит, не разрешает клиенту обходить его.

| Перепроверенный файл | SHA256 |
| --- | --- |
| src/server/config.ts | cd7bcd122719efd8fcc39b65804f14a8fde9155f201694f2c2c9981d2bc53b6a |
| src/server/routes.ts | 5e899fe3eccf87dfdf87eef4e190496ad8fdf9a272d093992fcfcd1e9765e428 |
| playwright.config.ts | 6f33f7448c2ae91048cb5f1396c5bbb83fe2035eb0f145cf7c0a00fb41f8929a |
| tests/city-scene-rate-limit.test.ts | ee04e2d122a5530c61a629d8139ada274b2c2eecff2eaf0da6e78e7f512d7b95 |
| docs/QA.md | a38544d3a6e106b18dfefaafd2041c001c258bd723d7b8d75c3f8040d976bc53 |

Браузерный повтор после явного локального лимита завершился8passed/44,2s; /tmp/living-world-final-browser-rate-retry.log. Вместе с предыдущими16passed все24 выбранных сценария прошли. Это не вся SCMматрица. WebKit отдельно дополнен atlas-pixel-zoom для проверки общего nativeмасштаба.

## WebKit: детерминированный observer качества

WebKit6:5passed/1failed. Проблема была в имитации давления: frame33ms×8 превращался в266ms и сбрасывал observer как backgroundgap>250ms. Теперь все callbacks одного кадра получают один шаг100ms, независимо от refreshrate браузера. Productionobserver не менялся. Повтор AUTOсценария в Chromium/WebKit:2passed, /tmp/living-world-final-auto-quality-retry.log. Совокупно все6выбранныхWebKit-сценариев прошли.

| Файл | SHA256 |
| --- | --- |
| tests/e2e/world-preferences.spec.ts | 6891ff1a5f0a701c991b11bfcb2bfb65a4f280764c3213bca97bf3660989eed6 |
| playwright.config.ts | 81f911e8b0a3d1f4c7bd5b8ed270a8df05a647f678a72a40f16dc8b49f78f26e |

## Обновление заполненной схемы0030–0035

Новый living-world-migration-upgrade.test.ts создаёт отдельную схему, применяет0001–0029, записывает задачу85сTESTING/HOTFIX, город/район, комментарий, событие и дефект. Перед/после0030–0035 сравниваются все поля строк10businessтаблиц (единственное новое nullableполе страны отдельно проверяется какNULL). Схема удаляется в той же транзакции. Это проверяет upgrade существующих данных, не только свежую установку. Первый fixture ошибочно использовал удалённые в0023legacyкоординаты, исправлен на актуальные bounds и ссылки. Итог1passed/exit0, /tmp/living-world-upgrade-preservation-retry.log. Внутренние сохранённые slotPlans отдельно покрыты существующими spatial/railway/profileтестами, не этим fixture.

SHA256 tests/living-world-migration-upgrade.test.ts: 23aab4e2d85e5e517699d4d0aef43a94767c5156f06b57392532cad78530111e

## Итоговое ревью камер, анимаций и инструмента измерений

16.09: просмотрены поздние изменения, перечисленные ниже. Траектория AIR строится
адаптивным делением квадратичной кривой с погрешностью1/8единицы, затем использует
существующий sampler длины: направление обратного рейса меняет касательную, а не
его положение/расписание. Вырожденная линия безопасна. SVGoracle двух движков
подтверждает погрешность<0,2единицы. Удалённые nativegeometryreads не заменены
другими чтениями layout на каждом кадре.

Retainedterrain использует неокруглённые мировые клетки и одну матрицу камеры;
предварительное округление, которое усилило бы ошибку приzoom8,5, отсутствует.
Маркер остаётся в пределах0,5map-пикселя от земли. Memoзависимости включают
atlasrevision/sector, маски не зависят от камеры; новый atlas не сохраняет старую
землю. Фильтр применяется только к группе земли, миниатюры/метки не затронуты.
Клик/keyboard/события страны сохранены. 20фокусных unitпроверок и10браузерных
проверок Chromium/WebKit прошли. Уточнённый screenshotтест ждёт конечный масштаб;
учтено различие нормализации wheelDPR2 между движками, повтор2passed.

Телеметрия измеряет два ограниченных участка ticker, не включает GPU или первый
reconcile и не выдаётся за них. Реальнаястоимость0,1мс desktop/0,7мс mobile,
окно120кадров. Счётчики только дополняют прежний dataset; скрытый ticker по-прежнему
остановлен. Census использует WeakRef через документированный hook Pixi,
не удерживает приложение и не меняет сцены. Рост кеша L проверен по URL: только
первые загрузки существующих направлений машин/животных, без новых копий сцены.

Проверки: build/typecheck после productionправок прошли; поздние scripts/tests
проверены отдельно. Бюджет mobile в плане приведён к точному30fps(1000/30мс);
33,1мс не объявляется результатом≤33,0. Отдельные rolloutflags и dual-read
не реализованы: раздел5плана теперь описывает реальную единую выкладку, обязательное
обновление каталога/PWA и запрет возврата старого образа к новым PORTданным.
Это ограничение будущего релиза, не разрешение на потерю пользовательских записей.

Новых блокирующих замечаний к перечисленным изменениям не осталось. Полный SCMgate
и MR ещё не завершены; AIревью не является SCMapproval.

| Перепроверенный файл | SHA256 |
| --- | --- |
| src/shared/atlas-flight-path.ts | 783862780006ab188d79e6fe17f747f70f2190330fda1fec3b0aaaf23e0807ee |
| src/shared/planet-atlas.ts | ab05fc76343d51a61b1f6dc9b15a41b6204db7558e895742af382b30afb9adab |
| src/client/components/ScheduledAtlasFlights.tsx | 71e3c3236b0902906af3632f4f15e900f46bfef0e8a2efdc141e35dc3b5bf2f2 |
| src/client/components/PlanetAtlasCanvas.tsx | cc25d6f2d4e10bbac4ae652057aea1af0aa632458b817a6a87148df99787f421 |
| src/client/components/WorldCanvas.tsx | 118aec3bba3754f087842a46be75e9a431a02d7ba191c657985b4952b0f75cd4 |
| src/client/styles.css | 69e58bf124b59e34aa3c009291204db874c4b20e851c097342a1e4256adff5ee |
| scripts/measure-living-world-motion.ts | d57a3fb9138a4280d1b4128a1539a929a0ae4177602c9092f9685c9b341c7008 |
| scripts/measure-living-world-performance.ts | f38c2b575dfd060ea794f9a3ff7e587d6381b0f6e6c0733109742bcb2a034c2d |
| tests/atlas-flight-path.test.ts | c68a2bc11f3f35f84e09a42f7b3c58bcae05846fe75b96218d42586feebbd288 |
| tests/planet-camera-transform.test.ts | bf0d3b531db8dc4b6848fc271124185d3f9f93f7fc4a03a6201f8356c7099438 |
| tests/e2e/atlas-flight-geometry.spec.ts | ec45242d043af8dc59371d14eaed62169f78c06d6961f6712f1e319f0016572c |
| tests/e2e/atlas-pixel-zoom.spec.ts | 35b6384329d11e4b223f15a1534e2c0a1dd5d952c7172e732235803f00e8683c |
| playwright.config.ts | d3ef8d7a97e5f378f664767d0b72de6357a0e85f81362fcbd08f815d5e916596 |
