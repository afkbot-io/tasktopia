# План расширения Pixel City Pack V4

**Версия:** 1.0
**Статус:** план на генерацию (runtime PNG + manifest)
**Цель:** довести разнообразие городов до уровня классических city-builder-ов, добавить уникальные объекты для TEMPLATE-города и 1-на-город, увеличить в 2 раза число вариантов каждой категории зданий, разнообразить заправки, фонари и парки.

---

## 1. Краткое состояние пака (V4)

Текущий runtime `assets/pixel-city-pack-v4/runtime` собирается из двух источников:

- **V3 base** — скопированные каталоги `buildings`, `props`, `tiles`, `vehicles`.
- **V4 procedural** — детерминированный Python-скрипт `scripts/build-pixel-city-pack-v4.py`, который генерирует terrain, transitions, часть props, транспорт и новые здания из `assets/pixel-city-pack-v4/catalog/generated-buildings.json`.

| Категория | Сейчас (V4) | Цель (×2) | Добавить |
|---|---|---|---|
| HOUSE | 16 | 32 | 16 |
| COMMERCIAL | 12 | 24 | 12 |
| CIVIC | 12 | 24 | 12 |
| HIGHRISE | 6 | 12 | 6 |
| Props | 86 | ~120+ | уличные фонари, парковая мебель, деревья, большие формы |
| AREA (parks/groves) | 2 логических типа | 6+ типов | большие парки, рощи, ботанический сад |
| Unique landmarks | 1 (`highrise-landmark`) | 4 | TEMPLATE-observatory, ferris-wheel, megatall, monument |

**Правила, которые нельзя ломать:**

- Базовая клетка `8×8 px`.
- Любой runtime PNG кратен 8 по сторонам.
- Каждое здание имеет ровно 5 стадий с одинаковым `spriteSize`, `footprint`, `anchor`, `entrances`.
- `anchorPx` — нижний центр спрайта.
- `runtimeAI: false`: все PNG готовятся заранее, не генерируются в браузере.
- Контракт в `manifest.json` — единственный источник истины для каталога.

---

## 2. Как добавлять новые ассеты

Краткая инструкция для исполнителя:

1. Для **генерируемых зданий** добавить JSON-строку в `assets/pixel-city-pack-v4/catalog/generated-buildings.json`.
2. Добавить/расширить функцию отрисовки стиля в `scripts/build-pixel-city-pack-v4.py` (например, `draw_finished_house`, `draw_gas_station`, `draw_tower`).
3. Для **пропов** добавить функцию в `build_manifest → generated_props` и прописать `footprintCells`/`anchorPx`.
4. Для **area/парков** изменить код генерации в `AppService.publishDistrictGreenFeature` (размеры, assetKey, набор декораций), но сами area-спрайты не нужны — area рисуется тайлами `path-brown` + `MEADOW`.
5. Запустить:
   ```bash
   npm run assets:setup
   npm run assets:build
   ```
6. Проверить `npm run typecheck` и открыть `screenshots/pixel-city-v4-expanded-assets.png`.

---

## 3. TEMPLATE-город — большое уникальное здание

Сейчас TEMPLATE-город использует `highrise-landmark`. Предлагается выделить для него собственный архетип — **«Башня знаний / Observatory»** — символ «стартерового» эпика, который видно издалека.

### `starter-city-observatory`

| Поле | Значение |
|---|---|
| key | `starter-city-observatory` |
| label | «Башня знаний» |
| category | `CIVIC` (или новый `LANDMARK`, если ввести) |
| platform | `SERVICE` |
| rarity | `UNIQUE` |
| spriteSize | `[64, 112]` (8×14 клеток) |
| footprintCells | `[8, 8]` |
| anchorPx | `[32, 112]` |
| estimates | `[6]` |
| maxPerCity | 1 |
| maxPerDistrict | null |
| serviceRole | `knowledge-service` |
| ruleIds | `UNIQUE_SERVICE` |
| entrances | `[{ side: "S", offset: 4 }]` |
| tags | `civic`, `service`, `landmark`, `starter` |

**Визуальное описание:**

- Основание 8×8 клеток — широкая ступенчатая терраса из светлого камня.
- Центральный ствол 4×4 клетки — стеклянная библиотечная башня с видимыми этажами.
- Верхний ярус — купол-обсерватория с антеннами и меридианным кольцом.
- Свет сверху-слева, тёмный сине-серый контур, приглушённые акценты синего/золотого.
- 5 стадий: строительная площадка → фундамент террасы → каркас башни → стеклянный ствол + строительные леса → готовый купол.

**В коде:** заменить `highrise-landmark` в `publishTemplateCityLandmark` на `starter-city-observatory` или добавить выбор по seed (TEMPLATE всегда observatory, иногда другой landmark).

---

## 4. Уникальные объекты 1 на город

Предлагается ввести метод `publishCityLandmark` — после публикации дорожной сети один раз за город пытается разместить один из трёх редких ландмарков. Каждый город получает максимум один, выбирается по seed.

### 4.1. Колесо обозрения — `landmark-ferris-wheel`

