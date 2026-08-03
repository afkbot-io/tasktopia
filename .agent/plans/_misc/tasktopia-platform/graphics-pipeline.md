# Гекс-графика: производство и верификация

## Решение трёх проблем прототипа

1. **Кривые дороги:** дороги больше не генерируются AI-картинкой вместе с травой. Код строит точную геометрию из соединений соседних гексов.
2. **Жёлтые линии между всеми гексами:** сетка не рисуется. Граница sprint/city вычисляется как внешний периметр polyhex и рисуется только по внешним рёбрам.
3. **Разные материалы:** terrain, road, foundation и building разделены на слои. Сгенерированное здание не содержит собственной травы или дороги.

## Координатный контракт

- Orientation: flat-top.
- Логические координаты: axial `(q, r)`, cube `s = -q - r`.
- Направления по часовой стрелке:
  - bit 0 `E`;
  - bit 1 `SE`;
  - bit 2 `SW`;
  - bit 3 `W`;
  - bit 4 `NW`;
  - bit 5 `NE`.
- Базовый hex: `256 × 222`, side radius `128`, фактическая высота округлена от `sqrt(3) * 128`.
- Преобразование в экран:

```text
x = 1.5 * radius * q
y = sqrt(3) * radius * (r + q / 2)
```

- Объектный frame: `320 × 384`, anchor `(160, 376)`.
- Все footprint координаты задаются локальными axial offsets от origin.

## Слои ассета

Никогда не запекать всё в один PNG.

```text
terrain tile
  + shoreline overlay
  + road/bridge overlay
  + district perimeter/fence
  + foundation/decal
  + building sprite
  + construction FX/status marker
```

Это позволяет одному и тому же дому стоять на траве, песке или возле воды без несовпадающих материалов.

## Style contract

Файл `style-tokens.json` должен фиксировать:

- рабочую палитру 48–64 цветов;
- нейтральный outline и его толщину;
- направление света: сверху-слева;
- направление и непрозрачность теней;
- масштаб этажа и двери;
- насыщенность/контраст terrain;
- допустимый размер здания для каждого footprint;
- pixel-grid, nearest-neighbour и запрет случайного antialiasing;
- уровень детализации: читается при масштабе карты 50–100%;
- единый front-facing азимут здания;
- эталонные изображения grass, water, roof, brick, wood, asphalt, glass.

## Terrain

- Terrain tile не имеет цветной обводки.
- Допустима нейтральная внутренняя тень/шов максимум 1–2 px, одинаковая во всём паке.
- Цвета берутся только из общего material atlas.
- Вариативность создаётся декалями: трава, цветы, камни, а не новой несовместимой базой.
- Water/shore строится как terrain + edge transition mask по соседям.

## Дороги

### Road topology

Каждый road cell хранит шестибитную `connectionMask` от `0` до `63`.

```text
mask = Σ(1 << direction) для каждого соединённого соседа
```

Для любой связи A→B соответствующий противоположный bit у B обязателен. Валидатор блокирует односторонний визуальный разрыв.

### Road raster generation

Дороги выпекаются офлайн детерминированным генератором:

1. взять прозрачный `256 × 222` canvas;
2. вычислить центр гекса и точные midpoints шести рёбер;
3. для каждого установленного бита построить centerline от центра до midpoint;
4. для двух соединений построить прямую или quadratic Bézier с фиксированным turn radius;
5. для трёх и более — объединить ветви с круглым junction cap;
6. нарисовать слоями shoulder → curb → asphalt → markings;
7. для endpoint оставить стандартный turnaround/road cap;
8. сохранить прозрачный road overlay без травы;
9. сгенерировать все 64 masks и contact sheet.

Поворот готового pixel-art PNG на 60° не является источником истины: он создаёт разное сглаживание. Каждая маска выпекается из векторной centerline одним генератором.

### Проверки дорог

- endpoint каждой ветви совпадает с midpoint ребра с допуском 0 px;
- ширина asphalt и curb одинакова у всех masks;
- соседние тайлы дают непрерывность при alpha-composite;
- markings не выходят за asphalt;
- mask и фактические alpha-пиксели на каждом edge совпадают;
- проверяются все 64 masks и все 6 соседних направлений;
- golden screenshot содержит прямую, S-поворот, T-junction, 4/5/6-way и dead end.

