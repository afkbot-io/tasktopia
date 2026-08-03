# Square World Generation V3 — недостающий каталог спрайтов

## 1. Единый контракт

- Базовая клетка и любой тайл покрытия: `8×8 px`.
- Размеры объектов кратны 8 по ширине и высоте.
- Terrain/infrastructure тайлы не имеют прозрачных внешних полей.
- Props и здания имеют прозрачный фон и `anchorPx` в manifest.
- Рендер только `nearest-neighbor`, integer coordinates и integer zoom steps для pixel-perfect режима.
- Одна палитра, один размер художественного пикселя, одно направление света.
- Здание всегда включает собственную платформу/двор, геометрически кратные footprint; platform cells занимают `Parcel` layer.
- Коллизия задаётся footprint в клетках, а не непрозрачными пикселями изображения.

## 2. Базовые материалы 8×8

| Семейство | Минимум вариантов | Правило |
|---|---:|---|
| grass | 4 | нейтральная база, редкие точки/травинки |
| meadow | 3 | светлее grass, без крупных цветов внутри base |
| sand | 3 | сухой песок |
| wet_sand | 2 | тёмная полоса у воды |
| clay | 3 | тёплая красно-коричневая земля |
| stone | 3 | природная каменная поверхность |
| shallow_water | 4 | спокойная вода у берега |
| deep_water | 4 | более тёмная вода |
| dirt | 3 | строительная/вытоптанная земля |

Вариант выбирается hash клетки, но соседние клетки не должны образовывать шахматный паттерн. Крупная форма определяется terrain field, мелкая фактура — variant hash.

## 3. Переходы материалов

Не рисовать отдельный готовый тайл для каждой комбинации. Поверх нижнего материала составляются прозрачные 8×8 overlays:

- четыре прямых края `N/E/S/W`;
- четыре внешних угла `NE/SE/SW/NW`;
- четыре внутренних угла;
- по 2–3 декоративных варианта важного края.

Приоритет наложения: `deep water < shallow water < wet sand < sand < grass/meadow < clay/stone`. Первые обязательные пары: water→wet_sand, wet_sand→sand, sand→grass, grass→stone, grass→clay. Это даёт естественный берег без жёлтых линий между клетками.

## 4. Дороги, тротуары и тропы

### Base 8×8

- asphalt: 3 бесшовных варианта;
- sidewalk/paving: 3 варианта;
- dirt path: 3 варианта;
- parking asphalt: 2 варианта;
- construction dirt: 2 варианта.

### Overlays 8×8

- curb `N/E/S/W` и четыре угловых окончания;
- bridge rail `N/E/S/W`;
- optional center marking horizontal/vertical;
- crosswalk horizontal/vertical — один 8×8 сегмент, повторяемый по ширине перехода;
- drain, manhole и repair patch как редкий overlay.

Перекрёстки, T-ветви и повороты не являются отдельными большими спрайтами. Asphalt заполняет road cells, curb появляется только на стороне без соседней road cell. Поэтому 4-битная маска соединений автоматически собирает любую конфигурацию.

## 5. Вода и мост

Water остаётся base material. Мост рисуется слоями: water → bridge deck/asphalt 8×8 → bridge rail overlays → vehicle/prop. Нужны также 2 варианта опоры 8×8, 2 варианта пены/течения 8×8 и тень моста. Rail не заменяет соседний water tile — река визуально продолжается под мостом.

## 6. Природные props

| Объект | Размер | Варианты |
|---|---:|---:|
| deciduous tree | 8×16 | 4 |
| pine tree | 8×16 | 4 |
| dry tree | 8×16 | 2 |
| bush | 8×8 | 5 |
| flowers | 8×8 | 8 цветовых/форменных групп |
| small stone | 8×8 | 5 |
| rock cluster | 16×8 / 16×16 | 4 |
| reed | 8×8 | 3 |
| stump/log | 8×8 / 16×8 | 3 |

У каждого prop есть `allowedMaterials`, `clearanceCells`, density и cluster rule. Входы, дороги, crosswalk и фасадная клетка здания являются exclusion zones.

## 7. Городской декор

| Объект | Размер | Варианты |
|---|---:|---:|
| street lamp | 8×16 | 3 |
| power pole | 8×16 | 3 + connected wire overlay |
| bench | 8×16 и 16×8 | 3 материала × 2 направления |
| trash bin | 8×8 | 4 |
| hydrant | 8×8 | 2 |
| mailbox | 8×8 | 3 |
| traffic sign | 8×16 | 6 лицевых знаков × 2 направления |
| bus stop sign | 8×16 | 2 направления |
| bus shelter | 16×16 | 3 палитры × 2 направления |
| planter | 8×8 | 4 |
| bollard | 8×8 | 3 |
| bike rack | 8×8 / 16×8 | 2 |
| construction cone/barrier | 8×8 / 16×8 | 4 |

Bus stop размещается только на collector/arterial с тротуаром, не ближе заданного расстояния к перекрёстку и всегда имеет pedestrian access.

## 8. Каталог зданий

Текущий `pixel-city-pack-v3` остаётся начальной библиотекой. Для каждого семейства manifest обязан содержать `id`, `category`, `spriteSizePx`, `footprintCells`, `entrances`, `anchorPx`, `allowedRotations`, `platform`, `stages`, `tags`, `rarity`, `cityQuota` и `districtQuota`.

Кроме готовых семейств нужны вариации платформ: asphalt parking, light paving, fenced construction dirt, private grass yard, industrial concrete. Все пять стадий одного здания используют одинаковые canvas, footprint, anchor, входы и платформу.

## 9. Автоматическая проверка asset pack

CI валидирует:

- PNG без интерполяции и неожиданных полупрозрачных пикселей;
- размеры кратны 8;
- stage canvases абсолютно одинаковы по размеру;
- footprint/anchor не выходят за допустимые границы;
- вход существует на заявленной стороне;
- tile seams: склейка 10×10 одинаковых/соседних материалов без полос;
- road/curb masks: все 16 комбинаций;
- contact sheet всей семьи и тестовая мини-карта;
- отсутствие дублирующихся IDs и пропущенных manifest fields.

## 10. Порядок дорисовки

1. Base materials и берега.
2. Asphalt/sidewalk/path/curb/bridge overlays.
3. Цветы, кусты, камни и расширение деревьев.
4. Остановки, городской декор и construction props.
5. Недостающие платформы зданий и entrances metadata.
6. Дополнительные здания по выявленным quota gaps после генерации 10 городов.

