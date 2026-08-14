# Self-hosting и production deployment

Tasktopia поставляется как два контейнера: приложение и PostgreSQL 16. По
умолчанию HTTP-порт приложения привязан к `127.0.0.1:3000`, поэтому наружу его
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
```

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
выпускает сертификат. Для fork или приватного репозитория доступны
`--repository`, `--branch` и `--app-dir`.

Обновление делает резервную копию PostgreSQL, принимает только fast-forward и
останавливается, если новый контейнер не проходит healthcheck:

```bash
sudo /srv/tasktopia/app/deploy/update-server.sh
```

## Конфигурация reverse proxy

- [`nginx-self-host-bootstrap.conf.template`](../deploy/nginx-self-host-bootstrap.conf.template) — HTTP до выпуска сертификата;
- [`nginx-self-host.conf.template`](../deploy/nginx-self-host.conf.template) — универсальный HTTPS-конфиг;
- [`nginx-tasktopia.conf`](../deploy/nginx-tasktopia.conf) — конфигурация официального `tasktopia.online`.

Ниже описана официальная production-схема Tasktopia и её CDN-настройки.

## Официальный production: nginx + Docker

Production-схема: системный nginx принимает `80/443`, приложение работает непривилегированным пользователем внутри Docker и доступно только на `127.0.0.1:3000`. PostgreSQL 16 хранит данные в named volume `tasktopia_postgres` и должен пройти healthcheck до запуска приложения.

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

docker compose up -d --build app
curl -fsS http://127.0.0.1:3000/health

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

Конфигурация выделяет `POST /api/countries/:countryId/regenerate` в отдельный
proxy-маршрут с таймаутом 15 минут. Полный детерминированный replay большой
страны может занимать несколько минут; не заменяйте этот маршрут общим
75-секундным лимитом API.

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
/srv/tasktopia/app/deploy/update-server.sh
```

Скрипт использует только fast-forward `git pull`, проверяет свободное место,
создаёт dump, сохраняет последние `BACKUP_RETENTION_COUNT` копий, пересобирает
один сервис, ждёт health check и только затем атомарно переключает каталог
статики. Порт 3000 наружу не публикуется.

Compose ограничивает Tasktopia отдельно от соседних проектов: приложение — 2 CPU, 1,5 GiB RAM и 160 процессов; PostgreSQL — 1 CPU, 1 GiB RAM и 100 процессов. Это верхние границы, а не резервирование: неиспользованные CPU остаются доступны другим контейнерам. После изменения бюджетов проверяйте `docker inspect`, `docker stats --no-stream` и флаг `OOMKilled`; не снимайте лимиты соседнего проекта для ускорения Tasktopia.

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
curl -fsS http://127.0.0.1:3000/health
curl -fsS https://tasktopia.online/health
curl -fsS https://tasktopia.online/ai.md | head
nginx -t
certbot renew --dry-run
ss -lntp
```

Ожидаемые публичные порты: только `22`, `80`, `443`. Порт приложения `3000` должен слушать исключительно `127.0.0.1`, а PostgreSQL не публикуется наружу. Для нескольких app replicas требуется общий Socket.IO broker.
