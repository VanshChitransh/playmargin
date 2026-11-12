// Own-blob prediction: my blob moves on my input this frame instead of one round trip later.
// The server stays the authority. It sends no input ack, so a server position is compared with
// where I predicted myself one round trip earlier (that state reflects the inputs I had sent by
// then); the difference is spread over a few frames, and a big one (death, eat, spawn, wall) snaps.
// Motion uses the same speed curve and ease as packages/core motion.ts.
import { MICRO, R, speed } from "@margin/core";
import type { BlobView } from "@margin/core";

/** What I am pressing, as last sent to the server. */
export interface Input {
  dirX: number;
  dirY: number;
  boost: boolean;
}

/** Errors under this are spread out; above it the blob snaps (a pop, a respawn, a wall clamp). */
const SNAP_PX = 160;
/** Seconds to fold a correction in: short enough to never drift, long enough to never jump. */
const CORRECT_S = 0.12;
const HISTORY_MS = 2000;

/** px/s and ease seconds for my blob right now, from the server's view of it (core motion.ts). */
export function motionOf(me: BlobView, boosting: boolean): { speed: number; ease: number } {
  const units = Math.max(0, (me.radius - 4) / 6) ** 2;
  let s = boosting ? R.BOOST_SPEED_MULT * speed(Math.max(0, Math.round(me.equity * MICRO))) : speed(Math.round(units * MICRO));
  if (me.cashingOut) s *= R.CASHOUT_SPEED_MULT;
  const ease = boosting ? R.BOOST_EASE_BASE_S + me.radius * R.BOOST_EASE_PER_RADIUS_PX_S : R.EASE_BASE_S + me.radius * R.EASE_PER_RADIUS_PX_S;
  return { speed: s, ease };
}

/** Can BOOST actually run? Mirrors the server's gates the client can see; a miss is corrected. */
export function canBoost(me: BlobView, phase: string, input: Input): boolean {
  return input.boost && phase === "LIVE" && !me.shielded && me.ring !== "red" && !me.cashingOut && (me.fuel ?? 1) > 0.01;
}

export class OwnPredictor {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  ready = false;
  private pendX = 0;
  private pendY = 0;
  /** Total correction folded in so far (x, y); history keeps it, so a correction is never counted twice. */
  private ax = 0;
  private ay = 0;
  private history: Array<{ t: number; x: number; y: number; ax: number; ay: number }> = [];

  /** Start (or restart) exactly on the server's position. */
  snap(x: number, y: number, t: number): void {
    this.x = x;
    this.y = y;
    this.vx = this.vy = 0;
    this.pendX = this.pendY = 0;
    this.ax = this.ay = 0;
    this.history = [{ t, x, y, ax: 0, ay: 0 }];
    this.ready = true;
  }

  /** Advance dtS seconds on my input (core move(): ease velocity toward dir x speed, clamp at walls). */
  step(dtS: number, t: number, input: Input, m: { speed: number; ease: number }, radius: number, arena: { w: number; h: number }): void {
    let { dirX, dirY } = input;
    const len = Math.hypot(dirX, dirY);
    if (len > 1) {
      dirX /= len;
      dirY /= len;
    }
    const k = 1 - Math.exp(-dtS / m.ease);
    this.vx += (dirX * m.speed - this.vx) * k;
    this.vy += (dirY * m.speed - this.vy) * k;
    // Fold a share of the pending correction in this frame.
    const c = Math.min(1, dtS / CORRECT_S);
    const cx = this.pendX * c;
    const cy = this.pendY * c;
    this.pendX -= cx;
    this.pendY -= cy;
    this.ax += cx;
    this.ay += cy;
    const mx = Math.min(radius * R.WALL_INSET_RADII, arena.w / 2);
    const my = Math.min(radius * R.WALL_INSET_RADII, arena.h / 2);
    this.x = Math.min(arena.w - mx, Math.max(mx, this.x + this.vx * dtS + cx));
    this.y = Math.min(arena.h - my, Math.max(my, this.y + this.vy * dtS + cy));
    if (this.x === mx || this.x === arena.w - mx) this.vx = 0;
    if (this.y === my || this.y === arena.h - my) this.vy = 0;
    this.history.push({ t, x: this.x, y: this.y, ax: this.ax, ay: this.ay });
    while (this.history.length > 2 && this.history[0]!.t < t - HISTORY_MS) this.history.shift();
  }

  /** Where I predicted myself at client time t (history, linear between frames). */
  at(t: number): { x: number; y: number; ax: number; ay: number } {
    const h = this.history;
    if (h.length === 0) return { x: this.x, y: this.y, ax: this.ax, ay: this.ay };
    if (t <= h[0]!.t) return h[0]!;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1]!;
      const b = h[i]!;
      if (a.t <= t) {
        const k = b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 1;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ax: a.ax, ay: a.ay };
      }
    }
    return h[h.length - 1]!;
  }

  /**
   * A server position arrived at client time arrivedAt with round trip rttMs: it reflects my inputs
   * up to about one round trip before. Queue the difference, or snap when it is big.
   * Returns "snap" or "soft" (for tests and the debug overlay).
   */
  reconcile(sx: number, sy: number, arrivedAt: number, rttMs: number, now: number): "snap" | "soft" {
    const was = this.at(arrivedAt - rttMs);
    // Corrections folded in since then already moved me: only the rest is still owed.
    const ex = sx - was.x - (this.ax - was.ax);
    const ey = sy - was.y - (this.ay - was.ay);
    if (Math.hypot(ex, ey) > SNAP_PX) {
      // Carry my motion since then on top of the server's truth, then start over from there.
      this.snap(sx + (this.x - was.x), sy + (this.y - was.y), now);
      return "snap";
    }
    // Replace (not add) the pending error: each server position measures the whole drift again.
    this.pendX = ex;
    this.pendY = ey;
    return "soft";
  }
}
