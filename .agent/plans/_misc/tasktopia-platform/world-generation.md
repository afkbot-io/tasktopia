# Генерация страны, городов, дорог и районов

> **Заменено 2026-08-02:** документ описывает прежний axial-hex вариант и сохранён только как история. Актуальная квадратная архитектура 8×8, алгоритмы расширения и результаты эксперимента находятся в `../square-world-generation-v3/overview.md` и `../square-world-generation-v3/architecture.md`.

## Принцип бесконечного мира

Страна не создаётся как миллионы строк. При создании сохраняются:

- `countrySeed`;
- `generatorVersion`;
- стартовая камера;
- пустой индекс городов и дорожной сети.

Terrain chunk появляется только при первом запросе или когда worldgen job должен проверить участок. Одинаковые seed/version/coordinates всегда дают одинаковый результат.

## Chunk model

- Chunk: axial parallelogram `32 × 32` hexes.
- Ключ: `(countryId, chunkQ, chunkR, generatorVersion)`.
- Base terrain: сжатый массив palette/biome/elevation/water flags.
- Overlay: дороги, города, районы, здания и пользовательские изменения хранятся отдельно.
- Client загружает viewport + 1 chunk margin.
- При быстром pan старые запросы отменяются через `AbortController`.
- LRU удерживает ограниченное число chunk containers и textures.
- Генерация/декодирование payload выполняется в worker thread/Web Worker, где это оправдано.

## Terrain generation

Для каждого hex:

1. sample low-frequency continental noise;
2. sample elevation/moisture noise;
3. определить water/land/biome;
4. применить deterministic decoration hash;
5. вычислить shoreline mask по шести соседям.

Генератор обязан иметь golden seeds и не меняться без новой версии.

## Выбор места города

### Macro search

1. Создать candidate points по seeded Poisson-disc/spiral search.
2. Минимальная дистанция между city centers: 96 hexes в MVP.
3. Отклонить участок, если пригодной суши вокруг центра недостаточно.
4. Предпочитать умеренно плоский участок возле воды, но не внутри большой реки/озера.
5. Оценить стоимость соединения с существующей дорожной сетью.
6. Зарезервировать city site транзакционно.

Если место занял параллельный job, поиск продолжается со следующего кандидата.

## Начальная граница города

- Seed: city center.
- Target: 30 cells, включая дороги и сервисный резерв.
- Weighted polyhex growth выбирает соседнюю клетку по:
  - близости к центру;
  - пригодности terrain;
  - compactness;
  - будущему road frontage;
  - штрафу за узкие «щупальца» и разрыв.
- Результат должен быть одним связным компонентом без дыр для MVP.

Граница хранится как cells, а perimeter вычисляется из внешних рёбер.

## Внутригородская дорога

### Первый город

1. выбрать две подходящие boundary edges примерно на противоположных сторонах;
2. построить путь через клетки возле center;
3. применить A* с turn penalty, чтобы избежать «лесенки»;
4. сохранить road graph и connection masks;
5. оставить внешние stubs, которые позже можно соединить с сетью.

### Следующие города

1. найти ближайший существующий road network node с учётом terrain cost;
2. macro A* строит corridor между chunk regions;
3. detailed hex A* строит непрерывную цепь клеток внутри corridor;
4. cost учитывает длину, повороты, воду, склон, существующие дороги и резервные территории;
5. существующая дорога имеет отрицательный бонус, поэтому новые города подключаются к сети, а не создают параллельные трассы;
6. crossing water создаёт bridge cells;
7. road masks пересчитываются только для изменённых клеток и их соседей.

Мир не «перегенерируется». Base terrain неизменен; добавляется versioned road overlay.

## Проверка road route

- каждая следующая клетка является одним из шести соседей;
- путь связан от source до target;
- нет самопересечения без junction;
- every edge reciprocal;
- максимальная серия резких чередующихся поворотов ограничена;
- мост начинается и заканчивается на корректном берегу;
- route не занимает зарезервированное building footprint;
- job повторяем и идемпотентен.

## Создание sprint/district

### Inputs

- project/city;
- sprint name/goal/capacity;
- active/plan status;
- текущая граница и занятость города.

### Placement

1. найти road frontage с доступными соседними cells;
2. выбрать seed по одну или обе стороны дороги;
3. вырастить связный polyhex на 14 buildable cells;
4. road cells входят в district view, но не уменьшают buildable capacity;
5. штрафовать узкие формы, разрыв, воду и отсутствие второго выхода;
6. если внутри city boundary места нет — компактно расширить city boundary;
7. зарезервировать cells одной транзакцией;
8. построить внешний perimeter и gates на пересечениях с дорогой.

District может иметь различную форму, но обязан:

- быть связным;
- иметь road access;
- не пересекать другой sprint;
- иметь минимум 70% клеток, пригодных для каталога 1-hex;
- иметь хотя бы один допустимый участок 2–3 hex, если capacity ≥ 6 SP.

## Расширение района

При нехватке места:

1. рассчитать требуемый footprint;
2. искать свободный contiguous patch внутри district;
3. если нет — расширить district на 2–6 frontier cells;
4. обновить city boundary при необходимости;
5. перестроить только внешний perimeter;
6. отправить `district.expanded` и `chunk.invalidated`.

## Размещение здания

1. получить список допустимых catalog entries по estimate/semantic tags;
2. получить footprint templates и rotations;
3. найти свободные placements возле дороги/пешеходного доступа;
4. вычислить score здания и участка;
5. выбрать детерминированно из top-K по task seed;
6. зарезервировать cells;
7. создать building stage 1;
8. если placement не найден, расширить district или выбрать меньший совместимый entry;
9. никогда молча не накладывать два здания.

## Score выбора здания

```text
score =
  unmetCityNeed * 4
  + unmetDistrictNeed * 3
  + semanticMatch * 3
  + frontageQuality * 2
  + visualDiversity * 2
  + footprintFit * 2
  + adjacencySynergy
  - duplicatePenalty * 3
  - uniqueQuotaPenalty * 10
  - terrainMismatch * 5
```

Выбор делается из top-3/top-5 с seeded random, чтобы города не были одинаковыми, но оставались воспроизводимыми.

## Estimate → физический масштаб

| Estimate | Типичный результат | Допустимый footprint |
| ---: | --- | --- |
| 1 | киоск, декор, маленький дом или группа 2–3 micro props | 1 hex |
| 2 | обычный дом/магазин/сервис | 1 hex |
| 3 | крупный дом, клиника, парковка, небольшой комплекс | 1–2 hex |
| 6 | landmark, полиция, пожарная часть, театр, ТЦ | 2–3 hex |

Это веса выбора, а не жёсткое равенство. Семантика задачи и потребности города могут выбрать меньший footprint.

## Детерминизм и миграции

- Все random decisions используют named seed streams: `terrain`, `city-site`, `city-shape`, `road`, `district`, `building-choice`.
- Добавление нового random call в один stream не должно менять остальные.
- Generator changes требуют новой version и golden seed diff.
- Уже созданные города не перемещаются после обновления генератора.
