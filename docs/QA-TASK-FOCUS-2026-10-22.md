# Фильтры построек и значки работ — 22 октября 2026

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

## Историческая точка v13: native PASS, full24 STRICT_RED

Source `7b08afcbcc186eb839a2823d75985497ed2fea8cbaf82a196eaae7eedcc5e8c3`,
qualificationHash `4ede361bab37911dd3129044d3b71b7433f887741fd43e98f7c65d67f33b2307`.
Одна сборка/full TypeScript/freeze и readonly200/1000 — PASS.
Против v12 изменён только cooperative scheduler: обычная owned task на каждой
восьмой границе, без смены slice4ms/checkpoint8192/owner20s.
Адресные unit68/6PASS; это не объяснение старого Firefox cold RED.

U08/U09 сохраняются: маска alpha0,16 применяется только к готовому фильтру,
loading/error оставляют обычную карту, empty приглушает всё, reset снимает маску.
Значки — только у unfinished задач реального ACTIVE-района, по существующим
type/stage. География/дороги/физическая сеть не перестраиваются из-за фильтра.

Первая native22 — **INCOMPLETE137**:13started/9notstarted, formalcountsnull,
причина UNKNOWN. Собственная fixture отдельно очищена точным country→user
cleanup в одной guarded transaction; business31fa восстановлен без seed/restore/reset.
Отдельная R2 — **22/22PASS за454,832221s**, no retry/SKIP/flaky; journal22 и
штатный JSON точно совпали. Полный sixscene312,849s/native WebKitDPR2
с прежним720s deadline, paused-camera regression и narrow keyboard task-entry прошли.
Прежний default exact400ms case не менялся; opt-in16ms RAF progress ограничен
исходными15s wall и future event start. Root принял четыре actual PNG:
error/Retry на320px/iPhone, task-card320 и preview320 — без открытых замечаний
в просмотренных состояниях. Это не аудит каждого кадра или физического телефона.

Новый dense200 native/fallback — **4/4PASS13,748069s**;
geometry59e5/business6de649, frozen920+822 и собственные5343/5367/DB cleanup сохранены.
Receipts: R2 `.builder/native-qa40-scheduler-v13-r2-20261023/summary.json`
SHA256 `e93388fe62feee40cc5e3ca8e5710d1533396aad6af9b02ef9fdc50d00634109`;
root visual `228adcc4…`; dense4 `7e0b7680…`.
[Полные bindings и ограничения](QA-WORLD-EVOLUTION-2026-10-16.md).

**Full24 v13 — STRICT_RED:23 budget PASS/1 RAF RED, все24 функционально завершены.**
Launcher91512exit1, все8 reports/raw equality/source fences, retries/исключений0.
Host gate PASS;
Firefox1000 sample0 RAFp95=33,34ms>20ms, другие два RAF16,78/16,80ms
и все три cold<3000ms прошли, errors0. Причина RAF UNKNOWN.
Console errors0/54warnings/truncation0;12Chromium steadyLongTasks0,
12Firefox/WebKit unavailable=null. HTTP24cold/0pan/warm/legacy,
postflight5311FREE/ownedDBother0/frozen920+822 сохранены.
Aggregate `.builder/world-perf-20261022/task-focus-reliability-v13-summary.json`,
SHA256 `afd4944bd17799bc6da7e99cf56741869ea70479264f92c0b1e2bc373e01c50e`.
V12 STRICT_RED и первый137
не переименовываются. Новый exact-head CI, merge и managed release не выполнены
и заблокированы до ограниченного разбора/устранения RAF RED.
На этом историческом checkpoint диагностика ещё не запускалась; её последующий actual итог указан в разделе v14 выше.

## Историческая точка 23 октября 2026 — v10: адресная приёмка PASS

Source v10: `2ecdc8bec3737d85a105e366a1037e01f057093a5aafab9ae358c0cfa44badd5`.
Визуальный дефект v9 подтверждён публичным RED: при PNG503 число построек
падало **24 → 11**, хотя ожидалось ≥23. В v10 та же проверка сохраняет
**24 → 24**: до успешного PNG фактически отображается stage3; настоящий
Retry возвращает полный count24 и фактически отображаемый stage4.
Основной агент проверил новый PNG: соседние постройки и стиль сохранены.

Compiled native-серия v10 — **16/16 PASS за 124,929476 с**, без SKIP/flaky:
6 Chromium, 4 эмулированных Pixel, 3 эмулированных iPhone и 3 WebKit.
Исходные DPR/сроки сохранены; seed не запускался, business-данные неизменны.
Собственные сервер/браузеры закрыты, порт 5343 свободен, DB other connections 0.
Frozen-проверка: **920 исходных файлов + 822 опубликованные копии**.
Единственная сборка с полным TypeScript и readonly-проверка городов 200/1000 — PASS.
Независимое AI-ревью `827f3682…` — без открытых замечаний.
Квитанции: `.builder/native-qa40-reliability-v10-20261023/summary.json`
(SHA256 `a8ae45d9798781309d4a0a6f973c0315ff03a8e0f1da54bcb80e04fd4be2427e`)
и `.builder/world-perf-20261022/reliability-v10-build-summary.json`.

