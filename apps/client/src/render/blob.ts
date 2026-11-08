// One blob: body + health ring + label. Ring state is shown by shape AND colour
// (solid green, dashed yellow, pulsing red with a warning sign) so colour-blind
// players read it too (inspiration.md principle 2). Agents are cyan, drones hollow hexes.
import { Container, Graphics, Text } from "pixi.js";
import type { BlobView, Ring } from "@margin/core";
import { C } from "./colors";

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

  constructor(v: BlobView, isMe: boolean) {
    super();
    const name = v.kind === "agent" ? `🤖 ${v.label}` : v.label;
    this.nameText = new Text({
      text: name,
      style: { fontFamily: "Rubik", fontSize: 14, fontWeight: "500", fill: v.kind === "human" ? C.paper : C.agent },
    });
    this.nameText.anchor.set(0.5);
    this.warnSign = new Text({ text: "⚠", style: { fontSize: 18, fill: C.liq } });
    this.warnSign.anchor.set(0.5);
    this.body.alpha = isMe ? 0.95 : 0.8;
    this.addChild(this.shield, this.body, this.ring, this.nameText, this.warnSign);
  }

  /** Sync to a view; tS is seconds since start, used only for pulses. */
  update(v: BlobView, tS: number, isMe: boolean): void {
    this.position.set(v.x, v.y);
    this.visible = v.state === "alive";
    if (!this.visible) return;
    // Redraw geometry only when it visibly changes; 12 blobs, but phones count.
    if (Math.abs(v.radius - this.drawn.r) > 0.5 || v.ring !== this.drawn.ring || v.kind !== this.drawn.kind) {
      this.redraw(v, isMe);
    }
    const r = v.radius + RING_GAP;
    this.nameText.position.set(0, r + 14);
    this.warnSign.visible = v.ring === "red" && v.kind !== "drone";
    this.warnSign.position.set(0, -r - 14);
    this.shield.visible = v.shielded;
    // Red pulses fast (heartbeat), yellow breathes slowly, green is still.
    const hz = v.ring === "red" ? 4 : v.ring === "yellow" ? 1 : 0;
    const p = hz ? 0.5 + 0.5 * Math.sin(tS * hz * Math.PI * 2) : 1;
    this.ring.alpha = hz ? 0.55 + 0.45 * p : 1;
    this.ring.scale.set(v.ring === "red" ? 1 + 0.05 * p : 1);
    this.warnSign.alpha = 0.6 + 0.4 * p;
  }

  private redraw(v: BlobView, isMe: boolean): void {
    this.drawn = { r: v.radius, ring: v.ring, kind: v.kind };
    const r = v.radius;
    this.body.clear();
    this.ring.clear();
    this.shield.clear();
    if (v.kind === "drone") {
      // Drones cannot eat or be eaten, so they get no body and no ring.
      this.body.poly(hex(r)).stroke({ width: 3, color: C.agent, alpha: 0.9 });
      return;
    }
    const fill = v.kind === "agent" ? C.agent : isMe ? C.paper : C.muted;
    this.body.circle(0, 0, r).fill({ color: fill, alpha: 0.85 });
    const rr = r + RING_GAP;
    if (v.ring === "yellow") dashed(this.ring, rr, C.warn);
    else this.ring.circle(0, 0, rr).stroke({ width: v.ring === "red" ? RING_W + 2 : RING_W, color: v.ring === "red" ? C.liq : C.safe });
    this.shield.circle(0, 0, rr + 6).stroke({ width: 2, color: C.paper, alpha: 0.35 });
  }
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
