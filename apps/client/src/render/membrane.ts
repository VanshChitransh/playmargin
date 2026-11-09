// agar-style soft body: the outline is N points around the centre, each a radius on a spring.
// Targets flatten against the arena wall. A blob partly under a bigger one dents along the
// bigger one's edge (agar: cells overlap, the bigger draws on top), fading out past half
// overlap so a covered blob never looks broken. Visual only: the rules still see circles. Springs plus neighbour averaging give the jelly
// wobble. Pure maths, no Pixi, so it is unit tested and cheap.
import { JUICE } from "./juice";

/** A blob drawn on top of me that may overlap me (world units). */
export interface Neighbour {
  x: number;
  y: number;
  r: number;
}

/** Point count for a radius: about one point per MEMBRANE_SPACING of rim, clamped. */
export function pointCount(r: number): number {
  return Math.max(JUICE.MEMBRANE_MIN_PTS, Math.min(JUICE.MEMBRANE_MAX_PTS, Math.round((Math.PI * 2 * r) / JUICE.MEMBRANE_SPACING)));
}

/** Distance from (cx, cy) along (c, s) to the arena border, Infinity if it never gets there. */
export function wallDistance(cx: number, cy: number, c: number, s: number, w: number, h: number): number {
  const tx = c > 1e-6 ? (w - cx) / c : c < -1e-6 ? -cx / c : Infinity;
  const ty = s > 1e-6 ? (h - cy) / s : s < -1e-6 ? -cy / s : Infinity;
  return Math.max(0, Math.min(tx, ty));
}

/** Distance along unit ray (c, s) from my centre to where it enters circle o, or Infinity. */
export function rayEnter(cx: number, cy: number, c: number, s: number, o: Neighbour): number {
  const fx = cx - o.x;
  const fy = cy - o.y;
  const b = fx * c + fy * s;
  const cc = fx * fx + fy * fy - o.r * o.r;
  const disc = b * b - cc;
  if (cc <= 0 || disc <= 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

/** Dent strength from overlap: full up to MEMBRANE_DENT_FULL of my diameter, gone by MEMBRANE_DENT_GONE. */
export function dentStrength(d: number, r: number, or: number): number {
  const ov = (r + or - d) / (2 * r);
  if (ov <= 0) return 0;
  const { MEMBRANE_DENT_FULL: a, MEMBRANE_DENT_GONE: z } = JUICE;
  return ov <= a ? 1 : ov >= z ? 0 : 1 - (ov - a) / (z - a);
}

export class Membrane {
  n = 0;
  rad = new Float32Array(0);
  private vel = new Float32Array(0);
  private tgt = new Float32Array(0);
  private wall = new Float32Array(0);
  private cos = new Float32Array(0);
  private sin = new Float32Array(0);

  /** Recompute targets. shape(a) is the free outline radius at angle a (stretch, squash, ripple).
   *  pad keeps the outline that far inside the wall (room for a ring drawn outside it). */
  target(cx: number, cy: number, r: number, shape: (a: number) => number, w: number, h: number, others: readonly Neighbour[], pad = 0): void {
    this.resize(pointCount(r));
    const floor = r * JUICE.MEMBRANE_MIN;
    const dents: Array<{ o: Neighbour; k: number }> = [];
    for (const o of others) {
      const k = dentStrength(Math.hypot(o.x - cx, o.y - cy), r, o.r);
      if (k > 0) dents.push({ o, k });
    }
    for (let i = 0; i < this.n; i++) {
      const c = this.cos[i]!;
      const s = this.sin[i]!;
      const wall = wallDistance(cx - pad, cy - pad, c, s, w - pad * 2, h - pad * 2);
      let t = Math.min(shape((i / this.n) * Math.PI * 2), wall);
      for (const { o, k } of dents) {
        const e = rayEnter(cx, cy, c, s, o);
        if (e < t) t -= (t - e) * k * JUICE.MEMBRANE_DENT_DEPTH;
      }
      // The floor keeps a dent from crushing the blob; the wall always wins over it.
      this.wall[i] = Math.max(JUICE.MEMBRANE_WALL_MIN, wall);
      this.tgt[i] = Math.min(this.wall[i]!, Math.max(floor, t));
    }
  }

  /** Advance the springs dt seconds; jelly false snaps to the targets (reduced motion). */
  step(dt: number, jelly: boolean): void {
    const n = this.n;
    if (!jelly) {
      this.rad.set(this.tgt);
      this.vel.fill(0);
      return;
    }
    const h = Math.min(dt, JUICE.MEMBRANE_MAX_DT);
    for (let i = 0; i < n; i++) {
      const avg = (this.rad[(i + n - 1) % n]! + this.rad[(i + 1) % n]!) / 2;
      const a = JUICE.MEMBRANE_K * (this.tgt[i]! - this.rad[i]!) + JUICE.MEMBRANE_NEIGHBOUR * (avg - this.rad[i]!) - JUICE.MEMBRANE_DAMP * this.vel[i]!;
      this.vel[i]! += a * h;
    }
    for (let i = 0; i < n; i++) {
      // A wobble may bulge anywhere except through the wall.
      this.rad[i] = Math.min(this.rad[i]! + this.vel[i]! * h, this.wall[i]!);
    }
  }

  /** Outline points (x, y pairs) at radius rad * scale + offset. */
  points(scale = 1, offset = 0): number[] {
    const out = new Array<number>(this.n * 2);
    for (let i = 0; i < this.n; i++) {
      const rr = this.rad[i]! * scale + offset;
      out[i * 2] = this.cos[i]! * rr;
      out[i * 2 + 1] = this.sin[i]! * rr;
    }
    return out;
  }

  private resize(n: number): void {
    if (n === this.n) return;
    // Resample the current shape so growing past a point-count step never pops.
    const old = this.rad;
    const on = this.n;
    this.rad = new Float32Array(n);
    this.vel = new Float32Array(n);
    this.tgt = new Float32Array(n);
    this.wall = new Float32Array(n);
    this.cos = new Float32Array(n);
    this.sin = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
      this.rad[i] = on ? old[Math.floor((i / n) * on)]! : 0;
    }
    if (!on) this.rad.fill(NaN); // first target() call fills it
    this.n = n;
  }

  /** A sudden size change (an eat, a hit) throws the whole rim outward or inward. */
  kick(v: number): void {
    for (let i = 0; i < this.n; i++) this.vel[i]! += v;
  }

  /** True while any point still moves or sits off its target, so a still blob is not redrawn. */
  moving(): boolean {
    for (let i = 0; i < this.n; i++) if (Math.abs(this.vel[i]!) > 0.05 || Math.abs(this.tgt[i]! - this.rad[i]!) > 0.05) return true;
    return false;
  }

  /** Centre of the outline and its mean radius: where the name sits and how big it can be. */
  centre(): { x: number; y: number; mean: number } {
    let x = 0;
    let y = 0;
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      x += this.cos[i]! * this.rad[i]!;
      y += this.sin[i]! * this.rad[i]!;
      m += this.rad[i]!;
    }
    const n = this.n || 1;
    return { x: x / n, y: y / n, mean: m / n };
  }

  /** First frame: start exactly on the targets instead of springing out of nothing. */
  settleIfNew(): void {
    if (this.n && Number.isNaN(this.rad[0])) this.rad.set(this.tgt);
  }
}
