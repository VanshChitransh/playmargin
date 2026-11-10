// `npm run demo`: one full match with real bots and drones, narrated, then proved.
// No keys, no network: it plays at 10x speed (--fast for full speed), verifies the hash chain,
// settles from the log alone and checks that settle == the live room to the Micro.
import { leakOf, ring, settleVerified, toUnits, type LogEntry, type Ring, type World } from "@margin/core";
import { runMatch } from "./match";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fast = args.includes("--fast");
// A seed where the drones get to work: chosen by scanning seeds for at least one drone pop.
const seed = Number(flag("seed") ?? 109);

const n = (m: number): string => toUnits(m).toFixed(1);
const label = (w: World, id: string): string => w.blobs.get(id)?.label ?? id;
const rings = new Map<string, Ring>();
let lines = 0;

function say(w: World, tick: number, text: string): void {
  const t = ((tick - w.goTick) / 60).toFixed(1).padStart(5);
  console.log(`t=${t}s  ${text}`);
  lines++;
}

function narrate(w: World, e: LogEntry): void {
  const d = e.data as Record<string, number & string>;
  switch (e.type) {
    case "BOOST": {
      // A BOOST hold is logged when it ends. Going red ends it (red can't borrow), so a hold that
      // closes on a red blob was borrowed before the hit: say so, it is not a red blob borrowing.
      const b = w.blobs.get(d.blob);
      const late = b && b.state === "alive" && ring(b) === "red" ? " (borrowed before going red, the hold just closed)" : "";
      return say(w, e.tick, `${label(w, d.blob)} BOOST +${n(d.borrowed)} (owe ${n(b?.debt ?? 0)}, fee ${n(d.fee)})${late}`);
    }
    case "REPAY":
      if (w.blobs.get(d.blob)?.state === "cashed") return; // a cash-out repays its loan: the CASHOUT line says it
      return say(w, e.tick, `${label(w, d.blob)} REPAY -${n(d.amount)} (owe ${n(w.blobs.get(d.blob)?.debt ?? 0)})`);
    case "SPIKE":
      return say(w, e.tick, `${label(w, d.blob)} hit a spike: -${n(d.damage)}`);
    case "EAT":
      return say(w, e.tick, `${label(w, d.by)} ate ${label(w, d.victim)}: +${n(d.gained)}, ${n(d.scattered)} scatters${d.debtRepaid ? `, vault repaid ${n(d.debtRepaid)}` : ""}`);
    case "POP":
      return say(w, e.tick, `POP by ${label(w, d.by)} on ${label(w, d.victim)}: vault ${n(d.debtRepaid)}, bounty ${n(d.bounty)}, reserve ${n(d.fee)}, ${n(d.scattered)} scatters`);
    case "KEEPER_POP":
      return say(w, e.tick, `VAULT CLOSED ${label(w, d.victim)}'s LOAN: vault ${n(d.debtRepaid)}, reserve ${n(d.fee)}`);
    case "CASHOUT":
      if (e.tick < w.goTick + 90 * 60) say(w, e.tick, `${label(w, d.blob)} cashed out ${n(d.amount)}`);
      return;
    case "MATCH_START":
      return say(w, e.tick, `GO: ${w.blobs.size} in the arena, pot ${n(w.pot)}, vault budget ${n(w.vault.budget)}`);
  }
}

console.log(`MARGIN demo: one paid match, seed ${seed}, 6 bot-driven players + 2 liquidator drones (labelled)\n`);
const t0 = performance.now();
const { w, log, ticks } = await runMatch({
  seed, mode: "paid", players: 6, drones: 2,
  onTick: async (w, tick, events, logged) => {
    for (const e of logged) narrate(w, e);
    for (const ev of events) {
      if (ev.type === "lastCall") say(w, tick, "LAST CALL: BOOST closes in 5");
      if (ev.type === "clutchSave") say(w, tick, `${label(w, ev.blob)} REPAYS OUT OF RED${ev.clutch ? " (clutch: a hunter was close)" : ""}`);
    }
    for (const b of w.blobs.values()) {
      if (b.kind === "drone" || b.state !== "alive" || w.goTick < 0) continue;
      const r = ring(b);
      if (r === "red" && rings.get(b.id) !== "red") say(w, tick, `${b.label} is RED (owes ${n(b.debt)}, ${n(b.mass)} mass)`);
      rings.set(b.id, r);
    }
    if (!fast && tick % 60 === 0) await new Promise((ok) => setTimeout(ok, 100));
  },
});

console.log("\nResults");
for (const b of [...w.blobs.values()].sort((a, z) => z.payout - a.payout)) {
  // Drones hold no stake: what they leave with is the liquidation bounties they earned.
  const what = b.kind === "drone" ? "bounties" : b.state;
  console.log(`  ${b.label.padEnd(10)} ${what.padEnd(8)} ${n(b.payout).padStart(7)}`);
}
const r = await settleVerified(log);
const live = r.payouts.every((p) => w.blobs.get(p.id)?.payout === p.amount) &&
  r.vaultRepaid === w.vault.repaid && r.interestToVault === w.vault.interest && r.fees === w.fees && r.reserve === w.reserve;
console.log(`\nvault: lent ${n(r.lent)}, repaid ${n(r.vaultRepaid)}, interest ${n(r.interestToVault)}, fees ${n(r.fees)} · reserve ${n(r.reserve)}`);
console.log(`hash chain: ${log.length} events, head ${r.head.slice(0, 16)}...`);
console.log(`${ticks} ticks · ${leakOf(w)} micro-units created or destroyed · settle == live ${live ? "✓" : "✗"}`);
console.log(`(ran in ${((performance.now() - t0) / 1000).toFixed(1)} s, the only line that changes between runs)`);
if (!live || leakOf(w) !== 0) process.exit(1);
