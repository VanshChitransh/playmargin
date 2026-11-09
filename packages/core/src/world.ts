// Match setup: warm-up ghosts, the GO charge with fair seeded spawns, late joins, ranking.
// Entry is charged only at GO (RULES: Warm-up), and every unit of mass at GO is backed by the pot.
import * as C from "./constants";
import { equity } from "./economy";
import { playPoint, refillFood } from "./food";
import { rand, randInt, seedRng } from "./rng";
import type { Blob, Micro, Mode, PlayerSeed, Spike, World } from "./types";
import { mulBps } from "./units";

/** Spike hit radius in px (feel constant, tune in playtests). */
/** Hitbox radius of a spike in px (drawn the same size): small and big, agar virus style. */
export const spikeRadius = (s: Spike): number => (s.big ? C.R.SPIKE_RADIUS_BIG_PX : C.R.SPIKE_RADIUS_SMALL_PX);

/** Arena side in px for n players: smaller rooms are tighter (2 humans = Duel). */
export function arenaSide(n: number): number {
  return Math.round(C.R.ARENA_SIDE_PER_SQRT_PLAYER * Math.sqrt(Math.max(n, 2)));
}

/** Entry in Micro for this room mode. */
export const entryFor = (mode: Mode): Micro => (mode === "paid" ? C.ENTRY_PAID_MICRO : C.ENTRY_FREE_MICRO);

const startMass = (mode: Mode): Micro => mulBps(entryFor(mode), C.START_MASS_BPS);

function newBlob(p: PlayerSeed, x: number, y: number, mass: Micro): Blob {
  return {
    id: p.id, kind: p.kind, label: p.label, accountId: p.accountId, x, y, dirX: 0, dirY: 0, vx: 0, vy: 0,
    mass, debt: 0, boostFees: 0, payout: 0, pendingBorrow: 0, boostUntil: 0,
    repayReadyAt: 0, shieldUntil: 0, spikeImmuneUntil: 0, redSince: null, lastThreatAt: -1e9,
    cashout: null, state: "alive", lastInput: null, lastInputAt: -1e9,
  };
}

/** Fresh world in WARMUP: ghosts with display mass, nothing charged, pot 0. */
export function newWorld(seed: number, mode: Mode, players: PlayerSeed[], matchId = `m${seed}`): World {
  // Drones hold no stake and pass through blobs, so only players size the map (2 humans = Duel).
  const side = arenaSide(players.filter((p) => p.kind !== "drone").length);
  const w: World = {
    matchId, seed, rngState: seedRng(seed), tick: 0, phase: "WARMUP", goTick: -1, mode,
    arena: { w: side, h: side }, pot: 0,
    vault: { budget: 0, lent: 0, repaid: 0, interest: 0, badDebt: 0 },
    reserve: 0, fees: 0, cashedOut: 0, ratePerMinBps: C.RATE_BASE_BPS,
    blobs: new Map(), food: [], spikes: [],
    zone: { cx: side / 2, cy: side / 2, r: Math.hypot(side, side) / 2, targetR: (side / 2) * C.R.ZONE_FINAL_RADIUS },
    foodPool: 0, nextId: 1, pendingLog: [],
  };
  for (const p of players) addPlayer(w, p);
  return w;
}

/** Spawn ring radius: spread out, but central (the zone pulls everyone in) and clear of every edge. */
const spawnRing = (w: World): number => Math.min(w.arena.w * 0.35, C.R.SPAWN_RING_MAX_PX, w.arena.w / 2 - C.R.SPAWN_EDGE_MARGIN_PX);

/** Join during warm-up (ghost, free to leave) or a late join in the first 15 s of a free match. */
export function addPlayer(w: World, p: PlayerSeed, tick = w.tick): Blob {
  if (w.blobs.has(p.id)) throw new Error(`duplicate player ${p.id}`);
  const a = rand(w) * Math.PI * 2;
  const [x, y] = [w.zone.cx + Math.cos(a) * spawnRing(w), w.zone.cy + Math.sin(a) * spawnRing(w)];
  const b = newBlob(p, x, y, p.kind === "drone" ? 0 : startMass(w.mode));
  w.blobs.set(p.id, b);
  w.pendingLog.push({ type: "JOIN", tick, data: { player: p } });
  if (w.phase === "LIVE") {
    if (w.mode !== "free" || tick - w.goTick >= C.sToTicks(C.R.LATE_JOIN_S)) {
      throw new Error("late join is free rooms, first 15 s only");
    }
    charge(w, b, tick);
    b.shieldUntil = tick + C.sToTicks(C.R.SHIELD_S_LATE_JOIN);
  }
  return b;
}

