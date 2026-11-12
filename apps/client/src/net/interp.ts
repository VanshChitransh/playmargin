// Snapshot interpolation: render 100 ms in the past and lerp between the two server
// snapshots around that moment, so 20 Hz patches look like 60 fps motion. Idea from
// vzhou842/example-.io-game src/client/state.js (MIT). My own blob is predicted instead (predict.ts).
import type { BlobView } from "@margin/core";
import type { Frame } from "../game/frame";

export const RENDER_DELAY_MS = 100;
const KEEP = 30;

export interface Snapshot {
  /** Client clock (ms) the patch arrived. */
  at: number;
  frame: Frame;
}

export class SnapshotBuffer {
  private snaps: Snapshot[] = [];

  push(s: Snapshot): void {
    this.snaps.push(s);
    if (this.snaps.length > KEEP) this.snaps.shift();
  }

  /** The newest server state as received (no render delay): prediction reads my blob from it. */
  latest(): Frame | null {
    return this.snaps[this.snaps.length - 1]?.frame ?? null;
  }

  /** Interpolated frame for display at nowMs, or null before the first patch. */
  frameAt(nowMs: number): Frame | null {
    return interpolate(this.snaps, nowMs - RENDER_DELAY_MS);
  }
}

/** Frame at render time t: lerp positions and radius of blobs present in both snapshots. */
export function interpolate(snaps: Snapshot[], t: number): Frame | null {
  if (snaps.length === 0) return null;
  const last = snaps[snaps.length - 1]!;
  if (t >= last.at) return last.frame; // starved: hold the newest instead of extrapolating
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1]!.at > t) i--;
  if (i === 0) return snaps[0]!.frame;
  const a = snaps[i - 1]!;
  const b = snaps[i]!;
  const k = (t - a.at) / (b.at - a.at || 1);
  const prev = new Map(a.frame.blobs.map((x) => [x.id, x]));
  const blobs: BlobView[] = b.frame.blobs.map((nb) => {
    const ob = prev.get(nb.id);
    if (!ob) return nb;
    return { ...nb, x: lerp(ob.x, nb.x, k), y: lerp(ob.y, nb.y, k), radius: lerp(ob.radius, nb.radius, k) };
  });
  const z0 = a.frame.match.zone;
  const z1 = b.frame.match.zone;
  const zone = { cx: lerp(z0.cx, z1.cx, k), cy: lerp(z0.cy, z1.cy, k), r: lerp(z0.r, z1.r, k) };
  return { ...b.frame, blobs, match: { ...b.frame.match, zone } };
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
