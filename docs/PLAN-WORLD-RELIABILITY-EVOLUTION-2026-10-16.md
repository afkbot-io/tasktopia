# Надёжность, скорость, удобство и развитие мира

Продолжение задачи №53 по прямому запросу пользователя от 16 октября 2026 года: реализовать все предложения ревью, в порядке надёжность/оптимизация → удобство → новые механики, проверить города с 200 и 1000 задачами и выпустить на `tasktopia.online`.

База: `053e061d84dbcafdeaf1841010f9bd2286c9c5f8`, версия 1.24.14. Рабочая ветка `codex/world-reliability-evolution`. Цель выпуска: `game3/dev-server/dev/all`, точный проверенный merged SHA через Builder и `docs/DEPLOYMENT.md`. Предыдущие проверки относятся к прежней ревизии; новые результаты привязываются к текущим входам.

## 23 октября 2026 — v16: камера, quality и новая квалификация PASS; CI/выпуск ожидаются

V16 source `04f4ed0c9befff008bdf4ae5b5b56dbc86cf94dc8f1933dfc7a0cdfc36988cc7`, QA578 `258a2366a20e74bca07acefb6b8a805fbc57ac6286d56dde98391bae696e4931`. Против V15 изменены только WorldCanvas и city-cinematic-view: same-range reuse продолжает публикацию pending камеры; смена качества сохраняет принятый timeline/target-readiness, сразу уничтожая лишних рабочих и освобождая их пути до3/shot. Version/history/hard deadlines и штатные hidden/map exit/resync отмены сохранены; незагруженный target не подтверждает открытие.

Контролируемые public camera2/quality1 RED на V15 → новые native8 GREEN. Unit crew RED4PASS/1FAIL → affected48PASS/7files; camera80PASS/8files — непересекающиеся наборы. QA также исправляет устаревший async pad oracle и добавляет первый panFocus без quality lock. TOW/WATER разделены на два target-case: КАЖДЫЙ180s/9attempt/31×1s/arrival/cargo/closure/safety; до31 уже прочитанного frame сохраняются вfinally без extra RPC. Это изоляция прежнего общего180s, не утверждение о неизменном совокупном test wall budget или ускорении clock.

Одна build/full TSC/freeze PASS (`c0914411…`), server/assets byte-equal V15; новые client48be214c/HTML90e1ccea/manifestd9decfae. Readonly200/1000 (`82c49e9b…`) сохранил geometry/status/dumps без seed/restore. Native8 **8/8PASS/128,268977с**,0retry/SKIP/flaky (`eb68b1e3…`,postflight `780e73c2…`): camera2/lifecycle/quality/owner2, workers5→3→0/shots1→1→0 и OPEN_SCHOOL без replay; оба TOW-case31frames/safety0/arrival/trips1, BREAKDOWN cargo=true. Visible/target padding0 не требует пустой offscreen очереди9/terrain6/tree3. Intentional movement-timeout console error1 EXPECTED отделён от pageerror0 в исходных проверках. Fresh own822/920canonical,5343FREE/ownedserver+CLIclosed/DB0/business31fa40 прежний. Root native visual NO_OPEN только в2кадрах (`5b49731e…`).

Новая original full24 V16 — **24/24STRICT PASS**,8reports=24raw, все24 функционально завершены, error/violation/retry/exclusion0;4профиля×200/1000×3/NORMAL/CPU-network-DPR/churn20/steady8s и исходные performance budgets сохранены. Cold max200/1000(ms):Chrome1061,364/1955,707;Firefox1271,882/1856,733;PixelCPU4+network5421,036/8307,072;iPhone818,352/1148,148. Max warm99,146125ms/input p95 45,1ms/RAF p95 19ms/Chromium heap+1393032B. HTTP24cold/0pan/warm/legacy; console0errors/54warnings/trunc0. LongTasks/heap12available/12unavailable=null; все12 измеренных steadyLT0. Host gate5PASS, during294intervals weighted idle87,665%/min73,538% — только context, без исключений samples.5311FREE/ownedDBother0/readOnly/source920+822 fences прежние. Root2portrait1000 PNG NO_OPEN (`76ff1631…`), resized/emulation, не все состояния и не физические телефоны.

