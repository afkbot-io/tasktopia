# Проверка релиза

Текущий CITY-контракт: [компактный cutover](COMPACT-BLOCK-CUTOVER.md) и
[art-геометрия](art/COMPACT-BUILDING-ART-CONTRACT.md). Инструкции ниже являются
чек-листом, не отчётом об успешном полном прогоне или production-релизе.
Исторические результаты с датами не подтверждают текущую ревизию.

## Общественные пространства и рост спринта

- Правила и ограничения: [TASK-PUBLIC-SPACES](art/TASK-PUBLIC-SPACES.md),
  [SPRINT-CITY-LAYOUT](SPRINT-CITY-LAYOUT-2026-09-05.md).
- Изолированная browser-фикстура `compact_public_spaces_20260905` содержит
  30 задач в трёх спринтах: все 15 вариантов PARK, фонтан/памятник на стадиях
  3/4/5 и большой парк 17×17. Создавать её только в пустой локальной схеме
  через `tests/fixtures/seed-compact-public-spaces.ts` с явным opt-in
  `E2E_COMPACT_PUBLIC_SPACES_FIXTURE=true`. Не сбрасывать существующие фикстуры.
- `tests/e2e/compact-public-spaces.spec.ts` проверяет реальную CITY-сцену,
  клики по объектам, соответствие канонической карточке, COUNTRY/PLANET,
  отсутствие ошибок PNG/API/console и лишних запросов карты при перемещении.
- Тесты `task-public-spaces`, `task-public-spaces-runtime`, `mcp-public-spaces`,
  `public-space-migration`, `compact-park-art` проверяют маршруты/непересечение,
  стадии, сохранение вида, перенос/удаление, MCP и миграцию без сброса геометрии.
- Проверки 1 000 задач чистого компилятора и 240 задач через AppService — разные
  нагрузки; нельзя выдавать первую за тысячу реальных команд с базой.
- Текущие деревья V7 и перекрывающиеся лесные кроны описаны в
  [контракте деревьев](art/COMPACT-TREE-ART-CONTRACT.md). Свежие локальные
  проверки отделены от прежних этапов в [отчёте](WORLD-FINISHING-2026-09-06.md).

Новый локальный пакет проверок переноса, постоянных площадок, инцидентов и
семейств служб: [COMPACT-WORLD-NEXT-VERIFICATION](COMPACT-WORLD-NEXT-VERIFICATION.md).
Браузерный тест переноса должен использовать новую изолированную схему: его
MOVE и руины намеренно сохраняются навсегда, обычный reseed их не очищает.

## Mobile и installable PWA

1. Запустить `npx playwright test tests/e2e/mobile-pwa.spec.ts`. Pixel 7/Chromium
   и iPhone 13/WebKit должны пройти viewport, safe-area, профиль и непрерывный
   pinch на PLANET, COUNTRY и CITY; service-worker/offline lifecycle проверяется
   в Chromium, потому что Playwright WebKit не воспроизводит production lifecycle.
2. На каждом уровне одним пальцем переместить карту, двумя — непрерывно приблизить
   и отдалить вокруг midpoint. После drag не должен открываться город/страна/задача;
   обычный tap должен по-прежнему открывать интерактивный объект.
3. На ширине 390 px и 393 px проверить отсутствие горизонтального overflow,
   доступность нижней навигации, поисковой строки и кнопки профиля. Touch target
   профиля и основных кнопок должен быть не меньше `44×44 px`; fullscreen settings
   не выходит за visual viewport и учитывает safe-area.
4. Проверить `/site.webmanifest`: `id`, `start_url` и `scope` равны `/`, присутствуют
   PNG `192×192`, `512×512` и maskable `512×512`. После первой загрузки существует
   cache `tasktopia-shell-<revision>`; `sw.js` и manifest имеют `no-cache, no-store`.
5. Отключить сеть и перезагрузить уже контролируемую вкладку: HTML shell открывается.
   В Cache Storage не должно быть ответов `/api`, `/mcp`, `/socket.io` или `/health`.
6. В профиле открыть «Push-уведомления»: до нажатия «Включить» системный prompt
   отсутствует. После явного нажатия разрешить уведомления, обновить страницу и
   убедиться, что состояние осталось «включено»; затем отключить и проверить
   удаление browser subscription и серверной записи. Logout также должен удалить
   подписку текущего браузера до завершения сессии.
