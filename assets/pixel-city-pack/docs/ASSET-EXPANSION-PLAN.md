# План расширения Tasktopia Pixel City Pack

**Версия:** 2.0
**Статус:** активная миграция визуального качества (runtime PNG + manifest + world generator)
**Цель:** довести разнообразие городов до уровня классических city-builder-ов, развивать уникальный Государственный архив и объекты 1-на-город, увеличить число вариантов зданий, заправок, фонарей и парков.

---

## 1. Краткое состояние пака (V4)

Текущий runtime `assets/pixel-city-pack/runtime` собирается детерминированно из
канонического каталога и трёх независимых AI-authored источников стадий 3–5.
Стадии 1–2 создаёт общий клеточный construction composer. Combined-sheet больше
не является допустимым источником для принятого здания. Сборщик может убрать
chroma, сохранить пропорции, сделать hard alpha и сократить палитру, но не имеет
права перерисовывать принятую геометрию здания или жителя примитивами.

| Категория | Итог (V4) | Цель | Статус |
|---|---|---|---|
| HOUSE | 52 | ≥52 | выполнено |
| COMMERCIAL | 51 | ≥49 | выполнено |
| CIVIC | 56 | ≥49 | выполнено |
| HIGHRISE | 34 | ≥33 | выполнено |
| Props | 284 | ≥150 | выполнено |
| AREA (parks/groves) | 7 логических типов | ≥5 | выполнено |
| Unique landmarks | 13 | 13 | выполнено |

**Правила, которые нельзя ломать:**

- Базовая клетка `8×8 px`.
- Любой runtime PNG кратен 8 по сторонам.
- Каждое здание имеет ровно 5 стадий с одинаковым `spriteSize`, `footprint`, `anchor`, `entrances`.
- `anchorPx` — нижний центр спрайта.
- `runtimeAI: false`: все PNG готовятся заранее, не генерируются в браузере.
- Контракт в `manifest.json` — единственный источник истины для каталога.

### Активный каталог

Канонический `catalog/buildings.json` содержит полный набор семейств
`HOUSE`, `COMMERCIAL`, `CIVIC`, `HIGHRISE` и городских ориентиров.
Каждый объект имеет собственный силуэт и пять стадий; `assets:verify` проверяет
размеры, hard alpha, палитру, различимость стадий и отсутствие одинаковых
финальных масок. Ориентиры доступны из всего набора `landmark-*` как здания
задач. Они выбираются явным `buildingHint` или семантическим подбором
каталога, проходят те же пять стадий, что и обычная задача. В одном городе
может быть только один городской ориентир; каталог из 13 вариантов нужен,
чтобы разные города не повторяли один и тот же силуэт.

Природный набор расширен до 16 заново отрисованных основных видов деревьев, шести кустарников и восьми
видов животных. Инциденты используют три пожарные машины и четыре кадра огня
и дыма. Генератор рельефа выбирает один из восьми глобально устойчивых типов
гидрологии; формулы используют мировые координаты, поэтому не расходятся на
границах чанков. Обоснование каталога и правила размещения находятся в
`docs/research/city-builder-world-diversity-2026.md`.

---

## 2. Как добавлять новые ассеты

Краткая инструкция для исполнителя:

1. Для V5-здания сначала принять stage 5, затем отдельно получить стадии `4→3` по контракту `GENERATION-SPEC.md` и сохранить три файла в `reference/ai-authored/building-stage-study/<assetKey>/sources/`. Логические стадии 1–2 собираются общим 8×8 construction-kit по footprint и не генерируются моделью изображений.
2. Зарегистрировать в `stageSources` ровно стадии 3–5 и три SHA-256, а также `spriteSize`, footprint, anchor, entrances и platform в `catalog/buildings.json`. Полей combined-sheet в каталоге зданий нет.
3. Для жителя, транспорта или другого сложного prop подготовить directional/source sheet в `reference/ai-authored/ambient`, затем зарегистрировать его в authored-каталоге с `visualProfile`, `baseFacing`, `footprintCells` и `anchorPx`.
4. Для **area/парков** изменить код генерации в `AppService.publishDistrictGreenFeature` (размеры, assetKey, набор декораций), но сами area-спрайты не нужны — area рисуется тайлами `path-brown` + `MEADOW`.
5. Запустить:
   ```bash
   npm run assets:setup
   npm run assets:build
   ```
6. Проверить `npm run typecheck` и открыть `screenshots/pixel-city-expanded-assets.png`.

