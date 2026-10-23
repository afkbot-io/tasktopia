# Города на 200 и 1000 задач: протокол сравнения

## 23 октября 2026 — v14: native12 и full24 STRICT PASS, CI/выпуск ожидаются

Source `51f67980cec9fe77c7f9cb617909c3a12a1b92f0065cfb6b6b292938ac33e247`: только4static render-group flags против v13, остальные1262runtime/576QA совпадают. Server/география/assets прежние. Одна сборка/full TSC/freeze (`bc0ebc39…`) и readonly200/1000 (`9de56c39…`) PASS; geometry/status/descriptor/dumps сохранены без seed/restore/regeneration.

Native12 — **12/12PASS/82,414293s**,0retry/SKIP/flaky, JSON↔journal12 exact (`ae209b6f…`). Root4actual PNG NO_OPEN: Pixel320/iPhone empty-mask, WK full-detail DAY, Chrome atlas maximum (`7a50ad79…`); resized WK не даёт exact pixel claim, физических телефонов нет. Собственная attestation822 `2cf06e36…`/920canonical и native cleanup5343FREE/DB0/business31fa unchanged сохранены.

Исходная full24 — **24/24STRICT PASS**,8reports/raw equality/functional24/errors0/violations0/retries0/exclusions0, launcher47586exit0. Четыре профиля×200/1000×3/NORMAL/churn20/steady8000/coldv2/CPU/network/budgets сохранены. Max warm79,781ms/input p95 45,2ms/RAF p95 19ms/Chromium heap growth1617468B. Cold max200/1000(ms): Chrome1077,524/1968,514; Firefox1292,307/1773,052; Pixel5412,436/8256,882; iPhone800,443/1141,136 — это не loading p95.

Console errors0/warnings54/trunc0; HTTP24cold/0pan/0warm/0legacy. LongTasks12Chromium steady0,12FF/WK unavailable=null; heap толькоChromium, RGBA estimate неVRAM. Postflight:5311FREE/owned2001000DBother0/readOnly/source/output fences unchanged/920+822. [Portable actual summary](evidence/city-scale-2026-10-23/task-focus-reliability-v14-summary.json), SHA `74efab046d379561c7e820cb1d82bed367ba4239d540fbde75d65bbf9f71e2ae`; private aggregate `106b6672…`. Исправлена только ссылка runnerV13→actualV14, raw/metrics не менялись.

V13 STRICT_RED23/1RAF33,34>20ms, V12 coldRED3813,698>3000ms и native137/formalnull/causeUNKNOWN сохранены. Диагностика `e162/f13d` RAFRED не воспроизвела; разные119→374→464builds/+3GL calls не дают общего speedup/causal claim. Новый exact-head all10CI, merge и managed release **PENDING**, E01/E02/Q02/Q03 открыты; все33 критерия/U08/U09 сохранены. Backup по runbook + применимость имеющегося restore-proof, без нового restore gate.

## Историческая серия v13 — STRICT_RED

Текущий source `7b08afcbcc186eb839a2823d75985497ed2fea8cbaf82a196eaae7eedcc5e8c3`.
Против v12 изменён только cooperative scheduler; остальные1262 runtime inputs,
сервер/shared/package/lock/assets совпадают. Одна стандартная сборка с полной
типизацией/freeze/verify — PASS; readonly preflight прежних200/1000 задач
сохранил20/72chunks, geometry/status/descriptor/dump hashes без seed/restore/migrate.
Receipt `.builder/world-perf-20261022/task-focus-reliability-v13-fixture-preflight.json`
SHA256 `5a1072986ab97614aaf10343278dea830bdc7d029a70ab74be1060cb1e55ec44`.

Адресный R2 native22 —22/22PASS454,832221s, dense200 —4/4PASS13,748069s;
они проверяют поведение и исходные fault/clock границы, не заменяют full24.
Первая native22 остаётся INCOMPLETE137/13started/9notstarted/formalcountsnull,
причина UNKNOWN; отдельный bounded cleanup удалил только собственную fixture
и восстановил исходный QA40 hash, без seed/restore/reset.

**Full24 v13 — STRICT_RED:23 budget PASS/1 RAF RED, все24 функционально завершены.**
Launcher91512exit1, все8 reports выполнены, raw equality/source fences сохранены,
retries/исключений0. Original host gate PASS; Firefox1000 workloadexit1 из-за sample0 RAFp95
33,34ms>20ms. Другие два RAF16,78/16,80ms прошли; все три cold
1962,993/1834,709/1745,415ms<3000ms, errors0. Причина RAF UNKNOWN.
Console errors0/54warnings/truncation0, HTTP24cold/0pan/warm/legacy.
LongTasks:12Chromium steady0,12Firefox/WebKit unavailable=null, не измеренный ноль.
Postflight:5311FREE, обе ownedDB other0, исходные920+822/source fences сохранены.
Aggregate `.builder/world-perf-20261022/task-focus-reliability-v13-summary.json`,
SHA256 `afd4944bd17799bc6da7e99cf56741869ea70479264f92c0b1e2bc373e01c50e`.
Сохраняются четыре исходных профиля×200/1000×3, NORMAL/churn20/steady8000,
coldv2 и прежние budgets/CPU/network/DPR. Нельзя исключать или повторять RED
и переносить performance PASS старого v10 на новый client.
Новый exact-head CI, merge и выпуск не выполнены и заблокированы до
ограниченного разбора/устранения RAF RED.
На этом историческом checkpoint диагностика ещё не запускалась; её последующий actual итог указан в разделе v14 выше.
[Общая приёмка и фактические локальные receipts](QA-WORLD-EVOLUTION-2026-10-16.md).

## Историческая серия v12 — STRICT_RED

