#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_REPOSITORY="https://github.com/afkbot-io/tasktopia.git"
domain=""
email=""
repository="$DEFAULT_REPOSITORY"
branch="main"
app_dir="/srv/tasktopia/app"
requested_static_dir="${TASKTOPIA_STATIC_DIR:-}"
static_dir="${requested_static_dir:-/srv/tasktopia/static}"

usage() {
  cat <<'USAGE'
Usage: install-server.sh --domain tasktopia.example --email admin@example.com [options]

Options:
  --repository URL   Git repository (default: official GitHub repository)
  --branch NAME      Branch to deploy (default: main)
  --app-dir PATH     Installation directory (default: /srv/tasktopia/app)
  -h, --help         Show this help
USAGE
}

while (($#)); do
  case "$1" in
    --domain) domain="${2:-}"; shift 2 ;;
    --email) email="${2:-}"; shift 2 ;;
    --repository) repository="${2:-}"; shift 2 ;;
    --branch) branch="${2:-}"; shift 2 ;;
    --app-dir) app_dir="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run this installer as root." >&2; exit 1; }
[[ $domain =~ ^[A-Za-z0-9][A-Za-z0-9.-]+[A-Za-z0-9]$ ]] || { echo "Invalid --domain." >&2; exit 2; }
[[ $email =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo "Invalid --email." >&2; exit 2; }
[[ $branch =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "Invalid --branch." >&2; exit 2; }
[[ $app_dir == /* && $app_dir != / && $app_dir != /srv ]] || { echo "--app-dir must be a specific absolute path." >&2; exit 2; }
[[ $static_dir =~ ^/[A-Za-z0-9._/-]+$ && $static_dir != / && $static_dir != /srv ]] \
  || { echo "TASKTOPIA_STATIC_DIR must be a specific absolute path." >&2; exit 2; }
if [[ -d "$app_dir/.git" ]]; then
  echo "Tasktopia is already installed at $app_dir; refusing an unsafe installer rerun." >&2
  echo "Update with: git -C '$app_dir' pull --ff-only origin '$branch' && TASKTOPIA_APP_DIR='$app_dir' TASKTOPIA_BRANCH='$branch' '$app_dir/deploy/update-server.sh'" >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx docker.io docker-compose-v2 openssl util-linux
systemctl enable --now docker nginx

if [[ -e "$app_dir" ]]; then
  if [[ -n "$(find "$app_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    echo "$app_dir exists and is not an empty Git checkout." >&2
    exit 1
  fi
fi
install -d -m 0755 "$(dirname "$app_dir")"
git clone --branch "$branch" --single-branch "$repository" "$app_dir"

cd "$app_dir"
postgres_password="$(openssl rand -hex 32)"
sed \
  -e "s|^APP_ORIGIN=.*|APP_ORIGIN=https://$domain|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$postgres_password|" \
  -e "s|^SESSION_COOKIE_SECURE=.*|SESSION_COOKIE_SECURE=true|" \
  deploy/.env.self-host.example > .env
if grep -q '^TASKTOPIA_STATIC_DIR=' .env; then
  sed -i "s|^TASKTOPIA_STATIC_DIR=.*|TASKTOPIA_STATIC_DIR=$static_dir|" .env
else
  printf '\nTASKTOPIA_STATIC_DIR=%s\n' "$static_dir" >> .env
fi
chmod 0600 .env

docker compose up -d --build
curl --fail --silent --show-error --retry 30 --retry-delay 2 --retry-connrefused \
  http://127.0.0.1:3000/health >/dev/null

# Initialize the static release pointer used by subsequent zero-gap updates.
# Older installations are migrated by update-server.sh from the running app.
current_static_dir="$(readlink -f "$static_dir/current" 2>/dev/null || true)"
if [[ ! -d "$current_static_dir" ]]; then
  source "$app_dir/deploy/static-release.sh"
  app_container_id="$(docker compose ps -q app)"
  initial_release_id="$(date +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)-initial"
  bootstrap_static_release_from_container "$app_container_id" "$static_dir" "$initial_release_id"
fi

site_name="tasktopia-${domain//./-}"
sed \
  -e "s|__DOMAIN__|$domain|g" \
  -e "s|__STATIC_DIR__|$static_dir|g" \
  deploy/nginx-self-host-bootstrap.conf.template > "/etc/nginx/sites-available/$site_name"
ln -sfn "/etc/nginx/sites-available/$site_name" "/etc/nginx/sites-enabled/$site_name"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot certonly --nginx --non-interactive --agree-tos --email "$email" -d "$domain"
sed \
  -e "s|__DOMAIN__|$domain|g" \
  -e "s|__STATIC_DIR__|$static_dir|g" \
  deploy/nginx-self-host.conf.template > "/etc/nginx/sites-available/$site_name"
nginx -t
systemctl reload nginx

curl --fail --silent --show-error --retry 10 --retry-delay 2 "https://$domain/health"
echo
echo "Tasktopia is ready: https://$domain"
echo "Public registration is disabled by default."
echo "Create the first user: cd '$app_dir' && docker compose exec app npm run user:create -- --email EMAIL --name NAME --country COUNTRY --city CITY"
echo "Updates: git -C '$app_dir' pull --ff-only origin '$branch' && TASKTOPIA_APP_DIR='$app_dir' TASKTOPIA_BRANCH='$branch' '$app_dir/deploy/update-server.sh'"
