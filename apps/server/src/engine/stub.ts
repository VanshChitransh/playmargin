// Stand-in for core's newWorld/step/ring until C2 and C3 land on main: blobs only move.
// Same signatures as @margin/core so the swap is an import change in MatchRoom.ts.
// ponytail: no money rules here on purpose; delete this file once core.step is real.
import {
  ENTRY_FREE_MICRO,
  ENTRY_PAID_MICRO,
  HF_GREEN_BPS,
  HF_RED_BPS,
  LEVERAGE_CAP_BPS,
  LT_BPS,
  R,
  START_MASS_BPS,
  move,
  mulBps,
  rand,
  seedRng,
  sToTicks,
  type Blob,
  type GameEventMsg,
  type InputCmd,
  type Mode,
  type PlayerSeed,
  type Ring,
  type World,
} from "@margin/core";

export const ARENA = { w: 2000, h: 2000 };
const DT_S = 1 / R.TICK_HZ;

/** A blob at rest with start mass, no debt, all pips lit. */
export function makeBlob(p: PlayerSeed, x: number, y: number, mode: Mode): Blob {
  const entry = mode === "paid" ? ENTRY_PAID_MICRO : ENTRY_FREE_MICRO;
  return {
    ...p,
    x,
    y,
    dirX: 0,
    dirY: 0,
    mass: mulBps(entry, START_MASS_BPS),
    debt: 0,
    boostFees: 0,
    payout: 0,
    pips: R.BOOST_PIPS,
    pipReadyAt: [],
    boostUntil: 0,
    repayReadyAt: 0,
    shieldUntil: 0,
    spikeImmuneUntil: 0,
    redSince: null,
    lastThreatAt: 0,
    cashout: null,
    state: "alive",
    lastInput: null,
    lastInputAt: -1,
  };
}

/** Fresh LIVE world: players evenly spaced on a seeded ring, shielded for SHIELD_S. */
export function newWorld(seed: number, mode: Mode, players: PlayerSeed[]): World {
  const entry = mode === "paid" ? ENTRY_PAID_MICRO : ENTRY_FREE_MICRO;
  const pot = entry * players.length;
  const w: World = {
    matchId: `m${seed}`,
    seed,
    rngState: seedRng(seed),
    tick: 0,
    phase: "LIVE",
    goTick: 0,
    mode,
    arena: ARENA,
    pot,
    vault: { budget: mulBps(pot, LEVERAGE_CAP_BPS - 10_000), lent: 0, repaid: 0, interest: 0 },
    reserve: 0,
    fees: 0,
    cashedOut: 0,
    ratePerMinBps: 0,
    blobs: new Map(),
    food: [],
    spikes: [],
    zone: { cx: ARENA.w / 2, cy: ARENA.h / 2, r: ARENA.w, targetR: ARENA.w },
    nextId: 1,
    pendingLog: [],
  };
  const turn = rand(w) * Math.PI * 2;
  const shield = sToTicks(mode === "paid" ? R.SHIELD_S_PAID : R.SHIELD_S);
  players.forEach((p, i) => {
    const a = turn + (i / players.length) * Math.PI * 2;
    const b = makeBlob(p, ARENA.w / 2 + Math.cos(a) * ARENA.w * 0.35, ARENA.h / 2 + Math.sin(a) * ARENA.h * 0.35, mode);
    b.shieldUntil = shield;
    w.blobs.set(b.id, b);
  });
  return w;
}

/** Steer every alive blob from its input and move it one tick; ends at MATCH_TICKS. */
export function step(world: World, inputs: Map<string, InputCmd>, tick: number): GameEventMsg[] {
  world.tick = tick;
  for (const b of world.blobs.values()) {
    if (b.state !== "alive") continue;
    const cmd = inputs.get(b.id);
    b.dirX = cmd?.dirX ?? 0;
    b.dirY = cmd?.dirY ?? 0;
    move(b, DT_S, tick, world.arena);
  }
  if (tick >= sToTicks(R.MATCH_S)) {
    world.phase = "ENDED";
    return [{ type: "matchEnd", tick }];
  }
  return [];
}

/** Health ring from HF = mass * LT / debt (no debt = green). */
export function ring(b: Blob): Ring {
  if (b.debt === 0) return "green";
  const hfBps = Math.floor((b.mass * LT_BPS) / b.debt);
  return hfBps >= HF_GREEN_BPS ? "green" : hfBps >= HF_RED_BPS ? "yellow" : "red";
}
