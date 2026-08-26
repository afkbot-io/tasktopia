# Self-hosting и production deployment

Tasktopia поставляется как четыре runtime-контейнера: web API/Socket.IO, MCP,
world replay и PostgreSQL 16. Порты Node-процессов привязаны только к loopback:
`127.0.0.1:3000`, `:3002` и `:3003`, поэтому наружу их
следует публиковать только через nginx, Caddy, Traefik или другой TLS-proxy.

## Быстрый запуск Docker Compose

```bash
git clone https://github.com/afkbot-io/tasktopia.git
cd tasktopia
cp deploy/.env.self-host.example .env
openssl rand -hex 32
```

Запишите полученный секрет в `POSTGRES_PASSWORD`, затем запустите сервисы:

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3003/health
```

Redis не обязателен. Для общей versioned cache и distributed cold-build lease задайте `REDIS_URL=redis://redis:6379` и поднимайте профиль `docker compose --profile cache up -d --build`. Без профиля или при недоступном Redis каждый runtime автоматически использует PostgreSQL; Redis не содержит канонических данных и работает без persistence.

Публичная регистрация в self-hosted production закрыта по умолчанию. Создайте
первого владельца после успешного healthcheck:

```bash
docker compose exec app npm run user:create -- \
  --email admin@example.com \
  --name "Администратор" \
  --country "Компания" \
  --city "Главный продукт"
```

Пароль вводится два раза без отображения в терминале. Для CI/secret manager
доступен `--password-stdin`: первые две строки stdin должны содержать пароль и
его подтверждение. Передавать пароль через аргументы командной строки команда
намеренно не разрешает.

Обязательные параметры находятся в [`deploy/.env.self-host.example`](../deploy/.env.self-host.example).
Named volumes `tasktopia_postgres` и `tasktopia_uploads` переживают замену
контейнеров. Не используйте `docker compose down -v` на сервере с данными.

Для разработки на хосте используйте явный override, который публикует
PostgreSQL только на loopback. Основной production compose порт базы не
публикует:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
npm run seed
npm run dev
```

Команда `npm run seed` создаёт компактный development fixture: один город,
10 районов и 30 задач. Полный демонстрационный мир запускается отдельно через
`npm run seed:showcase` и не входит в обычную установочную проверку.

Интеграционные и browser-тесты используют отдельную временную БД:

```bash
npm run test:db:start
npm test
npm run test:e2e
npm run test:db:stop
```

## Автоматическая установка домена и HTTPS

Для чистого Ubuntu/Debian-сервера сначала направьте A/AAAA-запись домена на
сервер, затем выполните:

```bash
git clone --depth 1 https://github.com/afkbot-io/tasktopia.git /tmp/tasktopia-bootstrap
sudo /tmp/tasktopia-bootstrap/deploy/install-server.sh \
  --domain tasks.example.com \
  --email admin@example.com
