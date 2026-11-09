#!/usr/bin/env bash
# One-time droplet bootstrap (Ubuntu 24.04, run as root ON THE DROPLET). Idempotent: safe to re-run.
# Installs Node 24 and Caddy, creates the margin user and its directories, installs the unit.
# It never touches the database if one already exists.
set -euo pipefail

if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

id margin >/dev/null 2>&1 || useradd --system --home /opt/margin --shell /usr/sbin/nologin margin
install -d -o margin -g margin /opt/margin /opt/margin/releases /var/lib/margin
install -d -m 750 -o root -g margin /etc/margin
[[ -f /etc/margin/env ]] || { echo "create /etc/margin/env from ops/env.example (chmod 640, group margin)"; }

ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable
echo "setup done. Next: ./ops/deploy.sh from your laptop, then install ops/Caddyfile."
