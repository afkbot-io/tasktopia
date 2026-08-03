# QA

## Preconditions

- Pillow runtime доступен через Codex workspace Python.
- Все chroma-source сохранены отдельно от очищенных PNG.

## Positive scenarios

1. Запустить сборщик и получить 32 семейства/160 стадий.
2. Открыть каталоги: все пять стадий каждого нового здания различимы.
3. Открыть город: здания стоят на платформах, не пересекают дороги и соседей.
4. Проверить декор на траве, тропинке и тротуаре.

## Negative scenarios

- Мягкий alpha вызывает ошибку validation.
- Неверный canvas вызывает ошибку validation.
- Пустой сегмент source sheet вызывает ошибку normalization.
- Props не должны содержать фон/тайл земли.

## Expected results

Сборка детерминирована; существующие ids сохранены; новые ассеты визуально едины с V3.

## Verification evidence

- Asset processor: passed; 32 families, 160 stages, 8 vehicle sprites, 17 props.
- Asset audit: all five stages are byte-distinct per family; all runtime alpha values are 0/255; no magenta fringe detected.
- Unit tests: `npm test` — 3 files and 13 tests passed.
- Production build: `npm run build` — TypeScript, Vite and server bundle passed.
- Visual QA: commercial, house, civic, prop catalogs and first-city proof inspected at nearest-neighbor scale.
