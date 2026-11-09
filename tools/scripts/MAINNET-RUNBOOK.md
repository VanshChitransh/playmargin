# MAINNET RUNBOOK (12 or 13 Nov)

Vansh runs every step by hand. Nothing here runs on mainnet without `CONFIRM_MAINNET=yes`, and
nothing should be run before Vansh says go. Every transaction he approves is marked **[TX]**.

**Rehearsed end to end on testnet on 9 Nov** (same commands, only the network swapped, Option B
shape: `margin.<funder>`). Results, costs and the mistakes it caught are in "Rehearsal" at the end.

Budget: **about 2.8 NEAR parked + about 0.05 NEAR spent** (2.75 into the contract account, the
rest is gas from `vanshverse.near`) and **USDC for the vault seed + one real deposit** (step 6).
About 2.7 NEAR comes back at cleanup (measured: 0.049 NEAR net for the whole rehearsal).

## 0. Decide on the day (pure config, no code change)

| Choice | Option A | Option B | Set with |
|---|---|---|---|
| Contract account | `playmargin.near` (brand name) | `margin.vanshverse.near` (sub-account) | `CONTRACT_ID` |
| Paid entry | 1 USDC = `1000000` | 0.10 USDC = `100000` | `ENTRY_STAKE` |

```
export NETWORK=mainnet
export CONTRACT_ID=playmargin.near        # or margin.vanshverse.near
export ENTRY_STAKE=100000                 # 0.10 USDC (or 1000000 for 1 USDC). Both rehearsed
export OWNER_ID=vanshverse.near           # payout wallet, never the contract account
```

Settler and relayer default to `settler.$CONTRACT_ID` and `relayer.$CONTRACT_ID` (override with
`SETTLER_ID`, `RELAYER_ID`). The stake is stored in the contract (`config().entry_stake`). The
client reads it from there, and the owner can change it later with `set_entry_stake` (1 yocto).

The server reads the stake from `config().entry_stake` too (core 824ba80, server 94a4ec0), so
switching the stake is one owner tx and no redeploy. Both 1 USDC and 0.10 USDC were rehearsed.

## 1. Pre-flight (free, no mainnet tx, about 2 min)

1. Main is green: `npm run typecheck && npm test && (cd contracts/margin && cargo test)`.
2. Build the exact wasm that ships (199,001 bytes, about 1.99 NEAR of storage):
   ```
   cd contracts/margin && cargo near build non-reproducible-wasm --no-embed-abi
   ls -l target/near/margin.wasm
   ```
3. The name is free (Option A): `near account view-account-summary playmargin.near network-config mainnet now`
   prints an ERROR ending in `does not exist while viewing`. That error is the good answer.
4. `vanshverse.near` holds at least 2.85 NEAR and the USDC for step 6.
5. Put the owner key where the scripts can sign (once, from the Meteor seed phrase):
   `near account import-account using-seed-phrase "<12 words>" --seed-phrase-hd-path "m/44'/397'/0'" network-config mainnet`
   and choose "save to legacy keychain" (writes `~/.near-credentials/mainnet/vanshverse.near.json`).

## 2. Create the contract account (about 10 s)

**[TX 1]** from `vanshverse.near`, funds the contract account with 2.75 NEAR:

```
near account create-account fund-myself $CONTRACT_ID '2.75 NEAR' \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as vanshverse.near network-config mainnet sign-with-legacy-keychain send
```

Measured fee 0.0071 NEAR. The new full-access key lands in
`~/.near-credentials/mainnet/$CONTRACT_ID.json`. Back it up (password manager). Losing it means
the code can never be upgraded.

Why 2.75: code storage 1.995 + deploy and register gas 0.018 + settler 0.25 + relayer 0.15 +
**0.33 headroom for state**. The contract pays for its own state: about 130 bytes per settled
match (tombstone) and about 90 bytes per new player balance, so 0.33 NEAR is about 2,000 matches
or players together. With only 2.3 NEAR (the first plan) the headroom was 0.038 NEAR, about 25
matches before every write fails.

