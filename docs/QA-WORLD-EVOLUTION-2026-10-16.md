# Общая квалификация 1.25.0

Область: [33 критерия общей цели](PLAN-WORLD-RELIABILITY-EVOLUTION-2026-10-16.md),
задача [№53](https://tasktopia.online/task/53?countryId=4201d605-751a-469b-8d5f-a7e322a7ece1&taskId=4f2ef16c-8172-4715-8e2e-27f88979df78).
База — `053e061d84dbcafdeaf1841010f9bd2286c9c5f8`, цель выпуска —
`game3/dev-server/dev/all` через Builder и официальный updater.

**Контрольная точка перед CI на 23 октября: кандидат v6 заморожен; сборка/full TypeScript — PASS.
Performance-приёмка: 21 фактический PASS v5 переиспользуется с исходными
привязками, три новых Pixel1000-замера v6 — STRICT PASS. Это не новая полная
матрица 24 v6. На этой точке итоговый CI и выпуск ещё предстоят; их фактический результат публикуется в задаче №53 и PR58.** Source hash v6 —
`4173045433eb24e2b9e85d9a72270cb25b06d740c879b9f9e9302e712816e717`;
client `d92d2761…`, HTML `d3bc6db5…`. Server `dae136ca…` и игровые assets
`0c759074…` совпадают с v5; 1262 из 1263 runtime inputs не изменены.
В единственной изменённой строке `dispatchResponse` конечный BFS получает
единственную цель; маршруты и ограничения сохраняются, multi-target остаётся
полным поиском. TDD: три work-only RED BUS/SCHOOL_BUS/FIRE → **51 PASS/6 файлов**,
scoped TypeScript/ESLint и независимое source-review без открытых замечаний.
Диагностический trace v5 имеет leading gap 21,128 мс; событие 747 мс — запуск
CPU-profiler. Локальный 89,042-мс main-JS/RAF фрагмент включает BUS/SCHOOL_BUS
и маршрутизацию, но не атрибутирует исходный 61-мс longtask.
Полная серия v5 сохраняется историческим **STRICT_RED**: 24/24 функционально,
один Pixel1000 steady longtask 61 мс при бюджете 0; raw/portable не изменяются.
Прежние CPU4/network/DPR/NORMAL/steady8s/churn20 и бюджеты новых трёх samples
сохранены без retries/удаления выбросов. Cold — 9847,141/9511,834/8615,849 мс
при бюджете 12000 мс; steady longtasks 0/0/0, ошибок 0. Первый host preflight
остановился до браузера (0 samples); отдельный ручной preflight после изменения
нагрузки прошёл за 54,031 с с прежними условиями. Старые результаты сохранены.
[Раздельная итоговая сводка 21v5+3v6](evidence/city-scale-2026-10-22/task-focus-v6-summary.json).
После расширения цели закрыто 29/33
критериев: U08 проверен, U09 визуально принят после отдельного кадра видимого
world glyph; остаются E01/E02/Q02/Q03.
R02 закрыт после исправления владельцев retry
и адресной native-проверки восстановления зависшего обновления. Сборка и
полная типизация кандидатов 22 октября — PASS;
нативные серии v1 11/11 и пересекающаяся v2 3/3 сохранены отдельно. Для длинной
мобильной панели исправлены высота/прокрутка. Native v3: 9 PASS / 1 FAIL;
iPhone остановился на обычном Tab; отдельный разбор подтвердил достижение Album
через Alt+Tab. V4 содержит только CSS-исправления desktop-легенды и короткой
landscape-панели; остальные 1262 входных файла и JavaScript совпадают с v3.
Native v4: **2 PASS / 1 FAIL** — desktop и Pixel portrait/landscape прошли;
iPhone прошёл bounds/Alt+Tab/scroll, но ratio полной видимости Album составил
0.9911221862 вместо 1. Диагностика локализовала обрезку 0,390625px и подтвердила
ratio 1/открытие альбома после настоящего PageDown. Полный исправленный
iPhone-сценарий завершён отдельно: **1 PASS / 0 FAIL, 7,3 секунды**, включая
portrait/landscape, строгий ratio 1 и два настоящих альбома. Runtime v4
не изменён; прежний FAIL сохранён. Desktop/Pixel PASS переиспользуются
отдельно, это не новая единая серия из трёх сценариев и не 12 уникальных
проверок. Независимый просмотр пяти desktop/Pixel и двух новых iPhone PNG
не выявил дополнительных визуальных замечаний. Business-state hash и fences
исправленного запуска сохранены, браузеры и сервер закрыты.
В v3 вошли три проверенные по исходникам оптимизации: геометрия границы района,
резидентный индекс terrain и требования к ресурсам.
Историческая незавершённая серия v4 завершила 12 замеров на 200 задачах и три Chromium1000.
Firefox1000 sample 0 остановился на `mobilityReady:null` через 90 секунд
после atomic/ground queue 0; Pixel1000 и iPhone1000 не начинались.
Сохранены три cold-превышения: Chromium200 — 1758,58 > 1500 мс;
Pixel200 — 6088,669 и 6025,17 > 6000 мс. Во всех 15 завершённых замерах
геометрия, HTTP и canvas сохранены; зарегистрированных ошибок нет, но
`errors[]` не охватывает сообщения console об обработанных ошибках. Отказ Firefox1000
сохраняется отдельно; полная серия не пройдена. Сторонняя нагрузка хоста
не доказана как причина превышений, отказы не снимаются.
[Фактическая сводка v4](evidence/city-scale-2026-10-22/task-focus-v4-summary.json).
Единственная диагностика Firefox1000 завершена: функциональный PASS одного
sample, canonical 1000/72 и движение готовы; исходный timeout не воспроизведён
и остаётся неразрешённым. Cold 3911,511625 > 3000 мс под инструментацией
и наблюдавшейся нагрузкой — RED, не новая квалификация и не 16/24.
Console: 0 ошибок/6 предупреждений, включая context-lost до ambient;
причинного вывода нет. [Диагностическая сводка](evidence/city-scale-2026-10-22/task-focus-v4-ff1000-diagnostic.json).
V5 исправляет отдельный подтверждённый дефект стирания ошибки после pan:
native RED(v4)→GREEN(v5), ровно 1 PASS/4489 мс, test SHA `69364b1f…`.
Это не заявленное исправление причины исходного 90-секундного зависания.
Его отдельный resource probe: **4/4 PASS**, p95 20 настоящих переключений
на случай — 20,5/36 мс (200 Chromium/iPhone), 25,7/38 мс (1000), бюджет 100 мс.
Canonical/геометрия/canvas сохранены, scene/chunk HTTP 0, atlas 2904 bytes
и Sprite/Texture/source переиспользуются; owned cleanup/freeze fence PASS,
5367 свободен. [Фактическая сводка v5](evidence/city-scale-2026-10-22/task-focus-v5-resource-summary.json).
Просмотрены 12 PNG без новых замечаний; resident world badge bounds в этих
кадрах вне viewport. Отдельный corrected iPhone1000 visible-glyph сценарий
завершился PASS: 4 native mouse-pointer pan при прежнем 24/45s пределе,
строгие visibility/ownedbuilding/alpha1→0,16→1/scale0,8→0,95777/geo/canvas
assertions прошли. Первый неуспешный harness-precondition запуск сохранён,
дефект приложения по нему не заявлен. Все пять новых PNG просмотрены основным
агентом: world glyph принят без открытых замечаний, U09 закрыт.
[Отдельная видимость world glyph](evidence/city-scale-2026-10-22/task-focus-v5-visible-world-badge-summary.json).
Platform-alpha здесь unit-only; DOM scroll не выдаётся за trusted touch scroll,
page/HTTP errors 0 не означает полного console-аудита. Полная нагрузочная
серия v5 завершила 24/24 без функциональных отказов и нарушений геометрии,
HTTP/canvas, но остаётся STRICT_RED из-за одного 61-мс steady longtask
Pixel1000 при прежнем бюджете 0 longtasks. Отдельный trace-разбор не
атрибутировал исходный 61-мс longtask; новая приёмка v6 выше ещё ожидается.
Resource/visual PASS не заменяет performance-приёмку.
[Полная сводка v5](evidence/city-scale-2026-10-22/task-focus-v5-summary.json).
Нагрузочная серия `v2`
завершена: 24/24 замера, три cold-превышения, функциональных ошибок нет;
строгая performance-приёмка не пройдена. [Все результаты и ограничения](evidence/city-scale-2026-10-22/task-focus-summary.json).
[Фильтры, значки работ и границы новых проверок](QA-TASK-FOCUS-2026-10-22.md).
CI исторической ревизии `c9eeee27` завершился с отказами; его успешные отдельные
jobs не означают прохождения всего CI или проверки текущего source-среза.

**Историческая локальная квалификация runtime `03fc2d72`.** Он завершил
полную серию `final-v4`: 36/36 запусков без функциональных
ошибок и нарушений геометрии, запросов или идентичности canvas. В 11/12
профилях прошли исходные ограничения; три cold-превышения Firefox200 сохранены
в историческом отчёте. Причинный замер воспроизвёл задержку обнаружения готового
DOM автоопросом Playwright. Исправленная версионированная методика сохраняет
прежнее начало и бюджет, учитывает консервативную границу часов и отдельно
хранит Node-счётчик. Парные 3 baseline + 3 candidate Firefox200 прошли все
ограничения. Новая медиана 1306,8 мс против 1217,9 мс (+7,3%); диапазоны
перекрываются, ускорение этого профиля не заявляется.

Принята комбинация 11 прежних консервативных upper bounds и отдельной пары v2;
это не новая матрица 36 v2. [Методика, результаты и ограничения](QA-CITY-SCALE-2026-10-16.md).
Исторические RED v2/v3/v4 сохранены. На этом этапе было закрыто 27/31 критериев. Итоговый SCM SHA,
обязательный CI, managed merge, свежий backup, опубликованный smoke и
наблюдение 300 секунд ещё не выполнены; они фиксируются в итоговой записи задачи.

## Связь критериев с доказательствами

Сохранён отдельный [offline console-review v5 с ограниченной атрибуцией feature probe](evidence/city-scale-2026-10-22/task-focus-v5-console-review.json).

| Критерии | Проверенная граница | Доказательство и ограничения |
| --- | --- | --- |
| R01 | Последовательное восстановление событий; отказ второй страницы до commit live-буфера | `realtime-replay.test.ts`, `realtime-replay-recovery.spec.ts`; browser с настоящим Socket.IO и контролируемым HTTP503 |
| R02, P02–P04, P06 | Bounded refresh, content signatures, целый canonical snapshot, viewport/halo, camera fence, depth/metrics | Renderer pure/native regression и frozen200/1000; актуальные FIRSTatomic/phone5s — 6/6 в трёх движках, полная v4 и отдельная пара v2; предыдущие owner/fault проверки переиспользуются при неизменённых inputs |
| R03–R06, E03 | Lease/recovery/fairness, Socket session, Redis deadlines, lifetime task counter | [Backend QA](QA-BACKEND-RELIABILITY-2026-10-16.md): 181 уникальный тест в 27 файлах, три прогона с переиспользованием неизменённых результатов |
| P01 | Адресная инвалидация городов/стран и смежных transport ends | `city-scene-invalidation.test.ts`, `map-invalidation.test.ts` и интеграция scene cache; география не перегенерируется |
| P05, U04 | Compact MCP, bounded owned caches, Card, lazy collections50, документы, реальные зависимости/разрешённая хроника | Backend HTTP/SDK; `task-card-paging.spec.ts`: 1000 comments fixture, 503/retry и WS rename/delete соседней dependency; новые контракты не заменяют прежний full DTO |
| P07, U07 | Progressive auth art, password toggle, связанные ошибки/фокус/retry | [Auth QA](QA-AUTH-RELIABILITY-2026-10-16.md): 49 браузерных проверок и 15 pure; физические устройства не использовались |
| U01 | A→B→Back/Forward, CITY pose, direct links, cancellation, auth/scope fences | [Navigation QA](QA-NAVIGATION-SCOPE-2026-10-16.md) и финальная общая матрица ниже |
| U02 | Явное прочтение, paging, grouping, возврат и новые события во время ACK | [News QA](QA-NEWS-FEED-2026-10-16.md): 30 успешных сочетаний сценарий/профиль с указанным переиспользованием; footer320 RED→GREEN5 |
| U03, U05 | Каталог50, paging/filters/context, keyboard map, доступ без canvas-click | [Catalog QA](QA-TASK-CATALOG-2026-10-16.md) и [World observation QA](QA-WORLD-OBSERVATION-2026-10-16.md) |
| U06 | Opt-in audio, trusted gesture, voice cap и немедленное mute/cleanup | `city-audio.test.ts`; общий bell использует тот же владелец звука |
| G01–G03, G05 | Конкретные AIR/RAIL/SEA, добровольный follow/tour, реальные дорожные сцены и распорядок | [World observation QA](QA-WORLD-OBSERVATION-2026-10-16.md); жизнь/качество включены и в performance-измерениях |
| G04 | Ограниченные реальные вехи, comparison, deleted-task state, paging/error/focus | `city-album-presentation.test.ts`, `city-album.spec.ts`, [дизайн навигации](DESIGN-WORLD-NAVIGATION-2026-10-16.md) |
| E01 | Разделённые владельцы state/cleanup и изолированные CI границы | Type/lint и focused/native результаты; новый `.github/workflows/ci.yml` ещё должен пройти на итоговой ревизии |
| E02 | Private operator diagnostics, bounded query metrics, normal shutdown, публичный asset gate | [Runtime observability](RUNTIME-OBSERVABILITY-2026-10-16.md); настоящие local children4roles и public-gate6pure; реальный новый public release ещё не выполнен |
| Q01 | Те же точные200/1000, geometry hashes, NORMAL/life=true,3samples/profile | [Scale QA](QA-CITY-SCALE-2026-10-16.md): полная v4 сохраняет 36 functional PASS и historical RED3; 11 legacy conservative PASS плюс отдельная сопоставимая пара Firefox200 v2 закрывают бюджеты |
| Q02 | Native browser functional/visual матрица и emulated phones | Результаты ниже; полная обязательная SCM матрица ожидает итогового кандидата |
| Q03 | Exact SHA, SCM/Builder, fresh backup и публичная работоспособность | Ожидается после обязательного CI; ранний read-only recovery preflight не является выпуском |

## Общий production UI-кандидат

На `final-candidate-v1` выполнено **70/70 PASS**, 2,9 минуты: 14 сценариев
в Chromium, Firefox, WebKit, Pixel Chromium и iPhone WebKit. Это Album2,
navigation scope2, session2, Card2 и history6. Проверены реальные logout/login,
прямой возврат в карточку, delayed lazy/card/scene responses, cancel и два
повторных Back/Forward. Для pagination/error races используются изолированные
HTTP ответы; аутентификация, навигация и Socket.IO остаются настоящими.
Native PNG старого/нового состояния и320px comparison просмотрены, Axe/focus
прошли в проверенных панелях. Результат не означает Axe-аудит всех страниц.

На том же production bundle дополнительно **15/15 PASS**, 57,4 секунды:
AIR/RAIL/SEA, ROAD и keyboard/tour в Firefox, WebKit и iPhone WebKit.
Отдельные прежние Chromium/Pixel проверки перечислены в профильном отчёте.
Это не ещё одна полная пятибраузерная G-матрица.

Отдельная сверка плана добавила три проверки размеров и квитанций P05:
HTTP Card 3063/3065/3066 байт при 0/100/1000 существующих комментариях,
compact command 1018 байт и receipt 149 байт во всех трёх точках.
Весь затронутый контрактный файл прошёл 14/14; повторены только три точки
для записи чисел. [Точные границы измерения](evidence/task-read-sizing-2026-10-16/summary.json).

Хроника задачи U04 проверена отдельным браузерным сценарием: **2/2 PASS**
в Chromium и iPhone WebKit. Настоящие Card и events page сохраняют IDs,
количество и cursor; первая запись контролируется для разрешённых и
запрещённых изменений. Проверены четыре before→after строки, настоящее имя
аккаунта, отсутствие UUID/Markdown/internal полей, один lazy GET limit50 и
переносы на телефоне. Это хроника данных задачи; прежние history6 выше
проверяют историю навигации. [Сводка U04](evidence/task-history-2026-10-16/summary.json).

`final-v1` и `final-v2` имеют одинаковые compiled server/client bytes:
server `dae136ca64c93bbc7d0dfac2a675c38ed5edc800d895a5a78af7f4ed48c61937`,
client aggregate `ef5749e52e0aeb57af0b157f7af2f10ea06d622b4fb27a4fb6f37547e6cd02ae`.
Единственное source-различие frozen snapshots — число50 в `public/ai.md`.
Последующая нормализация одного EOF и адаптация legacy E2E не выдаются за
байтовое равенство всего editable source. Последующие кандидаты имеют отдельные
compiled hashes и затронутую квалификацию, перечисленную ниже.

После `final-v2` подготовка полного WALK/дорожного графа и распорядка разбита
на отменяемые короткие задачи. Независимое сравнение с `053e061d` на тех же
точных городах200/1000 сохранило дороги, порядок, маршруты, сигналы, остановки,
жителей и seeded motion. В первом кадре готов весь канонический снимок,
видимая земля, внешний фон, дороги и полный набор видимых/halo объектов.
Невидимая земля halo подготавливается после публикации через ту же ограниченную
очередь. Текстуры земли получают первые сетевые слоты перед декорацией.

Native-квалификация развивается по фиксированным кандидатам; эти числа не
складываются в один новый прогон:

| Кандидат | Результат | Проверенная граница |
| --- | --- | --- |
| `651a6e07` | 9/9 PASS | Исходный срок готовности телефона, отмена/возврат, настоящий defect update во время подготовки |
| `831102cf` | 18/18 PASS | Предыдущие сценарии и настоящие worker-ответы: overlap, поздняя работа после отказа, общий pending decode при retry500мс |
| `353bf444` | 21/21 PASS, 2,5мин | По семь сценариев в Chromium/Firefox/iPhone WebKit; дополнительно первый atomic кадр, независимая непрерывная геометрия viewport, полный canonical/entity набор, завершение halo и pan без HTTP |
| `934cac5a` | 6/6 PASS, 33,4с | После единственного переноса prefetch повторены первый кадр и прежний пятисекундный срок готовности/движения, те же три браузера |
| `03fc2d72` | 6/6 PASS, 30,3с | После исправления idle Graphics и статической дорожной подготовки повторены FIRSTatomic/full sources/pan и прежний phone5s в тех же трёх браузерах |

Оба worker-отказа сначала воспроизведены RED, затем закрыты GREEN без изменения
задержки retry. Дробные правый/нижний края CITY и внешнего фона имеют настоящие
RED/GREEN регрессии; **47/47** проверок в четырёх pure-файлах прошли. Ошибка
painter order также закрыта через публичные `zIndex` setters: **5/5** проверок
на настоящем Pixi `Container`/render group, включая добавление, удаление и
следующее пересечение. Статический кадр не инвалидирует структуру.

Снимки трёх движков просмотрены: пустых тайлов и швов в проверенных кадрах нет,
пиксельный стиль сохранён. Проверка исходных performance-бюджетов выполняется
отдельно и не выводится из native PASS. Все промежуточные RED, точные hashes и
[границы сравнительного доказательства](evidence/city-scale-2026-10-16/cooperative-preparation-summary.json)
сохранены.

`final-v3` сравнивает ровно те же200/1000 с базой053e: медиана открытия1000
в Chromium2336→1612мс, Pixel15189→8090мс. Отслеживаемый RGBA estimate1000
сократился примерно на47% на desktop и82% на телефонах. Это не измерение VRAM.
Улучшение медиан не отменяет четыре отказа; [полная парная сводка](evidence/city-scale-2026-10-16/final-v3-summary.json)
хранит каждый исходный sample и все неизменённые budgets. Ненулевые exitcodes
driver/compare сохранены, этот кандидат не объявлен готовым к выпуску.

В `03fc2d72` пустой Pixi Graphics больше не посылает обновление каждый idle
кадр; активный эффект по-прежнему очищается при завершении. Статическая
геометрия дорожных событий строится вместе с сетью, а текущие перекрытия,
занятость и доступность служб проверяются при событии. Адресные наборы прошли
31 и 39 проверок соответственно; они не складываются с повторными прогонами.
Расширенное сравнение на точных 200/1000 подтвердило целый core и восемь
упорядоченных дорожных состояний для каждого города относительно CBD и053e.
Все 129 inputs до/после совпали. [Доказательства и hashes](evidence/city-scale-2026-10-16/cooperative-preparation-summary.json).

Полная v4 и последующая парная квалификация measurement-v2 описаны в начале
отчёта. [Сводка v2](evidence/city-scale-2026-10-16/cold-measurement-v2-summary.json)
сохраняет все шесть наблюдений, обе метрики времени, версии контрактов и
ограничения переиспользования 11 прежних консервативных результатов.

## Данные, безопасность и границы

Управление работой остаётся в MCP с явным countryId. В UI нет создания,
назначения, редактирования или переключения рабочих стадий. Настройки,
авторизация, ссылки и явное прочтение уведомлений сохраняют свои controls.

Реальный SDK/HTTP контрактный набор вызывает все50 MCP tools; отдельный
собранный runtime smoke проверяет initialize/auth/capabilities/resources,
scope/revocation и error handlers. Эти разные доказательства не объединяются
в утверждение, что compiled smoke сам выполнил50 успешных CRUD.

Миграции0043/0044 additive. Свежий локальный restore существующего backup
от13октября и совместимость старого runtime проверены без удалённых изменений;
46 прежних таблиц/последовательности сохранены, world audit нарушений0.
Официальный updater всё равно должен создать новый pre-deploy backup.
После записей нового runtime image rollback сохраняет текущую БД, а не
откатывает новые пользовательские данные к старому dump.

Dependency audit: high/critical0, moderate6; зависимости не добавлены.
Браузерная эмуляция не доказывает работу конкретного физического телефона,
батарею или все GPU. Input second-RAF proxy не называется INP, RGBA estimate
не называется VRAM, три cold samples дают median/range, а не loading p95.
Личные URI, токены и сырые производственные данные остаются в ignored0600
артефактах и не включены в репозиторий.