| Поле | Значение |
|---|---|
| key | `landmark-ferris-wheel` |
| label | «Колесо обозрения» |
| category | `COMMERCIAL` |
| platform | `STONE` |
| rarity | `RARE` |
| spriteSize | `[64, 88]` |
| footprintCells | `[8, 8]` |
| anchorPx | `[32, 88]` |
| estimates | `[6]` |
| maxPerCity | 1 |
| maxPerDistrict | 1 |
| serviceRole | `leisure-service` |
| ruleIds | `UNIQUE_SERVICE` |
| entrances | `[{ side: "S", offset: 4 }]` |
| tags | `commercial`, `leisure`, `landmark`, `unique` |

**Визуальное описание:**

- Два опорных треугольных пилона, центральная ось, большое колесо с кабинками.
- Кабинки читаются как маленькие прямоугольники в 4 позициях (0°, 90°, 180°, 270°), чтобы не было мелких деталей.
- Нижний ярус — касса и входная арка.
- 5 стадий: разметка → фундамент пилонов → каркас колеса → колесо + кабинки → полная подсветка и ограждение.

### 4.2. Мегавысотка — `landmark-megatall-tower`

| Поле | Значение |
|---|---|
| key | `landmark-megatall-tower` |
| label | «Мегавысотка» |
| category | `HIGHRISE` |
| platform | `STONE` |
| rarity | `RARE` |
| spriteSize | `[48, 128]` |
| footprintCells | `[6, 6]` |
| anchorPx | `[24, 128]` |
| estimates | `[6]` |
| maxPerCity | 1 |
| maxPerDistrict | 1 |
| serviceRole | `office-service` |
| ruleIds | `UNIQUE_SERVICE` |
| entrances | `[{ side: "S", offset: 3 }]` |
| tags | `highrise`, `dense`, `landmark`, `unique`, `office` |

**Визуальное описание:**

- Узкая игла из стекла и стали, 3 ступенчатых сужения (setbacks), антенна-шпиль наверху.
- Вертикальные полосы окон, читаемые на 1×.
- 5 стадий: краны и ограждение → фундамент → каркас первых ярусов → стеклянная оболочка + кран → финальная антенна и подсветка.

### 4.3. Памятник — `landmark-monument`

| Поле | Значение |
|---|---|
| key | `landmark-monument` |
| label | «Городской памятник» |
| category | `CIVIC` |
| platform | `STONE` |
| rarity | `RARE` |
| spriteSize | `[32, 72]` |
| footprintCells | `[4, 4]` |
| anchorPx | `[16, 72]` |
| estimates | `[6]` |
| maxPerCity | 1 |
| maxPerDistrict | 1 |
| serviceRole | `culture-service` |
| ruleIds | `UNIQUE_SERVICE` |
| entrances | `[{ side: "S", offset: 2 }]` |
| tags | `civic`, `service`, `landmark`, `unique`, `culture` |

**Визуальное описание:**

- Постамент 4×4 клетки, на нём стела/колонна с фигурой.
- Абстрактная фигура (не узнаваемый человек), чтобы избежать странных деталей.
- Площадь вокруг — брусчатка, в code рисуется `STONE` platform.
- 5 стадий: строительная площадка → постамент → каркас стелы → облицовка → фигура и ограждение.

---

## 5. Дома — увеличение разнообразия ×2

Цель: 32 разных жилых здания. Добавляем 16 новых. Новые стили, которые нужно реализовать в `draw_finished_house`:

- `colonial` — двускатная крыша, симметричный фасад, колонны у входа.
- `craftsman` — широкие крыльцо, деревянные фронтоны.
- `ranch` — одноэтажное, длинное, низкая крыша.
- `split-level` — два объёма разной высоты.
- `townhouse-brick` / `townhouse-stone` — ряды из 2-3 домов с общими стенами.
- `garden-apartment` — низкая многосекционная, двор внутри.
- `eco-cottage` — солнечные панели, зелёная крыша.
- `narrow-shotgun` — узкий дом 2×3 клетки.
- `courtyard-block` — U-образная малоэтажка с внутренним двором.
- `modern-villa` — плоская крыша, большие окна, терраса.
- `duplex-brick` — кирпичный дуплекс на углу.
- `studio-loft` — старый склад, переделанный под жильё, большие окна.
- `rowhouse-corner` — угловой рядный дом с магазином на первом этаже.
- `suburban-brick` — типичный кирпичный коттедж.
- `apartment-walkup` — 3-4 этажа без лифта, наружная лестница.

### Таблица новых HOUSE-ассетов