```

Установщик проверяет аргументы, ставит Docker/nginx/Certbot, генерирует пароль
PostgreSQL, поднимает контейнеры, проверяет `/health` и только после HTTP-проверки
материализует первый static release и выпускает сертификат. nginx берёт
`/assets/`, versioned game assets и manifest из атомарного
`/srv/tasktopia/static/current`, поэтому они доступны даже при пересоздании
app-контейнера. Другой безопасный абсолютный путь можно задать через
`TASKTOPIA_STATIC_DIR`; installer сохраняет его в `.env`, и последующие
обновления используют тот же mount без повторного экспорта переменной. Для fork или приватного репозитория доступны
`--repository`, `--branch` и `--app-dir`.

Повторный запуск installer поверх существующего Git checkout безопасно
отклоняется до `apt`, Docker и nginx-изменений. Для установленного экземпляра
всегда используйте updater ниже: только он соблюдает prepublish, health-check и
атомарное переключение статики.

Обновление делает резервную копию PostgreSQL, принимает только fast-forward и
останавливается, если новый контейнер не проходит healthcheck:

```bash
sudo git -C /srv/tasktopia/app pull --ff-only origin main
sudo /srv/tasktopia/app/deploy/update-server.sh
```

Внешний `git pull` обязателен: так обновление запускается уже новой версией
скрипта. Встроенная повторная проверка защищает от следующего изменения между
этими двумя командами.

## Конфигурация reverse proxy

- [`nginx-self-host-bootstrap.conf.template`](../deploy/nginx-self-host-bootstrap.conf.template) — HTTP до выпуска сертификата;
- [`nginx-self-host.conf.template`](../deploy/nginx-self-host.conf.template) — универсальный HTTPS-конфиг;
- [`nginx-tasktopia.conf`](../deploy/nginx-tasktopia.conf) — конфигурация официального `tasktopia.online`.

Ниже описана официальная production-схема Tasktopia и её CDN-настройки.

## Официальный production: nginx + Docker

Production-схема: системный nginx принимает `80/443`; web работает на `127.0.0.1:3000`, `/mcp` направляется в отдельный runtime `127.0.0.1:3002`, а `world` worker — на `127.0.0.1:3003`. HTTP replay принимается web runtime как короткая durable command и возвращает результат либо `202`; тяжёлую геометрию всегда исполняет world worker через PostgreSQL queue. У процессов отдельные Node event loop и пулы PostgreSQL 10/4/4, поэтому CPU-stall MCP или генерации не блокирует карту и health web. PostgreSQL 16 хранит данные в named volume `tasktopia_postgres` и должен пройти healthcheck до запуска runtime.

Хешированные JS/CSS и versioned game assets после успешного healthcheck
копируются в `/srv/tasktopia/static/releases/<release>` и атомарно публикуются
через `/srv/tasktopia/static/current`. Поэтому nginx и `store.tasktopia.online`
продолжают отдавать предыдущую полную ревизию во время пересоздания app-контейнера,
а пользователи не получают частично обновлённый набор чанков и спрайтов.

## Первый запуск на Ubuntu/Debian

```bash
apt-get update
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx docker.io docker-compose-v2
systemctl enable --now docker nginx

install -d -m 0755 /srv/tasktopia/app
# Репозиторий клонируется в /srv/tasktopia/app через read-only GitHub deploy key.
cd /srv/tasktopia/app
cp deploy/.env.production.example .env
chmod 0600 .env

docker compose up -d --build app mcp world
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3003/health

release_dir="/srv/tasktopia/static/releases/bootstrap-$(date +%Y%m%d%H%M%S)"
install -d -m 0755 "$release_dir"
docker compose cp app:/app/dist/public/. "$release_dir/"
ln -sfn "$release_dir" /srv/tasktopia/static/current

