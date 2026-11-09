# Ops: one droplet, one game server

Nothing here has been run yet: the droplet and DNS come later (Vansh). These files are ready for that day.

| File | What it does |
|---|---|
| `setup.sh` | One-time bootstrap on the droplet (Node 24, Caddy, `margin` user, dirs, firewall). |
| `env.example` | Every variable the server reads. Goes to `/etc/margin/env`, chmod 640. |
| `margin-server.service` | systemd unit. Stop = SIGTERM = drain: LIVE matches finish and settle first. |
| `Caddyfile` | TLS + WebSocket proxy for `api.playmargin.fun`. |
| `deploy.sh` | Laptop to droplet: new release dir, `npm ci`, tests, flip `current`, drain restart, health check. |

## First deploy
1. DigitalOcean droplet, Ubuntu 24.04, Bangalore (BLR1), 1 GB is enough.
2. DNS: `A api.playmargin.fun -> <ip>` (Cloudflare proxy off for this record, so Caddy can get its cert).
3. `scp ops/setup.sh root@<ip>: && ssh root@<ip> ./setup.sh`
4. On the droplet: create `/etc/margin/env` from `env.example` (settler key only here, never in git).
5. From the repo root: `DEPLOY_HOST=root@<ip> ./ops/deploy.sh`
6. `scp ops/Caddyfile root@<ip>:/etc/caddy/Caddyfile && ssh root@<ip> systemctl reload caddy`
7. Check: `curl https://api.playmargin.fun/api/stats`

## Client (Cloudflare Pages)
Build command `npm run build`, output `apps/client/dist`, env `VITE_SERVER_URL=wss://api.playmargin.fun`.

## Day to day
- Logs: `journalctl -u margin-server -f`
- Rollback: `ln -sfn /opt/margin/releases/<previous> /opt/margin/current && systemctl restart margin-server`
- Anchor now: `cd /opt/margin/current && set -a && . /etc/margin/env && npx tsx apps/server/scripts/anchor-now.ts`
