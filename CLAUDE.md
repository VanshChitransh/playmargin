# MARGIN repo brain

MARGIN: a real-time arena where BOOST is a loan from a vault, getting greedy gets you liquidated,
and every match settles on NEAR. Built for the NEAR Hackathon (deadline 14 Nov 2026, 23:59 UTC).

## Sources of truth (outside this repo, in `../research/margin/`)
- `RULES.html` wins on every gameplay and economy number. `packages/core/src/constants.ts` mirrors it.
- `hld-lld.html` (flows, contract, protocol), `EDGE-CASES.md` (fixes already decided),
  `code-research/BUILD-KIT.md` (what to reuse), `../DEVELOPMENT.md` (tasks, gates, timeline).
- `../BOARD.md`: shared status board. **Read it before each task and after each merge.** Append one
  line per event: `HH:MM [S#] START|DONE|ICR|BLOCKED ...`.

## Lanes (never edit files you don't own)
| Session | Owns |
|---|---|
| S1 Core | `packages/core/**`, `apps/server/src/agents/**`, `tools/sim/**` |
| S2 Server | `apps/server/**` (except `src/agents`), `ops/**` |
| S3 Client | `apps/client/**` (except `src/chain`) |
| S4 Chain | `contracts/**`, `services/relayer/**`, `tools/scripts/**`, `apps/client/src/chain/**` |

Shared contract files `packages/core/src/{constants,types,protocol,events,ports,abi}.ts` belong to S1.
Need a change? Write an `ICR` line on the board; S1 ships it as a tiny PR that merges first.

## Git
- Work only in your worktree (`../worktrees/<lane>`). One branch per task: `<lane>/<task-id>-<slug>`.
- Commit and push your own work without asking (build speed mode), then report it in one line.
  Conventional Commits, small, one logical change each, body says why, footer `Task: <id>`.
  **No `Co-Authored-By` or any AI attribution.**
- Merge = Rebase and merge (commit history is visible to judges).
- Never: force push, `git reset --hard`, `git clean`, `rm -rf`, deleting branches with unmerged work.
  If a rebase goes wrong: `git rebase --abort` and ask.

## Code conventions
- TypeScript strict, no `any`, named exports, ESM. Files under ~250 lines.
- **Money is integers**: every mass/debt/credit/USDC value is `Micro` (1 unit = 1,000,000).
  Percentages are basis points. Scale only with `mulBps(x, bps) = Math.floor(x * bps / 10_000)`.
  Rounding dust always goes to the reserve so conservation stays exact.
- `packages/core` is deterministic: no `Math.random`, no `Date.now`, no I/O. Time = `tick`.
- Comments explain why, never what. Every file starts with a 2 to 4 line header.
  Exported functions get a one-line JSDoc with units.
- **No em dashes or en dashes** anywhere (`npm run check:dashes` fails CI).
- Tests sit next to code (`x.test.ts`, Vitest). Rust: `cargo test` + near-sandbox.
  A task is done only when its "Done when" check ran green.
- Rust: near-sdk 5.30.1, `require!` with clear messages, `#[private]` on every callback, checked math.
- Money code (core economy, settle, contract): run the `money-auditor` agent before committing.

## Commands
```
npm install
npm run dev          # server :2567 + client :1234
npm run typecheck
npm test
npm run check:dashes
```
Secrets live in `.env` (see `.env.example`), never committed.
