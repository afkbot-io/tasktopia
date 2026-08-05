#!/usr/bin/env bash
set -euo pipefail

readonly APP_DIR="/srv/tasktopia/app"

cd "$APP_DIR"
git pull --ff-only origin main
docker compose build --pull app
docker compose up -d --remove-orphans app
docker compose ps
curl --fail --silent --show-error --retry 12 --retry-delay 2 http://127.0.0.1:3000/health
