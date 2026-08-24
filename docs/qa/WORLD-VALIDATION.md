# Проверка мира новостроек

Этот сценарий проверяет не отдельный sprite и не статический mock, а настоящий
PixiJS-клиент поверх PostgreSQL и серверного генератора Tasktopia.

## Контрольная страна

`npm run seed:world-validation` пересоздаёт только локальную страну
`Федерация Новостроек`. Скрипт отказывается работать с удалённым PostgreSQL.

- 10 городов с `BALANCED`, `DENSE_CORE`, `GARDEN_CITY` и `POLYCENTRIC`
  морфологией;
- 22 района и 88 задач;
- задачи используют только 95 принятых элементов `TASK_BUILDING_CATALOG`, включая 50 V5-новостроек, жилые и городские сервисы;
- платформа каждой задачи совпадает с catalog contract: жилые новостройки используют
  каменную городскую плитку, а обязательные городские службы — свою компактную
  service-площадку; на первых двух стадиях видима только рабочая полоса глубиной
  `3–5` клеток у фасада;
- локальные дороги имеют ширину 3 клетки, коллекторы, магистрали и highway —
  7 клеток;
- после каждого города выполняется `auditWorld`; любой violation завершает seed
  с ошибкой.

Десятый город фиксирует итоговый продуктовый сценарий:

| Район | Состояние | Задачи |
|---|---|---|
| Завершённый центр | завершён | 4 завершены |
| Завершённая набережная | завершён | 4 завершены |
| Строящийся квартал | активен | 2 завершены, 2 в работе |
| Район будущего | планируется | 4 запланированы |

Серверный отчёт сохраняется в
`screenshots/world-validation/report.json`.

## Browser QA

```bash
npm run test:db:start
npm run test:world-validation
npm run test:db:stop
```

Playwright последовательно открывает каждый город, переводит карту в DETAIL и
ждёт не только готовый canvas, но и реальный шаг транспорта и смену кадра
жителя. Для каждого города проверяются:

- атлас заполняет viewport квадратными seeded-блоками до нижней границы,
  восстанавливает terrain из `terrainSeed` по контракту v4 и не загружает
  полноразмерные sprites зданий для миниатюр;
- первый вход в город ограничен detail-окном `120×80`, а кварталы имеют больше
  одного ряда зданий там, где глубина района это позволяет;
- загруженные resident chunks и наличие world objects;
- машины, жители и минимум два светофора;
- отсутствие встречного движения машин и автобусов, автобус идёт по внешней
  правой полосе, а разделитель остаётся в центральной клетке;
- отсутствие физических пересечений транспорта;
- легковые машины, автобусы и жители используют нативный целочисленный масштаб
  `1.0`; легковой canvas равен `24×16`/`16×24`, occupied bounds —
  `22×13`/`13×22`;
  животные и микромобильность не сжимаются ниже manifest-контракта;
- корректная глубина зданий, жителей, деревьев и светофоров;
- движение жителей строго между центрами клеток;
- отсутствие ошибок в browser console.

## Архитектурные release-gates

- viewport `1×20` делает ровно один L2 range read, по одному bounded read дорог/районов/городов/задач/features, один batch UPSERT и один retention pass;
- задержанный HTTP overlay не скрывает уже нарисованный seed terrain и не вызывает повторный terrain materialization;
- создание задачи не выполняет unbounded country-wide spatial SELECT внутри placement/growth;
- `cells_json` и развёрнутый `cell_runs_json` имеют точную двустороннюю parity координат через SQL `EXCEPT` в обе стороны (равенства количества недостаточно), legacy DISTRICT membership остаётся доступным для rollback;
- два worker одновременно claim'ят только одну idempotent command; длинная command обновляет heartbeat и не reclaim'ится;
- bounded timeout возвращает accepted job (`202` HTTP, успешный MCP result), который доступен через оба polling-контракта;
- два Redis-клиента на холодном locator вызывают один builder; timeout, eviction и остановленный Redis дают PostgreSQL fallback;
- насыщенные T- и X-перекрёстки со смешанными очередями CAR/BUS полностью освобождаются за детерминированные 180 секунд, имеют ноль unsafe pairs, не оставляют поперечный хвост в конфликтной зоне при смене фазы и не допускают starvation.
- T/X-тесты строятся из реальных семиклеточных `COLLECTOR`-клеток: runtime
  сохраняет `roadClass`, прямая широкая дорога не становится ложным junction,
  а эффективный all-red измеряет физические границы кузова, а не только центр.

