#!/usr/bin/env bash
# Ship the current checkout to a game box with a drain restart. Run from the repo root on a laptop:
#   DEPLOY_HOST=ubuntu@15.207.255.76 ./ops/deploy.sh   (Mumbai; US: ubuntu@54.146.83.204, sudo is used)
# Each deploy is a new release dir; "current" flips only after npm ci and tests pass, then systemd
# restarts, which drains (LIVE matches finish and settle first). Rollback = point current at the
# previous release and restart. Old releases are kept unless PRUNE_KEEP=N is set: then, after a good
# deploy, all but the newest N releases are deleted (never the running one). Off by default.
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST=ubuntu@<box-ip>}"
PRUNE_KEEP="${PRUNE_KEEP:-0}"
REL="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
DIR="/opt/margin/releases/$REL"

[[ -z "$(git status --porcelain)" ]] || { echo "commit first: deploys must match a commit"; exit 1; }

echo "release $REL -> $HOST"
# Every env file variant stays local (L8-06): .env, .env.local, prod.env... Only the *.example files ship.
rsync -az --rsync-path="sudo rsync" --exclude node_modules --exclude .git --exclude '.env*' --include '*.example' --exclude '*.env' --exclude '*.sqlite*' ./ "$HOST:$DIR/"

ssh "$HOST" sudo bash -s -- "$DIR" "$PRUNE_KEEP" <<'REMOTE'
set -euo pipefail
DIR="$1"
KEEP="$2"
cd "$DIR"
# Public numbers must be real users only: a local test database must never ship.
if find "$DIR" -name '*.sqlite*' -not -path '*/node_modules/*' | grep -q .; then
  echo "refusing: a sqlite file reached the release dir; the box keeps its own DB in /var/lib/margin"; exit 1
fi
npm ci --no-audit --no-fund
npm test
chown -R margin:margin "$DIR"
ln -sfn "$DIR" /opt/margin/current
install -m 644 ops/margin-server.service /etc/systemd/system/margin-server.service
install -m 644 ops/margin-relayer.service /etc/systemd/system/margin-relayer.service
systemctl daemon-reload
systemctl enable margin-server >/dev/null
# The relayer (paid money path) runs only where it is configured: Mumbai. The US box is free only.
if [[ -f /etc/margin/relayer.env ]]; then systemctl enable margin-relayer >/dev/null; fi
echo "restarting (drain can take up to 2 min if a match is LIVE)"
if [[ -f /etc/margin/relayer.env ]]; then systemctl restart margin-relayer; fi
systemctl restart margin-server
for i in $(seq 1 30); do
  if curl -fsS localhost:2567/health >/dev/null 2>&1; then
    echo "server: $(curl -s localhost:2567/health)"
    echo "relayer: $(curl -s localhost:3030/health || echo DOWN)"
    if [[ "$KEEP" =~ ^[1-9][0-9]*$ ]]; then
      cur="$(readlink -f /opt/margin/current)"
      ls -1d /opt/margin/releases/*/ | sed 's|/$||' | sort | head -n "-$KEEP" | while read -r old; do
        [[ "$old" == "$cur" ]] && continue
        echo "prune $old"; rm -rf -- "$old"
      done
    fi
    exit 0
  fi
  sleep 2
done
echo "server did not come up, see: journalctl -u margin-server -n 100"; exit 1
REMOTE