| key | label | style | size | footprint | platform | rarity | estimates | maxPerDistrict | примечание |
|---|---|---|---|---|---|---|---|---|---|
| `house-colonial` | Колониальный дом | `colonial` | 32×32 | 4×3 | YARD | COMMON | 1,2 | null |  |
| `house-craftsman` | Крафтсман-коттедж | `craftsman` | 32×32 | 4×3 | YARD | COMMON | 1,2 | null |  |
| `house-ranch` | Ранчо | `ranch` | 40×24 | 5×3 | YARD | COMMON | 1,2 | null | низкое, длинное |
| `house-split-level` | Сплит-левел | `split-level` | 32×32 | 4×3 | YARD | COMMON | 1,2 | null |  |
| `house-townhouse-brick` | Кирпичный таунхаус | `townhouse-brick` | 32×32 | 4×3 | YARD | COMMON | 2,3 | null |  |
| `house-townhouse-stone` | Каменный таунхаус | `townhouse-stone` | 32×32 | 4×3 | YARD | COMMON | 2,3 | null |  |
| `house-garden-apartment` | Садовая квартира | `garden-apartment` | 48×40 | 6×4 | YARD | UNCOMMON | 3,6 | null |  |
| `house-eco-cottage` | Эко-коттедж | `eco-cottage` | 24×32 | 3×3 | YARD | UNCOMMON | 2,3 | null | солнечные панели |
| `house-narrow-shotgun` | Узкий дом | `narrow-shotgun` | 16×32 | 2×3 | YARD | COMMON | 1 | null | 2×3 footprint |
| `house-courtyard-block` | Дворовый блок | `courtyard-block` | 56×48 | 7×5 | YARD | UNCOMMON | 6 | null | U-форма |
| `house-modern-villa` | Современная вилла | `modern-villa` | 40×40 | 5×4 | YARD | RARE | 3,6 | null | плоская крыша |
| `house-duplex-brick` | Кирпичный дуплекс | `duplex-brick` | 24×32 | 3×3 | YARD | COMMON | 2,3 | null |  |
| `house-studio-loft` | Лофт-студия | `studio-loft` | 32×32 | 4×3 | YARD | UNCOMMON | 2,3 | null |  |
| `house-rowhouse-corner` | Угловой рядный дом | `rowhouse-corner` | 40×40 | 5×4 | YARD | COMMON | 2,3 | null | 1 этаж магазин |
| `house-suburban-brick` | Пригородный кирпичный | `suburban-brick` | 32×32 | 4×3 | YARD | COMMON | 1,2 | null |  |
| `house-apartment-walkup` | Малоэтажная квартира | `apartment-walkup` | 32×40 | 4×4 | YARD | COMMON | 2,3 | null | наружная лестница |

**Правило entrances:** для footprint W×H, `side: "S"`, `offset: Math.floor(W/2)` (или конкретно по двери в спрайте).

**Правило rarity:** большинство COMMON, крупные/необычные UNCOMMON/RARE, чтобы не перегружать карту.

---

## 6. Коммерция + заправки

Цель: 24 коммерческих здания. Добавляем 12.

### 6.1. Новые коммерческие здания (не заправки)

| key | label | style | size | footprint | platform | rarity | estimates | примечание |
|---|---|---|---|---|---|---|---|---|
| `shop-cafe` | Кафе | `shopfront` | 32×24 | 4×3 | STONE | COMMON | 2,3 | витрина, навес |
| `shop-butcher` | Мясная лавка | `shopfront` | 32×24 | 4×3 | STONE | COMMON | 2,3 |  |
| `shop-electronics` | Магазин электроники | `shopfront` | 32×24 | 4×3 | STONE | COMMON | 2,3 |  |
| `shop-furniture` | Мебельный | `shopfront` | 40×24 | 5×3 | STONE | UNCOMMON | 3,6 |  |
| `shop-bookstore` | Книжный | `shopfront` | 32×24 | 4×3 | STONE | COMMON | 2,3 |  |
| `shop-clothing` | Магазин одежды | `shopfront` | 32×24 | 4×3 | STONE | COMMON | 2,3 |  |
| `shop-restaurant` | Ресторан | `shopfront` | 40×24 | 5×3 | STONE | COMMON | 2,3 | столы у окна |
| `shop-bar` | Бар | `shopfront` | 32×24 | 4×3 | STONE | COMMON | 2,3 |  |
| `office-small` | Малый офис | `modern` | 32×32 | 4×3 | STONE | COMMON | 2,3 |  |
| `hotel-small` | Малая гостиница | `shopfront` | 40×32 | 5×4 | STONE | UNCOMMON | 3,6 | вывеска-флаг |
| `commercial-market-stalls` | Рынок | `market` | 48×32 | 6×4 | STONE | UNCOMMON | 3,6 | открытые ряды |
| `commercial-storage` | Мини-склад | `warehouse` | 40×24 | 5×3 | ASPHALT | COMMON | 3,6 | REQUIRES_COLLECTOR |

### 6.2. Заправки — 4 новых варианта

Сейчас есть `commercial-gas-station` (6×3), `commercial-gas-station-compact` (5×3), `commercial-highway-service-plaza` (8×5). Добавляем 4 новых, чтобы итого было 7.

| key | label | style | size | footprint | platform | rarity | maxPerCity | maxPerDistrict | serviceRole | примечание |
|---|---|---|---|---|---|---|---|---|---|---|
| `commercial-gas-station-electric` | Электрозаправка | `gas-electric` | 40×32 | 5×3 | ASPHALT | UNCOMMON | 1 | 1 | `fuel-service` | стойки зарядки, не колонки |
| `commercial-gas-station-truck` | Грузовая заправка | `gas-truck` | 56×40 | 7×5 | ASPHALT | RARE | 1 | 1 | `fuel-service` | высокий навес, грузовая стела |
| `commercial-gas-station-cafe` | Заправка с кафе | `gas-cafe` | 56×32 | 7×3 | ASPHALT | UNCOMMON | 1 | 1 | `fuel-service` | магазин + кафе |
| `commercial-gas-station-wash` | Заправка с мойкой | `gas-wash` | 56×32 | 7×3 | ASPHALT | UNCOMMON | 1 | 1 | `fuel-service` | одна колонка + мойка |

**Визуальная грамматика заправок** (уже в `draw_gas_station`):

