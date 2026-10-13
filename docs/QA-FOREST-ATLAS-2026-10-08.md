# Приёмка хвойного интерфейса

Основание: полная переработка интерфейса по запросу от 08.10.2026. База `e6c173c7e0c4a44b2c9c3f7b379a7bebd2e34daf`, ветка `codex/forest-ui-redesign`. [Карта страниц, 23 групп и 41 владельца](design/FOREST-ATLAS-REDESIGN-2026-10-08.md) — спецификация изменения. Это локальная приёмка; публикация на tasktopia.online и SCM approval этим отчётом не подтверждаются.

## Среда и данные

Node 24.15.0, production Vite build, локальный HTTP `127.0.0.1:5207`, Chromium и Playwright WebKit, desktop и профили Pixel 7/iPhone 13. PostgreSQL `tasktopia_test` на loopback: отдельная схема `forest_ui_1a6438efc55643c5a30ad32b5add9351`. Основная фикстура: Riverside, 40 задач и 3 района; архив/руины и аккаунты создаются только в этой схеме. `seed-forest-ui.ts` запрещает иной сервер/базу/схему. Общие и публичные данные не изменялись.

## Покрытие

Во всех строках реализована единая тема; `matrix` означает `forest-ui-surfaces.spec.ts`, четыре ширины 320/390/768/1440 в Chromium и WebKit. Проверяется реальная DOM-панель после загрузки, WCAG AA через axe, горизонтальный overflow, клавиатура, ошибки JS и отсутствие внешних Google Fonts. Скриншот сам по себе не считается функциональным тестом.

| ID | Фактическое доказательство |
| --- | --- |
| ENTRY-01 | `forest-ui-design`, `auth`: тёмная поверхность, контраст ≥4.5, focus; registration duplicate, password mismatch, pending, bootstrap 503/retry, двойное нажатие, mobile |
| ENTRY-02 | `account-lifecycle`: смена пароля с ошибкой, создание recovery codes, новый вход, recovery form 390px/axe, успешное восстановление |
| ENTRY-03 | `account-lifecycle`: реальное приглашение, регистрация отдельного пользователя и принятие; mobile screenshot |
| SHELL-01 | matrix: toolbar PLANET/CITY, поиск и открытие задачи; `mobile-pwa`: видимость поиска/профиля при жестах; индикаторы online/connecting проверены по semantic CSS |
| SHELL-02 | matrix: Enter/Escape меню, выбор страны, паспорт; прежние `game-interface`/`world-preferences` проверяют disclosures/outside/restore |
| MAP-01 | matrix и `mobile-pwa`: PLANET, подписи, масштаб; `map-retry`: таймаут графики и повтор; прежние `planet-feedback` проверяют загрузку/ошибку/повтор |
| MAP-02 | matrix: настоящая атомарная CITY-сцена; `forest-ui-load`: scene requests и budget; `map-retry`: ошибки scene/декодера и повтор |
| MAP-03 | matrix/`mobile-pwa`: PLANET↔CITY, нижняя навигация и непрерывные жесты; `map-retry`: доступная планета после ошибки города |
| MAP-04 | matrix: фильтры; `forest-ui-states`: reduced motion; прежние `world-preferences`: качество, раскрытие и восстановление настроек |
| CITY-01 | matrix: реальные районы, их сводка, задачи всех пяти стадий; архив проверен отдельно; прежний `game-interface` — города и навигация |
| CITY-02 | matrix: документы и сводка; прежний `city-documents`: фильтры, отчёты, пагинация и read-only граница |
| CITY-03 | matrix после заголовка «Службы», `city-development`: службы/достопримечательности/транспортные состояния, переход в существующую задачу |
| TASK-01 | matrix: четыре вкладки, close/Escape, mobile; `forest-ui-states`: подписи и счётчики физически помещаются в контролы на 320px; `task-entry`: отдельный URL, права/ошибка/retry, long title и низкое окно |
| TASK-02 | matrix: материалы, заполненные/disabled документы, checklist, markdown, обсуждение и история; прежние `task-entry`/`city-documents` проверяют overflow контента |
| TASK-03 | matrix: popover/поля; `task-share-preview`: выбор публичных полей, публикация, copy/manual fallback, потеря ответа/повтор, 409, revoke; `forest-ui-states`: task-link fallback без browser prompt |
| ARCHIVE-01 | `forest-ui-archive` в обоих движках: реальный markdown/code/table/link, 320/1440, 503, доступное имя, Escape; настоящий клик по руинам открывает SiteHistory |
| ACCOUNT-01 | matrix: профиль/disabled save; `account-lifecycle`: logout и новый вход |
| ACCOUNT-02 | matrix: endpoint/guide/examples; `forest-ui-states`: пустые keys, disabled submit, 503, pending, secret и revoke, 320px/axe; секрет закрыт маской на снимке |
| ACCOUNT-03 | matrix: паспорт/участники/доступ; `account-lifecycle`: invitation links; прежний `country-members`: роли и отзыв доступа |
| ACCOUNT-04 | `account-lifecycle`: неверный пароль, смена, recovery codes, восстановление и проверка нового входа |
| NOTICE-01 | matrix: список событий и close; прежний `world-digest`: live summary/read state; realtime info/success используют общие semantic роли, CSS проверен отдельно |
| NOTICE-02 | `pwa-update`: available/later/updating/error/retry, сохранение draft до update; `mobile-pwa`: push user gesture, отключение, offline shell с Manrope после очистки HTTP cache |
| PUBLIC-01 | `task-share-preview`: настоящий guest HTML/OG PNG, кириллица/320px, no-JS crawler, 404/revoke, WCAG AA; `task-share-preview.test`: escaping/privacy/bounds |
| PRIMITIVE-01 | `forest-ui-design`, matrix и `forest-ui-states`: Button/Field/summary/tabs/code/table, normal/focus/selected/disabled/error/pending/success в реальных сценариях |