## 3. Deploy, init, register, sub-accounts (one script, about 15 s)

```
cd tools/scripts && CONFIRM_MAINNET=yes npm run deploy
```

It sends, in order (all signed by the contract account):

| # | Tx | Measured |
|---|---|---|
| **[TX 2]** | deploy wasm + `new(owner, settler, usdc, entry_stake)` | 1.994 NEAR storage locked + ~0.016 gas |
| **[TX 3]** | `storage_deposit` on native USDC for the contract | 0.00125 |
| **[TX 4]** | create `settler.$CONTRACT_ID` funded 0.25 NEAR (key saved locally) | 0.25 |
| **[TX 5]** | create `relayer.$CONTRACT_ID` funded 0.15 NEAR (key saved locally) | 0.15 |

`ensureOwner` and `ensureEntryStake` send nothing on a fresh deploy (`new()` already set both).
The script is idempotent: if it stops halfway, run the same command again.

**Why the settler needs 0.25, not 0.1:** NEAR reserves prepaid gas at 10x the current gas price
before running a tx. The server sends every call at 100 Tgas, so the settler needs more than
0.101 NEAR free at ALL times or `open_match` is rejected with `NotEnoughBalance` (the rehearsal
hit exactly this). Real burn is about 0.0004 NEAR per call, about 0.0007 per paid match. Top up
when it falls under 0.12. The relayer burns about 0.0002 NEAR per ticket. Email login's MPC
`sign` runs at 300 Tgas, so with `VITE_NEAR_AUTH=1` fund the relayer with at least 0.5 NEAR.

## 4. Check the deploy (free)

```
near contract call-function as-read-only $CONTRACT_ID config json-args {} network-config mainnet now
```

Expect `owner = vanshverse.near`, `settler = settler.$CONTRACT_ID`, native USDC, your `entry_stake`.

## 5. Point the services at mainnet (no tx)

| Service | Env |
|---|---|
| Server (S2) | `NETWORK=mainnet CONTRACT_ID SETTLER_ID SETTLER_PRIVATE_KEY RPC_URLS` (key from `~/.near-credentials/mainnet/settler.$CONTRACT_ID.json`, field `private_key`) |
| Relayer | `NETWORK=mainnet CONTRACT_ID RELAYER_ID RELAYER_PRIVATE_KEY RELAYER_CORS_ORIGIN=https://playmargin.fun RELAYER_LOW_BALANCE=0.05 ONECLICK_LIVE=1` (live quotes go to `CONTRACT_ID`) |
| Client build | `VITE_NETWORK=mainnet VITE_CONTRACT_ID=$CONTRACT_ID VITE_RELAYER_URL=https://<relayer host>` (+ `VITE_NEAR_AUTH=1 VITE_NEAR_AUTH_CLIENT_ID=<id>` only once NEAR approves our Auth0 app) |

The server is ready when it logs `{"event":"up",...}`. The relayer is ready when `GET /health`
answers with its balance and `"alarm":false`.

## 6. Seed the vault and play the first real match

The vault must back every match that is open at the same time: **seed at least
1.5 x stake x players**. 1 USDC stake, 2 players: 3 USDC. 0.10 stake, 2 players: 0.3 USDC
(rehearsed), a full 12-player room at 0.10: 1.8 USDC.

**[TX 6]** owner seeds the vault (amount in base units, 3000000 = 3 USDC, measured 6 s):

```
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 \
  ft_transfer_call json-args '{"receiver_id":"'$CONTRACT_ID'","amount":"3000000","msg":"{\"vault\":true}"}' \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as vanshverse.near network-config mainnet sign-with-legacy-keychain send
```

