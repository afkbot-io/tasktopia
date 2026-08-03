# Square World Generation V3 — задачи

## Статусы

- [x] Аудит текущего hex-генератора и контрактов.
- [x] Исследование Poisson-disc, Priority-Flood, Delaunay, WFC и noise-полей.
- [x] Прогнать сравнительный эксперимент трёх планировщиков района.
- [x] Зафиксировать результаты эксперимента и пороговые метрики.
- [x] Специфицировать координаты, чанки, макрорегионы и seed-потоки.
- [x] Специфицировать генерацию рельефа, гидрологии и биомов.
- [x] Специфицировать размещение городов и национальную дорожную сеть.
- [x] Специфицировать жизненный цикл районов, участков и расширения.
- [x] Специфицировать размещение задач и стадии строительства.
- [x] Специфицировать хранение, фоновые задания и realtime-события.
- [x] Составить поэтапную декомпозицию реализации.
- [x] Составить QA, property-тесты и performance-сценарии.
- [x] Пометить прежние hex-документы как заменённые V3.
- [x] Провести финальное ревью документации.

## MVP implementation

- [x] Удалить AI/LLM из целевой спецификации и закрепить deterministic rule registry. Проверка: runtime-зависимости отсутствуют.
- [x] Добавить square-grid contracts, geometry и terrain. Проверка: grid/terrain suite.
- [x] Перевести SQLite adapter/application service на square-v3 и расширяемые районы. Проверка: service/property suite.
- [x] Перевести каталог на sprite manifest, tags, quotas, entrances и rule IDs. Проверка: catalog/asset validation.
- [x] Сгенерировать недостающие tiles/props и дополнительные дома с пятью стадиями. Проверка: 44 семьи/220 кадров/contact sheet.
- [x] Перевести Pixi renderer на квадратные sprite layers. Проверка: Playwright desktop/mobile screenshots.
- [x] Добавить `city.*`/`district.*` MCP API с legacy aliases. Проверка: live MCP smoke, 20 tools.
- [x] Обновить demo seed, документацию и deployment notes.
- [x] Прогнать review, stale hex audit и полный verification gate.

## Итерация 0.4 — city layout, camera, terrain

- [x] Заменить полный городской крест на въезд, gateway и компактный hub. Проверка: road component/property tests.
- [x] Заменить A*-улицы района на ограниченный связный шаблон улиц. Проверка: дороги района остаются в локальном envelope и доступны от национальной сети.
- [x] Научить routing обходить committed footprints и горы. Проверка: task/road occupancy test.
- [x] Вынести расчёт camera bounds и prefetch range в чистые функции. Проверка: viewport/chunk-range unit tests.
- [x] Добавить clamp камеры и подгрузку чанков во время drag. Проверка: Playwright на min zoom и границах страны.
- [x] Расширить deterministic terrain холмами, горами, озёрными бассейнами и лесными полянами. Проверка: terrain determinism/distribution tests.
- [x] Добавить валидируемые hill/mountain sprites в V4 pack. Проверка: `npm run assets:build`.
- [x] Пересоздать чистый demo fixture, снять скриншоты и прогнать полный quality gate.

## Обязательные решения до production-реализации

- Утвердить начальные параметры расстояний между городами после визуального теста на 10 городах.
- Утвердить минимальный и типовой бюджет района после теста каталога реальных footprints.
- Базовый выбор: PostgreSQL + PostGIS для spatial features/GiST и обычные integer-индексы для occupancy клеток.
- Текущий runtime: `generatorVersion = square-v5`; dev/demo миры прошлых версий пересоздаются, реальный legacy-мир остаётся read-only до отдельного импорта.
- После подтверждения пользователя оформить принятые решения отдельными ADR; этот план ADR не создаёт.