Исторический кандидат v12, source
`0f04382b237f2874545162f4ccbc80ccf9131c53d5b37ae05a9d625bc993ec1f`.
Его серия 4 профиля × 200/1000 × 3 завершилась STRICT_RED: 23 PASS /
1 cold RED Firefox1000 (3813,698 мс >3000 мс). Все24 функционально завершены,
ошибок0. Причина превышения UNKNOWN, исходные controls/бюджеты сохранены,
замеры не исключались и не повторялись. Старые результаты ниже сохраняют свои ревизии.
[Текущее состояние приёмки](QA-WORLD-EVOLUTION-2026-10-16.md).

## Исторические серии baseline и v2–v4

Baseline и кандидаты v2/v3/v4 измерены по 12 профилям / 36 свежим
браузерным контекстам каждый. Историческая полная v4 `03fc2d72` сохраняет
**11/12 профилей PASS и три превышения исходной Node-метрики**. Все 36 проверок
геометрии, canonical tasks, HTTP/canvas guards прошли, ошибок приложения нет.
После доказанной задержки наблюдения locator assertions отдельные парные
**3 baseline + 3 candidate Firefox200 по методике v2 прошли прежние бюджеты**.
Вместе с 11 прежними консервативными PASS bounds они закрывают заявленные
границы производительности. Это не новая матрица 36 v2; прежние RED сохранены.
SQL/JSON/gzip сравнение завершено на неизменном сервере. Общая приёмка,
SCM/CI и выпуск ещё предстоят.

## Исходные результаты

Все 36 выборок сохранили хеш геометрии и точное число канонических задач;
один cold CITY request, pan/warm CITY/legacy requests — 0, JS/HTTP errors — 0.
Сводка с хешами сырых отчётов:
[baseline-summary.json](evidence/city-scale-2026-10-16/baseline-summary.json).
Числа в таблице — медианы трёх загрузок либо медианы p95 отдельных RAF/input
последовательностей; это не p95 загрузки города.

| Набор / профиль | Cold, мс | Warm, мс | RAF p95, мс | Input proxy p95, мс |
| --- | ---: | ---: | ---: | ---: |
| 200 Chromium | 1547 | 15 | 9,1 | 17 |
| 200 Firefox | 1448 | 25 | 9,1 | 21 |
| 200 WebKit | 1473 | 32 | 18 | 42 |
| 200 Pixel Chromium CPU4 | 6687 | 99 | 25,6 | 112 |
| 200 iPhone Chromium CPU4 | 6577 | 101 | 25,6 | 92 |
| 200 iPhone WebKit | 1357 | 26 | 18 | 41 |
| 1000 Chromium | 2336 | 39 | 24,4 | 68 |
| 1000 Firefox | 3685 | 32 | 33,0 | 84 |
| 1000 WebKit | 3812 | 16 | 30 | 124 |
| 1000 Pixel Chromium CPU4 | 15189 | 94 | 99,9 | 360 |
| 1000 iPhone Chromium CPU4 | 14824 | 90 | 84,2 | 340 |
| 1000 iPhone WebKit | 5409 | 18 | 38 | 151 |

На desktop Chromium у 1000 задач около 72 тысяч display objects, все 72 chunks
имеют ground и infrastructure overlay, 1000 resident task views. Оценка RGBA
отслеживаемых текстур — около 153 MiB, post-GC JS heap — около 272 MiB.
На 200 задачах — около 18,6 тысяч views и 64 MiB отслеживаемого RGBA.
Это подтверждает дорогую подготовку и большой объём residency; аппаратное
насыщение GPU или точный объём VRAM из этих метрик не следует.
Warm/canvas retention остаются быстрыми, рост heap после 20 циклов ограничен;
главная исходная проблема — холодные паузы и постоянная отрисовка большого города.

Отдельный read-only сервисный замер: 200 задач — первый read 130 мс / 16 SQL,
1000 — 399 мс / 16 SQL; по 20 warm reads — 3 SQL, p95 wall time 1,5 / 2,5 мс.
Сериализация/HTTP не входит в service wall time и измеряется browser end-to-end;
сумма времён параллельных SQL round trips может превышать wall time.

## Изолированные входы

Baseline — `053e061d84dbcafdeaf1841010f9bd2286c9c5f8` (1.24.14),
полученная через `git archive` и собранная отдельно от рабочего `dist`.
`baseline-inputs.json` содержит SHA256 серверного bundle, клиентских JS/CSS,
HTML, service worker, lockfile и ключевых исходных файлов. Измеритель дополнительно
сравнивает загруженный HTML с заявленной сборкой.

Используются две отдельные локальные PostgreSQL 16.15 базы. Закрытые URI читаются
из файлов с правами 0600 и не включаются в отчёты или команды воспроизведения.
Общий сайт, рабочие страны и заполненный Docker PostgreSQL не используются.

| Набор | Задач ровно | Районов | DETAIL chunks | COMPLETED | IN_PROGRESS | PLANNING |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 200 | 200 | 8 | 20 | 160 | 30 | 10 |
| 1000 | 1000 | 40 | 72 | 800 | 150 | 50 |

Seed `424242`, morphology `DENSE_CORE`, районы `NEW_BUILD`, 25 задач на район.
Все задачи, дороги, участки и входы созданы `AppService`; нарушения `auditWorld`
отсутствуют. Начальная расстановка стадий использует ранее принятый шаблон
изолированных performance-фикстур: пакетное изменение только статуса/прогресса,
после которого вызывается настоящий `synchronizeCityBlocks`. Пространственные
таблицы и DTO не подменяются. Это синтетический набор для сравнения, а не модель
полной рабочей истории пользователя или доказательство всех MCP-переходов.

Фикстуры заморожены до замеров. Для каждой сохранён custom-format dump, SHA256,
размер и проверенная TOC; повторный seed поверх существующих задач запрещён.
Перед каждым замером клиент проверяет количество канонических задач и хеш
исходной геометрии независимо от числа resident display objects.

Geometry SHA256:

- 200: `59e5defddb16da18246f4e5bdbe4fab344c13dd966e0d566c811ad9bd98141b2`.
- 1000: `bb94b5e59b363d4002e2d86d3c470e49e3e5bb87d9d5ef9da97e5e7952b2be47`.

## Нагрузка и профили

