# Tasks

## 1. Specification and contracts — complete

- Зафиксировать street profiles, surface layers, entrances, district archetypes, city morphology и roadside features.
- Определить backward-compatible chunk DTO.
- Verification: review `architecture.md` and contract tests.

## 2. Asset pack v6 — complete

- Нарисовать крупную АЗС в пяти стадиях, mixed-use новостройку в пяти стадиях.
- Нарисовать остановки двух ориентаций, городские знаки, guardrail/roadside props и walkers.
- Нарисовать grid-aligned площадку и переиспользовать отдельные деревья, скамейки, столы, урны и фонари для зелёных зон.
- Добавить provenance и строгую проверку размеров/палитры/alpha.
- Verification: `npm run assets:build && npm run test -- tests/catalog.test.ts`.

## 3. Mobility-aware generator — complete

- Генерировать street centerlines, профили асфальт/тротуар и отдельные paths.
- Выбирать manifest entrance, строить ограниченный A* до sidewalk.
- Замораживать всю инфраструктуру SEALED-района.
- Verification: world audit, growth lifecycle, targeted tests.

## 4. District morphology and civic coverage — complete

- Назначать city morphology и district archetype детерминированно.
- Скоринг каталога по archetype, соседству, нуждам и плотности.
- Гарантировать civic coverage на порогах роста без замены явно выбранного типа задачи.
- Verification: catalog distribution/property tests on multiple seeds.

## 5. Intercity roadside features — complete

- Публиковать city-entry signs, bus stops и service area на безопасных клетках.
- Привязывать остановки к sidewalk, АЗС — к driveway/road.
- Verification: 5–10 city fixture, no overlap/water conflicts, renderer snapshot.

## 6. UI and local life simulation — complete

- District overlay off by default, selected/hover reveal.
- Hide completed badges; retain stages 1–4 and selection.
- Добавить lightweight cars/walkers over loaded graphs.
- Verification: Playwright desktop journey and screenshot review.

## 7. Review and finish — complete

- Focused code review, stale-code pass, docs finalization.
- Full commands: `npm run lint`, `npm run typecheck`, `npm test`, growth/multicity scripts, `npm run build`, Playwright.

## 8. District green spaces — complete

- Публиковать парк/рощу как AREA до нарезки участков, не создавая фиктивную task.
- Подключать площадь к sidewalk коротким path и размещать декор как дочерние props.
- Кэшировать снимок занятости на район, чтобы перебор площадок не создавал квадратичную нагрузку.
- Verification: dense audit, ten-seed soak, 100-task lifecycle and 10-city scale fixture.