- Магазин — маленькое здание с крышей, фасадом и затенённой правой стеной.
- Навес — плоская крыша с темным fascia.
- Колонки/стойки — корпус, дисплей, шланг (для EV — кабель).
- Стела — двухцветная панель без текста.
- Все 5 стадий: площадка → фундамент → каркас навеса → колонки + магазин → готовая АЗС.

Для `gas-electric` убрать шланги, добавить вертикальные стойки с кабелями. Для `gas-truck` увеличить навес и количество колонок. Для `gas-cafe` добавить второе крыло с кафе. Для `gas-wash` добавить арку мойки справа/слева.

---

## 7. Государственные / социальные здания (CIVIC)

Цель: 24 civic-здания. Добавляем 12.

| key | label | style | size | footprint | platform | rarity | maxPerCity | maxPerDistrict | serviceRole | примечание |
|---|---|---|---|---|---|---|---|---|---|---|
| `civic-museum` | Музей | `civic-monumental` | 56×48 | 7×5 | SERVICE | UNIQUE | 1 | 1 | `culture-service` | колонны, лестница |
| `civic-hospital` | Больница | `civic-modern` | 56×40 | 7×5 | SERVICE | UNIQUE | 1 | 1 | `health-service` | крест/эмблема |
| `civic-university` | Университет | `civic-monumental` | 64×48 | 8×5 | SERVICE | UNIQUE | 1 | 1 | `education-service` | несколько корпусов |
| `civic-courthouse` | Суд | `civic-monumental` | 48×40 | 6×5 | SERVICE | UNIQUE | 1 | 1 | `government-service` |  |
| `civic-embassy` | Посольство | `civic-modern` | 40×32 | 5×4 | SERVICE | RARE | 1 | 1 | `government-service` | флаг-штатив |
| `civic-community-center` | Культурный центр | `civic-modern` | 48×40 | 6×5 | SERVICE | UNCOMMON | 1 | 1 | `culture-service` |  |
| `civic-aquatic-center` | Бассейн / аквапарк | `civic-modern` | 48×40 | 6×5 | SERVICE | UNCOMMON | 1 | 1 | `leisure-service` | вода на крыше |
| `civic-transport-hub` | Транспортный узел | `civic-modern` | 56×40 | 7×5 | SERVICE | UNCOMMON | 1 | 1 | `transport-service` | автобусы, крыша |
| `civic-waste-station` | Мусоропереработка | `industrial` | 48×32 | 6×4 | ASPHALT | UNCOMMON | 1 | 1 | `utility-service` | баки, трубы |
| `civic-power-substation` | Подстанция | `industrial` | 40×32 | 5×4 | ASPHALT | UNCOMMON | 1 | 1 | `utility-service` | трансформаторы |
| `civic-memorial-hall` | Мемориальный зал | `civic-monumental` | 40×40 | 5×5 | SERVICE | RARE | 1 | 1 | `culture-service` |  |
| `civic-youth-center` | Молодёжный центр | `civic-modern` | 40×32 | 5×4 | SERVICE | UNCOMMON | 1 | 1 | `education-service` |  |

**Визуальные стили для CIVIC:**

- `civic-monumental` — тяжёлый постамент, колонны, симметричный фасад, широкая лестница.
- `civic-modern` — стекло + бетон, плоская крыша, акцентный цвет службы (красный для health, синий для government и т.д.).
- `industrial` — кирпич/металл, вентиляционные трубы, большие ворота, меньше окон.

Все 5 стадий: подготовка участка → фундамент → каркас/колонны → стены + крыша → детали/благоустройство.

---

## 8. Высотки (HIGHRISE)

Цель: 12 высоток. Добавляем 6.

| key | label | style | size | footprint | platform | rarity | estimates | примечание |
|---|---|---|---|---|---|---|---|---|
| `highrise-residential-tower` | Жилая башня | `tower` | 40×72 | 5×4 | STONE | COMMON | 6 | много окон, балконы |
| `highrise-hotel` | Отель-высотка | `tower` | 40×80 | 5×4 | STONE | UNCOMMON | 6 | вывеска, навес у входа |
| `highrise-office` | Офисная башня | `tower` | 40×80 | 5×4 | STONE | COMMON | 6 | стеклянный фасад |
| `highrise-medical-tower` | Медицинская башня | `tower` | 40×72 | 5×4 | STONE | RARE | 6 | крест на крыше |
| `highrise-luxury-tower` | Элитная башня | `tower` | 48×88 | 6×4 | STONE | RARE | 6 | террасы, панорамные окна |
| `highrise-sustainable-tower` | Эко-башня | `tower` | 40×80 | 5×4 | STONE | UNCOMMON | 6 | зелёные стены, солнечные панели |

**Стиль `tower`:**

- Прямоугольный силуэт с вертикальными полосами окон.
- Допускаются 1-2 сужения (setbacks) для разнообразия.
- Нижний этаж — вестибюль/витрины.
- Крыша — плоская с механическим ярусом или шпилем.
- 5 стадий: краны → фундамент → каркас до 30% → каркас + стекло до 80% → финальная отделка и крыша.

---

## 9. Props — фонари, деревья, парковая мебель

### 9.1. Фонари — варианты по архетипу района

Сейчас есть один `streetlamp`. Добавляем 5 вариантов, чтобы в каждом районе мог быть свой стиль.