**Full24, новый exact-head CI, merge и deploy — PENDING.**
[Переносимый preflight v10](evidence/city-scale-2026-10-23/reliability-v10-preflight.json).
Исторические результаты ниже сохраняют свои bindings и отказы.

## Историческая точка 23 октября 2026 — v9, визуальная приёмка была открыта

На замороженном v8 (`60bbf1f1…`) адресная native-серия завершилась
**13/13 PASS за 41,4 с**: Chromium, эмулированные Pixel/iPhone, включая
сохранение ожидающей подготовки при смене качества и панель 320/390px.
Business-данные fixture не изменились; собственные браузеры и сервер закрыты.
Это отдельный локальный результат, не полный CI и не проверка физического телефона.

[CI `39866777088`](https://github.com/afkbot-io/tasktopia/actions/runs/39866777088)
на точном HEAD `704818ee2d7327693e1d0b85cd1d28cfc4246b00` завершился
**FINAL FAIL: все четыре browser shards — FAIL**. Пропущенные и не начатые
сценарии не считаются PASS; native13 v8 не заменяет этот результат.

V9 исправляет отдельный дефект времени: движение учитывает реальную длительность
кадра из `ticker.elapsedMS` с ограничением 250 мс, то есть не более **5 × 50 мс**
обычных физических шагов за кадр. Эффекты сохраняют прежний предел 50 мс;
TTL доставки не увеличен. Публичная регрессия настоящей доставки комментария
при кадрах 200 мс дала RED со старым пределом 50 мс → **9/9 GREEN**. Адресный набор:
**55 PASS / 6 SKIP в шести файлах**; исключены прежние длинные симуляционные
сценарии, поэтому это не полный suite. Scoped TypeScript/ESLint и независимое
AI-ревью `54aa9606…` — без открытых замечаний.

Дополнительно уже опубликованный CITY сохраняет canvas и настоящий Retry
при отказе PNG; первичный отказ входа остаётся ошибкой. Наблюдатель фаз
сноса устанавливается после `goto`/фокуса, фиксирует опубликованный
`COVER` с прежним сроком ожидания; снимок после наблюдения не выдаётся за
кадр самой фазы.

Source v9: `a5e40775a43603a7ec0ad47fef671cfa7d6654b5ba9ec39ea050f896176f6c3c`.
Единственная стандартная сборка с полным TypeScript и readonly-проверка
исходных городов 200/1000 — **PASS**, геометрия сохранена, без seed/restore.
Локальные квитанции: `.builder/world-perf-20261022/reliability-v9-build-summary.json`
и `.builder/ci-pr58-704818ee-20261023/mobility-frame-time/summary.json`.

V9 native-серия завершилась **16/16 PASS за 122,999 с**, без SKIP/flaky:
6 Chromium, 4 эмулированных Pixel, 3 эмулированных iPhone и 3 WebKit-сценария,
ранее упавших в CI. Исходный DPR сохранён; seed не запускался,
business-данные fixture не изменились. Собственные браузеры и сервер закрыты,
порт 5343 свободен, других соединений с собственной БД — 0. Квитанция:
`.builder/native-qa40-reliability-v9-20261023/summary.json`.
Визуальная приёмка ожидает разбора исчезновения построек при отказе PNG;
16 PASS не подтверждает сохранение всей entity-сцены.

На момент этого среза **full24, новый exact-head CI, merge и deploy — PENDING**.
Исторические bindings и отказы ниже сохраняются;
прежние performance-результаты не переименовываются в v9.

**Контрольная точка v7 перед новым CI и scale-проверкой, 23 октября:**
source `80b3015a0c1d5f791351290131e816d000c0c32c720beee3cad3612365466b69`,
сборка/full TypeScript — PASS. Обновлены MCP client/server/core 2.3.0
и Vite 8.2.4; адресные MCP-проверки 33/5 PASS, audit high/critical 0,
moderate 6. Compiled MCP smoke новой сборки — PASS (modern/legacy, auth/scopes/revocation, границы сложности; business-данные fixture не изменены).

Клиентский JavaScript изменён сборщиком (41→36 chunks), несмотря на прежние
три CSS-файла и игровые assets. Поэтому **исторические 21 v5 + 3 v6 PASS
не засчитываются как performance-приёмка v7**. Новые 24 samples — четыре
профиля × 200/1000 × три — и exact-head CI ещё PENDING. Прежний CI
`39864375087` на `a22a23a5…` не прошёл dependency audit; его MCP/browser
SKIPPED не считаются PASS. [Security-preflight и границы применимости](evidence/city-scale-2026-10-22/task-focus-security-v7-preflight.json).
Общий план сохраняет 29/33; окончательные scale/CI/release результаты
фиксируются в задаче №53 и PR58. Старые raw/portable остаются историческими.

**Историческая контрольная точка v6 перед CI на 23 октября: кандидат v6 заморожен; сборка и полная типизация — PASS.
Performance-приёмка: 21 фактический PASS v5 переиспользуется с прежними
привязками; три новых Pixel1000-замера v6 — STRICT PASS. Это не новая матрица 24/24 v6.
На этой контрольной точке итоговый CI и выпуск ещё предстоят; итоговые сведения публикуются в задаче №53 и PR58.** Историческая полная серия v5
остаётся STRICT_RED: 24/24 функционально, один Pixel1000 steady longtask 61 мс
при бюджете 0 longtasks. Её raw-отчёты и переносимые результаты не изменяются.
Срез продолжает [общую цель, 33 критерия](PLAN-WORLD-RELIABILITY-EVOLUTION-2026-10-16.md)
по задаче №53, в том числе U08/U09. R02 закрыт после адресной проверки
восстановления города; общий план содержит 29/33 закрытых критериев после
проверки U08 и визуального принятия U09; остаются E01/E02/Q02/Q03.

Source hash `candidate-task-focus-v6`:
`4173045433eb24e2b9e85d9a72270cb25b06d740c879b9f9e9302e712816e717`.
Client: `d92d2761cf01b7f4424555d7bb1864f9ec28efd3233b0a1a52725f6af3ac361e`;
HTML: `d3bc6db528b0e10437efa445ef12a3a698b840c6b4e9eb3b72be1bb0a8fc8e50`.
Server `dae136ca…` и игровые assets `0c759074…` совпадают с v5. Из 1263 runtime
inputs изменён только `city-mobility.ts`, остальные 1262 совпадают с v5.
Результаты v1–v5 ниже сохраняют исходные привязки и не переименовываются в v6.
Отдельные native-сценарий сохранения ошибки (1 PASS), resource probe (4/4 PASS)
и исправленный visible-world-glyph сценарий (1 PASS, пять PNG приняты основным
агентом без открытых замечаний) выполнены на v5; U09 закрыт. Ресурсная проверка
ниже явно различает resident Sprite и пересечение bounds с viewport.

**Историческая незавершённая performance-серия v4:** завершены все 12 замеров на 200 задачах
и три Chromium-замера на 1000. Firefox1000 sample 0 остановил исходный
runner: `mobilityReady` оставался `null` 90 секунд после atomic-готовности
города и обнуления ground queue. Pixel1000 и iPhone1000 не начинались.
Сохранены три cold-превышения: Chromium200 — 1758,58 мс при бюджете 1500 мс;
Pixel200 — 6088,669 и 6025,17 мс при бюджете 6000 мс.

Во всех 15 завершённых замерах сохранены геометрия, HTTP-бюджеты и canvas,
зарегистрированных функциональных ошибок в этих замерах нет. Это не означает
отсутствия всех console-ошибок: `errors[]` исходного runner не охватывает
сообщения console об обработанных ошибках. Функциональный отказ незавершённого Firefox1000
зафиксирован отдельно. Серия не считается PASS; исходные результаты и бюджеты
не изменяются. Сторонняя нагрузка хоста наблюдалась, но её причинное влияние
на исторические cold-замеры не доказано. [Неизменяемая сводка v4](evidence/city-scale-2026-10-22/task-focus-v4-summary.json).
Единственная отдельная диагностика Firefox1000 завершена: функционально
**1 sample PASS**, но исходный 90-секундный отказ не воспроизведён и остаётся
неразрешённым. Cold 3911,511625 мс превысил прежний бюджет 3000 мс;
инструментация и наблюдавшаяся нагрузка хоста не позволяют использовать
этот замер как чистую квалификацию. Он не дополняет исходную серию до 16/24.

В диагностике canonical 1000 задач/72 чанка, движение готово; ambient→start
занял 133 мс, start→наблюдаемый commit — 4025 мс. Dataset отдельно сообщил
prepare 4044 мс и commit-duration 29 мс. Наблюдены 796 событий очереди,
недоставленных 0, максимальная задержка 272 мс, усечения нет. Console:
0 ошибок и 6 предупреждений, включая context-lost до ambient; это не
устанавливает причину исходного отказа. [Переносимая диагностическая сводка](evidence/city-scale-2026-10-22/task-focus-v4-ff1000-diagnostic.json).
Последующий срез v5 исправляет отдельный подтверждённый дефект стирания
ошибки, не заявляется исправлением причины исходных 90 секунд.
Историческая performance-приёмка v4 не пройдена.

## Поведение фильтра

Сохранён отдельный [offline console-review v5 с ограниченной атрибуцией feature probe](evidence/city-scale-2026-10-22/task-focus-v5-console-review.json).

Жёлтые контуры заменены прозрачностью: совпадающая постройка сохраняет обычный
вид, остальные получают множитель alpha **0,16**. Подложка участка и связанные
эффекты используют ту же маску; выбор постройки и просмотр задачи сохраняются.

| Состояние | Маска карты | Интерфейс |
| --- | --- | --- |
| Фильтр выключен | Alpha 1 | Условия не выбраны |
| Загрузка актуальных метаданных | Alpha 1 | «Загрузка…» |
| Ошибка | Alpha 1 | Сообщение и повтор загрузки |
| Готовый непустой результат | Совпадения 1, остальные 0,16 | Число совпадений и пояснение приглушения |
| Готовый пустой результат | Все постройки 0,16 | Ноль совпадений, предложение изменить или сбросить условия |

Результат привязан к пользователю, стране, городу, ревизии и попытке загрузки.
Ответ прежней области или ревизии не включает маску нового города. Сброс
снимает маску, в том числе во время плавного появления здания. Комбинации
фильтров переиспользуют существующий минутный кеш метаданных; ревизия, ошибка
и повтор обрабатываются отдельно. Фильтрация не запрашивает сцену или чанки
и не перестраивает географию, дороги и сети движения. Чтение метаданных
фильтра сохраняет существующий HTTP-контракт.

## Значки активного спринта

Значок получает только незавершённая задача реального района со статусом
`ACTIVE`. Тип работы читается из `workItemType`, стадия — из `status`.
Завершённые задачи и задачи районов с другим статусом не получают значок.

| Данные задачи | Значок | Подпись в легенде |
| --- | --- | --- |
| `TASK`, `PLANNING` | Линейка | Планирование |
| `TASK`, `STARTED` / `IN_PROGRESS` | Молоток | Строительство |
| `TASK`, `TESTING` | Планшет с проверкой | Приёмка |
| `BUG` | Жук | Ремонт |
| `HOTFIX` | Молния и ключ | Срочный ремонт |
| `RELEASE` | Флаг | Открытие |

Статичные пиксельные знаки 11×11 используют лесной, кремовый, охристый,
стальной и кирпичный цвета существующего мира. Легенда «Значки работ»
свёрнута по умолчанию, открывается клавиатурой и сопровождает каждый знак
текстом. Её шесть SVG содержат суммарно 25 путей; соответствие каждого
пикселя общему шаблону проверяется тестом.

## Отрисовка и восстановление

Все шесть знаков используют один лениво создаваемый атлас 66×11: **2904
исходных RGBA-байта**, один `BufferImageSource`, шесть кадров `Texture`,
фильтрация `nearest`. Это размер исходного буфера, а не замер VRAM. Для
существующей видимой постройки создаётся один `Sprite`; переключение фильтра
его переиспользует. При освобождении города уничтожаются знаки, кадры и
общий источник. Внешние изображения и новые сетевые запросы не нужны.

Плавное появление и фильтр композиционно задают `alpha = fade × mask`.
Завершение fade и включение reduced motion сохраняют маску 0,16. Существующий
ticker обрабатывает только активные fade; полного обхода задач каждый кадр
нет. Маска обновляется при смене фильтра и согласовании объектов сцены.

Строительные сценки применяют маску к захваченному зданию, участку, рабочим
и эффектам, а также скрытому новому зданию. Прозрачность применяется сразу
после начала сценки и согласования её назначения; множитель не удваивается
из-за вложенности. Таймлайн и момент раскрытия нового здания сохраняются.

При совместном отказе обновления города и подготовки движения повтор сначала
получает актуальную серверную сцену. Необходимость перестройки движения
сохраняется через последующие ошибки. Ограниченная предзагрузка зданий
открывающего viewport/halo теперь перекрывает ожидание земли; загрузка земли
начинается первой. Публикация по-прежнему ждёт полный актуальный набор
ресурсов. Изменение порядка загрузки пока не считается измеренным ускорением.

## Проверки и оставшаяся приёмка

- Основной адресный набор: **22 PASS в 8 файлах** — `task-focus-view`,
  `city-cinematic-view`, `city-retry-plan`, `task-focus-presentation`,
  `map-attention-legend`, `map-attention`, `map-attention-filters`,
  `map-attention-loader`. Для fade и retry зафиксирован RED→GREEN.
- Предыдущие **9 PASS в 5 файлах** проверяли presentation/legend и три
  существующих файла attention. Эти пять файлов входят в набор 22/8;
  результаты не складываются в 31 уникальную проверку.
- Scoped ESLint и `git diff --check` прошли. Полная типизация и сборка
  зафиксированных `candidate-task-focus-v1/v2` — PASS. Это не заменяет
  native/performance-приёмку изменённого клиента.
- Независимое ревью исходников атласа, alpha/fade, cinematic, retry и
  параллельной предзагрузки завершено без открытых замечаний. Локальные
  записи с командами и хешами: `.builder/task-focus-design-20261022/`.

На `v1` (`bdf5b288…`) выполнено **11/11 native PASS**: девять сценариев
Chromium, по одному сценарию маски и значков на эмулированных Pixel/iPhone.
Проверены ready/zero/reset, метаданные с 503/retry, настоящие MCP-события,
сохранение камеры/геометрии, overlap загрузки и восстановление зависшего
обновления города. Локальная сводка: `.builder/native-qa40-20261022/summary.json`.
Это адресный набор, не полная браузерная матрица.

Просмотр трёх PNG выявил наложение длинной подписи на соседний значок.
В `v2` легенда на телефонах стала одноколоночной, длинные слова получили
перенос. Повторены только затронутые **3/3 native PASS**: desktop loading/retry
с 320/390px и маска/значки Pixel/iPhone. Эти сценарии пересекаются с 11/11;
они не объявляются 14 уникальными проверками. Визуальный просмотр `v2`
дополнительно выявил недоступный низ длинной панели фильтров на коротком
iPhone. Ограничение высоты с учётом safe area и прокрутка исправлены в исходниках
v3; последующие проверки выявили отдельную проблему короткого landscape
viewport, описанную ниже.

Строгое performance-сравнение на тех же городах с исходными бюджетами и хешами геометрии завершило
24/24 замера `v2`: функциональных ошибок нет, геометрия, HTTP-бюджеты и
идентичность canvas сохранены во всех случаях. Сохранены **три cold-превышения**,
включая Pixel200: 6021,084 мс при бюджете 6000 мс. Это **STRICT_RED**, а не
performance PASS. [Полная сводка](evidence/city-scale-2026-10-22/task-focus-summary.json)
относится к `v2`; результаты не переименовываются в последующих кандидатов.

## Кандидат v3 после причинного разбора

В новый замороженный кандидат вошли три адресные оптимизации:

1. У границы района удалена почти невидимая заливка по каждой клетке.
   Выбор района и подсказка используют прежнюю точную `hitArea`, включая
   разрывы и отрицательные координаты; видимый контур сохранён.
2. В резидентной проекции CITY не создаётся второй индекс тайлов земли.
   Полный канонический снимок по-прежнему содержит terrain для пешеходов,
   сигналов и городских событий. Земля отрисовывается из исходных чанков;
   остальные уровни карты и география не изменены.
3. Чистые требования к ресурсам задачи кешируются на время жизни renderer
   по неизменяемому объекту задачи и LOD. Новый realtime-снимок пересчитывается;
   готовность PNG, ошибки и аренда ресурсов остаются у прежних владельцев.

Для настоящих сохранённых DTO городов 200/1000 упорядоченные наборы URL
совпали с извлечённой исходной функцией `v2`: **56/66 URL в DETAIL**, по одному
в OVERVIEW. Повторное чтение не пересчитывает уже известные объекты, набор
после неизменяемой realtime-подмены также совпал. Все 22 зависимости helper
побайтно совпадают с `v2`. Это сохранность требований к ресурсам, не измерение
ускорения. Локальные доказательства: `entity-asset-conservation.json` и
`entity-asset-dependency-proof.json` в `.builder/world-perf-20261022/`.

Адресные проверки сборщика ресурсов и связанных зависимостей: **47 PASS
в 6 файлах**. Отдельно основной агент выполнил **9 pure-проверок в 4 файлах**
и **2 DB-проверки** этого среза. Наборы записаны отдельно;
числа не складываются в новую общую сумму уникальных проверок. Scoped ESLint
27 исходных/тестовых файлов прошёл; единственная сборка v3, полная типизация
и freeze — PASS. Независимое source-review трёх изменений — без открытых
замечаний. Это не результат обязательного SCM CI.

Нативный запуск v3 завершил **9 PASS / 1 FAIL**: восемь Chromium и Pixel
прошли, iPhone остановился на достижении «Альбома города» клавишей Tab.
Перед этим его ограничения панели прошли: низ 652px при viewport 664px,
`overflow-y:auto`, содержимое 636px при доступных 588px. Это подтверждает
ограничение высоты, но не завершение исходного сценария фокуса и перехода
в альбом. Отдельный причинный разбор подтвердил политику WebKit: обычный Tab
пропускал кнопки, Alt+Tab достигал «Альбома города», прокручивал панель
и позволял открыть настоящий альбом. Исходный FAIL при этом сохранён.

Независимо просмотрены три настоящих PNG: начальное состояние iPhone,
нижняя часть панели Pixel и открытый альбом Pixel. На Pixel все шесть
подписей и значков читаются без наложения, нижние пункты видимы, альбом
открыт. Новых визуальных замечаний в этих кадрах нет. На iPhone финальные
снимки низа/альбома не получены; iPhone и общий native v3 не объявляются GREEN.
Артефакты: `.builder/native-qa40-20261022-v3/results/`, исходный trace сохранён.

Дополнительный просмотр desktop PNG v3 выявил разрыв «Планирование» и
«Строительство» внутри слова в двух узких колонках. Диагностика landscape
844×390 подтвердила второй P2: панель заканчивалась на 619,27px при высоте
viewport 390px, без ограничения высоты и прокрутки. Оба дефекта включены
в следующий адресный CSS-срез.

## Кандидат v4 и адресный визуальный просмотр

В v4 изменён только `game-ui.css`: легенда внутри popover всегда располагается
в одну колонку; панель фильтров ограничена высотой viewport с safe area
и прокручивается также в коротких landscape viewport. Прежние мобильные
отступы сохранены. Все остальные 1262 входных файла и compiled JavaScript
побайтно совпадают с v3; сборка, полная типизация и freeze v4 — PASS.
Отдельное source-review этих двух CSS-правил не оставило открытых замечаний.

Адресная native-серия v4 завершила **2 PASS / 1 FAIL**. Desktop Chromium
и Pixel прошли, включая portrait/landscape и открытие настоящего альбома
в обеих ориентациях. На iPhone прошли ограничения панели, Alt+Tab-фокус
и прокрутка, но точная проверка полной видимости Album получила
`0.9911221862` вместо `1`. Этот FAIL не снят и не округлён до PASS.

Независимо просмотрены пять PNG v4: desktop с раскрытой легендой, низ панели
Pixel portrait/landscape и открытый альбом в обеих ориентациях. Все шесть
подписей на desktop читаются без разрывов внутри слов; значки и подписи
не пересекаются. На Pixel нижние пункты доступны в обоих положениях,
альбомы открыты. Новых явных визуальных замечаний в этих пяти кадрах нет.
Это не проверка всех состояний альбома или полной видимости кнопки на iPhone.
Локальная запись: `.builder/task-focus-design-20261022/visual-review-v4.json`;
исходные кадры и отчёт: `.builder/native-qa40-20261022-v4/`.

Последующий причинный разбор iPhone измерил край сфокусированной кнопки
на 651,390625px при intersection-границе 651px: обрезаны 0,390625px.
Дополнительный настоящий PageDown изменил scrollTop с 32 до максимума 48,
дал ratio `1`, а touch-нажатие открыло настоящий альбом. Runtime-исправление
не требуется. Исправляется только последовательность тестового ввода;
строгая проверка ratio `1` и deadline сохраняются.

Полный исправленный iPhone-сценарий на неизменном v4 завершён отдельно:
**1 PASS / 0 FAIL, 7,3 секунды**. Проверены portrait и 844×390 landscape,
настоящие Alt+Tab/PageDown, строгая полная видимость кнопки и открытие двух
настоящих альбомов. Hash теста изменён с `2ac6e417…` на `1ed9d1b6…`;
runtime source, server/client/HTML остались прежними. Business-state hash
до/после совпал, fences прошли, браузеры и собственный сервер закрыты.
Это отдельный исправленный iPhone-запуск плюс переиспользуемые desktop/Pixel
PASS из предыдущей серии v4, а не новый единый прогон трёх сценариев или
12 уникальных проверок. Исходный FAIL сохранён в прежнем отчёте.

Дополнительно просмотрены два настоящих PNG исправленного iPhone: низ панели
portrait и landscape. Все шесть подписей читаются, фокус «Альбома города»
полностью видим; значки не пересекаются с текстом. В landscape верх панели
закономерно прокручен. Новых визуальных замечаний в этих двух кадрах нет.
Отчёт запуска: `.builder/native-qa40-20261022-v4-input-fix/summary.json`;
визуальное дополнение с полными хешами:
`.builder/task-focus-design-20261022/visual-review-v4-input-fix.json`.

## Кандидат v5: сохранение ошибки и ресурсы фильтров

Отдельный native RED на v4 подтвердил стирание сообщения об ошибке подготовки
движения после pan в прежнем chunk range. На v5 ошибка и Retry сохраняются;
настоящее нажатие Retry завершает подготовку. Ровно один исправленный сценарий:
**1 PASS, 4489 мс**, test SHA `69364b1f…`. Это адресная проверка видимости
ошибки и повтора, не воспроизведение или объяснение исходного 90s timeout.
Запись: `.builder/movement-retry-persistence-20261023/green/summary.json`.

Отдельный разрешённый resource probe выполнил ровно четыре случая без повторов
на замороженном v5. Каждый использовал 20 настоящих pointerdown→2RAF
переключений и прежний бюджет p95 ≤100 мс:

| Город / браузер | Resident tasks / badge Sprite | Input p95 |
| --- | ---: | ---: |
| 200 / desktop Chromium | 200 / 15 | 20,5 мс |
| 200 / iPhone WebKit | 187 / 9 | 36 мс |
| 1000 / desktop Chromium | 558 / 25 | 25,7 мс |
| 1000 / iPhone WebKit | 282 / 25 | 38 мс |

Все **4/4 PASS**: canonical 200/1000 и геометрия сохранены; настоящая комбинация
фильтров даёт ноль, alpha проходит 1→смешанные 1/0,16→все 0,16→сброс 1.
Один источник атласа 2904 байта и badge Sprite/Texture/source переиспользуются;
счётчики ground/entity/movement/walk не изменяются. Scene/chunk/viewport HTTP
при переключении — 0, API writes — 0; камера, масштаб и canvas сохраняются.
Post-freeze fence прошёл; собственные contexts/browser/server закрыты,
порт 5367 свободен. [Переносимые результаты и ограничения](evidence/city-scale-2026-10-22/task-focus-v5-resource-summary.json).

Просмотрены 12 настоящих PNG: обычное/нулевое состояние карты и 320px легенда
каждого случая. Сильное приглушение, ноль/сброс и все шесть подписей читаются,
наложений и горизонтального переполнения не видно. Однако bounds resident
badge Sprite во всех четырёх обычных кадрах находились за viewport; эти кадры
не доказывают видимость glyph на самой карте. Поэтому после performance-серии
выполнен отдельный bounded iPhone1000 сценарий, без изменения старого probe.

Platform roots проверены отдельными Pixi unit-тестами, не сопоставлялись
догадкой в native probe. Программный `scrollIntoViewIfNeeded` подтверждает
CSS-границы/PNG, не настоящий touch/keyboard scroll. `errors[]` probe включает
pageerror/HTTP/requestfailed, но не все сообщения console. Это input/resource QA,
не INP или CPU4 loading benchmark. Физические телефоны не используются.

Отдельный visible-world-glyph сценарий сначала остановился до pan: обвязка
ошибочно требовала resident glyph в начальном кадре. Этот FAILED output сохранён;
дефект приложения не заявляется. Исправленная обвязка выбирает настоящую
canonical eligible задачу и подходит к ней обычным mouse-pointer drag.
Ровно один исправленный iPhone1000 сценарий — **PASS**, initial resident 0,
4 pan при прежнем общем пределе 24/45 секунд. WORK glyph действительно виден
рядом со своим зданием внутри canvas/viewport: нормальный размер 8,8 CSS px,
alpha владельца 1→0,16→1, Sprite/Texture/source сохраняются. Настоящий zoom
увеличил масштаб 0,8→0,9577738905 и размер знака до 10,5355 px. Normal,
filtered, reset и zoom PNG получены с закрытым меню; context crop снят браузером.
Пять PNG просмотрены исполнителем и основным агентом без замечаний;
world glyph визуально принят, U09 закрыт.
[Факты, кадры и сохранённый первый отказ](evidence/city-scale-2026-10-22/task-focus-v5-visible-world-badge-summary.json).

Полная performance-серия v5 завершила **24/24**: функциональных отказов нет,
canonical/геометрия, HTTP и canvas-инварианты сохранены во всех случаях.
Серия остаётся **STRICT_RED**: один steady longtask 61 мс на Pixel1000
при неизменном бюджете 0 longtasks. Этот результат не снимается адресным
resource/visual PASS; причина ещё не установлена.
[Фактическая полная сводка v5](evidence/city-scale-2026-10-22/task-focus-v5-summary.json).

## Кандидат v6: адресный поиск маршрута и приёмка

В `dispatchResponse` единственная цель теперь передаётся существующему
конечному BFS: после её достижения дальнейший обход не нужен. Порядок выбора,
маршрут, heading/no-Uturn, блокировки, пределы 28/64 и cutoff 8000 сохранены;
для нескольких целей остаётся полный поиск. Это одна строка runtime,
не изменение частоты событий или качества мира.

TDD: три исходных RED только по объёму работы BUS/SCHOOL_BUS/FIRE
(945/945/162 checkpoints); маршруты и позы совпали. Затронутый GREEN-набор —
**51 PASS в 6 файлах, 16,59 с**. Scoped TypeScript/ESLint/diff-check и отдельные
сборка/full TypeScript/freeze v6 — PASS. Независимый source-review runtime,
теста и протокола измерения завершён без открытых замечаний. Это отдельный
адресный набор; он не складывается с прежними проверками в новый общий прогон.

Один диагностический trace v5 не покрыл первые **21,128 мс** исходного
8-секундного окна. Событие **747 мс** относится к запуску CPU-profiler,
поэтому не объявляется задержкой приложения. Локальный **89,042-мс** main-JS/RAF
фрагмент включает `startTransit` семейства BUS/SCHOOL_BUS и поиск маршрутов;
точный role в sampled stack не установлен. Inclusive samples не равны CPU-миллисекундам.
Эти наблюдения не атрибутируют исходный 61-мс longtask и не доказывают, что
одноцелевая оптимизация исправляет его причину.

**STRICT PASS:** три новых Pixel Chromium1000 samples v6 с прежними CPU4/network/DPR,
NORMAL, steady 8 с, churn20 и строгими бюджетами. Холодное открытие —
9847,141 / 9511,834 / 8615,849 мс при бюджете 12000 мс; steady longtasks — 0/0/0.
Frame p95 — 16,6–24 мс, input p95 — 49,4–71,4 мс. Во всех трёх случаях
canonical 1000, scene HTTP 1, pan/warm/legacy HTTP 0, геометрия и canvas сохранены,
ошибок нет. Три предупреждения — блокировка Service Worker тестовым браузером;
ручная проверка выполнена. Границы одного окна пересекли минуту, но это само по себе
не доказывает запуск BUS/SCHOOL_BUS внутри окна.

Приёмка — **21 actual PASS v5 reuse + 3 новых v6**, не полный повтор 24 v6.
Первая проверка нагрузки машины остановилась до браузера: 0 samples.
После наблюдаемого изменения нагрузки отдельный ручной preflight прошёл за 54,031 с;
его последние пять интервалов удовлетворили прежнему idle ≥80%. Исходный отказ
сохранён. Нагрузка во время замеров записывается только как контекст и не удаляет результаты.
Протокол не добавляет retries, удаления выбросов или изменения лимитов. В отчёт лишь
сериализуются уже имеющиеся границы steady-window после расчёта метрик;
новых RPC/await/timers/observers нет. Относительное ускорение cold по сравнению с v5
не заявляется. Сервер/браузеры закрыты, порт свободен, соединения освобождены,
frozen source/assets/control fences сохранены.
[Итоговые результаты и раздельные привязки v5/v6](evidence/city-scale-2026-10-22/task-focus-v6-summary.json).

На этой контрольной точке итоговый SCM CI и managed release ещё предстоят.
Исторические STRICT_RED/raw v5, исходная v4 серия 15/24 и её
три cold-превышения сохранены; 90s timeout не разрешён и не воспроизведён
единственной диагностикой. U08/U09 закрыты, 29/33 критериев, задача TESTING 85%;
общая приёмка ещё не завершена. Актуальный итог CI/выпуска — в задаче №53 и PR58.


## 23 октября: финальный кандидат v12 и сохранение просмотра задач

Фильтры и значки U08/U09 сохраняют поведение: несовпадения имеют alpha 0,16,
совпадения — обычный вид; знак получают только незавершённые задачи реального
ACTIVE-района. Новый планировщик меняет task boundary подготовки, не критерии
фильтра, географию, качество или рабочие статусы. Его affected unit набор —
61 PASS/6 файлов; native v11 — 16 PASS/1 тестовый JSON FAIL, отдельно dense200
4 PASS на native/fallback. Эти исходные результаты не переименовываются в v12.

V12 исправляет ширину и перенос сообщения об ошибке карты на телефоне.
Публичный RED: Retry scrollWidth79/clientWidth48 и пересечение с туром.
GREEN: 8 новых native cases, включая 320×568 и iPhone, исходный pan и настоящий
Retry. Четыре фактических layout attachment: кнопка44px, подпись помещается,
alert и кнопка внутри canvas, тур их не закрывает. Новые PNG320/iPhone просмотрены
основным агентом. Два JSON route.fetch используют identity, сохраняя все
утверждения и сроки ожидания. Production compression не менялась.

Source v12: `0f04382b237f2874545162f4ccbc80ccf9131c53d5b37ae05a9d625bc993ec1f`;
[общая квалификация и ограничения](QA-WORLD-EVOLUTION-2026-10-16.md).
Полная серия v12 завершилась STRICT_RED:23PASS/1coldRED Firefox1000
3813,698мс>3000мс. Все24 функционально завершены, причина UNKNOWN;
raw сохранены, retries/изменений бюджета нет. Новый CI и managed release
на этой точке ещё ожидаются.