Для каждого набора выполняются три свежих браузерных контекста на профиль.
Между профилями нет одновременных browser benchmarks. Кеш браузера холодный;
PostgreSQL, файловый кеш ОС и серверный кеш не объявляются холодными.
В обоих вариантах выставлены NORMAL, включённая жизнь города и выключенный
звук; service worker заблокирован. Redis не подключён, runtime — локальный
`combined` с пулом PostgreSQL 10. Сравнение не является замером пропускной
способности опубликованной конфигурации с несколькими runtime.

| Профиль | Движок | Viewport | DPR | Touch | CPU rate | Сеть |
| --- | --- | --- | ---: | --- | ---: | --- |
| desktop-chromium | Chromium | 1440×1000 | 1 | нет | 1 | локальная |
| desktop-firefox | Firefox | 1440×1000 | 1 | нет | 1 | локальная |
| desktop-webkit | WebKit | 1440×1000 | 1 | нет | 1 | локальная |
| pixel-chromium | Chromium | 393×851 | 2,75 | да | 4 | CDP 60 мс / 1,6 Мбит/с down / 750 Кбит/с up |
| iphone-chromium | Chromium | 390×844 | 3 | да | 4 | такая же CDP сеть |
| iphone-webkit | WebKit | 390×844 | 3 | да | 1 | локальная |

`iphone-chromium` проверяет узкую компоновку при одинаковом замедлении; это не
Safari. У Playwright WebKit нет CDP-замедления CPU/сети, поэтому `iphone-webkit`
остаётся отдельной проверкой touch-компоновки и отклика без этих ограничений.
Физические телефоны, батарея, реальные iOS/Android и все GPU не проверяются —
пользователь выбрал браузерную эмуляцию.

Cold — от клавиатурной активации города на готовой планете до atomic CITY и
снятия блокировки перехода; дополнительно записывается полный вход со страницы.
Warm — повторный переход PLANET → CITY. Перед steady-интервалом ожидается
завершение ground bake, готовность mobility и 3 секунды прогрева; затем 8 секунд
настоящего времени RAF. Фазы фоновых событий и все renderer counters сохраняются,
чтобы не приписывать различие случайно совпавшей сцене оптимизации алгоритма.

Для отклика выполняются 20 настоящих раскрытий/закрытий легенды. Метрика —
нативное событие pointerdown/keydown до второго RAF: сопоставимый верхний ориентир
отклика, не полный INP пользовательской сессии. Затем выполняются pan и 20 циклов
PLANET/CITY. Проверяются HTTP reads, сохранение canvas, heap до/после одинакового
GC в Chromium и число display/texture resources через публичный Pixi debug hook
с `WeakRef`, который сам не удерживает renderer.

Сумма `pixelWidth × pixelHeight × 4` для отслеживаемых источников текстур —
оценка RGBA, а не измерение VRAM. Она не включает framebuffer, mipmaps, драйвер,
CPU canvas backing и общую native memory. Firefox/WebKit не получают выдуманных
CDP heap/long-task значений: неподдерживаемые метрики остаются недоступными.

## Бюджеты, объявленные до финальных замеров

| Метрика | Desktop / WebKit touch | Chromium CPU4 + сеть |
| --- | ---: | ---: |
| Cold 200, мс | ≤1500 | ≤6000 |
| Cold 1000, мс | ≤3000 | ≤12000 |
| Warm, мс | ≤500 | ≤750 |
| Input proxy p95, мс | ≤100 | ≤200 |
| Steady RAF p95, мс | ≤20 | ≤34 |
| Steady long tasks >50 мс | 0, если API доступен | 0 |
| Рост retained JS heap после 20 циклов | ≤8 MiB, если CDP доступен | ≤8 MiB |

Для всех профилей: один cold CITY scene request, ноль CITY/legacy запросов при
pan и warm; ошибок JavaScript/HTTP нет. Все 200/1000 канонических задач сохраняются.
Количество resident views/ground textures оценивается отдельно от полного DTO.
Для трёх загрузок публикуются медиана и диапазон, не p95; p95 применяется к
достаточным последовательностям RAF и событий ввода. Превышение baseline-бюджета
сохраняется как исходная проблема. `CITY_SCALE_ENFORCE_BUDGETS=true` превращает
превышения финального кандидата в ненулевой exit code, не меняя сами пороги.

## Воспроизведение

Скрипты: `seed-city-scale-fixtures.ts`, `measure-city-scale.ts`,
`measure-city-scale-server.ts`, `run-city-scale-benchmarks.ts`.
Seed разрешён только в новой пустой локальной базе с явно заданным именем набора;
для повторного сравнения использовать уже замороженный набор, не создавать его
заново. Benchmark driver проверяет свободный порт и завершает только собственный
child server. Пароли и URI не передаются в CLI.

```sh
CITY_SCALE_BUILD_ROOT=.builder/world-perf-20261016/baseline-source \
CITY_SCALE_DATABASE_DIRECTORY=.builder/world-reliability-evolution-20261016/postgres16 \
CITY_SCALE_SOURCE_REVISION=053e061d84dbcafdeaf1841010f9bd2286c9c5f8 \
CITY_SCALE_VARIANT=baseline CITY_SCALE_PORT=5311 \
CITY_SCALE_SAMPLES=3 CITY_SCALE_CHURN=20 CITY_SCALE_STEADY_MS=8000 \
node --import tsx scripts/run-city-scale-benchmarks.ts
```

Для кандидата меняются только build root, revision и variant; геометрия, браузеры,
профили, драйвер, настройки и базы сохраняются. Сырые отчёты, снимки и замороженные
артефакты находятся в ignored `.builder/world-perf-20261016`. Нагрузочные измерения
сервиса отдельно записывают время, число SQL round trips, SQL fingerprint и размер
JSON/gzip. Параметры SQL и секреты не публикуются.


## Подготовка финального окружения

