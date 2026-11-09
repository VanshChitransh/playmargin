// Mapper from engine state to the display-only views in protocol.ts. Money leaves the
// engine only as display units here, never as raw Micro (DEVELOPMENT 0.6, Mapper).
import { MATCH_TICKS, R } from "./constants";
import { equity, matchT, ring } from "./economy";
import { radius } from "./motion";
import type { BlobView, FoodView, MatchView, RateTier, SpikeView } from "./protocol";
import type { Blob, Food, Spike, World } from "./types";
import { toUnits } from "./units";
import { ranking } from "./world";

/** What any client may see of one blob. */
export function blobView(b: Blob, tick: number): BlobView {
  return {
    id: b.id, kind: b.kind, label: b.label, x: b.x, y: b.y, radius: radius(b.mass), ring: ring(b),
    pips: b.pips, owe: toUnits(b.debt), equity: toUnits(b.state === "cashed" ? b.payout : equity(b)),
    shielded: tick < b.shieldUntil, cashingOut: b.cashout !== null, state: b.state,
  };
}

/** Lobby word for the match rate: LOW up to the base, HIGH from the kink rate. */
export function rateTier(ratePerMinBps: number): RateTier {
  if (ratePerMinBps <= Math.round(R.RATE_PER_MIN.base * 10_000)) return "LOW";
  return ratePerMinBps < Math.round(R.RATE_PER_MIN.at_kink * 10_000) ? "MED" : "HIGH";
}

/** Match-level view: phase, clock, zone and the top of the leaderboard. */
export function matchView(w: World): MatchView {
  const t = w.goTick < 0 ? 0 : matchT(w, w.tick);
  return {
    mode: w.mode, phase: w.phase, tick: w.tick,
    timeLeftS: Math.max(0, (MATCH_TICKS - t) / R.TICK_HZ),
    rateTier: rateTier(w.ratePerMinBps), zone: { cx: w.zone.cx, cy: w.zone.cy, r: w.zone.r },
    leaderboard: ranking(w).slice(0, R.LEADERBOARD_TOP),
  };
}

/** A food piece as drawn. */
export function foodView(f: Food): FoodView {
  return { id: f.id, x: f.x, y: f.y, r: radius(f.mass) };
}

/** Live spikes only; a consumed spike is invisible until it respawns. */
export function spikeViews(w: World): SpikeView[] {
  return w.spikes.filter((s: Spike) => s.respawnAt === null).map((s) => ({ id: s.id, x: s.x, y: s.y, big: s.big }));
}

/** This blob's own interest drain in display units per second (the "-0.12/s" under the ring). */
export function drainPerS(w: World, b: Blob): number {
  return toUnits(Math.ceil((b.debt * w.ratePerMinBps) / (10_000 * 60)));
}