7. На iOS/iPadOS 16.4+ сначала открыть сайт в Safari: вместо permission prompt
   должна быть инструкция добавить приложение на Home Screen. Запустить
   установленную standalone PWA, включить уведомления явной кнопкой и проверить
   переход из уведомления только на same-origin
   `/task/<номер>?countryId=<страна>&taskId=<immutable ID>`. Одинаковые номера в
   разных странах не должны открывать чужую задачу; отозванное членство не
   обходится сохранённой ссылкой.
8. При отсутствующих VAPID secrets профиль показывает «временно не настроены»,
   `/health` остаётся `200`, а операции с задачами продолжают работать. Для
   активной подписки проверить один push на одно событие; HTTP 410 удаляет endpoint,
   HTTP 5xx/429 даёт не более трёх попыток и не откатывает исходную мутацию.

## Закрытая регистрация

1. На desktop и mobile убедиться, что экран входа использует реальные игровые здания, деревья и транспорт, вводный текст не перекрывается сценой, а внутреннего пояснения о cookie и интеграциях нет.
2. Запустить production-конфигурацию с `REGISTRATION_ENABLED=false`: на анонимном
   экране должна остаться только форма входа, а `POST /api/auth/register` должен
   вернуть `403 REGISTRATION_DISABLED`.
3. Создать пользователя через `docker compose exec app npm run user:create --
   --email ... --name ... --country ... --city ...`; пароль должен дважды
   вводиться без отображения и не появляться в выводе или process arguments.
4. Войти созданным пользователем и проверить названия первой страны и города.
5. При `REGISTRATION_ENABLED=true` открыть форму регистрации: два password-поля
   обязательны, несовпадение не отправляет HTTP-запрос, совпадающие значения
   проходят повторную серверную проверку.

## Жители и глубина мира

1. Открыть малый тестовый мир (`npm run seed:test`) и приблизить карту до DETAIL.
2. Убедиться, что житель выбирает отдельный native micro-вид для каждого из
   четырёх направлений. Canvas — `8×8`, anchor `[4,4]`; старых трёхфазных gait-циклов,
   зеркалирования и покадрового масштабирования нет. При остановке поза стабильна.
3. Проследить проход жителя возле фасада, дерева и светофора. Перекрытие должно
   зависеть от точки ног: объект ниже по экрану рисуется впереди.
4. Дождаться короткого отдыха вне дороги. Над головой появляется
   небольшой пиксельный маркер, без огромного гладкого speech bubble.
5. Запустить `.venv-assets/bin/python scripts/verify-micro-ambient.py`:
   проверяются 36 принятых micro-изображений, source hashes, native bounds и hard alpha.
6. У восьми видов животных одна нейтральная поза, одинаковая при разных направлениях
   движения; старые rider/bus/gait assets не должны загружаться как fallback.
   Леса и task-парки сохраняются, произвольной мелкой россыпи цветов/камней нет.

## Транспорт и пешеходы

1. Наблюдать T/X-перекрёсток и переход не менее двух минут. Машина не въезжает,
   если выход занят; человек ждёт на тротуаре и проходит всю зебру без остановки.
   Краткая очередь допустима, постоянное зависание при свободном выходе — дефект.
2. Проверять после перемещения `data-traffic-unsafe-pairs`,
   `data-traffic-pedestrian-unsafe-pairs`,
   `data-traffic-vehicle-pedestrian-unsafe-pairs` и все три
   `data-mobility-*-unsafe-total`: значения должны оставаться нулевыми.
   Одновременно растут шаги машин/людей, `data-mobility-trips` и
   `data-mobility-crossings`; нулевые столкновения неподвижной сцены не являются успехом.
3. `data-wrong-way-cars`, `data-walker-off-path` и
   `data-walker-road-activities` равны нулю. Отдельно проверять текущее и пиковое
   ожидание; сравнивать со сценарием и бюджетом из
   [плана проверки движения](CITY-MOBILITY-DELIVERY.md).
4. У четырёх micro-моделей машин canvas `8×8`, кузов `6×4` либо `4×6`.
   Люди во всех направлениях имеют bbox `[2,2,5,6]`, размер `3×4`;
   физическая модель учитывает именно эти bounds относительно anchor `[4,4]`.
   Нет runtime-поворота, отражения, gait-цикла или больших автобусных габаритов.
5. Светофор отображает разрешение того же контроллера, который пропускает
   участников. Нельзя допускать конфликтующих разрешений или убирать
   reservation до полного выхода кузова/пешехода.
