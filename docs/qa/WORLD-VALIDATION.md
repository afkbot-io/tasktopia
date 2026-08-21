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
- локальные дороги имеют ширину 2 клетки, коллекторы, магистрали и highway —
  3 клетки;
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
- легковые машины имеют масштаб `1.2`, автобусы — `1.0`, жители — `0.8`;
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
- регулируемый четырёхсторонний поток из 24 машин имеет ноль unsafe pairs и ни одна машина не ждёт больше 60 секунд; въехавший на красном хвост освобождает узел.

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
