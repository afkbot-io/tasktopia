# Architecture notes

## Current boundary

`roads_v3` хранит только клетки асфальта. `ROAD_WIDTH` равен 2 для local/collector и 3 для arterial/highway. Renderer добавляет curb на каждое внешнее ребро road-cell. Пешеходная сеть, вход здания и frontage не материализованы; существующий audit допускает расстояние здания до дороги до двух клеток.

## Target boundary

Каждая улица становится профилем вокруг immutable centerline:

```text
sidewalk | lane A | lane B | sidewalk
```

- local: 2 полосы движения + по одному sidewalk-ряду;
- collector/arterial: 2 полосы, островки/остановки только по правилам профиля;
- highway вне города: без sidewalk, с shoulder/barrier;
- bridge: две полосы + bridge-side, sidewalk только у городского моста.

Здание хранит `entranceCell`. От entrance до sidewalk строится `pedestrianAccess`: pavement для городской застройки или `path-brown` для частного/паркового участка. Автомобильная доступность относится к parcel driveway, а не требует ставить фасад непосредственно на asphalt.

### Street profiles on the 8 px grid

| Тип | Поперечный профиль | Машины | Пешеходы | Curb |
|---|---|---|---|---|
| pedestrian path | `path-brown` ×1 | нет | да | нет |
| local/collector | sidewalk ×1 + asphalt lanes ×2 + sidewalk ×1 | по одной полосе в каждую сторону | да | только asphalt↔sidewalk, приглушённый |
| arterial | sidewalk ×1 + asphalt lanes ×4 + sidewalk ×1 | 2+2 | да | asphalt↔sidewalk |
| highway вне города | shoulder ×1 + asphalt lanes ×4 + shoulder ×1 | 2+2 | нет | barrier/shoulder вместо curb |

Автомобильная полоса равна одной клетке, потому что существующий car sprite имеет ширину 8 px. Нечётная ширина asphalt запрещена для двустороннего профиля без явной median-клетки.

### Generation pipeline

1. Выбрать district envelope и 1–2 gateway к существующему graph.
2. Построить immutable road centerline graph; район с >8 задачами получает минимум один цикл или два независимых выхода.
3. Развернуть centerline в street profile вместе с sidewalks; проверить весь corridor.
4. Нарезать parcels только после инфраструктуры и зарезервировать setback.
5. Выбрать building entry и конкретный manifest entrance.
6. Найти A* `entrance→sidewalk` по pavement/path, максимум 6 клеток и два поворота. Если путь невозможен — сменить позицию/лот/здание, затем расширить район; публикация недоступного здания запрещена.
7. Для parking/gas/fire добавить отдельный driveway→lane.
8. Опубликовать road, sidewalk, path, parcel и task одной транзакцией.
9. При закрытии района заморозить все его клетки; будущий routing использует их как obstacle кроме gateway nodes.

### Lightweight life simulation

- Server хранит графы и demand, но не рассылает координаты каждого NPC.
- Client симулирует только загруженные чанки: fixed tick 10 Hz, interpolation на render frame.
- Cars используют directed lane graph, резервируют 1–2 следующие клетки и меняют horizontal/vertical sprite без rotation.
- Walkers используют sidewalk/path graph; на asphalt выходят только через crosswalk nodes.
- Для города на 100 задач стартовый бюджет: 20–30 машин и 40–80 людей в viewport, с object pooling.
- Источник поездок — completed building tags; construction stages создают рабочих и служебные машины.

## District visualization

Граница района по умолчанию скрыта. Кнопка «Районы» включает полупрозрачный слой; hover/selection показывает только соответствующий контур и лёгкую заливку. Цвет остаётся в карточке/бейдже района и не конкурирует с дорогой.

## Alternatives

- Всегда видимые тонкие границы: сохраняют контекст, но создают визуальный шум и выглядят как техническая сетка.
- Только здания вплотную к asphalt: проще проверять, но уничтожает дворы, площади и реалистичные входы.
- Свободное движение людей без графа: визуально дёшево, но персонажи будут проходить через здания и газоны.

## Rollout

1. Добавить data-only mobility graph и аудит без анимации.
2. Перевести renderer на road profiles/sidewalks и entrance paths.
3. Добавить районный overlay toggle.
4. Подключить deterministic walkers/cars к графам и viewport pooling.

Rollback: старые `roads_v3` остаются источником centerline/corridor; новые sidewalk/path слои можно отключить feature flag.
