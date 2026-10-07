# Полная переработка интерфейса: хвойный атлас

Исходная ревизия: e6c173c7e0c4a44b2c9c3f7b379a7bebd2e34daf. Основание: запрос пользователя от 08.10.2026 и приложенный экран входа. Работа выполняется в codex/forest-ui-redesign. Запись новой задачи подготовлена и ожидает разрешения; кодовая переработка запрошена прямо.

## Направление

Современный игровой атлас: тёмный хвойный фон, поверхности разной глубины, тёплый белый текст, золотой акцент и мягкие контуры. Пиксельный мир остаётся главным изображением; панели читаются как часть игры и не имитируют оконную систему. Убираются бежевые заливки, двойные рамки, ступенчатые тени, псевдообъём кнопок, случайные цвета и мелкие подписи.

Палитра является проектным решением на основе пользовательского примера. [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) задаёт полезное разделение фона, поверхностей, hover/selected, линий, solid actions и текста; пакет Radix не добавляется. Проверка [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): обычный текст ≥4.5:1, большой ≥3:1. [Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): минимум 24px с оговорёнными исключениями; для основных контролов принимаем 44px. Шрифт [Manrope](https://fontsource.org/fonts/manrope/about), OFL1.1, кириллица и Latin, локальные variable WOFF2 без внешнего font runtime. Числа/код используют системный моноширинный шрифт; серверный OG-renderer сохраняет локальный Noto Sans с кириллицей.

## Страницы и навигация

| Адрес/состояние | Что открывается |
| --- | --- |
| `/`, гость | Вход, регистрация, восстановление; режимы одного AuthScreen, без новых маршрутов |
| `/`, авторизован | PLANET, переход в CITY, район/список задач, меню и все панели из карты ниже |
| `/#invite=…` | После входа/регистрации — принятие приглашения; секрет убирается из адреса существующей логикой |
| `/task/:taskNumber?countryId=…` | Отдельная карточка задачи, загрузка/ошибка/повтор; мир открывается отдельно |
| `/share/:publicKey` | Публичное HTML-превью, включая недоступную/отозванную ссылку |
| `/share/:publicKey/image.png` | Серверный OG PNG 1200×630 |

Новые страницы и рабочие кнопки не добавлены. В таблице ниже отдельно перечислены вложенные панели, popover, модальные окна и состояния.

## Токены

| Роль | Значение |
| --- | --- |
| Canvas | #0b1814 |
| Surface | #10251d |
| Raised | #172f26 |
| Hover | #203d31 |
| Selected | #2c5140 |
| Border | #365647 |
| Interactive border | #648575 |
| Text | #f0f2e7 |
| Muted | #b6c6bb |
| Quiet text | #98afa1 |
| Accent/primary/focus | #d9bd78 |
| Link | #9ed9c9 |
| Success | #add39b / #203a2c |
| Warning | #e4c88b / #3a3424 |
| Error | #f0a5a1 / #3a2626 |
| Info | #9ed0d3 / #1d3439 |

Размеры: сетка 4px, отступы 4/8/12/16/20/24/32/40/48; радиусы 8/12/16/24. Текст 14px/1.6, формы 16px, метаданные 12px/1.5, label 13px/1.5. Заголовки 15/18/26/40–72px. Кнопки 44px, поля 48px; toolbar 64px desktop/56px mobile. Тень мягкая и статичная, без blur/filter на непрерывно перерисовываемых слоях карты. Focus 2px с offset 3px, hover/active/disabled/selected/error различимы без одного лишь цвета.

## Карта поверхностей

| ID | Поверхность и владельцы | Элементы/состояния |
| --- | --- | --- |
| ENTRY-01 | AuthScreen, ui | вход/регистрация, domain cards, обычные/disabled поля, pending, несовпадение паролей, duplicate/503/retry, ссылка recovery |
| ENTRY-02 | RecoveryScreen | четыре поля, ошибка, pending, success, возврат |
| ENTRY-03 | InvitationEntry | приглашение/нет страны, accept/retry/pending/error, возврат |
| SHELL-01 | App, ProfilePresence, TaskSearch | шапка PLANET/CITY, страна/город, поиск results/empty и существующее pending-состояние, номер/stage, профиль online/offline |
| SHELL-02 | GamePopover, CountrySwitcher | menu/filter/settings/legend disclosures, выбранная страна, loading/error, паспорт/города, keyboard/outside/Escape |
| MAP-01 | PlanetAtlasCanvas, PlanetCityMiniature, PlanetCloud, AtlasShips, ScheduledAtlasFlights, ScheduledAtlasTrains | планета, sector select, подписи стран/городов, hover/focus, loading/empty/error/retry; спрайты/маршруты сохраняются |
| MAP-02 | WorldCanvas, WorldAmbientLighting | CITY, HUD/подписи/badges, первый кадр, streaming/retry, пустота/ошибка; renderer/дороги/дома сохраняются |
| MAP-03 | MapLevelNav, MapLevelTransition | PLANET/CITY/районы, selected/disabled, переход/loading/cancel/error |
| MAP-04 | MapAttention, MapDependencies, MapLegend, WorldPreferences | все фильтры, выбранные режимы, пустота/ошибка/счётчики, dependencies, легенда, качество и reduced motion |
| CITY-01 | CityDirectory, DistrictPlans | города/районы/задачи/архив, поиск, списки/empty/error, выбранный район, сводка/возврат |
| CITY-02 | CityDocuments | документы/отчёты, фильтры city/district/status, счётчики, list/empty/loading/error, pagination |
| CITY-03 | CityDevelopmentPanel | развитие, службы, landmarks, стадии/доступность, task actions, empty/loading/error |
| TASK-01 | TaskModal, GameTabs | inspector и отдельная task URL, loading/error/retry, header/stages/progress, четыре tabs, long title, close/focus |
| TASK-02 | TaskModal, Markdown | overview, checklist, defects open/fixed, материалы/таблица/код/ссылки/attachment, комментарии и хроника |
| TASK-03 | TaskModal, TaskSharePreview | копирование ссылки/readonly fallback вместо системного prompt, popover, включённые поля, checkbox/textarea/link, loading/error/409/retry, publish/copy/revoke состояния |
| ARCHIVE-01 | ArchiveRecordModal, SiteHistoryModal | документы архива, empty/loading/error, site history/ruins, close/links/markdown |
| ACCOUNT-01 | TokenPanel | sections account/MCP/notifications, профиль/form/save/error/success, logout |
| ACCOUNT-02 | TokenPanel | endpoint/copy/guide/examples, token scopes/select, generated secret/copy, empty/revoked/revoke/error |
| ACCOUNT-03 | CountryPanel, CountryInvitations | паспорт, участники OWNER/MINISTER/OBSERVER, read-only роль, invite/роль/revoke, link invitation/expiry/copy/errors |
| ACCOUNT-04 | AccountSecurity | password form, pending/error/success, recovery codes reveal/create/copy; локальные fixture accounts |
| NOTICE-01 | WorldDigest, App | колокольчик, count, списки/filters/loading/empty/error/retry, read/unread; realtime info/success toasts и dismiss |
| NOTICE-02 | PushNotificationCard, PwaUpdateNotice | offer/permission/error/disabled, PWA available/updating/error/retry/later |
| PUBLIC-01 | share-preview.css, task-share-routes, task-share-image | публичный preview/отозванный404, CTA/keyboard, OG PNG с кириллицей, длинным текстом и географией |
| PRIMITIVE-01 | ui, GameTabs, GamePopover, Markdown | buttons primary/secondary/quiet/danger, fields normal/hover/focus/disabled/invalid, tabs/summary, headings/code/table/list/blockquote |

Исчерпывающий список 41 TSX-владельца снимается из AST и приводится в приложении ниже. Неиспользуемая UI-ветка не объявляется проверенной только из-за наличия CSS. Pure visual components карты проверяются в реальной PLANET/CITY-сцене.

## Инварианты и границы

API, права, идентификаторы, ссылки, география, данные, сцены, ассеты, этажность и движение не меняются. Рабочие изменения выполняются через MCP; новые кнопки назначения/стадии/создания/удаления задач, городов, районов и архива запрещены. Account/access/sharing controls сохраняются. Не возвращается отдельный COUNTRY mode. Ни новые зависимости render loop, ни фоновые repaint эффекты не добавляются. RepoWise оказался устаревшим (index 3161ba52, 38 days, degraded retrieval); владельцы и контракты проверяются прямыми исходниками e6c173c7.

## Порядок реализации и приёмки

1. Зафиксировать AST-карту и baseline; ввести semantic tokens, локальный шрифт, базовые controls. Доказательство: реальный entry/controls browser, контраст и focus.
2. Переделать все панели/модалки и состояния через существующие классы; убрать старые inline/Tailwind palette values. Доказательство: поэлементная таблица и desktop/mobile screenshots.
3. Согласовать HUD/SVG labels, общественный share HTML/OG и PWA branding. Доказательство: реальные карты, preview/fallback и network/fonts.
4. Пройти матрицу всех поверхностей: обычное/hover/focus/selected/disabled/loading/empty/error/success где применимо, 320/390/768/1440, landscape/увеличенный шрифт/reduced motion. Исправить найденные проблемы; не ослаблять бюджеты прежних тестов.
5. Затронутые product/unit/browser checks, typecheck/lint/build, existing opening budget; AI review, документация и локальный коммит. PR/merge и публичную выкладку выполнять при разрешённом этапе; релиз — только через managed-release.

Проверки и их границы приводятся в [отчёте приёмки](../QA-FOREST-ATLAS-2026-10-08.md). Карта показывает владельцев и применимую стилизацию; она не объявляет проверенной любую возможную комбинацию данных и состояния.

## Приложение: исходный inventory

| Владелец | Контролы | ARIA роли |
| --- | --- | --- |
| src/client/App.tsx | button:17 | presentation, dialog, status, alert |
| src/client/components/AccountSecurity.tsx | Field:3, Button:4, summary:1 | alert |
| src/client/components/ArchiveRecordModal.tsx | button:1 | dialog, alert |
| src/client/components/AtlasOverviewCard.tsx | визуальный слой/контент | button |
| src/client/components/AtlasShips.tsx | визуальный слой/контент | — |
| src/client/components/AuthScreen.tsx | Field:6, Button:4 | alert |
| src/client/components/CityDevelopmentPanel.tsx | button:4 | alert, status |
| src/client/components/CityDirectory.tsx | button:7, input:1 | alert, group |
| src/client/components/CityDocuments.tsx | button:7, select:3 | dialog, alert, status |
| src/client/components/CountryInvitations.tsx | summary:1, Field:2, select:1, Button:3 | alert |
| src/client/components/CountryPanel.tsx | Button:8, Field:1, select:2 | dialog, alert, status |
| src/client/components/CountrySwitcher.tsx | button:3 | dialog, alert |
| src/client/components/DistrictPlans.tsx | button:2 | — |
| src/client/components/GamePopover.tsx | summary:1 | — |
| src/client/components/GameTabs.tsx | button:1 | tablist, tab |
| src/client/components/InvitationEntry.tsx | Button:2 | alert |
| src/client/components/MapAttention.tsx | button:3 | status |
| src/client/components/MapDependencies.tsx | button:1 | — |
| src/client/components/MapLegend.tsx | summary:1 | — |
| src/client/components/MapLevelNav.tsx | button:2 | — |
| src/client/components/MapLevelTransition.tsx | button:1 | status |
| src/client/components/Markdown.tsx | визуальный слой/контент | — |
| src/client/components/PlanetAtlasCanvas.tsx | select:1, button:1 | alert, status, group, button |
| src/client/components/PlanetCityMiniature.tsx | визуальный слой/контент | — |
| src/client/components/PlanetCloud.tsx | визуальный слой/контент | — |
| src/client/components/ProfilePresence.tsx | Button:1 | — |
| src/client/components/PushNotificationCard.tsx | button:2 | alert |
| src/client/components/PwaUpdateNotice.tsx | button:2 | status |
| src/client/components/RecoveryScreen.tsx | Field:4, Button:2 | status, alert |
| src/client/components/ScheduledAtlasFlights.tsx | визуальный слой/контент | — |
| src/client/components/ScheduledAtlasTrains.tsx | визуальный слой/контент | — |
| src/client/components/SiteHistoryModal.tsx | button:1 | presentation, dialog |
| src/client/components/TaskModal.tsx | button:8 | tablist, tab, tabpanel, presentation, dialog, alert, group |
| src/client/components/TaskSearch.tsx | input:1, button:1 | search, listbox, option |
| src/client/components/TaskSharePreview.tsx | button:5, input:3, summary:1, textarea:1 | region, status |
| src/client/components/TokenPanel.tsx | button:12, summary:1, input:3, select:1 | dialog, alert, status |
| src/client/components/WorldAmbientLighting.tsx | визуальный слой/контент | — |
| src/client/components/WorldCanvas.tsx | button:1 | status, alert |
| src/client/components/WorldDigest.tsx | summary:1, button:8 | alert, status |
| src/client/components/WorldPreferences.tsx | summary:1, select:1, input:2 | — |
| src/client/components/ui.tsx | button:1, input:1 | — |

## Реализованная система

`public/forest-theme.css` — общая палитра DOM-интерфейса и публичного HTML; `src/client/design-tokens.css` подключает её к Vite. `styles.css` сохраняет структуру, responsive-правила и рисунок мира; `game-ui.css` задаёт новую иерархию поверхностей, controls и состояния. Shared Button/Field используют semantic variants, SVG-иконки не добавляют библиотек.

Локальные шрифты лежат в `public/fonts/manrope`; Vite выпускает два файла с content hash в `/assets/`. Worker устанавливает шрифты вместе с entry CSS, поэтому первая офлайн-перезагрузка сохраняет типографику. Lazy map/worker JS по-прежнему не входит в install graph; allowlist CDN остаётся точным списком build assets, приватные URL не кэшируются.

Слои: нижняя навигация 10, предложение push 40, открытые боковые панели 42, шапка 45, модальные окна 50+, realtime-сообщения 80. Архив/районы/развитие доступны поверх предложения push. Нативный фокус и Escape сохраняются. Архив получил доступное имя в состояниях loading/error; подпись истории участка резервирует место под закрытие.

При ширине до 400px четыре вкладки карточки задачи располагаются в два ряда: подписи и счётчики сохраняют полный текст и не заходят в соседний контрол. Копирование ссылки при недоступном Clipboard API показывает readonly-поле в карточке с выделением всей ссылки при фокусе.

Размеры и цвета game world sprites, этажность, входы, дороги, территория, камера и расписания не перерабатывались. Canvas/SVG-подсказки и подписи согласованы с интерфейсом; bitmap PWA launcher icons и общая social-card сохраняют прежний брендовый рисунок. Это графические ассеты, а не панели старой темы.
