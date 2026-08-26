# Аудит runtime карты — 2026-08-26

## Измеренный baseline

Контрольная страна: 10 городов, 26 817 DOM-элементов, из них 26 763 SVG и 25 854 `rect`; серия из 10 wheel-событий занимала 3.66 s и создавала 7 long tasks (максимум 159 ms). Планета содержала около 1 295 DOM-узлов, город — около 74 DOM-узлов плюс canvas; значит основной COUNTRY bottleneck был CPU/style/layout/paint из-за детального SVG, а не размер исходных PNG.

Pixel city pack содержит 1 224 PNG: 5 079 376 bytes на диске и примерно 52 469 248 bytes в декодированном RGBA; файлов больше `512×512` нет. Аудит manifest/runtime, 42 animation families и 8 vehicle models не нашёл ошибок. Массовое уменьшение картинок не выбрано: их authored/native размеры соответствуют фактическим объектам, а общий decoded budget требует lifecycle/unload, atlas packing и наблюдения реального residency, не CSS-resize.

Повторный cold-профиль реального beta-города (72 внутренних блока, 8 042 world objects, 7 967 entity views) показал 10.48–12.29 s до атомарного city frame при scene API 0.78–1.48 s. Браузер создавал 18–22 long tasks суммарно 7.06–7.87 s, maximum 763–822 ms, выполнял 17–22 полных entity rebuild и запрашивал 325 texture URL. Следовательно, сеть и PostgreSQL не объясняют основную задержку; bottleneck — очередь worker materialization и повторный main-thread reconcile тысяч Sprite.

## Реализованные бюджеты

- COUNTRY: не больше 1 500 DOM-узлов, 0 SVG в сцене, compact payload меньше 200 KB, zoom не выше 2.6, 0 long tasks в контрольной wheel-серии.
- CITY: один `/api/cities/:id/scene` на вход, 0 `/viewport` и `/chunks` при pan/zoom, непрозрачный loader до coherent commit.
- CITY cold pipeline: до 4 bounded workers, одна загрузка совокупного asset set, один entity commit/reconcile; статичные props упакованы в один immutable atlas и создаются как static `Particle` bands.
- Completed district: одна task/building render-запись в scene v2, без повторения задачи в `chunks[].tasks`; каноническое хранение задач не меняется.
- Lifecycle: одновременно смонтирован один canvas уровня; texture URL выгружается только после release последнего scene owner.

Свежий Chromium-прогон на том же 10-городном fixture подтвердил: COUNTRY содержит 0 SVG и укладывается в 1 500 DOM-узлов; 20 wheel-событий не создали long task >50 ms; cold first frame меньше 2 s, compact payload меньше 200 KB. Вход в город создал один scene request, drag/zoom после commit — 0 data requests. Десять циклов `CITY → COUNTRY → CITY` сохранили один canvas и не увеличили число уникальных resident texture URL; отдельный обход десяти разных городов с CDP forced GC сохранил heap drift ниже 5 MB после eviction каждого renderer.

## Внешняя сверка

Решение следует рекомендациям PixiJS: `ParticleContainer` предназначен для большого числа лёгких визуальных объектов, а неизменяемые свойства не загружаются в GPU каждый кадр ([Particle Container](https://pixijs.com/8.x/guides/components/scene-objects/particle-container)); `Assets` кеширует повторные URL и поддерживает screen/level bundles ([Assets](https://pixijs.com/8.x/guides/components/assets), [background bundles](https://pixijs.com/8.x/guides/components/assets/background-loader)). Вынос десятков тысяч обзорных SVG-узлов соответствует рекомендациям Chrome уменьшать DOM для снижения style/layout и interactivity cost ([DOM size and interactivity](https://web.dev/articles/dom-size-and-interactivity)); задачи main thread дольше 50 ms считаются long tasks и напрямую объясняют наблюдаемые фризы ([Long Tasks](https://web.dev/articles/long-tasks-devtools)). Статический ground запекается и переиспользуется вместо повторной отрисовки примитивов ([canvas performance](https://web.dev/articles/canvas-performance)). Revision-based ETag используется как валидатор безопасных GET согласно [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-validator-fields).

## Оставшиеся риски и telemetry

- Whole-city JSON может стать parse/transfer bottleneck при росте выше 256 блоков; собирать bytes, request/parse/materialization p50/p95/p99 и long tasks на production плотностях.
- 52 MB полного декодированного каталога не равно фактической residency одного города; контролировать `sceneAssets`, renderer count и browser memory между 10 циклами переходов.
- Legacy endpoints и `CountryAtlasCanvas` намеренно остаются только для rollback. После окна совместимости подтвердить нулевое использование telemetry и удалить их отдельным MR.
- PixiJS помечает Particle API стабильным, но experimental; обновление Pixi требует browser regression глубины, bounds/culling и texture-frame ownership.