[Новая performance summary](evidence/city-scale-2026-10-23/task-focus-reliability-v16-summary.json), SHA `7c9f34836d0f50b041ad0279f759e9d7aeb625f2c11176fb1f11c5c251cc0252`; [новая qualification summary](evidence/city-scale-2026-10-23/task-focus-final-qualification-v16-summary.json). V15 JSON `03501bec…`/`7138c43f…` и все прежние FAIL/UNKNOWN сохранены, не переименованы. CI56 завершён FAILURE6SUCCESS/4FAILURE/10jobs (`c1bde5c0…`):unit2027PASS/1FAIL, browser414PASS/4FAIL/163SKIP/106NOTRUN. Новый HEAD/tree/exact CI/merge/Builder/public smoke/300с **PENDING**;29/33 приняты до окончательных CI/release, E01/E02/Q02/Q03 открыты. Полные33 критерия/U08/U09, MCP/security/recovery и прежние QA-контракты остаются в области; новых release gates нет.

## Историческая точка 23 октября 2026 — v15: compiler clearance, native2 и full24 PASS до V16

V15 source `9f8d417815a6e8adc786694e13e3c737eb49f82e367fc411ecda6f6b342091ee`, QA578 `9eef2d18bc767f1ca9ac56b7258157b5df612f5b6581b360cd7b2cbd0a973bee`. Из 1263 runtime inputs против V14 изменена одна строка city-everyday-life.ts: подходы зрителей исключают все восемь соседей animal pad, включая диагонали. Поворот walker с inset0,25/0,25 больше не допускается внутрь clearance0,8/0,8. Server/assets byte-equal V14; client/HTML новые. QA:5 изменённых файлов+2clock helper/spec. Причина исторического CI BIRDS остаётся UNKNOWN.

Публичный compiler TDD: RED10PASS/2FAIL из 12→первый GREEN11/12(старый perf pad0,1 теперь небезопасен)→final12/12PASS. Исправлена только fixture y+2/expected0,2; kinds3/lookup≤49/ground≤2N прежние. Affected73/8filesPASS и scoped ESLint PASS; пересекающиеся наборы не складываются в 85 уникальных тестов. Одна стандартная build/full TSC/freeze PASS(`bc434bbd…`); readonly200/1000(`18562d3a…`) сохранил geometry/status/descriptor/dumps без seed/restore/regeneration.

Новые исходные native WebKitDPR2 — **2/2PASS/342,922861 с**,0retry/SKIP/flaky(`988333c6…`): все шесть бытовых сцен с реальными arrivals, BIRDS animals3/scattered и DOG animals1/fetched, unavailableSlots0; сохранённые safety counters0. Construction1→2→3→4→5/WORK, TRANSFER:CARRY, DEMOLISH:COVER/ruins/audio прошли. Animal/phase/occupied-slot assertions и исходные deadlines не ослаблены. Root BIRDS PNG NO_OPEN только в просмотренном состоянии. Собственная новая V15 publication822 `f8a84f80…`/920canonical,5343FREE/server+CLIclosed/DB0/business31fa40 unchanged; старая V14 attestation не переносилась.

Новая V15 full24 — **24/24STRICT PASS**,8reports=24raw/errors0/violations0/retry0/exclusion0; root19775exit0. Исходные 4 профиля×200/1000×3/NORMAL/CPU/network/DPR/churn20/steady8s/strictbudgets сохранены. Cold1000max(ms):Chrome1962,219/Firefox1845,403/Pixel(CPU×4)8265,484/iPhone1147,981. Global max warm95,923ms/input p95 43,4ms/RAF p95 19ms/Chromium heap growth1281556B. Это три samples, не loadingp95. Console0errors/54warnings/trunc0; HTTP24cold/0pan/warm/legacy. LongTasks12Chromium steady0;12FF/WK unavailable=null, heap толькоChromium/RGBA неVRAM. Host gate5PASS; during load не отбрасывает samples.5311FREE/ownedDBother0/source920+822 fences unchanged.

