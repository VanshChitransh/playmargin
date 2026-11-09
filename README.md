# MARGIN

**Get greedy. Get liquidated.** A real-time arena where BOOST is a loan from a vault, the health
ring is your health factor, and AI liquidator drones pop anyone who goes red. Every match is a
hash-chained log that settles on NEAR.

> Part 1 (the pitch: problem, demand, traction, team) is written for human judges and lands
> before submission. Part 2 below is for AI screeners and developers: every claim has a command.

## Part 2: run it, check it

### 1. Quick start (no keys, no wallet, about 1 minute)

Needs Node 24 and npm.

```
npm install
npm run demo
```

`npm run demo` plays one full paid match headless with the real engine and the real bots
(6 bot-driven players + 2 liquidator drones), narrates it, then proves it (seed 37, about 10 s). Expected tail:

```
vault: lent 773.1, repaid 773.1, interest 4.8, fees 5.8 · reserve 7.6
hash chain: 314 events, head b2c315a45ea7c3a8...
5880 ticks · 0 micro-units created or destroyed · settle == live ✓ · 10.2 s
```

To play in a browser:

```
npm run dev          # game server on :2567, client on :1234
```

Open http://localhost:1234 and press Play. Free rooms need no wallet: you get guest credits and
the room fills with labelled AI agents (🤖).

### 2. Do X, see Y

| # | Do | See |
|---|---|---|
| 1 | `npm run demo` | A narrated paid match: BOOSTs (loans), two players going red and popped by liquidator drones, payouts, then `0 micro-units created or destroyed` and `settle == live` |
| 2 | `npm run sim -- --matches 500` | 500 full matches (2.94M ticks) with the conservation check every tick, every hash chain verified, `settle == live in 500/500` (1 to 3 minutes) |
| 3 | `npm test` | The whole TypeScript suite (engine, settle, bots, server, client logic) passes |
| 4 | `cd contracts/margin && cargo test` | Contract unit tests + near-sandbox integration tests pass |
| 5 | `npm run dev`, open http://localhost:1234, press Play | A 90 s match: steer with the mouse, Space = BOOST (borrow), R = REPAY, E = cash out. Watch your ring go green, yellow, red |
| 6 | Hold all 3 BOOST pips and run into a big spike | Your ring turns red. Within a moment a blob or a drone touches you: "LIQUIDATED", and your receipt shows what the vault took back |
| 7 | After any match, open the receipt's Verify link (`/#/verify/<id>`) | The browser replays the log with the same code as the server, checks every hash, and shows settle == what you were paid. Press "Tamper" and the exact broken event turns red |
| 8 | Open `/#/judge` | Judge Run: a published seed (20261114), normal rules, Drone-1 hunting red blobs. Most first-timers get greedy |
| 9 | `npm run sweep -- 300` | The balance table behind the rules: liquidations per match and how often a greedy player is popped, under the current rules and the old ones |
| 10 | `npm run soak -- --rooms 50` | 50 rooms on the real server: CPU per room tick (measured 0.128 ms, budget 4 ms) |
| 11 | Put `NEAR_AI_API_KEY` in `.env`, then `npm run commander` | One live match with the AI commander on NEAR AI Cloud. Each new plan prints with its one-line rationale |

### 3. What needs keys

| Works with no keys | Needs keys (see `.env.example`) |
|---|---|
| demo, sim, sweep, soak, all tests, free rooms in the browser, Verify | Paid rooms (`NETWORK`, `CONTRACT_ID`, settler key: testnet), AI commander (`NEAR_AI_API_KEY`), Add funds via NEAR Intents 1-Click (`ONECLICK_JWT`, dry quotes unless `ONECLICK_LIVE=1`) |

Server and settlement variables are listed in `ops/env.example`. Secrets live in `.env`, which is
never committed.

### 4. How it works (one paragraph)

The server runs one pure, deterministic engine (`packages/core`) 60 times a second: integer money
(1 unit = 1,000,000 micro-units), a seeded RNG, no clock. Every money event (entry, BOOST loan,
interest, REPAY, spike, eat, pop, cash-out) is appended to a SHA-256 hash-chained log. At the bell,
`settle(log)` replays only the log and must land on the live room's books to the micro-unit. Paid
matches send that result and the log head to the NEAR contract, which checks
`payouts + vault_repaid + interest_to_vault + fees + reserve == stakes + lent` before moving any
USDC. Free matches are anchored hourly as one Merkle root on NEAR.

### 5. Feature to file map

