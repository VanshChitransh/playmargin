# MARGIN architecture

MARGIN is a real-time arena: BOOST is a loan from a vault, getting greedy gets you liquidated, and
every match is provable on NEAR. This page covers how the parts fit, how a match runs, where money
moves, and what each party can and cannot do. Every claim points at code you can read.

## Components

```mermaid
flowchart LR
  subgraph Browser
    C[Client PWA<br/>apps/client<br/>PixiJS + Colyseus SDK]
    K[Quick-play session key<br/>enter_arena only]
  end
  subgraph Droplet["Droplet (ops/)"]
    CAD[Caddy TLS<br/>api.playmargin.fun]
    S[Game server<br/>apps/server<br/>Colyseus rooms, 60 Hz]
    DB[(SQLite<br/>credits, logs, anchors)]
    R[Relayer<br/>services/relayer<br/>NEP-366 gas payer]
  end
  CORE[packages/core<br/>pure deterministic rules<br/>step, settle, log, merkle]
  AI[NEAR AI Cloud<br/>agent Commander]
  OC[1-Click / Intents<br/>Add funds]
  subgraph NEAR
    CT[margin contract<br/>contracts/margin<br/>balances, tickets, vault, reserve, anchors]
    USDC[USDC NEP-141]
  end
  C -- WebSocket game + HTTPS API --> CAD --> S
  C -- signed enter_arena --> CAD -- /relay/* --> R --> CT
  K -. signs .-> C
  S --> CORE
  C --> CORE
  S --> DB
  S -- settler: open_match, settle, refund_ticket, anchor --> CT
  S -- room summary, ids and numbers only --> AI
  R -- quotes --> OC -- deposit --> USDC --> CT
```

The same `packages/core` code runs the match on the server, replays it on the Verify page in the
browser, and powers `npm run demo` and `npm run sim`.

## Game server and ops (S2)

### Rooms
- `match`: public, grouped by `mode` (`free` or `paid`).
- `private`: grouped by `mode` plus a 4-letter code.
- `judge`: one human against the published Judge Run scenario (`JUDGE_SEED`).

All three share one class, `apps/server/src/rooms/MatchRoom.ts`. It is a thin shell around core: it
handles sockets, timers, credits, the log, and settlement.

### Match lifecycle

```mermaid
stateDiagram-v2
  [*] --> WARMUP: first join
  WARMUP --> COUNTDOWN: free after 8 s, paid with 2+ humans
  WARMUP --> [*]: paid room never reached 2 humans (nobody charged)
  COUNTDOWN --> LIVE: GO (paid waits for open_match on chain)
  COUNTDOWN --> ABORTED: open_match failed, every ticket refunded
  LIVE --> ENDED: 90 s bell
  ENDED --> SETTLED: settleVerified(log) == live world, then pay
  ENDED --> REFUSED: any mismatch, nobody is paid
```

1. **WARMUP** is the lobby. Blobs are ghosts and nothing is charged. Leaving is free.
2. **COUNTDOWN** (3-2-1) locks the room.
   - Free rooms fill the empty seats with labelled agents (`Agent-N 🤖`).
   - Paid rooms add `min(3, ceil(humans/3))` labelled liquidator drones.
   - Paid rooms call `open_match` now. That binds each player's ticket and reserves the vault budget.
   - The paid roster is final from here: a player who leaves stays in the match.
3. **GO / LIVE**: the server charges entry and core respawns everyone at seeded, evenly spaced
   points.
   - Every tick runs the same steps: inputs in, agent brains, `step()`, then events out.
   - Free rooms accept late joins for 15 s.
   - The log is saved every 5 s.
4. **ENDED**: core replays the whole hash-chained log (`settleVerified`). Every payout must equal
   the live world exactly, otherwise the match is marked `refused` and nobody is paid.
5. **SETTLED**:
   - Free rooms credit the ledger.
   - Paid rooms call `settle` on the contract, with the log head inside the transaction.
   - Free match heads go into an hourly Merkle root, anchored with `anchor("free", hour, root)`.

A disconnected blob stays in the arena: its input expires after 250 ms and it can still be popped.
The player can reconnect until the match ends. On a deploy the server drains: new rooms are refused,
LIVE matches finish and settle first, and systemd waits up to 120 s.

### Money flow

| Mode | Where value lives | In | Out |
|---|---|---|---|
| Free | `credits_ledger` in SQLite (append-only, enforced by triggers) | daily top-up to 1,000 credits | entry 100 at GO, payout at settle |
| Paid | the contract (USDC base units) | deposit (USDC or 1-Click) becomes the idle balance, then `enter_arena` turns it into a ticket of `entry_stake` (contract config: 1 USDC, or 0.10 USDC on a lean launch) | `settle` pays the match's players, repays the vault and adds the reserve share |

