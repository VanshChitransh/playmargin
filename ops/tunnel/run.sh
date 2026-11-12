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
# On stop (TERM) a loop lets its child finish (the game server drains LIVE matches) and does not restart
# it: without its own trap the loop died at once and launchd then killed the draining server.
keep() {
  local name="$1"; shift
  ( stop=
    trap 'stop=1' TERM INT
    while [ -z "$stop" ]; do
      echo "$(date -u +%FT%TZ) start $name" >> "$P/logs/supervisor.log"
      "$@" >> "$P/logs/$name.log" 2>&1
      code=$?
      [ -n "$stop" ] && break
      echo "$(date -u +%FT%TZ) $name exited $code, restarting in 3 s" >> "$P/logs/supervisor.log"
      sleep 3
    done
    echo "$(date -u +%FT%TZ) $name stopped" >> "$P/logs/supervisor.log" ) &
  eval "loop_$name=$!" # bash 3.2 (macOS): no associative arrays
}

keep server  bash -c "cd '$APP/apps/server' && exec node --env-file='$P/server.env' --import tsx src/index.ts"
keep relayer bash -c "cd '$APP/services/relayer' && exec node --env-file='$P/relayer.env' --import tsx server.ts"
keep proxy   node "$P/proxy.mjs"
keep tunnel  cloudflared tunnel --config "$P/cloudflared.yml" run margin-api
caffeinate -dimsu &

# launchd stops us with SIGTERM. Order matters: the game server drains first (LIVE matches finish and
# settle) while the proxy, relayer and tunnel stay up so players stay connected to the end; only then
# the rest stops. TERM is ignored here, so nothing ends this script before the drain is over.
stop_all() {
  trap "" TERM INT
  kill -TERM "$loop_server" 2>/dev/null       # the loop: do not restart
  pkill -TERM -P "$loop_server" 2>/dev/null   # its node child: drain
  wait "$loop_server"
  kill -TERM 0                                # now everything else (relayer, proxy, tunnel, caffeinate)
  wait
  exit 0
}
trap stop_all TERM INT
wait
