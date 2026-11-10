// Free-room agent player. Steering is a port of MultiOgar's BotPlayer.decide() potential field
// (agarian-2/MultiOgar src/ai/BotPlayer.js L33-92, Apache-2.0, see docs/CREDITS.md): prey pulls,
// threats push by edge distance, food pulls, spikes push. On top, the MARGIN money habits a
// careful human would have: BOOST to chase, REPAY when not green, cash out when ahead.
import {
  equity, fuel, humanSafeUntil, leverageBps, outweighs, R, radius, rand, randRange, ring, seedRng, sToTicks, type AgentView, type Blob, type Brain, type InputCmd,
} from "@margin/core";

/** How this bot plays; the commander (A6) may nudge these later. Values in 0..1. */
export interface Personality {
  /** Chance per decision to BOOST when prey is in reach. */
  greed: number;
  /** How much spikes repel it. */
  caution: number;
  /** 0 to 1. 1 = sharp (200 to 400 ms reactions, exact aim, tight food routing); lower is slower,
   *  noisier, wanders and lets prey go. Free-room agents use AGENT_SKILL so a first-timer can win. */
  skill: number;
  /** Judge Run: never hunt a human who is not red, and keep a wide berth, so the lesson is greed
   *  (go red and Drone-1 pops you), never "an agent ate me while I stood still". */
  spareHumans?: boolean;
}

/** Global free-room agent skill (later per league). Tuned with tools/sim/human.ts. */
export const AGENT_SKILL = 0.6;
/** The engine bars agents from eating humans this early; agents also don't BOOST before it, so their
 *  early growth matches a human who has not found BOOST yet. */
const HUMAN_SAFE_T = sToTicks(R.AGENT_NO_EAT_HUMAN_S);
/** After 30 s, chance per decision (times skill) that a smaller human counts as prey. Tuned with
 *  tools/sim/human.ts so a newcomer survives most matches but not all. */