- **Units.** All game money is integer Micro: 1 unit is 1,000,000 Micro, and 1 USDC is 100 units.
  Percentages are basis points.
- **Rounding.** `toSettleArgs` (`apps/server/src/settlement/toSettleArgs.ts`) rounds every amount
  down to USDC base units, and the reserve takes the remainder. The contract's exact conservation
  check therefore always holds. This is tested on 2,000 random splits.
- **Bad debt.** It is capped at 10% of the match budget. Anything above that is repaid to the vault
  out of the largest payouts.
- **Drone bounties.** Each drone settles to its registered account `drone-N.<contract>` once `is_agent` is true (otherwise the bounty goes to the reserve). The drones' total is clamped to 12% of the stakes, the contract's cap, with any excess to the reserve.
- **No survivors.** If nobody survives, the leftover pot goes to the vault.

### Trust boundaries

| Party | Can | Cannot (enforced by) |
|---|---|---|
| Player (browser) | send inputs (dir, BOOST, REPAY, cash out) | change rules or positions: `parseInput` validates every message, 30 a second per player, and the server is authoritative |
| Player (paid join) | join a paid room with its own ticket | play someone else's ticket. The NEP-413 signature over `margin-join:paid:<account>` must come from a key of that account scoped to the contract. Nonces are single-use within 60 s. One live room per account (`paidMatch.ts`) |
| Session key | `enter_arena` only | withdraw: `withdraw` needs 1 yoctoNEAR, which a function-call key cannot attach |
| Game server (settler key) | `open_match`, `settle`, `refund_ticket`, `anchor` | create money (exact conservation), pay anyone outside the match except owner-registered drone accounts (at most 12% of the stakes), overspend the reserved budget or the 10% bad debt cap, settle twice, roll an anchor back (seq must grow), touch idle balances or the vault (owner only) |
| Game server (outcomes) | run the simulation | hide what happened: the full hash-chained log is public (`GET /api/matches/:id/log`). Anyone can replay it with core on `/verify` and compare the head with the settle transaction or the Merkle proof (`/api/matches/:id/proof`) |
| Relayer | pay gas for allow-listed calls, fund new email-login accounts (daily cap) | sign for players. It only wraps a gas-capped, zero-deposit `enter_arena` signed by the player (`services/relayer/validate.ts`) |
| NEAR AI Commander | retune agent personalities (greed, caution, drone focus) | move a blob or touch money: it gets only ids and numbers, and its output is parsed and clamped (`apps/server/src/agents/commander.ts`) |
| Operator | run the droplet, withdraw from the vault and reserve as owner | block refunds: players `reclaim()` their stake 15 min after a match opens if it never settles |
| Owner key (`vanshverse.near`) | withdraw vault and reserve, rotate settler, change owner or entry stake | act from a dApp login key: every owner method needs 1 yoctoNEAR, which a function-call key cannot attach. Drain the reserve under open matches: `reserve_withdraw` keeps 10% of locked budget |
| Contract account key | upgrade the code (`UPGRADE=1`, or `MIGRATE=1` with `migrate()`) | lose balances on upgrade: state is kept, layout changes go through a versioned `migrate` |
| Email login (NEAR Auth) | sign as the player through Auth0 + MPC | make the relayer pay for arbitrary txs: `/fastauth/sign` only relays txs to our contract, USDC or the player's own account (borsh check in `services/relayer/fastauth.ts`), with per-IP and daily limits |
| Anyone | call views, deposit USDC for themselves or another account | call any settler or owner method, or push dust: deposits under 0.1 USDC are refunded |

Server abuse limits:
- 12 joins a minute per IP.
- 30 `/api/credits` calls a minute per IP.
- `MAX_ROOMS` live rooms (default 100).
- Caddy sets the client IP header, so a client cannot spoof it.

### Read API
| Route | Returns |
|---|---|
| `GET /health` | network, contract, rooms, memory, tick timings (503 while draining) |
| `GET /api/matches/:id/log` | `{log, anchorHead, tx, network, status}` for the Verify page |
| `GET /api/matches/:id/proof` | paid: settle tx. free: Merkle proof to the hourly anchor |
| `GET /api/leaderboard` | NEAR accounts only, net result over the last 24 h, top 20 |
| `GET /api/stats` | users, players, settled matches, % with 2+ humans, liquidations by agents |
| `GET /api/credits?guestKey=` | free credits balance (applies the daily top-up) |