Прежние clock/ground native15 и шесть reveal/transfer Chrome из native16 остаются отдельными reuse на неизменных границах; это не новые V15 прогоны и не byte-equal claim всего everyday spec. Full24 V14 `74efab04…` сохранена без изменений и не переименована в V15. QA-calibration history сохранена: visible critical readiness вместо полного background drain; safe passenger recovery после resume; public fixed-date/pause/system-time; phase JSON вfinally/snapshotsfalse. Ранее смешанный async planning limit50→20000ms — QA wall-контракт по owner deadline, не CPU-оптимизация; road50ms/CPU8ms/heap8MiB/workload прежние.

[Новая performance summary](evidence/city-scale-2026-10-23/task-focus-reliability-v15-summary.json), SHA `03501becf6cb3a7f5fcd824a03f2f1f3720af8e2381c0e94d9beafd6b04728e3`; [общая qualification summary](evidence/city-scale-2026-10-23/task-focus-final-qualification-summary.json), SHA `7138c43f1fe1e9d648e2dd3033cd400ecb8ec669cc2b9b2f9d3320dcd726e65a`. Все 33 критерия/U08/U09 и исторические RED/UNKNOWN сохранены. CI717/39896216677 завершён FAILURE6SUCCESS/4FAILURE/0CANCELLED; локальные PASS его не заменяют. Будущие HEAD/tree/exact CI, merge/Builder/public smoke/300 с **PENDING**, E01/E02/Q02/Q03 открыты. Только браузерная эмуляция; физических телефонов нет. Новых release gates не назначено.

## Историческая точка 23 октября 2026 — v14 native12/full24 PASS до исправлений QA

Source `51f67980cec9fe77c7f9cb617909c3a12a1b92f0065cfb6b6b292938ac33e247`: только4static render-group flags против v13, остальные1262runtime/576QA совпадают. Server/география/assets прежние. Одна сборка/full TSC/freeze (`bc0ebc39…`) и readonly200/1000 (`9de56c39…`) PASS; geometry/status/descriptor/dumps сохранены без seed/restore/regeneration.

Native12 — **12/12PASS/82,414293s**,0retry/SKIP/flaky, JSON↔journal12 exact (`ae209b6f…`). Root4actual PNG NO_OPEN: Pixel320/iPhone empty-mask, WK full-detail DAY, Chrome atlas maximum (`7a50ad79…`); resized WK не даёт exact pixel claim, физических телефонов нет. Собственная attestation822 `2cf06e36…`/920canonical и native cleanup5343FREE/DB0/business31fa unchanged сохранены.

Исходная full24 — **24/24STRICT PASS**,8reports/raw equality/functional24/errors0/violations0/retries0/exclusions0, launcher47586exit0. Четыре профиля×200/1000×3/NORMAL/churn20/steady8000/coldv2/CPU/network/budgets сохранены. Max warm79,781ms/input p95 45,2ms/RAF p95 19ms/Chromium heap growth1617468B. Cold max200/1000(ms): Chrome1077,524/1968,514; Firefox1292,307/1773,052; Pixel5412,436/8256,882; iPhone800,443/1141,136 — это не loading p95.

Console errors0/warnings54/trunc0; HTTP24cold/0pan/0warm/0legacy. LongTasks12Chromium steady0,12FF/WK unavailable=null; heap толькоChromium, RGBA estimate неVRAM. Postflight:5311FREE/owned2001000DBother0/readOnly/source/output fences unchanged/920+822. [Portable actual summary](evidence/city-scale-2026-10-23/task-focus-reliability-v14-summary.json), SHA `74efab046d379561c7e820cb1d82bed367ba4239d540fbde75d65bbf9f71e2ae`; private aggregate `106b6672…`. Исправлена только ссылка runnerV13→actualV14, raw/metrics не менялись.

