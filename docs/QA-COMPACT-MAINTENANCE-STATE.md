# Проверка журнала первого compact cutover

Реализован первый срез [плана](COMPACT-MAINTENANCE-DESIGN.md): сохраняемый
автомат состояний с контрактом host adapter. Он **не выполняет миграцию,
Docker, Nginx или production deploy**. Этот отчёт не закрывает migration,
backup/restore или rollback gates реального релиза.

## Изменения

- План привязан к полному Git SHA, точным двум image digest, targetId,
  Compose-проекту, appDir, прежней статике и имени БД.
- Журнал приватный (0700/0600), запись атомарная, fsync применяется к файлу,
  каталогу журнала и его родителю. Файлы-ссылки и параллельный оператор
  того же журнала отвергаются. Глобальный lock updater — обязанность adapter.
- Перед каждой операцией сохраняется pending. После неопределённого исхода
  запрещён forward resume. Recovery повторно закрывает трафик, останавливает
  writers и проверяет freeze; после начала миграции требует проверенного backup.
- Старый бинарник не запускается до проверки восстановленной базы/файлов.
  Recovery не открывает трафик автоматически. Открытие требует отдельного
  accept с digest того же плана и отдельной проверки acceptance в adapter.
- Даже неопределённый результат open_traffic запрещает автоматический restore
  старой копии: в системе могли появиться новые записи.
- В журнал не сериализуются исходные ошибки SQL/процессов с возможными секретами.
  Evidence — имена локальных артефактов и SHA256, а не passed:true без артефакта.
  Реальность этих артефактов проверяет будущий adapter; hash не заменяет review.

## Выполненные проверки

Первый запуск до реализации: RED, отсутствует модуль. После реализации:

```sh
python3 tests/compact_cutover_state_test.py
npx vitest run tests/compact-cutover-state.test.ts tests/compact-release-preflight.test.ts
npm run typecheck
npx eslint tests/compact-cutover-state.test.ts
git diff --check
```

- Python: **20 tests, PASS**, включая перебор падений всех forward/recovery
  операций, повторное восстановление, неверный план, symlink, permissions,
  incomplete evidence, запрет restore после открытия и реальный SIGKILL
  отдельного процесса с повторным чтением журнала и получением lock.
- Vitest: **26 tests, 2 files, PASS**. Wrapper включает указанные Python-тесты;
  остальные тесты проверяют неизменённые ограничения штатного preflight.
- Types, scoped lint, whitespace: PASS.
- Ревью и security-review основным агентом: исправлен пропущенный fsync
  родителя нового каталога. Подтверждённых замечаний к текущему срезу не осталось.

Операции Docker/SQL в этих тестах представлены записывающим fake adapter.
Проверяется протокол, порядок и сохранность журнала, **не восстановление БД**.
Сквозная репетиция реальных данных через будущий adapter ещё не выполнялась.
Предыдущая отдельная репетиция CLI остаётся историческим доказательством,
но не заменяет проверку нового исполнителя.

CI исходного кандидата 4bd2efac60796a4c4ed28227d85fdf986de35a3f
[34137014436](https://github.com/afkbot-io/tasktopia/actions/runs/34137014436)
завершился SUCCESS. Это не CI текущих новых файлов журнала.

## Осталось до production

Host adapter с проверками реальных контейнеров, томов, иных writers, защищённым
backup/config/uploads, restore+conservation, FORCE/audit, image/static binding,
health и recovery; затем сквозная изолированная репетиция и review точного
результата. Обычный updater и Builder policy не ослаблены и не изменены.