| key | label | size | footprint | anchor | использование |
|---|---|---|---|---|---|
| `streetlamp-vintage` | Винтажный фонарь | 8×16 | 1×1 | 4,16 | PRIVATE, исторические районы |
| `streetlamp-modern` | Современный фонарь | 8×16 | 1×1 | 4,16 | NEW_BUILD, MIXED_URBAN |
| `streetlamp-solar` | Солнечный фонарь | 8×16 | 1×1 | 4,16 | CIVIC, экорайоны |
| `streetlamp-industrial` | Промышленный фонарь | 8×16 | 1×1 | 4,16 | COMMERCIAL, промзоны |
| `streetlamp-double` | Двухрожковый фонарь | 8×16 | 1×1 | 4,16 | центр, бульвары |
| `streetlamp-festive` | Праздничный фонарь | 8×16 | 1×1 | 4,16 | парки, площади (редкий) |

**Визуальное описание:**

- Винтажный — изогнутый кронштейн, круглый плафон, чугунный столб.
- Современный — прямой тонкий столб, квадратный LED-плафон.
- Солнечный — столб с маленькой панелью сверху.
- Промышленный — высокий мачтовый фонарь, жёлтая арматура.
- Двухрожковый — два плафона в разные стороны, для широких улиц.
- Праздничный — гирлянды/банты, аккуратно, без мелких букв.

**Фонари — не строятся в 5 стадий** (как и все мелкие пропы), но имеют несколько вариантов. Для крупных пропов (фонтаны, беседки) делаем 5 стадий.

### 9.2. Деревья — расширение лесной палитры

Сейчас: `tree-round`, `tree-conifer`, `tree-flowering`. Добавляем:

| key | label | size | footprint | примечание |
|---|---|---|---|---|
| `tree-birch` | Берёза | 8×16 | 1×1 | белый ствол, светлая крона |
| `tree-pine` | Сосна | 8×16 | 1×1 | тёмная, удлинённая |
| `tree-willow` | Ива | 8×16 | 1×1 | ниспадающие ветви |
| `tree-oak` | Дуб | 8×16 | 1×1 | широкая, мощная крона |
| `tree-apple` | Яблоня | 8×16 | 1×1 | круглая крона + красные точки |
| `tree-cherry` | Вишня | 8×16 | 1×1 | розовая крона |

### 9.3. Крупные парковые пропы (с 5 стадиями)

Эти объекты будут иметь 5 стадий, как здания. Расширяем рендерер, чтобы PROP мог иметь `stages` (по аналогии с buildings).

| key | label | size | footprint | anchor | примечание |
|---|---|---|---|---|---|
| `fountain-large` | Большой фонтан | 32×32 | 4×4 | 16,32 | чаши, струи (абстрактные линии) |
| `gazebo` | Беседка | 32×32 | 4×4 | 16,32 | открытая, крыша, столбики |
| `bandstand` | Эстрада | 40×32 | 5×4 | 20,32 | круглая/восьмиугольная |
| `statue-hero` | Статуя (герой) | 16×32 | 2×2 | 8,32 | абстрактная фигура на постаменте |
| `statue-abstract` | Абстрактная скульптура | 16×32 | 2×2 | 8,32 | металлические формы |
| `topiary-spiral` | Топиарий спираль | 16×24 | 2×2 | 8,24 | стриженое дерево |
| `topiary-animal` | Топиарий фигура | 16×24 | 2×2 | 8,24 | абстрактный силуэт |
| `pond-small` | Маленький пруд | 24×24 | 3×3 | 12,24 | вода, камни, кувшинки |
| `flower-bed-horizontal` | Цветочная клумба | 16×8 | 2×1 | 8,8 |  |
| `flower-bed-vertical` | Цветочная клумба | 8×16 | 1×2 | 4,16 |  |
| `park-bench-double` | Двойная скамейка | 16×8 | 2×1 | 8,8 |  |
| `park-bridge` | Мостик | 24×16 | 3×2 | 12,16 | через пруд/ручей |
| `park-lamp` | Парковый фонарь | 8×16 | 1×1 | 4,16 | низкий, декоративный |
| `park-path-circle` | Круглая площадка | 24×24 | 3×3 | 12,24 | плитка/мозаика |
| `playground-slide` | Горка | 24×16 | 3×2 | 12,16 |  |
| `playground-carousel` | Карусель | 32×24 | 4×3 | 16,24 | маленькая, детская |

**5 стадий для крупных пропов:**

1. Разметка/ограждение.
2. Фундамент/чаша.
3. Каркас (столбы, арки, силуэт).
4. Почти готовый объект с временными лесами/табличками.
5. Готовый объект, благоустройство вокруг.

---

## 10. Парки и рощи — большие и разные

Сейчас `publishDistrictGreenFeature` создаёт один зелёный объект на район: 5×4 или 6×5, вид `PARK`/`GROVE` определяется чётностью. Предлагается расширить систему area.

### 10.1. Новые размеры и типы area

