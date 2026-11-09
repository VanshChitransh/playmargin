// `npm run sim -- --matches 500`: the published conservation number. Plays N full matches with
// real bots (free: 12 agents; paid: 6 players + 2 drones), and for each one checks the
// invariant every tick, the hash chain, and settle(log) == the live room to the Micro.
import { leakOf, settleVerified } from "@margin/core";
import { runMatch } from "./match";

const i = process.argv.indexOf("--matches");
const matches = Number(i >= 0 ? process.argv[i + 1] : 500);
if (!Number.isInteger(matches) || matches < 1) throw new Error("--matches must be a positive integer");

const t0 = performance.now();
let ticks = 0;
let events = 0;
const count: Record<string, number> = {};
for (let m = 1; m <= matches; m++) {
  const paid = m % 2 === 0;
  const { w, log, ticks: t } = await runMatch(paid ? { seed: m, mode: "paid", players: 6, drones: 2 } : { seed: m, mode: "free", players: 12, drones: 0 });
  const r = await settleVerified(log);
  const live = r.payouts.every((p) => w.blobs.get(p.id)?.payout === p.amount) && r.vaultRepaid === w.vault.repaid &&
    r.interestToVault === w.vault.interest && r.fees === w.fees && r.reserve === w.reserve && leakOf(w) === 0;
  if (!live) throw new Error(`match ${m}: settle != live`);
  ticks += t;
  events += log.length;
  for (const e of log) count[e.type] = (count[e.type] ?? 0) + 1;
  if (m % 50 === 0) process.stderr.write(`${m}/${matches} matches\n`);
}
const s = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`${matches} matches · ${ticks.toLocaleString("en-US")} ticks · ${events.toLocaleString("en-US")} logged money events`);
console.log(`boosts ${count.BOOST ?? 0} · repays ${count.REPAY ?? 0} · eats ${count.EAT ?? 0} · pops ${count.POP ?? 0} · keeper pops ${count.KEEPER_POP ?? 0} · cash-outs ${count.CASHOUT ?? 0}`);
console.log(`0 micro-units created or destroyed · every hash chain intact · settle == live in ${matches}/${matches} · ${s} s`);
