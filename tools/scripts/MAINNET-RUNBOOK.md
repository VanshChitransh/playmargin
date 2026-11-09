# MAINNET RUNBOOK (12 or 13 Nov)

Vansh runs every step by hand. Nothing here runs on mainnet without `CONFIRM_MAINNET=yes`, and
nothing should be run before Vansh says go. Every transaction he approves is marked **[TX]**.

Budget: **about 2.35 NEAR** (2.3 into the contract account + about 0.05 left in `vanshverse.near`
for gas) and **about 1.5 USDC** (vault seed + one real player deposit). Most of the NEAR is
refundable storage (see Cleanup).

## 0. Decide on the day (pure config, no code change)

| Choice | Option A | Option B | Set with |
|---|---|---|---|
| Contract account | `playmargin.near` (brand name) | `margin.vanshverse.near` (sub-account) | `CONTRACT_ID` |
| Paid entry | 1 USDC = `1000000` | 0.10 USDC = `100000` | `ENTRY_STAKE` |

```
export NETWORK=mainnet
export CONTRACT_ID=playmargin.near        # or margin.vanshverse.near
export ENTRY_STAKE=100000                 # 0.10 USDC (or 1000000 for 1 USDC)
export OWNER_ID=vanshverse.near           # payout wallet, never the contract account
```

Settler and relayer default to `settler.$CONTRACT_ID` and `relayer.$CONTRACT_ID` (override with
`SETTLER_ID`, `RELAYER_ID`). The stake is stored in the contract (`config().entry_stake`). The
client reads it from there, and the owner can change it later with `set_entry_stake` (1 yocto).
**Prerequisite (S1/S2):** the server must use the same stake for paid pots. It reads
`config().entry_stake` at startup or core's `ENTRY_PAID_USDC` is set to match. Check before step 5.

## 1. Pre-flight (free, no mainnet tx)

1. Main is green: `npm run typecheck && npm test && (cd contracts/margin && cargo test)`.
2. Build the exact wasm that ships (~199 KB, about 1.99 NEAR of storage):
   ```
   cd contracts/margin && cargo near build non-reproducible-wasm --no-embed-abi
   ls -l target/near/margin.wasm
   ```
3. The name is free (Option A): `near account view-account-summary playmargin.near network-config mainnet now`
   must say the account does not exist.
4. `vanshverse.near` holds at least 2.4 NEAR and the USDC for step 6.
5. Put the owner key where the scripts can sign (once, from the Meteor seed phrase):
   `near account import-account using-seed-phrase "<12 words>" --seed-phrase-hd-path "m/44'/397'/0'" network-config mainnet`
   and choose "save to legacy keychain" (writes `~/.near-credentials/mainnet/vanshverse.near.json`).

## 2. Create the contract account

**[TX 1]** from `vanshverse.near`, funds the contract account with 2.3 NEAR:

```
near account create-account fund-myself $CONTRACT_ID '2.3 NEAR' \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as vanshverse.near network-config mainnet sign-with-legacy-keychain send
```

The new full-access key lands in `~/.near-credentials/mainnet/$CONTRACT_ID.json`. Back it up
(password manager). Losing it means the code can never be upgraded.

## 3. Deploy, init, register, sub-accounts (one script)

```
cd tools/scripts && CONFIRM_MAINNET=yes npm run deploy
```

It sends, in order (all signed by the contract account unless noted):

| # | Tx | NEAR it costs |
|---|---|---|
| **[TX 2]** | deploy wasm + `new(owner, settler, usdc, entry_stake)` | 1.99 storage + ~0.003 gas |
| **[TX 3]** | `storage_deposit` on native USDC for the contract | 0.00125 |
| **[TX 4]** | create `settler.$CONTRACT_ID` funded 0.1 NEAR (key saved locally) | 0.1 |
| **[TX 5]** | create `relayer.$CONTRACT_ID` funded 0.15 NEAR (key saved locally) | 0.15 |

`ensureOwner` and `ensureEntryStake` send nothing on a fresh deploy (`new()` already set both).
The script is idempotent: if it stops halfway, run the same command again.

0.1 NEAR covers about 50 settles, 0.15 NEAR about 300 relayed entries. `GET /health` on the
relayer raises `alarm` below 0.5 NEAR (set `RELAYER_LOW_BALANCE=0.05` on mainnet).

