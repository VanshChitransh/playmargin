# AGENTS.md: guide for AI reviewers

MARGIN is a real-time arena where BOOST is a loan from a vault. Paid matches settle on NEAR testnet. Free matches on the Mumbai server are sealed on NEAR once an hour as a Merkle root. US server matches are not anchored.
Full instructions: [README.md, Part 2](README.md#part-2-for-ai-screeners-and-anyone-who-wants-to-check).

## Requirements
Node 22.13 or newer (24 recommended, CI uses 24) and npm. Rust and near-sandbox only for the contract tests.

## Run in this order (no keys needed)

| Step | Command | Expected |
|---|---|---|
| 1 | `npm install` | Installs the workspace |
| 2 | `npm run demo` | About 10 s. Ends with `5880 ticks · 0 micro-units created or destroyed · settle == live ✓` |
| 3 | `npm test` | The TypeScript suite passes: 387 tests in 69 files (14 Nov 2026, 08:22 UTC) |
| 4 | `npm run proofs` | About 20 s. Ends `19 of 19 cited txs OK on chain`, read from NEAR testnet RPC |
| 5 | `npm run sim -- --matches 500` | `0 micro-units created or destroyed`, `settle == live in 500/500` |
| 6 | `npm run e2e:local` | Ends `E2E OK`. One expected `you are already in this match` line is the test of a refused second seat |
| 7 | `npx tsx tools/sim/judge.ts` | Judge Run path: LIQUIDATED by Drone-1 at 6.6 s. Sitting still keeps 91.86 |
| 8 | `cd contracts/margin && cargo test` | Unit tests and 3 near-sandbox tests pass, about 7 minutes |

## Live checks (browser)
- https://playmargin.fun on a laptop, press **Play free**.
- https://playmargin.fun/judges: claims checked live against NEAR and the engine.
- https://playmargin.fun/judge: a seeded Judge Run, the scripted spike is disclosed on screen.

## Invariants to check
- Money is conserved every tick: integer micro-units, nothing created or destroyed.
- The settlement computed from the hash-chained log equals the live result (`settle == live`).
- Session keys can only call `enter_arena`. They cannot withdraw.
- Verify proves the log is consistent (hash chain, balanced books, settle equals live) and unchanged after its anchor. It does not prove the server played honestly before the anchor.

## What needs keys or cannot be checked from a clone
- `npm run commander` needs `NEAR_AI_API_KEY`. Without it, it says so and exits.
- Settling paid matches on chain needs the settler key, held only on the server.
- The 1-Click deposit is a DRY RUN on testnet: a real quote, no money moves.
- Testnet USDC is our own mock token with an open faucet.
- Network: NEAR testnet only. Mainnet is future scope.
