// Food placement. Every Micro that leaves a blob without an owner (scatter, interest, zone,
// spike shards) becomes food here, so mass is never created or destroyed (RULES: food from the pot).
import { MICRO, R } from "./constants";
import { rand } from "./rng";
import type { Micro, World } from "./types";

/** Target size of one food piece; big amounts split into at most MAX_PIECES (fewer, heavier shards
 *  keep the map from flooding: agar.io shows 3 to 7 pellets per megapixel of screen). */
const PIECE: Micro = 4 * MICRO;
const MAX_PIECES = 6;
/** Share of refilled pellets that land near an existing pellet (loose clusters), the rest anywhere. */
const CLUSTER_SHARE = 0.6;
const CLUSTER_R = 320;

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

/**
 * Random point in the play area: the disc of PLAY_RADIUS_PX around the zone centre (smaller once the
 * zone shrinks inside it). Food and spikes live here, so a map many screens wide keeps the action together.
 */
export function playPoint(w: World): [number, number] {
  const a = rand(w) * Math.PI * 2;
  const d = Math.sqrt(rand(w)) * Math.min(R.PLAY_RADIUS_PX, w.zone.r, w.arena.w / 2);
  return clampToArena(w, w.zone.cx + Math.cos(a) * d, w.zone.cy + Math.sin(a) * d);
}

/**
 * Top the map up to FOOD_ON_MAP_PER_PLAYER pellets per player from the food pool (entry food,
 * interest and zone damage all pool there first), one FOOD_PELLET_UNITS pellet at a time. The map
 * never floods (agar shows 3 to 7 pellets per screen megapixel) and never empties while the pool
 * lasts. Most pellets land near an existing one, so loose clusters form like agar's feeding areas.
 */
export function refillFood(w: World): void {
  const pellet = Math.round(R.FOOD_PELLET_UNITS * MICRO);
  let players = 0;
  for (const b of w.blobs.values()) if (b.kind !== "drone") players++;
  const target = R.FOOD_ON_MAP_PER_PLAYER * players;
  while (w.food.length < target && w.foodPool >= pellet) {
    w.foodPool -= pellet;
    const near = w.food.length > 0 && rand(w) < CLUSTER_SHARE ? w.food[Math.floor(rand(w) * w.food.length)] : undefined;
    let [x, y] = playPoint(w);
    if (near) {
      const a = rand(w) * Math.PI * 2;
      const d = Math.sqrt(rand(w)) * CLUSTER_R;
      [x, y] = clampToArena(w, near.x + Math.cos(a) * d, near.y + Math.sin(a) * d);
    }
    w.food.push({ id: w.nextId++, x, y, mass: pellet });
  }
}
