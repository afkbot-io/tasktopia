# Host freeze первого cutover

Проверено 7 сентября 2026. Production не изменён. Новый модуль не является
deployment CLI и сам не даёт разрешения на release.

## Реализованные границы

- `DeploymentLock` использует `.git/tasktopia-update.lock`, как обычный updater.
  Второй процесс/descriptor не допускается; symlink и небезопасный owner/mode запрещены.
- `NginxMaintenance` сохраняет private baseline точного канонического site и
  включённого symlink. Допускаются две существующие управляемые self-host формы:
  static и прежняя proxy-конфигурация. Кастомный конфиг не переписывается.
- Maintenance атомарно устанавливается с сохранением mode/owner и fsync.
  `nginx -t`, reload и новые HTTP/TLS-запросы проверяют 503 и уникальный header
  planDigest на `/`, `/mcp`, `/api/.../regenerate`, `/socket.io/`.
- Ошибка reload не восстанавливает открытый конфиг автоматически. Она также
  **не означает**, что старые workers уже перестали обслуживать запросы:
  freeze разрешён только после успешной проверки maintenance.
- Открытие site требует journal OPENING/pending=open_traffic. Проверка полноты
  acceptance остаётся у существующего state protocol и будущего host driver.
- `WriterFreeze` сверяет Compose project/working_dir, точные container/image IDs,
  runtime role, hashes конфигурации/томов и restart policy `unless-stopped`.
  Неизвестная активная роль, duplicate/one-off или несовпадение — отказ до stop.
- Останавливаются только проверенные app/mcp/world ID. Повторный stop разрешён;
  после него роли перечитываются и maintenance проверяется снова.

Существующие WebSocket/долгие соединения старого Nginx могут дренироваться после
reload. Остановка upstream-ролей и последующая проверка PostgreSQL обязательны.
Этот модуль не доказывает отсутствие unlabelled writers или других пользователей
uploads volume; это остаётся обязательной проверкой полного host inventory.

## Доказательства

1. RED до появления модуля; 3 Python boundary tests PASS.
2. Vitest: 28 tests / 4 files PASS (`host`, `state`, `database`, `preflight`).
   Внутри wrappers отдельно исполняются Python-наборы 3/20/7 tests.
3. Реальный отдельный Nginx 1.29.6 с локальным TLS-сертификатом, случайными
   loopback-only портами и private prefix. Системный Nginx не перезапускался.
4. Три новые Docker-роли + отдельный unknown-writer на `network=none`.
   Production containers, endpoints, credentials и данные не используются.
5. Отказ при custom site; ошибка `nginx -t` с сохранением maintenance-файла;
   повторный enable; 503 по всем маршрутам; отказ open без accept; неизвестный
   writer не приводит к остановке проверенных ролей; `restart=always` отвергнут;
   повторный stop успешен; explicit opening восстанавливает исходный site побайтно.
6. Types, scoped lint, Python compile, diffcheck PASS. Main-agent review/security
   review добавили привязку к working_dir и проверку restart policy.

Report: `tmp/cutover-host-m35exfyw/audit/host-integration-report.json`.
SHA256: `a73cba30364f2fac07f34e62f5d022ee374bef91f8cd3a6185d78f2eb4f09f73`.
Nginx завершён, проверено отсутствие слушателей. Все тестовые контейнеры
остановлены, тома/артефакты сохранены. В Git нет private-файлов или сертификатов.

```sh
python3 tests/compact_cutover_host_test.py
python3 tests/compact_cutover_host_integration.py --image sha256:<локальный-образ-с-sleep> --nginx /absolute/nginx --openssl /absolute/openssl
```

В CI добавлена отдельная проверка на системном Nginx Ubuntu. Её результат
относится только к конкретному CI SHA; локальный PASS не заменяет CI.

## Что НЕ проверено этим тестом

Полный host prepare/recover/accept; запуск настоящих app/mcp/world; соединение
freeze с DB backend; переключение candidate/static; backup и восстановление
config/uploads; миграции/FORCE/conservation/audit; public QA/CDN/PWA/observation.
Тест вручную задаёт состояния журнала для проверки компонентов и не выдаётся
за сквозную репетицию деплоя. Обычный updater, его guards и Builder не ослаблены.

## Исправление, найденное полным CI

CI `4118bafd` прошёл 1142 теста и упал на одном существующем тесте retention
статики; новые Docker-шаги были пропущены, их CI PASS не заявляется.
`prepublish_immutable_dir` создавал каталоги заново, поэтому последующий prune
сравнивал время копирования, а не исходной публикации. На границе секунды
сохранялась `dddd…` вместо более свежей `eeee…`.

Добавлена детерминированная проверка исходного mtime: RED (текущее время
вместо 4000 ms), затем GREEN. Перед prune восстанавливается mtime копий
старых revision-каталогов из active; текущая candidate revision не меняется.
Лимиты retention и защита current/previous не изменены. Проверены 55 тестов
в 5 файлах, scoped ESLint, `bash -n` и diffcheck. Это обычное исправление
инфраструктуры в PR; на сервере скрипт не запускался.

## Сквозной host driver и updated Builder 1.4.3

`update-server.sh compact-cutover prepare|recover|accept` теперь связывает
компоненты; обычный updater сохраняет оба compact guards. Поддерживается exact
официальный Nginx/CDN, включая fingerprint установленного `135bb4cc` site.
FileBackup сохраняет и независимо проверяет uploads, asset volume и старую
статику; env и два pinned Compose сохраняются private, `.env` не переписывается.
Все runtime images/roles/env/mounts/network сверяются; неизвестные writers
не останавливаются вслепую. При восстановлении допустимы остановленные durable
PENDING jobs; живые чужие DB sessions по-прежнему запрещены.

7 сентября сквозная репетиция `compact_cutover_driver_integration.py` прошла
на новой копии исходного архива: реальные PostgreSQL, candidate CLI и три
candidate runtime, отдельный TLS Nginx, все 10 стран. Prepare завершил backup,
независимый restore proof, FORCE, conservation, audit, static switch и health.
Затем recover восстановил полный DB snapshot и файлы, прежние fixture roles
прошли health; accept открыл тестовый трафик. Прежние fixture roles обслуживают
только health, не имитируют прежнюю бизнес-логику. Live target не использовался.
Report: `tmp/cutover-driver-j_c8cyhb/audit/driver-report.json`;
SHA256 `17bbdab6f30f0ed8c5e48e7abb4bbd696bfc9d3a1028d1da82d0ee8750d4a000`.
Тестовые процессы остановлены, архив/volumes сохранены. Первый запуск fixture
отказал из-за Docker Desktop internal network без loopback port forwarding;
fixture использует отдельный bridge, БД без опубликованных портов.

После репетиции добавлены read-only проверки environment/mount/network и
exact loopback ports; проверены отдельными boundary tests. 56 Vitest tests /
6 files, Python-наборы, typecheck, scoped ESLint, bash -n и diffcheck PASS.
Runtime, migrations, dependencies и арт не менялись относительно зелёного CI
`1e3b4449`: https://github.com/afkbot-io/tasktopia/actions/runs/34155973039.
Это evidence reuse по неизменным входам, а не переименование старого CI SHA.

Builder теперь определяет tasktopia.online как dev-server. Отдельного human
review эта цель не требует; актуальный AI diff review и реальные SCM protections
сохраняются. Следующие gates — managed merge, ready:true и server prepare/accept,
затем public smoke/наблюдение. Новое разрешение после каждого commit не требуется.
