# Каталог зданий V4

Runtime source of truth — `assets/pixel-city-pack-v4/manifest.json`. `src/shared/catalog.ts` только типизирует manifest и предоставляет его одинаково серверу и PixiJS-клиенту.

Сейчас каталог содержит 46 семейств и пять стадий каждого. Вариант описывает:

- стабильный `key`, русское название и category;
- `spriteSize` в пикселях, кратный 8;
- `footprintCells`, нижний центральный `anchorPx` и входы;
- пять PNG одинакового canvas;
- platform, допустимые estimates, tags и rarity;
- `ruleIds`, `maxPerCity`, `maxPerDistrict` и optional `serviceRole`.

## Слои рендера

1. Base terrain `8×8`.
2. Surface: тротуар, коричневая дорожка, driveway или shoulder.
3. Дорога/мост и приглушённый curb только на границе с surface.
4. Опциональная цветная граница района.
5. Платформа участка: `YARD | STONE | ASPHALT | SERVICE | PARK`.
6. Props, здание нужной стадии и локальные машины/пешеходы.
7. UI badge стадии 1–5 в нижнем углу здания; hover показывает название, статус, процент и короткое описание задачи.

Платформа не запекается в terrain. Footprint задаёт occupancy, а прозрачный PNG может выходить вверх за его границы. Вход и подход к тротуару хранятся отдельно; будущие дороги не могут пересекать ни footprint, ни опубликованный подход. Здания сортируются по нижней координате.

## Добавить процедурный вариант без изменения приложения

Добавьте объект в `assets/pixel-city-pack-v4/catalog/generated-buildings.json`:

```json
{
  "key": "house-yellow-duplex",
  "label": "Жёлтый дуплекс",
  "spriteSize": [32, 32],
  "footprintCells": [4, 3],
  "wall": "#d3b46fff",
  "dark": "#80634aff",
  "roof": "#405268ff",
  "accent": "#62a2a6ff",
  "style": "duplex",
  "rarity": "COMMON",
  "category": "HOUSE"
}
```

Затем выполните `npm run assets:build && npm run assets:verify`. Builder создаст пять стадий, обновит manifest/public pack и перерисует contact sheet. Read-only audit отдельно проверит все runtime PNG: пять уникальных непустых стадий, сетку и footprint, bottom-center anchor, hard alpha, палитру до 32 цветов, одинаковую геометрию цветовых машин, отсутствие механического поворота ракурса, потерянных ссылок и лишних файлов.

## Подключить нарисованные вручную спрайты

1. Положите пять PNG в `assets/pixel-city-pack-v4/sources/<key>/`.
2. Добавьте запись в `catalog/imported-buildings.json` с `key`, metadata и массивом `stages` относительно каталога `sources`.
3. Запустите builder и тесты.

`assets:verify` ничего не перегенерирует, поэтому его следует запускать и после ручной правки PNG. Сейчас он покрывает 46 зданий / 230 стадий, 12 terrain families, 62 props и 4 цветовых семейства машин. Рыбацкие лодки, береговые рыбаки, разные действия жителей, ограждения, активный флаг и water-варианты с рыбами сначала сформированы AI-reference листами, а runtime-версии перерисованы детерминированным pixel builder; provenance хранится в manifest.

Imported entry может явно переопределить `platform`, `estimates`, `tags`, `ruleIds`, `entrances`, quotas и `serviceRole`. Новый обычный вариант не требует изменений TypeScript, базы или MCP.

## Добавить новое поведение

Визуальный вариант использует существующие правила. Если нужна новая механика:

1. добавить стабильный `ruleId` в `BuildingRuleId`;
2. реализовать handler в application service;
3. зарегистрировать ID в `REGISTERED_BUILDING_RULES` и asset validator;
4. добавить положительный, отрицательный и quota/property тест;
5. только после этого указать `ruleId` в данных здания.

Неизвестное правило является ошибкой сборки; молчаливого fallback нет. Сейчас зарегистрированы:

- `STANDARD` — обычный объект;
- `UNIQUE_SERVICE` — одна служебная роль в городе;
- `REQUIRES_COLLECTOR` — объект выбирается для дорожного коммерческого сценария.

Полные визуальные требования, пять стадий и checklist находятся в [GENERATION-SPEC](../assets/pixel-city-pack-v4/docs/GENERATION-SPEC.md).
