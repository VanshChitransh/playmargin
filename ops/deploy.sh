#!/usr/bin/env bash
# Ship the current checkout to the droplet with a drain restart. Run from the repo root on a laptop:
#   DEPLOY_HOST=root@<droplet-ip> ./ops/deploy.sh
# Each deploy is a new release dir; "current" flips only after npm ci and tests pass, then systemd
# restarts, which drains (LIVE matches finish and settle first). Rollback = point current at the
# previous release and restart. Old releases are kept (prune by hand when the disk asks).
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST=root@<droplet-ip>}"
REL="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
DIR="/opt/margin/releases/$REL"

[[ -z "$(git status --porcelain)" ]] || { echo "commit first: deploys must match a commit"; exit 1; }

echo "release $REL -> $HOST"
rsync -az --exclude node_modules --exclude .git --exclude .env --exclude '*.sqlite*' ./ "$HOST:$DIR/"

ssh "$HOST" bash -s -- "$DIR" <<'REMOTE'
set -euo pipefail
DIR="$1"
cd "$DIR"
# Public numbers must be real users only: a local test database must never ship.
if find "$DIR" -name '*.sqlite*' -not -path '*/node_modules/*' | grep -q .; then
  echo "refusing: a sqlite file reached the release dir; the droplet keeps its own DB in /var/lib/margin"; exit 1
fi
npm ci --no-audit --no-fund
npm test
chown -R margin:margin "$DIR"
ln -sfn "$DIR" /opt/margin/current
install -m 644 ops/margin-server.service /etc/systemd/system/margin-server.service
install -m 644 ops/margin-relayer.service /etc/systemd/system/margin-relayer.service
systemctl daemon-reload
systemctl enable margin-server margin-relayer >/dev/null
echo "restarting (drain can take up to 2 min if a match is LIVE)"
systemctl restart margin-relayer
systemctl restart margin-server
for i in $(seq 1 30); do
  if curl -fsS localhost:2567/health >/dev/null 2>&1; then
    echo "server: $(curl -s localhost:2567/health)"
    echo "relayer: $(curl -s localhost:3030/health || echo DOWN)"
    exit 0
  fi
  sleep 2
done
echo "server did not come up, see: journalctl -u margin-server -n 100"; exit 1
REMOTE
