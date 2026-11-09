// Blob size and movement. Radius from owenashurst/agar.io-clone (MIT, util.massToRadius); the
// speed curve is agar.io's (research/margin/feel/agar-numbers.md). Unlike the original this is
// dt-based, so distance per second is the same at any tick rate.
import { R } from "./constants";
import type { Blob, Micro } from "./types";
import { toUnits } from "./units";

// Feel numbers live in R (constants.ts, mirrored in RULES.html) so a feel spec is one edit there.
/** Speed in px/s of a blob at START mass with no boost. */
export const BASE_SPEED_PX_S = R.BASE_SPEED_PX_S;
const CASHOUT_SPEED_MULT = R.CASHOUT_SPEED_MULT;
/** Liquidator drones must out-run a red blob in its few hundred ms of red, at any bounty mass. */
export const DRONE_SPEED_MULT = R.DRONE_SPEED_MULT;

/** Radius in px for a mass in Micro (agar.io-clone: 4 + sqrt(m) * 6). */
export function radius(mass: Micro): number {
  return 4 + Math.sqrt(toUnits(mass)) * 6;
}

/**
 * Base speed in px/s for a mass in Micro: agar.io's curve, 480 x (r / 58)^-0.45, so bigger is gently
 * slower. Capped at the start speed: a blob shrunk by losses (or boosting on little equity) never darts.
 */
export function speed(mass: Micro): number {
  return BASE_SPEED_PX_S * Math.min(1, Math.pow(radius(mass) / R.SPEED_REF_RADIUS_PX, -R.SPEED_SIZE_EXP));
}

/**
 * Effective px/s right now. Boosting runs at 1.5x speed(equity), not speed(mass): BOOST adds mass,
 * so sizing it on mass made holding nitro slow you down. Unboosted is speed(mass), so a loan you
 * still carry weighs you down after release. Plus the decaying press burst; cash-out halves it.
 */
export function blobSpeed(b: Blob, tick: number): number {
  if (b.kind === "drone") return BASE_SPEED_PX_S * DRONE_SPEED_MULT;
  let s = tick < b.boostUntil ? R.BOOST_SPEED_MULT * speed(Math.max(0, b.mass - b.debt)) : speed(b.mass);
  s += b.burst;
  if (b.cashout) s *= CASHOUT_SPEED_MULT;
  return s;
}

/**
 * Seconds for velocity to close ~63% of the gap to its target: small blobs answer the mouse fast,
 * big ones are heavy (agar feel, no twitch, no float). Drones are machines and turn sharply.
 */
export function easeS(b: Blob, tick = 0): number {
  if (b.kind === "drone") return R.DRONE_EASE_S;
  const r = radius(b.mass);
  // Boosting ramps fast (about 70 ms for a start blob); an empty tank sputters down over ~300 ms;
  // release eases back at the normal, heavier rate.
  if (tick < b.boostUntil) return R.BOOST_EASE_BASE_S + r * R.BOOST_EASE_PER_RADIUS_PX_S;
  if (tick < b.sputterUntil) return R.BOOST_EMPTY_EASE_S;
  return R.EASE_BASE_S + r * R.EASE_PER_RADIUS_PX_S;
}

/**
 * Ease velocity toward dir * speed, move by it, and keep the centre at least WALL_INSET x the
 * current radius from every wall: only a thin slice (15% of the radius) presses past the wall
 * line, where the client gently flattens it.
 */
export function move(b: Blob, dtS: number, tick: number, arena: { w: number; h: number }): void {
  let { dirX, dirY } = b;
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) dirX = dirY = 0;
  const len = Math.hypot(dirX, dirY);
  if (len > 1) {
    dirX /= len;
    dirY /= len;
  }
  const s = blobSpeed(b, tick);
  const k = 1 - Math.exp(-dtS / easeS(b, tick));
  if (b.burst > 0) b.burst = b.burst * Math.exp(-dtS / R.BOOST_BURST_TAU_S) < 1 ? 0 : b.burst * Math.exp(-dtS / R.BOOST_BURST_TAU_S);
  b.vx += (dirX * s - b.vx) * k;
  b.vy += (dirY * s - b.vy) * k;
  const mx = Math.min(radius(b.mass) * R.WALL_INSET_RADII, arena.w / 2);
  const my = Math.min(radius(b.mass) * R.WALL_INSET_RADII, arena.h / 2);
  b.x = Math.min(arena.w - mx, Math.max(mx, b.x + b.vx * dtS));
  b.y = Math.min(arena.h - my, Math.max(my, b.y + b.vy * dtS));
  // A wall stops you dead instead of letting speed build up against it.
  if (b.x === mx || b.x === arena.w - mx) b.vx = 0;
  if (b.y === my || b.y === arena.h - my) b.vy = 0;
}
