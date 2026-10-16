# Общая квалификация 1.25.0

Область: [31 критерий общей цели](PLAN-WORLD-RELIABILITY-EVOLUTION-2026-10-16.md),
задача [№53](https://tasktopia.online/task/53?countryId=4201d605-751a-469b-8d5f-a7e322a7ece1&taskId=4f2ef16c-8172-4715-8e2e-27f88979df78).
База — `053e061d84dbcafdeaf1841010f9bd2286c9c5f8`, цель выпуска —
`game3/dev-server/dev/all` через Builder и официальный updater.

**Статус: локальная квалификация завершена, CI и выпуск ожидаются.** Runtime
`03fc2d72` завершил полную серию `final-v4`: 36/36 запусков без функциональных
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
Исторические RED v2/v3/v4 сохранены. Закрыто 27/31 критериев. Итоговый SCM SHA,
обязательный CI, managed merge, свежий backup, опубликованный smoke и
наблюдение 300 секунд ещё не выполнены; они фиксируются в итоговой записи задачи.

## Связь критериев с доказательствами

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