/** Leave before GO costs nothing. After GO a blob stays in the arena (RULES: disconnects). */
export function removePlayer(w: World, id: string): void {
  if (w.phase === "WARMUP" || w.phase === "COUNTDOWN") w.blobs.delete(id);
}

function charge(w: World, b: Blob, tick: number): void {
  if (b.kind === "drone") return;
  const entry = entryFor(w.mode);
  const mass = startMass(w.mode);
  w.pot += entry;
  w.vault.budget += mulBps(entry, C.LEVERAGE_CAP_BPS - 10_000);
  b.mass = mass;
  w.pendingLog.push({ type: "CHARGE", tick, data: { blob: b.id, entry } });
  w.foodPool += entry - mass; // laid out as pellets by refillFood
}

function placeSpike(w: World, s: Spike): void {
  [s.x, s.y] = playPoint(w);
  s.respawnAt = null;
}

/** GO: charge every entrant, respawn at evenly spaced seeded points, shield, seed food and spikes. */
export function startMatch(w: World, tick: number, ratePerMinBps: number = C.RATE_BASE_BPS): void {
  if (w.phase === "LIVE" || w.phase === "ENDED") throw new Error(`startMatch in ${w.phase}`);
  w.phase = "LIVE";
  w.goTick = tick;
  w.tick = tick;
  w.ratePerMinBps = ratePerMinBps;
  w.pendingLog.push({ type: "MATCH_START", tick, data: { matchId: w.matchId, seed: w.seed, mode: w.mode, ratePerMinBps } });
  const blobs = [...w.blobs.values()];
  // Seeded shuffle so nobody picks a spawn slot by joining order.
  for (let i = blobs.length - 1; i > 0; i--) {
    const j = randInt(w, i + 1);
    [blobs[i], blobs[j]] = [blobs[j] as Blob, blobs[i] as Blob];
  }
  const rot = rand(w) * Math.PI * 2;
  // Evenly spaced on the spawn ring, so nobody starts closer to a rival than anyone else.
  const ringR = spawnRing(w);
  const shield = C.sToTicks(w.mode === "paid" ? C.R.SHIELD_S_PAID : C.R.SHIELD_S);
  blobs.forEach((b, i) => {
    const a = rot + (i / blobs.length) * Math.PI * 2;
    b.x = w.zone.cx + Math.cos(a) * ringR;
    b.y = w.zone.cy + Math.sin(a) * ringR;
    b.vx = b.vy = 0; // respawned at GO: no warm-up momentum carries over
    b.shieldUntil = tick + shield;
    charge(w, b, tick);
  });
  const n = Math.max(3, blobs.length) * C.R.SPIKES_PER_PLAYER;
  for (let i = 0; i < n; i++) {
    const s: Spike = { id: w.nextId++, x: 0, y: 0, big: rand(w) * 10_000 < C.SPIKE_BIG_SHARE_BPS, respawnAt: null };
    placeSpike(w, s);
    w.spikes.push(s);
  }
  refillFood(w);
}

/** Respawn spikes whose 3 s are up, at the next seeded spot. */
export function respawnSpikes(w: World, tick: number): void {
  for (const s of w.spikes) if (s.respawnAt !== null && tick >= s.respawnAt) placeSpike(w, s);
}

/** Blob ids by equity, best first (leaderboard and final ranking). Ties by id for determinism. */
export function ranking(w: World): string[] {
  return [...w.blobs.values()]
    .filter((b) => b.kind !== "drone" && b.state !== "popped")
    .sort((a, b) => (b.state === "cashed" ? b.payout : equity(b)) - (a.state === "cashed" ? a.payout : equity(a)) || (a.id < b.id ? -1 : 1))
    .map((b) => b.id);
}