### Deploy and operations
One droplet runs Caddy, the game server and the relayer as systemd units. Both restart automatically,
logs are JSON lines, and the steps are in `ops/README.md`. A 50-match local soak gave a 60 Hz tick
p99 of 0.3 ms and peak memory of 227 MB. `npm run e2e:local` plays a full match against the real
server in CI.

## Core rules and agents (S1)

### One pure engine (`packages/core`)

The server, the browser (Verify page, offline practice) and every sim run the same code.
- **Deterministic.** Integer money (`Micro`, scaled with basis points, dust to the reserve), a seeded
  RNG carried in the world (`rng.ts`), and time measured in ticks (60 a second). No clock, no
  `Math.random`, no I/O.
- **Rules as data.** Every gameplay number is in `constants.ts`, mirrored from RULES.html, and
  `constants.test.ts` fails if it drifts from `rules.snapshot.json`.
- **Ports.** Bots, settlement and storage plug in through `ports.ts` (`Brain`, `Settlement`,
  `CreditsRepo`), so the core never imports the server.

### Tick order (`step.ts`)

Every tick runs the same 13 steps. The order is a rule, not an accident:

1. Store inputs and expire any held input older than 250 ms (a lost "release" can't keep borrowing).
2. Phase timers (LAST CALL at 75 s).
3. Held REPAY, then held BOOST (REPAY wins if both are held).
4. Move. The blob's centre stays at least 0.65 of its radius from every wall (`motion.ts`).
5. Interest, once per whole second.
6. Spikes. 7. Zone.
8. Ring: start or clear the 150 ms red grace clock.
9. Pops: a red blob touched after its grace is popped by the heaviest toucher, and the keeper closes
   any loan below HF 0.90.
10. Eats, heaviest eater first. Red blobs eat nothing, and agents may not eat a human in the first 30 s.
11. Cash-out channels.
12. The bell: survivors settle at equity, the ranking is taken, and the leftover pot is split.
13. Conservation check (`invariant.ts`).

### Money (`economy.ts`)

- **BOOST** borrows 1x your own money a second up to 2.5x leverage, with a 1% fee.
- **REPAY** clears the loan the hold started on in 0.8 s.
- **Interest** drains mass every second: 80% goes to food, 15% to the vault, 5% to the reserve.
- **Liquidation:** the vault is repaid first, the popper gets 8%, the reserve gets 2%, and the rest
  scatters as food.
- **Conservation is exact.** Every function moves Micro between blobs, the vault, fees, the reserve
  and the food pool. Nothing is minted: food only comes from the pot.
- **The log is the books.** A BOOST or REPAY hold is logged as one entry, on release, at payoff, at
  each interest second, and before any event that settle checks against the debt.

### Log and settle (`log.ts`, `settle.ts`)

- Every money event is appended to a SHA-256 hash-chained log.
- `settle(log)` replays only the log and checks every rule it can see:
  - every fee is exactly 1% and every interest split is 80/15/5;
  - no repayment is larger than the debt;
  - the vault never lends past its budget;
  - no agent eats a human early;
  - nothing happens after the bell.
- `settleVerified` also checks the chain. A match pays only if the replay equals the live room to the
  Micro (`settle == live`). Otherwise it is refused and nobody is paid.
- `settleargs.ts` converts the result to USDC base units for the contract's exact equality.
- Proof: `npm run sim -- --matches 500` shows 0 Micro leaked and `settle == live` in 500 of 500.
  `settle.test.ts` covers forged logs a live room cannot produce.

### Agents (`apps/server/src/agents`)

Every agent plays through the same `Brain.decide(view) -> InputCmd` port as a human's inputs. It
sees only what is near it (`AgentView`) and gets no rule a human does not have.

| Agent | Does | May not (enforced by) |
|---|---|---|
| FreeBot (`freebot.ts`), free rooms, labelled `Agent-N 🤖` | Steers with a potential field (port of MultiOgar's BotPlayer, Apache-2.0). Holds BOOST to chase or grow, holds REPAY when not green, cashes out from 70 s when ahead. One skill constant, `AGENT_SKILL` 0.6, so a careful newcomer can win (`tools/sim/human.ts`: median rank 4 of 12) | Eat a human in the first 30 s (engine and settle), or BOOST before 30 s (bot). It plays only in free rooms, for credits |
| Liquidator drone (`drone.ts`), paid rooms, labelled `Drone-N` | Steers by 32-slot context steering toward red blobs and the most leveraged one. Pops a blob only when it is red. Earns the victim-funded 8% bounty, paid on chain to `drone-N.<contract>` | Hold a stake, eat, be eaten, or touch a non-red blob: drones pass through those, and the engine ignores a drone's BOOST, REPAY and cash-out. The contract caps all agent payouts in one match at 12% of its stakes |
| Commander (`commander.ts`), NEAR AI Cloud | Every 15 s, one LLM call retunes the agents' greed, caution and drone focus. Its one-line rationale is shown to spectators | Move a blob or touch money. It sees only ids and numbers (no usernames, so no prompt injection through names). Its JSON is parsed and clamped, unknown ids are dropped, and a failed call keeps the last plan |

## Client (S3)
_To be written by S3: rendering, prediction and interpolation, screens, Verify page._

## Contract, relayer and Intents (S4)

Every NEAR feature with a testnet transaction proving it: [`docs/NEAR.md`](NEAR.md).

### Contract state (`contracts/margin`, near-sdk 5.30.1, about 199 KB)

| Field | Holds |
|---|---|
| `balances` | idle USDC per account (base units, 6 decimals). Empty rows are deleted |
| `tickets` | one live ticket per account: stake, `entered_at`, `match_id` once assigned |
| `matches` | players, stakes, reserved budget, status (Open, Settled, Cancelled), `opened_at`, seq and log head. Settled and cancelled matches keep no player list |
| `vault` | `free` (backs new matches) and `locked` (budgets of open matches) |
| `reserve` | house money (fees, dust). Pays bad debt first |
| `anchors` | the single `"free"` key: hourly Merkle root of free matches |
| `owner`, `settler`, `usdc`, `entry_stake` | config, readable with `config()` |

Invariant: USDC held by the contract = sum of balances + sum of tickets + vault.free +
vault.locked + reserve (+ withdrawals in flight). Every method keeps it, and money math is checked
(overflow panics).

### Ticket model

```mermaid
sequenceDiagram
  participant P as Player (session key)
  participant R as Relayer
  participant C as Contract
  participant S as Game server (settler)
  P->>R: signed delegate enter_arena(entry_stake)
  R->>C: relayed tx, relayer pays gas
  C-->>S: EVENT enter (read from the tx outcome)
  P->>S: join paid room with NEP-413 proof
  S->>C: open_match(id, players): reserve 1.5 x stakes from vault.free
  Note over S: 90 s match, BOOST loans come from the reserved budget
  S->>C: settle(id, payouts, lent, vault_repaid, interest, fees, reserve, seq, head)
  C-->>P: payout credited to idle balance
```

- `settle` runs once and needs exact equality: sum(payouts) + vault_repaid + interest_to_vault +
  fees + reserve == stakes + lent. Outstanding debt (lent minus repaid) must fit the budget, so the
  budget revolves within a match. Bad debt is at most 10% of the budget and comes from the reserve.
  The vault always gets its full budget back plus interest and fees. With no survivor, the leftover
  pot rides in `interest_to_vault`.
- Escape hatch: `reclaim()` returns the stake 15 min after entering (or after `open_match`), and
  cancels a match the server never settled. `refund_ticket` lets the server refund no-shows early.

### Relayer policy (`services/relayer`)

| Route | Pays for | Refuses |
|---|---|---|
| `POST /relay` | a player's NEP-366 delegate | anything but one zero-deposit `enter_arena` to our contract, ed25519, gas at most 30 Tgas, more than one relay per account per 2 s |
| `POST /fastauth/create` | creating an email player's account, funded with 0.01 NEAR | names outside `<name>.testnet` or `<name>.near`, more than 1 per IP per minute or 200 a day |
| `POST /fastauth/sign` | the MPC `sign` call for an email player's tx | txs to anything but our contract, USDC or the player's own account |
| `GET /tokens`, `POST /quote`, `GET /status` | nothing (1-Click proxy) | quotes without a valid account, known token, amount and refund address. 1 quote per second per account |
| `GET /health` | | reports the relayer's NEAR and raises `alarm` when it runs low |

### Add funds with 1-Click (NEAR Intents)

1. The client lists origin tokens (`GET /tokens`: USDC, USDT, ETH, SOL, NEAR, BTC on their chains).
2. `POST /quote` asks 1-Click for EXACT_INPUT into native USDC on NEAR, recipient = the contract,
   `customRecipientMsg = {"for": player}`, 1% slippage (the UI shows "at least" minAmountOut),
   refund to the player's origin address. The partner JWT never reaches the browser.
3. Live mode only (`ONECLICK_LIVE=1`, mainnet): the player sends to the quote's deposit address,
   the client polls `GET /status` (waiting, processing, done, refunded, failed). The solver's
   `ft_transfer_call` lands in `ft_on_transfer`, which credits the player from the msg.
4. Until mainnet, quotes are dry (real prices, no deposit address). Intents has no testnet.
