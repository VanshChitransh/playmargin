// Blob size and movement. Formulas adapted from owenashurst/agar.io-clone (MIT):
// util.massToRadius and the log slow-down in player.js. Unlike the original this is
// dt-based, so distance per second is the same at any tick rate.
import { R } from "./constants";
import type { Blob, Micro } from "./types";
import { toUnits } from "./units";

// Feel constants, not money: tune here during playtests (RULES lists BOOST speed as open).
/** Speed in px/s of a blob at START mass with no boost. */
export const BASE_SPEED_PX_S = 300;
/** agar.io-clone slowBase: bigger blobs are slower by log base 4.5 of their mass. */
const SLOW_BASE = 4.5;
/** Start mass in units; the slow-down is anchored here so everyone starts at base speed. */
const START_UNITS = R.ENTRY_FREE * R.START_MASS_RATIO;
const START_LOG = Math.log(START_UNITS) / Math.log(SLOW_BASE);
const CASHOUT_SPEED_MULT = 0.5;
/** Liquidator drones must out-run a red blob in its few hundred ms of red, at any bounty mass. */
export const DRONE_SPEED_MULT = 1.6;

/** Radius in px for a mass in Micro (agar.io-clone: 4 + sqrt(m) * 6). */
export function radius(mass: Micro): number {
  return 4 + Math.sqrt(toUnits(mass)) * 6;
}

/** Base speed in px/s for a mass in Micro, before burst and cash-out multipliers. */
export function speed(mass: Micro): number {
  const units = Math.max(toUnits(mass), 1);
  const slowDown = Math.max(1, Math.log(units) / Math.log(SLOW_BASE) - START_LOG + 1);
  return BASE_SPEED_PX_S / slowDown;
}

/** Effective px/s for this blob right now (BOOST burst x1.5, cash-out channel x0.5). */
export function blobSpeed(b: Blob, tick: number): number {
  if (b.kind === "drone") return BASE_SPEED_PX_S * DRONE_SPEED_MULT;
  let s = speed(b.mass);
  if (tick < b.boostUntil) s *= R.BOOST_SPEED_MULT;
  if (b.cashout) s *= CASHOUT_SPEED_MULT;
  return s;
}

/**
 * Seconds for velocity to close ~63% of the gap to its target: small blobs answer the mouse fast,
 * big ones are heavy (agar feel, no twitch, no float). Drones are machines and turn sharply.
 */
export function easeS(b: Blob): number {
  return b.kind === "drone" ? 0.06 : 0.08 + radius(b.mass) / 1000;
}

/** Ease velocity toward dir * speed, move by it, and keep the blob's centre inside the arena. */
export function move(b: Blob, dtS: number, tick: number, arena: { w: number; h: number }): void {
  let { dirX, dirY } = b;
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) dirX = dirY = 0;
  const len = Math.hypot(dirX, dirY);
  if (len > 1) {
    dirX /= len;
    dirY /= len;
  }
  const s = blobSpeed(b, tick);
  const k = 1 - Math.exp(-dtS / easeS(b));
  b.vx += (dirX * s - b.vx) * k;
  b.vy += (dirY * s - b.vy) * k;
  b.x = Math.min(arena.w, Math.max(0, b.x + b.vx * dtS));
  b.y = Math.min(arena.h, Math.max(0, b.y + b.vy * dtS));
  // A wall stops you dead instead of letting speed build up against it.
  if (b.x === 0 || b.x === arena.w) b.vx = 0;
  if (b.y === 0 || b.y === arena.h) b.vy = 0;
}
