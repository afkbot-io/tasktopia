# Визуальная база для полной регенерации оставшихся зданий

Дата исследования: 2026-08-16
Область: первичные файлы репозитория — project skills, спецификации, geometry
contracts, authored PNG, runtime PNG и verifier reports. Ассеты не изменялись.

## Вывод

Оставшиеся старые civic/landmark/archive-семейства нельзя закрывать уменьшением
двери или подгонкой `geometry.json`. Их входы уже слишком малы после
нормализации, потому что весь исходный фасад построен в другом человеческом
масштабе. Правильный путь: заново создать и принять finished `stage 5` с
каноническим входом и согласованными этажами, окнами, порталом и верхними
плоскостями, затем независимо вывести из него `stage 4`, после него `stage 3`.

Metadata описывает линейку приёмки, но не меняет пиксели. Если просто записать
`doorLeafSizePx: [12, 14]`, verifier нарисует правильную линейку поверх
неправильной двери. Если локально увеличить только дверь, она столкнётся с
существующим порталом, карнизом и первым этажом. Если масштабировать весь старый
растр ради двери, здание выйдет за canvas/footprint либо будет сжато по одной
оси. Все три варианта прямо запрещены контрактами генератора и verifier.

## Изученные skills и первичные контракты

- [`tasktopia-pixel-city-art/SKILL.md`](../../.agents/skills/tasktopia-pixel-city-art/SKILL.md)
  задаёт общую визуальную грамматику, native `1x`/nearest-neighbour `4x` review,
  отдельные authored стадии 3–5 и обязательную связку generator + verifier.
- [`visual-grammar.md`](../../.agents/skills/tasktopia-pixel-city-art/references/visual-grammar.md)
  фиксирует 8 px grid, strict frontal-top, hard alpha, палитру, свет и
  человеческий масштаб.
- [`production-acceptance.md`](../../.agents/skills/tasktopia-pixel-city-art/references/production-acceptance.md)
  требует принять stage 5 первым, выбрать два benchmark-изображения той же
  категории и запрещает axis stretching.
- [`tasktopia-building-stage-generator/SKILL.md`](../../.agents/skills/tasktopia-building-stage-generator/SKILL.md)
  закрепляет порядок `5 -> 4 -> 3`, immutable authority stage 5 и правило
  «regenerate, не squeeze/crop/translate».
- [`reverse-stage-prompts.md`](../../.agents/skills/tasktopia-building-stage-generator/references/reverse-stage-prompts.md)
  даёт точный invariant block для одного изображения на один запрос.
- [`tasktopia-building-stage-verifier/SKILL.md`](../../.agents/skills/tasktopia-building-stage-verifier/SKILL.md)
  разделяет автоматическую геометрию и обязательный ручной visual gate.
- [`geometry-contract.md`](../../.agents/skills/tasktopia-building-stage-verifier/references/geometry-contract.md)
  задаёт дверь, footprint, projected depth, anchor, stage ratios и rulers.
- [`imagegen/SKILL.md`](/Users/kikasnikita/.codex/skills/.system/imagegen/SKILL.md)
  подтверждает встроенный image generation как основной путь, одно изображение
  на запрос, явные роли reference/edit target, сохранение инвариантов и одну
  целевую правку на итерацию.
- [`GENERATION-SPEC.md`](../../assets/pixel-city-pack/docs/GENERATION-SPEC.md),
  [`SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md`](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md)
  и [`V5-ASSET-MIGRATION-STATUS.md`](../../assets/pixel-city-pack/docs/V5-ASSET-MIGRATION-STATUS.md)
  являются проектным ТЗ и release checklist.

Skill ожидает style-reference
`screenshots/pixel-city-v4-expanded-assets.png`, но такого файла в текущей
рабочей копии нет. Поэтому визуальная база ниже построена на принятых
building-specific source PNG и их независимых grid/geometry previews — это
более прямые первичные артефакты текущего V5-контракта.

## Какой именно ракурс нужен

Это не изометрия и не перспектива с заданным углом в градусах. Камера описана
экранной геометрией:

- фасад строго параллелен экрану;
- вертикали вертикальны, этажи и края верхних плоскостей горизонтальны;
- боковая уходящая стена отсутствует; допустим лишь узкий тёмный depth cue не
  шире `max(2 px, 8% sprite width)`;
- сверху видна неглубокая сжатая плоскость; один и тот же вектор глубины
  применяется к roof, porch, canopy, steps/landing, balcony, podium, setback,
  terrace и crown;
- свет идёт сверху-слева: верх светлее, правые/нижние плоскости темнее.

Иными словами, «наклон» задаётся не поворотом здания, а одинаковой малой
видимостью всех горизонтальных top planes. У сильных просмотренных примеров
`projectedRoofDepthCells = 2`, а отношение projected/physical depth равно
примерно 22–29%: hospital `2/9 = 22.2%`, community center `2/7 = 28.6%`, cinema
`2/7 = 28.6%`. Эти числа не надо копировать во все здания: authoritative
значение измеряется по принятому stage 5 каждого семейства.

## Сильные принятые примеры

Все три примера повторно запущены через текущий verifier по текущим source PNG;
`acceptedByCode: true`, errors отсутствуют. Визуальная приёмка ниже основана на
source PNG и geometry previews, а не только на JSON.

### 1. `civic-community-center-v5` — основной civic benchmark

Просмотрено:

- [`stage-3.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-community-center-v5/sources/stage-3.png)
- [`stage-4.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-community-center-v5/sources/stage-4.png)
- [`stage-5.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-community-center-v5/sources/stage-5.png)
- [`geometry.json`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-community-center-v5/geometry.json)

Почему это хороший ориентир: широкий public facade остаётся строго фронтальным;
центральное остекление, портал, боковые крылья и roof line сохраняют одну
идентичность. Двойной вход имеет module `16x16`, leaves `12x14`. Canvas
`96x80`, physical footprint `12x7`, projected roof depth `2` клетки. Stage 3
имеет 64.4% финальной высоты, stage 4 сохраняет 100%; центр и baseline не
уезжают. Строительные элементы следуют фасаду, а не заменяют его.

### 2. `commercial-cinema-v5` — benchmark читаемости и масштаба

Просмотрено:

- [`stage-3.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/commercial-cinema-v5/sources/stage-3.png)
- [`stage-4.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/commercial-cinema-v5/sources/stage-4.png)
- [`stage-5.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/commercial-cinema-v5/sources/stage-5.png)
- [`stage-5 geometry preview 4x`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/commercial-cinema-v5/verification/stage-5-geometry-4x.png)
- [`report.json`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/commercial-cinema-v5/verification/report.json)

Canvas `96x72`; stage 5 занимает 88 px по ширине и всю высоту. Двойная дверь
остаётся полноценным `16x16` модулем и не теряется в декоративном портале.
Фасад читается в `1x` за счёт крупных кластеров и одной сильной cinema-детали,
а не текста. Stage 3 — 63.9% финальной высоты, stage 4 — 100%; verifier проходит
без warnings.

### 3. `civic-hospital-v5` — benchmark сложных top planes

Просмотрено:

- [`stage-3.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-hospital-v5/sources/stage-3.png)
- [`stage-4.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-hospital-v5/sources/stage-4.png)
- [`stage-5.png`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-hospital-v5/sources/stage-5.png)
- [`stage-5 geometry preview 4x`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-hospital-v5/verification/stage-5-geometry-4x.png)
- [`geometry.json`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-hospital-v5/geometry.json)

Здесь особенно полезны roof plant, центральный glazed bay, боковые объёмы и
нижние навесы: на всех видны согласованные неглубокие верхние плоскости без
уходящей боковой стены. Canvas `112x96`, double door `16x16`/`12x14`, projected
depth `2/9`. В текущем повторном прогоне stage 3 находится у верхней жёсткой
границы (80% против предпочтительных 55–65%), поэтому hospital хорош как
projection/door/style benchmark, но не как целевой образец высоты stage 3.

Дополнительно просмотрен `civic-animal-shelter-v5`: низкий широкий фасад хорошо
показывает сохранение человеческой двери в одноэтажном civic-объекте, однако его
stage 3 также выше предпочтительной зоны (76.1%), поэтому он не выбран главным
stage-progression benchmark.