6. Дождаться короткого отдыха на безопасном участке. Люди не стоят
   на зебре, не проходят через здание, забор, воду или декор. Закрытые
   строительные участки недоступны до пятой стадии.
7. Переключить CITY → COUNTRY → PLANET → CITY: скрытый город не симулируется,
   прежние IDs и canvas сохраняются, `data-mobility-network-builds` не растёт
   от неизменной загрузки сцены. Проверить `prefers-reduced-motion`.
8. Пожарный micro-responder является отдельной инцидентной отрисовкой;
   старых больших автобусов, велосипедистов и самокатчиков в ambient-потоке нет.

## Атлас и городская композиция

1. Открыть страну: существует один `.country-overview-raster` canvas без scene SVG/WebGL, DOM всей страницы не превышает 1 500 узлов. Ответ `/api/countries/:countryId/overview` имеет `schemaVersion: 6`, содержит geography terrain/territory, города, агрегаты районов и `miniature.blocks` / `miniature.airports`. Один semantic block представлен одним компактным домом; полная геометрия CITY, дорожные cells и props не передаются. Старые `coverageCodes`, `shapeCodes`, `districtCodes` не являются контрактом новой миниатюры.
2. При 20 wheel-событиях zoom непрерывно проходит промежуточные значения и не превышает `2.6`, города не стягиваются друг к другу, а Long Tasks API не фиксирует задачу дольше 50 ms. Raster использует directional COUNTRY sheets при `16×16 px` на geography-клетку; PLANET и CITY используют собственные `8×8` sheets, без масштабирования между уровнями. Для гор, воды, равнин и песка проверить окончания, прямые, углы, T-стыки и пересечения N/E/S/W. Иконки используют принятые compact PNG без растягивания под контур района. Соседняя суша и вода совпадают с PLANET fixture; движение самолёта проверяется только при наличии двух подходящих завершённых task-аэропортов, а не при любом открытии страны.
3. Открыть большой и маленький города при обычном viewport, `1440×1100` и мобильном размере: без движения мыши появляется полный первый кадр. Начальная композиция — `160×100` клеток; диапазон CITY всегда `0.8..4`, `data-minimum-render-scale="0.8"`. Если resident raster меньше экрана, видимый край заполняется локальным seed-ландшафтом без объектов соседних городов. При pan/resize не должно быть чёрного края; выполняется один country-scoped city-scene запрос и ни одного `/api/world/viewport` или `/api/chunks/*` от drag/wheel. Перед acceptance-скриншотом дождаться `data-ground-bake-queue="0"`, наличия static ground и task views, а не только счётчика зданий. Переключателя освещения быть не должно. Через Playwright `page.clock.setFixedTime` проверить реальное МСК: рассвет06–10, день10–16, закат16–18, ночь18–06; часы теста меняют Date, не останавливают RAF. Проверить свет фонарей ночью, читаемые номера и сохранение того же canvas; после возврата во вкладку время должно пересчитаться.
   Улицы идут по общим границам прямоугольных кварталов; все повороты и перекрёстки соединены, тротуар непрерывен. Без отдельного bridge-плана квартал/дорога не должны занимать воду.