---

## 3. Государственный архив — реализованный уникальный комплекс

Архив является объектом страны, а не городом или задачей. С первого рабочего
города резервируется площадка `state-archive-complex`; по порогам 3, 6 и 10
записей добавляются `state-archive-wing`, `state-archive-vault` и
`state-archive-tower` к обязательному `state-archive-core`.

Комплекс окружён отдельным стальным забором. Южный разрыв периметра совпадает
с двухклеточным красно-белым шлагбаумом, а локальная подъездная дорога от него
маршрутизируется до существующей дорожной сети без прямого примыкания к трассе.
При запуске сервера этот контракт идемпотентно достраивается и для архивов,
которые были созданы до появления охраняемого периметра.

Четыре корпуса архива используют тот же единый authored-контракт, что и
остальные здания: общие параметрические стадии 1–2 и три независимо
проверенные стадии 3–5. Отдельного импортного каталога и специальной ветки
сборки больше нет. Оперативного штаба в наборе нет.

---

## 4. Уникальные объекты города

Городской ориентир не публикуется готовой декорацией. Он создаётся только как
здание задачи, занимает обычный task-lot, хранит `taskId` и меняет спрайт по
статусу задачи. Правило `UNIQUE_SERVICE` ограничивает весь класс одним
ориентиром на город; конкретный тип можно запросить через MCP-поле
`buildingHint`. Так ориентир отражает
реально выполненную работу, а не возникает автоматически при создании района.

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

**Визуальная грамматика заправок** (обязательный AI-authored контракт):

- Магазин — маленькое здание с крышей, фасадом и затенённой правой стеной.
- Навес — плоская крыша с темным fascia.
- Колонки/стойки — корпус, дисплей, шланг (для EV — кабель).
- Стела — двухцветная панель без текста.
- Все 5 стадий: площадка → фундамент → каркас навеса → колонки + магазин → готовая АЗС.

Для `gas-electric` убрать шланги, добавить вертикальные стойки с кабелями. Для `gas-truck` увеличить навес и количество колонок. Для `gas-cafe` добавить второе крыло с кафе. Для `gas-wash` добавить арку мойки справа/слева.

### 6.3. Полная миграция АЗС

Старые геометрические изображения АЗС не принимаются как финальные ассеты. Каждый из семи ключей проходит отдельную перегенерацию ИИ, native-scale review и миграцию без runtime fallback:

1. `commercial-gas-station` — городской базовый вариант: магазин справа, навес и две колонки слева. **Source sheet принят.**
2. `commercial-gas-station-compact` — одна колонка и небольшой магазин; не уменьшенная копия базовой станции.
3. `commercial-highway-service-plaza` — самостоятельная трассовая композиция с широким навесом и сервисным зданием.
4. `commercial-gas-station-electric` — зарядные стойки и читаемый EV-навес без топливных шлангов.
5. `commercial-gas-station-truck` — высокий навес и увеличенный проезд для грузового транспорта.
6. `commercial-gas-station-cafe` — магазин и кафе образуют единый фронтальный фасад.
7. `commercial-gas-station-wash` — мойка является частью силуэта, а не отдельным прямоугольником.

Для каждого варианта обязательны: пять стадий одного объекта, strict frontal-top, runtime canvas из каталога, непрозрачная ширина 88–98%, высота 75–98%, hard alpha, отдельный source digest и `reviewed: true`. Пока конкретный ключ не прошёл этот gate, он считается очередью миграции, а не завершённым новым ассетом.

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
| `civic-transport-hub` | Транспортный узел | `civic-modern` | 128×96 | 16×8 | SERVICE | UNCOMMON | 1 | 1 | `transport-service` | широкий вокзальный фасад и стеклянный центральный зал |
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

### 9.4. Светофоры

Светофоры входят в обязательный дорожный набор как два состояния одного фронтального объекта: `traffic-light-red` и `traffic-light-green`. Оба сохраняют canvas `8×16`, footprint `1×1`, anchor `4,16`, жёсткую альфу и идентичный силуэт; меняется только активная линза. Непрозрачный объект занимает ровно `5×11 px` у нижнего anchor, поэтому больше не конкурирует по масштабу с фасадами и людьми. Renderer ставит их у подходов к T/X-перекрёсткам и переключает существующий Sprite, поэтому отдельные декоративные варианты, которые нельзя синхронизировать с фазой движения, не допускаются.

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
- **Урок:** для Государственного архива и столицы можно использовать «эпохальные» стили (колониальный/современный).

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

