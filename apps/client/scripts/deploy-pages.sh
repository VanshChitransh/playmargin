#!/usr/bin/env bash
# Build the client for a network and deploy it to Cloudflare Pages (project "playmargin").
# Usage: apps/client/scripts/deploy-pages.sh [testnet|mainnet]   (default testnet)
# Credentials: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment, or read from
# ENV_FILE (default ./.env) for this command only. They are never printed.
set -euo pipefail
cd "$(dirname "$0")/../../.."

NET="${1:-testnet}"
ENV_FILE="${ENV_FILE:-.env}"
pick() { [ -n "${!1:-}" ] || { [ -f "$ENV_FILE" ] && export "$1=$(grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-)"; }; [ -n "${!1:-}" ] || { echo "missing $1 (env or $ENV_FILE)" >&2; exit 1; }; }
pick CLOUDFLARE_API_TOKEN
pick CLOUDFLARE_ACCOUNT_ID

case "$NET" in
  testnet) CONTRACT="${VITE_CONTRACT_ID:-playmargin.testnet}" ;;
  mainnet) CONTRACT="${VITE_CONTRACT_ID:?set VITE_CONTRACT_ID for mainnet (playmargin.near)}" ;;
  *) echo "network must be testnet or mainnet" >&2; exit 1 ;;
esac

# Real endpoints (ops/Caddyfile): the game server and the relayer behind api.playmargin.fun.
export VITE_NETWORK="$NET" VITE_CONTRACT_ID="$CONTRACT"
export VITE_SERVER_URL="${VITE_SERVER_URL:-https://api.playmargin.fun}"
export VITE_RELAYER_URL="${VITE_RELAYER_URL:-https://api.playmargin.fun/relay}"
# Email login stays off until NEAR approves the Auth0 app (set VITE_NEAR_AUTH=1 and the client id then).
export VITE_NEAR_AUTH="${VITE_NEAR_AUTH:-0}"
# Second free-only game server (US East); free play picks the faster one, paid stays on the first.
export VITE_US_SERVER_URL="${VITE_US_SERVER_URL:-https://us.api.playmargin.fun}"

echo "building client: network=$NET contract=$CONTRACT server=$VITE_SERVER_URL relayer=$VITE_RELAYER_URL"
npm run build -w apps/client
# A 404.html turns off the Pages SPA fallback: a missing /assets file is a real 404 (Q01) and an
# unknown page answers 404 with the app's own 404 screen. Page routes are listed in public/_redirects.
cp apps/client/dist/index.html apps/client/dist/404.html

# Wrangler runs from the client app, not the workspace root (wrangler 4 refuses the root). --force on
# create keeps the classic Pages project type (direct upload) instead of the Workers delegation.
(
  cd apps/client
  npx -y wrangler@4 pages project list 2>/dev/null | grep -q "playmargin" \
    || npx -y wrangler@4 pages project create playmargin --production-branch main --force
  npx -y wrangler@4 pages deploy dist --project-name playmargin --branch "${PAGES_BRANCH:-main}" --commit-dirty=true
)

# Custom domains (idempotent: an already attached domain answers with an error we ignore).
# Cloudflare creates the CNAME records in the playmargin.fun zone; they go live once the zone is active.
for d in playmargin.fun www.playmargin.fun; do
  curl -s -o /dev/null -w "domain $d: HTTP %{http_code}\n" -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/playmargin/domains" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "content-type: application/json" --data "{\"name\":\"$d\"}"
done