V13 STRICT_RED23/1RAF33,34>20ms, V12 coldRED3813,698>3000ms и native137/formalnull/causeUNKNOWN сохранены. Диагностика `e162/f13d` RAFRED не воспроизвела; разные119→374→464builds/+3GL calls не дают общего speedup/causal claim. Новый exact-head all10CI, merge и managed release **PENDING**, E01/E02/Q02/Q03 открыты; все33 критерия/U08/U09 сохранены. Backup по runbook + применимость имеющегося restore-proof, без нового restore gate.

## Историческая контрольная точка v13, 23 октября 2026 — STRICT_RED

Source `7b08afcbcc186eb839a2823d75985497ed2fea8cbaf82a196eaae7eedcc5e8c3`:
только cooperative scheduler изменён против v12, остальные1262 runtime inputs
совпадают. После семи native продолжений восьмая граница отдаётся обычной
owned MessageChannel/timer задаче. Slice4ms/checkpoint8192/owner20s сохранены;
это bounded policy, не установленная причина прежнего cold RED.
TDD и адресные68PASS/6files, одна сборка/full TypeScript/freeze и readonly200/1000 — PASS.

Первая native22 оборвалась exit137:13cases started/9notstarted,
formalPASS/FAIL=null, причина UNKNOWN. Собственная оставшаяся fixture отдельно
очищена исходным country→user cleanup в одной guarded transaction; QA40
business31fa восстановлен без seed/restore/reset. История не переписана.
Отдельная явно разрешённая R2 завершила **22/22PASS за454,832221s**;
штатный JSON и durable journal22 точно совпали, retry/SKIP/flaky0.
Полные sixscene —312,849s с native WebKitDPR2 и прежним720s deadline;
task-entry/контролируемый paused RAF, recovery/quality/atlas/real-clock cases прошли.
Root просмотрел четыре реальных PNG без открытых замечаний в этих кадрах.
Новый dense200 native/fallback — **4/4PASS за13,748069s**;
geometry/business/frozen920+822 и owned5343/5367/DB cleanup сохранены.

**Full24 v13 — STRICT_RED:23 budget PASS/1 RAF RED, все24 функционально завершены.**
Launcher91512 завершился exit1, выполнены все8 групп, без retries/исключений.
Host gate прошёл. Firefox1000 report:
sample0 RAFp95=33,34ms>20ms; два других RAF16,78/16,80ms и все три cold
1962,993/1834,709/1745,415ms<3000ms прошли. Errors0, причина RAF UNKNOWN.
Все raw совпали с8 report.results; source/frozen fences сохранены.
Aggregate `.builder/world-perf-20261022/task-focus-reliability-v13-summary.json`,
SHA256 `afd4944bd17799bc6da7e99cf56741869ea70479264f92c0b1e2bc373e01c50e`.
На этой исторической точке следующая ограниченная диагностика ещё не запускалась; её последующий actual итог приведён в актуальном разделе v14 выше.
Исторический v12 STRICT_RED3813,698ms>3000ms и исходный137 остаются фактами.
Новый exact-head CI, merge и managed release не выполнены и заблокированы
до ограниченного разбора/устранения RAF RED; E01/E02/Q02/Q03 открыты,
все33 критерия, включая U08/U09, остаются общей областью задачи.
[Подробные актуальные receipts и ограничения](QA-WORLD-EVOLUTION-2026-10-16.md).

## Инварианты

