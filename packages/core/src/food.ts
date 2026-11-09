// Food placement. Every Micro that leaves a blob without an owner (scatter, interest, zone,
// spike shards) becomes food here, so mass is never created or destroyed (RULES: food from the pot).
import { MICRO } from "./constants";
import { rand, randRange } from "./rng";
import type { Micro, World } from "./types";

/** Target size of one food piece; big amounts split into at most MAX_PIECES. */
const PIECE: Micro = MICRO;
const MAX_PIECES = 12;

function clampToArena(w: World, x: number, y: number): [number, number] {
  return [Math.min(w.arena.w, Math.max(0, x)), Math.min(w.arena.h, Math.max(0, y))];
}

/**
 * Split amount into food pieces in a ring around (x, y): from minR to minR + spread px.
 * Exact: pieces sum to amount. minR keeps shards out from under the blob that lost them.
 */
export function scatterFood(w: World, amount: Micro, x: number, y: number, spread: number, minR = 0): void {
  if (amount <= 0) return;
  const n = Math.max(1, Math.min(MAX_PIECES, Math.floor(amount / PIECE)));
  const each = Math.floor(amount / n);
  for (let i = 0; i < n; i++) {
    const m = i === n - 1 ? amount - each * (n - 1) : each;
    const a = rand(w) * Math.PI * 2;
    const d = minR + rand(w) * spread;
    const [fx, fy] = clampToArena(w, x + Math.cos(a) * d, y + Math.sin(a) * d);
    w.food.push({ id: w.nextId++, x: fx, y: fy, mass: m });
  }
}

/** Drop amount as one piece at a random spot inside the zone at least minDist px from (ax, ay). */
export function spawnFoodInZone(w: World, amount: Micro, ax: number, ay: number, minDist: number): void {
  if (amount <= 0) return;
  const { cx, cy, r } = w.zone;
  let x = cx;
  let y = cy;
  // ponytail: 8 tries then accept the last spot; fine while the zone is much bigger than minDist.
  for (let i = 0; i < 8; i++) {
    const a = rand(w) * Math.PI * 2;
    const d = Math.sqrt(rand(w)) * r;
    x = cx + Math.cos(a) * d;
    y = cy + Math.sin(a) * d;
    if (Math.hypot(x - ax, y - ay) >= minDist) break;
  }
  const [fx, fy] = clampToArena(w, x, y);
  w.food.push({ id: w.nextId++, x: fx, y: fy, mass: amount });
}

/** Random point in the arena, for the opening food seed. */
export function randomPoint(w: World): [number, number] {
  return [randRange(w, 0, w.arena.w), randRange(w, 0, w.arena.h)];
}