Кандидат использует отдельный native PostgreSQL 16.15 на 127.0.0.1:55437;
исходный baseline на 55436 и чужие процессы/базы не менялись. Из оригинальных
custom dumps, проверенных по SHA256, восстановлены две новые изолированные
базы с 200/1000 задач. Регенерация или повторное создание задач не выполнялись.
URI сохраняются только в ignored 0600 файлах
`.builder/world-perf-20261016/final-postgres16`; секреты не печатались.

Readonly проверка через неизменный baseline AppService подтвердила exact
geometry hashes, количество канонических задач 200/1000, чанки 20/72 и исходное
распределение статусов. 32 настройки runtime/locale сравнивались с исходным
кластером: PostgreSQL 16.15, UTC, data checksums, shared_buffers 128 MB,
max_connections 100, fsync и остальные выбранные параметры совпали.
Порт/каталог/Unix socket закономерно отличаются. Результат без секретов:
`docs/evidence/city-scale-2026-10-16/final-database-setup.json`.

Финальная серия выполнена последовательно на локальном порту 5311 из
неизменяемой production-сборки `final-candidate-v2`. Source hash:
`0929eddf5da7f54685ad352d0816b7fa41c6d73069e97e8cc76b8ef60fd8dfb4`;
server hash `dae136ca64c93bbc7d0dfac2a675c38ed5edc800d895a5a78af7f4ed48c61937`.
Сборки v1/v2 имеют одинаковые server/client bytes; единственная правка v2 —
число MCP tools 47 → 50 в `public/ai.md`. UI-проверки v1 сохраняют применимость
к тому же игровому runtime v2. Процессные/browser cold samples не обозначают
холодные PostgreSQL/OS дисковые кеши.

## Финальные 36 замеров: strict gate RED

Завершены все 12 профилей × 3 samples. Ошибок JavaScript/HTTP — 0; геометрия,
канонические 200/1000 задач, один cold scene request, ноль scene/legacy reads
при pan/warm и identity canvas сохранены во всех 36 случаях. Из 12 профилей
строгие бюджеты проходят 4; остальные содержат суммарно 24 нарушения
отдельных sample/метрик. Driver и paired comparison сохранили exit code 1.
Ускорение относительно baseline само по себе не означает прохождение бюджета.

Все значения таблицы — медианы трёх sample; диапазоны и каждое нарушение
записаны в `docs/evidence/city-scale-2026-10-16/final-v2-summary.json`.
RAF/input p95 вычисляется внутри каждого sample; таблица показывает медиану
этих p95, поэтому не скрывает отдельные нарушения в полном отчёте.

| Задачи / профиль | Cold baseline → final, мс | RAF p95 baseline → final, мс | Input proxy p95 baseline → final, мс | Strict |
| --- | ---: | ---: | ---: | --- |
| 200 desktop Chromium | 1547 → 1436 | 9,1 → 9,1 | 17 → 16 | PASS |
| 200 desktop Firefox | 1448 → 1720 | 9,1 → 9,2 | 21 → 23 | RED: cold ×3 |
| 200 desktop WebKit | 1473 → 1475 | 18 → 18 | 42 → 42 | RED: cold 1502,9 >1500 в одном sample |
| 200 Pixel Chromium CPU4 | 6687 → 6326 | 25,6 → 25,4 | 112 → 107 | RED: cold ×3 |
| 200 iPhone Chromium CPU4 | 6577 → 6359 | 25,6 → 25,1 | 92 → 90 | RED: cold ×3 |
| 200 iPhone WebKit | 1357 → 1157 | 18 → 18 | 41 → 40 | PASS |
| 1000 desktop Chromium | 2336 → 1915 | 24,4 → 9,2 | 68 → 36 | PASS |
| 1000 desktop Firefox | 3685 → 3098 | 33 → 16,6 | 84 → 57 | RED: cold ×2, RAF ×1 |
| 1000 desktop WebKit | 3812 → 3630 | 30 → 19 | 124 → 80 | RED: cold ×3 |
| 1000 Pixel Chromium CPU4 | 15189 → 9905 | 99,9 → 41 | 360 → 147 | RED: RAF ×3, steady long tasks в двух samples |
| 1000 iPhone Chromium CPU4 | 14824 → 9554 | 84,2 → 33,3 | 340 → 114 | RED: RAF ×1, steady long tasks в двух samples |
| 1000 iPhone WebKit | 5409 → 2468 | 38 → 18 | 151 → 41 | PASS |

Для 1000 задач desktop warmed views уменьшились примерно 72 248 → 38 931,
отслеживаемая RGBA-оценка 160,1 → 84,2 MB. На touch-профилях: 70 778 →
15 650 views и 153,8 → 27,2 MB. Это сравнение одинаковой фазы warmedResources;
оно не измеряет VRAM. В мобильном CITY сохраняются все 1000 canonical tasks,
72 decoded data chunks, тогда как GPU resident — 12 chunks/233 task views.
В desktop начальный viewport больше: 36 resident chunks/558 task views.

Warm, input proxy, retained post-GC heap и HTTP request budgets прошли во всех
профилях. Настоящие Chromium steady long tasks всё ещё встречаются на CPU4
при 1000 задачах; их нельзя объяснить Playwright polling. Firefox/WebKit не
поддерживают этот Long Tasks API, поэтому их отсутствие не заявлено.

Cold включает Playwright-ожидание atomic CITY и снятия transition. Наблюдаемый
хвост между renderer mark и завершением ожидания ещё исследуется отдельно;
порог и исходные значения задним числом не менялись. Input count совпал с
baseline для каждого профиля: desktop 21, touch 22 (20 раскрытий легенды,
Escape и на touch также Menu). Полный набор сырых JSON/PNG/logs остаётся в
ignored каталоге, включая все RED samples.

Для сохранения всех профилей использована ignored копия orchestration driver:
она продолжает только после completed 3-sample report с errors=0/failure=null,
если причина exit1 — строгие бюджеты. Один server на размер набора сохранён;
functional/hash/geometry сбой останавливает driver. Итоговый exit1 сохраняется.
Measurement и contract/budgets не менялись; SHA обоих driver и measurement
есть в `final-v2-summary.json`. Это не повтор успешно пройденных sample.

