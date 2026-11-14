# MAINNET RUNBOOK

Last updated 14 Nov after the red team (`research/margin/redteam/`, L1, L3, L8). Production is now two
EC2 boxes plus Cloudflare Pages (step 5), not one droplet.

Vansh runs every step by hand. Nothing here runs on mainnet without `CONFIRM_MAINNET=yes`, and
nothing should be run before Vansh says go. Every transaction he approves is marked **[TX]**.

**Rehearsed end to end on testnet on 9 Nov** (same commands, only the network swapped, Option B
shape: `margin.<funder>`). Results, costs and the mistakes it caught are in "Rehearsal" at the end.

Budget: **about 3.75 NEAR parked + about 0.05 NEAR spent** (3.7 into the contract account, the
rest is gas from `vanshverse.near`) and **USDC for the vault seed + one real deposit** (step 6).
About 3.4 NEAR comes back at cleanup (measured: 0.049 NEAR net for the whole rehearsal).

## 0. Decide on the day (pure config, no code change)

| Choice | Option A | Option B | Set with |
|---|---|---|---|
| Contract account | `playmargin.near` (brand name) | `margin.vanshverse.near` (sub-account) | `CONTRACT_ID` |
| Paid entry | 1 USDC = `1000000` | 0.10 USDC = `100000` | `ENTRY_STAKE` |

```
export NETWORK=mainnet
export CONTRACT_ID=playmargin.near        # or margin.vanshverse.near
export ENTRY_STAKE=100000                 # 0.10 USDC (or 1000000 for 1 USDC). Both rehearsed
```

`ENTRY_STAKE` has no default any more (RT L1-07). The first deploy and `MIGRATE=1` refuse to run
without it, and `UPGRADE=1` only touches the stake when it is set, so a hotfix from a fresh shell
can never reset a live 0.10 stake to 1 USDC.

Owner, settler and relayer default to `owner.$CONTRACT_ID`, `settler.$CONTRACT_ID` and
`relayer.$CONTRACT_ID` (override with `OWNER_ID`, `SETTLER_ID`, `RELAYER_ID`). **The owner is NOT the
payout wallet** (RT L8-02): `vanshverse.near` gets the prize, so its seed phrase never goes into a
command, a key file or this laptop's shell history. The deploy script makes `owner.$CONTRACT_ID` with
its own generated key, like the settler and relayer. The stake is stored in the contract (`config().entry_stake`). The
client reads it from there, and the owner can change it later with `set_entry_stake` (1 yocto).

The server reads the stake from `config().entry_stake` too (core 824ba80, server 94a4ec0), so
switching the stake is one owner tx and no redeploy. Both 1 USDC and 0.10 USDC were rehearsed.
Valid stakes are at least 0.1 USDC and divide 100000000 (100000, 200000, 250000, 500000, 1000000):
the contract refuses anything else. **Never change the stake while paid rooms are live:** stop
the server (or wait for an empty queue), change it, then restart, so no ticket straddles two stakes.

## 1. Pre-flight (free, no mainnet tx, about 2 min)

1. Main is green: `npm run typecheck && npm test && (cd contracts/margin && cargo test)`.
2. Build the exact wasm that ships (204,838 bytes with A7 agents, about 2.05 NEAR of storage):
   ```
   cd contracts/margin && cargo near build non-reproducible-wasm --no-embed-abi
   ls -l target/near/margin.wasm
   ```
3. The name is free (Option A): `near account view-account-summary playmargin.near network-config mainnet now`
   prints an ERROR ending in `does not exist while viewing`. That error is the good answer.
4. `vanshverse.near` holds at least 3.75 NEAR and the USDC for step 6.
5. No seed phrase import. `vanshverse.near` signs exactly one CLI tx (step 2), and the CLI asks for
   the 12 words at a prompt, so they never land in `~/.zsh_history`, `ps` or a key file. Never type
   `import-account using-seed-phrase "<12 words>"`.

## 2. Create the contract account (about 10 s)

**[TX 1]** from `vanshverse.near`, funds the contract account with 3.7 NEAR:

```
near account create-account fund-myself $CONTRACT_ID '3.7 NEAR' \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as vanshverse.near network-config mainnet sign-with-seed-phrase
```

Leave the command at `sign-with-seed-phrase`: the CLI then prompts "Enter the seed-phrase for this
account" (type the Meteor words there), asks the HD path (`m/44'/397'/0'`), and offers send.