4. Стадии 1–2 используют физический участок выбранного семейства (`6×6`, `6×3` или `6×4`) и отдельное одноклеточное ограждение. Старое сжатие площадки до 3–5 строк не применяется. Стадия 0 отмечает свободный слот, а не создаёт задачу.
5. Проверить лису/кошку и оленя/кабана: native canvas `8×8`, одна статичная поза, без смены ног, дополнительного сжатия, bob и rotation.
6. Сначала подтвердить, что disposable fixture действительно содержит 10 городов и две завершённые аэропорт-задачи с настоящими слотами (не SQL-декоративные airport features). Затем замерить raw country-overview с бюджетом `200 KB`; пока fixture или прогон не подтверждены, записать NOT RUN, а не успешную проверку.
7. После десяти циклов `Планета → Страна → Город → Страна` виден один активный уровень. Допускается ровно один скрытый retained CITY canvas для быстрого возврата: его анимация и симуляция остановлены. При выборе другого города он заменяется, а не накапливается. Число scene asset leases ограничено текущей сценой; размонтированные Pixi renderers и COUNTRY DOM-aircraft не остаются в DOM.
8. В шапке нет кнопки `Карта`, счётчиков районов/зданий, отдельной кнопки `План`, текстовой плашки `В сети` и нижних help-плашек; `План страны` доступен из меню названия страны. Кнопка аккаунта квадратная, содержит зелёный presence-dot и доступное имя со статусом, высота шапки на desktop равна `52 px`.
9. Внизу карты видны `Планета · Страна · Город`. На планете кнопки страны/города disabled; после выбора страны открывается её атлас и disabled остаётся только город; после выбора города доступны все три уровня.
10. На стране сравнить подписи самого короткого и самого длинного названия: кнопки остаются читаемыми и нажимаемыми. Один город не должен автоматически растягиваться крупнее масштаба карты с несколькими городами.
11. Outward wheel, достигающий фиксированного минимума города `0.8`, сразу открывает страну без timed hold. Хвост того же непрерывного жеста не открывает планету. Новый outward жест на границе страны `.55` открывает планету. Обратное направление над настоящим городом при `2.6` открывает тот же CITY без принудительного retreat. При zoom над океаном PLANET не выбирает ближайшую страну. Проверить `atlas-wheel-navigation.spec.ts`, включая мобильный letterbox и сохранение курсорного world-point при обычном zoom.
12. На планете перемещать плоский pixel-atlas drag и приблизить wheel: рамки стран остаются фиксированного экранного размера, не пересекаются и нажимаются. Карточка показывает название, progress, число городов и зданий в работе; длинное название не перекрывает процент. Облака движутся бесшовно, самолёт меньше городского варианта и уменьшается у начала/конца маршрута.
13. На планете отображаются только страны текущего аккаунта. Их квадратные 8×8 территории не пересекаются, крупная страна визуально больше маленькой; клик и Enter переключают заголовок и атлас на ту же страну. В стране карточка города показывает название, число районов и progress; число зданий в работе относится к карточке страны на планете.
14. PLANET v4 рисует один дом на район, COUNTRY v6 — один на квартал. В новом городе не должны появляться удалённые airport/archive-комплексы и их старые PNG. Сервисный резерв AIRPORT не создаёт самолёт: CITY v3 `airportConnections` содержит только завершённые task-аэропорты своей страны, хотя бы один endpoint выбранного города, максимум восемь направленных связей. Проверить исключение незавершённого и чужого аэропорта; удалённый endpoint не вызывает загрузку чужих чанков. Особая графика и полноценный airport/rail/bus комплекс остаются будущим подэтапом.
15. При `prefers-reduced-motion: reduce` самолёты скрыты, облака статичны, а все уровни карты и переходы остаются работоспособными.
16. Изменение статуса задачи обновляет агрегат города; комментарий не вызывает новый overview fetch. Структурное событие получает одну новую revision `/api/countries/:countryId/overview`.
17. Запустить `npm run test:atlas` на подтверждённом fixture из пункта 6: требуются один raster canvas без scene SVG/WebGL, движущиеся DOM-aircraft между реальными аэропортами, безопасный hover/click, first frame `<2 s`, raw payload `<200 KB`, viewport-safe CITY minimum, один city-scene request, нулевой pan I/O, rollback при ошибке preload и десять разных city eviction cycles. Наличие этого чек-листа не подтверждает, что текущий fixture и весь сценарий уже проверены.

## Уведомления о зданиях

1. Перевести здание из `STARTED` в `IN_PROGRESS`: push должен содержать `Здание №… «…» перешло на этап «Строительство»`, ниже — `страна · город · район` и действие `Открыть здание`.
2. Находясь в другом городе или на атласе, нажать действие: открывается правильный город, камера центрируется на origin здания и появляется его карточка.
3. Проверить `PLANNING`, `STARTED`, `TESTING`, `COMPLETED`, создание, переименование, чек-лист, документы, дефект и смену ответственного: технической строки `Задача обновлена на карте` быть не должно.
4. Комментарий не создаёт push. Удаление показывает факт сноса без неработающей кнопки перехода. Durable replay использует тот же formatter, что live Socket.IO.
5. Поиск в шапке называется `Поиск здания`; результат из другого города и ссылка `/task/№` должны использовать тот же точный переход.

## Chunk Streaming V2

Это проверки низкоуровневых chunk/viewport API и изолированных pipeline-сценариев.
Обычный вход в CITY использует scene API, описанный выше; не требовать от него
старого viewport HTTP-поведения.

