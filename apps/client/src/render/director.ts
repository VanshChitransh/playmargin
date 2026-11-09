// Spectator "director": picks what a camera should look at when there is no player blob.
// Priority: a pop that just happened, a red blob with a bigger hunter close by (a liquidation
// about to happen), a cash-out in progress, else the biggest blob. A shot is held at least
// HOLD_S so the camera does not twitch between candidates.
import type { BlobView, GameEventMsg } from "@margin/core";
import type { Frame } from "../game/frame";

const HOLD_S = 3;
const EVENT_S = 2.5;

export interface Shot {
  x: number;
  y: number;
  /** Radius to frame (the camera zooms to keep it readable). */
  r: number;
}

export class Director {
  private target: string | null = null;
  private since = -Infinity;
  private spot: (Shot & { until: number }) | null = null;

  /** Feed match events: pops and cash-outs pull the camera to where they happened. */
  event(e: GameEventMsg, f: Frame | null, nowS: number): void {
    const id = e.type === "pop" || e.type === "eat" ? e.victim : e.type === "cashedOut" ? e.blob : null;
    const b = id && f?.blobs.find((x) => x.id === id);
    if (b) this.spot = { x: b.x, y: b.y, r: Math.max(b.radius, 80), until: nowS + EVENT_S };
  }

  /** Where the camera should look now. */
  shot(f: Frame, nowS: number): Shot | null {
    if (this.spot && nowS < this.spot.until) return this.spot;
    this.spot = null;
    const alive = f.blobs.filter((b) => b.state === "alive" && b.kind !== "drone");
    if (!alive.length) return null;
    const cur = alive.find((b) => b.id === this.target);
    const best = alive.reduce((a, b) => (score(b, alive) > score(a, alive) ? b : a));
    if (!cur || (best.id !== cur.id && nowS - this.since >= HOLD_S && score(best, alive) > score(cur, alive) * 1.2)) {
      this.target = best.id;
      this.since = nowS;
    }
    const t = alive.find((b) => b.id === this.target) ?? best;
    return { x: t.x, y: t.y, r: t.radius };
  }
}

/** How watchable a blob is right now. */
export function score(b: BlobView, all: BlobView[]): number {
  let s = b.radius;
  if (b.ring === "red" && all.some((h) => h.id !== b.id && h.ring !== "red" && h.radius > b.radius && Math.hypot(h.x - b.x, h.y - b.y) < (h.radius + b.radius) * 3)) s += 1000;
  if (b.cashingOut) s += 600;
  if (b.ring === "yellow") s += 100;
  return s;
}