Measured fee 0.0071 NEAR. The new full-access key lands in
`~/.near-credentials/mainnet/$CONTRACT_ID.json`. Back it up (password manager). Losing it means
the code can never be upgraded.

Why 3.7: code storage 2.05 + deploy and register gas 0.02 + settler 0.25 + relayer 0.15 +
owner 0.05 + 3 drone accounts 0.15 (step 3b, funded from the contract account) +
**1.0 NEAR headroom for state** (all refundable). The contract pays for its own state: about 130 bytes per
settled match (tombstone), 95 per ticket and 125 per new player balance. Anyone can add a 125 B
balance row with a 0.1 USDC deposit `{"for": <new id>}`, so the red team (L1-03) showed 0.33 NEAR of
headroom is about 270 cheap deposits from stopping paid play (every state write fails with
`LackBalanceForState`). 1 NEAR is about 8,000 rows. Check it any time:
`near account view-account-summary $CONTRACT_ID network-config mainnet now` (balance minus storage
must stay above 0.1 NEAR, top up with a plain transfer). Testnet got +9 NEAR on 14 Nov for the same reason.

## 3. Deploy, init, register, sub-accounts (one script, about 15 s)

```
cd tools/scripts && CONFIRM_MAINNET=yes npm run deploy
```

It sends, in order (all signed by the contract account):

| # | Tx | Measured |
|---|---|---|
| **[TX 2]** | deploy wasm + `new(owner, settler, usdc, entry_stake)` | 2.05 NEAR storage locked + ~0.016 gas |
| **[TX 3]** | `storage_deposit` on native USDC for the contract | 0.00125 |
| **[TX 4]** | create `settler.$CONTRACT_ID` funded 0.25 NEAR (key saved locally) | 0.25 |
| **[TX 4b]** | create `owner.$CONTRACT_ID` funded 0.05 NEAR (key saved locally) + `storage_deposit` for it on USDC | 0.05 + 0.00125 |
| **[TX 5]** | create `relayer.$CONTRACT_ID` funded 0.15 NEAR (key saved locally) | 0.15 |

`ensureOwner` and `ensureEntryStake` send nothing on a fresh deploy (`new()` already set both).
The script is idempotent: if it stops halfway, run the same command again.

The CLI and the scripts write key files readable by every process on the laptop. Lock them right away,
and back up the contract, owner and settler files in the password manager:

```
chmod 600 ~/.near-credentials/mainnet/*.json ~/.near-credentials/mainnet/*/*.json
```

**Why the settler needs 0.25, not 0.1:** NEAR reserves prepaid gas at 10x the current gas price
before running a tx. The server sends every call at 100 Tgas, so the settler needs more than
0.101 NEAR free at ALL times or `open_match` is rejected with `NotEnoughBalance` (the rehearsal
hit exactly this). Real burn is about 0.0004 NEAR per call, about 0.0007 per paid match. Top up
when it falls under 0.12. The relayer burns about 0.0002 NEAR per ticket, and since 14 Nov it pays
only for tickets that will succeed (RT L3-01). Email login stays OFF on mainnet (see step 5).

### 3b. Drone accounts and agents (A7, about 10 s, 3 small txs + 1 owner call)