| kind | assetKey | размеры | минимум клеток | декор | примечание |
|---|---|---|---|---|---|
| `PARK` | `urban-park` | 5×4, 6×5, 8×8, 10×10 | 20 | fountain, gazebo, benches, flower beds | городской парк |
| `GROVE` | `urban-grove` | 6×5, 8×8, 10×10 | 25 | деревья, picnic, reeds | роща |
| `BOTANICAL_GARDEN` | `urban-botanical` | 8×8, 10×10 | 64 | rare trees, topiary, pond | 1 на город |
| `AMUSEMENT_PARK` | `urban-amusement` | 10×10, 12×12 | 100 | carousel, playground, ferris wheel if no landmark | 1 на город, редко |
| `CENTRAL_PARK` | `urban-central` | 10×10, 12×12 | 100 | большой фонтан, статуи, мосты | 1 на город |

**Размещение:**

- Малые парки (5×4, 6×5) — в каждом районе, как сейчас.
- Средние парки (8×8, 10×10) — в районах MIXED_URBAN и CIVIC, или в центре города.
- Большие (10×10, 12×12) — только если город имеет ≥ 3 района и есть свободная площадь; максимум 1 на город.
- Рощи (`GROVE`) — в PRIVATE, NEW_BUILD и CIVIC; разные наборы деревьев (`tree-birch`, `tree-pine`, `tree-willow`).

### 10.2. Роща как «постройка»

Пользователь просил «постройка в виде рощи». Реализация: `GROVE` — это не здание, а area, но у неё есть 5 стадий наполнения:

- Stage 1: забор и метки участка.
- Stage 2: дорожки и фундаменты.
- Stage 3: молодые деревья (маленькие пропы).
- Stage 4: взрослые деревья, скамейки, мостки.
- Stage 5: полная роща с цветами и пикник-зоной.

Технически area не имеет своего спрайта, поэтому стадии реализуются через плотность внутреннего декора: на ранних стадиях публикуется меньше пропов, на поздних — больше и крупнее. Это требует небольшого изменения в `publishDistrictGreenFeature`.

### 10.3. Соответствие area-assetKey и декора

| area assetKey | набор деревьев | крупные пропы | мелкие пропы |
|---|---|---|---|
| `urban-park` | tree-round, tree-flowering | fountain-large, gazebo, statue | bench, playground, streetlamp |
| `urban-grove` | tree-birch, tree-pine, tree-willow | picnic-table, pond-small | bench, bush, reed |
| `urban-botanical` | tree-oak, tree-cherry, tree-apple | topiary-spiral, topiary-animal, pond | flower-bed, park-lamp |
| `urban-amusement` | tree-round | carousel, playground-slide | bench, park-lamp, trash-bin |
| `urban-central` | tree-oak, tree-flowering | fountain-large, statue-hero, bandstand | park-bench-double, park-lamp, flower-bed |

---

## 11. Наборы ассетов по архетипам районов

Текущие архетипы: `NEW_BUILD`, `PRIVATE`, `MIXED_URBAN`, `COMMERCIAL`, `CIVIC`.

Предлагается при генерации района привязывать набор уличных фонарей и тип заправки (если есть) к архетипу. Это повышает различимость районов на карте.

| Архетип | Фонари | Заправка | Дома | Парки |
|---|---|---|---|---|
| `NEW_BUILD` | `streetlamp-modern` | `commercial-gas-station` | `house-modern-*`, `house-eco-cottage` | `urban-park` |
| `PRIVATE` | `streetlamp-vintage` | `commercial-gas-station-compact` | `house-cottage`, `house-craftsman`, `house-suburban-brick` | `urban-grove` (берёзы) |
| `MIXED_URBAN` | `streetlamp-double` | `commercial-gas-station-cafe` | `house-rowhomes`, `house-townhouse-*`, `house-apartment-walkup` | `urban-park` |
| `COMMERCIAL` | `streetlamp-industrial` | `commercial-highway-service-plaza`, `commercial-gas-station-truck` | мало или нет | нет, заменяется парковками |
| `CIVIC` | `streetlamp-solar` | `commercial-gas-station-electric` (или нет) | нет | `urban-botanical`, `urban-central` |

**Реализация:** в `publishDistrictGreenFeature` и в логике размещения `ROADSIDE_DECOR` добавить выбор assetKey по `archetype`, а не глобальный случайный.

---

## 12. Анализ городостроительных игр — что заимствовать

### 12.1. SimCity (1994-2013)

- **Zoning:** жилая (R), коммерческая (C), промышленная (I) — каждая с уровнями плотности.
- **Урок:** нужны чёткие визуальные градации жилья от коттеджа до многоэтажки.
- **Для нашего пака:** ввести «tiers» через rarity и estimates: `COMMON` = low-density, `UNCOMMON` = mid-density, `RARE` = high-density/unique.

### 12.2. Cities: Skylines

- **District specialization:** лесное, фермерское, нефтегазовое, туристическое.
- **Unique buildings:** достижения открывают особые здания, 1 на город.
- **Парки DLC:** большие площади, зоопарки, пляжи, амфитеатры.
- **Урок:** ввести набор уникальных 1-на-город объектов и разные наборы декора для разных районов.

### 12.3. Anno 1800 / 2070

- **Производственные цепочки:** здания видны по принадлежности к цепочке.
- **Жилые уровни:** рабочий → инженер → инвестор, каждый уровень — свой визуальный стиль.
- **Урок:** ввести «housing evolution» через разные стили домов для разных районов/оценок.

### 12.4. Tropico

