// One blob: body + health ring + label. Ring state is shown by shape AND colour
// (solid green, dashed yellow, pulsing red with a warning sign) so colour-blind
// players read it too (inspiration.md principle 2). Bodies are agar-style: a vivid colour
// per id, darker rim, name centred in white with a dark stroke. Drones are hollow hexes.
// The outline is a soft membrane (membrane.ts): it flattens on the wall, dents under bigger
// blobs and wobbles; the debt shell, me ring, health ring and shield follow the same outline.
import { Container, Graphics, Text } from "pixi.js";
import { MICRO, radius, type BlobView, type Ring } from "@margin/core";
import { C, darken, vivid } from "./colors";
import { displayName } from "../hud/logic";
import { reducedMotion } from "./motion";
import { JUICE } from "./juice";
import { Membrane, type Neighbour } from "./membrane";

/** What a blob needs to know about the world to shape its outline. */
export interface Surroundings {
  w: number;
  h: number;
  /** Blobs drawn on top of this one that may overlap it. */
  over: readonly Neighbour[];
  /** Pellets near my rim (each dents it a little while it overlaps). */
  food?: readonly Neighbour[];
  /** False when the blob is off screen: geometry is not rebuilt. */
  visible?: boolean;
  dt: number;
}

const RING_GAP = 4;
const RING_W = 4;
const DASHES = 14;

export class BlobSprite extends Container {
  private body = new Graphics();
  private ring = new Graphics();
  private shield = new Graphics();
  private nameText: Text;
  private warnSign: Text;
  private drawn = { r: -1, ring: "" as Ring | "", kind: "" };
  private prev = { x: 0, y: 0, speed: 0 };
  private fill = 0;
  private isMe = false;
  private mem = new Membrane();
  /** Phase seed for this blob's lumps, from its id. */
  private seed = 0;
  private ringStyle: { w: number; color: number; dashed: boolean } = { w: RING_W, color: C.ringSafe, dashed: false };
  private lastR = -1;
  private dirty = true;
  /** Radius of my equity core inside the debt shell (0 = no loan). */
  private core = 0;
  private stretch = 0;
  private heading = 0;
  private squashUntil = 0;
  private squashAmount = 0;

  constructor(v: BlobView, isMe: boolean) {
    super();
    const name = displayName(v);
    this.nameText = new Text({
      text: name,
      style: { fontFamily: ["Rubik", "system-ui", "sans-serif"], fontSize: 28, fontWeight: "700", fill: 0xffffff, stroke: { color: C.ink, width: 5, join: "round" } },
    });
    this.nameText.anchor.set(0.5);
    for (let i = 0; i < v.id.length; i++) this.seed = (this.seed * 31 + v.id.charCodeAt(i)) % 6283;
    this.seed /= 1000;
    this.warnSign = new Text({ text: "⚠", style: { fontSize: 18, fill: C.liq } });
    this.warnSign.anchor.set(0.5);
    this.addChild(this.shield, this.body, this.ring, this.nameText, this.warnSign);
  }