GPU после серии передан причинному renderer profiling. Read-only SQL/JSON/gzip
замеры завершены в отдельном согласованном CPU-окне. Их результаты не подменяют
browser gate. Публикация и релиз не считаются проверенными этим отчётом.

## SQL и размер ответа v2

Для каждого набора выполнены один process-cold service read и 20 warm reads.
Использован тот же measurement с дополнительным startup read-only guard:
`default_transaction_read_only=on`, подтверждённым через `SHOW`; `migrate:false`.
Три исходника AppService/db/task-detail-read сверены с manifest v2. Все измеренные
запросы — SELECT; записи рабочих объектов, повторный seed или геометрия не менялись.

| Задачи | Cold service baseline → final, мс | Warm p50 / p95 baseline → final, мс | Warm SQL queries | JSON bytes baseline → final | Gzip bytes baseline → final |
| --- | ---: | ---: | ---: | ---: | ---: |
| 200 | 130,23 → 107,23 | 0,98 / 1,51 → 0,60 / 0,73 | 3 → 2 | 1 244 392 → 1 244 392 | 165 952 → 165 953 |
| 1000 | 399,15 → 371,06 | 1,01 / 2,54 → 0,61 / 2,60 | 3 → 2 | 6 520 530 → 6 520 530 | 869 087 → 869 083 |

Cold запросов осталось 16. Одинаковый размер JSON не доказывает идентичность
payload; gzip отличается на +1 / −4 bytes, поэтому byte equality не заявляется.
Время service read исключает последующие JSON.stringify/gzip. Cold представлен
одним sample и не является доказательством распределения или холодного диска;
сумма параллельных SQL round trips может превышать wall time. Throughput под
параллельной нагрузкой не измерялся. Детерминированный результат — 2 warm SELECT
вместо 3 при сохранённом размере ответа и полном наборе задач.

Подробные распределения и SHA сырых отчётов:
[final-v2-server-summary.json](evidence/city-scale-2026-10-16/final-v2-server-summary.json).

## Кооперативная подготовка: native 21/21 PASS, strict 36 ожидается

После RED v2 причинные CPU/DOM-профили разделили задержки подготовки канонических
графов, маршрутов и городских сценок и постоянную работу отображения светофоров.
Для подготовки добавлены ограниченные кооперативные шаги, readonly геометрия
новой сети и синхронное применение с проверкой владельца и свежей life revision.
Применение использует актуальных жителей и визиты; состояние актёров не
замораживается на время `await`. Сортировка сохраняет стабильный порядок,
физический граф и население остаются полными.

Один независимый read-only proof на исходных городах 200/1000 сравнил восемь
неизменённых модулей exact `053e` с новыми sync/cooperative builders: графы и
порядок Map/Set, topology signatures, начальные 56 актёров, 500 мс движения,
life/everyday sites, остановки и восемь animal route/RNG случаев на набор совпали.
Входы и сцены не изменились; seed/regen/schema writes не выполнялись.
Компактные результаты, точные source/output hashes и независимые ревью:
[cooperative-preparation-summary.json](evidence/city-scale-2026-10-16/cooperative-preparation-summary.json).
Длительность этого pure proof 7,71 с не является измерением браузера.

Промежуточный снимок `651a6e07` прошёл 9/9 native cases в Chromium, Firefox
и iPhone WebKit с исходными границами 5/20 с. Четыре одиночных causal samples
сохранили RED: 200 Pixel cold 6195 >6000 мс; 1000 Firefox cold 3282 >3000 мс
и RAF p95 33,36 >20 мс. Другие два sample прошли. Это не полная серия и не
доказательство скорости последующего исправления painter-order cache Pixi.

Снимок `831102cf5370b9461b66122498958ac6d50b3f1d43da112c9ae1afc54fafebf3`
уже включает корректный depth-adapter и перекрытие resident work с полной
canonical materialization. Он прошёл **18/18 native cases**: шесть сценариев
в Chromium, Firefox и iPhone WebKit за 2,3 минуты. Проверены прежние 5/20 с,
полный canonical мир до atomic frame, pan без HTTP, уход/возврат, latest defect
во время подготовки, resident bake при held far worker и два fault/retry случая.
Эта историческая серия расширяла предыдущие девять; их нельзя складывать
в 27 независимых новых cases. Текущую qualification заменяет серия `353bf444`
ниже. Полные source/server/client hashes и SHA raw логов
сохранены в той же компактной сводке.

Два P1 воспроизведены на предыдущем overlap snapshot и закрыты: после canonical
failure поздний resident увеличивал bakes 22 → 24; retry давал 44 bakes при
бюджете 24. Исправления вводят fail-fast iteration fence, уничтожение поздних
views и единственного владельца validate/cache/cleanup общего data promise.
Три движка подтвердили восстановление с единственным настоящим retry через
500 мс. Независимое source review этого checkpoint не оставило замечаний.

Четыре одиночных causal samples этого `831102cf` сохранили два нарушения:
200 Pixel cold **6206,816 >6000 мс** и один steady long task **51 мс** в 1000 Pixel.
Firefox 200/1000 прошли исходные пороги. Raw RED сохранён, эти четыре sample
не являются полной финальной серией.

Снимок `353bf444856b0c7b3f4fa658a1c263502a458bd77ec845baba6cf49aade179de`
прошёл **21/21 native cases**: прежние шесть сценариев и новый FIRSTatomic
в Chromium, Firefox и iPhone WebKit за 2,5 минуты. Новый regression сначала упал
на `831102` по существующему условию `12 < 12`: первый кадр ждал весь ground halo.
Теперь только при первом показе CITY готовая видимая земля и exterior
публикуются до invisible ground halo. Все 1000 canonical tasks, wanted entity
sources/PNG/roofs, физическая сеть и halo 1 сохранены. Точная непрерывная область
готовности включает дробные полоски по краю экрана; постраничные HTTP и полная
ground barrier после первого кадра не сокращены.