1. В DevTools задержать `/api/world/viewport` и `/api/chunks/*` на 3 секунды: текстурный terrain должен появиться синхронно до первого ответа, а `.world-canvas` получить `data-seed-first-frame="true"`, `data-seed-first-frame-mode="synchronous"` и `data-seed-terrain-pattern="procedural-pixel-v2"`; дорог и зданий до authoritative overlay быть не должно.
2. Перезагрузить тот же viewport: ответ хранится в приватном HTTP-кэше и перепроверяется content-hash ETag; комментарий к задаче не должен менять ETag.
3. Изменить status обычного здания: после загрузки stage asset растёт `data-entity-rebuilds`, но chunk HTTP-запрос отсутствует и `data-ground-rebuilds` не меняется.
4. Задержать один building PNG: ground должен появиться до ответа; после ответа растут `data-entity-ready-publishes` и `data-entity-rebuilds`, то есть ранний reconcile соседа не оставил здание пустым.
5. Один раз оборвать building PNG после realtime status: клиент должен повторить только entity-assets, сохранить готовый ground и опубликовать новую стадию.
6. Проверить `.world-canvas`: `data-static-ground-views` равно числу GPU ground entries, `data-chunk-data-cache <= 48`, `data-chunk-payload-cache <= 160`, `data-ground-cache <= max(96, data-resident-chunks)`, все resident/видимые ground сохранены после завершения загрузки, `data-ground-bakes-per-frame-max = 1`; `data-ground-texture-resolution` равно `1` в detail и `0.5` в overview.
7. Зафиксировать `data-chunk-payload-p50-bytes`, `data-chunk-payload-p95-bytes`, `data-chunk-payload-p99-bytes`; аналогичные `p50/p95/p99` атрибуты для `chunk-request`, `chunk-parse`, `chunk-materialize` и `ground-bake` заканчиваются на `-ms`. Сравнить cold/warm viewport; worker/CSP/Pixi errors недопустимы.
8. Проверить, что БД хранит `city_layouts_v1`, `district_layouts_v1`, `city_blocks_v1`, `task_placements_v1` и `road_networks_v1`; таблицы `roads_v3`, `world_features_v6`, `world_chunk_entities_v11` и `world_chunk_district_cells_v1` удалены. Клетки — производная проекция, не построчные canonical road/district данные.
9. Низкоуровневый viewport-запрос возвращает `payloadVersion: 2`, `generatorVersion: block-v1`, `roadRuns`, `surfaceRuns`, районные `cellRuns` и свободные `plannedSites`. Materialization не теряет координаты и не допускает декор на зарезервированных слотах; старый v1 fallback отсутствует.
10. На семиклеточной collector/arterial/highway дороге должна быть одна жёлтая осевая линия, две travel-полосы и сохранённая общая ширина. Проверку движения выполнять общим 120-секундным сценарием [CITY-MOBILITY-DELIVERY.md](CITY-MOBILITY-DELIVERY.md): все три счётчика физических конфликтов и `data-wrong-way-cars` остаются нулевыми, оба типа участников продвигаются в каждом десятисекундном окне. Автобусы не создаются (`data-buses="0"`); удалённого `data-wrong-way-buses` больше нет. У native-машин четыре авторских направления без анимации колёс.

## Геометрия обновлённых зданий

1. Запустить `npm run assets:compact:verify`: у всех трёх зарегистрированных compact-семейств в `reference/ai-authored/<key>/report.json` нет ошибок, а source/runtime SHA совпадают с принятым `visual-review.json`. Старые residential geometry/door-review команды удалены.
2. Проверить каждую стадию 3–5 при `1×` и nearest-neighbour zoom по [точному семейному контракту](art/COMPACT-BUILDING-ART-CONTRACT.md): apartment `48×48 / 6×6 / [24,48]`, row `48×24 / 6×3 / [24,24]`, wide `48×32 / 6×4 / [24,32]`. Базовая клетка `8 px`, вход `S:3`, шаг этажа `5 px`; створка/портал соответственно `4×3 / 7×5`, `4×4 / 6×5`, `3×3 / 5×5`, panes `2×2`. Старый модуль двери `8×16` не применяется.
3. Крыша занимает основную часть высокого фронтально-верхнего ракурса 45°: у apartment регион `30 px`, фасад `15 px`; row `17 / 5`, wide `22 / 10`. Все линии крыши, окон, дверей и стен согласованы с осями; нет уходящей боковой стены и тяжёлой чёрной baseline. Намеренные clearances row `2 px` сверху и wide `1 px` сбоку не меняют физический участок.
4. Стадия 4 сохраняет оболочку, тёмные незавершённые окна и примерно половину крыши без финального оборудования. На стадии 3 крыши нет, кладка собрана примерно наполовину, видны стены комнат и непрозрачный затенённый пол. Процент стройки не равен высоте изображения; глубина пола и физический участок не уменьшаются.
5. Проверить hard alpha `0/255`, максимум 32 цвета, отсутствие прозрачных дыр в комнатах и общую source-frame нормализацию. Сверять structural mask с точным контрактом каждой семьи: допустимый inset первоначального apartment не становится универсальным разрешением смещать другие здания.
6. Стадия 1 — отдельное ограждение с воротами; стадия 2 добавляет компактные фундамент, кран/будку/материалы внутри участка. Runtime-композиция не подменяется catalog thumbnail. На стадии 5 внешнее ограждение снято, тротуары и соседние слоты свободны от наложений.
7. Последовательно выполнить `npm run assets:build`, затем `npm run assets:verify` и `npm run assets:storybook`. Активны три building keys и 15 runtime-стадий; terrain/tree/micro audits обязательны. Нельзя параллельно менять runtime и проверять его.
8. Проверить task-owned парк, воду и парковку на всех стадиях; добавление задачи заполняет первый совместимый слот и не двигает старые постройки. Проверить сервисный резерв следующего слота без автосоздания задачи или готовой службы. Особые service/transport комплексы и `RELOCATED` click-through отложены и не считаются пройденной проверкой.

