// Juice layer in world space: floating "+40" numbers and shard bursts. Pooled-free on
// purpose: a match spawns a few hundred effects at most, each lives under a second.
// Texts keep a fixed screen size like names do; shards are hard-edged (brand: no glow).
import { Container, Graphics, Text } from "pixi.js";
import { C } from "./colors";
import { JUICE } from "./juice";

interface Fx {
  node: Container;
  life: number;
  ttl: number;
  vx: number;
  vy: number;
  spin: number;
}

export class FxLayer extends Container {
  private items: Fx[] = [];

  /** Rising number at (x, y), e.g. "+40" gold on BOOST. */
  floatText(x: number, y: number, text: string, color: number, zoom: number): void {
    const t = new Text({
      text,
      style: { fontFamily: ["Geist", "system-ui", "sans-serif"], fontWeight: "800", fontSize: JUICE.FLOAT_FONT_PX, fill: color, stroke: { color: C.ink, width: 6, join: "round" } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.scale.set(1 / zoom);
    this.addChild(t);
    this.items.push({ node: t, life: 0, ttl: JUICE.FLOAT_TTL_S, vx: 0, vy: -JUICE.FLOAT_RISE_PX_S / zoom, spin: 0 });
  }

  /** A fading ring left behind a blob burning nitro (the trail). */
  ghost(x: number, y: number, r: number, color: number): void {
    const g = new Graphics().circle(0, 0, r).stroke({ width: Math.max(3, r * 0.08), color, alpha: JUICE.TRAIL_ALPHA });
    g.position.set(x, y);
    this.addChildAt(g, 0);
    this.items.push({ node: g, life: 0, ttl: JUICE.TRAIL_TTL_S, vx: 0, vy: 0, spin: 0 });
  }

  /** A gold spark at (x, y) that flies into (tx, ty) over its life: borrowed money arriving. */
  spark(x: number, y: number, tx: number, ty: number, size: number): void {
    const g = new Graphics().circle(0, 0, size).fill(C.gold).stroke({ width: size * 0.4, color: C.ink, alpha: 0.6 });
    g.position.set(x, y);
    this.addChild(g);
    const ttl = JUICE.SPARK_TTL_S;
    // fx tick damps velocity by 0.92 per frame, so aim a little long to arrive.
    this.items.push({ node: g, life: 0, ttl, vx: ((tx - x) / ttl) * 1.6, vy: ((ty - y) / ttl) * 1.6, spin: 0 });
  }

  /** A faint "+" that drifts from a pellet into my blob: eating registered. */
  mote(x: number, y: number, tx: number, ty: number, zoom: number): void {
    const t = new Text({ text: "+", style: { fontFamily: ["Geist", "system-ui", "sans-serif"], fontWeight: "800", fontSize: 20, fill: C.paper, stroke: { color: C.ink, width: 4 } } });
    t.anchor.set(0.5);
    t.alpha = 0.7;
    t.scale.set(1 / zoom);
    t.position.set(x, y);
    this.addChild(t);
    const ttl = 0.35;
    this.items.push({ node: t, life: 0, ttl, vx: ((tx - x) / ttl) * 1.6, vy: ((ty - y) / ttl) * 1.6, spin: 0 });
  }

  /** n hard-edged shards flying out of (x, y); more shards for a bigger hit. */
  shards(x: number, y: number, n: number, color: number, r: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const s = 6 + Math.random() * 8;
      const g = new Graphics().poly([0, -s, s * 0.7, s, -s * 0.7, s]).fill(color).stroke({ width: 2, color: C.ink });
      g.position.set(x + Math.cos(a) * r, y + Math.sin(a) * r);
      const v = 160 + Math.random() * 220;
      this.addChild(g);
      this.items.push({ node: g, life: 0, ttl: 0.6 + Math.random() * 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, spin: (Math.random() - 0.5) * 12 });
    }
  }

  /** Advance by dt seconds; fade and remove finished effects. */
  tick(dt: number): void {
    this.items = this.items.filter((f) => {
      f.life += dt;
      const k = f.life / f.ttl;
      if (k >= 1) {
        f.node.destroy();
        return false;
      }
      f.node.x += f.vx * dt;
      f.node.y += f.vy * dt;
      f.vx *= 0.92;
      f.vy *= 0.92;
      f.node.rotation += f.spin * dt;
      f.node.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      return true;
    });
  }
}
