# Ops: one droplet, game server + relayer

Nothing here has run on a real droplet yet (Vansh buys it on deploy day). The scripts pass `bash -n`, and
Caddy and systemd files get their first real check in step 7 below.

| File | What it does |
|---|---|
| `setup.sh` | One-time bootstrap on the droplet (Node 24, Caddy, `margin` user, dirs, firewall). |
| `env.example` | Game server env. Goes to `/etc/margin/env`, root:margin, chmod 640. |
| `relayer.env.example` | Relayer env. Goes to `/etc/margin/relayer.env`, root:margin, chmod 640. |
| `margin-server.service` | Game server unit. Stop = SIGTERM = drain: LIVE matches finish and settle first. `Restart=always`. |
| `margin-relayer.service` | Relayer unit (S4's `services/relayer`). Stateless, `Restart=always`. |
| `Caddyfile` | Live (EC2, grey cloud): TLS for `api.playmargin.fun` via DNS-01, game WebSocket + API, and the relayer at `/relay/*`. Client IP = the TCP peer. |
| `Caddyfile.cloudflare` | Rollback only: same routes behind Cloudflare's proxy (orange cloud), real client IP from CF-Connecting-IP. |
| `deploy.sh` | Laptop to droplet: new release dir, `npm ci`, tests, flip `current`, restart both, health check. |

## Deploy day

Linked from `tools/scripts/MAINNET-RUNBOOK.md` (S4). The runbook creates the NEAR accounts and keys, and
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
sudo install -m 640 -o root -g margin-relayer /dev/null /etc/margin/relayer.env  # then edit from ops/relayer.env.example
```
Copy a key from the laptop without it touching the shell history:
`jq -r .private_key ~/.near-credentials/mainnet/settler.playmargin.near.json | ssh root@<ip> 'cat >> /etc/margin/env'`
then fix the line to read `SETTLER_PRIVATE_KEY=ed25519:...`.

| Variable | testnet | mainnet |
|---|---|---|
| `NETWORK` | `testnet` | `mainnet` |
| `CONTRACT_ID` | `playmargin.testnet` | `playmargin.near` (or `margin.vanshverse.near`, runbook) |
| `SETTLER_ID` | `settler.playmargin.testnet` | `settler.$CONTRACT_ID` (funded 0.25 NEAR, runbook TX 4) |
| `SETTLER_PRIVATE_KEY` | settler full key | settler full key |
| `RPC_URLS` | empty (FastNEAR fallback) | keyed RPC first if we have one |
| `USDC_ID` (relayer) | `usdc.playmargin.testnet` | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| `RELAYER_ID` (relayer) | `relayer.playmargin.testnet` | `relayer.$CONTRACT_ID` (0.15 NEAR, 0.5 with `VITE_NEAR_AUTH=1`) |
| `RELAYER_PRIVATE_KEY` (relayer) | relayer full key | relayer full key |
| `RELAYER_LOW_BALANCE` (relayer) | `0.5` | `0.05` |
| `ONECLICK_LIVE` (relayer) | empty (dry quotes) | `1` (runbook step 6 proves it with one real deposit) |

`NEAR_AI_API_KEY` (server) turns on the agent commander, `MAX_ROOMS` caps live rooms (default 100).
There is no stake variable: the server reads `config().entry_stake` from the contract at boot and at
every paid 3-2-1 (it logs `paid_stake`), so the owner's `set_entry_stake` needs no redeploy.

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
It prints `/health` of both services. The server must say `"network":"mainnet"` (or `testnet`), the
contract you expect, and `"settler":{"near":...,"low":false}` (the alarm fires under 0.12 NEAR, since
a 100 Tgas settle needs about 0.101 free). `"network":"off"` means the settler key is missing: free
rooms work, paid rooms refuse. The log should show `{"event":"up"}` and `{"event":"paid_stake"}`.

### 7. TLS + routes
```
scp ops/Caddyfile root@<ip>:/etc/caddy/Caddyfile && ssh root@<ip> 'caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
curl https://api.playmargin.fun/health
curl https://api.playmargin.fun/relay/health
```

### 8. Client (Cloudflare Pages)
One command builds with the right settings and deploys to the Pages project `playmargin` (direct upload,
production branch `main`), then attaches `playmargin.fun` and `www.playmargin.fun`:
```
ENV_FILE=/path/to/.env apps/client/scripts/deploy-pages.sh testnet     # testnet now
VITE_CONTRACT_ID=playmargin.near ENV_FILE=... apps/client/scripts/deploy-pages.sh mainnet   # later
```
It reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Pages Edit, DNS Edit) from the env file for
that command only and never prints them. Testnet: `VITE_NETWORK=testnet`, contract `playmargin.testnet`,
email login off. The custom domains go live once the `playmargin.fun` zone is active on Cloudflare.
The variables it sets (also usable for a Pages git build: command `npm run build`, output `apps/client/dist`):
- `NODE_VERSION=24`
- `VITE_SERVER_URL=https://api.playmargin.fun` (https, not wss: the client also `fetch`es `/api/*`
  from it, and the Colyseus SDK upgrades to wss itself)