## Изоляция runtime

### Явный контекст страны

Перед проверкой изоляции подтвердить явный MCP-контекст:

1. Создать для одного аккаунта две страны A и B, оставить A выбранной в вебе и вызвать `task.get` для задачи B с `countryId` страны B: задача должна вернуться, а web active country остаться A.
2. Убедиться, что `tools/list` содержит `country.get`, не содержит `country.get_current`/`country.select`, и каждый tool кроме `country.list` требует `countryId`.
3. Для аккаунта-владельца A и наблюдателя B выпустить полномочный ключ в A: запись с `countryId` A должна пройти, запись с `countryId` B — вернуть `FORBIDDEN_SCOPE`, а страна без членства — `COUNTRY_ACCESS_DENIED`.
4. Прочитать `tasktopia://countries/{countryId}` для доступной страны и убедиться, что старый `tasktopia://country/current` отсутствует.

### Процессы

1. Проверить health `3000`, `3002`, `3003`; nginx `/mcp` должен идти на 3002, а HTTP regenerate — приниматься web на 3000 и ставить durable job для worker на 3003.
2. Запустить долгий MCP mutation и одновременно открыть `/health`, `/api/bootstrap` и существующий viewport: web должен отвечать независимо от загрузки MCP event loop.
3. После MCP mutation убедиться, что web получает realtime event через PostgreSQL relay и обновляет только затронутую страну.
4. Остановить контейнер `mcp`: web-карта и Socket.IO должны продолжить работу. Остановить `world`: чтение карты, обычный API и MCP read-команды должны продолжить работу; generation jobs остаются в очереди и возобновляются после возврата worker.
5. На изолированной копии production-БД проверить migration `0023` и полный replay с явными `REGENERATION_RUN_ID`, `REGENERATION_FORCE=1`, `REGENERATION_MAX_ATTEMPTS=3`. До восстановления map traffic каждый город должен получить ACTIVE layout и чистый audit; сравнить task IDs/номера/статусы, документы, связи, историю и seed до/после. Миграция удаляет только производное пространственное состояние, старые rendering-ключи и кэши, не продуктовые задачи. При ошибке откатить одновременно snapshot БД и ревизию приложения; никаких автоматических production-команд в рамках QA-разработки.

Автоматические браузерные проверки находятся в `tests/e2e/chunk-pipeline.spec.ts` и `tests/e2e/map-streaming.spec.ts`.

## Исторический gate 1.19.4 — не выполнять для compact runtime

Ниже сохранены старые размеры, gait и bus-сценарии для истории релиза.
Текущие правила движения и команды выше заменяют их.

1. На native detail scale просмотреть `A→B→C→B` для north/east/south/west:
   canvas остаётся `16×24`, стопы имеют общий baseline, промежуточная поза может
   быть уже контактных поз, но голова, торс и длина конечностей не меняют масштаб.
2. Сравнить восемь моделей в `tmp/vehicle-proportion-proof.png` и
   `screenshots/transport-native-views-review.png`:
   horizontal/north/south используют одну frontal-top камеру, одинаковую линию
   колёс и контакт с дорогой; canvas равен `24×16`/`16×24`, а occupied bounds —
   `22×13`/`13×22`. North/south — один связный кузов без отдельной тени.
   Проверить, что catalog/manifest SHA-256 совпадает с исходным листом. Во время
   движения `data-vehicle-rendered-frame-mask` достигает `1111` на horizontal:
   меняется пиксельный блик ступицы, но runtime не добавляет bob кузову;
   north/south не получают wheel overlay.