## Мосты

- Дорога остаётся частью road graph.
- Если road cell пересекает water, `structureKind = BRIDGE`.
- Bridge overlay использует ту же centerline, но добавляет опоры, настил и перила.
- Вход/выход моста совпадает с road endpoint на берегу.
- На MVP мосты только прямые или с одним мягким поворотом; сложные junction на воде запрещены placement cost.

## Границы города и sprint

Для множества занятых клеток:

1. перебрать шесть рёбер каждой клетки;
2. если сосед по этому ребру также входит в множество — ничего не рисовать;
3. иначе добавить ребро во внешний perimeter;
4. соединить последовательные рёбра в loops;
5. отрисовать loop как fence, hedge, low wall или мягкий цветной glow;
6. в местах пересечения с дорогой заменить сегмент воротами.

Так внутренние жёлтые линии полностью исчезают. Цвет sprint применяется только к perimeter/флажкам/выделению при выборе.

## Buildings

### Экспорт

- building PNG прозрачен и не содержит terrain hex;
- отдельный optional foundation/decal использует общий материал;
- пять стадий имеют одинаковые frame, anchor, orientation и максимальный silhouette box;
- тень либо отдельный sprite, либо строго стандартизованный слой;
- multihex building хранит footprint независимо от изображения.

### Генерация AI

Для каждой семьи сначала создаётся один `identity sheet`:

- completed hero sprite;
- palette/material swatches;
- silhouette;
- 5 stage strip;
- footprint и scale card;
- reference final sprite из предыдущей партии.

Промпт меняет только тип здания; камера, свет, палитра, outline, scale, background и anchors остаются неизменными. Генерировать все пять стадий в одном листе, чтобы снизить drift.

### Стадии

1. planning: колышки, разметка, материалы;
2. started/foundation: фундамент и подвод коммуникаций;
3. in progress: несущий каркас/этажи;
4. testing/finishing: почти завершённый объект, леса и проверка;
5. complete: чистое здание без строительного мусора.

Неизменяемые детали между стадиями проверяются perceptual diff; финальный силуэт стадии 4 должен совпадать со стадией 5 по footprint и ориентации.

## Автоматическая верификация asset pack

### Structural

- PNG RGBA;
- ожидаемые размеры;
- прозрачные углы;
- запрещённый chroma-key отсутствует;
- anchor находится внутри canvas;
- filename/catalog key/schema version валидны;
- sprite bbox не пересекает forbidden margin.

### Geometry

- terrain alpha совпадает с математической hex mask;
- road endpoints соответствуют mask;
- building footprint/anchor совпадает на всех стадиях;
- multihex local offsets связны и не дублируются;
- объект не занимает гекс вне footprint.

### Style

- доля цветов вне утверждённой палитры ниже порога;
- средняя light direction и shadow hue в допуске;
- outline thickness согласован;
- grass/road материалы не встроены в building PNG;
- сравнение с эталонным contact sheet.

### Scene regression

CI собирает фиксированную сцену по seed:

- 3 terrain variants;
- shoreline;
- road network со всеми типами поворотов;
- два одно-гексовых и два multihex buildings;
- все пять стадий;
- один city perimeter и два sprint perimeters.

Screenshot сравнивается perceptual diff. Новый pack нельзя принять только по отдельным красивым спрайтам — он обязан пройти сцену.

## Asset registry

Каждый ассет имеет:

- `assetId`, `catalogKey`, `version`;
- provenance: generated/authored/procedural;
- prompt/reference hashes;
- palette/style version;
- frame/anchor/footprint;
- supported stages/rotations;
- license;
- validation report checksum.

## Definition of Done для нового здания

- [ ] заполнена запись каталога;
- [ ] есть пять стадий;
- [ ] нет baked terrain;
- [ ] footprint проходит placement tests;
- [ ] палитра и outline проходят style validator;
- [ ] контактный лист одобрен;
- [ ] фиксированная игровая сцена проходит visual regression;
- [ ] asset provenance сохранён.

