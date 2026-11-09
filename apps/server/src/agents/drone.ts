// Paid-room liquidator drone. It holds no stake, passes through every non-red blob and only
// ever pops red ones (the engine enforces both), so its whole job is steering: 32-slot context
// steering (Fray, Game AI Pro 2 ch. 18; idea from Apostolique aposbot, MIT, rewritten) with
// interest toward red blobs, a vulture drift toward the most leveraged blob, and a pincer
// offset when another drone is already closer to the same target.
import { hfBps, R, radius, rand, ring, seedRng, type AgentView, type Blob, type Brain, type InputCmd } from "@margin/core";

const SLOTS = 32;
const DIRS = Array.from({ length: SLOTS }, (_, i) => ({ x: Math.cos((i / SLOTS) * 2 * Math.PI), y: Math.sin((i / SLOTS) * 2 * Math.PI) }));
const REACT_MIN_T = Math.round(0.2 * R.TICK_HZ);
const REACT_MAX_T = Math.round(0.4 * R.TICK_HZ);
/** Stand-off past a leveraged blob's edge: close enough to strike when it turns red. */
const VULTURE_GAP = 70;
const PINCER_OFFSET = 160;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

export class Drone implements Brain {
  private rng: { rngState: number };
  private nextAt = 0;
  private held = { x: 0, y: 0 };
  /** The blob this drone is going for, for the spectator label and tests. */
  target: string | null = null;

  constructor(seed: number) {
    this.rng = { rngState: seedRng(seed) };
  }

  decide(v: AgentView, tick: number): InputCmd {
    const cmd: InputCmd = { seq: tick, dirX: this.held.x, dirY: this.held.y, boost: false, repay: false, cashout: false };
    if (tick < this.nextAt) return cmd;
    this.nextAt = tick + REACT_MIN_T + Math.floor(rand(this.rng) * (REACT_MAX_T - REACT_MIN_T + 1));
    this.held = v.phase === "LIVE" ? this.steer(v) : { x: 0, y: 0 };
    return { ...cmd, dirX: this.held.x, dirY: this.held.y };
  }

  /** The point to head for: a red blob (pincer-adjusted), else stand off the weakest indebted blob. */
  private goal(v: AgentView): { x: number; y: number } | null {
    const me = v.self;
    const players = v.others.filter((o) => o.kind !== "drone" && o.state === "alive");
    const drones = v.others.filter((o) => o.kind === "drone");
    // Bounty is 8% of debt, so the best red target is the biggest debt per px of travel.
    const reds = players.filter((o) => ring(o) === "red").sort((a, b) => b.debt / (dist(b, me) + 50) - a.debt / (dist(a, me) + 50));
    const red = reds[0];
    if (red) {
      this.target = red.id;
      const rival = drones.find((d) => dist(d, red) < dist(me, red));
      if (!rival) return red;
      // Come in from the side the rival is not on, so the target can't escape straight away.
      const ax = red.x - rival.x;
      const ay = red.y - rival.y;
      const len = Math.hypot(ax, ay) || 1;
      const side = (me.x - red.x) * -ay + (me.y - red.y) * ax >= 0 ? 1 : -1;
      return { x: red.x + (-ay / len) * PINCER_OFFSET * side, y: red.y + (ax / len) * PINCER_OFFSET * side };
    }
    const weak = players.filter((o) => o.debt > 0).sort((a, b) => hfBps(a) - hfBps(b))[0] as Blob | undefined;
    this.target = weak?.id ?? null;
    if (!weak) return { x: v.zone.cx, y: v.zone.cy };
    const d = dist(me, weak) || 1;
    const gap = radius(weak.mass) + VULTURE_GAP;
    return { x: weak.x + ((me.x - weak.x) / d) * gap, y: weak.y + ((me.y - weak.y) / d) * gap };
  }

  private steer(v: AgentView): { x: number; y: number } {
    const g = this.goal(v);
    if (!g) return { x: 0, y: 0 };
    const dx = g.x - v.self.x;
    const dy = g.y - v.self.y;
    const len = Math.hypot(dx, dy);
    if (len < 8) return { x: 0, y: 0 };
    // Interest map: each slot scores how well it points at the goal; take the best slot.
    let best = 0;
    let bestScore = -Infinity;
    DIRS.forEach((d, i) => {
      const score = (d.x * dx + d.y * dy) / len;
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    return DIRS[best]!;
  }
}
