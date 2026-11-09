# Ops: one droplet, game server + relayer

Nothing here has run on a real droplet yet (Vansh buys it on deploy day). The scripts pass `bash -n`;
Caddy and systemd files get their first real check in step 7 below.

| File | What it does |
|---|---|
| `setup.sh` | One-time bootstrap on the droplet (Node 24, Caddy, `margin` user, dirs, firewall). |
| `env.example` | Game server env. Goes to `/etc/margin/env`, root:margin, chmod 640. |
| `relayer.env.example` | Relayer env. Goes to `/etc/margin/relayer.env`, root:margin, chmod 640. |
| `margin-server.service` | Game server unit. Stop = SIGTERM = drain: LIVE matches finish and settle first. `Restart=always`. |
| `margin-relayer.service` | Relayer unit (S4's `services/relayer`). Stateless, `Restart=always`. |
| `Caddyfile` | TLS for `api.playmargin.fun`: game WebSocket + API, and the relayer at `/relay/*`. |
| `deploy.sh` | Laptop to droplet: new release dir, `npm ci`, tests, flip `current`, restart both, health check. |

## Deploy day

Linked from `tools/scripts/MAINNET-RUNBOOK.md` (S4). The runbook creates the NEAR accounts and keys;
this part puts them on a server. Every mainnet transaction is Vansh's call, nothing here sends one.

### 1. Droplet
DigitalOcean, Ubuntu 24.04, Bangalore (BLR1), 1 GB / 1 vCPU. Local soak (MacBook, 50 full matches, peak
17 rooms = 204 seats): 60 Hz tick mean 0.06 ms, p99 0.3 ms, peak memory 227 MB, back to 148 MB after. A
droplet vCPU is slower, but a 16.7 ms tick budget leaves a wide margin. Add your SSH key at create time.

### 2. DNS (Cloudflare, playmargin.fun)
| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `api` | droplet IPv4 | **DNS only** (grey cloud), so Caddy can get its Let's Encrypt cert and WebSockets pass |
| CNAME | `@` / `www` | Cloudflare Pages project (client) | proxied |

Check before step 7: `dig +short api.playmargin.fun` returns the droplet IP.

### 3. Bootstrap
```
scp ops/setup.sh root@<ip>: && ssh root@<ip> ./setup.sh
```

### 4. Secrets (on the droplet only, never in git, never in chat)
```
sudo install -m 640 -o root -g margin /dev/null /etc/margin/env          # then edit from ops/env.example
sudo install -m 640 -o root -g margin /dev/null /etc/margin/relayer.env  # then edit from ops/relayer.env.example
```
Copy a key from the laptop without it touching the shell history:
`jq -r .private_key ~/.near-credentials/mainnet/settler.playmargin.near.json | ssh root@<ip> 'cat >> /etc/margin/env'`
then fix the line to read `SETTLER_PRIVATE_KEY=ed25519:...`.

| Variable | testnet | mainnet |
|---|---|---|
| `NETWORK` | `testnet` | `mainnet` |
| `CONTRACT_ID` | `playmargin.testnet` | `playmargin.near` |
| `SETTLER_ID` | `settler.playmargin.testnet` | `settler.playmargin.near` |
| `SETTLER_PRIVATE_KEY` | settler full key | settler full key |
| `RPC_URLS` | empty (FastNEAR fallback) | keyed RPC first if we have one |
| `USDC_ID` (relayer) | `usdc.playmargin.testnet` | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| `RELAYER_ID` (relayer) | `relayer.playmargin.testnet` | `relayer.playmargin.near` |
| `RELAYER_PRIVATE_KEY` (relayer) | relayer full key | relayer full key |
| `RELAYER_LOW_BALANCE` (relayer) | `0.5` | `0.05` |
| `ONECLICK_LIVE` (relayer) | empty (dry quotes) | `1` only after the $1 test deposit |

`NEAR_AI_API_KEY` (server) turns on the agent commander, `MAX_ROOMS` caps live rooms (default 100).

### 5. Fresh database (real users only)
The landing page and README quote `/api/stats`, so the public server starts with an EMPTY database.
`deploy.sh` never copies a `.sqlite` file (rsync excludes it and the release is checked). The server
creates `DB_PATH=/var/lib/margin/margin.sqlite` on first boot. If a rehearsal ran on the droplet, move
its DB aside before launch:
```
systemctl stop margin-server && mv /var/lib/margin/margin.sqlite* /root/ && systemctl start margin-server
curl -s localhost:2567/api/stats   # users 0, matches 0
```
Stats also skip test traffic by design: guest keys starting `ed25519:` or `qa-` (all our scripts) and
Judge Runs (`JUDGE_SEED`). Real browsers use random UUID guest keys.

### 6. Ship
```
DEPLOY_HOST=root@<ip> ./ops/deploy.sh
```
It prints `/health` of both services. The server must say `"network":"mainnet"` (or `testnet`) and the
contract you expect. `"network":"off"` means the settler key is missing: free rooms work, paid rooms refuse.

### 7. TLS + routes
```
scp ops/Caddyfile root@<ip>:/etc/caddy/Caddyfile && ssh root@<ip> 'caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
curl https://api.playmargin.fun/health
curl https://api.playmargin.fun/relay/health
```

### 8. Client (Cloudflare Pages)
Build `npm run build`, output `apps/client/dist`, env:
`VITE_SERVER_URL=wss://api.playmargin.fun`, `VITE_RELAYER_URL=https://api.playmargin.fun/relay`,
`VITE_NETWORK` and `VITE_CONTRACT_ID` as in the table above.

### 9. Smoke
Play one free match from a phone on 4G (S9 gate), then one paid match per the runbook.

## Day to day
- Health: `curl -s localhost:2567/health` (503 while draining) and `curl -s localhost:3030/health` (relayer NEAR balance + `alarm`).
- Logs are JSON lines: `journalctl -u margin-server -o cat -f | jq` (`settled`, `settle_refused`, `open_failed`, `refund_failed`, `anchor_failed`, `drain`).
- Restart policy: both units `Restart=always`. A server restart drains first (up to 2 min with a LIVE match).
- Rollback: `ln -sfn /opt/margin/releases/<previous> /opt/margin/current && systemctl restart margin-relayer margin-server`
- Anchor now: `cd /opt/margin/current && set -a && . /etc/margin/env && npx tsx apps/server/scripts/anchor-now.ts`
- Back up the DB: `sqlite3 /var/lib/margin/margin.sqlite ".backup /root/margin-$(date +%F).sqlite"`
