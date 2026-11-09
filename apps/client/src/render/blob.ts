// One blob: body + health ring + label. Ring state is shown by shape AND colour
// (solid green, dashed yellow, pulsing red with a warning sign) so colour-blind
// players read it too (inspiration.md principle 2). Bodies are agar-style: a vivid colour
// per id, darker rim, name centred in white with a dark stroke. Drones are hollow hexes.
import { Container, Graphics, Text } from "pixi.js";
import { MICRO, radius, type BlobView, type Ring } from "@margin/core";
import { C, darken, vivid } from "./colors";
import { displayName } from "../hud/logic";
import { reducedMotion } from "./motion";
import { JUICE } from "./juice";

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
  private calm = false;
  private isMe = false;
  /** Radius of my equity core inside the debt shell (0 = no loan). */
  private core = 0;
  private stretch = 0;
  private heading = 0;
  private squashUntil = 0;

  constructor(v: BlobView, isMe: boolean) {
    super();
    const name = displayName(v);
    this.nameText = new Text({
      text: name,
      style: { fontFamily: ["Rubik", "system-ui", "sans-serif"], fontSize: 28, fontWeight: "700", fill: 0xffffff, stroke: { color: C.ink, width: 5, join: "round" } },
    });
    this.nameText.anchor.set(0.5);
    this.warnSign = new Text({ text: "⚠", style: { fontSize: 18, fill: C.liq } });
    this.warnSign.anchor.set(0.5);
    this.addChild(this.shield, this.body, this.ring, this.nameText, this.warnSign);
  }

  /** Sync to a view; tS is seconds since start (pulses), zoom keeps text a fixed screen size. */
  update(v: BlobView, tS: number, isMe: boolean, zoom: number, ghost = false, boosting = false): void {
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
    if (v.kind !== "drone") this.membrane(v.radius, tS);
    this.feel(boosting);
    // Name inside the blob, sized with it (agar.io), never under ~11 px on screen.
    const ns = Math.max(v.radius * 0.5, 11 / zoom) / 28;
    this.nameText.scale.set(ns);
    this.warnSign.scale.set(k);
    this.nameText.position.set(0, v.kind === "drone" ? r + 14 * k : 0);
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

  /** agar.io membrane: a flat vivid body with a darker rim that ripples while moving. */
  private membrane(r: number, tS: number, force = false): void {
    const amp = reducedMotion ? 0 : wobble(r, this.prev.speed);
    if (amp < 0.3 && !force && this.calm) return;
    this.calm = amp < 0.3;
    const n = 48;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r + amp * Math.sin(a * 5 + tS * 6) * Math.sin(a * 3 - tS * 4);
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    this.body.clear();
    if (this.core > 0) {
      // Loan as shape: a translucent gold band outside a player-coloured equity core.
      this.body.poly(pts).fill({ color: JUICE.SHELL_COLOR, alpha: JUICE.SHELL_ALPHA }).stroke({ width: Math.max(3, r * 0.06), color: darken(JUICE.SHELL_COLOR) });
      this.body.circle(0, 0, this.core).fill(this.fill).stroke({ width: Math.max(2, this.core * 0.05), color: darken(this.fill) });
    } else {
      this.body.poly(pts).fill(this.fill).stroke({ width: Math.max(3, r * 0.06), color: darken(this.fill) });
    }
    // My own blob: a thin paper ring just inside the rim, so "me" reads at a glance.
    if (this.isMe) this.body.circle(0, 0, (this.core || r) * 0.84).stroke({ width: Math.max(4, r * 0.07), color: 0xffffff, alpha: 0.9 });
  }

  /** REPAY landed: compress then spring back (presentation only). */
  squash(): void {
    if (!reducedMotion) this.squashUntil = performance.now() + JUICE.REPAY_SQUASH_MS;
  }

  /** Stretch along heading while boosting, squash on REPAY; never under reduced motion. */
  private feel(boosting: boolean): void {
    if (reducedMotion) return;
    this.stretch += ((boosting ? JUICE.BOOST_STRETCH : 0) - this.stretch) * Math.min(1, JUICE.STRETCH_EASE / 60);
    const sq = performance.now() < this.squashUntil ? 1 - JUICE.REPAY_SQUASH : 1;
    this.body.rotation = this.heading;
    this.body.scale.set((1 + this.stretch) * sq, (1 - this.stretch / 2) * sq);
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
    this.membrane(r, 0, true);
    const rr = r + RING_GAP;
    // Ink under every ring (sticker outline): green, amber and red read on any fill and floor.
    const w = v.ring === "red" ? RING_W * 2 : RING_W;
    this.ring.circle(0, 0, rr).stroke({ width: w + 3, color: C.ink, alpha: 0.85 });
    if (v.ring === "yellow") dashed(this.ring, rr, C.ringWarn);
    else this.ring.circle(0, 0, rr).stroke({ width: w, color: v.ring === "red" ? C.liq : C.ringSafe });
    this.shield.circle(0, 0, rr + 7).stroke({ width: 2, color: C.navy, alpha: 0.35 });
  }
}

/** Wobble amplitude in world units grows with speed, so a blob at rest is a clean circle. */
function wobble(r: number, speed: number): number {
  return Math.min(r * 0.035, speed * 0.25);
}

function dashed(g: Graphics, r: number, color: number): void {
  const step = (Math.PI * 2) / DASHES;
  for (let i = 0; i < DASHES; i++) {
    const a = i * step;
    g.moveTo(Math.cos(a) * r, Math.sin(a) * r).arc(0, 0, r, a, a + step * 0.6);
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
