# Production deployment: nginx + Docker

Production-схема: системный nginx принимает `80/443`, приложение работает непривилегированным пользователем внутри Docker и доступно только на `127.0.0.1:3000`. PostgreSQL 16 хранит данные в named volume `tasktopia_postgres` и должен пройти healthcheck до запуска приложения.

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

install -m 0644 deploy/nginx-tasktopia.conf /etc/nginx/sites-available/tasktopia
ln -sfn /etc/nginx/sites-available/tasktopia /etc/nginx/sites-enabled/tasktopia
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot --nginx -d tasktopia.online --redirect
curl -fsS https://tasktopia.online/health
```

Certbot добавляет HTTPS-блок и системный timer продления сертификата. После выпуска сертификата HTTP перенаправляется на HTTPS.

## Production environment

```dotenv
APP_ORIGIN=https://tasktopia.online
POSTGRES_PASSWORD=<длинный-случайный-пароль>
SESSION_COOKIE_SECURE=true
LOG_LEVEL=info
```

Публичный MCP endpoint: `https://tasktopia.online/mcp`. Публичная инструкция для интеграций: `https://tasktopia.online/ai.md`. Обе ссылки отображаются в настройках из `location.origin`, поэтому отдельный клиентский env не требуется.

## Обновление

```bash
/srv/tasktopia/app/deploy/update-server.sh
```

Скрипт использует только fast-forward `git pull`, пересобирает один сервис, ждёт health check и не публикует порт 3000 наружу.

Compose ограничивает Tasktopia отдельно от соседних проектов: приложение — 1,5 CPU, 1 GiB RAM и 160 процессов; PostgreSQL — 0,75 CPU, 768 MiB RAM и 100 процессов. Это верхние границы, а не резервирование: неиспользованные CPU остаются доступны другим контейнерам. После изменения бюджетов проверяйте `docker inspect`, `docker stats --no-stream` и флаг `OOMKilled`; не снимайте лимиты соседнего проекта для ускорения Tasktopia.

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