- **Эпохи:** колониальные, холодной войны, современные здания.
- **Ландмарки:** дворец, статуи Эль Президенте.
- **Урок:** для TEMPLATE-города и столицы можно использовать «эпохальные» стили (колониальный/современный).

### 12.5. Pharaoh / Caesar / Zeus

- **Walker-based services:** пожарные, полицейские, врачи ходят пешком по районам.
- **Monuments:** строятся долго, занимают много клеток, имеют стадии.
- **Урок:** наши service buildings (полиция, пожарная, больница) должны иметь чёткую визуальную идентификацию и 1-на-город/район квоты. Монументы — 5 стадий, большой footprint.

### 12.6. The Settlers / Foundation

- **Органичное развитие:** дома примыкают друг к другу, общие стены, рыночные площади.
- **Урок:** рядные дома и таунхаусы должны выглядеть «сшитыми» в блок, а не отдельными островками.

### 12.7. Синтез — что делает город реалистичным

1. **Ясная зональность:** жилые, коммерческие, промышленные, государственные здания читаются по силуэту и цвету.
2. **Слои плотности:** от частных домов до многоэтажек и мегавысоток.
3. **Сервисная сеть:** полиция, пожарные, медицина, образование, транспорт — каждый со своим цветом и стилем.
4. **Ландмарки:** 1-2 узнаваемых объекта на город, которые видны издалека.
5. **Публичное пространство:** парки, площади, аллеи, фонари, скамейки.
6. **Вариативность:** даже одинаковые типы домов должны отличаться цветом крыши/стен, не только перекраской, но и композицией.

---

## 13. Этапы реализации

### 13.1. Фаза 1 — генерация runtime PNG

1. Расширить `draw_finished_house` новыми стилями: `colonial`, `craftsman`, `ranch`, `split-level`, `townhouse-brick`, `townhouse-stone`, `garden-apartment`, `eco-cottage`, `narrow-shotgun`, `courtyard-block`, `modern-villa`, `duplex-brick`, `studio-loft`, `rowhouse-corner`, `suburban-brick`, `apartment-walkup`, `shopfront`, `market`, `warehouse`, `civic-monumental`, `civic-modern`, `industrial`, `tower`.
2. Расширить `draw_gas_station` для стилей `gas-electric`, `gas-truck`, `gas-cafe`, `gas-wash`.
3. Добавить функции `draw_tower` для HIGHRISE и `draw_monumental` для CIVIC.
4. Добавить функции генерации `starter-city-observatory`, `landmark-ferris-wheel`, `landmark-megatall-tower`, `landmark-monument`.
5. Добавить prop-функции: `prop_streetlamp(style)`, `prop_tree(kind)`, `prop_fountain_large`, `prop_gazebo`, `prop_bandstand`, `prop_statue`, `prop_topiary`, `prop_pond`, `prop_flower_bed`, `prop_playground_slide`, `prop_carousel`, `prop_park_bridge`, `prop_park_lamp`.
6. Добавить `prop.stages` для крупных пропов и поддержку в рендерере (опционально, см. раздел 14).

### 13.2. Фаза 2 — manifest + каталог

1. Добавить 16 HOUSE, 12 COMMERCIAL, 4 gas-station, 12 CIVIC, 6 HIGHRISE, 4 landmarks, 1 starter observatory в `catalog/generated-buildings.json`.
2. Добавить новые props в `generated_props`.
3. Обновить `manifest.json` будет сделано автоматически `build_manifest`.

### 13.3. Фаза 3 — world generator

1. В `publishTemplateCityLandmark` использовать `starter-city-observatory`.
2. Добавить `publishCityLandmark` — один уникальный landmark на город.
3. В `publishDistrictGreenFeature` добавить большие размеры, новые area assetKey и декор по архетипу.
4. В `publishCityGatewayFeatures` / `publishRoadsideDecor` привязать фонари к архетипу.

### 13.4. Фаза 4 — приёмка

1. `npm run assets:build` — без ошибок.
2. `validate` проходит: 5 стадий, кратность 8, hard alpha, уникальные ID, валидные ruleIds и entrances.
3. `npm run typecheck` — без ошибок.
4. `screenshots/pixel-city-v4-expanded-assets.png` и `screenshots/gas-station-style-study.png` читаемы.
5. property-test: создать 20 случайных городов, убедиться что уникальные здания не дублируются, парки не пересекают дороги, фонари не лезут в воду.

---

## 14. Тонкости и ограничения

### 14.1. Стадии для пропов

Мелкие пропы (фонари, деревья, скамейки) остаются одностадийными вариантами — это согласовано с текущим рендерером и не требует переделки `PROP_CATALOG`. **Крупные пропы** (фонтаны, беседки, статуи, карусели) идут с 5 стадиями; для этого в `manifest.json` в props добавить поле `stages`, а в `WorldCanvas.drawWorldFeature` для PROP проверять `stages` и рендерить текущую стадию, если она есть. Если `stages` нет — использовать `path` как сейчас.

### 14.2. AREA не имеет спрайта

`urban-park`, `urban-grove`, `urban-botanical` и т.д. — это `assetKey` для `assetKind: "AREA"`. Клиент рисует area тайлами, поэтому отдельные PNG не нужны. Разнообразие достигается через размер, форму и декор.

### 14.3. Уникальные здания и задачи