MutationObserver проверяет FIRSTatomic до поздних locator waits. Независимый
viewport×canonical-chunk oracle подтвердил полноту visible ground, готовность
exterior и целые entity sources. После завершения фоновой очереди проверены
все wanted ground, прежний canvas, NORMAL/style и pan без HTTP. Все три PNG
после pan просмотрены, пустых тайлов и швов не обнаружено. Отдельные численные
FIRSTatomic JSON не сохранились при CLI reporter; сводка приводит реальные
assertions, без новых выдуманных значений. Серии 21/18/9 пересекаются,
их нельзя складывать как 48 независимых новых cases.

На этапе 353bf444 original strict 36 оставалась **PENDING** до causal profiles
и ранее RED 1000 desktop WebKit. Подготовленные на том этапе restore/launcher
ещё не запускались; ниже зафиксирован переход к 934 и запуск полной серии.
Результат v2 по-прежнему **RED: 24 нарушения**, пороги не менялись. Новое
`everydayPlanningMs` измеряет wall time принятой latest попытки вместе с
`await`/yield; прямое сравнение этого значения с прежним синхронным CPU compile
было бы некорректным. Атомарный commit и browser cold/steady оцениваются отдельно.


Последующие четыре одиночных sample на `353bf444` сохранили RED только в 200 Pixel:
cold **6213,886 >6000 мс**. Дополнительный ранее проблемный 1000 desktop WebKit
прошёл исходные пороги. Чтобы убрать конкуренцию PNG с первой загрузкой земли,
снимок `934cac5a` отдаёт terrain первые request slots, затем запускает полный
opening entity prefetch. Его одиночный 200 Pixel sample прошёл: **5757,125 мс**.
Объём данных и спрайтов, качество, драйвер и бюджеты не сокращались.
Последний полный native checkpoint — 21/21 на 353bf444; для нового 934 прошли
6/6 затронутых native cases в трёх движках. Неизменённые границы используют
прежние результаты отдельно от нового runtime. Original 1000 Pixel прошёл:
cold 8375,356 мс, RAF p95 25,4 мс, input p95 88,9 мс, steady LT 0; original 1000 desktop
WebKit — cold 1644,915 мс, RAF p95 18 мс, input p95 52 мс. Ошибок и HTTP при pan нет.

После явного CPU/GPU handoff original 200/1000 восстановлены из frozen dumps:
geometry hashes и статусы совпадают, audit 0, seed/regen/FORCE не применялись.
[Fresh restore](evidence/city-scale-2026-10-16/final-v3-database-restore.json).
После restore запущена полная исходная strict 36 на 934: 3 samples × 6 profiles × 2 sizes,
churn 20, steady 8 с, strict TRUE. Её итог и postflight приведены ниже; прежние RED
сохранены.


## Полная серия v3: 36 завершены, strict gate RED 4

Неизменный снимок `934cac5a02de5690d2c3920d93fc5676d9f33341ba11aaf572f85df126d404b8`
прошёл все 36 функциональных проверок после свежего восстановления original dumps.
Сравнение отказалось бы принять другие браузеры, viewport/DPR/touch/CPU/network,
геометрию, количество samples или бюджеты; эти контракты совпали. Postflight
подтвердил точные server/client/HTML bytes. Итоговые exit 1 driver и comparison
сохранены, успешные samples не повторялись.

**9/12 профилей проходят все бюджеты.** Сохранены четыре нарушения:

- 200 desktop Firefox: cold 1587,2 и 1582,4 мс >1500 мс в первых двух samples.
- 200 Pixel Chromium: steady long task 52 мс в третьем sample при требовании 0.
- 1000 desktop Firefox: RAF p95 25,74 мс >20 мс в первом sample; следующие 9,20/9,06 мс.

Ниже медианы трёх samples; хорошая медиана не отменяет отдельный RED sample.

| Город / профиль | Cold median, мс: baseline → v3 | RAF p95 median, мс: baseline → v3 | Strict |
|---|---:|---:|---|
| 200 desktop-chromium | 1547 → 1396 | 9.1 → 9.0 | PASS |
| 200 desktop-firefox | 1448 → 1582 | 9.1 → 9.2 | RED |
| 200 desktop-webkit | 1473 → 1439 | 18.0 → 18.0 | PASS |
| 200 pixel-chromium | 6687 → 5857 | 25.6 → 25.5 | RED |
| 200 iphone-chromium | 6577 → 5868 | 25.6 → 17.4 | PASS |
| 200 iphone-webkit | 1357 → 853 | 18.0 → 18.0 | PASS |
| 1000 desktop-chromium | 2336 → 1612 | 24.4 → 9.1 | PASS |
| 1000 desktop-firefox | 3685 → 1949 | 33.0 → 9.2 | RED |
| 1000 desktop-webkit | 3812 → 1588 | 30.0 → 18.0 | PASS |
| 1000 pixel-chromium | 15189 → 8090 | 99.9 → 17.6 | PASS |
| 1000 iphone-chromium | 14824 → 8349 | 84.2 → 17.2 | PASS |
| 1000 iphone-webkit | 5409 → 1254 | 38.0 → 18.0 | PASS |

В 1000 Pixel cold median сократился на 46,7%: 15189 → 8090 мс; отслеживаемый RGBA
estimate — 153762568 → 27231240 B (−82,3%), views 70778 → 14999. Это оценка Pixi
texture sources, не VRAM. Все 1000 canonical tasks сохранены. В 200 desktop Firefox
cold median, напротив, вырос 1448 → 1582 мс (+9,3%); это остаётся реальным RED,
его нельзя скрывать общим улучшением большого города.

[Полная парная сводка 36](evidence/city-scale-2026-10-16/final-v3-summary.json)
содержит source/build hashes, все report hashes, 36 sample metrics и ограничения
измерений. API longtask/heap у Firefox/WebKit отсутствуют и не считаются нулём.
CPU/GPU передан renderer на один ранее одобренный diagnostic 200 Pixel trace.
Новый benchmark/restore не запускается самостоятельно; общая цель и выпуск
остаются открыты до устранения подтверждённых границ и новой квалификации.


