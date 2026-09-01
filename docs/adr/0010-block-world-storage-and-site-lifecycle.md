# ADR 0010: хранение квартального мира и жизненный цикл участка

- Статус: принято; shadow storage этапа 1 реализован в Task #11
- Дата: 2026-09-01
- Связан с: [ADR 0009](./0009-compact-multiscale-world-contract.md)

## Контекст

Новый CITY несовместим с поклеточной старой генерацией. После релиза все страны
должны быть полностью пересобраны: районы получают новую структуру, город состоит
из кварталов, а дороги выводятся из семантической сети.

Текущее хранение дублирует производные клетки: район хранит `cells_json` и
`lots_json`, дороги материализуются в `roads_v3`, surfaces и chunk payload также
могут содержать поклеточные данные. В проекте уже есть compact runs, но они всё
равно кодируют результат rasterization, а не смысл дороги.

При удалении задачи сейчас строка `tasks_v3` физически удаляется, lot становится
vacant, а для здания создаётся общий `RUIN/demolished-lot`. Этого недостаточно для
семейного спрайта руин и маркера переноса, который должен открывать действующую
задачу.

## Решение

### 1. Breaking world version

Новый runtime принимает только `generatorVersion = block-v1` и новую world scene
schema. Старые `square-v7`, `block-v3`, `roads_v3` и поклеточные CITY placements
не читаются production renderer-ом после cutover.

Задачи, города, районы, статусы, номера, связи, документы и история работы
сохраняются. Полностью пересоздаются только пространственные данные:

- расположение и границы районов;
- кварталы и слоты;
- размещение задач;
- дорожная сеть, тротуары и переходы;
- terrain overrides, transport sites и COUNTRY projections.

### 2. Каноническое хранение

#### `city_layouts_v1`

Одна опубликованная версия геометрии города:

- `id`, `country_id`, `city_id`;
- `generator_version`, `seed`, `revision`, `checksum`;
- `status = GENERATING | VALIDATING | READY | ACTIVE | SUPERSEDED | FAILED`;
- `bounds`, `created_at`, `updated_at`, `activated_at`.

У города ровно один `ACTIVE` layout. Новый layout строится отдельно и становится
активным атомарно только после полного аудита.

#### `district_layouts_v1`

- `layout_id`, `district_id`, `sequence`, `archetype`;
- coarse `bounds` и при необходимости компактная boundary mask;
- параметры роста и список block ids не дублируются.

Район определяется объединением принадлежащих ему кварталов. Полный массив клеток
района не является источником истины.

#### `city_blocks_v1`

Одна строка на квартал:

- `id`, `layout_id`, `district_id`, `sequence`;
- `kind`, `template_key`, `template_version`, `variant`;
- `origin`, `width`, `height`, `seed`, `status`;
- `parameters_json` только для отклонений от шаблона;
- `summary_json` для COUNTRY-проекции.

Слоты, внутренние дорожки и базовое озеленение детерминированно выводятся из
`template_key + version + variant + seed`. Они не копируются в каждую строку.

#### `task_placements_v1`

Активное размещение задачи:

- `(layout_id, task_id)` уникален внутри ревизии; одна и та же задача может
  присутствовать в ACTIVE и строящейся shadow-ревизии;
- `layout_id`, `block_id`, `slot_key`;
- `building_family`, `facade_variant`, `construction_stage`;
- `footprint_override` только для special buildings;
- `placed_at`, `updated_at`.

Один task имеет не более одного активного placement. Один slot имеет не более
одного активного placement или site marker.

#### `road_networks_v1`

Дорога хранится графом, не клетками:

- nodes: `id`, `x`, `y`, junction/terminal/gateway kind;
- segments: `id`, `from_node`, `to_node`, `road_class`, `purpose`, `width_cells`;
- geometry: ортогональная polyline как стартовая точка и RLE-команды
  `N/E/S/W + length`;
- transport metadata: lane profile, speed class, bus permission.

Road cells, masks, borders, sidewalks, corners, crosswalks и road caps являются
результатом rasterization. Они создаются при сборке scene/chunk и могут жить
только в disposable cache.

#### Terrain и surfaces

- базовый terrain выводится из geography seed и block template;
- сохраняются только sparse overrides и special area boundaries;
- тротуары вокруг улиц и кварталов выводятся из road/block contracts;
- нестандартные дорожки, площади и парковки хранятся семантическими rect/polyline
  примитивами;
- compact cell runs используются только в scene cache или сетевом payload, но
  не как каноническая модель дороги.

#### Scene cache

`CITY`, `COUNTRY` и `PLANET` получают versioned disposable snapshots по
`layout.revision + assetRevision`. Cache может хранить compact runs или бинарные
чанки и полностью удаляется без потери мира.

### 3. Разнообразие и логика кварталов

Разнообразие задаётся библиотекой проверенных шаблонов, а не случайным разбросом
зданий. Каждый шаблон имеет фиксированные slots, pedestrian graph, допустимые
типы зданий и COUNTRY summary.

Минимальная библиотека v1:

| Семейство | Варианты |
| --- | --- |
| LOW_RISE | ряд, две короткие линии, L-форма, дома вокруг общего сада |
| NEW_BUILD | две плиты, П-двор, закрытый двор, башни с общей площадкой |
| MIXED | фасадный ряд + двор, два назначения, угловой civic slot |
| COMMERCIAL | торговый фронт, рынок + parking, офисный двор |
| CIVIC | школа/сад с площадкой, клиника, администрация, спорт |
| PRODUCTION | цех + двор, склады рядами, завод + service yard |
| GREEN | парк, pocket park, озеро, площадь |
| TRANSPORT | bus terminal, rail station, airport compound |