install -m 0644 deploy/nginx-tasktopia-bootstrap.conf /etc/nginx/sites-available/tasktopia
ln -sfn /etc/nginx/sites-available/tasktopia /etc/nginx/sites-enabled/tasktopia
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot certonly --nginx -d tasktopia.online
install -m 0644 deploy/nginx-tasktopia.conf /etc/nginx/sites-available/tasktopia
nginx -t
systemctl reload nginx
curl -fsS https://tasktopia.online/health
```

Конфигурация выделяет `POST /api/countries/:countryId/regenerate` в явный
proxy-маршрут web runtime. Web только создаёт durable job и ограниченно ждёт;
полный детерминированный replay выполняет отдельный world worker, а после
`GENERATION_WAIT_MS` клиент получает `202` и продолжает polling.

Для release-wide replay запускайте CLI внутри отдельного одноразового world-контейнера:

```bash
REGENERATION_RUN_ID="release-$(git rev-parse --short HEAD)" \
REGENERATION_FORCE=1 \
docker compose run --rm -e REGENERATION_RUN_ID -e REGENERATION_FORCE world npm run worlds:regenerate
```

CLI берёт глобальный PostgreSQL advisory lock и немедленно завершается, если другой release replay уже запущен. Пул ограничивается `DATABASE_POOL_MAX` world-runtime, а не внутренним значением по умолчанию.

Команда обрабатывает страны по одной: audit-clean миры сохраняет, а некорректные
перестраивает и валидирует до commit. Failed layout по умолчанию повторяется до
трёх раз. При необходимости передайте
`-e REGENERATION_MAX_ATTEMPTS=5`; не запускайте два batch replay одновременно.

Публичный onboarding является отдельным атомарным bootstrap-путём: account,
country, session и первый city фиксируются одной транзакцией без generation job.
Это не переносит обычную генерацию в web runtime — все последующие create/replay
команды по-прежнему выполняет изолированный `world` worker.

### Release gate для compact geometry и generation queue

Миграции `0017` и `0018` additive: очередь и `cell_runs_json` создаются до переключения runtime, legacy DISTRICT membership не удаляется. После миграции до replay обязательна точная двусторонняя parity-проверка координат: разверните каждый run через `generate_series(start.x, end.x)` и выполните `(legacy EXCEPT compact) UNION ALL (compact EXCEPT legacy)` по `(district_id, chunk_x, chunk_y, x, y)`. Ненулевое число строк запрещает релиз; одной проверки количества недостаточно, потому что сдвинутый run может иметь ту же длину. Затем проверьте один принятый job через HTTP `202`/`GET /api/world-generation-jobs/:jobId` и MCP `world_generation.get`. Rollback приложения безопасен: старая проекция продолжает обновляться trigger'ом. Cleanup legacy projection не входит в этот релиз.

После healthcheck прогрейте один detail viewport, повторите запрос и сравните `X-World-Version`, `contentHash`, latency и количество spatial SQL reads. При включённом Redis повтор на другой web replica должен вернуть тот же content hash; остановка Redis не должна менять HTTP body или статус.

Bootstrap-конфиг нужен только до первого выпуска сертификата. После него
финальный конфиг использует сертификат из `/etc/letsencrypt/live/tasktopia.online`,
перенаправляет HTTP на HTTPS, а системный timer Certbot продлевает сертификат.

## Production environment

```dotenv
APP_ORIGIN=https://tasktopia.online
# После успешной CDN-проверки задайте единый origin:
# STATIC_ORIGIN=https://store.tasktopia.online
POSTGRES_PASSWORD=<длинный-случайный-пароль>
SESSION_COOKIE_SECURE=true
REGISTRATION_ENABLED=false
LOG_LEVEL=info
APP_MEMORY_LIMIT=1536m
APP_CPU_LIMIT=2.00
POSTGRES_MEMORY_LIMIT=1g
POSTGRES_CPU_LIMIT=1.00
BACKUP_RETENTION_COUNT=14
STATIC_RETENTION_COUNT=3
MIN_FREE_SPACE_MB=1024
```

`REGISTRATION_ENABLED=false` оставляет доступным только вход и блокирует
публичный endpoint регистрации. Учётные записи по-прежнему создаются локальной
командой `docker compose exec app npm run user:create -- ...`. Для открытого
экземпляра самостоятельная регистрация включается только явным значением
`REGISTRATION_ENABLED=true` и пересозданием app-контейнера.

`STATIC_ORIGIN` одновременно встраивается в клиент во время
`docker compose build` и добавляется в CSP приложения, поэтому client/runtime
origin не могут разойтись. CDN должен использовать `https://tasktopia.online` как origin,
возвращать CORS-заголовок
`Access-Control-Allow-Origin: https://tasktopia.online` для JS, CSS, шрифтов и
PNG. Игровой пак публикует content revision отдельным сегментом пути
`/game-assets/v5/revisions/<assetRevision>/...`, поэтому корректность
immutable-кэша не зависит от политики CDN по query string.

Если CDN сохраняет исходный Host `store.tasktopia.online`, используйте
одноимённый HTTP origin-vhost из `deploy/nginx-tasktopia.conf`: он проксирует
только `/assets/` и `/game-assets/` в приложение, а для остальных путей
возвращает 404. Это не позволяет CDN случайно открыть API или MCP.

До включения CDN проверьте сертификат и доставку одного хешированного bundle и
одного игрового PNG:

```bash
curl -fsSIL https://store.tasktopia.online/
openssl s_client -connect store.tasktopia.online:443 -servername store.tasktopia.online </dev/null 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
# После сборки возьмите реальные URL из dist/public/index.html и manifest:
curl -fsSIL 'https://store.tasktopia.online/assets/<vite-hash>.js'
curl -fsSIL 'https://store.tasktopia.online/game-assets/v5/revisions/<assetRevision>/props/gazebo.png'
```

Если SAN не содержит `store.tasktopia.online`, `STATIC_ORIGIN` должен оставаться
пустым: приложение продолжит безопасно раздавать статику с основного домена.
После изменения `STATIC_ORIGIN` обязательна новая сборка образа.

