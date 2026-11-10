// `npx tsx tools/sim/judge.ts`: what happens to a judge in the Judge Run, per play style. Same
// lineup, seed, layout and brains as the server's judge room (MatchRoom: JUDGE_SEED, judgeLineup,
// applyJudgeLayout, createBrain). Prints each style's fate: survived (and payout), eaten by whom,
// or liquidated by whom, and when.
import {
  JUDGE_SEED, R, appendLog, applyJudgeLayout, equity, judgeLineup, newWorld, outweighs, radius, ring, startMatch, step,
  type AgentView, type InputCmd, type LogEntry,
} from "@margin/core";
import { agentView, createBrain } from "../../apps/server/src/agents/index";

type Style = (v: AgentView, tick: number) => InputCmd;
const cmd = (tick: number, dx: number, dy: number, boost = false, repay = false): InputCmd => {
  const l = Math.hypot(dx, dy) || 1;
  return { seq: tick, dirX: dx / l, dirY: dy / l, boost, repay, cashout: false };
};
const nearestFood = (v: AgentView): [number, number] => {
  const f = [...v.food].sort((a, b) => Math.hypot(a.x - v.self.x, a.y - v.self.y) - Math.hypot(b.x - v.self.x, b.y - v.self.y))[0];
  return f ? [f.x - v.self.x, f.y - v.self.y] : [0, 0];
};
const flee = (v: AgentView): [number, number] => {
  let dx = 0, dy = 0;
  for (const o of v.others) {
    if (o.kind === "drone" || !outweighs(o, v.self)) continue;
    const d = Math.hypot(o.x - v.self.x, o.y - v.self.y) - radius(o.mass) - radius(v.self.mass);
    if (d < 250) (dx -= (o.x - v.self.x) / (d + 1)), (dy -= (o.y - v.self.y) / (d + 1));
  }
  return [dx, dy];
};
const styles: Record<string, Style> = {
  "passive (never moves)": (v, t) => cmd(t, 0, 0),
  "passive eater (food only, no BOOST)": (v, t) => { const [fx, fy] = flee(v); return fx || fy ? cmd(t, fx, fy) : cmd(t, ...nearestFood(v)); },
  "greedy (holds BOOST whenever it can)": (v, t) => cmd(t, ...nearestFood(v), true),
  "greedy, REPAYs when red": (v, t) => cmd(t, ...nearestFood(v), ring(v.self) === "green", ring(v.self) === "red"),
  "random (wanders, taps BOOST)": (v, t) => cmd(t, Math.cos(t / 90), Math.sin(t / 70), t % 300 < 40),
};

for (const [name, style] of Object.entries(styles)) {
  const w = newWorld(JUDGE_SEED, "free", judgeLineup({ id: "you", kind: "human", label: "Judge", accountId: null }), "judge-sim");
  const brains = new Map([...w.blobs.values()].flatMap((b) => { const br = createBrain(b, JUDGE_SEED); return br ? [[b.id, br] as const] : []; }));
  const log: LogEntry[] = [];
  const warm = R.WARMUP_S * R.TICK_HZ;
  let peakLev = 1;
  for (let tick = 1; w.phase !== "ENDED"; tick++) {
    const inputs = new Map<string, InputCmd>();
    for (const [id, br] of brains) { const v = agentView(w, id); if (v) inputs.set(id, br.decide(v, tick)); }
    const me = agentView(w, "you");
    if (me) inputs.set("you", style(me, tick));
    if (tick === warm) (startMatch(w, tick), applyJudgeLayout(w, "you"));
    else step(w, inputs, tick);
    const you = w.blobs.get("you")!;
    if (you.state === "alive" && equity(you) > 0) peakLev = Math.max(peakLev, you.mass / equity(you));
    await appendLog(log, w.pendingLog.splice(0));
  }
  const you = w.blobs.get("you")!;
  const label = (id: string) => w.blobs.get(id)?.label ?? id;
  const end = log.find((e) => (e.type === "EAT" || e.type === "POP" || e.type === "KEEPER_POP") && (e.data as { victim: string }).victim === "you");
  const atS = end ? +((end.tick - w.goTick) / R.TICK_HZ).toFixed(1) : null;
  const fate = !end ? `${you.state} at the bell, payout ${(you.payout / 1e6).toFixed(2)}` : end.type === "EAT" ? `EATEN by ${label((end.data as { by: string }).by)}` : end.type === "POP" ? `LIQUIDATED by ${label((end.data as { by: string }).by)}` : "LIQUIDATED by the vault keeper";
  console.log(JSON.stringify({ style: name, fate, atS, peakLeverage: +peakLev.toFixed(2) }));
}
