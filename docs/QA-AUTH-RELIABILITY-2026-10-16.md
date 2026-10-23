# Авторизация: надёжность декорации и доступность

## P07 — проверенный результат

Декорация не удерживает форму за общей `Promise.all`: готовые изображения
появляются постепенно. Одновременно загружаются не более четырёх optional PNG,
приоритет низкий, декодирование асинхронное. Отдельное изображение ожидается
до трёх секунд, весь набор — до шести. При ошибке доступная часть рисунка
сохраняется. Состояние `progressive`/`partial`/`ready` публикуется после рисунка
в canvas, не перед ним. Отсутствие основного или фонового 2D context не мешает
форме и не запускает бесполезные загрузки.

При уходе очищаются изображения, очередь, watchdog и таймеры рисования;
поздние callback не изменяют закрытый компонент. Сцена сохраняет родную
геометрию, палитру и целочисленный масштаб 1×/2×; движение ограничено 10 fps,
выключается на touch/reduced motion/скрытой вкладке.

Проверки 16.10.2026: 10 unit в трёх файлах и ESLint изменённых Auth файлов
успешны. В production preview `candidate-render-v2` выполнены 11 браузерных
проверок: Chromium, Firefox, WebKit desktop и Pixel/iPhone emulation.
Тесты задерживают либо отклоняют PNG, отправляют локально перехваченный login
с 401, подменяют отказ фонового context. Первый рисунок, ввод, повторяемая
ошибка и сохранение полей подтверждены; ошибки JavaScript и чтения города,
чанков либо Pixi отсутствовали. Desktop/iPhone снимки просмотрены.

```sh
E2E_BASE_URL=http://127.0.0.1:5313 E2E_SEED_COMMAND=true \
E2E_WEB_COMMAND='node -e "throw Error(\"owned preview required\")"' \
npx playwright test tests/e2e/auth-game-entry.spec.ts \
  --grep 'зависший PNG|отказ фонового|город входа' \
  --project chromium --project ui-review-firefox --project ui-review-webkit \
  --project ui-review-mobile-chromium --project ui-review-mobile-webkit
```

Нужен уже запущенный изолированный preview; команда не создаёт сервер или базу.
Сырые артефакты: `.builder/world-perf-20261016/p07-browser`, unit/lint логи
рядом. Работающие аккаунты, Task/MCP и production не изменялись.
Эмуляция не означает испытания на физических телефонах.

## U07 — проверенный результат

Поле пароля имеет кнопку показать/скрыть с отдельным доступным именем,
`aria-pressed`, областью 44×44 px и `type="button"`. Значение и autocomplete
сохраняются; кнопка не отправляет форму. Общий Field сохраняет внешний id и
описание, добавляет связанные hint/error. Это также делает доступными пароли
в настройках аккаунта, использующих тот же Field.

Локальные ошибки регистрации и восстановления появляются у соответствующего
поля с `aria-invalid`/`aria-describedby`; первое неверное поле получает фокус.
Скрытый шаг регистрации не валидируется. Возврат между шагами сохраняет
черновик. Пароль проверяется без trim, названия — после trim, ограничения
длины соответствуют существующим полям/API. Сервер остаётся владельцем
проверки данных и политики регистрации. Общие API ошибки не связываются с
существованием конкретного аккаунта; фокус получает alert.

Отказ, некорректный ответ и ожидание auth config дольше восьми секунд дают
повторить проверку без перезагрузки и потери email. Вход остаётся доступен.
Успешный ответ `registrationEnabled: false` не отображает регистрацию.
Приглашение обрабатывает ошибку обеих кнопок и снимает busy; уже успешно
принятое приглашение не отправляется снова при повторе открытия страны.

На production preview `candidate-render-v3` выполнено **49/49** проверок
изменённого Auth файла в пяти профилях: desktop Chromium/Firefox/WebKit,
Pixel Chromium, iPhone WebKit. Длительность 1,5 минуты. Дополнительно
**15/15 unit**, ESLint и отдельная strict TypeScript проверка Auth границы
успешны. Полная типизация/CI общей ветки остаётся общим выпускным этапом.

Проверены registration step/back/one request, keyboard reveal, ошибки и
фокус, recovery mismatch/API error, config 503/retry/hung/false policy,
invitation 403/retry. Axe serious/critical нарушений в проверенных формах
не обнаружено. Viewport 320×568/390×844/768×600/1440×480 не создаёт
горизонтальную прокрутку, необходимые кнопки доступны через прокрутку.
Native static-ready desktop/Pixel снимки просмотрены, выбранная вкладка
и пиксельный город согласованы с фоном игры.

Исходники семи Auth/Field/loader модулей сопоставлены по SHA-256 с
`sourcesContent` production sourcemaps перед запуском. Регистрация и
восстановление проверяются intercepted HTTP responses; реальное создание
аккаунтов или смена паролей не производились. Invitation использует только
вход синтетического fixture пользователя и перехваченный accept с 403.
Task, геометрия замороженных наборов и production не изменялись.

```sh
E2E_BASE_URL=http://127.0.0.1:5313 \
E2E_AUTH_FIXTURE_EMAIL=city-scale-1000@tasktopia.local \
E2E_SEED_COMMAND=true \
E2E_WEB_COMMAND='node -e "throw Error(\"owned preview required\")"' \
npx playwright test tests/e2e/auth-game-entry.spec.ts \
  --project chromium --project ui-review-firefox --project ui-review-webkit \
  --project ui-review-mobile-chromium --project ui-review-mobile-webkit
```

Для обычного локального seeded runtime email override не нужен. Политика
registration в production не меняется: тесты явно перехватывают config для
registration-only UI сценариев. Сырые артефакты: `.builder/world-perf-20261016/u07-browser`,
`u07-browser.log`, `u07-unit-final.log`, `u07-typecheck.log`, `u07-lint-*.log`.
Публичные метаданные и SHA: `docs/evidence/auth-reliability-2026-10-16/summary.json`.
