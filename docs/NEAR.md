# NEAR in MARGIN

Every NEAR feature MARGIN uses, why it is there, where the code is, and a real testnet transaction
that proves it runs. Contract: [`playmargin.testnet`](https://testnet.nearblocks.io/address/playmargin.testnet).
MARGIN runs on NEAR testnet only, and every link here is testnet. A mainnet deploy is future scope (runbook: `tools/scripts/MAINNET-RUNBOOK.md`). Testnet USDC is our own mock token (`usdc.playmargin.testnet`) with an open faucet.

Re-run the proofs yourself: `tools/scripts/e2e.ts` (deposit, ticket, settle, withdraw),
`tools/scripts/n8-paid.ts` (two players, two real matches, stolen key), `tools/scripts/session-probe.ts`.

## Money on chain

| Feature | Why MARGIN needs it | Code | Proof |
|---|---|---|---|
| **NEP-141 deposit (`ft_transfer_call` into `ft_on_transfer`)** | Player USDC sits in the contract, not in our wallet (the contract account still holds a full-access upgrade key today). Only the configured USDC is accepted, a bad msg or dust is refunded, `{"for": acc}` credits someone else (used by 1-Click) | `contracts/margin/src/deposit.rs` (`ft_on_transfer`), client `apps/client/src/chain/funds.ts` (`deposit`, `ft_transfer_call`) | [deposit](https://testnet.nearblocks.io/txns/4c7WhC12tjNXRmo2U3B7hgpGdf7kYifxdkQgNpuiAQKE), [deposit for another account](https://testnet.nearblocks.io/txns/4QEHL1yGjEfidAmSPWW5CL3ZPk4WtU8xkKYsKzhtLZzg) |
| **Ticket model** (`enter_arena`, `open_match`) | A paid entry locks the stake in a per-account ticket before the match, and `open_match` reserves the vault budget, so BOOST loans never wait for the chain | `contracts/margin/src/arena.rs` (`enter_arena`, `open_match`) | [open_match](https://testnet.nearblocks.io/txns/7eyphQU4y4j4yJM1ZR73RK3bFxyMqKViEPUKBsieNYiw) |
| **One exact settle per match, with the log head** | The game server is the only settler, but it cannot create money: payouts + vault repaid + interest + fees + reserve must equal stakes + lent exactly. It decides how a match's stakes split among the players it opened the match with (the contract checks the totals), bad debt is capped at 10% of the budget, and the match's hash-chain head is stored on chain for `/verify` | `contracts/margin/src/arena.rs` (`settle`: the exact books and bad-debt checks), server `apps/server/src/settlement/near.ts` (`NearSettlement.settle`) | real match [settle](https://testnet.nearblocks.io/txns/3Nw3RqiAfPmFYJ5LKxxXioEfppLhdEswXyTHhyZQABwA) (lent 2.87 against a 3.0 budget, all repaid, no survivor so the leftover went to the vault), [second match](https://testnet.nearblocks.io/txns/5EjnTupgYw8iqVshq4ng6sKJPCDFF61YGYthQSjBfCre) |
| **Withdraw with 1 yoctoNEAR + `#[private]` callback** | 1 yocto forces a full-access key, so a session key can never move money out. The balance is debited before the transfer, and `on_withdraw` (callable only by the contract itself) re-credits it if the transfer fails | `contracts/margin/src/withdraw.rs` (`withdraw`, callback `on_withdraw`) | [withdraw](https://testnet.nearblocks.io/txns/H7t24bbuy6KQsbydw2RaURyPYfuUiutpAWtzs4ufuCew), [failed transfer re-credited](https://testnet.nearblocks.io/txns/9QGkseAp4qo8wx3pxXTEYpEPqs9g7LFqgURzdJWMwhuE) (`withdraw_failed` event, balance unchanged) |
| **Reclaim (no server needed)** | If the server dies, a player takes the stake back 15 min after entering (or after the match opened). The server cannot block it. There is no button yet: call `reclaim` with near-cli | `contracts/margin/src/arena.rs` (`reclaim`) | [enter](https://testnet.nearblocks.io/txns/BUMextV78FK7nH7PP8m4VaUp9eL25mkwUD43Y8c3xyLa), [reclaim after 15 min](https://testnet.nearblocks.io/txns/7ZrF2rVJGq3VybmxuTaojzjebGiAAGha3M4DH4Yj1Etk) |
| **NEP-297 events** | The server reads `enter`, `settle`, `refund`, `withdraw_failed` from the tx outcome, so no indexer is needed | `contracts/margin/src/lib.rs` (`emit`, `EVENT_JSON`) | the `EVENT_JSON` logs in any tx above |
| **Anchors** | Free matches never touch the chain one by one: their heads go into an hourly Merkle root, one tx an hour. A seq that must grow means nothing can be rolled back | contract `contracts/margin/src/arena.rs` (`anchor`), server `apps/server/src/anchor/job.ts` (`anchorPending`) | [hourly root](https://testnet.nearblocks.io/txns/B87qTFs8NSDUuAkhD1TUyCnBuKR7Z9abR8j1CVjcgNeY) |
| **Upgrade with `#[init(ignore_state)]` migrate** | New code without losing balances: the entry stake became contract state through a migration | `contracts/margin/src/lib.rs` (`migrate`) | [deploy + migrate](https://testnet.nearblocks.io/txns/97nmCiQ46o2S8hkHQt6e56Uj2Jt4iq69h36w4hLp8y2w) |

## Keys, signatures and gas

| Feature | Why MARGIN needs it | Code | Proof |
|---|---|---|---|
| **Function-call access key (session key)** | "Quick play": one wallet approval adds a key that can ONLY call `enter_arena` on our contract. After that, PLAY needs no pop-up | `apps/client/src/chain/session.ts` (`enableQuickPlay`) | [AddKey](https://testnet.nearblocks.io/txns/F3GzT78QTH1RkLCwpM89JjFsgdfZAGt9hNqbC365Cug8) |
| **NEP-366 meta-transactions + our relayer** | The player signs a delegate with the session key, our relayer pays the gas. The relayer only wraps a zero-deposit, gas-capped `enter_arena` to our contract | client `apps/client/src/chain/session.ts` (`enterArena`), relayer `services/relayer/server.ts` (`relay`), allow-list `services/relayer/validate.ts` (`refuseReason`) | relayed tickets: [player 1](https://testnet.nearblocks.io/txns/6ZSeFrGuuHC6Y6G6swxtpLodk9gjZUJk6cqhmdR2Tn4P), [player 2](https://testnet.nearblocks.io/txns/9jAz6gordC9Unr4rgaKzjhirYUsj4ET87QNzsXyFcK1g) |
| **Session key signs NEP-366 without spending its allowance** | We tested it first (N7): the 0.05 NEAR allowance is unchanged after relaying, so a session key never runs dry | `tools/scripts/session-probe.ts` | [probe](https://testnet.nearblocks.io/txns/4LHK1ghPTjAh4csB7aioQAErTJAKaHuu46KPHMM4UYb7) |
| **NEP-413 signed join** | A paid room seat must belong to the account that owns the ticket. The session key signs `margin-join:paid:<account>` (recipient = contract, one-use 60 s nonce). The server verifies the signature and that the key is on that account and scoped to our contract | client `apps/client/src/chain/join.ts` (`signJoin`), server `apps/server/src/rooms/paidMatch.ts` (`verifyJoin`, including the key scope check) | off-chain by design (no tx). Exercised in every [n8 run](../tools/scripts/n8-paid.ts) |
| **House AI drones as registered accounts** | Liquidator drones earn a bounty from the player they pop. Instead of hiding that in the house reserve, each drone is its own sub-account (`drone-1..3.playmargin.testnet`), registered by the owner with `set_agents` (1 yocto, `agents_changed` event). Settle may pay a registered agent, and the contract caps all agent payouts in one match at 12% of its stakes, so a leaked settler key cannot route more to house accounts. Anyone can audit the house AI's P&L on chain | contract `contracts/margin/src/lib.rs` (`set_agents`, `is_agent`), cap `contracts/margin/src/arena.rs` (`settle`, with `AGENT_PAYOUT_MAX_BPS` from `lib.rs`), server `apps/server/src/settlement/toSettleArgs.ts` (`toSettleArgs`), `apps/server/src/rooms/MatchRoom.ts` (`droneAccounts`), script `tools/scripts/drones.ts` | [set_agents](https://testnet.nearblocks.io/txns/4eH66oURfLpz9FXafY8Y7QWb3LpRx6kQCwq46yghdgy2), real paid match: [drone-1 paid 0.092521 USDC](https://testnet.nearblocks.io/txns/8nDTHu1ZmeW19fSEaa9LoXtrUtdSsEALwVJWdNfpuWwf) (4.6% of 2 USDC stakes), [second match 0.091284](https://testnet.nearblocks.io/txns/41tkSWiySoUYk1kJ3eJrpBtVMJDdTMbxzDipBnwfBHnf), [drone-1 account](https://testnet.nearblocks.io/address/drone-1.playmargin.testnet) |
| **Named sub-accounts** | Each role is its own account with its own key and nonce: `settler.`, `relayer.`, `usdc.`, `owner.playmargin.testnet`, test players. The settler and relayer never collide on nonces | `tools/scripts/keys.ts` | [sub-account created](https://testnet.nearblocks.io/txns/FPim5FK6GosZ8ftPPFTMWKycdkTUibnAZZiQdJT1RhLK) |

### Stolen session key cannot withdraw

`tools/scripts/n8-paid.ts` takes a real player's session key and tries to drain the account:

| Attempt | Result |
|---|---|
| `withdraw` with 1 yocto attached | refused by the protocol: `InvalidAccessKeyError: DepositWithFunctionCall` (a function-call key cannot attach any deposit) |
| `withdraw` without a deposit | refused by the protocol: `InvalidAccessKeyError: MethodNameMismatch` (the key only allows `enter_arena`) |
| `withdraw` wrapped as a NEP-366 delegate to our relayer | relayer answers HTTP 400 (allow-list) |
| balance afterwards | unchanged |

A stolen session key cannot withdraw. It can still buy tickets and sign paid joins for its owner, so it can spend the owner's balance on paid matches.

## Intents and AI

| Feature | Why MARGIN needs it | Code | Proof |
|---|---|---|---|
| **NEAR Intents 1-Click (Add funds)** | Players top up from any chain (USDC on Base, ETH, SOL, BTC...). The quote lands as native USDC on NEAR straight into the contract with `customRecipientMsg {"for": player}`, so it is credited to the player in the same flow. Our partner JWT stays on the relayer | relayer `services/relayer/oneclick.ts` (`quoteRequest`), client `apps/client/src/chain/addfunds.ts` (`quoteDeposit`) | DRY RUN quotes only on testnet (Intents has no testnet): 2 USDC on Base quotes 1.995 USDC out, at least 1.975, about 35 s |
| **NEAR AI Cloud commander** | One LLM call retunes all agents in a free room (greed, caution, drone focus). It never touches money or positions: its output is parsed and clamped | `apps/server/src/agents/commander.ts` (`ORDER_SCHEMA`, `nearAiCall`, `parsePlan`), room `apps/server/src/rooms/MatchRoom.ts` (`commander`) | `apps/server/scripts/smoke-commander.ts` (off-chain inference, no tx) |
| **NEAR Auth (email login)** | Players without a wallet log in with email. The account key is an MPC key, the relayer creates the account and pays the MPC `sign` calls, and only for txs to our contract, USDC or the account itself | `apps/client/src/chain/email.ts`, relayer `services/relayer/fastauth.ts` (`signError`), `services/relayer/server.ts` (`fastauthCreate`, `fastauthSign`) | behind `VITE_NEAR_AUTH=1`, waiting on NEAR's mainnet approval of our Auth0 app |

## Planned, not built yet

- **Free-room agent accounts.** Free-room agent players (named bots such as `Greedy Gus 🤖`) play for credits and have no NEAR account. The paid-room drones already have theirs (above).
- **Mainnet.** Same contract and scripts, deployed by following the runbook. Every mainnet transaction is approved by hand.
