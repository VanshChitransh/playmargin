// A whole match in the browser on the real rules (core newWorld/startMatch/step), with
// simple labelled bots. Drives offline practice and the landing hero, so both show the
// actual game instead of a mock. The server stays the only authority for real matches.
import { R, TICK_MS, appendLog, blobView, matchView, newWorld, radius, startMatch, step, type Blob, type GameEventMsg, type InputCmd, type LogEntry, type PlayerSeed, type World } from "@margin/core";
import type { Frame } from "./frame";

const ME = "me";
const MAX_STEPS = 8; // after a background tab, catch up at most this many ticks per frame

export interface LocalOpts {
  seed: number;
  /** Include a human "me"; false = bots only (landing hero). */
  withMe: boolean;
  bots: number;
  /** Seconds of warm-up before GO (0 = start live). */
  warmupS: number;
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
    if (o.withMe) players.push({ id: ME, kind: "human", label: "you", accountId: null });
    for (let i = 0; i < o.bots; i++) players.push({ id: `bot${i}`, kind: "agent", label: `Bot-${i + 1}`, accountId: null });
    this.w = newWorld(o.seed, "free", players, `local-${o.seed}`);
    this.warmTicks = Math.round(o.warmupS * R.TICK_HZ);
    if (this.warmTicks === 0) startMatch(this.w, 0);
  }

  readonly matchId = "local";

  get me(): string {
    return this.o.withMe ? ME : "bot0";
  }

  send(cmd: InputCmd): void {
    // Taps are edges: keep one pending until a tick consumes it.
    const prev = this.myCmd;
    this.myCmd = prev ? { ...cmd, boost: cmd.boost || prev.boost, repay: cmd.repay || prev.repay, cashout: cmd.cashout || prev.cashout } : cmd;
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
    this.myCmd = this.myCmd ? { ...this.myCmd, boost: false, repay: false, cashout: false } : null;
    if (this.tick % 6 === 0) for (const b of this.w.blobs.values()) if (b.kind === "agent") inputs.set(b.id, this.brain(b));
    const ev = step(this.w, inputs, this.tick);
    this.events.push(...this.w.pendingLog.splice(0));
    for (const e of ev) this.listeners.forEach((l) => l(e));
  }

  /** The hash-chained log of everything so far (same format the server anchors). */
  async log(): Promise<LogEntry[]> {
    return appendLog([], this.events);
  }

  /** Simple bot: flee bigger blobs, chase red smaller ones, else graze; boost only when safe. */
  private brain(b: Blob): InputCmd {
    let tx = 0;
    let ty = 0;
    for (const o of this.w.blobs.values()) {
      if (o === b || o.state !== "alive" || o.kind === "drone") continue;
      const dx = o.x - b.x;
      const dy = o.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 600) continue;
      const w = o.mass > b.mass * 1.15 ? -3 : o.mass * 1.15 < b.mass ? 1.5 : 0;
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
    return {
      seq: ++this.botSeq,
      dirX: tx / len,
      dirY: ty / len,
      boost: debtRatio < 0.3 && (this.tick + b.id.length * 37) % 240 === 0,
      repay: debtRatio > 0.45,
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
      food: this.w.food.map((f) => ({ id: f.id, x: f.x, y: f.y, r: Math.min(14, radius(f.mass) * 0.6) })),
      spikes: this.w.spikes.filter((s) => s.respawnAt === null).map((s) => ({ id: s.id, x: s.x, y: s.y, big: s.big })),
    };
  }
}
