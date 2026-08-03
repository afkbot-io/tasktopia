# Tasks

## 1. Geometry contract — in progress

- Вынести штамповку corridor в тестируемую функцию.
- Исправить widening поверх существующей сети и канонические углы.
- Добавить property tests для straight/corner/T/X и mixed widths.
- Verification: `npx vitest run tests/road-geometry.test.ts tests/app-service.test.ts`.

## 2. Mobility surfaces — pending

- Генерировать sidewalk после нормализованной оболочки.
- Добавить CROSSWALK cells и правильную ориентацию спрайта.
- Ограничить car graph продольным движением и корректными поворотами.
- Verification: surface graph tests + browser agents smoke.

## 3. Strict district zoning — pending

- Разделить semantic role и compatible massing.
- Добавить hard eligibility и квоты support/civic buildings.
- Сделать morphology проверяемым city profile.
- Verification: catalog property tests and 30-task district composition audit.

## 4. Representative fixtures — pending

- Metropolis: 20 districts × 10 tasks = 200.
- Несколько малых городов с разными morphology/archetypes.
- Lifecycle: 1 ACTIVE + 1 PLANNED + остальные COMPLETED на город.
- Verification: fixture status/composition tests and world audit.

## 5. Review and finish — pending

- Full unit/lint/type/build, growth, scale and soak.
- Desktop/zoom/district/large-city screenshots and console review.
- Docs/changelog/QA update and final server start.