Then, in the browser on playmargin.fun as a player (all wallet approvals, Vansh clicks):
- **[TX 7]** Add funds via 1-Click (the real $1 from Base, for the video), or "Move $1 in" from the wallet.
- **[TX 8]** Enable quick play (AddKey, enter_arena only). After that, PLAY needs no approval.
- The settle tx is sent by the server (settler). Copy its nearblocks link for the README.
- **[TX 9]** Withdraw to prove the money comes back.

## 7. Rollback and cleanup (how the NEAR comes back, rehearsed)

Never delete or recreate the accounts (name squatters watch for it). Recover value instead:

1. **Stop new money:** stop the server and relayer. Open matches settle or players `reclaim()` after 15 min.
2. **USDC out [TX]:** check `vault`, `reserve`, `balance_of`, then as the owner (1 yocto each):
   ```
   near contract call-function as-transaction $CONTRACT_ID vault_withdraw json-args '{"amount":"<vault.free>"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as vanshverse.near network-config mainnet sign-with-legacy-keychain send
   near contract call-function as-transaction $CONTRACT_ID reserve_withdraw json-args '{"amount":"<reserve>"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as vanshverse.near network-config mainnet sign-with-legacy-keychain send
   near contract call-function as-transaction $CONTRACT_ID withdraw json-args '{"amount":"<sum>"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as vanshverse.near network-config mainnet sign-with-legacy-keychain send
   ```
   Players withdraw their own balances first. `reserve_withdraw` refuses while matches are open.
3. **Storage NEAR out [TX]:** the 1.99 NEAR is locked by the wasm bytes. Replace the code with an
   empty 8-byte module (state stays, about 1 KB), then send the freed NEAR home:
   ```
   printf '\x00asm\x01\x00\x00\x00' > tiny.wasm
   near contract deploy $CONTRACT_ID use-file tiny.wasm without-init-call network-config mainnet sign-with-legacy-keychain send
   near account view-account-summary $CONTRACT_ID network-config mainnet now     # balance minus storage = what you can send
   near tokens $CONTRACT_ID send-near vanshverse.near '<balance - 0.02> NEAR' network-config mainnet sign-with-legacy-keychain send
   ```
   Do this only after every balance is withdrawn: the empty module cannot pay anyone out.
4. **Sub-accounts:** `near tokens settler.$CONTRACT_ID send-near vanshverse.near '<balance - 0.003> NEAR' ...`
   and the same for the relayer (each keeps about 0.002 NEAR for its own storage).
5. **Bad code, keep the money:** redeploy a fixed wasm with `CONFIRM_MAINNET=yes UPGRADE=1 npm run deploy`
   (state kept) or `MIGRATE=1` when the state layout changed (write a ContractVn + migrate first).

## Wasm size

199 KB after `--no-embed-abi` (saves 3 KB). `wasm-opt -Oz` saves 1 KB more, and the rest is
near-sdk's JSON/format machinery that every method needs, so no cheap cut is left. 1 NEAR per
100 KB means about 1.99 NEAR of refundable storage.

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

**Net cost of the whole day: 0.049 NEAR.** Peak NEAR needed at once: 2.7 (now 2.75 with the fixes).

Mistakes the rehearsal caught (all fixed above):
1. Settler funded 0.1 NEAR could not send `open_match` (`NotEnoughBalance`, 100 Tgas reserves 0.101 NEAR). Now 0.25.
2. 2.3 NEAR left 0.038 NEAR of storage headroom, about 25 matches. Now 2.75.
3. A 0.5 USDC vault seed cannot back a 1 USDC match (needs 1.5 x stake x players). Formula added.
4. 0.10 USDC needed the server to read the stake from the contract. Fixed (94a4ec0) and re-run.
6. Right after `UPGRADE=1` the script's next view hit a node still serving the old code
   (MethodNotFound). The deploy and owner txs now wait for FINAL.
5. The "name is free" check prints an error, cleanup's "tiny contract" had no recipe, and the
   server's ready line is now JSON. All spelled out.
