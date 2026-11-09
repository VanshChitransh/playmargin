# MARGIN

**Get greedy. Get liquidated.** A real-time multiplayer arena where your size is your money, BOOST is
a loan from a vault, and labelled AI liquidator drones pop anyone who borrows too much. Every match
is a hash-chained log that settles on NEAR.

[![MARGIN gameplay: BOOST borrows, a spike sends the blob red, REPAY saves it, then Drone-1 liquidates a greedy blob and the receipt itemises every number](docs/hero.gif)](docs/hero.mp4)

<sub>Real play, nothing staged: offline practice with labelled bots, then the Judge Run with Drone-1, a labelled AI liquidator. Click for the mp4.</sub>
<!-- TODO(Vansh): V1 demo video (your voice, at most 2:20) and V2 gameplay trailer, mp4 at most 10 MB each -->

**Play:** TODO(Vansh) live URL · **Demo post on X:** TODO(Vansh) link · **Contract (testnet):**
[`playmargin.testnet`](https://testnet.nearblocks.io/address/playmargin.testnet)

Part 1 is the pitch for human judges: every claim links to a file, a test, a transaction or a public
source. Part 2 is for AI screeners and developers: every claim is a command you can run.

## Part 1: what MARGIN is and why it matters

### Play in 10 seconds

Open the live URL and press **Practice free**. No wallet, no sign-up. On a laptop: steer with the
mouse, **hold Space** to BOOST (borrow), **R** to REPAY, **E** to cash out. On a phone: joystick plus
two buttons. A match lasts 90 seconds. Screenshots: [`docs/screenshots/`](docs/screenshots/).

### The problem

1. **Crypto games made the token the game, and players left.** Web3 gaming funding fell from
   $857M in 2024 to $544M in 2025 and 313 games were cancelled in 2025
   ([GamesBeat, Mar 2026](https://gamesbeat.com/blockchain-gamings-market-value-plunged-67-in-2025-chainplay/)).
2. **Leverage hurts people who never felt it coming.** Liquidation is the most common way retail
   traders lose everything, and it happens on a chart nobody was watching.
   <!-- TODO(Vansh): link 2 public posts from research/margin/demand-evidence.md (r/Bitcoin "6 years of DCA got liquidated", Lookonchain "every one of them wiped out") -->
3. **Hidden bots break trust in money games.** Skillz sued Papaya Gaming for using bots in paid
   tournaments ([GamesBeat](https://gamesbeat.com/skillz-sues-papaya-gaming-for-defrauding-players-by-using-bots-in-skill-based-games/)),
   and the case ended in a verdict of $420M in damages or $719M in disgorgement.
   <!-- TODO(Vansh): link a primary source for the verdict amounts before submitting -->
   MARGIN labels every agent and puts every match on a verifiable log.

### What MARGIN is

agar.io where the mass is money. You start a 90 second match with 80 mass bought with your entry.

| You do | What it is in DeFi | Where in the code |
|---|---|---|
| **Hold BOOST** to grow fast and move 1.5x | Borrow from the room's vault, 1x your equity per second, up to 2.5x leverage, 1% fee | `packages/core/src/economy.ts` (`boostHold`, `flushBoost`) |
| Watch your **health ring** go green, yellow, red | Health factor = mass x 0.8 / debt. Interest drains mass every second | `economy.ts` (`hfBps`, `ring`, `accrueInterest`) |
| **Tap REPAY** (15% of debt per tap) | Deleverage. In red, REPAY is the only way out | `economy.ts` (`repayTap`) |
| Get touched while red, or fall below HF 0.90 | **Liquidation**: the vault takes its loan back, the popper gets an 8% bounty | `economy.ts` (`liquidate`, `keeperCheck`) |
| **Cash out** (45 to 80 s, a 4 s channel) or survive the bell | Close the position and keep your equity | `economy.ts` (`cashOut`) |

Spikes knock mass off (harder the more you borrowed), a zone shrinks in the last 30 s, and bigger
blobs eat smaller ones. The full rulebook is mirrored as constants in
[`packages/core/src/constants.ts`](packages/core/src/constants.ts).

**The thesis, measured.** In a 300-match sim with one greedy player who holds BOOST to the cap
(`npm run sweep`), the greedy player is liquidated in about 50% to 76% of matches, while a careful
newcomer who never borrows survives about 70% of matches and finishes at median rank 4 of 12
(`npx tsx tools/sim/human.ts`). Safe play survives. Greed gets liquidated.

### Who you play with

- **Free rooms:** you plus labelled AI agents (`Agent-3 🤖`) that follow the same rules. Agents may not
  eat a human in the first 30 s, enforced by the engine and by settle
  (`packages/core/src/step.ts`, `settle.ts`). Their skill is one tuned constant
  (`apps/server/src/agents/freebot.ts`, `AGENT_SKILL`).
- **Paid rooms:** humans only, plus liquidator drones that cannot eat anyone. They only pop blobs
  that are already red (`apps/server/src/agents/drone.ts`).
- **The commander:** every 15 s an LLM on NEAR AI Cloud retunes the agents and its one-line reason is
  shown to spectators. It never touches money or positions (`apps/server/src/agents/commander.ts`).

### NEAR, used for real

Every feature, why it is there, the code, and a testnet transaction: [`docs/NEAR.md`](docs/NEAR.md).

| Feature | What it does in MARGIN | Proof |
|---|---|---|
| Smart contract with one exact settle | Holds USDC, tickets, the vault and the reserve. Refuses any settle where payouts + repaid + interest + fees + reserve differ from stakes + lent | [settle tx](https://testnet.nearblocks.io/txns/3Nw3RqiAfPmFYJ5LKxxXioEfppLhdEswXyTHhyZQABwA) |
| Function-call session key | One wallet approval, then PLAY with no pop-ups. A stolen key cannot withdraw | [AddKey tx](https://testnet.nearblocks.io/txns/F3GzT78QTH1RkLCwpM89JjFsgdfZAGt9hNqbC365Cug8), stolen-key test in `docs/NEAR.md` |
| NEP-366 meta-transactions | Our relayer pays gas, allow-listed to `enter_arena` only | [relayed ticket](https://testnet.nearblocks.io/txns/6ZSeFrGuuHC6Y6G6swxtpLodk9gjZUJk6cqhmdR2Tn4P) |
| NEP-413 signed join | A paid seat proves it belongs to the ticket's account | `apps/server/src/rooms/paidMatch.ts` |
| NEAR Intents 1-Click | Add funds from any chain, credited as USDC on NEAR | dry quotes until mainnet (Intents has no testnet) |
| Hourly Merkle anchors | Free matches anchored as one root per hour | [anchor tx](https://testnet.nearblocks.io/txns/B87qTFs8NSDUuAkhD1TUyCnBuKR7Z9abR8j1CVjcgNeY) |
| NEAR AI Cloud | The agent commander, structured JSON output | `apps/server/src/agents/commander.ts` |

### Proof it works

- **Money is never created or destroyed.** `npm run sim -- --matches 500` plays 500 full matches,
  checks conservation every tick and replays every log: 0 micro-units leaked, settle equals the live
  room in 500 of 500 (2,940,000 ticks, about 213,000 logged money events, fresh-clone run 9 Nov).
- **One pure settle, refuses forged logs.** `packages/core/src/settle.test.ts` covers forgeries a live
  room cannot produce (borrow and walk away, skimmed interest, leftover paid twice, an agent eating
  a human in the first 30 s).
- **Anyone can verify a match.** The Verify page replays the log in the browser with the same code
  as the server and shows the exact event if anything was changed (`apps/client/src/screens/verify.ts`).
- **Tests:** 200 TypeScript tests (`npm test`) and 41 contract tests (`cargo test`, 3 in near-sandbox).
- **Load:** 50 rooms of 12 on one server at 0.17 ms of CPU per room tick (`npm run soak`).

### Honest status

- **Testnet today.** Mainnet deploy planned for 12 or 13 Nov by the runbook in
  `tools/scripts/MAINNET-RUNBOOK.md`, with real USDC at a small stake.
- **Agent wallets are planned, not built.** Agents are labelled in game but have no NEAR account yet.
- **NEAR Auth email login** is built behind a flag and waits on NEAR's mainnet approval.
- **Traction:** TODO(Vansh) fill from `/api/stats` after launch (users, matches, share of matches with
  2 or more humans, agent liquidations).
- **Real money is gated.** Paid rooms will only open where real-money games are legal. India
  (where they are banned) gets free mode only, pending legal advice.

### What is different

<!-- TODO(Vansh): re-check the Games track list on nearhackathon.com before submitting -->
Among the Games track entries we reviewed on 9 Nov, none was a real-time PvP game with money in
play, none used loans or liquidation as the core loop, and none used Intents inside the game loop.

### Roadmap, team, credits

- Roadmap: leagues, clans with Sputnik DAO treasuries, agent wallets with public P&L, bring your own
  agent. TODO(Vansh): link the public roadmap.
- Team: TODO(Vansh).
- Third-party code and licences: [`docs/CREDITS.md`](docs/CREDITS.md). Architecture:
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- Most code was written with AI coding agents (Claude Code) under human direction, review and
  testing.

## Part 2: run it, check it

### 1. Quick start (no keys, no wallet, about 1 minute)

Needs Node 24 and npm.

```
npm install
npm run demo
```

`npm run demo` plays one full paid match headless with the real engine and the real bots
(6 bot-driven players + 2 liquidator drones), narrates it, then proves it (seed 108, about 10 s).
You will see Drone-1 liquidate Player-4 at 10.6 s, Player-3 go red at 25.4 s and get out, and
Drone-1 liquidate Player-1 at 34.5 s. The last three lines are the proof (they are the same on every
run, and change only if the rules change):

```
vault: lent 916.7, repaid 916.7, interest 4.8, fees 6.9 · reserve 10.8
hash chain: 343 events, head 5dfd176e111ab055...
5880 ticks · 0 micro-units created or destroyed · settle == live ✓ · 10.1 s
```

`npm install` takes about a minute. npm 11 may warn that some install scripts were skipped, and
`npm audit` lists 27 findings: **0 high or critical**, 20 low and 7 moderate. They sit in build tooling
(`vite-plugin-pwa` and `workbox-build`: glob, minimatch, deepmerge), in Colyseus modules MARGIN does
not use (`@colyseus/auth` and `@colyseus/playground`: grant, uuid, elliptic), and in near-js's secp256k1
path (MARGIN keys are ed25519). Every fix npm offers is a major version change, so none is applied.
Everything below still runs.

To play in a browser:

```
npm run dev          # game server on :2567, client on :1234
```

Open http://localhost:1234 and press **Practice free**.

Ports busy? Run the two halves yourself, in two terminals:
`PORT=3567 npm run dev -w @margin/server` (game server) and
`VITE_SERVER_URL=http://localhost:3567 npm run dev -w @margin/client -- --port 3234` (client, pointed at it).

Free rooms need no wallet: you get guest credits and
the room fills with labelled AI agents (🤖).

### 2. Do X, see Y

| # | Do | See |
|---|---|---|
| 1 | `npm run demo` | A narrated paid match: BOOSTs (loans), two players liquidated by Drone-1 (10.6 s and 34.5 s), one player going red and getting out, payouts and the drones' bounties, then `0 micro-units created or destroyed` and `settle == live` |
| 1b | `npm run e2e:local` | The strongest end-to-end proof: boots the real game server with a fresh database, two network clients play a full free match, then it checks the match settled, the credit ledger is exact for both players, and replaying the served log gives exactly the stored payouts. Ends with `E2E OK` (about 35 s). On the way it prints one expected error, `you are already in this match`: that is the test proving the server refuses a second seat for the same player |
| 2 | `npm run sim -- --matches 500` | 500 full matches (2,940,000 ticks, about 213,000 logged money events) with the conservation check every tick, every hash chain verified, `0 micro-units created or destroyed` and `settle == live in 500/500` (1 to 3 minutes) |
| 3 | `npm test` | The whole TypeScript suite passes: 200 tests in 42 files (engine, settle, bots, server, client logic), about 15 s |
| 4 | `cd contracts/margin && cargo test` | 38 contract unit tests and 3 near-sandbox integration tests pass. Slow: about 7 minutes, most of it downloading and running near-sandbox |
| 5 | `npm run dev`, open http://localhost:1234, press **Practice free** | A 90 s match: steer with the mouse, hold Space = BOOST (borrow, like nitro: the fuel ring empties as you borrow), R = REPAY, E = cash out. Watch your ring go green, yellow, red |
| 6 | Hold BOOST until the fuel ring is empty, then run into a big spike | Your ring turns red. Within a moment a blob or a drone touches you: "LIQUIDATED", and your receipt shows what the vault took back |
| 7 | After any match, open the receipt's Verify link (`/#/verify/<id>`) | The browser replays the log with the same code as the server, checks every hash, and shows settle == what you were paid. Press "Tamper" and the exact broken event turns red |
| 8 | Open `/#/judge` | Judge Run: a published seed (20261114), normal rules, Drone-1 hunting red blobs. Most first-timers get greedy |
| 9 | `npm run sweep -- 300` | The balance table behind the rules, for the shipped settings: a greedy player holds BOOST to the cap in every match. Measured: 0.76 to 0.98 liquidations per match, the greedy player popped in 50% (practised) to 76% (first-timer) of matches. A few minutes |
| 9b | `npx tsx tools/sim/human.ts 60` | Can a newcomer win? A careful never-BOOST newcomer bot against 11 agents: measured median rank 4 of 12, top 3 in about 45%, survives about 70% |
| 9c | `npx tsx tools/sim/contacts.ts 40` | Do players meet on the big map? Rooms of 12 agents and no human: about 14 contacts per minute, a typical player's first contact at about 3 s. Liquidations here are rare (about 0.1 per match) because agents borrow carefully: greed is what brings liquidations (row 9) |
| 10 | `npm run soak -- --rooms 50` | 50 rooms of 12 on the real server for one full match (about 100 s at any room count): CPU per room tick and match length under load. Measured 0.17 ms per room tick at 50 rooms and 0.23 ms at 10 (budget 4 ms), every match 90 s |
| 11 | Put `NEAR_AI_API_KEY` in `.env`, then `npm run commander` (without a key it prints one line saying so and exits normally) | One live match with the AI commander on NEAR AI Cloud. Each new plan prints with its one-line rationale |

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
| BOOST = loan (hold-to-nitro), interest, REPAY, health factor, liquidation | `packages/core/src/economy.ts` | `economy.test.ts` (the RULES worked example, exact) |
| Fixed tick order (pops before eats, red eats nothing) | `packages/core/src/step.ts` | `step.test.ts` |
| Conservation every tick | `packages/core/src/invariant.ts` | `invariant.test.ts` (20 seeds × 10k ticks), `npm run sim` |
| Hash-chained log | `packages/core/src/log.ts` | `settle.test.ts` (tamper cases) |
| One pure settle, refuses forged logs | `packages/core/src/settle.ts` | `settle.test.ts` (forgeries a live room cannot produce) |
| Micro-units to USDC settle args | `packages/core/src/settleargs.ts` | `settleargs.test.ts` (contract equality on 10 paid matches) |
| Merkle anchor + proofs | `packages/core/src/merkle.ts`, `apps/server/src/anchor/job.ts` | `merkle.test.ts`, `job.test.ts` |
| Judge Run scenario | `packages/core/src/scenario.ts` | `scenario.test.ts` |
| Agent players (potential-field bot, AGENT_SKILL difficulty) | `apps/server/src/agents/freebot.ts` | `freebot.test.ts`, `tools/sim/human.ts` |
| Liquidator drones | `apps/server/src/agents/drone.ts` | `drone.test.ts` |
| AI commander (NEAR AI Cloud) | `apps/server/src/agents/commander.ts` | `commander.test.ts`, `npm run commander` |
| Rooms, lobby, late join, paid join proof | `apps/server/src/rooms/` | `lobby.test.ts`, `paidMatch.test.ts`, `guard.test.ts` |
| Settlement (credits or NEAR) | `apps/server/src/settlement/` | `credits.test.ts`, `toSettleArgs.test.ts` |
| Read API (logs, proofs, leaderboard, stats) | `apps/server/src/api.ts` | `api.test.ts` |
| Browser client, HUD, Verify page | `apps/client/src/` | `checks.test.ts`, `logic.test.ts`, `interp.test.ts` |
| Contract | `contracts/margin/src/` | `cargo test` |
| Headless demo, sim, sweep, soak, balance, encounter and newcomer checks | `tools/sim/` | the commands above |

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
tools/sim         demo, sim, sweep, soak, balance/contacts/human checks, client fixture
tools/scripts     deploy, keys, testnet end-to-end money loop
ops               server deploy files
```

### 8. Credits and AI-generated code

Third-party code and assets with their licences: `docs/CREDITS.md`. Most code in this repo was
written with AI coding agents (Claude Code) under human direction, review and testing.
