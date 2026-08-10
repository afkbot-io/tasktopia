#!/usr/bin/env bash
set -euo pipefail

readonly APP_DIR="${TASKTOPIA_APP_DIR:-/srv/tasktopia/app}"
readonly BRANCH="${TASKTOPIA_BRANCH:-main}"

cd "$APP_DIR"
if docker compose ps --status running postgres | grep -q postgres; then
  umask 077
  install -d -m 0700 backups
  docker compose exec -T postgres pg_dump -U tasktopia -d tasktopia -Fc \
    > "backups/pre-update-$(date +%F-%H%M%S).dump"
fi
git pull --ff-only origin "$BRANCH"
docker compose build --pull app
docker compose up -d --remove-orphans app
docker compose ps
curl --fail --silent --show-error \
  --retry 30 --retry-delay 2 --retry-connrefused --retry-all-errors \
  http://127.0.0.1:3000/health