## 13. Этапы реализации — выполнено

### 13.1. Фаза 1 — генерация runtime PNG

1. [x] Расширены стили HOUSE, COMMERCIAL, CIVIC и HIGHRISE.
2. [x] Добавлены `gas-electric`, `gas-truck`, `gas-cafe`, `gas-wash`.
3. [x] Добавлены отдельные отрисовщики высоток, civic-зданий и ландмарков.
4. [x] Добавлены три городских ландмарка и честные стадии корпусов архива.
5. [x] Добавлены 6 деревьев, 6 фонарей и 16 крупных парковых пропов.
6. [x] Для всех объектов работы сохранены 5 стадий; ambient-пропы остаются законченными вариантами.

### 13.2. Фаза 2 — manifest + каталог

1. [x] Добавлены 16 HOUSE, 12 COMMERCIAL, 4 gas-station, 12 CIVIC, 6 HIGHRISE и 3 landmarks.
2. [x] Новые props включены в `generated_props`.
3. [x] Manifest воспроизводимо собирается `build_manifest`.

### 13.3. Фаза 3 — world generator

1. [x] `COUNTRY_ARCHIVE` остаётся самостоятельным комплексом страны.
2. [x] `landmark-*` размещаются только задачами и проходят пять стадий без готового `worldFeature`-дубликата.
3. [x] `publishDistrictGreenFeature` использует пять композиций и декор по архетипу.
4. [x] Фонари и деревья выбираются по архетипу и seed.

### 13.4. Фаза 4 — приёмка

1. [x] `npm run assets:build` — 193 семейства, 965 стадий, 284 props и 8 моделей транспорта.
2. [x] Оба аудита проходят: кратность 8, hard alpha, стадии, anchors, палитра ≤32, без сирот и пропавших ссылок.
3. [x] `npm run typecheck` и `npm run lint -- --quiet`.
4. [x] Контрольные листы динамические и визуально проверены.
5. [x] Каталог, миграционный статус, геометрия стадий и world-generation закреплены автоматическими тестами; точное число тестов не фиксируется в документе и контролируется CI.

---

## 14. Тонкости и ограничения

### 14.1. Стадии для пропов

Декоративные props не связаны с задачей и не изображают прогресс, поэтому используют один законченный PNG. Пять стадий обязательны для BUILDING-объектов работы и ландмарков. Если крупный prop когда-либо станет результатом задачи, его следует перевести в BUILDING-контракт вместо добавления фиктивных стадий к ambient-декору.

### 14.2. AREA не имеет спрайта

`urban-park`, `urban-grove`, `urban-botanical` и т.д. — это `assetKey` для `assetKind: "AREA"`. Клиент рисует area тайлами, поэтому отдельные PNG не нужны. Разнообразие достигается через размер, форму и декор.

### 14.3. Уникальные здания и задачи

`landmark-*` являются task-linked зданиями: их стадия и существование зависят
от задачи. Корпуса `state-archive-*` остаются отдельными country-level
`worldFeature`, потому что открывают раздел Государственного архива и растут
от количества архивных записей, а не от статуса задачи.

### 14.4. Квоты

- `maxPerCity: 1` для уникальных зданий.
- `maxPerDistrict: 1` для крупных сервисных зданий (полиция, пожарная, клиника).
- Для заправок `maxPerCity: 1`, `maxPerDistrict: 1`, чтобы не было перенасыщения.

---

## 15. Приложение A — итоговый список ключей расширения

### Здания (53 новых + 4 корпуса архива)

**Государственный архив:**
- `state-archive-core`, `state-archive-wing`, `state-archive-vault`, `state-archive-tower`

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

### Props (новые законченные ambient-варианты)

**Фонари:** `streetlamp-vintage`, `streetlamp-modern`, `streetlamp-solar`, `streetlamp-industrial`, `streetlamp-double`, `streetlamp-festive`

**Деревья:** 15 AI-authored вариантов с отдельными силуэтами: `tree-oak`, `tree-maple`, `tree-round`, `tree-aspen`, `tree-birch`, `tree-apple`, `tree-cherry`, `tree-magnolia`, `tree-willow`, `tree-deadwood`, `tree-conifer`, `tree-pine`, `tree-cedar`, `tree-cypress`, `tree-redwood`.

