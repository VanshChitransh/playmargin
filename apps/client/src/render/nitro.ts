// What holding BOOST feels like on my own blob: in warm-up a free practice inflate toward the
// size full fuel would give (nothing is borrowed, it deflates at GO); in the match a ghost trail
// behind me and a gold "+N" that ticks up while the loan grows. Pure feel, no game state.
import { MICRO, R, radius, type BlobView, type Phase } from "@margin/core";
import type { Container } from "pixi.js";
import { C } from "./colors";
import type { FxLayer } from "./fx";
import { reducedMotion } from "./motion";
import { JUICE } from "./juice";


export class NitroFeel {
  private inflate = 1;
  private sinceTick = 0;
  private sinceTrail = 0;
  private lastOwe = 0;
  private owed = 0;
  private lastPos: { x: number; y: number } | null = null;
  private heading = 0;

  update(me: BlobView | undefined, sprite: Container | undefined, phase: Phase, held: boolean, fx: FxLayer, zoom: number, dt: number): void {
    if (!me || !sprite || me.state !== "alive") return;
    if (this.lastPos && Math.hypot(me.x - this.lastPos.x, me.y - this.lastPos.y) > 0.5) this.heading = Math.atan2(me.y - this.lastPos.y, me.x - this.lastPos.x);
    this.lastPos = { x: me.x, y: me.y };
    // Warm-up practice: grow toward the full-fuel size while held, ease back otherwise.
    const practice = held && phase === "WARMUP";
    const full = radius(Math.round(me.equity * R.LEVERAGE_CAP * MICRO)) / Math.max(me.radius, 1);
    this.inflate += ((practice ? full : 1) - this.inflate) * Math.min(1, dt * (practice ? JUICE.INFLATE_GROW : JUICE.INFLATE_SHRINK));
    sprite.scale.set(this.inflate);

    if (phase !== "LIVE") {
      this.lastOwe = me.owe;
      return;
    }
    const grew = me.owe - this.lastOwe;
    this.lastOwe = me.owe;
    if (grew > 0) this.owed += grew;
    const borrowing = held && grew > 0;
    this.sinceTick += dt;
    if (this.owed >= 1 && (this.sinceTick >= JUICE.NITRO_TICK_S || !held)) {
      fx.floatText(me.x, me.y - me.radius, `+${Math.round(this.owed)}`, C.gold, zoom);
      this.owed = 0;
      this.sinceTick = 0;
    }
    this.sinceTrail += dt;
    if (borrowing && !reducedMotion && this.sinceTrail >= JUICE.NITRO_TRAIL_S) {
      this.sinceTrail = 0;
      fx.ghost(me.x, me.y, me.radius, C.gold);
      for (let i = 0; i < JUICE.SPARKS_PER_TICK; i++) {
        const a = this.heading + Math.PI + (Math.random() - 0.5) * 1.6;
        const d = me.radius * (1.5 + Math.random() * 0.6);
        fx.spark(me.x + Math.cos(a) * d, me.y + Math.sin(a) * d, me.x, me.y, Math.max(4, me.radius * 0.07));
      }
    }
  }
}