- PostgreSQL хранит работу и географию; UI читает и навигирует, рабочие изменения выполняются MCP с явным countryId и проверенной личностью.
- Курсор событий продвигается только после полного восстановления или авторитетного снимка. ID событий разных стран не обязаны быть соседними.
- Данные города остаются целым каноническим снимком. Сокращение GPU-резидентности не возвращает сетевые запросы при каждом pan, не меняет дороги/входы и не теряет объекты.
- Существующие MCP/HTTP клиенты, idempotency retries, публичные ссылки, права доступа и сохранённые миры совместимы. Новые проекции и коллекции версионируются либо остаются опциональными.
- Игровые происшествия не создают реальные дефекты/валюту/выдуманные рабочие статусы. Новые виды используют существующие расписания, часы и ограниченный набор жителей.
- Пользователь выбрал только браузерную эмуляцию Android/iPhone. Физические устройства не засчитываются как проверенные.
- Основной checkout с несвязанными изменениями, прежние preview-каталоги, чужие Docker volumes/контейнеры/порты сохраняются.

## Общая карта приёмки

| ID | Наблюдаемый результат | Доказательство |
| --- | --- | --- |
| R01 | Ошибка страницы replay не пропускает историю и не продвигает неподтверждённый курсор; буфер и время ограничены | unit + browser: отказ второй страницы, живое событие, reconnect/resync |
| R02 | Зависший запрос обновления города завершается таймаутом, отменяется при уходе, допускает настоящий retry, сохраняет старый кадр | unit + browser hung HTTP/503/unmount |
| R03 | Падение на последней попытке генерации имеет определённый исход, уже закоммиченная команда не дублируется | PostgreSQL lease/heartbeat/idempotency integration |
| R04 | Фоновые DB/Socket ошибки обработаны; циклы не перекрываются, поздний ответ после закрытия безопасен | rejection/backoff/close/auth unit + integration |
| R05 | Отказ/зависание optional Redis не задерживает готовый PostgreSQL ответ; release/close/wait имеют deadline | controlled hung get/set/eval/close tests |
| R06 | Ожидающие команды делят ожидание; очередь не создаёт лишний частый SQL и не допускает starvation стран | SQL counters/concurrent wait/fairness integration |
| P01 | Комментарий и локальная задача сохраняют кеш незатронутых городов/стран; общая топология обновляет нужные концы | cache A/B/foreign country/road/transport tests |
| P02 | Одинаковое render content продвигает версии без повторного decode/bake; изменённые слои обновляются адресно | content/hash/fence tests + render counters |
| P03 | GPU/views держатся в viewport+halo, данные целого города/камера/hit-testing сохраняются, pan не читает HTTP | 200/1000 benchmark/resource census + navigation browser |
| P04 | Неизменная физическая сеть не запускает walk/parking/everyday preparation; значимая стадия/вход запускает | signature/regression + CPU/network counters |
| P05 | MCP может получать компактный результат, карточка читает большие коллекции страницами; idempotency/старые клиенты сохранены | real SDK/HTTP contracts + 0/100/1000 comments bytes/receipts |
| P06 | Запись frame-метрик постоянной стоимости, подробная телеметрия и проверки глубины не перегружают обычный кадр | metric tests + profiles/z-order regression |
| P07 | Декорация авторизации появляется постепенно и имеет предел ожидания отдельных PNG | hung/failed image/reduced/cleanup browser |
| U01 | Back/Forward возвращают задачу/город и камеру; прямые ссылки и отмена перехода сохраняются | browser A→B→Back→город/entry/cross-city |
| U02 | Комментарии/материалы/приёмка видны после возвращения; серии группируются, чтение явное | news authorization/pagination/unread + browser |
| U03 | Более десяти результатов доступны; поиск/список/комбинированные фильтры работают в большом городе | search paging/filters/context/focus browser |
| U04 | Зависимости открываются напрямую; хроника показывает разрешённые прежние/новые значения | access/resolver/history browser |
| U05 | Все районы/задачи доступны без canvas-click; карта управляется клавиатурой, есть список объектов | keyboard/Axe/phone browser |
| U06 | Выключенный звук исключает все игровые голоса, включение требует жеста, выключение гасит активные | audio preference/trusted gesture/voice cap tests |
| U07 | Пароль можно показать; ошибки связаны с полем/фокусом, отказ auth config повторяем без потери ввода | auth registration/recovery/invitation browser |
| G01 | Инспектор конкретного рейса показывает реальное состояние/посадку; follow явно включается и прекращается при ручном движении | clock/identity/access + AIR/RAIL/SEA browser |
| G02 | Инспектор дорожной сцены объясняет участок, службу и фазу; постоянные плашки не возвращаются | event lifecycle/camera/closure browser |
| G03 | Ограниченные жители следуют согласованному пути дом→остановка→учреждение→дом/парк | deterministic schedule/mobility/safety/reduced tests |
| G04 | Альбом показывает реальные ограниченные вехи и сравнение развития, отдельно от загрузки карты | snapshot/pagination/access/cap + browser |
| G05 | Экскурсия предлагает существующее событие/рейс/объект и двигает камеру только по нажатию | existing identities/offscreen/navigation browser |
| E01 | Загрузка/обновление/рендер имеют владельцев состояния и очищаются при уходе; обязательные CI границы изолированы | lifecycle/type/lint/unit/isolated CI seeds |
| E02 | Внутренние метрики показывают очередь/relay/cache/DB waits; выпуск проверяет реальные публичные entry/assets | observability + release-smoke regression |
| E03 | Номер удалённой задачи не переиспользуется, конкурентное создание корректно | additive migration + country counter concurrency/history |
| Q01 | Фикстуры ровно200/1000 задач используют реальную геометрию; baseline/final измеряются одинаково | fixture hash/audit + cold/warm/input/long tasks/heap/GPU/HTTP/SQL reports |
| Q02 | Desktop Chromium/Firefox/WebKit и эмулированные Android/iPhone проходят изменённые сценарии/дизайн | scoped browser matrix/native screenshots/console/network |
| Q03 | Exact revision после review/SCM/Builder работает на сайте, fresh backup/restore applicability и rollback доказаны | managed updater + public/browser/MCP smoke +300sec observation |
| U08 | Фильтры сильно приглушают неподходящие постройки, совпадения сохраняют обычный вид; нулевой результат, загрузка, отказ и сброс различаются | pure state tests + native browser/phone +200/1000 resource counters |
| U09 | Незавершённые задачи реального активного района имеют пиксельные значки типа работы и стадии; завершённые/неактивные не получают ложных маркеров | real district/status/type fixtures + native visual/zoom/phone + renderer reuse |

