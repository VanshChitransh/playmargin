# Ops: game server and relayer on AWS EC2

Two boxes run the same release. Mumbai (`api.playmargin.fun`) runs everything: free and paid matches, the
relayer and the stats. A US East box (`us.api.playmargin.fun`) runs free matches only, so players in the
Americas are not 200+ ms away. Both are on NEAR testnet.

| File | What it does |
|---|---|
| `setup.sh` | One-time bootstrap on a box (Node 24, Caddy, `margin` users, dirs, firewall). |
| `env.example` | Game server env. Goes to `/etc/margin/env`, root:margin, chmod 640. |
| `relayer.env.example` | Relayer env. Goes to `/etc/margin/relayer.env`, root:margin-relayer, chmod 640. Mumbai only. |
| `margin-server.service` | Game server unit. Stop = SIGTERM = drain: LIVE matches finish and settle first. `Restart=always`. |
| `margin-relayer.service` | Relayer unit (`services/relayer`). Stateless, `Restart=always`. |
| `Caddyfile` | TLS (Let's Encrypt via DNS-01), the game WebSocket + API, and the relayer at `/relay/*`. Client IP = the TCP peer. `MARGIN_HOST` picks the hostname. |
| `Caddyfile.cloudflare` | The same routes behind Cloudflare's proxy (orange cloud), client IP from CF-Connecting-IP. Not in use: kept to switch back. |
| `deploy.sh` | Laptop to box: new release dir, `npm ci`, tests, flip `current`, drain restart, health check. `PRUNE_KEEP=N` deletes all but the newest N releases after a good deploy. |
| `smoke-browser.sh` | After every deploy: a real Chrome joins Play free and a private room on both boxes from playmargin.fun. |

## The boxes

| | Mumbai `api.playmargin.fun` | US East `us.api.playmargin.fun` |
|---|---|---|
| Instance | t4g.small (2 vCPU arm64, 2 GB), Ubuntu 24.04, 20 GB gp3, ap-south-1 | the same, us-east-1 |
| Runs | game server + relayer | game server only (no `relayer.env`, `deploy.sh` skips the relayer) |
| Paid matches | yes | no: no `SETTLER_PRIVATE_KEY`, so paid joins get "paid mode is off on this server" |
| Match ids | Colyseus ids | `MATCH_ID_PREFIX=u-`: every id starts with `u-`, and the client routes Verify, logs and reconnects by it |
| NEAR anchor | hourly Merkle root of the hour's free matches | none: the contract keeps one free-match anchor slot whose hour must increase, so a second box would be refused. Verify checks the hash chain and the books for `u-` matches |
| Stats, /api/team | yes | no |

Both run the layout below: `setup.sh`, the systemd units, `/etc/margin/env`, DB `/var/lib/margin/margin.sqlite`,
releases in `/opt/margin/releases`, `current` a symlink to the live one. SSH is open only to the operator's IP,
and 80 and 443 are open to all. AWS resources are tagged `Name=margin-*`.

Sizing: a local soak (50 full matches, peak 17 rooms = 204 seats) ran the 60 Hz tick at mean 0.06 ms, p99
0.3 ms, peak memory 227 MB. A 16.7 ms tick budget leaves a wide margin on a t4g.small.

## DNS (Cloudflare, playmargin.fun)

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `api` | Mumbai box IPv4 | DNS only (grey cloud), TTL 60, no AAAA (IPv4 only) |
| A | `us.api` | US box IPv4 | DNS only |
| CNAME | `@` / `www` | Cloudflare Pages project (client) | proxied |

Players reach Caddy directly. Through Cloudflare's proxy, Indian traffic entered at Singapore and came back
to Mumbai. Measured from Bengaluru (median of 50 in-game pings and 10 WSS handshakes):

| Path | In-game ping | WSS handshake |
|---|---|---|
| Through Cloudflare's proxy | 362 ms (p90 638) | 938 ms |
| Direct (grey cloud) | 34 to 37 ms (p90 38) | 121 ms |

From Bengaluru the US box is 258 ms, and from us-east-1 Mumbai is 204 ms. The client pings both `/health` and
joins the faster for free play. Paid always goes to Mumbai, and an invite from a US room carries `?s=us`.
With no proxy in front, the IP is public and there is no Cloudflare DDoS shield: the server's own per-IP
join, seat, room and API limits are the guard.

Before 13 Nov the API ran through a Cloudflare tunnel from a laptop (`ops/tunnel/`), now retired.

## New box

### 1. Bootstrap
```
scp ops/setup.sh ubuntu@<ip>: && ssh ubuntu@<ip> sudo ./setup.sh
```

### 2. Caddy with the Cloudflare DNS module
```
sudo caddy add-package github.com/caddy-dns/cloudflare
# /etc/caddy/cf.env (root 600): CF_API_TOKEN=... (DNS edit for playmargin.fun), and on the US box MARGIN_HOST=us.api.playmargin.fun
printf '[Service]\nEnvironmentFile=/etc/caddy/cf.env\n' | sudo tee /etc/systemd/system/caddy.service.d/cf.conf
sudo cp Caddyfile /etc/caddy/Caddyfile && sudo systemctl daemon-reload && sudo systemctl restart caddy
# before any DNS change: pin the name to the box, the cert must verify without -k
curl --resolve api.playmargin.fun:443:<ip> https://api.playmargin.fun/health
```
DNS-01 gets the cert whether or not the record is proxied, and renews while the token is valid.

### 3. Secrets (on the box only, never in git, never in chat)
```
sudo install -m 640 -o root -g margin /dev/null /etc/margin/env                    # then edit from ops/env.example
sudo install -m 640 -o root -g margin-relayer /dev/null /etc/margin/relayer.env    # Mumbai only, from ops/relayer.env.example
```
Copy a key without it touching the shell history:
`jq -r .private_key ~/.near-credentials/testnet/settler.playmargin.testnet.json | ssh ubuntu@<ip> 'sudo tee -a /etc/margin/env >/dev/null'`
then fix the line to read `SETTLER_PRIVATE_KEY=ed25519:...`.

| Variable | Value (testnet) |
|---|---|
| `NETWORK` | `testnet` |
| `CONTRACT_ID` | `playmargin.testnet` |
| `SETTLER_ID` | `settler.playmargin.testnet` |
| `SETTLER_PRIVATE_KEY` | settler key (Mumbai only) |
| `RPC_URLS` | empty (FastNEAR fallback) or a keyed RPC first |
| `NEAR_AI_API_KEY` | turns on the agent Commander |
| `STATS_KEY` | private /stats page (sent as the `x-stats-key` header). Mumbai only |
| `TEAM_KEY` | `POST /api/team`: marks team and QA browsers, guests and wallets out of the public counts. Mumbai only |
| `MATCH_ID_PREFIX` | `u-` on the US box, unset on Mumbai |
| `MAX_ROOMS` | live room cap (default 100) |
| `USDC_ID` (relayer) | `usdc.playmargin.testnet` |
| `RELAYER_ID` (relayer) | `relayer.playmargin.testnet` |
| `RELAYER_PRIVATE_KEY` (relayer) | relayer key |
| `RELAYER_CORS_ORIGIN` (relayer) | `https://playmargin.fun,https://www.playmargin.fun` |
| `ONECLICK_LIVE` (relayer) | empty (dry quotes) |

There is no stake variable: the server reads `config().entry_stake` from the contract at boot and at every
paid 3-2-1 (it logs `paid_stake`), so `set_entry_stake` needs no redeploy. Mainnet is future scope:
`tools/scripts/MAINNET-RUNBOOK.md` has the accounts, keys and costs.

### 4. Database (real users only)
The landing page and README quote `/api/stats`, so a public server starts with an empty database.
`deploy.sh` never copies a `.sqlite` file (rsync excludes it and the release is checked). The server creates
`DB_PATH=/var/lib/margin/margin.sqlite` on first boot. Never reset or replace a live DB: copy it with
`sqlite3 <db> ".backup '<copy>'"` (the online backup API) and check `PRAGMA integrity_check`.
Stats skip test traffic by design: guest keys starting `ed25519:` or `qa-` (all our scripts), Judge Runs
(`JUDGE_SEED`), and anything marked through `/api/team`.

### 5. Ship
```
DEPLOY_HOST=ubuntu@<ip> ./ops/deploy.sh
./ops/smoke-browser.sh
```
It prints `/health` of both services. The server should say `"network":"testnet"` (US: `"off"`, no settler
key), the contract you expect, and `"settler":{"near":...,"low":false}` (the alarm fires under 0.12 NEAR).
Deploy only when `/health` shows `rooms: 0`, US first, then Mumbai, so free play always has a box up.
`curl` cannot see a CORS break, so the browser smoke runs after every deploy.

### 6. Client (Cloudflare Pages)
```
ENV_FILE=/path/to/.env apps/client/scripts/deploy-pages.sh testnet
```
It reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the env file for that command only and never
prints them. It sets `VITE_SERVER_URL=https://api.playmargin.fun` (https: the client also fetches `/api/*`,
and the SDK upgrades to wss itself), `VITE_RELAYER_URL=https://api.playmargin.fun/relay`,
`VITE_NETWORK=testnet` and `VITE_CONTRACT_ID=playmargin.testnet`.

### 7. Smoke
Play one free match from a laptop on the public URL (phones get the laptop card), then one paid match.

## Day to day
- Health: `curl -s localhost:2567/health` (503 while draining, tick stats over the last full minute, `settler.low` under 0.12 NEAR) and `curl -s localhost:3030/health` (relayer NEAR balance + `alarm`).
- Logs are JSON lines: `journalctl -u margin-server -o cat -f | jq` (`settled`, `settle_revert`, `settle_gave_up`, `settle_refused`, `settler_low`, `open_failed`, `refund_failed`, `anchor_failed`, `room_failed`, `paid_stake`, `drain`).
- Restart policy: both units `Restart=always`. A server restart drains first (up to 2 min with a LIVE match).
- Rollback: `ln -sfn /opt/margin/releases/<previous> /opt/margin/current && systemctl restart margin-relayer margin-server`
- Disk: each release is about 640 MB. `PRUNE_KEEP=5 DEPLOY_HOST=... ./ops/deploy.sh` keeps the newest 5.
- Anchor now: `cd /opt/margin/current && set -a && . /etc/margin/env && npx tsx apps/server/scripts/anchor-now.ts`
- Back up the DB: `sqlite3 /var/lib/margin/margin.sqlite ".backup /root/margin-$(date +%F).sqlite"`
