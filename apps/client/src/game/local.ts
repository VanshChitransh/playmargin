// A whole match in the browser on the real rules (core newWorld/startMatch/step), with
// simple labelled bots. Drives offline practice and the landing hero, so both show the
// actual game instead of a mock. The server stays the only authority for real matches.
import { R, spikeRadius, TICK_MS, appendLog, blobView, botNames, foodView, matchView, newWorld, outweighs, radius, ring, startMatch, step, type Blob, type GameEventMsg, type InputCmd, type LogEntry, type PlayerSeed, type World } from "@margin/core";
import type { Frame } from "./frame";
import { playerName } from "../player/name";

const ME = "me";
const MAX_STEPS = 8; // after a background tab, catch up at most this many ticks per frame

export interface LocalOpts {
  seed: number;
  /** Include a human "me"; false = bots only (landing hero). */
  withMe: boolean;
  bots: number;
  /** Seconds of warm-up before GO (0 = start live). */
  warmupS: number;
  /** Landing hero only: odd bots play greedy (hold nitro, never repay) so red rings and pops
   *  happen on camera. Same rules and engine; only the bots' choices change. Practice stays careful. */
  greedy?: boolean;
}

export class LocalMatch {
  readonly w: World;
  private tick = 0;
  private acc = 0;
  private last = -1;
  private warmTicks: number;
  private myCmd: InputCmd | null = null;
  private listeners = new Set<(e: GameEventMsg) => void>();
  private botSeq = 0;
  /** Every engine event, kept so an offline match can be verified like a live one. */
  private events: World["pendingLog"] = [];

  constructor(private o: LocalOpts) {
    const players: PlayerSeed[] = [];
    if (o.withMe) players.push({ id: ME, kind: "human", label: playerName() ?? "you", accountId: null });
    const names = botNames(o.seed, o.bots);
    for (let i = 0; i < o.bots; i++) players.push({ id: `bot${i}`, kind: "agent", label: names[i]!, accountId: null });
    this.w = newWorld(o.seed, "free", players, `local-${o.seed}`);
    this.warmTicks = Math.round(o.warmupS * R.TICK_HZ);
    if (this.warmTicks === 0) startMatch(this.w, 0);
  }

  readonly matchId = "local";

  get me(): string {
    return this.o.withMe ? ME : "bot0";
  }

  send(cmd: InputCmd): void {
    // BOOST and REPAY are held: the latest command wins. Cash-out is an edge kept until a tick uses it.
    const prev = this.myCmd;
    this.myCmd = prev ? { ...cmd, cashout: cmd.cashout || prev.cashout } : cmd;
  }

  onEvent(cb: (e: GameEventMsg) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Advance on a fixed 60 Hz step and return the frame to draw. */
  frameAt(nowMs: number): Frame {
    if (this.last < 0) this.last = nowMs;
    this.acc += nowMs - this.last;
    this.last = nowMs;
    let n = 0;
    while (this.acc >= TICK_MS && n++ < MAX_STEPS) {
      this.acc -= TICK_MS;
      this.advance();
    }
    if (n >= MAX_STEPS) this.acc = 0;
    return this.frame();
  }

  private advance(): void {
    this.tick++;
    if (this.w.phase === "WARMUP" && this.tick >= this.warmTicks) startMatch(this.w, this.tick);
    const inputs = new Map<string, InputCmd>();
    if (this.myCmd && this.o.withMe) inputs.set(ME, this.myCmd);
    this.myCmd = this.myCmd ? { ...this.myCmd, cashout: false } : null;
    if (this.tick % 6 === 0) for (const b of this.w.blobs.values()) if (b.kind === "agent") inputs.set(b.id, this.brain(b));
    const ev = step(this.w, inputs, this.tick);
    this.events.push(...this.w.pendingLog.splice(0));
    for (const e of ev) this.listeners.forEach((l) => l(e));
  }

  /** The hash-chained log of everything so far (same format the server anchors). */
  async log(): Promise<LogEntry[]> {
    return appendLog([], this.events);
  }

  /**
   * Simple bot: flee what can eat it, chase what it can eat or pop (red blobs most of all), else
   * graze, and steer off walls. Chase and flee use core outweighs(), the real eat and pop rule:
   * a looser rule had bots parked on prey they could never eat, membranes shaking, and fleeing
   * without the wall term pinned them in corners for the rest of the match.
   */
  private brain(b: Blob): InputCmd {
    let tx = 0;
    let ty = 0;
    for (const o of this.w.blobs.values()) {
      if (o === b || o.state !== "alive" || o.kind === "drone") continue;
      const dx = o.x - b.x;
      const dy = o.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 700) continue;
      // Popping a red blob needs the same size edge as eating (core pops()), so hunt only what we outweigh.
      const w = outweighs(o, b) ? -3 : outweighs(b, o) ? (ring(o) === "red" ? 6 : 2.5) : 0;
      tx += (dx / d) * w * (600 / d);
      ty += (dy / d) * w * (600 / d);
    }
    let best = Infinity;
    for (const f of this.w.food) {
      const d = Math.hypot(f.x - b.x, f.y - b.y);
      if (d < best) {
        best = d;
        tx += ((f.x - b.x) / (d || 1)) * 0.8;
        ty += ((f.y - b.y) / (d || 1)) * 0.8;
      }
    }
    // Walls push back harder the closer they are, so a chase slides along an edge instead of pinning.
    const edge = radius(b.mass) * 3 + 150;
    const { w: aw, h: ah } = this.w.arena;
    if (b.x < edge) tx += 4 * (1 - b.x / edge);
    if (aw - b.x < edge) tx -= 4 * (1 - (aw - b.x) / edge);
    if (b.y < edge) ty += 4 * (1 - b.y / edge);
    if (ah - b.y < edge) ty -= 4 * (1 - (ah - b.y) / edge);
    // Stay inside the zone.
    const zx = this.w.zone.cx - b.x;
    const zy = this.w.zone.cy - b.y;
    const zd = Math.hypot(zx, zy);
    if (zd > this.w.zone.r * 0.8) {
      tx += (zx / zd) * 3;
      ty += (zy / zd) * 3;
    }
    const len = Math.hypot(tx, ty) || 1;
    const debtRatio = b.debt / Math.max(1, b.mass);
    const greedy = this.o.greedy === true && Number(b.id.slice(3)) % 2 === 1;
    const phase = (this.tick + b.id.length * 37) % 240;
    return {
      seq: ++this.botSeq,
      dirX: tx / len,
      dirY: ty / len,
      // Careful: ~1.5 s of nitro every 4 s while the loan is small, repay at 45%. Greedy: ~3.3 s of
      // every 4 s up to the cap, never repay, so spikes turn them red (the over-leverage story).
      boost: greedy ? debtRatio < 0.62 && phase < 200 : debtRatio < 0.3 && phase < 90,
      repay: !greedy && debtRatio > 0.45,
      cashout: false,
    };
  }

  private frame(): Frame {
    const t = this.tick;
    const m = matchView(this.w);
    return {
      me: this.me,
      arena: this.w.arena,
      match: { ...m, timeLeftS: m.phase === "WARMUP" ? Math.ceil((this.warmTicks - t) / R.TICK_HZ) : Math.ceil(m.timeLeftS) },
      blobs: [...this.w.blobs.values()].map((b) => blobView(b, t)),
      food: this.w.food.map(foodView), // core hitbox radius, same as the server sends
      spikes: this.w.spikes.filter((s) => s.respawnAt === null).map((s) => ({ id: s.id, x: s.x, y: s.y, big: s.big, r: spikeRadius(s) })),
    };
  }
}