## Продолжение22октября2026

Пользователь расширил общую цель до33 критериев: существующие фильтры заменяют жёлтые контуры сильным приглушением остальных построек; задачи активного спринта получают небольшие значки типа работы. Спринт соответствует реальному району со статусом `ACTIVE`. Линейка/молоток/проверка показывают стадии `TASK`, жук/срочный ремонт/открытие — существующие `BUG`/`HOTFIX`/`RELEASE`. Новые рабочие статусы и UI-команды не вводятся.

Маска применяется только к готовому результату фильтра. Выключенный фильтр, загрузка и ошибка оставляют обычную карту; готовый пустой результат приглушает все постройки и сообщает0 совпадений. Дороги и география сохраняются. Отрисовка меняется при фильтрации и обновлении видимых объектов, без повторного чтения сцены, перестройки сетей и обхода1000 задач на каждом кадре. Значки используют общие пиксельные шаблоны и только существующие видимые объекты.

CI ревизии `c9eeee27` завершился с отказами. Прошли зависимости, сборка/типизация/линтер, восстановление и MCP smoke. В unit1973/1975; два устаревших ожидания миграций исправлены с15/15 адресными проверками. Браузерные отказы разбираются по сохранённым trace, без повышения исходных бюджетов. В начале продолжения R02 был открыт повторно из-за подтверждённого конфликта владельцев retry; прежняя нагрузочная квалификация относится к зафиксированному runtime и не объявляется проверкой новой визуальной дельты.

