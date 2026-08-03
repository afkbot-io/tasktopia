# Architecture

## Boundary before v6

Мир хранит terrain и road cells; renderer сам рисует яркий curb на каждой внешней стороне asphalt. Building footprint проверяется по расстоянию до любой road cell, хотя каталог уже знает entrances. District border постоянно видим. Roadside features и district archetype не являются доменными сущностями.

## Implemented boundary

### Published spatial layers

Одна клетка 8×8 px остаётся атомарной. Chunk содержит независимые слои:

- `terrain`: grass, water, sand, clay, rock, forest;
- `roads`: asphalt lane cells с `roadClass`, `axis`, `networkId`;
- `surfaces`: sidewalk, brown path, driveway, shoulder, crosswalk;
- `districts`: geometry, state, archetype, gateways;
- `buildings`: task-owned building, footprint, sprite, stage, entrance cell;
- `worldFeatures`: signs, stops, roadside service areas and decor;
- `mobility`: compact lane/walk graph edges, вычисляемые по published cells.

World feature существует отдельно от задачи. Поэтому табличка, остановка или межгородская АЗС не маскируются под пользовательскую задачу. Городская task-АЗС использует тот же visual asset, но остаётся task-owned.

### Street profiles

Centerline никогда не является итоговым изображением. Генератор атомарно разворачивает его в corridor:

| Class | Profile |
| --- | --- |
| path | brown path ×1, no cars, no curb |
| local/collector | sidewalk ×1 + asphalt ×2 + sidewalk ×1 |
| arterial | sidewalk ×1 + asphalt ×4 + sidewalk ×1 |
| highway outside city | shoulder ×1 + asphalt ×4 + shoulder ×1 |
| bridge | side/guard ×1 + asphalt ×4 + side/guard ×1 |

У curb нет собственного непрерывного ряда. Он рисуется приглушённой границей только между asphalt и sidewalk/shoulder. На path curb отсутствует.

### Entrances and access

1. Parcel placement выбирает ориентацию и конкретный catalog entrance.
2. Вход переводится из local footprint coordinate в world cell.
3. Если вход примыкает к sidewalk, доступ готов.
4. Иначе A* строит `path` или `driveway`: максимум 6 клеток и 2 поворота, без зданий/воды/SEALED cells.
5. Fire, parking and gas station требуют driveway до lane плюс pedestrian path до sidewalk.
6. Если ограничения не выполнены, пробуются orientation, parcel и building variant; затем district expansion. Частичная публикация запрещена.

### District morphology

`CityMorphology` — детерминированное распределение, создаваемое из seed:

- `BALANCED`: mixed 35%, private 30%, new-build 25%, civic/commercial 10%;
- `DENSE_CORE`: new-build/mixed доминируют возле gateway/core;
- `GARDEN_CITY`: private и low-rise доминируют, один компактный центр;
- `POLYCENTRIC`: 2–3 локальных mixed/civic центра.

`DistrictArchetype`:

- `NEW_BUILD`: 60–75% apartment/high-rise/mixed-use, 15–25% retail/services, до 15% civic/decor;
- `PRIVATE`: 65–80% cottages/duplex/townhouse, 10–20% convenience retail, до 15% service/decor;
- `MIXED_URBAN`: 40–60% mid-rise/mixed-use, остальное retail/civic;
- `COMMERCIAL`: shops, mall, offices, parking, gas; ограниченное жильё;
- `CIVIC`: police, fire, clinic, school, administration плюс совместимое жильё/retail.

Район получает archetype при создании и не меняет его после публикации первой задачи. Выбор учитывает соседей: тот же residential archetype не повторяется более двух раз подряд; новый archetype должен быть совместим с city morphology и unmet civic needs. Primary residential family задаёт большинство, но не монокультуру.

### Building selection

Скоринг кандидата:

```text
semantic match
+ district archetype weight
+ unmet city service need
+ density/footprint fit
+ frontage compatibility
+ novelty in district/city
- recent repetition
- incompatible neighbour penalty
```

Явный `buildingTypeId` всегда имеет приоритет и валидируется. Автовыбор civic здания разрешён только для совместимой семантики задачи или общего task без конкретного типа; для гарантии coverage fixtures/API создают системную рекомендацию, но не переименовывают пользовательскую задачу. На порогах 10/20/30 задач город повышает веса clinic/fire/police; designated CIVIC/MIXED district получает эти задания первым.

### Density

- NEW_BUILD: setback 0–1 cell, общая линия фасада, shared pedestrian forecourt допустим.
- PRIVATE: side gap 1 cell, front path 1–4 cells; задние дворы могут соприкасаться.
- MIXED/COMMERCIAL: facade-to-sidewalk 0–1, service access с тыла.
- Sprite overhang не участвует в collision; footprint и reserved clearance участвуют.

### Sealed districts

При переходе в SEALED сохраняются road/surface/building cell sets и gateway nodes. Любой будущий planner видит их hard obstacles. Межрайонная дорога может подключаться только к gateway, но не прокладываться через интерьер.

### Intercity lifecycle

1. Новый city reserve размещается с growth buffer.
2. Route planner соединяет ближайший network portal обходя water/city reserves; через воду публикует bridge profile.
3. На подходе к city создаются знак и bus-stop pocket, связанные с опубликованной дорожной геометрией.
4. Если connector длиннее порога, у средней трети выбирается сухой прямой участок. Рядом публикуется service area: крупная АЗС, parking, lights, bins, trees; driveway соединяется с highway.
5. World feature placement детерминирован и проверяется так же строго, как task placement.

### Client mobility

Сервер отдаёт статические клетки. Клиент симулирует только видимые chunks с интерполяцией Pixi ticker и жёсткими лимитами агентов. Машины используют road graph, люди sidewalk/path graph; при `prefers-reduced-motion` симуляция останавливается.

## Alternatives considered

- Генерировать район целиком ИИ: отклонено из-за недетерминированности, цены и сложной пространственной валидации.
- Все сервисы как декоративные здания: отклонено для города, потому что task-building должен сохранять смысл; допустимо только для world roadside features.
- Свободная ходьба по grass: отклонено, потому что ломает читаемость тротуаров и collision.
- Один архетип на весь город: отклонено как визуально монотонное; morphology задаёт веса, а районы — локальную идентичность.

## Rollout and rollback

- Новые поля chunk DTO добавляются аддитивно; renderer может временно игнорировать layers.
- Generator version повышается до `square-v6`; старый seed можно пересобрать, пользовательские task records сохраняются.
- Если migration world-features невозможна, они безопасно регенерируются по seed и city portals.
