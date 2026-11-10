// `npx tsx tools/sim/newcomer.ts [matches] [variant]`: survival to the bell of a newcomer-style human
// (eats food, flees bigger blobs, holds BOOST a bit when nothing big is near, holds REPAY when not
// green) in a free room, plus the bell leftover split. Variants change one knob at a time:
// base | hot (worst-case commander: greed 1, caution 0) | skill=0.45 | agents=8 | noeat=45 | hider |
// late=S (joins S s after GO into 12 agents, as the server fills them) | lateold=S (same, but the
// no-eat window counted from GO, the rule before 10 Nov).
// Rule overrides are set on R before the agents load, so the engine and FreeBot both see them.
import { R } from "@margin/core";

const n = Number(process.argv[2] ?? 200);
const variant = process.argv[3] ?? "base";
const [knob, val] = variant.split("=");
if (knob === "noeat") (R as { AGENT_NO_EAT_HUMAN_S: number }).AGENT_NO_EAT_HUMAN_S = Number(val);

const { outweighs, radius, ring: ringOf, toUnits } = await import("@margin/core");
const { FreeBot } = await import("../../apps/server/src/agents/index");
const { runMatch } = await import("./match");
type View = Parameters<InstanceType<typeof FreeBot>["decide"]>[0];

/** A first match: eat, run from bigger blobs, BOOST in short bursts when the coast is clear. */
class Newcomer {
  private next = 0;
  private cmd = { dirX: 0, dirY: 0, boost: false, repay: false };
  constructor(private hider = false) {}
  decide(v: View, tick: number) {
    if (tick >= this.next) {
      this.next = tick + 15; // re-aims about 4 times a second
      const me = v.self;
      let dx = 0, dy = 0, threat = Infinity;
      for (const o of v.others) {
        if (o.kind === "drone" || !outweighs(o, me)) continue;
        const d = Math.hypot(o.x - me.x, o.y - me.y) - radius(o.mass) - radius(me.mass);
        threat = Math.min(threat, d);
        if (d < 250) (dx -= (o.x - me.x) / (d + 1)), (dy -= (o.y - me.y) / (d + 1));
      }
      if (dx === 0 && dy === 0 && !this.hider) {
        const f = [...v.food].sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
        if (f) [dx, dy] = [f.x - me.x, f.y - me.y];
      }
      const len = Math.hypot(dx, dy) || 1;
      const ring = ringOf(me);
      // BOOST about 1 s in every 6 s, only green and with nothing bigger within 500 px.
      const boost = !this.hider && ring === "green" && threat > 500 && tick % 360 < 60;
      this.cmd = { dirX: dx / len, dirY: dy / len, boost, repay: ring !== "green" && me.debt > 0 };
    }
    return { seq: tick, ...this.cmd, cashout: false };
  }
}

const late = knob === "late" || knob === "lateold";
const players = knob === "agents" ? Number(val) + 1 : late ? 12 : 12;
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
let survived = 0;
const deaths: number[] = [];
const humanEq: number[] = [];
const humanShare: number[] = [];
// Payout per match (0 when popped) under the current split and two caps on the bonus.
const ev = { now: 0, cap50: 0, cap25: 0 };
for (let m = 1; m <= n; m++) {
  const { w, log } = await runMatch({
    seed: 7000 + m, mode: "free", players, humans: late ? 0 : 1, drones: 0,
    lateJoin: late ? { seed: { id: "late-human", kind: "human", label: "Late", accountId: null }, afterGoS: Number(val), brain: new Newcomer() as never } : undefined,
    onTick: (w) => {
      const lh = w.blobs.get("late-human");
      if (knob === "lateold" && lh && lh.joinedAt !== 0) lh.joinedAt = 0; // old rule: the window counts from GO
    },
    brain: (b) => {
      if (b.kind === "human") return new Newcomer(knob === "hider") as never;
      if (knob === "hot") return new FreeBot(9000 + m + b.id.length * 31, { greed: 1, caution: 0, skill: 0.6 });
      if (knob === "skill") return new FreeBot(9000 + m + b.id.length * 31, { greed: 0.5, caution: 0.6, skill: Number(val) });
      return null;
    },
  });
  const h = [...w.blobs.values()].find((b) => b.kind === "human")!;
  const end = log.at(-1)!;
  if (h.state !== "popped") {
    survived++;
    const outs = log.filter((e) => e.type === "CASHOUT" && (e.data as { blob: string }).blob === h.id && e.tick === end.tick);
    const e = toUnits((outs[0]?.data as { amount: number } | undefined)?.amount ?? 0);
    const sh = toUnits((outs[1]?.data as { amount: number } | undefined)?.amount ?? 0);
    humanEq.push(e);
    humanShare.push(sh);
    ev.now += e + sh;
    ev.cap50 += e + Math.min(sh, e * 0.5);
    ev.cap25 += e + Math.min(sh, e * 0.25);
  } else {
    const d = log.find((e) => (e.type === "EAT" || e.type === "POP" || e.type === "KEEPER_POP") && (e.data as { victim: string }).victim === h.id);
    if (d) deaths.push(Math.round((d.tick - w.goTick) / R.TICK_HZ));
  }
}
console.log(JSON.stringify({
  variant, matches: n, survived: +(survived / n).toFixed(2), medianDeathS: med(deaths),
  diedBefore45s: +(deaths.filter((s) => s < 45).length / n).toFixed(2),
  survivorEquityAtBellMedian: +med(humanEq).toFixed(1), survivorLeftoverShareMedian: +med(humanShare).toFixed(1),
  meanPayoutPerMatch: { now: +(ev.now / n).toFixed(1), cap50: +(ev.cap50 / n).toFixed(1), cap25: +(ev.cap25 / n).toFixed(1) },
}));