После v3 выполнен узкий idle Graphics cut в `city-everyday-view.ts`: пустой
`cues.clear()` больше не инвалидирует Pixi на каждом кадре. Actual Pixi тест
сначала дал RED 120 updates, затем GREEN 0; active→idle очищается ровно один раз,
рисование активных cues и дождь сохранены. Снимок `cbd8ac13` проверен тремя
одиночными original probes: Firefox 200/1000 прошли, Pixel 200 всё ещё RED по
steady gate с двумя longtasks 54/55 мс. Это не новая серия36 и не финальная приёмка.

Последующий causal trace поймал реальный MEDICAL onset task 61,115 мс:
roadEventSites 30,9 мс inclusive/28,2 мс self и render 14,9 мс. Task начался 114 мс до
original steady, поэтому не используется как qualification. Следующий
согласованный срез — подготовка только static road geometry descriptors,
с сохранением live actors/reachability/closures/order. Старые RED и пороги
не меняются, новой матрицы или restore до явного handoff нет.


## Подготовка static road geometry и новая квалификация v4

Статические descriptors перенесены в существующую cooperative подготовку
canonical network. Live actors, первые шесть доступных машин, reachability,
актуальные closures, порядок candidates и response cells сохранены. Разные
исходные predicates не объединены: radius 2 исключает только три site cells,
response cells исключают точную zone cell, tow дополнительно проверяет текущие
safeDestination/reachability. Публичные массивы и tow point создаются заново;
семантика существующих ссылок Cell сохранена.

Public regression сначала воспроизвёл повторный scan static coordinates,
затем итоговый набор дал **39/39 checks в четырёх файлах**, scoped TS/lint PASS.
Один read-only proof на реальных frozen 200/1000 подтвердил точное совпадение
с exact053e и pre-static-road CBD: полные ordered WALK/network/signatures,
56 seeded agents/signals, 500 мс motion, life/everyday/transit/animal outputs и
восемь ordered road states на каждый набор. Проверены current lane closure,
reopen, настоящий MEDICAL response с первой попытки, его движение/release и
изоляция публичных массивов. Все 129 source inputs до/после совпали,
input mutation отсутствует, схема/данные/геометрия не изменялись. Это доказательство
семантики, не browser timing. [Portable parity evidence](evidence/city-scale-2026-10-16/cooperative-preparation-summary.json)
содержит точные source/output hashes и границы этого proof.

Неизменный `03fc2d724900db506bd0b41d88448f1e3d3beb9936a90effe255040683cd32df`
с тем же server `dae136` прошёл 6/6 затронутых native readiness/FIRSTatomic cases
в Chromium, Firefox и iPhone WebKit, а также три одиночных original probes:
200 Pixel cold 5721,1 мс / RAF p95 10,3 мс / input p95 54,2 мс / steady LT 0;
200 Firefox cold 1377,2 мс; 1000 Firefox cold 2558,8 мс / RAF p95 17,26 мс.
Эти одиночные probes не заменяют новую серию. Road-window planning 5,8 мс
не запустил MEDICAL scene (legitimate SKIP), поэтому не объявляется повтором
прежнего onset 61,115 мс.

После явного handoff и разрешения root выполнено новое восстановление только
owned 55437 из тех же original dumps: counts/statuses/geometry совпали,
read-only audit 0, FORCE/seed/regen не применялись. Отдельная **final-v4 strict36
завершена**: 3 samples × 6 profiles × 200/1000, прежние churn 20/steady 8 с,
strict TRUE. Исторические raw v3RED4 и CBDRED сохранены; фактический результат
и postflight приведены ниже.


## Полная серия v4: фактический итог

Исходная серия 3 samples × 6 profiles × 2 sizes выполнена ровно один раз на
неизменном `03fc2d724900db506bd0b41d88448f1e3d3beb9936a90effe255040683cd32df`.
Ни драйвер, ни качество, ни churn20/steady8s, ни бюджеты/ожидания не менялись.
Сравнение подтвердило browser versions, viewport/DPR/touch/CPU/network,
исходные frozen geometry и sample count. Postflight сохранил точные server
`dae136`, client `afd9646c` и HTML `a2af5ab5` bytes.

**11/12 профилей проходят все бюджеты; три нарушения, strict gate RED.**

- 200 desktop Firefox, sample0: cold 1578,918 мс >1500 мс.
- 200 desktop Firefox, sample1: cold 1509,888 мс >1500 мс.
- 200 desktop Firefox, sample2: cold 1568,199 мс >1500 мс.

Все 36 функциональных сценариев прошли: canonical tasks/geometry, один cold CITY
read, pan/warm/legacy reads0, canvas retention и JS/HTTP errors0.
Медианы ниже не отменяют отдельный RED sample.

| Город / профиль | Cold median, мс: baseline → v4 | RAF p95 median, мс: baseline → v4 | Strict |
|---|---:|---:|---|
| 200 desktop-chromium | 1547 → 1389 | 9.1 → 9.1 | PASS |
| 200 desktop-firefox | 1448 → 1568 | 9.1 → 9.1 | RED |
| 200 desktop-webkit | 1473 → 1364 | 18.0 → 18.0 | PASS |
| 200 pixel-chromium | 6687 → 5752 | 25.6 → 9.4 | PASS |
| 200 iphone-chromium | 6577 → 5754 | 25.6 → 15.8 | PASS |
| 200 iphone-webkit | 1357 → 833 | 18.0 → 19.0 | PASS |
| 1000 desktop-chromium | 2336 → 1524 | 24.4 → 9.9 | PASS |
| 1000 desktop-firefox | 3685 → 1887 | 33.0 → 9.9 | PASS |
| 1000 desktop-webkit | 3812 → 1573 | 30.0 → 19.0 | PASS |
| 1000 pixel-chromium | 15189 → 8136 | 99.9 → 16.5 | PASS |
| 1000 iphone-chromium | 14824 → 8186 | 84.2 → 16.8 | PASS |
| 1000 iphone-webkit | 5409 → 1245 | 38.0 → 18.0 | PASS |

