# Каталог зданий V4

Authoring source of truth — `assets/pixel-city-pack-v4/catalog/buildings.json`.
Runtime source of truth — `assets/pixel-city-pack-v4/manifest.json`.
`src/shared/catalog.ts` только типизирует manifest и предоставляет его одинаково серверу и PixiJS-клиенту.

Сейчас каталог содержит 193 семейства и пять стадий каждого. Вариант описывает:

- стабильный `key`, русское название и category;
- `spriteSize` в пикселях, кратный 8;
- `footprintCells`, нижний центральный `anchorPx` и входы;
- пять PNG одинакового canvas;
- platform, допустимые estimates, tags и rarity;
- `ruleIds`, `maxPerCity`, `maxPerDistrict` и optional `serviceRole`.

## Слои рендера

1. Base terrain `8×8`.
2. Surface: тротуар, грунтовая дорожка, мелкая плитка, тихий асфальт, driveway или shoulder.
3. Дорога/мост без отдельного бордюрного overlay; мостовые ограждения остаются только по внешней стороне пролёта.
4. Опциональная цветная граница района.
5. Платформа участка: `YARD | STONE | ASPHALT | SERVICE | PARK`.
6. Props, здание нужной стадии и локальные машины/пешеходы.
7. UI badge стадии 1–5 в нижнем углу здания; hover показывает название, статус, процент и короткое описание задачи.

Платформа не запекается в terrain. Footprint задаёт occupancy, а прозрачный PNG может выходить вверх за его границы. Вход и подход к тротуару хранятся отдельно; будущие дороги не могут пересекать ни footprint, ни опубликованный подход. Здания сортируются по нижней координате.

## Добавить или заменить визуальное семейство

1. Сохраните принятый горизонтальный лист из пяти стадий в
   `assets/pixel-city-pack-v4/reference/buildings/<key>/stages.png`.
2. Найдите стабильный ключ в `catalog/buildings.json`. Не меняйте геометрию,
   вход, лимиты и игровые теги при простой замене графики.
3. Запишите относительный `sheet`, SHA-256 файла и только после визуальной
   проверки установите `reviewed: true`:

```json
{
  "key": "house-yellow-duplex",
  "sheet": "buildings/house-yellow-duplex/stages.png",
  "sheetSha256": "<64 lowercase hex characters>",
  "reviewed": true
}
```

4. Выполните `npm run assets:build && npm run assets:verify`.

Builder проверяет digest, режет именно утверждённые пять стадий, нормализует их
без дорисовки геометрии, обновляет runtime/public pack и contact sheets.
Read-only audit проверяет 193 здания / 965 стадий: уникальность стадий, сетку и
footprint, bottom-center anchor, hard alpha, палитру до 32 цветов, потерянные
ссылки и лишние файлы. Runtime manifest не содержит сведений о происхождении
building art.

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