Инварианты:

- соседние кварталы не используют один template/variant более двух раз подряд;
- один facade family не занимает более 40% квартала и более двух соседних
  frontage slots;
- каждый обычный квартал имеет 10–30% незастроенного пространства;
- park/lake/parking заменяют целый квартал либо явный slot — не рисуются поверх
  случайного жилого блока;
- pedestrian graph каждого занятого slot связан с публичным sidewalk;
- road graph района связан с городским collector;
- вариативность seed не меняет footprint, collision и task identity.

### 4. Состояния участка

Пять стадий строительства сохраняются без изменений:

`PLANNING → STARTED → IN_PROGRESS → TESTING → COMPLETED` соответствует visual
stage `1 → 2 → 3 → 4 → 5`.

`RUINED` и `RELOCATED` — состояния участка после выхода активной задачи, а не
шестая/седьмая стадия здания.

#### `site_markers_v1`

- `id`, `layout_id`, `block_id`, `slot_key`;
- `kind = RUINED | RELOCATED`;
- snapshot: former task id/number/title, building family, last stage;
- `target_task_id` только для `RELOCATED`;
- `asset_variant`, `created_at`, `cleared_at`.

Marker владеет старым slot. На него нельзя поставить новую задачу, пока отдельная
задача очистки/перестройки не освободит участок.

#### Удаление задачи

Одна транзакция:

1. читает placement и визуальный snapshot;
2. создаёт `RUINED` marker в том же slot;
3. удаляет active placement;
4. выполняет действующую продуктовую семантику удаления задачи;
5. увеличивает layout/world revision.

Даже если основная строка задачи удалена, marker остаётся самодостаточным и не
имеет обязательного FK на неё.

#### Перенос задачи

Одна транзакция:

1. резервирует новый совместимый slot;
2. переносит active placement той же канонической задачи;
3. создаёт `RELOCATED` marker на старом месте;
4. marker хранит прямой `target_task_id` на каноническую задачу;
5. публикует одно событие с old/new bounds.

При нажатии marker открывает основную задачу и при необходимости переводит камеру
к новому placement. Цепочки marker→marker запрещены. Если target позже удалён,
ссылка становится недоступной, но исторический marker остаётся.

### 5. ТЗ на графику состояний

Каждое building family обязано иметь:

- пять construction stages; stage 1–2 могут собираться из проверенных общих
  foundation/construction компонентов;
- законченные stage 3–5;
- минимум два `ruin`-варианта, совместимых с footprint и anchor;
- маску/metadata для runtime-вида `relocated`.

Требования к `ruin`:

- тот же frontal-top угол, palette и pixel density;
- узнаваемый материал и часть силуэта исходного family;
- непрозрачность не выходит за footprint и южнюю facade reservation;
- высота руин существенно ниже stage 5;
- без огня, дыма и анимации по умолчанию;
- варианты: свежие обломки и заросший/старый участок;
- hard alpha, без blur, без запечённой травы/дороги/тротуара.

`relocated` не требует отдельного полного AI-спрайта для каждого здания. Renderer
использует silhouette/mask последней стадии, пониженную контрастность и единый
маленький знак переноса. Текст «Перенесено» и ссылка являются UI overlay, а не
частью PNG.

Verifier проверяет footprint, anchor, palette, alpha, максимальную высоту,
отсутствие baked ground и связь всех assets с manifest entry.

## Release и обязательная регенерация

1. Остановить пространственные mutations, task CRUD оставить read-only.
2. Сделать проверенный DB snapshot.
3. Создать `block-v1` layouts в shadow tables для всех стран.
4. Для каждой страны проверить task count/ids, block/road connectivity, slot
   occupancy, assets и COUNTRY projection.
5. Если хотя бы одна страна не прошла audit, cutover запрещён.
6. Развернуть новый runtime и атомарно активировать READY layouts.
7. Очистить scene caches, выполнить CITY/COUNTRY/PLANET smoke и только затем
   вернуть mutations.
8. Старый runtime-код и assets отсутствуют в новой production revision. Старые
   spatial tables удаляются отдельной post-observation миграцией.

Во время отсутствия ACTIVE `block-v1` layout map endpoint возвращает явное
`WORLD_REGENERATION_REQUIRED/IN_PROGRESS`, а UI показывает прогресс. Смешанная
сцена из старой и новой геометрии запрещена.

Rollback возможен только восстановлением предрелизного snapshot и предыдущей
application revision. Runtime dual-read и долгоживущие compatibility adapters
не поддерживаются.

## Доказательства

- schema/constraint tests всех уникальностей и FK;
- encode/decode property tests road polyline RLE;
- rasterization tests roads/surfaces из semantic primitives;
- deterministic regeneration: одинаковый input даёт одинаковый checksum;
- task conservation: id/status/order/count до и после совпадают;
- delete/relocate transaction tests и отсутствие marker chains;
- asset verifier для stages 1–5, ruin и relocated mask;
- full shadow regeneration и audit всех production countries до cutover;
- восстановление snapshot в rehearsal environment.

## Отвергнутые варианты

- Продолжать хранить road cells как canonical rows: объём и дублирование остаются.
- Хранить весь город одним JSONB: плохая конкурентность, индексация и частичные
  обновления.
- Хранить каждый slot отдельной строкой без необходимости: шаблон уже полностью
  задаёт пустые slots; нормализуется только occupancy.
- Оставить runtime adapter старого мира: удваивает код и мешает удалить старую
  реализацию.
- Делать ruin шестой стадией задачи: задача уже удалена и больше не владеет
  участком.