Команды перед production rollout:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:scale
npm run test:world-validation
```

Сырые логи и итоговый proof-summary сохраняются в активном `.agent/plans/.../proof/`; показатели accepted release ниже обновляются только после полного прогона и production smoke.

Для архитектурного релиза 2026-08-21 полный локальный прогон дал 455 passed
unit/integration тестов, 26 passed базовых E2E и 10/10 чистых world-validation
городов. Scale fixture уложился в 9 017 ms на генерацию при бюджете 15 000 ms,
190 ms на холодный viewport и 42 ms на повторный; compact transport уменьшил
wire payload на 74,5%. Пиковый RSS составил 476 MiB при gate 512 MiB.

Повторный release gate 2026-08-22 после дорожного, транспортного и seed-decor
обновления дал 468 passed unit/integration тестов, 26 passed базовых E2E и
2 passed atlas E2E. Оба адресных LOD E2E прошли после исправления непрерывной
target-scale. Все
10/10 городов seed-validation завершили server audit без нарушений. Изолированный
scale fixture: `11 875 ms` генерации, `178 ms` холодный viewport, `41 ms`
повторный viewport, `414 MB` process RSS и `82%` сокращения compact wire.

Финальный release gate 2026-08-23 после исправления gait/source/traffic
контрактов дал `472 passed / 7 skipped` unit/integration и
`27 passed / 6 skipped` базовых E2E. `42` animation families / `126` кадров,
`8` моделей / `24` транспортных ракурса и `1 224` PNG прошли автоматические
gates. Все `10/10` world-validation городов завершили server audit без
нарушений; scale fixture: `11 866 ms` генерации, `233 ms` холодный viewport,
`47 ms` повторный viewport, `417 MB` RSS и `82%` сокращения compact wire.

Release gate 1.20.0 от 2026-08-24 дал `478 passed / 7 skipped`
unit/integration и `27 passed / 6 skipped` базовых E2E. Отдельная фикстура
пересоздала `10/10` городов с `violations: []`; browser-validation прошла все
десять за `1.4 min`. На контрольных кадрах находились 217 машин, 2 автобуса,
116 жителей и 87 светофоров; `wrongWayCars`, `wrongWayBuses` и
`trafficUnsafePairs` равны нулю, максимальное наблюдаемое ожидание — `3959 ms`,
монотонная telemetry зафиксировала 11 163 перехода транспорта через клетки.
Asset gate проверил 167 зданий / 835 стадий, 288 props, 42 animation families
и 8 моделей / 24 ракурса транспорта без нарушений. Scale-сравнение на одной
macOS-машине: изолированный прогон ветки 1.20.0 — `15 415 ms`, `178 ms` cold
chunk, `41 ms` cached chunk, `781 MB` RSS / `156 MB` heap; чистый 1.19.9 — `15 855 ms`, `198/44 ms`,
`790 MB` RSS / `147 MB` heap. Для Node 24 на macOS формализован отдельный RSS
ceiling `850 MB`, поскольку чистый baseline уже резервирует около `790 MB`;
production/CI Linux сохраняет строгий ceiling `512 MB`. Оба профиля также
ограничены generation/chunk budgets: macOS допускает `20 s` из-за scheduler и
виртуализации локальной БД, production/CI Linux сохраняет `15 s`.
`SCALE_GENERATION_BUDGET_MS` и `SCALE_RSS_BUDGET_MB` позволяют задать более
строгие ceilings для конкретного запуска.

## Production rollout 2026-08-24

- Fast-forward release `ace5763` опубликован в `main` и развёрнут штатным
  `deploy/update-server.sh`; атомарный static release —
  `20260824105203-ace5763`, версия runtime — `1.20.0`.
- Перед переключением создан и проверен через `pg_restore -l` custom dump
  `backups/pre-update-2026-08-24-105128.dump` размером `9 741 294` байта.
- `app`, `mcp` и `world` healthy, имеют `0` restart / `OOMKilled=false`; после
  replay занимают около `85/92/75 MiB` при лимитах `1536/768/1536 MiB`. В
  runtime-логах rollout нет `error`, `fatal`, `panic`, `unhandled` или
  `exception`.
- Публичная ревизия `b83eb6992d6e8bf1` доступна с immutable cache. Проверенный
  stage-5 Светлого малоэтажного ЖК возвращает `HTTP 200`, `17 150` байт и
  годовой `Cache-Control: immutable`.
- Forced replay `release-ace5763` завершился с `exit 0`: обработано `9/9`
  production-стран, у каждой `violationsAfter: 0`. Крупнейший «Атуталенд»
  (`3` города / `4` района / `115` задач) отклонил первую несвязную раскладку,
  успешно повторился и опубликовался только после чистого аудита.
- Абсолютный dev-scale gate на текущем VPS не репрезентативен для CI: 1.20.0
  показал `75 494 ms / 729 ms / 171 ms / 806 MB`, а чистый 1.19.9 на том же
  одноразовом Node/PostgreSQL-профиле — `95 630 ms / 3 345 ms / 166 ms /
  696 MB`. Новая генерация быстрее на `21%`, cold materialization — на `78%`;
  cache latency эквивалентна, но dev-container RSS выше на `110 MB`. Реальные
  production runtimes остаются ниже `100 MiB` каждый; CI Linux сохраняет
  контракт `15 s / 512 MB`.

## Production rollout 2026-08-22

- Fast-forward release `ecb1334` опубликован в `main` и развёрнут штатным
  `deploy/update-server.sh` на `5.42.199.122`.
- Перед заменой runtime создан проверенный PostgreSQL custom dump
  `backups/pre-update-2026-08-21-222753.dump` размером `8 995 466` байт.
- Миграция `0019_seeded_area_decor.sql` применена; строк `PARK_DECOR` после
  миграции — `0`.
- Отдельные `app`, `mcp` и `world` контейнеры прошли health; в их логах за
  rollout нет `error`, `fatal`, `panic` или `unhandled`.
- Принудительный replay `release-ecb1334` обработал `7/7` стран с первой
  попытки. Каждый transaction-local audit завершился с `violationsAfter: 0`;
  старый Атуталенд исправил семь найденных нарушений.
- В durable generation queue после replay находятся только `7 COMPLETED`
  jobs. Публичные health, manifest, новый wheat prop и новый vehicle PNG
  отвечают HTTP `200`.

Результат записывается в `screenshots/world-validation/browser-report.json`, а
кадры — в `city-01.png` … `city-10.png`. Отдельный широкий кадр
`final-four-district-city.png` показывает четыре состояния финального города.

## Принятый результат 2026-08-21

- 10/10 городов открылись в DETAIL;
- 10 735 объектов прошли проверку глубины;
- наблюдались 110 машин, 21 автобус, 97 жителей, 29 велосипедистов,
  22 самокатчика, 52 животных и 148 светофоров;
- создано 22 общественных парка для 22 районов; районов без зелёной зоны — 0;
- `wrongWayCars`, `wrongWayBuses`, `trafficUnsafePairs`,
  `worldObjectDepthErrors`, `residentCenterErrors` равны нулю во всех городах;
- жители сменили walk-frame, транспорт увеличил счётчик реальных шагов во всех
  десяти городах;
- console errors: 0.

## Контроль атласа 2026-08-21

- сырой JSON: `536 369` байт вместо `1 514 717` (`−64.6%`);
- gzip API: `50 325` байт вместо `122 871` (`−59%`);
- общий cold-transfer первого открытия: `227 508` байт вместо `297 836`;
- API duration: `279 ms` вместо `315 ms` на той же фикстуре;
- building PNG requests и browser errors: `0`.

## Графический gate

```bash
npm run assets:build
npm run assets:verify
npm run assets:storybook
```

Принятый каталог содержит 50 V5-новостроек, 284 props, 8 транспортных моделей,
12 terrain families и 1 350 runtime PNG. `assets:verify` обязан завершаться без
missing/orphan/contract/style violations и незавершённых стадий.