## Проблемные remaining-примеры

### 1. `civic-library-v5`

Просмотрено:

- [`source stage 5`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-library-v5/sources/stage-5.png)
- [`source stage 4`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-library-v5/sources/stage-4.png)
- [`runtime stages 3-5`](../../assets/pixel-city-pack/runtime/buildings/civic/civic-library/stage-5.png)
- [`geometry.json`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-library-v5/geometry.json)

Наблюдение: source — большой RGB/chroma presentation render около `1161x1355`,
а не прозрачный native-grid source. После сведения к `96x112` вход становится
миниатюрным относительно четырёхэтажного ритма; книжные полки, тонкие пилястры и
мелкая кирпичная сетка превращаются в шум. Верх выглядит преимущественно как
плоская elevation-полоса, а не как единая shallow top plane. Stage ratios сами
по себе формально правдоподобны (`3 = 67%`, `4 = 100%` финальной высоты), но это
не исправляет неверный человеческий масштаб.

Geometry заявляет double module `16x16`, но не содержит явного
`doorLeafSizePx`; verifier подставляет legacy default `[6,14]` и блокирует
double door, для которой обязательно `[12,14]`. Добавление `[12,14]` в JSON не
увеличит нарисованный вход.

### 2. `civic-museum-v5`

Просмотрено:

- [`source stage 5`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-museum-v5/sources/stage-5.png)
- [`runtime stage 3`](../../assets/pixel-city-pack/runtime/buildings/civic/civic-museum/stage-3.png)
- [`runtime stage 4`](../../assets/pixel-city-pack/runtime/buildings/civic/civic-museum/stage-4.png)
- [`runtime stage 5`](../../assets/pixel-city-pack/runtime/buildings/civic/civic-museum/stage-5.png)
- [`geometry.json`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/civic-museum-v5/geometry.json)

Наблюдение: исходник `1402x1122` перегружен тонкой классической лепниной,
фризом и множеством оконных экспонатов. При `112x112` эта детализация становится
одно-пиксельным шумом, а центральная двойная дверь визуально ниже одного
канонического 16 px модуля. Здание почти фронтальная elevation: top plane
выражена неуверенно, ступени/landing и крыша не дают убедительно одинакового
compressed-depth языка. Stage ratios (`62%`, `98.7%`, `100%`) и baseline
проходоподобны, но визуальный door/projection gate остаётся блокирующим.

### 3. `landmark-concert-hall-v5`

Просмотрено:

- [`source stage 5`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/landmark-concert-hall-v5/sources/stage-5.png)
- [`runtime stage 3`](../../assets/pixel-city-pack/runtime/buildings/civic/landmark-concert-hall/stage-3.png)
- [`runtime stage 4`](../../assets/pixel-city-pack/runtime/buildings/civic/landmark-concert-hall/stage-4.png)
- [`runtime stage 5`](../../assets/pixel-city-pack/runtime/buildings/civic/landmark-concert-hall/stage-5.png)
- [`geometry.json`](../../assets/pixel-city-pack/reference/ai-authored/building-stage-study/landmark-concert-hall-v5/geometry.json)

Это наиболее очевидный projection/style reject. Боковые крылья уходят назад,
криволинейная база образует трёхчетвертной/сценический ракурс, верхние объёмы
используют разные направления глубины. Source содержит эффектный градиентный
presentation background/glow и значительно более богатое освещение, чем muted
V5 palette. После нормализации к `128x104` остаются мелкие входы, густой золотой
шум и неканоничная перспектива. Формальные ratios (`58.8%`, `101.2%`, `100%`)
не способны доказать правильную камеру — verifier skill прямо оставляет это
ручному blocking gate.

## Почему нужна полная регенерация `5 -> 4 -> 3`

1. **Дверь определяет этажный модуль.** Для double entrance внешняя рама
   `16x16`, две створки вместе `12x14`. От неё зависят высота первого этажа,
   portal opening, шаг колонн, окна и положение карниза. Это не локальная
   декоративная деталь.