`landmark-ferris-wheel`, `landmark-megatall-tower`, `landmark-monument` и `starter-city-observatory` публикуются как `worldFeature` (`assetKind: "BUILDING"`), а не как задачи. Они не имеют `taskId` и не открывают `TaskModal`. При клике можно показать информационную панель (отдельная задача — вне скопа плана).

### 14.4. Квоты

- `maxPerCity: 1` для уникальных зданий.
- `maxPerDistrict: 1` для крупных сервисных зданий (полиция, пожарная, клиника).
- Для заправок `maxPerCity: 1`, `maxPerDistrict: 1`, чтобы не было перенасыщения.

---

## 15. Приложение A — итоговый список новых ключей

### Здания (51 новый ключ)

**TEMPLATE:**
- `starter-city-observatory`

**City landmarks (1 на город):**
- `landmark-ferris-wheel`
- `landmark-megatall-tower`
- `landmark-monument`

**HOUSE (+16):**
`house-colonial`, `house-craftsman`, `house-ranch`, `house-split-level`, `house-townhouse-brick`, `house-townhouse-stone`, `house-garden-apartment`, `house-eco-cottage`, `house-narrow-shotgun`, `house-courtyard-block`, `house-modern-villa`, `house-duplex-brick`, `house-studio-loft`, `house-rowhouse-corner`, `house-suburban-brick`, `house-apartment-walkup`

**COMMERCIAL (+12, не заправки):**
`shop-cafe`, `shop-butcher`, `shop-electronics`, `shop-furniture`, `shop-bookstore`, `shop-clothing`, `shop-restaurant`, `shop-bar`, `office-small`, `hotel-small`, `commercial-market-stalls`, `commercial-storage`

**GAS STATIONS (+4):**
`commercial-gas-station-electric`, `commercial-gas-station-truck`, `commercial-gas-station-cafe`, `commercial-gas-station-wash`

**CIVIC (+12):**
`civic-museum`, `civic-hospital`, `civic-university`, `civic-courthouse`, `civic-embassy`, `civic-community-center`, `civic-aquatic-center`, `civic-transport-hub`, `civic-waste-station`, `civic-power-substation`, `civic-memorial-hall`, `civic-youth-center`

**HIGHRISE (+6):**
`highrise-residential-tower`, `highrise-hotel`, `highrise-office`, `highrise-medical-tower`, `highrise-luxury-tower`, `highrise-sustainable-tower`

### Props (новые ключи, без stages, кроме крупных)

**Фонари:** `streetlamp-vintage`, `streetlamp-modern`, `streetlamp-solar`, `streetlamp-industrial`, `streetlamp-double`, `streetlamp-festive`

**Деревья:** `tree-birch`, `tree-pine`, `tree-willow`, `tree-oak`, `tree-apple`, `tree-cherry`

**Крупные пропы (5 стадий):** `fountain-large`, `gazebo`, `bandstand`, `statue-hero`, `statue-abstract`, `topiary-spiral`, `topiary-animal`, `pond-small`, `flower-bed-horizontal`, `flower-bed-vertical`, `park-bench-double`, `park-bridge`, `park-lamp`, `park-path-circle`, `playground-slide`, `playground-carousel`

### AREA assetKey

- `urban-park` (есть)
- `urban-grove` (есть)
- `urban-botanical` (новый)
- `urban-amusement` (новый)
- `urban-central` (новый)

---

## 16. Приложение B — примерная смета труда

| Работа | Оценка (story points) | Примечание |
|---|---|---|
| Новые стили генерации зданий (16 стилей) | 8 | самая большая часть Python-кода |
| Генерация 4 ландмарков + observatory | 5 | крупные спрайты, 5 стадий |
| Генерация 4 новых заправок | 3 | на базе существующей `draw_gas_station` |
| Генерация 6 новых деревьев и 6 фонарей | 3 | мелкие пропы, быстро |
| Генерация 16 крупных пропов с 5 стадиями | 5 | нужны стадийные функции |
| Обновление `generated-buildings.json` и manifest | 2 | механическая работа |
| Изменения в world generator (парки, фонари, ландмарки) | 5 | логика размещения и квот |
| Приёмка: contact sheets, property tests, typecheck | 3 |  |
| **Итого** | **34 SP** | ~2-3 итерации по одному разработчику |

---

## 17. Резюме для коммита

План предлагает:

1. **TEMPLATE-город:** `starter-city-observatory` — 8×8 клеток, 64×112 px, 5 стадий.
2. **1-на-город:** колесо обозрения, мегавысотка, памятник — все 5 стадий, `maxPerCity: 1`.
3. **×2 разнообразие:** 16 новых домов, 12 коммерческих, 4 заправки, 12 civic, 6 высоток.
4. **Разнообразие инфраструктуры:** 6 видов фонарей, привязка к архетипу района; 4 новые заправки.
5. **Парки и рощи:** 5 типов area, большие размеры до 12×12, 16+ новых парковых пропов, 6 новых деревьев.
6. **Все здания и крупные пропы — 5 стадий.** Мелкие пропы — варианты.
7. **Пайплайн:** расширить `catalog/generated-buildings.json` и `scripts/build-pixel-city-pack-v4.py`, затем `npm run assets:build`.

Следующий шаг — либо поручить художнику/скрипту сгенерировать runtime PNG по этому плану, либо сразу реализовать Python-генераторы.