`NETWORK=mainnet CONFIRM_MAINNET=yes ../../node_modules/.bin/tsx drones.ts --register` (from
`tools/scripts`). It creates `drone-1..3.$CONTRACT_ID` (0.05 NEAR each, skipped if they exist, never
recreated) and, as the owner, calls `set_agents` (1 yocto) so settle may pay drones their bounties
(capped at 12% of a match's stakes by the contract). Check: `near contract call-function as-read-only
$CONTRACT_ID is_agent json-args '{"account_id":"drone-1.'$CONTRACT_ID'"}' network-config mainnet now`
prints `true`. Then point the server's paid-room drones at these accounts.

### 3c. near.social profiles for the house and drones (S2 script, about 1 min, 8 txs of 1 Ggas, no deposit)

near.social is mainnet only. Each account gets a name, an "Automated account" about line, the
website and an avatar on FastFS (Agent-3 for drones, the logo for the house). From the repo root,
dry run first (prints every write, sends nothing), then send:

```
npx tsx apps/server/scripts/social-profiles.ts --contract $CONTRACT_ID --drones 3
npx tsx apps/server/scripts/social-profiles.ts --contract $CONTRACT_ID --drones 3 --send
```

It signs with `~/.near-credentials/mainnet/<account>.json` for `$CONTRACT_ID` and
`drone-1..3.$CONTRACT_ID` (written by steps 3 and 3b) and prints `OK https://near.social/<account>`
for each once the indexer shows the profile. Every receipt fails with `CodeDoesNotExist` BY DESIGN:
FastData writes go to the account `social`, which has no contract, and the indexer reads the tx
args. The script confirms through the indexer and never retries on that error. Cost: gas only,
about 0.0005 NEAR per tx. Check: open `https://near.social/drone-1.$CONTRACT_ID`.

### 3d. A settler key that can only settle (RT L1-09, 1 tx, gas only)

```
cd tools/scripts && CONFIRM_MAINNET=yes ../../node_modules/.bin/tsx settler-key.ts
```

It adds a function-call key to `settler.$CONTRACT_ID` that may only call `open_match`, `settle`,
`refund_ticket` and `anchor` on `$CONTRACT_ID` (no allowance, so it never runs dry mid-judging) and
saves it to `~/.near-credentials/mainnet/settler.$CONTRACT_ID.server-key.json` (chmod 600, never
printed). **This key goes to the server, never the settler's full key**: a server break-in then gets
four contract calls, not the settler's NEAR or the right to add keys. The relayer key must stay full
access (a `Delegate` action needs one), which is why the relayer only holds 0.15 NEAR. Rehearsed on
testnet 14 Nov ([AddKey](https://testnet.nearblocks.io/txns/HvhhLuQfAMAs57Jz45oSNV9ehDzJxgWy4uJVE5ys2ZLC)):
`refund_ticket` reached the contract, a NEAR transfer and `withdraw` were refused by the key.

## 4. Check the deploy (free)

```
near contract call-function as-read-only $CONTRACT_ID config json-args {} network-config mainnet now
```

Expect `owner = owner.$CONTRACT_ID`, `settler = settler.$CONTRACT_ID`, native USDC, your `entry_stake`.

## 5. Point the services at mainnet (no tx, about 10 min)

Production since 13 Nov (details and rollback in `ops/README.md`, "EC2 mode" and "US box"):

| Box | Host | Runs | Mainnet role |
|---|---|---|---|
| Mumbai | `api.playmargin.fun`, `ubuntu@15.207.255.76` (ap-south-1, grey cloud, Caddy DNS-01 cert) | game server `:2567` + relayer `:3030` behind Caddy (`/relay/*`) | ALL money: settler key, relayer, paid rooms, hourly anchor |
| US | `us.api.playmargin.fun`, `ubuntu@54.146.83.204` (us-east-1) | game server only, `MATCH_ID_PREFIX=u-` | free matches only. **No settler key, no `relayer.env`, ever** |
| Client | Cloudflare Pages project `playmargin` (`playmargin.fun`, `www`) | static build | built with `VITE_NETWORK=mainnet` |

Order matters: Mumbai first, then the client, then smoke. Do it with `/health` showing `rooms: 0`
(a restart drains LIVE matches, but a paid ticket bought on testnet must not meet a mainnet server).

**5a. Mumbai server env** `/etc/margin/env` (root:margin, 640). Edit with `ssh -t ubuntu@15.207.255.76 sudoedit /etc/margin/env`:
set `NETWORK=mainnet`, `CONTRACT_ID=$CONTRACT_ID`, `SETTLER_ID=settler.$CONTRACT_ID`, `RPC_URLS` (keyed RPC
first if we have one), and **delete the old `SETTLER_PRIVATE_KEY` line**. Then append the scoped key
from step 3d without it touching a command line:

```
jq -r '"SETTLER_PRIVATE_KEY=" + .private_key' ~/.near-credentials/mainnet/settler.$CONTRACT_ID.server-key.json \
  | ssh ubuntu@15.207.255.76 'sudo tee -a /etc/margin/env >/dev/null'
```

**5b. Mumbai relayer env** `/etc/margin/relayer.env` (root:margin-relayer, 640), same `sudoedit`:

| Variable | Mainnet value |
|---|---|
| `NETWORK` | `mainnet` |
| `CONTRACT_ID` | `$CONTRACT_ID` |
| `USDC_ID` | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| `RELAYER_ID` | `relayer.$CONTRACT_ID` |
| `RELAYER_PRIVATE_KEY` | append with the same `jq` pipe from `~/.near-credentials/mainnet/relayer.$CONTRACT_ID.json` into `/etc/margin/relayer.env` (delete the testnet line first) |
| `RELAYER_CORS_ORIGIN` | `https://playmargin.fun` |
| `RELAYER_LOW_BALANCE` | `0.05` |
| `ONECLICK_JWT` | already there (same partner key) |
| `ONECLICK_LIVE` | `1` (live quotes go to `CONTRACT_ID`, step 6 proves it with one real deposit) |
| `RELAYER_SENDER_DAILY_CAP`, `RELAYER_IP_DAILY_CAP` | leave unset (20 tickets per account and 40 per IP per UTC day, RT L3-01) |
| `FASTAUTH_ENABLED` | **leave unset.** `/fastauth/create` checks no Auth0 JWT (RT L3-04), so turning it on lets anyone make the relayer fund any account name. Email login stays off until the relayer verifies the JWT |

**5c. US box** `/etc/margin/env` on `ubuntu@54.146.83.204`: set `NETWORK=mainnet` and
`CONTRACT_ID=$CONTRACT_ID` only, keep `MATCH_ID_PREFIX=u-`. Check there is still no
`SETTLER_PRIVATE_KEY` line and no `/etc/margin/relayer.env` (`sudo grep -c SETTLER_PRIVATE_KEY /etc/margin/env`
prints 0). Without a key it never signs anything: paid joins get "paid mode is off on this server".

**5d. Ship both boxes** from the repo root (a clean checkout of main):

```
DEPLOY_HOST=ubuntu@15.207.255.76 ./ops/deploy.sh
DEPLOY_HOST=ubuntu@54.146.83.204 ./ops/deploy.sh
curl -s https://api.playmargin.fun/health        # "network":"mainnet", your contract, settler low:false
curl -s https://api.playmargin.fun/relay/health  # your relayer, "alarm":false
curl -s https://us.api.playmargin.fun/health     # no settler (free only)
```

The server log shows `{"event":"up"}` and `{"event":"paid_stake"}` with your stake.

**Known gap, decide with S2 and S3 before the switch:** the `matches` table has no network column, so
after the switch the Verify page looks up old testnet settle and anchor hashes on mainnet RPC and
cannot find them. Either start Mumbai on a fresh DB (move the old one aside with `.backup`, never
delete it) and keep the README testnet links pointing at testnet nearblocks, or stay on testnet.

**5e. Client on Cloudflare Pages** (reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the env
file, never prints them):

```
VITE_CONTRACT_ID=$CONTRACT_ID ENV_FILE=$PWD/.env apps/client/scripts/deploy-pages.sh mainnet
```

It keeps `VITE_NEAR_AUTH=0` (email login off, see 5b) and points at `api.playmargin.fun` and
`us.api.playmargin.fun`. Then run `./ops/smoke-browser.sh` (curl cannot see CORS breaks) and play one
free match on the public URL.

**Rollback to testnet:** put the testnet lines back in both env files (the testnet keys are still in
`~/.near-credentials/testnet`), redeploy both boxes, `deploy-pages.sh testnet`.

## 6. Seed the vault and play the first real match

Each paid room reserves a budget **B = 1.5 x stake x players** from `vault.free` at open, and
(PR #21) its loan cost is set at open from the vault's utilisation, `locked / (free + locked)`:
6%/min at 0%, rising in a straight line to 15%/min at the 80% kink, then steeply to 75%/min at 100%.
The lobby shows LOW only at exactly 0% (the first room open at a time), MED below the kink, HIGH from it.

**Seed 5 x B.** Then rooms open at the same time get these rates:

| Room open at the same time | Utilisation it sees | Loan cost | Tier |
|---|---|---|---|
| 1st | 0% | 6.00%/min | LOW |
| 2nd | 20% | 8.25%/min | MED |
| 3rd | 40% | 10.50%/min | MED |
| 4th | 60% | 12.75%/min | MED |
| 5th | 80% | 15.00%/min | HIGH |
| 6th | refused at `open_match` (no free budget left) | | |

With the old seed of 1 x B, a second room open at the same time could not open at all (no free
budget), and 3 x B already puts the 3rd room at 13.49%/min.

| Stake | Players per room | B | Seed 5 x B |
|---|---|---|---|
| 0.10 USDC | 2 (duel, the expected case) | 0.30 | **1.50 USDC** |
| 0.10 USDC | 12 (full room) | 1.80 | 9.00 USDC |
| 1 USDC | 2 | 3.00 | **15.00 USDC** |
| 1 USDC | 12 | 18.00 | 90.00 USDC |

**What a seed can back (RT L1-10).** Paid rooms take up to 12 humans (`ROOM_SIZE`), and one room
needs B = 1.5 x stake x humans of FREE vault at `open_match`. So the biggest room a seed can open,
with nothing else open, is `seed / (1.5 x stake)` humans:

| Seed at 0.10 USDC | Biggest single room | Same time |
|---|---|---|
| 1.50 USDC | 10 humans (an 11 or 12 room fails at open) | 5 duels |
| 1.80 USDC | 12 humans (one full room) | 6 duels |
| **3.00 USDC (recommended)** | 12 humans | one full room + 4 duels, or 10 duels |

A room the vault cannot back fails at `open_match`, the server refunds every ticket (nothing is lost)
and the players see the room close, which is exactly when the launch gets popular. **Seed 3 USDC at
0.10** (30 USDC at 1 USDC). The 5 x B rate table above still holds for duels.

Interest and fees flow back into the vault, so utilisation only falls over time. Top up later
with the same TX 6 if more rooms run at once.

Only the owner can seed the vault (`{"vault":true}` from anyone else is refunded), so first send the
USDC from Meteor (`vanshverse.near`) to `owner.$CONTRACT_ID`, a normal token send in the wallet. The
deploy script already registered the owner on USDC (TX 4b).

**[TX 6]** owner seeds the vault (amount in base units: 3000000 = 3 USDC for 0.10, 30000000 = 30 USDC
for 1 USDC, measured 6 s):

```
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 \
  ft_transfer_call json-args '{"receiver_id":"'$CONTRACT_ID'","amount":"3000000","msg":"{\"vault\":true}"}' \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as owner.$CONTRACT_ID network-config mainnet sign-with-legacy-keychain send
```

Then, in the browser on playmargin.fun as a player (all wallet approvals, Vansh clicks):
- **[TX 7]** Add funds via 1-Click (the real $1 from Base, for the video), or "Move $1 in" from the wallet.
- **[TX 8]** Enable quick play (AddKey, enter_arena only). After that, PLAY needs no approval.
- The settle tx is sent by the server (settler). Copy its nearblocks link for the README.
- **[TX 9]** Withdraw to prove the money comes back. The account must be registered on USDC: the
  cash screen checks `storage_balance_of` first and says so instead of a withdraw that bounces back
  (RT L1-05). An account that only ever got USDC through 1-Click may need one `storage_deposit`.

**6b. Proof post on near.social** (Vansh, about 0.001 NEAR of gas): sign in on playmargin.fun with
`vanshverse.near`, finish a match, press "Post to near.social" on the results screen and approve
in the wallet. The page shows the real link `https://near.social/vanshverse.near/post/<id>`. Hand
it to S2 for README Part 2 and `docs/NEAR.md`. The wallet pays its own gas, so `vanshverse.near`
must keep at least 0.01 NEAR after funding step 2 (it held 0 on 10 Nov). No storage deposit is
needed on `social`.

## 7. Rollback and cleanup (how the NEAR comes back, rehearsed)

Never delete or recreate the accounts (name squatters watch for it). Recover value instead:

1. **Stop new money:** stop the server and relayer. Open matches settle or players `reclaim()` after 15 min.
2. **USDC out [TX]:** check `vault`, `reserve`, `balance_of`, then as the owner (1 yocto each):
   ```
   near contract call-function as-transaction $CONTRACT_ID vault_withdraw json-args '{"amount":"<vault.free>"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as owner.$CONTRACT_ID network-config mainnet sign-with-legacy-keychain send
   near contract call-function as-transaction $CONTRACT_ID reserve_withdraw json-args '{"amount":"<reserve>"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as owner.$CONTRACT_ID network-config mainnet sign-with-legacy-keychain send
   near contract call-function as-transaction $CONTRACT_ID withdraw json-args '{"amount":"<sum>"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as owner.$CONTRACT_ID network-config mainnet sign-with-legacy-keychain send
   near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 ft_transfer json-args '{"receiver_id":"vanshverse.near","amount":"<sum>"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as owner.$CONTRACT_ID network-config mainnet sign-with-legacy-keychain send
   ```
   Players withdraw their own balances first. `reserve_withdraw` refuses while matches are open.
3. **Storage NEAR out [TX]:** the 2.05 NEAR is locked by the wasm bytes. Replace the code with an
   empty 8-byte module (state stays, about 1 KB), then send the freed NEAR home:
   ```
   printf '\x00asm\x01\x00\x00\x00' > tiny.wasm
   near contract deploy $CONTRACT_ID use-file tiny.wasm without-init-call network-config mainnet sign-with-legacy-keychain send
   near account view-account-summary $CONTRACT_ID network-config mainnet now     # balance minus storage = what you can send
   near tokens $CONTRACT_ID send-near vanshverse.near '<balance - 0.02> NEAR' network-config mainnet sign-with-legacy-keychain send
   ```
   Do this only after every balance is withdrawn: the empty module cannot pay anyone out.
4. **Sub-accounts:** (owner and drone-1..3 too, same command) `near tokens settler.$CONTRACT_ID send-near vanshverse.near '<balance - 0.003> NEAR' ...`
   and the same for the relayer (each keeps about 0.002 NEAR for its own storage).
5. **Bad code, keep the money:** redeploy a fixed wasm with `CONFIRM_MAINNET=yes UPGRADE=1 npm run deploy`
   (state kept, the live stake untouched unless you also export `ENTRY_STAKE`) or `MIGRATE=1` when the
   state layout changed (write a ContractVn + migrate first, and `ENTRY_STAKE` is required).

## Wasm size

205 KB (204,838 B, with A7 agents) after `--no-embed-abi` (saves 3 KB). `wasm-opt -Oz` saves 1 KB more, and the rest is
near-sdk's JSON/format machinery that every method needs, so no cheap cut is left. 1 NEAR per
100 KB means about 2.05 NEAR of refundable storage (1.99 before A7, as in the rehearsal below).

## Rehearsal (testnet, 9 Nov, about 18 min including two 90 s matches)

Funder `vansh-rehearsal-11091618.testnet` (10 NEAR from the faucet) played `vanshverse.near`.
Contract `margin.vansh-rehearsal-11091618.testnet`. Testnet gas price is 1e8, the same as mainnet.

| Step | Time | Tx | NEAR |
|---|---|---|---|
| 1 build | 6 s | none | 0 |
| 2 create account | 9 s | [create](https://testnet.nearblocks.io/txns/BDcJfEifcFofnD7URyegsh1pdu1xfSr5vTXdgZUCHuea) | 2.3 parked + 0.0071 fee |
| 3 deploy script | 14 s | [deploy + new](https://testnet.nearblocks.io/txns/EP5qVKpKWLBr1Gb2nZVoJhBkWRzomCaJZXZtVDkCEPHX), register, [settler](https://testnet.nearblocks.io/txns/DNsQAJ8Wh5QhZVpFWwQQe3Wi71ovc8TBt9we48bRJWuR), [relayer](https://testnet.nearblocks.io/txns/5sY1XbWnLi2fuH6ZEbDTSMCHwnvMUVNvEXSH8TBkBNAW) | 1.994 storage locked, 0.0173 gas + register |
| 4 check config | 3 s | none | 0 |
| 5 server + relayer env switch | 30 s | none | 0 |
| 6 vault seed 3 USDC | 6 s | [seed](https://testnet.nearblocks.io/txns/DCvBxzMd3ZR7gWL3c1EsqAxc9icPQ7cFkEkg1S1KwHnK) | 0.00057 |
| 7 paid matches (n8-paid.ts: 2 real matches, no-survivor settle, stolen key) | 5 min | [settle 1](https://testnet.nearblocks.io/txns/FGDcrbScj2gHGyVhoUZ2T3nP1SQ8PthEMe3tz6E5Wjzb), [settle 2](https://testnet.nearblocks.io/txns/BsKxxvokHK7AXDe9VMTejSdT8Gs8EsHsbHHhq35fg3ja), [no survivor](https://testnet.nearblocks.io/txns/ivSHajDWQNxsxherNYigcLhe1UCghoaK95dWnSRj51q) | settler 0.0021 (6 calls), relayer 0.0022, contract state +554 B |
| 8 USDC out | 15 s | [vault](https://testnet.nearblocks.io/txns/AsfCR7GJQA5KWsK1cwDMQUkddXLPtDf6SVUCaXXWnjyH), [reserve](https://testnet.nearblocks.io/txns/Bj1QeZthxArGMh32BwxQr1XzAvRQs8AAFD7zCmjd5etV), [withdraw](https://testnet.nearblocks.io/txns/D74PNiqCtfPx3K2Lz5r4MkjYwtE2NkmpcDUMpJX4TwD) | 0.001, all 9 USDC back |
| 9 empty module | 5 s | [deploy](https://testnet.nearblocks.io/txns/3E4LxEjfT6VDeKf5aCFtdbNVsMgis9PbotApjpisrYWZ) | storage 199,980 B to 987 B |
| 10 NEAR home | 10 s | [contract](https://testnet.nearblocks.io/txns/Bg56x1YL79F1mbQXjUAFWX3daQNnE8wRdhi8ENSR5MHq), settler, relayer | funder back to 9.951 |

**0.10 USDC re-run** (same contract after `UPGRADE=1`, stake set by the deploy script's
`set_entry_stake`, vault seed 0.3 USDC = 1.5 x 0.10 x 2, server from main 94a4ec0):

| Step | Tx | Result |
|---|---|---|
| redeploy + stake 0.10 | [upgrade](https://testnet.nearblocks.io/txns/838neNYFYTwjaee5NXn2AF2VkrKnDGFP2jwzVkhfJjB2) | `config().entry_stake = 100000` |
| vault seed 0.3 USDC | [seed](https://testnet.nearblocks.io/txns/EmSpz9sCLSin9HAAoQzhyhDxebk9dLdbu6YXGUSfgr4r) | free 300000 |
| real match 1 | tickets [1](https://testnet.nearblocks.io/txns/9WpeJDAXpfhg5ypzPx6ZkwVvcwgCk44RhW49gqPsWkGu) [2](https://testnet.nearblocks.io/txns/C9yRFMC59iECtmD9yCBKHhbaj7WMmnshEQVCam4vdfk4), [settle](https://testnet.nearblocks.io/txns/gr6i6XNHWmndyTogiBUALWvJvbuPxxMUPuaLVM4gqPZ) | stakes 0.2, budget 0.3, lent 0.231 all repaid, no survivor |
| real match 2 | tickets [1](https://testnet.nearblocks.io/txns/9NXLsQUZ8PTVKtN7PHsSiK3DkSyNk42K1nPNr2J9LebM) [2](https://testnet.nearblocks.io/txns/HFodKMtXrgy32DiCyv7isMmzp9kWuCDx7hfujKzrwSdb), [settle](https://testnet.nearblocks.io/txns/DGX4iipgXsv4hdnbg6aBKmoHfEJDa4xCq4MN4kKKehN3) | lent 0.217 all repaid, no survivor |
| no-survivor settle | [settle](https://testnet.nearblocks.io/txns/6Gi2LHV3u31Yh8F7EcCEHkUDza1fK2wxAve9vqkyhTfW) | vault +0.196 (leftover + fees) |
| stolen session key | none | refused (DepositWithFunctionCall, MethodNameMismatch, relayer 400) |

Gas per match is the same at 0.10 (settler about 0.0007 NEAR, relayer about 0.0002 per ticket).

**Net cost of the whole day: 0.049 NEAR.** Peak NEAR needed at once: 2.7 (now 3.7 with the fixes, A7 drones, the owner account and 1 NEAR of state headroom).

Mistakes the rehearsal caught (all fixed above):
1. Settler funded 0.1 NEAR could not send `open_match` (`NotEnoughBalance`, 100 Tgas reserves 0.101 NEAR). Now 0.25.
2. 2.3 NEAR left 0.038 NEAR of storage headroom, about 25 matches. Now 3.7 (1 NEAR headroom after the 14 Nov red team).
3. A 0.5 USDC vault seed cannot back a 1 USDC match (needs 1.5 x stake x players). Formula added.
4. 0.10 USDC needed the server to read the stake from the contract. Fixed (94a4ec0) and re-run.
6. Right after `UPGRADE=1` the script's next view hit a node still serving the old code
   (MethodNotFound). The deploy and owner txs now wait for FINAL.
5. The "name is free" check prints an error, cleanup's "tiny contract" had no recipe, and the
   server's ready line is now JSON. All spelled out.
