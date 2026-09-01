# План переработки CITY → COUNTRY → PLANET

- Статус: проект плана
- Дата: 2026-09-01
- Архитектурный контракт: [ADR 0009](../adr/0009-compact-multiscale-world-contract.md)
- COUNTRY-проекция: [ADR 0008](../adr/0008-country-city-block-glyph-projection.md)
- Хранение и жизненный цикл участка: [ADR 0010](../adr/0010-block-world-storage-and-site-lifecycle.md)
- Анализ выполнен по исходникам на ревизии `dff376201108a275dde168230abd675d9bb32a1c`

## Итог системного анализа

Это не замена набора спрайтов, а миграция пяти связанных контуров:

1. доменная модель квартала и порядок привязки задач;
2. CITY planner, дороги, доступ и транспорт;
3. CITY asset/render scale;
4. COUNTRY-проекция кварталов и планетарного окружения;
5. PLANET geography и общий авиационный runtime.

Главная зависимость направлена снизу вверх:

`Task → BlockSlot → CityBlock → COUNTRY glyph`, а geography направлена сверху
вниз: `PLANET topology → COUNTRY surroundings`. COUNTRY не должен вычислять
океан самостоятельно, а PLANET не должен читать отдельные CITY-спрайты.

Текущий код уже содержит полезную основу:

- `PlannedLotDto block-v3` и `complex-planner.ts` знают группы, слоты, шаблоны и
  семантические улицы;
- `city-generation.ts` хранит логическую ширину дорог `3/7` клеток;
- `WorldCanvas.tsx` централизует большую часть зависимости `CELL_SIZE=8`;
- COUNTRY уже использует versioned disposable overview и semantic miniature;
- routing работает в логических `Cell`, поэтому pixel scale можно отделить без
  пересчёта сохранённых маршрутов.

Главные разрывы:

- `CityBlock` пока не является отдельной долговечной сущностью;
- `PRIVATE` неоднозначен, а `PRODUCTION` отсутствует;
- обязательные сервисы зашиты в `app-service.ts` как пороги 10/20/30 по всем
  задачам и не учитывают кварталы;
- парки/рощи частично публикуются как автоматические world features, хотя в
  новой модели крупный продуктовый объект должен быть задачей;
- CITY связывает данные, camera, hit testing и assets с литералом `8 px`;
- COUNTRY v4 агрегирует старую геометрию блоками `16×16`, а не читает новый
  `CityBlock`;
- старый и новый asset pipeline сейчас сосуществуют в незавершённом рабочем
  дереве, поэтому удаление до cutover опасно.

## Что делать первым

Нельзя начинать с массовой генерации домов или с COUNTRY. Так как старый runtime
будет удалён и все миры обязательно перегенерируются, первым реализуется новый
storage/compiler contract: layout, block, semantic road и placement. После этого
один квартал проходит вертикально через данные, assets, renderer и тест. Такой
порядок не создаёт временную графику для модели, которую затем придётся менять.

## Вертикальные этапы

### Этап 0. Зафиксировать baseline, входные данные и контракты

Результат:

- принять размеры из ADR 0009;
- создать детерминированные fixtures: малый, средний и большой город;
- сохранить baseline CITY/COUNTRY/PLANET, payload, FPS и first-frame;
- зафиксировать conservation contract: task id/number/status/history сохраняются,
  spatial geometry полностью заменяется;
- определить `block-v1` и release stop conditions.

Проверка: существующие тесты зелёные; fixtures воспроизводимы одним seed; старый
renderer остаётся единственным production consumer.

### Этап 1. Storage и layout compiler skeleton

Результат:

- shadow tables `city_layouts`, `district_layouts`, `city_blocks`,
  `task_placements`, `road_networks`, `site_markers`;
- deterministic templates и semantic road RLE;
- компилятор строит один layout без публикации;
- scene cache является disposable и не владеет миром.

Проверка: schema constraints, RLE round trip, одинаковый input checksum,
атомарная активация только READY layout.

### Этап 2. Один CITY-квартал end-to-end

Результат:

- `CITY_RENDER_CELL_PX=4` вынесен из renderer в versioned presentation profile;
- пилотные assets: базовая трава/вода/песок, LOCAL road, sidewalk/corner,
  LOW/MID/HIGH по одному семейству и по пять стадий, человек и автомобиль;
