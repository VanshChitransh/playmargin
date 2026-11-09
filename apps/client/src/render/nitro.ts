// What holding BOOST feels like on my own blob: in warm-up a free practice inflate toward the
// size full fuel would give (nothing is borrowed, it deflates at GO); in the match a ghost trail
// behind me and a gold "+N" that ticks up while the loan grows. Pure feel, no game state.
import { MICRO, R, radius, type BlobView, type Phase } from "@margin/core";
import type { Container } from "pixi.js";
import { C } from "./colors";
import type { FxLayer } from "./fx";

const TICK_S = 0.3; // how often the "+N" ticks while borrowing
const TRAIL_S = 0.05;

export class NitroFeel {
  private inflate = 1;
  private sinceTick = 0;
  private sinceTrail = 0;
  private lastOwe = 0;
  private owed = 0;

  update(me: BlobView | undefined, sprite: Container | undefined, phase: Phase, held: boolean, fx: FxLayer, zoom: number, dt: number): void {
    if (!me || !sprite || me.state !== "alive") return;
    // Warm-up practice: grow toward the full-fuel size while held, ease back otherwise.
    const practice = held && phase === "WARMUP";
    const full = radius(Math.round(me.equity * R.LEVERAGE_CAP * MICRO)) / Math.max(me.radius, 1);
    this.inflate += ((practice ? full : 1) - this.inflate) * Math.min(1, dt * (practice ? 2.5 : 6));
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
    if (this.owed >= 1 && (this.sinceTick >= TICK_S || !held)) {
      fx.floatText(me.x, me.y - me.radius, `+${Math.round(this.owed)}`, C.gold, zoom);
      this.owed = 0;
      this.sinceTick = 0;
    }
    this.sinceTrail += dt;
    if (borrowing && this.sinceTrail >= TRAIL_S) {
      this.sinceTrail = 0;
      fx.ghost(me.x, me.y, me.radius, C.gold);
    }
  }
}