  /** Sync to a view; tS is seconds since start (pulses), zoom keeps text a fixed screen size. */
  update(v: BlobView, tS: number, isMe: boolean, zoom: number, ghost = false, boosting = false, around?: Surroundings): void {
    const moved = Math.hypot(v.x - this.prev.x, v.y - this.prev.y);
    if (moved > 0.5) this.heading = Math.atan2(v.y - this.prev.y, v.x - this.prev.x);
    this.prev = { x: v.x, y: v.y, speed: this.prev.speed * 0.85 + Math.min(moved, 20) * 0.15 };
    this.position.set(v.x, v.y);
    this.visible = v.state === "alive";
    if (!this.visible) return;
    // Before GO nobody can touch: others are faint ghosts with no ring, so overlap never reads as contact.
    this.alpha = ghost ? JUICE.GHOST_ALPHA : 1;
    this.ring.visible = !ghost;
    // My debt shell: the core keeps my colour and is sized by equity; the rest of me is the loan.
    const core = isMe && v.owe > 0.5 && v.equity > 0 ? Math.min(v.radius, radius(Math.round(v.equity * MICRO))) : 0;
    // Redraw geometry only when it visibly changes; 12 blobs, but phones count.
    if (Math.abs(v.radius - this.drawn.r) > 0.5 || Math.abs(core - this.core) > 0.5 || v.ring !== this.drawn.ring || v.kind !== this.drawn.kind) {
      this.core = core;
      this.redraw(v, isMe);
    }
    const r = v.radius + RING_GAP;
    const k = 1 / zoom;
    this.feel(boosting);
    if (v.kind !== "drone") this.membrane(v, tS, around);
    // Name inside the blob, sized with it (agar.io), never under ~11 px on screen.
    // Pressed on a wall the outline shifts and shrinks: the name follows its centre and size.
    const c = v.kind === "drone" || !this.mem.n ? { x: 0, y: 0, mean: v.radius } : this.mem.centre();
    const ns = Math.max(Math.min(v.radius, c.mean) * 0.5, 11 / zoom) / 28;
    this.nameText.scale.set(ns);
    this.warnSign.scale.set(k);
    this.nameText.position.set(c.x, v.kind === "drone" ? r + 14 * k : c.y);
    this.warnSign.visible = v.ring === "red" && v.kind !== "drone";
    this.warnSign.position.set(0, -r - 14 * k);
    this.shield.visible = v.shielded;
    // Red pulses fast (heartbeat), yellow breathes slowly, green is still.
    const hz = reducedMotion ? 0 : v.ring === "red" ? 4 : v.ring === "yellow" ? 1 : 0;
    const p = hz ? 0.5 + 0.5 * Math.sin(tS * hz * Math.PI * 2) : 1;
    this.ring.alpha = hz ? 0.55 + 0.45 * p : 1;
    this.ring.scale.set(v.ring === "red" ? 1 + 0.08 * p : 1);
    this.warnSign.alpha = 0.6 + 0.4 * p;
  }

  /** Shape the soft outline for this frame and redraw it when it moved. */
  private membrane(v: BlobView, tS: number, around?: Surroundings): void {
    const r = v.radius;
    const k = Math.min(1, this.prev.speed / JUICE.MEMBRANE_NOISE_SPEED);
    const amp = reducedMotion ? 0 : r * (JUICE.MEMBRANE_NOISE_REST + (JUICE.MEMBRANE_NOISE_MOVE - JUICE.MEMBRANE_NOISE_REST) * k);
    const seed = this.seed;
    const sq = performance.now() < this.squashUntil ? 1 - this.squashAmount : 1;
    const sx = 1 + this.stretch;
    const sy = 1 - this.stretch / 2;
    const h = this.heading;
    // Free shape: stretched along the heading (BOOST), squashed (REPAY, pickups), and alive:
    // agar cells are never perfect circles, lumps drift all the time, more while moving.
    const shape = (a: number): number => {
      const c = Math.cos(a - h) / sx;
      const s = Math.sin(a - h) / sy;
      return (r * sq) / Math.sqrt(c * c + s * s) + amp * lumps(a, tS, seed);
    };
    this.mem.target(v.x, v.y, r, shape, around?.w ?? Infinity, around?.h ?? Infinity, around?.over ?? [], around?.food ?? []);
    this.mem.settleIfNew();
    if (this.lastR > 0 && !reducedMotion && Math.abs(r - this.lastR) > 1) this.mem.kick((r - this.lastR) * JUICE.MEMBRANE_KICK);
    this.lastR = r;
    // Ask before stepping: a reduced-motion snap lands on the target in one step and would hide the change.
    const moving = this.mem.moving();
    this.mem.step(around?.dt ?? 1 / 60, !reducedMotion);
    // Off screen: keep the springs running but skip building geometry nobody sees.
    if (around?.visible === false) return void (this.dirty = true);
    if (!this.dirty && !moving) return;
    this.dirty = false;
    this.paint(r);
  }

