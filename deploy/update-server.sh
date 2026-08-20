#!/usr/bin/env bash
set -euo pipefail

readonly APP_DIR="${TASKTOPIA_APP_DIR:-/srv/tasktopia/app}"
persisted_static_dir=""
if [[ -z "${TASKTOPIA_STATIC_DIR:-}" && -f "$APP_DIR/.env" ]]; then
  persisted_static_dir="$(sed -nE 's|^TASKTOPIA_STATIC_DIR=(/[^[:space:]]+)$|\1|p' "$APP_DIR/.env" | tail -n 1)"
fi
readonly STATIC_DIR="${TASKTOPIA_STATIC_DIR:-${persisted_static_dir:-/srv/tasktopia/static}}"
readonly BRANCH="${TASKTOPIA_BRANCH:-main}"
readonly BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-14}"
readonly STATIC_RETENTION_COUNT="${STATIC_RETENTION_COUNT:-3}"
readonly FAILED_ASSET_RETENTION_COUNT="${FAILED_ASSET_RETENTION_COUNT:-3}"
readonly MIN_FREE_SPACE_MB="${MIN_FREE_SPACE_MB:-1024}"
readonly UPDATE_LOCK_PATH="${TASKTOPIA_UPDATE_LOCK_PATH:-$APP_DIR/.git/tasktopia-update.lock}"