3. На T-перекрёстке убедиться, что все travel-роли лежат на asphalt. За полный
   26-секундный цикл транспорт должен иметь не менее 90% номинального времени
   движения; плановый all-red равен 1 секунде. Если хвост автобуса ещё физически
   пересекает box, только этот узел адресно продлевает all-red до освобождения.
4. Принудительно вернуть `503` для viewport после готового кадра: seed/готовый
   ground остаётся видимым, ошибка показывается компактно. Отдельно оборвать
   инициализацию renderer: кнопка «Повторить» должна пересоздать карту и получить
   `data-seed-first-frame="true"`.
5. Исторические результаты релиза 2026-08-23, не evidence текущего cutover: `474 passed / 7 skipped` unit,
   `27 passed / 6 skipped` E2E, `42` animation families / `126` frames, `1 224`
   PNG без нарушений и `8` vehicle models / `24` views. Все `10/10`
   world-validation городов имеют clean audit. Scale-smoke: generation
   `11 866 ms`, cold chunk `233 ms`, cached chunk `47 ms`, compact wire `−82%`,
   RSS `417 MB`.

## Release gate

```bash
npm run test:db:start
npm run assets:compact:verify
npm run assets:build
npm run assets:verify
.venv-assets/bin/python scripts/verify-micro-ambient.py
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test \
DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test npm test
npm run build
npx playwright test tests/e2e/map-streaming.spec.ts --project=chromium --workers=1
npm run test:db:stop
```

Тяжёлые генерационные и scale-сценарии запускаются отдельно и не конкурируют
с browser gate за PostgreSQL и CPU.

Фокусированный cutover gate (тестовая БД должна быть запущена; при другом порте
задать соответствующий `TEST_DATABASE_URL`):

```bash
npx vitest run tests/compact-building-art-verifier.test.ts \
  tests/building-art-catalog.test.ts tests/construction-stage.test.ts \
  tests/block-layout-grid.test.ts tests/block-layout-compiler.test.ts \
  tests/compact-city-cache.test.ts tests/compact-city-runtime.test.ts
E2E_SEED_COMMAND="npm run seed" \
COMPACT_CITY_SCREENSHOT_DIR=screenshots/compact-city \
npx playwright test tests/e2e/compact-city.spec.ts --project=chromium --workers=1
```

Демо seed предназначен только для выделенной локальной E2E-БД. Скриншот
принимается после загрузки земли и объектов, с нулевой ground bake queue;
число появившихся entity само по себе не доказывает готовность сцены. Этот раздел
задаёт процедуру; свежие результаты test/build/browser, ограничения и статус
выпуска зафиксированы в [RELEASE-READINESS-AUDIT.md](RELEASE-READINESS-AUDIT.md).

## Полная проверка мира новостроек

Отдельный сценарий использует актуальный fixture `seed-world-validation`, выполняет серверный
world audit после каждого города, затем открывает каждый город настоящим
PixiJS-клиентом и сохраняет скриншоты:

```bash
npm run test:db:start
npm run test:world-validation
npm run test:db:stop
```

Подробный контракт, телеметрия и принятые показатели описаны в
[`docs/qa/WORLD-VALIDATION.md`](qa/WORLD-VALIDATION.md).

## Визуальная проверка мегаполиса

Сценарий мегаполиса создаёт один город из 100 задач в шести районах через
действующий AppService; заполнение добавляет кварталы, а не районы-продолжения.
Используются три принятых компактных семейства и task-owned площадки.
Сценарий сохраняет машинный отчёт и браузерные скриншоты в
`screenshots/megacity-validation/`:

```bash
npm run test:db:start
npm run seed:megacity-validation
MEGACITY_VALIDATION_SCREENSHOT_DIR=screenshots/megacity-validation \
E2E_BASE_URL=http://127.0.0.1:5197 E2E_SEED_COMMAND=true \
npx playwright test tests/e2e/megacity-validation.spec.ts --project=chromium --workers=1
npm run test:db:stop
```

Серверный отчёт должен содержать `tasks: 100`, `taskCatalogSize: 3` и пустые
`violations`. Проверить неподвижность старых слотов при росте, связность дорог,
стадии 0–5 и отсутствие пересечений с соседними слотами/тротуаром. Старые имена
скриншотов lowrise/highrise не означают наличие удалённых семейств.
## Реагирование на пожар

