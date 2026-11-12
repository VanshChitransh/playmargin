#!/bin/bash
# Tunnel mode supervisor: game server :2700, relayer :3700, proxy :8700, cloudflared, each restarted if it
# exits, plus caffeinate so the Mac does not sleep while this runs. Started by launchd
# (~/Library/LaunchAgents/fun.playmargin.tunnel.plist), which also restarts this script.
# Logs: ~/margin-prod/logs/*.log. Secrets: ~/margin-prod/{server,relayer}.env (chmod 600, never printed).
set -u
P="$HOME/margin-prod"
APP="$P/app"
mkdir -p "$P/logs"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Keep one supervised child per name: restart with a short backoff whenever it exits.
keep() {
  local name="$1"; shift
  ( while true; do
      echo "$(date -u +%FT%TZ) start $name" >> "$P/logs/supervisor.log"
      "$@" >> "$P/logs/$name.log" 2>&1
      echo "$(date -u +%FT%TZ) $name exited $?, restarting in 3 s" >> "$P/logs/supervisor.log"
      sleep 3
    done ) &
}

keep server  bash -c "cd '$APP/apps/server' && exec node --env-file='$P/server.env' --import tsx src/index.ts"
keep relayer bash -c "cd '$APP/services/relayer' && exec node --env-file='$P/relayer.env' --import tsx server.ts"
keep proxy   node "$P/proxy.mjs"
keep tunnel  cloudflared tunnel --config "$P/cloudflared.yml" run margin-api
caffeinate -dimsu &

# launchd stops us with SIGTERM: pass it on (the game server drains LIVE matches first).
trap 'trap - TERM INT; kill -TERM 0; wait; exit 0' TERM INT # the whole group: loops and their node children
wait