Контейнер хранит три последние физические ревизии игрового пака в volume
`tasktopia_asset_revisions`. Поэтому уже открытая вкладка продолжает получать
свою immutable-ревизию после следующего обновления, пока пользователь не
перезагрузит страницу.

Публичный MCP endpoint: `https://tasktopia.online/mcp`. Публичная инструкция для интеграций: `https://tasktopia.online/ai.md`. Обе ссылки отображаются в настройках из `location.origin`, поэтому отдельный клиентский env не требуется.

## Обновление

```bash
git -C /srv/tasktopia/app pull --ff-only origin main
TASKTOPIA_EXPECTED_REVISION="$(git -C /srv/tasktopia/app rev-parse HEAD)" \
  /srv/tasktopia/app/deploy/update-server.sh
```

`TASKTOPIA_EXPECTED_REVISION` фиксирует ровно одобренный полный commit: если
повторный pull увидит более новый `main`, updater остановится до backup/build и
потребует новую проверку и authorization. Внешний fast-forward обязателен, чтобы Bash не продолжил уже открытую старую
версию скрипта после замены файла. Сам скрипт повторно выполняет только
fast-forward `git pull` и перезапускает себя, если между командами появился
новый commit. Затем он проверяет свободное место,
создаёт dump, сохраняет последние `BACKUP_RETENTION_COUNT` копий, пересобирает
общий image и атомарно пересоздаёт `app`, `mcp`, `world`; до их переключения
экспортируется новый public tree. Новые
content-addressed JS/CSS и текущая игровая ревизия сначала материализуются в
отдельном контейнере без production volumes, после чего сохранённые ревизии
ограниченно объединяются с новым деревом. Версия package входит в browser
entry, поэтому каждый patch-релиз получает новый content-addressed bundle.
Новые пути предварительно добавляются в уже
активный static release без перезаписи существующих immutable-файлов, поэтому
pull-CDN не увидит временный `404/504` для bundle из нового HTML. После health
check полный каталог статики переключается атомарно; при провале проверки
возвращается предыдущий app image, а незавершённый release удаляется. Уже
опубликованные immutable-файлы не исчезают во время rollback: последние
`FAILED_ASSET_RETENTION_COUNT` неудачные Vite-поколения (по умолчанию три) и до
`FAILED_ASSET_RETENTION_COUNT + 2` игровых ревизий (по умолчанию пять: текущая,
предыдущая и соответствующие неудачным поколениям) остаются доступны, более
старые удаляются по журналам.
Один предыдущий успешный набор Vite bundle сохраняется для lazy-import уже
открытых вкладок. Эксклюзивная блокировка не допускает два одновременных
обновления. Установки без static release автоматически создают его из
работающего app-контейнера; nginx-конфигурация установок, созданных штатным
self-host installer, автоматически переводится на этот каталог до замены app.
Порты 3000, 3002 и 3003 наружу не публикуются.

Compose ограничивает Tasktopia отдельно от соседних проектов: web — 2 CPU/1,5 GiB, MCP — 1 CPU/768 MiB, world replay — 2 CPU/1,5 GiB, PostgreSQL — 1 CPU/1 GiB. Это верхние границы, а не резервирование: неиспользованные CPU остаются доступны другим контейнерам. После изменения бюджетов проверяйте `docker inspect`, `docker stats --no-stream` и флаг `OOMKilled`; не снимайте лимиты соседнего проекта для ускорения Tasktopia.

## Резервная копия

Перед обновлениями схемы:

```bash
cd /srv/tasktopia/app
install -d -m 0700 backups
docker compose exec -T postgres pg_dump -U tasktopia -d tasktopia -Fc \
  > "backups/tasktopia-$(date +%F-%H%M).dump"
```

Проверяйте восстановление дампа в отдельной базе через `pg_restore` до обновления production.

## Проверка

```bash
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 mcp world
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3003/health
curl -fsS https://tasktopia.online/health
curl -fsS https://tasktopia.online/ai.md | head
nginx -t
certbot renew --dry-run
ss -lntp
```

Ожидаемые публичные порты: только `22`, `80`, `443`. Runtime-порты `3000`, `3002`, `3003` должны слушать исключительно `127.0.0.1`, а PostgreSQL не публикуется наружу. Межпроцессные доменные события передаются bounded PostgreSQL `NOTIFY` с последующим чтением durable `events`; Socket.IO остаётся только в web runtime.
