# Square World Generation V3 — changelog

## 0.4.0 — 2026-08-02

- Добавлена компактная иерархическая планировка городских и районных дорог; межгородские трассы подключаются к внешней highway-сети и обходят существующие city bounds.
- Добавлены buffered chunk streaming, подгрузка во время drag и ограничение камеры опубликованной областью страны.
- Добавлены deterministic biomes: лесные поляны, domain-warped озёрные бассейны, холмы и горные кластеры.
- Asset pack расширен до 12 terrain families и 34 props с hard-alpha validation.
- Генератор повышен до `square-v4`, приложение — до `0.4.0`.

## 2026-08-02

- Создан новый план квадратного бесконечного мира вместо axial hex-прототипа.
- Зафиксирована модель ленивых chunks и feature regions с shared-edge contracts.
- Зафиксирован гибридный планировщик района: road-first, reserved lots, constrained growth.
- Разделены `grossCells` и `buildableCells` района.
- Добавлены `NATURAL/RESERVED/COMMITTED/RELEASED` и lifecycle `PLANNED/ACTIVE_MUTABLE/SEALED`.
- Определены городские резервы, национальный road graph, мосты и локальное расширение.
- Историческое решение ограничить LLM семантическим brief/critic отменено следующим решением: runtime полностью детерминирован и не вызывает AI.
- Составлены реализационные срезы, property-тесты и performance-сценарии.
- Добавлен воспроизводимый симулятор трёх планировщиков; гибрид показал 97,3% успешности тестовых участков и 99,7% уникальных планов на 300 seed.
- Добавлен контракт недостающих terrain, transition, road, bridge, nature, bus-stop и decoration спрайтов.
- Выбран PostgreSQL + PostGIS и безопасная граница миграции через `generatorVersion = square-v3`.
- Старые hex-планы помечены как исторические; финальный docs review завершён.
- Принято решение полностью исключить AI/LLM из runtime и начать square-v3 MVP на детерминированных правилах.
- Реализован square-v3 MVP: 44 семейства зданий, 220 стадий, square chunks, три demo-города, расширяемые районы, 20 MCP tools и Pixi renderer.
- Добавлен data-first asset extension catalog, строгий sprite builder и масштабный smoke `10×50×120`.
- Добавлены проверяемые acceptance criteria реализации и sprite-manifest expansion contract.