1. Откройте задачу в готовом высоком здании и создайте шесть активных дефектов.
2. На detail LOD убедитесь, что очаги находятся внутри фасада, занимают разные этажи и не образуют одну горизонтальную линию. На компактном здании должен остаться один небольшой очаг.
3. Проверьте responder у бордюра при native `1x`: используется красная micro-машина
   `micro-car-red-west`, canvas `8×8`, anchor `[4,4]`, направленная влево.
   Маячок и начало струи находятся внутри её одноклеточной площадки справа от
   здания. Больших автобусных/пожарных спрайтов и растягивания старых PNG нет;
   отдельные модели цистерны/лестницы в текущем компактном наборе не заявлены.
4. Струя должна начинаться на крыше машины и последовательно тушить все очаги. При переводе между точками меняется угол непрерывной дуги, затем новая точка удерживается; блики и ударные брызги продолжают двигаться без масштабирования всей линии. Telemetry `data-incident-water-targets` должна быть больше `1`, а `data-incident-water-target-indexes` — меняться.
5. Переведите один дефект через `IN_PROGRESS → VERIFYING → FIXED`, затем закройте остальные. Огонь должен исчезнуть при пяти активных дефектах, дым — после последнего, без повторной загрузки ground или потери камеры.

Фокусированная автоматическая проверка геометрии responder:

```bash
npx vitest run tests/micro-incident-responder.test.ts
```

Это не заменяет визуальную проверку всего сценария тушения выше. Удалённый
E2E-case `realtime task status` больше не является release gate.

## Плотная страна и локальный release audit

1. На отдельном fixture из 100 городов проверить desktop `1440×1000` и touch
   `390×844`. При более чем десяти городах видно не более двенадцати
   неперекрывающихся подписей с короткими указателями; все миниатюры сохраняют
   географические координаты. До готовности изображений подписи не получают
   нажатия и фокус.
2. Открыть «Города · 100»: доступны все города, поиск и очистка не отправляют GET.
   Колесо/палец прокручивает список, не карту. Escape возвращает фокус на кнопку;
   поиск сотого города, Tab и Enter открывают именно его. На самой карте drag и
   zoom продолжают работать. Для десяти и менее городов прежние подписи сохранены.
3. После прогрева сделать 30 переходов CITY → COUNTRY → PLANET → CITY: выбранный
   город и renderer сохраняются, CITY/COUNTRY не запрашиваются повторно без
   изменения ревизии. Видимая PLANET может перепроверяться раз в 30 секунд;
   скрытая карта не должна продолжать этот polling или симуляцию.
4. Искусственный 503 при обновлении CITY оставляет предыдущий кадр и явную
   ошибку до «Повторить»; изменение камеры не должно молча убирать ошибку.
   Два накопленных до готовности renderer события задач не теряются.
5. Нагрузочные fixture, команды, результаты и ограничения текущего локального
   кандидата: [RELEASE-READINESS-AUDIT.md](RELEASE-READINESS-AUDIT.md).
   B/C-сценарии роста окружённых районов пока не проходят; без решения этого
   ограничения и внешних production gates релиз не разрешён.
## Rectangular parcel plans (2026-09-06)

New blocks are template v3 with `parameters.sitePlan.version=1`; old v2 blocks
must retain their original slots. Regression coverage is in `block-site-plan`,
`rectangular-parcel-packing`, `block-art-family-runtime`, `compact-release-plan-db`
and `compact-release-preflight` tests. Invalid plans must fail, not regenerate.

`TEST_DATABASE_URL=<local tasktopia_test URL> npx tsx scripts/seed-block-plan-preview.ts`
creates a **new uniquely named local schema** and prints its identity. It never
resets an existing fixture. Use that schema's search_path as `E2E_DATABASE_URL`
with `E2E_BLOCK_INFILL_FIXTURE=true` and `tests/e2e/block-infill.spec.ts`; use the
production build and a unique screenshot directory. The fixture has96tasks,
3sprints, parked residual lots and mixed construction stages.

Review CITY/day/night, boundaries, task clicks, COUNTRY, PLANET and mobile;
assert one scene/overview/atlas request and no chunk/viewport reads or console
errors. CPU-only budgets and the old/new parcel comparison are available in
`npx tsx scripts/benchmark-block-infill.ts`; do not confuse them with FPS or
database latency. No new long/L/U artwork is approved by these geometry tests.