- один `CityBlock` S/M, один semantic road и task-backed building отображаются
  без изменения сохранённых `Cell`;
- nearest-neighbour, hard alpha, корректные pointer bounds и smooth zoom.

Проверка: один и тот же logical fixture даёт те же маршруты при 8 px и 4 px;
pixel screenshot не содержит blur/полупрозрачных краёв.

### Этап 3. Полная модель районов и разнообразных кварталов

Результат:

- библиотека LOW_RISE/NEW_BUILD/MIXED/COMMERCIAL/CIVIC/PRODUCTION/GREEN/TRANSPORT;
- S/M/L/XL templates, slots, пустое пространство и pedestrian graph;
- новые границы районов строятся из кварталов;
- `PRIVATE` преобразуется в `LOW_RISE`, добавляется `PRODUCTION`;
- старые spatial coordinates намеренно не сохраняются.

Проверка: каждый template проходит occupancy/access audit; соседние блоки не
повторяются более двух раз; 100 seed дают детерминированные валидные layouts.

### Этап 4. Planner дорог и транспорта

Результат:

- шаблоны S/M/L и block kinds из ADR;
- последовательное заполнение `block.sequence/slot.order`;
- ровные centerline-дороги, полные перекрёстки, переходы, угловая плитка и
  корректные окончания;
- building setbacks, pedestrian access и отсутствие наложений;
- районные зелёные коридоры и расстояние между районами;
- composited/batched terrain и road layers вместо объекта на клетку.

Проверка: property tests связности и непересечения; каждый вход достигает
тротуара; машина не входит в sidewalk; 100 seed не создают тупик без корректного
road cap.

### Этап 5. Задачи, zoning, ruins и relocation

Результат:

- универсальный policy engine вместо порогов в `app-service.ts`;
- районные пороги 8/12/16/24 и городские 6/12/18/24/30/36;
- парк, озеро, parking, civic, production и transport являются task-backed;
- сервисные задачи не входят в собственный milestone counter;
- special-block выбирается по счётчику, geography, доступу и типу района;
- удаление создаёт footprint-compatible `RUINED` marker;
- перенос сохраняет старый `RELOCATED` marker, ведущий к основной задаче;
- отдельная cleanup/redevelopment задача освобождает занятый marker-ом slot.

Проверка: table-driven tests всех границ `threshold-1/threshold/threshold+1`,
повторная команда не создаёт дубликат, delete/move атомарны, marker chains
запрещены, несовместимая география выбирает fallback.

### Этап 6. Полный CITY catalog и runtime

Результат:

- минимально 6 LOW, 8 MID, 6 HIGH, 4 CIVIC, 4 COMMERCIAL, 6 PRODUCTION
  законченных семейств; каждое имеет пять стадий;
- каждое семейство имеет два ruin-варианта и relocated mask/metadata;
- отдельные park/lake/parking/transport assets;
- вариативность roof detail детерминирована seed и не меняет footprint;
- движение людей, машин и автобусов работает на общих логических маршрутах;
- desktop/mobile получают одинаковый мир, но разные camera fit limits.

Проверка: asset verifier, catalog audit, construction continuity, screenshots
трёх размеров города и browser/network/console QA.

### Этап 7. COUNTRY v5

Результат:

- один `CityBlock` превращается в один `8×8` glyph;
- city silhouette сохраняет реальные относительные координаты блоков;
- океан/суша/соседняя страна приходят из PLANET topology;
- airports и специальные кварталы читаемы без CITY geometry;
- static terrain и city glyph layer компонуются один раз, динамика вынесена.

Проверка: один и тот же block fixture совпадает по типу и форме CITY/COUNTRY;
остров, береговая и континентальная страна не получают ложный океан.

### Этап 8. PLANET и общая авиация

Результат:

- PLANET terrain остаётся `8×8`, города — компактные `1×1`/`2×2` знаки;
- COUNTRY использует тот же planet ownership/coast contour;
- один aircraft engine обслуживает PLANET и COUNTRY;
- маршруты airport↔airport и off-screen↔airport, ориентация, скорость и sprite
  совпадают; renderer предоставляет только projection/camera adapter.

Проверка: детерминированные маршруты, вход/выход за экран, отсутствие teleport,
одинаковая физика при разном zoom и смене режима.

### Этап 9. Полная регенерация, cutover и удаление старого runtime

Результат:

- shadow-build `block-v1` layouts для всех существующих миров;
- сохранение task ids/numbers/status/history при полном пересоздании geometry;
- maintenance window, DB snapshot и атомарная активация новых layouts;
- обновление API/QA/asset docs;
- старые generator, renderer, adapters и assets удалены из новой revision;
- старые spatial tables удаляются только после observation window.

Проверка: 100% стран READY, conservation audit, production-like regeneration,
snapshot restore rehearsal, полная regression matrix и наблюдение после deploy.

## Разделение на задачи/MR

| № | Независимый результат | Зависит от |
| ---: | --- | --- |
| 1 | Contracts, fixtures и conservation rules | — |
| 2 | Block storage + semantic road storage + compiler skeleton | 1 |
| 3 | CITY pilot block и минимальный asset pack | 2 |
| 4 | District/block template library | 2, 3 |
| 5 | Road/transport planner | 4 |
| 6 | Milestone policy + task-backed areas + site lifecycle | 4, 5 |
| 7 | Полный CITY catalog/runtime/mobile | 5, 6 |
| 8 | COUNTRY v5 block glyph projection | 4, 7 |
| 9 | PLANET continuity + shared aircraft engine | 8 |
| 10 | Full regeneration, cutover и old-runtime removal | 2–9 |

После storage skeleton часть asset pilot можно готовить параллельно с template
library. COUNTRY нельзя начинать до стабильного block contract; массовый catalog —
до принятия pilot; production cutover — до 100% успешной shadow regeneration.

## Тестовые данные и ракурсы

Фиксируются три страны:

1. островная — океан со всех сторон;
2. береговая — океан только с двух сторон, река и горы;
3. континентальная — соседняя суша слева/справа, без ложной воды.

В каждой проверяются три города:

1. малый LOW_RISE: 2 района, 2–4 квартала;
2. средний MIXED/NEW_BUILD: 4 района, park/civic;
3. большой: минимум 6 районов, PRODUCTION и transport.

Обязательные viewport: desktop `1440×900`, tablet `1024×768`, mobile
`390×844`. Для каждого режима сохраняются initial fit, один средний zoom и
максимально допустимый zoom. Переход COUNTRY→CITY всегда открывает CITY на
максимальном отдалении, при котором его bounds помещаются в доступный viewport.

## Нефункциональные ворота

- после прогрева pan/zoom: p95 frame ≤ `16.7 ms` desktop и ≤ `22 ms` mobile;
- во время непрерывного pan/zoom нет main-thread long task > `50 ms`;
- статический terrain/road слой не создаёт display object на каждую клетку;
- compressed CITY scene без immutable atlas ≤ `1.5 MB`, COUNTRY ≤ `250 KB`,
  PLANET ≤ `150 KB` на больших fixtures;
- первый осмысленный кадр ≤ `1.5 s` desktop и ≤ `2.5 s` mobile в принятом
  production-like профиле;
- ни один raster asset не масштабируется с linear filtering;
- console errors и failed map requests равны нулю.

Бюджеты измеряются сначала на baseline-машине и фиксируются в QA-отчёте. Если
аппаратная вариативность не позволяет абсолютный CI gate, дополнительно действует
условие: новая версия не хуже baseline более чем на 10%.

## Риски и меры

| Риск | Мера |
| --- | --- |
| литерал `8` смешивает данные и пиксели | presentation profile, targeted search, dual-scale tests |
| два источника истины для кварталов | `CityBlock` canonical; COUNTRY только disposable projection |
| milestone создаёт рекурсию/дубликаты | отдельный eligible counter и idempotency key |
| массовая графика не подходит по углу | пилот 3 семейств + автоматический geometry verifier до batch |
| дороги выглядят ровно, но routing разорван | semantic graph audit до raster compose |
| существующие города меняют задачи | preserve ids/status/order; shadow migration |
| удаление assets ломает rollback | удалять только в задаче 10 |
| COUNTRY снова тормозит | один static composite + bounded dynamic sprite layer |

## Критерий готовности всей программы

Работа завершена только когда новые и существующие миры открываются во всех трёх
режимах, CITY помещается в initial fit, география непрерывна, транспорт движется
по общим правилам, задачи детерминированно занимают кварталы, performance budgets
пройдены на desktop/mobile, rollback проверен, а старый путь удалён отдельным
финальным изменением.