if [[ ! "$BACKUP_RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_RETENTION_COUNT must be a positive integer" >&2
  exit 2
fi
if [[ ! "$MIN_FREE_SPACE_MB" =~ ^[1-9][0-9]*$ ]]; then
  echo "MIN_FREE_SPACE_MB must be a positive integer" >&2
  exit 2
fi
if [[ ! "$STATIC_RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "STATIC_RETENTION_COUNT must be a positive integer" >&2
  exit 2
fi
if [[ ! "$FAILED_ASSET_RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "FAILED_ASSET_RETENTION_COUNT must be a positive integer" >&2
  exit 2
fi
if [[ ! "$STATIC_DIR" =~ ^/[A-Za-z0-9._/-]+$ || "$STATIC_DIR" == / || "$STATIC_DIR" == /srv ]]; then
  echo "TASKTOPIA_STATIC_DIR must be a specific absolute path" >&2
  exit 2
fi

if [[ -n "${TASKTOPIA_UPDATE_LOCK_FD:-}" ]]; then
  [[ "$TASKTOPIA_UPDATE_LOCK_FD" =~ ^[0-9]+$ ]] || {
    echo "TASKTOPIA_UPDATE_LOCK_FD must be a file descriptor" >&2
    exit 2
  }
  update_lock_fd="$TASKTOPIA_UPDATE_LOCK_FD"
else
  install -d -m 0755 "$(dirname "$UPDATE_LOCK_PATH")"
  update_lock_fd=9
  exec 9>"$UPDATE_LOCK_PATH"
fi
if ! flock -n "$update_lock_fd"; then
  echo "Another Tasktopia update is already running" >&2
  exit 1
fi
export TASKTOPIA_UPDATE_LOCK_FD="$update_lock_fd"
asset_revision_retention_count=$((FAILED_ASSET_RETENTION_COUNT + 2))

cd "$APP_DIR"
checkout_head_before_pull="$(git rev-parse HEAD)"
git pull --ff-only origin "$BRANCH"
checkout_head_after_pull="$(git rev-parse HEAD)"
if [[ "$checkout_head_before_pull" != "$checkout_head_after_pull" \
  && "${TASKTOPIA_UPDATE_REEXEC:-}" != "$checkout_head_after_pull" ]]; then
  exec env TASKTOPIA_UPDATE_REEXEC="$checkout_head_after_pull" \
    TASKTOPIA_UPDATE_LOCK_FD="$update_lock_fd" \
    "$APP_DIR/deploy/update-server.sh"
fi
source "$APP_DIR/deploy/static-release.sh"

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

previous_app_container_id="$(docker compose ps -q app)"
previous_app_image_id=""
app_was_running="false"
if [[ -n "$previous_app_container_id" ]]; then
  previous_app_image_id="$(docker inspect --format '{{.Image}}' "$previous_app_container_id")"
  app_was_running="$(docker inspect --format '{{.State.Running}}' "$previous_app_container_id")"
fi

app_image_ref="$(docker compose config --format json \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["services"]["app"]["image"])')"
if [[ -z "$app_image_ref" ]]; then
  echo "Unable to resolve the configured app image" >&2
  exit 1
fi
docker compose build --pull app

# Export the complete public tree before the application is replaced. Otherwise
# the new HTML can reference a content-addressed bundle that the pull CDN cannot
# reach yet, and the CDN may retain that transient origin error.
release_id="$(date +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
static_release_dir="$STATIC_DIR/releases/$release_id"
static_staging_dir="$STATIC_DIR/releases/.incoming-$release_id"
static_next_link="$STATIC_DIR/current.next"
prepublish_journal="$STATIC_DIR/releases/.prepublished-$release_id"
static_export_container="tasktopia-static-export-$release_id-$$"
app_replaced="false"
deployment_committed="false"
previous_static_target=""

wait_for_app_health() {
  local port
  for port in 3000 3002 3003; do
    curl --fail --silent --show-error \
      --retry 30 --retry-delay 2 --retry-connrefused --retry-all-errors \
      "http://127.0.0.1:${port}/health"
  done
}

refresh_self_host_nginx_static_config() {
  local app_origin self_host_domain site_name site_path enabled_path
  local candidate_path backup_path legacy_path
  [[ -f "$APP_DIR/.env" ]] || return 0
  app_origin="$(sed -nE 's|^APP_ORIGIN=https://([^/[:space:]]+)/?$|\1|p' "$APP_DIR/.env" | tail -n 1)"
  [[ "$app_origin" =~ ^[A-Za-z0-9][A-Za-z0-9.-]+[A-Za-z0-9]$ ]] || return 0
  self_host_domain="$app_origin"
  site_name="tasktopia-${self_host_domain//./-}"
  site_path="/etc/nginx/sites-available/$site_name"
  [[ -f "$site_path" ]] || return 0
  enabled_path="/etc/nginx/sites-enabled/$site_name"
  if [[ ! -L "$enabled_path" \
    || "$(readlink -f "$enabled_path" 2>/dev/null || true)" != "$(readlink -f "$site_path")" ]]; then
    echo "Skipping unmanaged self-host nginx site: $site_path" >&2
    return 0
  fi

  candidate_path="$site_path.tasktopia-candidate-$$"
  backup_path="$site_path.tasktopia-backup-$$"
  legacy_path="$site_path.tasktopia-legacy-$$"
  sed "s|__DOMAIN__|$self_host_domain|g" \
    "$APP_DIR/deploy/nginx-self-host-legacy-proxy.conf.template" > "$legacy_path"
  if ! is_managed_self_host_nginx_config "$site_path" "$legacy_path"; then
    rm -f -- "$legacy_path"
    echo "Skipping customized self-host nginx site: $site_path" >&2
    return 0
  fi
  rm -f -- "$legacy_path"

  sed \
    -e "s|__DOMAIN__|$self_host_domain|g" \
    -e "s|__STATIC_DIR__|$STATIC_DIR|g" \
    "$APP_DIR/deploy/nginx-self-host.conf.template" > "$candidate_path"
  chmod --reference="$site_path" "$candidate_path"
  cp -p -- "$site_path" "$backup_path"
  mv -f -- "$candidate_path" "$site_path"
  if nginx -t && systemctl reload nginx; then
    rm -f -- "$backup_path"
    return 0
  fi

  mv -f -- "$backup_path" "$site_path"
  nginx -t
  systemctl reload nginx
  echo "Unable to activate the self-host static nginx configuration" >&2
  return 1
}

cleanup_deployment() {
  exit_code=$?
  trap - EXIT
  set +e
  if [[ -n "$static_export_container" ]]; then
    docker rm -f -- "$static_export_container" >/dev/null 2>&1 || true
  fi
  if (( exit_code != 0 )) && [[ "$deployment_committed" != "true" ]]; then
    if [[ "$(readlink -f "$STATIC_DIR/current" 2>/dev/null || true)" == "$static_release_dir" ]]; then
      if [[ -n "$previous_static_target" && -d "$previous_static_target" ]]; then
        rm -f -- "$static_next_link"
        ln -s "$previous_static_target" "$static_next_link"
        mv -Tf -- "$static_next_link" "$STATIC_DIR/current"
      else
        rm -f -- "$STATIC_DIR/current"
      fi
    fi
    if [[ "$app_replaced" == "true" && "$app_was_running" == "true" \
      && -n "$previous_app_image_id" ]]; then
      echo "Deployment failed; restoring previous app image $previous_app_image_id" >&2
      docker tag "$previous_app_image_id" "$app_image_ref"
      docker compose up -d --remove-orphans --force-recreate app mcp world
      if ! wait_for_app_health; then
        echo "Rollback app image failed its health check" >&2
      fi
    elif [[ "$app_replaced" == "true" ]]; then
      docker compose rm -sf app mcp world
    fi
    if [[ -n "$previous_static_target" && -f "$prepublish_journal" ]]; then
      if [[ "$app_replaced" == "true" ]]; then
        preserve_failed_prepublished_generation \
          "$static_release_dir/.tasktopia/current-assets.list" \
          "$current_asset_revision" \
          "$previous_static_target" \
          "$release_id" \
          "$FAILED_ASSET_RETENTION_COUNT" \
          "$asset_revision_retention_count"
      else
        rollback_prepublished_paths "$prepublish_journal" "$previous_static_target"
      fi
    fi
    if [[ -d "$static_release_dir" ]]; then
      rm -rf -- "$static_release_dir"
    fi
  fi
  rm -f -- "$prepublish_journal" "$prepublish_journal.dirs"
  if [[ -d "$static_staging_dir" ]]; then
    rm -rf -- "$static_staging_dir"
  fi
  exit "$exit_code"
}
trap cleanup_deployment EXIT

install -d -m 0755 "$STATIC_DIR/releases" "$static_staging_dir"
: > "$prepublish_journal"
app_image_id="$(docker image inspect --format '{{.Id}}' "$app_image_ref" 2>/dev/null || true)"
if [[ -z "$app_image_id" ]]; then
  echo "Unable to resolve the newly built app image" >&2
  exit 1
fi
docker create --name "$static_export_container" "$app_image_id" \
  node dist/synchronize-assets.mjs >/dev/null
current_asset_revision="$(docker start -a "$static_export_container")"
if [[ ! "$current_asset_revision" =~ ^[a-f0-9]{16}$ ]]; then
  echo "Static exporter returned an invalid asset revision: $current_asset_revision" >&2
  exit 1
fi
docker cp "$static_export_container:/app/dist/public/." "$static_staging_dir/"
docker rm -f -- "$static_export_container" >/dev/null
static_export_container=""
find "$static_staging_dir" -type d -exec chmod 0755 {} +
find "$static_staging_dir" -type f -exec chmod 0644 {} +

current_static_dir="$(readlink -f "$STATIC_DIR/current" 2>/dev/null || true)"
if [[ ! -d "$current_static_dir" && "$app_was_running" == "true" ]]; then
  legacy_release_id="${release_id}-legacy-${previous_app_container_id:0:12}"
  echo "Bootstrapping the current static release from the running app container"
  bootstrap_static_release_from_container \
    "$previous_app_container_id" \
    "$STATIC_DIR" \
    "$legacy_release_id"
  current_static_dir="$(readlink -f "$STATIC_DIR/current")"
fi
if [[ -n "$current_static_dir" && -d "$current_static_dir" ]]; then
  refresh_self_host_nginx_static_config
fi
previous_static_target="$current_static_dir"
if [[ -n "$current_static_dir" && -d "$current_static_dir" ]]; then
  prepare_static_release_paths \
    "$static_staging_dir" \
    "$current_static_dir" \
    "$current_asset_revision" \
    "$asset_revision_retention_count" \
    "$prepublish_journal"
fi
mv -- "$static_staging_dir" "$static_release_dir"

# On the first installation there is no previous app or static tree to retain.
# Publish the complete tree before starting the first app so every emitted path
# is reachable immediately.
if [[ -z "$current_static_dir" ]]; then
  rm -f -- "$static_next_link"
  ln -s "$static_release_dir" "$static_next_link"
  mv -Tf -- "$static_next_link" "$STATIC_DIR/current"
fi

app_replaced="true"
docker compose up -d --remove-orphans app mcp world
docker compose ps
wait_for_app_health

# Only the complete, healthy release becomes current. During the container
# switch nginx keeps serving the previous release plus the prepublished paths.
find "$static_release_dir" -type d -exec chmod 0755 {} +
find "$static_release_dir" -type f -exec chmod 0644 {} +
rm -f -- "$static_next_link"
ln -s "$static_release_dir" "$static_next_link"
mv -Tf -- "$static_next_link" "$STATIC_DIR/current"
deployment_committed="true"
rm -f -- "$prepublish_journal" "$prepublish_journal.dirs"
trap - EXIT

shopt -s nullglob
static_releases=("$STATIC_DIR"/releases/*)
remaining_static_count=${#static_releases[@]}
current_static_target="$(readlink -f "$STATIC_DIR/current")"
for static_release in "${static_releases[@]}"; do
  (( remaining_static_count > STATIC_RETENTION_COUNT )) || break
  [[ -d "$static_release" ]] || continue
  [[ "$(readlink -f "$static_release")" != "$current_static_target" ]] || continue
  rm -rf -- "$static_release"
  remaining_static_count=$((remaining_static_count - 1))
done
shopt -u nullglob