2. **Native-scale проектируется заранее.** Старые крупные render-источники
   содержат больше архитектурной информации, чем переживает canvas
   `96-128 px`. Увеличить только дверь — значит наложить её поверх уже занятой
   сетки; уменьшить дверь — закрепить текущую ошибку; уменьшить всё здание —
   ещё сильнее испортить human scale.
3. **Stage 5 — геометрический авторитет.** Только после принятия его canvas,
   occupied bounds, centre, baseline, entrance axis и projected roof depth
   можно делать stage 4 и 3. Использование старых 4/3 рядом с новым 5 нарушит
   идентичность, source-canvas window и stage continuity.
4. **Stage 4 не является накладкой scaffolding.** Он должен сохранять 90–100%
   финального силуэта, но иметь реально незавершённые поверхности. Старый
   фасад с увеличенной дверью не становится корректной construction stage.
5. **Stage 3 наследует structural bay grid.** Цель 55–65% финальной высоты,
   тот же foundation width, bottom fraction, entrance bay и projected depth.
   Его нельзя получить обрезкой или вертикальным squash готового здания.
6. **Metadata не является визуальной приёмкой.** Текущий verifier останавливает
   remaining geometry ещё до raster analysis, потому что missing leaf field
   превращается в legacy `[6,14]`. Исправленный JSON лишь разрешит следующий
   этап проверки; он не докажет, что две створки реально занимают `12x14`.

## Блокирующий checklist перед сохранением нового семейства

- Stage 5: один прозрачный isolated subject; никакого checkerboard/chroma в
  принятом файле, glow, pavement, fence, trees, people, vehicles, text или UI.
- Canvas и subject margins соответствуют building-specific geometry; aspect
  ratio не меняется между 5, 4 и 3.
- Strict frontal-top подтверждён отдельно для roof, porch/landing, canopy,
  balcony, podium, setback и crown; ни одной receding side facade.
- Double door реально измеряется как `16x16` outer / `12x14` leaves; single —
  `8x16` / `6x14`; portal trim не считается дверью.
- Окна обычно 2–6 px, outline около `#263945` толщиной один художественный
  пиксель, hard alpha, не более 32 RGBA цветов, свет сверху-слева.
- Силуэт и семантическая роль читаются на native `1x`; `4x` используется для
  проверки кластеров, а не как замена `1x`.
- Stage 4 целится в 90–100% width/height stage 5 и сохраняет все silhouette
  extrema; stage 3 — в 55–65% height и сохраняет structural bay grid.
- Centre drift не более 8 px, baseline drift не более 1 px, entrance axis не
  движется.
- После каждого отдельного запроса сразу читаются `report.json`, exact ratios,
  `generationGuidance`, clean grid preview и geometry preview. Code pass не
  заменяет ручной projection/style gate.
- Отвергнутые drafts не попадают в catalog/runtime. После трёх принятых PNG
  обновляются SHA-256 и каталог; затем последовательно запускаются build,
  полный audit и verify.

## Факты и допущения

### Наблюдаемые факты

- Текущие сильные примеры повторно проходят кодовый verifier с правильным
  double-door contract.
- У трёх remaining-примеров double door заявлена как `16x16`, но явный
  `doorLeafSizePx` отсутствует; текущий loader подставляет `[6,14]`, после чего
  отвергает контракт.
- Runtime ratios стадий у проблемных примеров находятся внутри жёстких bands;
  значит одна проверка bounds не обнаруживает неправильные door scale,
  projection и detail scale.
- `civic-library` и `civic-museum` хранят RGB/chroma source; concert hall имеет
  RGBA source, но его визуальная presentation-подача и перспектива не
  соответствуют V5.
- Reference screenshot, указанный в pixel-city skill, отсутствует в рабочей
  копии.

### Выводы визуального исследования

- Library и museum требуют новой архитектурной композиции, а не локальной
  перерисовки входа: каноническая дверь меняет весь вертикальный и оконный
  ритм.
- Concert hall требует полной регенерации также из-за камеры, lighting model и
  detail density.
- Те же критерии надо применить ко всему remaining-реестру по одному семейству;
  наличие metadata-failure само по себе не доказывает одинаковый набор
  художественных дефектов у каждого здания.