export const HUNT_HUMAN_P = 1;
const CASHOUT_OPEN_T = sToTicks(R.CASHOUT_OPEN_S);
const CASHOUT_CLOSE_T = sToTicks(R.CASHOUT_CLOSE_S);
/** Agents stay in until 70 s, so the Hunt and Squeeze still have big blobs to fear and chase. */
const AGENT_CASHOUT_T = sToTicks(70);
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
  /** REPAY is held the same way: a decision to deleverage holds it until the next decision. */
  private repaying = false;
  /** This decision, may a smaller human be prey? Otherwise the bot steers around humans, so it
   *  never eats one by drifting into it while chasing food. */
  private huntHumans = false;
  private liveSince: number | null = null;
  private startEquity = 0;
  readonly personality: Personality;

  constructor(seed: number, personality?: Partial<Personality>) {
    this.rng = { rngState: seedRng(seed) };
    this.personality = {
      // A spread from careful to reckless, like a real lobby: some bots will get liquidated.
      greed: personality?.greed ?? randRange(this.rng, 0.2, 1),
      caution: personality?.caution ?? randRange(this.rng, 0.1, 1.2),
      skill: personality?.skill ?? AGENT_SKILL,
      spareHumans: personality?.spareHumans,
    };
  }

  /** Steer (and hold BOOST or REPAY) every tick as last decided; think only every 200 to 400 ms. */
  decide(v: AgentView, tick: number): InputCmd {
    const cmd: InputCmd = { seq: tick, dirX: this.held.x, dirY: this.held.y, boost: this.boosting, repay: this.repaying, cashout: false };
    if (v.phase === "LIVE" && this.liveSince === null) {
      this.liveSince = tick;
      this.startEquity = equity(v.self);
    }
    if (tick < this.nextAt) return cmd;
    // Reaction 200 to 400 ms at skill 1, up to 450 to 700 ms at skill 0.
    const slow = 1 - this.personality.skill;
    const minT = Math.round((0.2 + 0.25 * slow) * R.TICK_HZ);
    const maxT = Math.round((0.4 + 0.3 * slow) * R.TICK_HZ);
    this.nextAt = tick + minT + Math.floor(rand(this.rng) * (maxT - minT + 1));

    const t0 = this.liveSince === null ? 0 : tick - this.liveSince;
    // An agent hunts humans only by choice, after 30 s, on some decisions (fewer at lower skill).
    this.huntHumans = v.self.kind !== "agent" || (t0 >= HUMAN_SAFE_T && rand(this.rng) < HUNT_HUMAN_P * this.personality.skill);
    let { dir, prey } = this.field(v, tick);
    // Less skill: sometimes wander or let prey go, and aim with noise, like a human on a touchpad.
    if (rand(this.rng) < 0.35 * slow) {
      dir = { x: randRange(this.rng, -1, 1), y: randRange(this.rng, -1, 1) };
      prey = null;
    } else if (prey && rand(this.rng) < 0.4 * slow) prey = null;
    const turn = randRange(this.rng, -1, 1) * 0.6 * slow;
    dir = { x: dir.x * Math.cos(turn) - dir.y * Math.sin(turn), y: dir.x * Math.sin(turn) + dir.y * Math.cos(turn) };
    this.held = dir;
    this.boosting = this.repaying = false;
    cmd.dirX = dir.x;
    cmd.dirY = dir.y;
    cmd.boost = cmd.repay = false;
    if (v.phase !== "LIVE" || this.liveSince === null) return cmd;

    const me = v.self;
    const state = ring(me);
    const t = tick - this.liveSince;
    // Appetite: a greedy bot borrows to grow toward 1.3x to 2x leverage, like a player who
    // wants size early; anyone boosts to catch prey. Not green means deleverage, never double down.
    const appetiteBps = 10_000 + Math.round(this.personality.greed * 15_000);
    // Careful bots deleverage at once; reckless ones hesitate, as panicking humans do.
    if (state !== "green" && me.debt > 0 && rand(this.rng) < 0.3 + 0.6 * Math.min(1, this.personality.caution)) this.repaying = cmd.repay = true;
    else if (state === "green" && fuel(me) > 0 && (me.kind !== "agent" || t >= HUMAN_SAFE_T) && (prey ? rand(this.rng) < this.personality.greed : leverageBps(me) < appetiteBps && rand(this.rng) < 0.25)) {
      this.boosting = cmd.boost = true;
    }
    const ahead = equity(me) * 10_000 >= this.startEquity * CASHOUT_GAIN_BPS;
    if (ahead && state === "green" && t >= (me.kind === "agent" ? AGENT_CASHOUT_T : CASHOUT_OPEN_T) && t < CASHOUT_CLOSE_T && !this.threatened(v) && rand(this.rng) < 0.3) {
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
      else if (o.kind === "human" && this.personality.spareHumans && ring(o) !== "red") {
        push(o, -3, edge + 120); // Judge Run: a wide berth, food near the judge stays the judge's
        continue;
      }
      else if (o.kind === "human" && (!this.huntHumans || (me.kind === "agent" && tick < humanSafeUntil(this.liveSince ?? tick, o.joinedAt))) && !outweighs(o, me)) {
        push(o, -0.5, edge); // not hunting, or the human is still in their first 30 s (late joins too): keep a gap
        continue;
      }
      else if (ring(o) === "red") {
        push(o, theirSize / Math.log(n) + 2, edge); // a red blob is a bounty on legs
        if (dist(o, me) < CHASE_RANGE) prey ??= o;
      } else if (outweighs(me, o)) {
        push(o, theirSize / Math.log(n), edge);
        if (dist(o, me) < CHASE_RANGE && (!prey || o.mass > prey.mass)) prey = o;
      } else if (outweighs(o, me)) push(o, -Math.log(theirSize / mySize) - 0.5, edge);
      else push(o, -theirSize / mySize, edge);
    }
    // Skill 1 weighs every pellet in view (near-perfect routing); less skill, a weaker pull.
    for (const f of v.food) push(f, 0.4 + 0.6 * this.personality.skill, 0);
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
