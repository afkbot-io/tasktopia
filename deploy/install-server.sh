#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_REPOSITORY="https://github.com/afkbot-io/tasktopia.git"
domain=""
email=""
repository="$DEFAULT_REPOSITORY"
branch="main"
app_dir="/srv/tasktopia/app"

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

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx docker.io docker-compose-v2 openssl
systemctl enable --now docker nginx

if [[ -d "$app_dir/.git" ]]; then
  git -C "$app_dir" fetch origin "$branch"
  git -C "$app_dir" merge --ff-only "origin/$branch"
else
  if [[ -e "$app_dir" ]]; then
    if [[ -n "$(find "$app_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      echo "$app_dir exists and is not an empty Git checkout." >&2
      exit 1
    fi
  fi
  install -d -m 0755 "$(dirname "$app_dir")"
  git clone --branch "$branch" --single-branch "$repository" "$app_dir"
fi

cd "$app_dir"
if [[ ! -f .env ]]; then
  postgres_password="$(openssl rand -hex 32)"
  sed \
    -e "s|^APP_ORIGIN=.*|APP_ORIGIN=https://$domain|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$postgres_password|" \
    -e "s|^SESSION_COOKIE_SECURE=.*|SESSION_COOKIE_SECURE=true|" \
    deploy/.env.self-host.example > .env
  chmod 0600 .env
else
  echo "Keeping existing $app_dir/.env"
fi

docker compose up -d --build
curl --fail --silent --show-error --retry 30 --retry-delay 2 --retry-connrefused \
  http://127.0.0.1:3000/health >/dev/null

site_name="tasktopia-${domain//./-}"
sed "s/__DOMAIN__/$domain/g" deploy/nginx-self-host-bootstrap.conf.template > "/etc/nginx/sites-available/$site_name"
ln -sfn "/etc/nginx/sites-available/$site_name" "/etc/nginx/sites-enabled/$site_name"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot certonly --nginx --non-interactive --agree-tos --email "$email" -d "$domain"
sed "s/__DOMAIN__/$domain/g" deploy/nginx-self-host.conf.template > "/etc/nginx/sites-available/$site_name"
nginx -t
systemctl reload nginx

curl --fail --silent --show-error --retry 10 --retry-delay 2 "https://$domain/health"
echo
echo "Tasktopia is ready: https://$domain"
echo "Updates: TASKTOPIA_APP_DIR='$app_dir' TASKTOPIA_BRANCH='$branch' $app_dir/deploy/update-server.sh"