На контрольной точке 23 октября R02 снова закрыт после адресной проверки восстановления и native RED(v4)→GREEN(v5): ошибка подготовки движения сохраняется при pan, настоящий retry восстанавливает движение. Это не объясняет исходный 90-секундный отказ Firefox1000. U08/U09 приняты, закрыто 29/33 критериев; остаются E01/E02/Q02/Q03. Историческая v5 сохраняет STRICT_RED/61 мс; отдельная v6 принята как 21 actual PASS v5 + 3 новых Pixel1000 v6, не 24 новых v6. После security-fix SDK/Vite кандидат v7 собран/типизирован, адресные MCP 33/5 PASS. Изменён compiled client, поэтому performance v6 не переиспользуется: новая исходная матрица v7 4 профиля × 200/1000 × 3 samples и новый exact-head CI на этой точке PENDING. Старый CI `39864375087` завершился FAIL на audit; skipped MCP/browser не считаются PASS. Это датированная точка до CI/scale; итоговые результаты и выпуск фиксируются в задаче №53 и PR58. [Security-preflight](evidence/city-scale-2026-10-22/task-focus-security-v7-preflight.json), [общие доказательства и ограничения](QA-WORLD-EVOLUTION-2026-10-16.md).

## Порядок

1. RED/GREEN надёжности R01–R05; параллельно заморозить baseline/фикстуры Q01. Изолированные БД каждого исполнителя.
2. R06/P01–P07/E03: адресные кеши/обновления, резидентность, сети, компактные контракты и коллекции. Повтор измерений на тех же фикстурах; не скрывать ухудшения.
3. U01–U07: маршруты, новости, поиск/фильтры/каталог, карточки, звук, auth. Рабочие CRUD-кнопки не добавляются.
4. G01–G05: реальные инспекторы, распорядок, альбом и экскурсия. Общие bounded clocks/actors/reduced-motion/quality сохраняются.
5. E01/E02 и итоговая квалификация: документация, типизация/линтер, unit/HTTP/MCP, затронутая браузерная матрица,200/1000 сравнение, AI/security/visual review.
6. Commit/PR → required SCM checks → managed merge → Builder exact SHA → runbook freshbackup/compatible migration → public/native smoke →300sec observability → полный QA/release пакет.

## Среда и восстановление

Docker VM оказалась заполненной. Для локальных проверок подготовлен отдельный PostgreSQL16 на macOS, loopback55436, собственные каталоги и БД; чужие volumes/контейнеры не удаляются. Секреты/URI находятся только в игнорируемых0600 файлах. Для benchmark зарезервирован свободный5311, другие тестовые процессы выбирают собственные свободные порты.

Для каждой миграции фиксируются additive/compatibility свойства, текущая резервная копия и применимость независимого restore. После новых записей откат образа не означает возврат старой БД. Релиз не считается принятым при отказе health/public assets/browser smoke. Технические этапы/коммиты являются промежуточным результатом общей цели.


Историческая контрольная точка v12 от 23 октября: новый native scheduler имеет прежний fallback
и отмену; реальные dense200 проверки native/fallback прошли. Мобильный дефект
alert/Retry подтверждён публичным RED и исправлен CSS с 8 native GREEN, включая
320 px. Source `0f04382b237f2874545162f4ccbc80ccf9131c53d5b37ae05a9d625bc993ec1f`.
Одна сборка/full TSC и readonly200/1000 PASS. Full24 завершилась STRICT_RED:
23PASS/1coldRED Firefox1000 (3813,698мс>3000мс), все24 функционально завершены.
Причина UNKNOWN; raw сохранены, исключений/повторов/смены бюджета нет.
Exact-head CI и выпуск: E01/E02/Q02/Q03 пока открыты, общая задача не завершена.
