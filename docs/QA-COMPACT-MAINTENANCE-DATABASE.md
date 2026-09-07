# Первый compact cutover: PostgreSQL backup и recovery

Статус: DB-часть реализована и проверена. Production не изменён; весь host cutover
ещё не готов. Основа — журнал из `compact_cutover_state.py`, существующий updater
не ослаблен. В CI добавлена отдельная изолированная Docker-проверка.

## Контракт

- Только полный immutable container ID, image ID и точный named volume.
- Архив custom-format, baseline и proof — private-файлы; без перезаписи,
  symlink-переходов, shell hooks и вывода данных/секретов в общий лог.
- Snapshot всех строк, включая дубликаты, JSON, Unicode и переводы строк,
  считается потоково. Проверяются схема, владельцы/ACL БД и sequences.
  Меняющиеся psql restrict keys исключаются из schema hash, SQL остаётся целиком.
- Неизвестные сессии/фоновые writers и неподдержанные схемы/расширения — отказ,
  а не принудительное завершение чужих соединений.
- Proof использует новый контейнер и том, без сети и открытых портов, с лимитами
  2 CPU / 1 GiB / 128 PID. Имя, label, образ и том проверяются до start/stop.
- Разрушительный `restore_verified` доступен только с проверенным proof той же
  копии. Он восстанавливает одну БД `tasktopia`, без `DROP ... FORCE`.
  После него повторно сравнивается вся БД. Он сам **не** управляет traffic/lock.
- Docker exec дополнительно ограничен timeout внутри контейнера. После отмены
  внешний driver снова проверяет отсутствие DB-сессий; убийство Docker CLI
  само по себе не доказывает остановку серверной команды.
- Проверочные контейнеры остановлены, тома сохранены для разбора. Автоматического
  удаления production-данных или старых backup нет.

## Выполнено 7 сентября 2026

1. RED до реализации backup-модуля; GREEN: 7 Python unit tests.
2. `npx vitest run tests/compact-cutover-state.test.ts tests/compact-cutover-database.test.ts tests/compact-release-preflight.test.ts`
   — 27 tests / 3 files PASS; wrapper журнала отдельно исполняет 20 Python tests.
3. Синтетическая Docker-репетиция: отказ при PENDING job и реальном втором клиенте,
   обнаружение изменения строки/sequence/индекса, независимое восстановление,
   изменение исходной тестовой БД, in-place recovery и его повтор.
4. Реальный `pg_restore` повреждённого архива завершился ошибкой; proof не создан,
   его контейнер остановлен. Не путать это с полной матрицей crash host cutover.
5. Реальная онлайн-копия: 35 таблиц, 77 594 строки, 3 sequences. Новый backend
   создал собственный архив, восстановил в новый том и сравнил всю БД. Затем
   в **тестовой копии** изменены title задачи, event sequence и схема; in-place
   recovery и повторный recovery вернули точный snapshot.
6. Обнаружен и исправлен readiness race Docker Postgres: временный Unix-socket
   init server нельзя считать окончательно готовым; ожидается TCP `127.0.0.1`.
7. При ревью воспроизведён отказ повторного recovery после DROP БД. Проверка
   соединений перенесена в control DB `postgres`; учитываются клиенты обеих БД.
   Recovery при отсутствующей `tasktopia` теперь проходит. fsync родительского
   каталога артефактов добавлен до первой внешней операции.

Образ PostgreSQL обеих репетиций:
`sha256:7e7dbab8d3b431a20793a6d99cb5a6bc84e44914309917f1bf5589a7568cdefd`.

Защищённые локальные evidence (в Git не включены):

- Синтетический report `tmp/cutover-database-2ri9h_7a/integration-report.json`,
  SHA256 `21ddb4c395fcd8f410710659f818cf60731e2f74fa4727aa7b0b415c4beb3ee7`.
- Реальный report `tmp/cutover-database-osp_i6l9/integration-report.json`,
  SHA256 `b39fa90a6e845799073c58c4ddc7e17ac68940ec7e6758c016c02e108f0d5442`.
- Полный real-data snapshot SHA256:
  `05f129482b967cf56b90b1478cf52c997659cfd5dbadb4c3d715d47dedd62108`.

## Повторная проверка

```sh
python3 tests/compact_cutover_database_test.py
python3 tests/compact_cutover_database_integration.py --pg-image sha256:<полный-id-локального-образа-PostgreSQL-16>
```

Дополнительные `--archive /absolute/private.dump --archive-sha256 <sha>` проверяют
копию реальных данных Tasktopia. Архив только читается и копируется в новый run.
Тест не принимает URL БД, адрес SSH или существующий том назначения.

## До релиза остаётся

Полный host adapter с maintenance, общим deployment lock, writer freeze,
совместным config/uploads/static/image rollback; подключение миграции/FORCE/audit
и conservation; сквозная репетиция тем же host entrypoint и failure injection;
review точного результата, зелёный CI, managed merge и Builder `ready: true`.
Эта DB-проверка не заменяет ни один из перечисленных отсутствующих gates.
