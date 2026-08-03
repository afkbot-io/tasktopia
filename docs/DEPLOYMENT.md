# Production deployment: nginx + Docker

Production-схема: системный nginx принимает `80/443`, приложение работает непривилегированным пользователем внутри Docker и доступно только на `127.0.0.1:3000`. SQLite хранится в named volume `tasktopia_data`.

## Первый запуск на Ubuntu/Debian

```bash
apt-get update
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx docker.io docker-compose-v2
systemctl enable --now docker nginx

install -d -m 0755 /opt/tasktopia
# Репозиторий клонируется в /opt/tasktopia через read-only GitHub deploy key.
cd /opt/tasktopia
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
SESSION_COOKIE_SECURE=true
LOG_LEVEL=info
```

Публичный MCP endpoint: `https://tasktopia.online/mcp`. Он отображается в настройках из `location.origin`, поэтому отдельный клиентский env не требуется.

## Обновление

```bash
/opt/tasktopia/deploy/update-server.sh
```

Скрипт использует только fast-forward `git pull`, пересобирает один сервис, ждёт health check и не публикует порт 3000 наружу.

## Резервная копия

Перед обновлениями схемы:

```bash
cd /opt/tasktopia
docker compose stop app
install -d -m 0700 backups
docker run --rm -v tasktopia_tasktopia_data:/data -v "$PWD/backups:/backup" alpine \
  cp /data/tasktopia.db "/backup/tasktopia-$(date +%F-%H%M).db"
docker compose start app
```

Имя volume зависит от Compose project name; его нужно проверить через `docker volume ls`.

## Проверка

```bash
docker compose ps
docker compose logs --tail=100 app
curl -fsS http://127.0.0.1:3000/health
curl -fsS https://tasktopia.online/health
nginx -t
certbot renew --dry-run
ss -lntp
```

Ожидаемые публичные порты: только `22`, `80`, `443`. Порт `3000` должен слушать исключительно `127.0.0.1`. SQLite предполагает один экземпляр приложения; для горизонтального масштабирования потребуется PostgreSQL и общий event broker.
