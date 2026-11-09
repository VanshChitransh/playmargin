// Free-room agent player. Steering is a port of MultiOgar's BotPlayer.decide() potential field
// (agarian-2/MultiOgar src/ai/BotPlayer.js L33-92, Apache-2.0, see docs/CREDITS.md): prey pulls,
// threats push by edge distance, food pulls, spikes push. On top, the MARGIN money habits a
// careful human would have: BOOST to chase, REPAY when not green, cash out when ahead.
import {
  equity, fuel, leverageBps, outweighs, R, radius, rand, randRange, ring, seedRng, sToTicks, type AgentView, type Blob, type Brain, type InputCmd,
} from "@margin/core";

/** How this bot plays; the commander (A6) may nudge these later. Values in 0..1. */
export interface Personality {
  /** Chance per decision to BOOST when prey is in reach. */
  greed: number;
  /** How much spikes repel it. */
  caution: number;
}

const REACT_MIN_T = Math.round(0.2 * R.TICK_HZ);
const REACT_MAX_T = Math.round(0.4 * R.TICK_HZ);
const CASHOUT_OPEN_T = sToTicks(R.CASHOUT_OPEN_S);
const CASHOUT_CLOSE_T = sToTicks(R.CASHOUT_CLOSE_S);
const CHASE_RANGE = 450;
/** Cash out once equity is up this much on the start mass (bps). */
const CASHOUT_GAIN_BPS = 13_000;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

export class FreeBot implements Brain {
  private rng: { rngState: number };
  private nextAt = 0;
  private held: { x: number; y: number } = { x: 0, y: 0 };
  /** BOOST is held from one decision to the next (200 to 400 ms of nitro), like a held key. */
  private boosting = false;
  private liveSince: number | null = null;
  private startEquity = 0;
  readonly personality: Personality;

  constructor(seed: number, personality?: Partial<Personality>) {
    this.rng = { rngState: seedRng(seed) };
    this.personality = {
      // A spread from careful to reckless, like a real lobby: some bots will get liquidated.
      greed: personality?.greed ?? randRange(this.rng, 0.2, 1),
      caution: personality?.caution ?? randRange(this.rng, 0.1, 1.2),
    };
  }

  /** Steer (and hold BOOST) every tick as last decided; think, and maybe tap, only every 200 to 400 ms. */
  decide(v: AgentView, tick: number): InputCmd {
    const cmd: InputCmd = { seq: tick, dirX: this.held.x, dirY: this.held.y, boost: this.boosting, repay: false, cashout: false };
    if (v.phase === "LIVE" && this.liveSince === null) {
      this.liveSince = tick;
      this.startEquity = equity(v.self);
    }
    if (tick < this.nextAt) return cmd;
    this.nextAt = tick + REACT_MIN_T + Math.floor(rand(this.rng) * (REACT_MAX_T - REACT_MIN_T + 1));

    const { dir, prey } = this.field(v, tick);
    this.held = dir;
    this.boosting = false;
    cmd.dirX = dir.x;
    cmd.dirY = dir.y;
    cmd.boost = false;
    if (v.phase !== "LIVE" || this.liveSince === null) return cmd;

    const me = v.self;
    const state = ring(me);
    const t = tick - this.liveSince;
    // Appetite: a greedy bot borrows to grow toward 1.3x to 2x leverage, like a player who
    // wants size early; anyone boosts to catch prey. Not green means deleverage, never double down.
    const appetiteBps = 10_000 + Math.round(this.personality.greed * 15_000);
    // Careful bots deleverage at once; reckless ones hesitate, as panicking humans do.
    if (state !== "green" && me.debt > 0 && rand(this.rng) < 0.3 + 0.6 * Math.min(1, this.personality.caution)) cmd.repay = true;
    else if (state === "green" && fuel(me) > 0 && (prey ? rand(this.rng) < this.personality.greed : leverageBps(me) < appetiteBps && rand(this.rng) < 0.25)) {
      this.boosting = cmd.boost = true;
    }
    const ahead = equity(me) * 10_000 >= this.startEquity * CASHOUT_GAIN_BPS;
    if (ahead && state === "green" && t >= CASHOUT_OPEN_T && t < CASHOUT_CLOSE_T && !this.threatened(v) && rand(this.rng) < 0.3) {
      cmd.cashout = true;
    }
    return cmd;
  }

  private threatened(v: AgentView): boolean {
    return v.others.some((o) => o.kind !== "drone" && ring(o) !== "red" && outweighs(o, v.self) && dist(o, v.self) < 400);
  }

  /** MultiOgar's potential field, with MARGIN's rules for who can eat or pop whom. */
  private field(v: AgentView, tick: number): { dir: { x: number; y: number }; prey: Blob | null } {
    const me = v.self;
    const mySize = radius(me.mass);
    const iAmRed = ring(me) === "red";
    const n = Math.max(2, v.others.length + v.food.length + v.spikes.length);
    let rx = 0;
    let ry = 0;
    let prey: Blob | null = null;
    const push = (p: { x: number; y: number }, influence: number, edge: number): void => {
      const dx = p.x - me.x;
      const dy = p.y - me.y;
      const len = Math.hypot(dx, dy) || 1;
      // Threats count from the edges, as in MultiOgar: a big blob is closer than its centre.
      const d = Math.max(1, influence < 0 ? len - edge : len);
      rx += (dx / len) * (influence / d);
      ry += (dy / len) * (influence / d);
    };
    for (const o of v.others) {
      const theirSize = radius(o.mass);
      const edge = mySize + theirSize;
      if (o.kind === "drone") {
        if (iAmRed) push(o, -3, edge); // a drone only hunts red blobs
        continue;
      }
      if (iAmRed) push(o, -theirSize / mySize - 1, edge); // any touch pops a red blob
      else if (tick < o.shieldUntil) continue; // shielded: can't be eaten or popped, ignore
      else if (ring(o) === "red") {
        push(o, theirSize / Math.log(n) + 2, edge); // a red blob is a bounty on legs
        if (dist(o, me) < CHASE_RANGE) prey ??= o;
      } else if (outweighs(me, o)) {
        push(o, theirSize / Math.log(n), edge);
        if (dist(o, me) < CHASE_RANGE && (!prey || o.mass > prey.mass)) prey = o;
      } else if (outweighs(o, me)) push(o, -Math.log(theirSize / mySize) - 0.5, edge);
      else push(o, -theirSize / mySize, edge);
    }
    for (const f of v.food) push(f, 1, 0);
    const boosted = me.debt > 0 ? 1.5 : 1;
    for (const s of v.spikes) push(s, -this.personality.caution * boosted * 3, mySize + 18);
    // Outside the shrinking zone, everything else matters less than getting back in.
    const zd = dist(me, { x: v.zone.cx, y: v.zone.cy });
    if (zd > v.zone.r * 0.9) push({ x: v.zone.cx, y: v.zone.cy }, 50, 0);
    const len = Math.hypot(rx, ry);
    if (len < 1e-9) return { dir: { x: randRange(this.rng, -1, 1), y: randRange(this.rng, -1, 1) }, prey };
    return { dir: { x: rx / len, y: ry / len }, prey };
  }
}