| Feature | Code | Proof |
|---|---|---|
| BOOST = loan, interest, REPAY, health factor, liquidation | `packages/core/src/economy.ts` | `economy.test.ts` (the RULES worked example, exact) |
| Fixed tick order (pops before eats, red eats nothing) | `packages/core/src/step.ts` | `step.test.ts` |
| Conservation every tick | `packages/core/src/invariant.ts` | `invariant.test.ts` (20 seeds × 10k ticks), `npm run sim` |
| Hash-chained log | `packages/core/src/log.ts` | `settle.test.ts` (tamper cases) |
| One pure settle, refuses forged logs | `packages/core/src/settle.ts` | `settle.test.ts` (forgeries a live room cannot produce) |
| Micro-units to USDC settle args | `packages/core/src/settleargs.ts` | `settleargs.test.ts` (contract equality on 10 paid matches) |
| Merkle anchor + proofs | `packages/core/src/merkle.ts`, `apps/server/src/anchor/job.ts` | `merkle.test.ts`, `job.test.ts` |
| Judge Run scenario | `packages/core/src/scenario.ts` | `scenario.test.ts` |
| Agent players (potential-field bot) | `apps/server/src/agents/freebot.ts` | `freebot.test.ts` |
| Liquidator drones | `apps/server/src/agents/drone.ts` | `drone.test.ts` |
| AI commander (NEAR AI Cloud) | `apps/server/src/agents/commander.ts` | `commander.test.ts`, `npm run commander` |
| Rooms, lobby, late join, paid join proof | `apps/server/src/rooms/` | `lobby.test.ts`, `paidMatch.test.ts`, `guard.test.ts` |
| Settlement (credits or NEAR) | `apps/server/src/settlement/` | `credits.test.ts`, `toSettleArgs.test.ts` |
| Read API (logs, proofs, leaderboard, stats) | `apps/server/src/api.ts` | `api.test.ts` |
| Browser client, HUD, Verify page | `apps/client/src/` | `checks.test.ts`, `logic.test.ts`, `interp.test.ts` |
| Contract | `contracts/margin/src/` | `cargo test` |
| Headless demo, sim, sweep, soak | `tools/sim/` | the commands above |

### 6. NEAR features used

| NEAR feature | Where |
|---|---|
| Smart contract holding USDC, tickets, the vault and the reserve, with an exact-equality settle | `contracts/margin/src/arena.rs`, `lib.rs` |
| NEP-141 deposits (`ft_on_transfer`) and 1-yocto withdraw | `contracts/margin/src/deposit.rs`, `withdraw.rs` |
| Function-call session key scoped to `enter_arena` (one wallet approval, cannot withdraw) | `apps/client/src/chain/session.ts` |
| Meta transactions (NEP-366): our relayer pays the gas | `services/relayer/server.ts` |
| NEP-413 signed join, verified by the server | `apps/client/src/chain/join.ts`, `apps/server/src/rooms/paidMatch.ts` |
| Wallets via near-connect (HOT, Meteor, Intear) | `apps/client/src/chain/wallet.ts` |
| NEAR Auth email login | `apps/client/src/chain/email.ts`, `services/relayer/fastauth.ts` |
| NEAR Intents 1-Click: Add funds from any chain, settled as USDC on NEAR | `services/relayer/oneclick.ts`, `apps/client/src/chain/addfunds.ts` |
| Named sub-accounts (`settler.`, `relayer.`, `usdc.playmargin.testnet`) | `tools/scripts/keys.ts`, `tools/scripts/deploy.ts` |
| On-chain anchors: paid match heads in `settle`, free matches as an hourly Merkle root | `contracts/margin/src/arena.rs` (`anchor`), `apps/server/src/anchor/job.ts` |
| NEAR AI Cloud (OpenAI-compatible, structured JSON output) | `apps/server/src/agents/commander.ts` |

### 7. Repo map

```
packages/core     deterministic engine, economy, log, settle (shared by server, client, sim)
apps/server       Colyseus rooms, agents, settlement, anchor job, read API
apps/client       PixiJS game client, HUD, Verify page, wallet and funds (src/chain)
contracts/margin  Rust contract (near-sdk 5.30.1)
services/relayer  meta-tx relayer, 1-Click proxy, NEAR Auth helper
tools/sim         demo, sim, sweep, soak, client fixture
tools/scripts     deploy, keys, testnet end-to-end money loop
ops               server deploy files
```

### 8. Credits and AI-generated code

Third-party code and assets with their licences: `docs/CREDITS.md`. Most code in this repo was
written with AI coding agents (Claude Code) under human direction, review and testing.