**Крупные пропы:** к базовому набору добавлены AI-authored `fountain-large`, `gazebo`, `park-pond`, `park-sculpture`, `park-flower-clock`, `park-bandstand`, `playground-small`, `playground-slide`, `playground-carousel`, `playground-climbing`, `playground-swing`.

**Транспорт и остановки:** восемь самостоятельных моделей машин 24×16 в трёх нарисованных направлениях: боковой вид на восток, отдельный задний вид 16×24 на север и отдельный передний вид 16×24 на юг. Непрозрачные кузова имеют единые bounds 22×13/13×22; исходный лист закреплён SHA-256 и проходит проверку одного связного компонента во всех 24 ячейках. Запад — единственное допустимое зеркалирование. Один канонический парный контракт остановки 16×16 (`bus-stop-horizontal`, `bus-stop-vertical`) и городской автобус 56×24 (7×3 клетки) с теми же тремя видами (`city-bus-horizontal`, `city-bus-north`, `city-bus-south`). Автобус допускается только на семиклеточных collector/arterial/highway-дорогах. Старые несовместимые семейства удалены, а не скрыты fallback-веткой.

### AREA assetKey

- `urban-park` (есть)
- `urban-grove` (есть)
- `urban-botanical` (новый)
- `urban-amusement` (новый)
- `urban-central` (новый)

---

## 16. Итог реализации

Реализовано:

1. **Государственный архив:** четыре уникальных корпуса, добавляемых по мере наполнения архива.
2. **Уникальные здания города:** полный каталог `landmark-*` строится задачами, все 5 стадий, максимум один ориентир на город.
3. **×2 разнообразие:** 16 новых домов, 12 коммерческих, 4 заправки, 12 civic, 6 высоток.
4. **Разнообразие инфраструктуры:** 6 видов фонарей, привязка к архетипу района; 4 новые заправки.
5. **Парки и рощи:** 5 типов area, по 3 seed-композиции каждого типа, 11 AI-authored игровых/парковых объектов и 16 заново отрисованных основных деревьев.
6. **Все здания — 5 стадий.** Декоративные пропы — самостоятельные законченные варианты.
7. **Пайплайн:** каталог → детерминированная сборка → двойной автоматический аудит → контрольные листы → интеграционные тесты.
8. **Единый масштаб жителей:** пешеходы и стоящие activity-residents используют `16×24` и рост `16–18 px`; рыбаки сохраняют тот же масштаб частей тела в согнутой позе. Велосипедисты и самокатчики публикуются на `24×24`/`16×24` без runtime-уменьшения, поэтому их голова и тело совпадают по масштабу с пешеходами.

### 16.1. Статус перехода на authored-источники

- Всего в каталоге: 193 семейства зданий.
- У всех 193 семейства есть отдельные authored-файлы стадий 3–5 и SHA-256;
  это инвентарный минимум, а не автоматическое подтверждение V5-качества.
- Строгий V5 gate пройден у 163 семейств: geometry contract, независимые
  стадии, door-scale, baseline и native-grid preview.
- В строгой очереди остаются 30 старых семейств с geometry study,
  заблокированных усиленным контрактом дверей/проекции.
- Актуальный подробный реестр и порядок миграции ведутся в
  `V5-ASSET-MIGRATION-STATUS.md`; контракт `authoredBatch50` проверяет наличие
  authored-источников, но не заменяет художественный V5 gate.

### 16.2. Единая миграция всех зданий на V5-сетку

- Каталог миграции охватывает все 193 семейства, а не только здания с тегом
  `new-build`.
- Независимые late-stage sources присутствуют у 193 семейств; строгую V5
  приёмку прошли 163.
- Очередь последовательной художественной миграции открыта до закрытия
  оставшихся 30 семейств.
- Стадии 1–2 больше не генерируются для каждой семьи: общий 8×8-конструктор собирает план площадки, четыре варианта грунта, два варианта фундамента, арматуру, ограждение и ворота строго по footprint. Каталог содержит 10 AI-authored planning-деталей и 13 foundation-деталей; seeded-раскладка выбирает 2–7 уникальных объектов по площади, не перекрывает их footprint, ограничивает участок одним краном и одной тяжёлой машиной и оставляет проезд от ворот. Индивидуальными остаются стадии 3–5.
- Combined-sheet формат полностью отсутствует в каталоге зданий; fallback на уменьшенный фасад не сохраняется.
- Для каждой семьи обязательны geometry JSON, чистый пятистадийный grid-preview, единый door scale, общий baseline и отдельный одноклеточный строительный envelope.