- `VITE_RELAYER_URL=https://api.playmargin.fun/relay`
- `VITE_NETWORK=testnet` and `VITE_CONTRACT_ID=playmargin.testnet` now; `mainnet` and `<CONTRACT_ID>` on mainnet day
- `VITE_NEAR_AUTH=1` and `VITE_NEAR_AUTH_CLIENT_ID=<id>` only once NEAR approves the Auth0 app

### 9. Smoke
Play one free match from a laptop on the public URL (S9 gate; phones get the laptop card), then one paid match per the runbook.

## EC2 mode (live since 13 Nov: api.playmargin.fun on AWS, testnet)

One t4g.small (Ubuntu 24.04 arm64, 20 GB gp3) in ap-south-1, Elastic IP `15.207.255.76`, all resources tagged
`Name=margin-*` (key pair `vansh-mac`, SG `margin-api-sg`: 22 from Vansh's IP only, 80 and 443 open). The layout is
the droplet layout above: `setup.sh`, the two systemd units, `/etc/margin/{env,relayer.env}`, DB
`/var/lib/margin/margin.sqlite`, releases in `/opt/margin/releases`. Deploy with
`DEPLOY_HOST=ubuntu@15.207.255.76 ./ops/deploy.sh` (it uses sudo on the box).

DNS: `api` is an A record to the Elastic IP, **DNS only (grey cloud) since 13 Nov 18:2x UTC**, TTL 60, no AAAA
(the box is IPv4 only). Players reach Caddy directly, which cut the in-game ping about tenfold (table below). The
live config is `Caddyfile`: DNS-01 cert, HTTP redirects to HTTPS, and `X-Real-IP` / `X-Forwarded-For` are
`{remote_host}`, so no header a client sends is believed. The IP is public and there is no Cloudflare DDoS shield;
the server's own per-IP join, seat and API limits are the only guard.

Orange cloud mode (13 Nov until the flip, kept as the rollback) used `Caddyfile.cloudflare`, which differs in:

| What | Why |
|---|---|
| TLS via Let's Encrypt **DNS-01** (`caddy-dns/cloudflare`, token in `/etc/caddy/cf.env` root 600, loaded by `/etc/systemd/system/caddy.service.d/cf.conf`) | HTTP-01 cannot reach the box behind the proxy, and the token cannot issue a Cloudflare Origin cert. A real cert also works in every Cloudflare SSL mode. Renewal is automatic while the token is valid |
| `trusted_proxies` = Cloudflare's ranges, `client_ip_headers CF-Connecting-IP`, then `X-Real-IP {client_ip}` | Without it every player has the edge's IP and shares one join limit. Only Cloudflare's ranges are believed, so a direct hit on the IP cannot forge it |
| Port 80 serves the same site (no redirect) | Cloudflare's edge already sends players to HTTPS, and a Flexible zone would loop on a redirect |

```
# one time on the box (after setup.sh)
sudo caddy add-package github.com/caddy-dns/cloudflare
printf '[Service]\nEnvironmentFile=/etc/caddy/cf.env\n' | sudo tee /etc/systemd/system/caddy.service.d/cf.conf
sudo cp Caddyfile /etc/caddy/Caddyfile && sudo systemctl daemon-reload && sudo systemctl restart caddy
# test before any DNS change: pin the name to the box, the cert must verify without -k
curl --resolve api.playmargin.fun:443:15.207.255.76 https://api.playmargin.fun/health
```

**Cutover from the tunnel (done 13 Nov, about 1 min down).** Before it, the box ran with `SETTLER_PRIVATE_KEY`
commented out, so two servers never signed for the same settler account at once.
1. `/health` shows `rooms: 0`. Stop the box server and move its test DB aside (never delete).
2. `launchctl bootout gui/$(id -u)/fun.playmargin.tunnel` (drains LIVE matches, up to 150 s).
3. `sqlite3 ~/margin-prod/margin.db ".backup '<copy>'"`, the online backup API (a raw `cp` of a WAL database can
   miss pages), then `PRAGMA integrity_check` = ok.
4. scp the copy to `/var/lib/margin/margin.sqlite` (margin:margin 600), uncomment the settler key, start.
5. Cloudflare API: PATCH the `api` record from the tunnel CNAME to `A 15.207.255.76`, proxied. The edge answers
   1033/530 (stale tunnel route) for about 20 s, then serves the box.

**Rollback:** PATCH `api` back to `CNAME <tunnel-id>.cfargotunnel.com`, copy the box DB back to
`~/margin-prod/margin.db` the same way, `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/fun.playmargin.tunnel.plist`.

**Latency (13 Nov, from Bengaluru, median of 50 in-game pings and 10 WSS handshakes):** Indian traffic entered
Cloudflare at Singapore (`colo=SIN`) and came back to Mumbai.

| Path | In-game ping | WSS handshake |
|---|---|---|
| Orange cloud, just before the flip | 362 ms (p90 638) | 938 ms |
| Grey cloud, after the flip | 34 to 37 ms (p90 38) | 121 ms |

**Grey cloud flip (done 13 Nov):** `/health` rooms 0, PATCH `api` to `proxied: false, ttl: 60`, wait for any match
still running, then install `Caddyfile` and `systemctl reload caddy` (a reload can cut open WebSockets, so never
with a LIVE room). Order matters: DNS first, because the direct config redirects port 80, which an orange cloud
Flexible zone would loop on. Resolvers held the old Cloudflare answers for about 5 min.
**Rollback to orange:** `sudo cp /etc/caddy/Caddyfile.cloudflare.bak /etc/caddy/Caddyfile` (same as
`ops/Caddyfile.cloudflare`), `systemctl reload caddy`, then PATCH `api` back to `proxied: true`.

## US box (live since 13 Nov: us.api.playmargin.fun, free matches only)

A second game server so players in the Americas are not 200+ ms from Mumbai. Money stays on ONE box.

| | Mumbai `api.playmargin.fun` | US `us.api.playmargin.fun` |
|---|---|---|
| AWS | ap-south-1, `15.207.255.76` | us-east-1, t4g.small `i-0f420437b28ae9927`, EIP `54.146.83.204`, SG `margin-us-sg`, key `margin-us-key` (all `margin-us-*`, about 14 USD a month) |
| Paid, relayer, /stats, /api/team | yes | no: no `SETTLER_PRIVATE_KEY`, no `relayer.env` (deploy.sh skips the relayer), so paid joins get "paid mode is off on this server" |
| Match ids | Colyseus ids | `MATCH_ID_PREFIX=u-` in `/etc/margin/env`: every id starts with `u-`, and the client routes Verify, logs and reconnects by it |
| NEAR anchor | hourly Merkle root | none: the contract keeps ONE free-match anchor slot whose seq (the hour) must increase, so a second box anchoring the same hour is refused. Verify shows hash chain + books for `u-` matches |
| DB | `/var/lib/margin/margin.sqlite` | its own, same path |

After EVERY deploy (either box), run `./ops/smoke-browser.sh`: a real Chrome joins Play free and a
private room on both boxes from playmargin.fun. curl cannot see CORS breaks (the 13 Nov P0).

Same release and the same files: `DEPLOY_HOST=ubuntu@54.146.83.204 ./ops/deploy.sh`, `ops/Caddyfile` with
`MARGIN_HOST=us.api.playmargin.fun` in `/etc/caddy/cf.env` (the cert is DNS-01 like Mumbai). DNS: `us.api` A
record, DNS only. The client (`apps/client`, region picker) pings both `/health` and joins the faster for free
play; paid always goes to Mumbai; an invite from a US room carries `?s=us`.
Latency (13 Nov): Bengaluru to Mumbai 35 ms, Bengaluru to US 258 ms, us-east-1 to Mumbai 204 ms.

## Tunnel mode (no droplet: api.playmargin.fun served from a Mac, testnet)

Live since 12 Nov while there is no droplet. Cloudflare Tunnel carries https://api.playmargin.fun to a local
front proxy that does what the Caddyfile does (TLS ends at Cloudflare). Files in `ops/tunnel/`, a copy in
`~/margin-prod/`; secrets never in git.

| Piece | Where |
|---|---|
| Game server, testnet, fresh DB | `:2700`, checkout `~/margin-prod/app` (main), DB `~/margin-prod/margin.db`, env `~/margin-prod/server.env` (chmod 600: settler key, NEAR AI key, `STATS_KEY`) |
| Relayer | `:3700`, env `~/margin-prod/relayer.env` (chmod 600) |
| Front proxy `ops/tunnel/proxy.mjs` | `127.0.0.1:8700` only: `/relay/*` to `:3700` (prefix stripped), the rest (HTTP + WebSocket) to `:2700`. Client IP from `CF-Connecting-IP` (Cloudflare refuses requests that send their own); any `X-Real-IP` / `X-Forwarded-For` from a client is dropped |
| Tunnel `margin-api` | `~/margin-prod/cloudflared.yml` (from `ops/tunnel/cloudflared.yml.example`), credentials in `~/.cloudflared/`, DNS: CNAME `api` to the tunnel |
| Supervisor `ops/tunnel/run.sh` | restarts each piece if it exits, runs `caffeinate -dimsu` (no sleep while live), logs in `~/margin-prod/logs/`. On stop it drains the game server FIRST while proxy, relayer and tunnel stay up (players keep playing to the bell), then stops the rest (tested 12 Nov: a LIVE match drained 85 s, the player got matchEnd, nothing dropped) |
| launchd `ops/tunnel/fun.playmargin.tunnel.plist` | `~/Library/LaunchAgents/` (replace `__HOME__`): starts at login, restarts the supervisor, 150 s for LIVE matches to drain on stop |

```
# first time (once): cloudflared tunnel login; cloudflared tunnel create margin-api;
#   cloudflared tunnel route dns margin-api api.playmargin.fun
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/fun.playmargin.tunnel.plist   # start
launchctl kill SIGTERM gui/$(id -u)/fun.playmargin.tunnel   # restart: the server drains LIVE matches with players still connected, then launchd restarts all
launchctl bootout gui/$(id -u)/fun.playmargin.tunnel                                   # stop (Mac may sleep again)
curl -s https://api.playmargin.fun/health ; curl -s https://api.playmargin.fun/relay/health
# deploy a new main: cd ~/margin-prod/app && git pull --ff-only (npm ci if a lockfile changed), then the restart above
```
Replaced by EC2 mode on 13 Nov. The plist, `~/margin-prod` and the tunnel stay for 24 h as the rollback.

## Day to day
- Health: `curl -s localhost:2567/health` (503 while draining, `settler.low` under 0.12 NEAR) and `curl -s localhost:3030/health` (relayer NEAR balance + `alarm`).
- Logs are JSON lines: `journalctl -u margin-server -o cat -f | jq` (`settled`, `settle_revert`, `settle_gave_up`, `settle_refused`, `settler_low`, `open_failed`, `refund_failed`, `anchor_failed`, `paid_stake`, `drain`).
- Restart policy: both units `Restart=always`. A server restart drains first (up to 2 min with a LIVE match).
- Rollback: `ln -sfn /opt/margin/releases/<previous> /opt/margin/current && systemctl restart margin-relayer margin-server`
- Anchor now: `cd /opt/margin/current && set -a && . /etc/margin/env && npx tsx apps/server/scripts/anchor-now.ts`
- Back up the DB: `sqlite3 /var/lib/margin/margin.sqlite ".backup /root/margin-$(date +%F).sqlite"`