  /** Body, debt shell, me ring, health ring and shield, all from the one outline. */
  private paint(r: number): void {
    const b = this.body.clear();
    const rim = Math.max(3, r * 0.06);
    if (this.core > 0) {
      // Loan as shape: a translucent gold band outside a player-coloured equity core.
      smooth(b, this.mem.points()).fill({ color: JUICE.SHELL_COLOR, alpha: JUICE.SHELL_ALPHA }).stroke({ width: rim, color: darken(JUICE.SHELL_COLOR) });
      smooth(b, this.mem.points(this.core / r)).fill(this.fill).stroke({ width: Math.max(2, this.core * 0.05), color: darken(this.fill) });
    } else {
      smooth(b, this.mem.points()).fill(this.fill).stroke({ width: rim, color: darken(this.fill) });
    }
    // My own blob: a thin paper ring just inside the rim, so "me" reads at a glance.
    if (this.isMe) b.poly(this.mem.points(((this.core || r) * 0.84) / r)).stroke({ width: Math.max(4, r * 0.07), color: 0xffffff, alpha: 0.9 });
    const ring = this.ring.clear();
    const pts = this.mem.points(1, RING_GAP);
    // Ink under every ring (sticker outline): green, amber and red read on any fill and floor.
    // Rings are plain polygons: the points are a few px apart, and a poly builds far cheaper than curves.
    ring.poly(pts).stroke({ width: this.ringStyle.w + 3, color: C.ink, alpha: 0.85, join: "round" });
    if (this.ringStyle.dashed) dashed(ring, pts, this.ringStyle.color);
    else ring.poly(pts).stroke({ width: this.ringStyle.w, color: this.ringStyle.color, join: "round" });
    this.shield.clear().poly(this.mem.points(1, RING_GAP + 7)).stroke({ width: 2, color: C.navy, alpha: 0.35 });
  }

  /** REPAY landed: compress then spring back (presentation only). */
  squash(amount: number = JUICE.REPAY_SQUASH, ms: number = JUICE.REPAY_SQUASH_MS): void {
    if (reducedMotion) return;
    this.squashAmount = amount;
    this.squashUntil = performance.now() + ms;
  }

  /** Stretch along heading while boosting; the membrane bakes it into the outline. */
  private feel(boosting: boolean): void {
    if (reducedMotion) return;
    this.stretch += ((boosting ? JUICE.BOOST_STRETCH : 0) - this.stretch) * Math.min(1, JUICE.STRETCH_EASE / 60);
  }

  private redraw(v: BlobView, isMe: boolean): void {
    this.drawn = { r: v.radius, ring: v.ring, kind: v.kind };
    const r = v.radius;
    this.body.clear();
    this.ring.clear();
    this.shield.clear();
    if (v.kind === "drone") {
      // Drones cannot eat or be eaten, so they get no body and no ring.
      this.body.poly(hex(r)).fill({ color: C.agent, alpha: 0.18 }).stroke({ width: 4, color: C.navy });
      return;
    }
    this.fill = vivid(v.id);
    this.isMe = isMe;
    this.ringStyle = { w: v.ring === "red" ? RING_W * 2 : RING_W, color: v.ring === "red" ? C.liq : v.ring === "yellow" ? C.ringWarn : C.ringSafe, dashed: v.ring === "yellow" };
    this.dirty = true;
  }
}

/** Smooth irregular lumps in [-1, 1]: four angular frequencies drifting at their own speeds,
 *  phases from the blob's id, so no two blobs wobble alike. */
function lumps(a: number, t: number, seed: number): number {
  return (
    0.45 * Math.sin(3 * a + seed + 1.3 * t) +
    0.3 * Math.sin(5 * a + seed * 1.7 - 1.9 * t) +
    0.17 * Math.sin(7 * a + seed * 2.3 + 2.6 * t) +
    0.08 * Math.sin(11 * a + seed * 3.1 - 3.4 * t)
  );
}

/** Closed smooth curve through the outline points: quadratic segments between midpoints. */
function smooth(g: Graphics, p: number[]): Graphics {
  const n = p.length / 2;
  const mx = (i: number): number => (p[(i % n) * 2]! + p[((i + 1) % n) * 2]!) / 2;
  const my = (i: number): number => (p[(i % n) * 2 + 1]! + p[((i + 1) % n) * 2 + 1]!) / 2;
  g.moveTo(mx(n - 1), my(n - 1));
  for (let i = 0; i < n; i++) g.quadraticCurveTo(p[i * 2]!, p[i * 2 + 1]!, mx(i), my(i));
  return g.closePath();
}

/** Yellow ring: DASHES dashes along the outline, each 60% of its slot. */
function dashed(g: Graphics, p: number[], color: number): void {
  const n = p.length / 2;
  for (let d = 0; d < DASHES; d++) {
    const i0 = Math.round((d * n) / DASHES);
    const i1 = Math.round(((d + 0.6) * n) / DASHES);
    g.moveTo(p[(i0 % n) * 2]!, p[(i0 % n) * 2 + 1]!);
    for (let i = i0 + 1; i <= i1; i++) g.lineTo(p[(i % n) * 2]!, p[(i % n) * 2 + 1]!);
  }
  g.stroke({ width: RING_W, color, cap: "round" });
}

function hex(r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return pts;
}