## 4. Check the deploy (free)

```
near contract call-function as-read-only $CONTRACT_ID config json-args {} network-config mainnet now
```

Expect `owner = vanshverse.near`, `settler = settler.$CONTRACT_ID`, native USDC, your `entry_stake`.

## 5. Point the services at mainnet (no tx)

| Service | Env |
|---|---|
| Server (S2) | `NETWORK=mainnet CONTRACT_ID SETTLER_ID SETTLER_PRIVATE_KEY RPC_URLS` (key from `~/.near-credentials/mainnet/settler.$CONTRACT_ID.json`) |
| Relayer | `NETWORK=mainnet CONTRACT_ID RELAYER_ID RELAYER_PRIVATE_KEY RELAYER_CORS_ORIGIN=https://playmargin.fun RELAYER_LOW_BALANCE=0.05 ONECLICK_LIVE=1 ONECLICK_RECIPIENT=$CONTRACT_ID` |
| Client build | `VITE_NETWORK=mainnet VITE_CONTRACT_ID=$CONTRACT_ID VITE_RELAYER_URL=https://<relayer host>` (+ `VITE_NEAR_AUTH=1 VITE_NEAR_AUTH_CLIENT_ID=<id>` only once NEAR approves our Auth0 app) |

Email login on mainnet also needs the relayer to pay for new accounts (`FASTAUTH_FUND`, default
0.01 NEAR each). Leave `VITE_NEAR_AUTH` off if the relayer only has the lean 0.15 NEAR.

## 6. Seed the vault and play the first real match

**[TX 6]** owner seeds the vault (0.5 USDC backs a 0.10 stake match of up to 3 players, 1.5 USDC
backs one 1 USDC player):

```
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 \
  ft_transfer_call json-args '{"receiver_id":"'$CONTRACT_ID'","amount":"500000","msg":"{\"vault\":true}"}' \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as vanshverse.near network-config mainnet sign-with-legacy-keychain send
```

Then, in the browser on playmargin.fun as a player (all wallet approvals, Vansh clicks):
- **[TX 7]** Add funds via 1-Click (the real $1 from Base, for the video), or "Move $1 in" from the wallet.
- **[TX 8]** Enable quick play (AddKey, enter_arena only). After that, PLAY needs no approval.
- The settle tx is sent by the server (settler). Copy its nearblocks link for the README.
- **[TX 9]** Withdraw to prove the money comes back.

## 7. Rollback and cleanup (how the NEAR comes back)

Never delete or recreate the accounts (name squatters watch for it). Recover value instead:

1. **Stop new money:** stop the server and relayer. Open matches settle or players `reclaim()` after 15 min.
2. **USDC out [TX]:** owner calls `vault_withdraw` and `reserve_withdraw` (1 yocto each), then
   `withdraw` (1 yocto) to move it to the wallet. Players withdraw their own balances.
3. **Storage NEAR out [TX]:** the 1.99 NEAR is locked by the wasm bytes. Deploy a tiny no-op contract (`tiny.wasm`, e.g. a fresh `cargo near new` build, a few KB)
   in its place (keep the state, which is a few KB), then send the freed NEAR home:
   ```
   near contract deploy $CONTRACT_ID use-file tiny.wasm without-init-call network-config mainnet sign-with-legacy-keychain send
   near tokens $CONTRACT_ID send-near vanshverse.near '1.9 NEAR' network-config mainnet sign-with-legacy-keychain send
   ```
   Do this only after every balance is withdrawn: the tiny contract cannot pay anyone out.
4. **Sub-accounts:** send leftover settler/relayer NEAR back with `near tokens ... send-near`,
   keeping about 0.002 NEAR for their own storage.
5. **Bad code, keep the money:** redeploy a fixed wasm with `CONFIRM_MAINNET=yes UPGRADE=1 npm run deploy`
   (state kept) or `MIGRATE=1` when the state layout changed (write a ContractVn + migrate first).

## Wasm size

199 KB after `--no-embed-abi` (saves 3 KB). `wasm-opt -Oz` saves 1 KB more, and the rest is
near-sdk's JSON/format machinery that every method needs, so no cheap cut is left. 1 NEAR per
100 KB means about 1.99 NEAR of refundable storage.
