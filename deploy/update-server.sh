#!/usr/bin/env bash
set -euo pipefail

readonly APP_DIR="${TASKTOPIA_APP_DIR:-/srv/tasktopia/app}"
readonly BRANCH="${TASKTOPIA_BRANCH:-main}"
readonly BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-14}"
readonly MIN_FREE_SPACE_MB="${MIN_FREE_SPACE_MB:-1024}"

if [[ ! "$BACKUP_RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_RETENTION_COUNT must be a positive integer" >&2
  exit 2
fi
if [[ ! "$MIN_FREE_SPACE_MB" =~ ^[1-9][0-9]*$ ]]; then
  echo "MIN_FREE_SPACE_MB must be a positive integer" >&2
  exit 2
fi

cd "$APP_DIR"
if docker compose ps --status running postgres | grep -q postgres; then
  available_kb="$(df -Pk "$APP_DIR" | awk 'NR == 2 { print $4 }')"
  if (( available_kb < MIN_FREE_SPACE_MB * 1024 )); then
    echo "Refusing update: less than ${MIN_FREE_SPACE_MB} MiB is free in $APP_DIR" >&2
    exit 1
  fi
  umask 077
  install -d -m 0700 backups
  docker compose exec -T postgres pg_dump -U tasktopia -d tasktopia -Fc \
    > "backups/pre-update-$(date +%F-%H%M%S).dump"
  shopt -s nullglob
  backups=(backups/pre-update-*.dump)
  stale_count=$(( ${#backups[@]} - BACKUP_RETENTION_COUNT ))
  if (( stale_count > 0 )); then
    for (( index = 0; index < stale_count; index += 1 )); do
      rm -- "${backups[$index]}"
    done
  fi
  shopt -u nullglob
fi
git pull --ff-only origin "$BRANCH"
docker compose build --pull app
docker compose up -d --remove-orphans app
docker compose ps
curl --fail --silent --show-error \
  --retry 30 --retry-delay 2 --retry-connrefused --retry-all-errors \
  http://127.0.0.1:3000/health