1000 Pixel: cold median 15189 → 8136 мс (-46.4%), tracked RGBA estimate 153762568 → 27230216 B (-82.3%), views 70778 → 14999.
Все 1000 canonical tasks сохранены. RGBA — оценка отслеживаемых Pixi sources,
не измерение VRAM; input до второго RAF — proxy, не полный INP. Отсутствующие
heap/longtask API у Firefox/WebKit остаются N/A, физические устройства не тестировались.
OS/PG caches не объявляются холодными. Холодное открытие 200 Firefox ухудшилось по медиане: 1448 →1568 мс (+8,3%);
это сохранённый RED исходной Node-метрики, который новая методика не переписывает.
Сервисные SQL/JSON/gzip результаты повторно
не запускались: серверные bytes совпали.

[Полная парная сводка36 v4](evidence/city-scale-2026-10-16/final-v4-summary.json)
содержит все sample metrics/report hashes/postflight/границы измерений;
[fresh restore](evidence/city-scale-2026-10-16/final-v4-database-restore.json)
подтверждает original dumps/read-only audit0/точную геометрию.
Исторические v3 и последующие causal RED не удалены. После закрытия own5311 и
браузеров CPU/GPU передан renderer только на ранее одобренный один causal
Firefox200 diagnostic. Самостоятельных повторов профиля или полной серии нет;
общая цель, CI, SCM и выпуск остаются за root.


## Методика cold v2: отдельная парная квалификация Firefox200

В двух диагностических случаях Node cold составил 1561/1520 мс, когда исходные
DOM predicates уже были готовы через 1263–1264/1201–1205 мс от того же начала.
Задержка наблюдения составляла 297–319 мс. Это диагностика, не квалификация;
историческая полная v4 сохраняет RED3 и 11/12 успешных профилей.

Версия 2 меняет только измеритель. Сохраняются исходное начало до focus/Enter,
endpoint `atomic && transitionCount0`, все прежние awaits, quality/life,
queue0/mobility, 3 с прогрева, 8 с steady, input/pan/churn20 и бюджет 1500 мс.
Trusted Enter лишь подтверждает владение новой cold сценой; он не становится
началом длительности. Существующий clockStart RPC даёт browser clock C внутри
Node bracket [N0,N1], первый MutationObserver фиксирует Bready. Сохраняются
нижняя граница Bready−C и верхняя Bready−C+(N1−N0), консервативная по отношению
к измеренной погрешности RPC. Бюджет проверяет верхнюю; прежний Node elapsed
остаётся `legacyColdCityMs`. Новых cold awaits, фиксированного вычитания или
padding нет. DOM microtask не объявляется compositor paint; точность browser
clock около 1 мс раскрывается отдельно.

Наблюдатель требует отсутствия canvas до cold input и отклоняет старую сцену,
чужие token/timeOrigin/city, отсутствующий trusted Enter/readiness и неверные часы.
Сравнение отклоняет смешанные/неизвестные версии и пересчитывает сохранённые
bounds по исходным observations. Public RED→GREEN: 44 checks в двух файлах,
scoped TS/lint PASS. Root и renderer независимо проверили итоговый diff без
открытых замечаний. Runtime03fc и его 369 источников не менялись.

Выполнены ровно **3 baseline053e + 3 candidate03fc** в Firefox200: та же frozen
сцена, viewport 1440×1000/DPR1, local network и прежняя нагрузка. Baseline
записывает фактические deficits с `ENFORCEfalse`, candidate — `ENFORCEtrue`.
Все шесть измерений и сравнение завершились exit0; повторов не было.
Остальные 11 профилей используют прежние консервативные PASS bounds по Node
времени. Новые численные v2 samples для них не заявляются; это не матрица 36 v2.

### Фактический результат парных шести v2

| Версия / sample | Cold lower, мс | Cold upper для бюджета, мс | Погрешность RPC, мс | Старый Node cold, мс |
|---|---:|---:|---:|---:|
| baseline-cold-v2 / 0 | 1403.000 | 1406.057 | 3.057 | 1436.303 |
| baseline-cold-v2 / 1 | 1206.000 | 1210.659 | 4.659 | 1614.986 |
| baseline-cold-v2 / 2 | 1214.000 | 1217.902 | 3.902 | 1624.021 |
| candidate-cold-v2 / 0 | 1373.000 | 1376.859 | 3.859 | 1450.577 |
| candidate-cold-v2 / 1 | 1267.000 | 1271.701 | 4.701 | 1401.739 |
| candidate-cold-v2 / 2 | 1304.000 | 1306.850 | 2.850 | 1403.739 |

Cold v2 median: baseline 1217,9 → candidate 1306,8 мс (+7,3%). Диапазоны
пересекаются; исправление измерителя не объявляется ускорением runtime.
Обе версии прошли 1500 мс во всех трёх samples. Прежние Node значения baseline
1615/1624 мс сохранены рядом с bounds1211/1218 мс: задержка наблюдения видна
и у исходного кода, а не вычитается константой из final. Все шесть functional,
geometry/canonical/request/canvas guards прошли; остальные candidate budgets
тоже PASS. Наблюдатель работает на реальном Firefox/DOM без изменения приложения,
таймеров, worker data или геометрии.

[Portable v2 qualification](evidence/city-scale-2026-10-16/cold-measurement-v2-summary.json)
содержит policy/causal/source/review hashes, raw observations, dual metrics,
paired comparison и точный postflight обоих immutable runtime. По 11 остальным
профилям сохранены прежние консервативные PASS bounds v1; новые численные v2
результаты для них не заявляются. Историческая v4 остаётся 11/12/RED3.
Порог 1500 не повышался, runtime03fc не менялся. CPU/GPU возвращён root;
дополнительных прогонов после этих шести не выполнялось. Общая задача
завершается только после оставшихся SCM/CI/managedrelease проверок.