## Результаты и команды

- `npm run build`: успешно, включая typecheck. `npm run lint`: успешно. `git diff --check`: успешно.
- `npx vitest run tests/task-share-preview.test.ts tests/world-building-presentation.test.ts tests/world-preferences.test.ts tests/pwa-contract.test.ts tests/pwa-update.test.ts`: **57 passed**, 5 файлов.
- Итоговый browser set: **45 passed, 3 skipped**, 48 сценариев за 4.4 минуты. Пропуски — прежние platform-specific offline/push/deep-link проверки Playwright WebKit; Chromium выполняет их. Ошибок в завершённом прогоне нет.
- После финальных правок fallback/цвета alert/мобильных вкладок затронутый browser set: **35 passed, 2 skipped**, 37 сценариев за 2.5 минуты. Проверены четыре ширины в Chromium/WebKit, состояния, отдельная карточка, аккаунт, публичное превью и загрузка города. Пропуски — прежние проверки карточки, ограниченные заданным профилем устройства. Незатронутые результаты сохраняются для тех же исходных входов.

Команда browser set, при уже запущенном локальном сервере с той же схемой:

```sh
E2E_DATABASE_URL="$DATABASE_URL" E2E_FOREST_UI_FIXTURE=true \
E2E_BASE_URL=http://127.0.0.1:5207 E2E_WEB_COMMAND=false E2E_SEED_COMMAND=true \
npx playwright test tests/e2e/forest-ui-design.spec.ts tests/e2e/forest-ui-surfaces.spec.ts \
tests/e2e/forest-ui-archive.spec.ts tests/e2e/forest-ui-load.spec.ts tests/e2e/forest-ui-states.spec.ts \
tests/e2e/pwa-update.spec.ts tests/e2e/mobile-pwa.spec.ts tests/e2e/task-share-preview.spec.ts \
tests/e2e/account-lifecycle.spec.ts tests/e2e/auth.spec.ts tests/e2e/map-retry.spec.ts \
tests/e2e/city-development.spec.ts --reporter=line
```

Финальный затронутый set использует те же переменные и вместо списка выше запускает:

```sh
npx playwright test tests/e2e/forest-ui-states.spec.ts tests/e2e/task-entry.spec.ts \
tests/e2e/account-lifecycle.spec.ts tests/e2e/forest-ui-load.spec.ts \
tests/e2e/task-share-preview.spec.ts tests/e2e/forest-ui-surfaces.spec.ts --reporter=line
```

В разработке найденные падения не скрыты: baseline cream luminance 0.769 нарушал новый бюджет <0.1; исправлены overlay push над архивом в WebKit и отсутствие первого font precache. На финальных снимках выявлено перекрытие счётчиков и текста вкладок на 320px; новый regression дал red в обоих движках, исправление переводит вкладки в два ряда до 400px. Ошибки тестовой подготовки (неверный пустой token-name, ожидание до lazy mount, неготовый production-сервер/отсутствующий тестовый VAPID) исправлены, затем сценарии выполнены заново. В итогах выше считаются завершённые успешные прогоны.

## Дизайн и загрузка

Просмотрены entry, toolbar/menu, desktop task inspector и четыре вкладки, 320px account/documents/materials/passport, MCP guide/secret/revoked/error, загруженное развитие, список задач с пятью стадиями, notifications, archive/error/site history, public HTML/404/OG и PWA error. Типографика/контуры/радиусы и цветовые состояния согласованы, наложение заголовка истории участка на close устранено.

Baseline CSS: 117.64 KB raw / 26.48 KB gzip. Финальная сборка: **132.37 KB raw / 24.99 KB gzip** CSS; entry JS 312.80 / 96.34 KB, WorldCanvas 228.81 / 77.86 KB, TaskModal 23.57 / 7.55 KB. Manrope добавляет **39,336 bytes** (14,500 Cyrillic + 24,836 Latin), два локальных файла, без новых npm-зависимостей. Шрифты кэшируются при установке worker; lazy map JS не добавлен в install graph, приватные URL по-прежнему исключены.

В финальной контрольной серии Chromium 1440×1100 первый вход до атомарной сцены/снятия transition занял **1610 ms**, три повторных — **109/129/61 ms**, медиана повторных **109 ms**. Один scene GET за четыре открытия, ноль viewport/chunk GET, ошибок JS нет. Бюджеты: первый вход <8 s, повторный <3 s, шрифты ≤45 KB. Это малая локальная серия на 40 задачах, без сетевого throttling; она не доказывает ускорение публичного сервера или FPS. Исходный UI baseline first/warm 1514/71 ms — одиночное наблюдение, не сопоставимая статистика. Дорогие новые blur/filter/render-loop эффекты не добавлены.

## Ревью, ограничения и выпуск

AI-ревью охватывает diff относительно указанной базы, semantic CSS/cascade, UI/ARIA/focus, runtime Canvas labels, public OG escaping, worker/CDN/private cache boundary, fixtures и тесты. Найденные замечания исправлены; финальное повторное ревью не выявило оставшихся замечаний, требующих изменения кода. Это не SCM approval. В локальной `.builder/evidence/accepted-48/` сохранены доказательства широкого прогона, в `.builder/evidence/final/` — финального затронутого. SHA-256 исходных runtime-файлов финальной сборки сохранены в `.builder/evidence/forest-final-build-inputs.json`.

Не выполнялись полный 60-минутный SCM gate, регенерация bitmap-арта, горизонты симуляции, backup/recovery release gates и нагрузка публичного сервера: они не относятся к локальной UI-приёмке. Перед merge/release действуют обязательные SCM и managed-release проверки. Физическая установка iOS PWA и настоящий browser zoom остаются проверками устройства; тест landscape использует 200% root font-size, а не имитацию системного Safari zoom. Автоматический axe не заменяет полный аудит WCAG всех комбинаций данных.

API/схемы БД/география/дороги/входы/этажность не изменены. MCP-only рабочая граница сохранена. Брендовые raster launcher icons/social-card и game world art не регенерировались. Локальные правила AGENTS/skills менять не требуется; [QA.md](QA.md) связывает эту актуальную приёмку. Публикация новой темы требует отдельного разрешённого выпуска; обычный merge сохраняет human-review. Для отката дизайна достаточно revert коммита без миграции данных.
