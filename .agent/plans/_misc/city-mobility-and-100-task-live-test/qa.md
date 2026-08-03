# QA

## Preconditions

- Отдельная SQLite база и фиксированный seed.
- Один город, пять районов, 20 задач в каждом; 26 SP на район.
- Desktop viewport 1440×900.

## Positive scenarios

1. Создать город и первый район; добавлять задачи по одной до 20.
2. Добавить ещё два района и продолжить до 60 задач.
3. Добавить последние два района и продолжить до 100 задач.
4. На каждом checkpoint открыть город, дождаться chunk loading, снять screenshot.

## Negative scenarios

- Task footprint не пересекает road/task и остаётся внутри district.
- Дороги остаются одной компонентой.
- Районы не пересекаются и входят в расширенные city bounds.
- Ни один checkpoint не превышает SP capacity.
- Зафиксировать здания без непосредственного road frontage и требуемую длину pedestrian path.

## Logs and performance

- Console errors: 0.
- Generation checkpoint <30 s.
- Resident chunks <200.
- Сравнить city bounds и площадь районов на 20/60/100.

## Expected result

Рост остаётся технически корректным, а визуальный тест показывает, на каком количестве районов текущая road grammar теряет читаемость и где нужен sidewalk/entrance слой.

## Result — 2026-08-03

- PASS: checkpoints 20/60/100 созданы через публичные методы сервиса.
- PASS: spatial audit на каждом checkpoint, console errors 0.
- PASS: существующие task/district geometry не изменилась.
- FAIL: SEALED infrastructure immutability — 15 + 2 новых road cells внутри предыдущих районов.
- FAIL: entrance walkability — 5 из 100 входов недоступны, 76 требуют отсутствующий runtime path.
- Visual: district contours и completed badges становятся шумом на 100 задачах.

Screenshots:

- `screenshots/live-growth-20.png`
- `screenshots/live-growth-60.png`
- `screenshots/live-growth-100.png`
