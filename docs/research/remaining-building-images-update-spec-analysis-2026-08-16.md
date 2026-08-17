# Анализ ТЗ на обновление оставшихся изображений зданий

Дата исследования: 2026-08-16
Область: только первичные источники внутри репозитория — документы, каталог,
пайплайн, тесты и история Git.

## Краткий вывод

Искомое ТЗ существует: основной документ —
[`SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md`](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md).
Он задаёт миграцию 139 малых, коммерческих и служебных семейств на единый V5
визуальный контракт. Текущий остаток ведётся отдельно в
[`V5-ASSET-MIGRATION-STATUS.md`](../../assets/pixel-city-pack/docs/V5-ASSET-MIGRATION-STATUS.md).

По текущему release-checklist все 193 семейства уже имеют собственные geometry
study и отдельные authored PNG стадий 3–5, но строгую V5-приёмку прошли 163;
остаток в документе заявлен как 30 старых civic/landmark/archive studies
([status, строки 10–24](../../assets/pixel-city-pack/docs/V5-ASSET-MIGRATION-STATUS.md#L10)).
То есть «обновление остатков изображений» означает не заполнение отсутствующих
файлов, а повторную художественно-геометрическую миграцию существующих
изображений под усиленный контракт проекции и человеческого масштаба входов.

ТЗ достаточно подробно описывает производство и общие критерии приёмки, но не
готово как однозначная исполнимая очередь: оставшиеся семейства нигде не
перечислены поимённо, а ниже в том же status-файле всё ещё указано 33
([строки 149–156](../../assets/pixel-city-pack/docs/V5-ASSET-MIGRATION-STATUS.md#L149)).
Более того, повторный прогон текущей реализации geometry/stage gate по всем 193
записям рабочего каталога даёт **164 pass / 29 fail**. Перед продолжением
миграции нужен один канонический список ключей и машинно проверяемый признак
прохождения строгого V5 gate.

## Найденные первичные источники и их роли

| Источник | Роль |
| --- | --- |
| [`SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md`](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md) | Основное ТЗ: объём, визуальная семантика, файловый контракт, порядок производства, очередь и release gate. |
| [`V5-ASSET-MIGRATION-STATUS.md`](../../assets/pixel-city-pack/docs/V5-ASSET-MIGRATION-STATUS.md) | Текущий release-checklist и заявленный остаток. |
| [`GENERATION-SPEC.md`](../../assets/pixel-city-pack/docs/GENERATION-SPEC.md) | Обязательный общий контракт геометрии, стиля, пяти стадий и manifest. |
| [`geometry-contract.md`](../../.agents/skills/tasktopia-building-stage-verifier/references/geometry-contract.md) | Точные измеримые ограничения для canvas, footprint, двери, стадий и construction envelope. |
| [`tasktopia-building-stage-generator/SKILL.md`](../../.agents/skills/tasktopia-building-stage-generator/SKILL.md) | Канонический производственный порядок `5 → 4 → 3` и правила регенерации. |
| [`verify_building_stages.py`](../../.agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py) | Реализация автоматического geometry gate и формат `report.json`. |
| [`catalog/buildings.json`](../../assets/pixel-city-pack/catalog/buildings.json) | Заявленный в ТЗ источник истины для семейств, путей, SHA-256 и runtime-геометрии. |
| [`building-art-catalog.test.ts`](../../tests/building-art-catalog.test.ts) | Инварианты каталога, manifest, источников и SHA-256. |
| [`pixel-city-asset-hygiene.test.ts`](../../tests/pixel-city-asset-hygiene.test.ts) | Правило чистоты canonical study directories. |
| [`package.json`](../../package.json) | Реальные команды сборки, аудита, storybook и общих quality gates. |

История Git подтверждает назначение документов: основное ТЗ вошло в репозиторий
коммитом `07e8b13` от 2026-08-13 (`release: improve city actors and map caching`),
а status-checklist — коммитом `6668fca` от 2026-08-13
(`release: consolidate Tasktopia 1.13.0 assets`).

## Наблюдаемые требования

### 1. Объём результата

Исходное ТЗ охватывает 139 семейств: 36 малых/средних `HOUSE`, 51
`COMMERCIAL`, 52 `CIVIC`; это 417 вручную принимаемых authored PNG стадий 3–5
и 695 runtime PNG стадий 1–5
([строки 30–56](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md#L30)).
Изначально из этого объёма исключались 50 `new-build` семейств и четыре корпуса
Государственного архива.

Поздний статус расширяет контроль до всего каталога из 193 семейств. Текущий
рабочий каталог фактически содержит 193 записи; у всех стоят `reviewed: true`,
три `stageSources` и три `stageSha256`. Manifest также содержит 193 здания,
`gridPx: 8` и `runtimeAI: false`. Эти инвентарные признаки не доказывают
прохождение строгой художественной приёмки: сам expansion plan теперь прямо
разделяет 193 набора источников и 163 прошедших V5 gate
([строки 649–669](../../assets/pixel-city-pack/docs/ASSET-EXPANSION-PLAN.md#L649)).

### 2. Состав одного семейства

У каждого здания ровно пять логических стадий. Стадии 1–2 собираются общим
детерминированным 8×8 construction kit, а вручную создаются и принимаются только
три самостоятельных изображения: стадия 3 (каркас), 4 (отделка), 5 (готовое
здание). Runtime всё равно публикует пять разных PNG
([ТЗ, строки 58–72](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md#L58),
[общий контракт, строки 30–40](../../assets/pixel-city-pack/docs/GENERATION-SPEC.md#L30)).

До рисования обязателен building-specific `geometry.json`. Он разводит три
пространства: physical footprint, sprite canvas и construction envelope.
Canvas и runtime-размеры кратны 8, anchor — нижний центр, вход ориентирован на
юг, а ограждение остаётся отдельным world layer
([ТЗ, строки 82–123](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md#L82)).

Усиленный входной контракт требует:

- одиночная дверь: внешний модуль `8×16 px`, створка `6×14 px`;
- двойная дверь: внешний модуль `16×16 px`, две створки суммарно `12×14 px`;
- портал, навес, фрамуга и декоративное обрамление не входят в измерение.

Эти размеры закреплены в geometry contract
([раздел Projection and depth](../../.agents/skills/tasktopia-building-stage-verifier/references/geometry-contract.md#L24))
и валидируются кодом
([verifier, строки 128–147](../../.agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py#L128)).

### 3. Художественный контракт

Все здания используют строгий фронтально-верхний pixel-art ракурс: фасад
параллелен экрану, вертикали вертикальны, видна неглубокая верхняя плоскость,
полноценная боковая/3⁄4 или изометрическая проекция запрещена. Требуются hard
alpha, палитра не более 32 RGBA-цветов, свет сверху-слева, отсутствие blur,
gradient, antialiasing, текста, логотипов и UI
([GENERATION-SPEC, строки 19–28](../../assets/pixel-city-pack/docs/GENERATION-SPEC.md#L19)).

Дорога, поверхность, внешний забор, деревья, машины, лавки и прочий городской
декор не запекаются в PNG здания. Для служебных объектов назначение должно
читаться архитектурой, а не надписью; транспорт и эффекты не являются стадиями
здания.

### 4. Порядок производства

На одно семейство ТЗ предписывает:

1. зафиксировать geometry contract и два принятых V5-бенчмарка;
2. отдельно сгенерировать и принять стадию 5;
3. от неё получить стадию 4, затем стадию 3;
4. после каждого изображения запустить verifier и визуально проверить native
   preview `1×` и `4×`;
5. только после приёмки обновить `stageSources`, SHA-256, геометрию и каталог;
6. пересобрать стадии 1–5, проверить storybook/city block и лишь затем удалить
   legacy source/fallback.

Первичный порядок записан в
[ТЗ, строки 304–326](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md#L304).
Партия ограничена пятью семействами; следующая начинается после сборки,
автоаудита и визуальной приёмки предыдущей. Generator дополнительно требует
держать отклонённые drafts вне репозитория и никогда не исправлять геометрию
растяжением, обрезкой или программным сдвигом
([generator, строки 32–57 и 85–104](../../.agents/skills/tasktopia-building-stage-generator/SKILL.md#L32)).

### 5. Измеримые критерии одного семейства

Автоматический gate должен подтвердить:

- canvas кратен 8; footprint положителен; ширина canvas соответствует ширине
  footprint; anchor — нижний центр;
- стадии 3–5 имеют один canvas, одну идентичность, вход и baseline;
- горизонтальный drift не превышает 8 px, baseline drift — 1 px;
- стадия 3 занимает 45–80% высоты стадии 5 (целевой диапазон генерации
  55–65%);
- стадия 4 занимает 85–105% высоты стадии 5 (целевой диапазон 90–100%);
- стадия 5 не содержит строительных элементов;
- hard alpha, допустимая палитра, прозрачный source без нарисованного
  checkerboard/chroma-фона;
- construction clearance равен одной клетке; projected roof depth меньше
  physical depth;
- для каждой стадии существуют нормализованный PNG, clean preview и geometry
  preview, а `report.json.errors` пуст и `acceptedByCode: true`.

Пределы стадий закреплены в
[geometry contract, раздел Stage bounds](../../.agents/skills/tasktopia-building-stage-verifier/references/geometry-contract.md#L76),
а структура отчёта формируется
[verifier, строки 648–692](../../.agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py#L648).

Автоматический pass недостаточен. Вручную блокируются неверная проекция,
несогласованные roof/porch/canopy planes, смена идентичности, нечитаемые
native-scale кластеры, запечённое окружение и неверный масштаб двери. Само ТЗ
прямо говорит, что код не доказывает ракурс и идентичность
([строки 422–443](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md#L422)).

### 6. Пакетный и релизный gate

После каждой партии последовательно выполняются:

```bash
npm run assets:build
npm run assets:verify
npm run assets:storybook
npm run typecheck
npm run lint
```

Перед выпуском полного этапа добавляются `npm test`, `npm run test:worldgen` и
`npm run test:world-validation`
([ТЗ, строки 462–494](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md#L462)).
Builder и verifier нельзя запускать параллельно: builder переписывает runtime,
поэтому параллельный audit способен увидеть временно отсутствующие файлы
([verifier skill, раздел Finish](../../.agents/skills/tasktopia-building-stage-verifier/SKILL.md#L86)).

## Текущее состояние и локализованная поверхность продолжения

### Наблюдаемые факты

- В release-checklist заявлено: 193 geometry studies, 163 passing, 30 remaining;
  missing studies — 0.
- В каталоге рабочего дерева: 193 семейства, все имеют `reviewed: true`, три
  source path и три SHA-256.
- На диске есть 194 study directories и 194 комплекта `geometry.json` /
  `stage-{3,4,5}.png`; дополнительный `highrise-balcony-tower` — тестовый fixture,
  используемый в
  [`building-stage-verifier.test.ts`](../../tests/building-stage-verifier.test.ts#L7),
  а не отдельная запись каталога.
- Текущий worktree содержит большой незакоммиченный пакет замены source PNG,
  geometry, catalog/manifest и verification previews. Эти файлы принадлежат
  параллельной работе и в рамках исследования не изменялись.

### Фактический остаток текущей рабочей копии

Read-only прогон функций текущего
[`verify_building_stages.py`](../../.agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py)
по `geometry.json` и трём `stageSources` каждой из 193 записей каталога дал 164
успешных и 29 неуспешных семейств. У всех 29 одна и та же причина: внешний
модуль входа объявлен двойным (`doorSizePx: [16,16]`), но размер створок оставлен
как у одиночной двери (`doorLeafSizePx: [6,14]`) вместо обязательных `[12,14]`.

Текущий вычисленный список:

- 20 `CIVIC`: `civic-library`, `civic-police-neighborhood`, `civic-museum`,
  `civic-university`, `civic-transport-hub`, `civic-waste-station`,
  `civic-power-substation`, `civic-memorial-hall`, `civic-youth-center`,
  `civic-kindergarten`, `civic-secondary-school`, `civic-vocational-college`,
  `civic-research-lab`, `civic-public-library-modern`,
  `civic-police-headquarters`, `civic-train-station`, `civic-metro-entrance`,
  `civic-waterworks`, `civic-recycling-center`, `civic-sports-center`;
- 5 `LANDMARK`: `landmark-concert-hall`, `landmark-botanical-dome`,
  `landmark-space-center`, `landmark-grand-station`, `landmark-civic-arch`;
- 4 корпуса архива: `state-archive-core`, `state-archive-wing`,
  `state-archive-vault`, `state-archive-tower`.

Это **87 authored PNG** в максимальном сценарии полной регенерации
(`29 × stage-{3,4,5}`). Однако автоматическая ошибка находится в metadata
контракта, а не доказывает визуальный дефект всех 87 файлов. Для каждого
семейства сначала нужен ручной просмотр geometry preview: если две створки уже
фактически занимают `12×14`, достаточно исправить geometry metadata и повторно
провести gate; если нет — соответствующие стадии должны быть регенерированы в
порядке `5 → 4 → 3`. Простая подмена `[6,14]` на `[12,14]` без визуальной
проверки не является приёмкой.

### Следующая change surface

Для каждого подтверждённого ключа из остатка изменение локализуется в:

1. `reference/ai-authored/building-stage-study/<key>-v5/geometry.json`;
2. `.../sources/stage-{3,4,5}.png`;
3. соответствующей записи `catalog/buildings.json` (геометрия, пути, SHA-256);
4. производных runtime/public PNG и `manifest.json`, которые пересобирает
   asset builder;
5. release-checklist и, при необходимости, узких regression-тестах геометрии.

World generator не должен требовать новой логики только из-за визуальной
замены: общий generation spec закрепляет, что новый визуальный вариант не
меняет генератор без отдельного rule handler и property-теста
([строки 42–57](../../assets/pixel-city-pack/docs/GENERATION-SPEC.md#L42)).

## Неоднозначности и противоречия

1. **Нет канонического поимённого остатка.** Status сообщает о 30 старых
   civic/landmark/archive studies, но не перечисляет ключи. Существующая очередь
   в основном ТЗ перечисляет весь исторический scope, а не текущий остаток.
   Текущий gate позволяет вычислить 29 ключей, но этот результат ещё не закреплён
   в source-of-truth документе или тесте.

2. **30 против 33 в одном документе.** Таблица и пояснение говорят о 30
   ([строки 12–23](../../assets/pixel-city-pack/docs/V5-ASSET-MIGRATION-STATUS.md#L12)),
   а blocking order — о 33
   ([строки 149–152](../../assets/pixel-city-pack/docs/V5-ASSET-MIGRATION-STATUS.md#L149)).
   Это блокирует надёжный расчёт числа партий и PNG.

3. **`reviewed: true` имеет две несовместимые трактовки.** Каталог и тест
   [`building-art-catalog.test.ts`](../../tests/building-art-catalog.test.ts#L90)
   считают reviewed все 193 набора с тремя файлами и SHA-256. Status и expansion
   plan отдельно признают, что строгий geometry/native-grid V5 gate прошли лишь
   163. Следовательно, `reviewed` сейчас означает инвентарную готовность source,
   но не строгую художественную приёмку.

4. **`report.json` обязателен по ТЗ, но его каноническое хранение спорно.** ТЗ
   показывает постоянный каталог `verified/` с report и previews
   ([строки 263–302](../../assets/pixel-city-pack/docs/SMALL-COMMERCIAL-CIVIC-MIGRATION-SPEC.md#L263)).
   Одновременно hygiene-test разрешает внутри каждого study только `sources/`
   и `geometry.json`, отклоняя любой `verified/` или `verification/`
   ([строки 26–32](../../tests/pixel-city-asset-hygiene.test.ts#L26)). Нужно явно
   решить: reports/previews являются временными evidence или версионируемыми
   артефактами.

5. **Автоматический gate не выражен на уровне всех 193 семейств.** Имеющиеся
   catalog-тесты проверяют количество, наличие файлов и SHA-256, но не запускают
   building-stage verifier по каждому ключу и не имеют единого списка
   `strictV5Accepted`. Число 163 сейчас документальное, а не выводимое одним
   репозиторным тестом.

6. **Границы scope эволюционировали.** Основное ТЗ рассчитано на 139 семейств и
   исключает new-build/archive, а текущий status считает все 193. Для задачи
   «остатков» нужно явно объявить, что поздний all-catalog checklist имеет
   приоритет над исторической границей ТЗ.

## Риски

- Неправильные 30/33 ключа приведут к пропуску семейства или повторной
  регенерации уже принятого изображения.
- Обновление только каталога/SHA сделает тесты зелёными, не доказав проекцию,
  door scale и native-grid качество.
- Ослабление `geometry.json` под неудачный draft создаст формальный pass ценой
  регрессии масштаба; документы прямо запрещают такой путь.
- Параллельный `assets:build` и `assets:verify` способен дать ложные missing
  assets и оставить несогласованные runtime/public копии.
- Сохранение QA directories внутри studies сломает source-hygiene test; их
  удаление без отдельного evidence location лишит миграцию проверяемой истории.
- Изменение footprint/canvas влияет на размещение, collision и доступность
  южного входа, поэтому одних image-level проверок недостаточно: нужен тестовый
  мир и world-validation.
- Ручной visual gate нельзя заменить `acceptedByCode`; без зафиксированного
  reviewer verdict 30 семейств могут быть ошибочно объявлены завершёнными.

## Предлагаемые критерии приёмки именно для «остатка»

Ниже не новый художественный контракт, а нормализованный checklist из найденных
первичных требований.

1. В репозитории зафиксирован точный список remaining keys и его длина совпадает
   с release-checklist (по текущему gate — 29, либо другое подтверждённое после
   синхронизации рабочего дерева число).
2. Для каждого ключа отдельно приняты `stage-5.png`, затем `stage-4.png`, затем
   `stage-3.png`; combined sheet и программная геометрическая правка отсутствуют.
3. `geometry.json` содержит явные door module/leaf/inset, footprint, canvas,
   projected depth, clearance, entrance и building-specific occupied ranges,
   где они обязательны.
4. Verifier завершился с пустым `errors`, `acceptedByCode: true`, допустимыми
   coverage/drift/baseline и сформировал native previews.
5. Ручной reviewer отдельно подтвердил проекцию, единство здания, roof planes,
   масштаб входа, pixel clusters и отсутствие запечённого окружения.
6. Каталог содержит три актуальных пути и SHA-256; manifest/runtime/public
   пересобраны; старые sheet/fallback/source физически недостижимы и удалены.
7. `assets:build` завершён до `assets:verify`; затем зелёные storybook,
   typecheck, lint, unit tests, worldgen и world-validation.
8. Source-hygiene проходит; местоположение verifier evidence соответствует
   одному явно выбранному контракту хранения.
9. Status вычислимо показывает `193 passing / 0 remaining`, без расхождения
   таблицы, текста и blocking order.

## Факты и допущения

### Факты

- ТЗ, общий generation contract и release-checklist существуют в репозитории.
- Инвентарно все 193 семейства уже имеют отдельные authored stages и SHA-256.
- Документированный строгий остаток — 30, blocking order содержит 33, а текущий
  программный gate на рабочем дереве находит 29.
- Автоматический verifier и ручной visual gate оба объявлены обязательными.
- Точный список оставшихся ключей в прочитанных документах отсутствует.

### Допущения, требующие подтверждения владельцем миграции

- Под «остатками изображений» пользователь имеет в виду именно не прошедшие
  строгий V5 gate семейств, а не отсутствующие source-файлы (их сейчас нет).
- Незакоммиченные массовые изменения — активная реализация этой миграции, а не
  принятый релизный baseline.
- Поздний checklist всего каталога из 193 семейств должен иметь приоритет над
  исходным scope из 139 семейств.

## Минимальное решение перед реализацией следующей партии

Добавить в канонический status или отдельный машинно читаемый manifest точные
remaining keys, исправить 29/30/33, определить смысл `reviewed` либо ввести отдельный
`strictV5Accepted`, и выбрать постоянное место для verifier evidence. После
этого существующее ТЗ уже достаточно конкретно, чтобы обрабатывать остаток
партиями не более пяти семейств без изобретения нового пайплайна.
