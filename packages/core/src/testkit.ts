// Test-only builders for blobs and worlds with sane defaults. Not exported from index.ts,
// so nothing in the server or client can build a World that skipped newWorld.
import { MICRO } from "./constants";
import { seedRng } from "./rng";
import type { Blob, World } from "./types";

/** A live, unshielded human at (500, 500) with 80 mass and full pips. */
export function makeBlob(over: Partial<Blob> = {}): Blob {
  return {
    id: "a", kind: "human", label: "a", accountId: null, x: 500, y: 500, dirX: 0, dirY: 0,
    mass: 80 * MICRO, debt: 0, boostFees: 0, payout: 0, pips: 3, pipReadyAt: [],
    boostUntil: 0, repayReadyAt: 0, shieldUntil: 0, spikeImmuneUntil: 0, redSince: null,
    lastThreatAt: -1e9, cashout: null, state: "alive", lastInput: null, lastInputAt: -1e9,
    ...over,
  };
}

/** A LIVE world (GO at tick 0) whose pot and vault loans back the given blobs exactly. */
export function makeWorld(blobs: Blob[], over: Partial<World> = {}): World {
  const lent = blobs.reduce((s, b) => s + b.debt, 0);
  const pot = blobs.reduce((s, b) => s + b.mass, 0) - lent;
  return {
    matchId: "t", seed: 1, rngState: seedRng(1), tick: 0, phase: "LIVE", goTick: 0, mode: "free",
    arena: { w: 2000, h: 2000 }, pot,
    vault: { budget: Math.floor(pot * 1.5) + lent, lent, repaid: 0, interest: 0, badDebt: 0 },
    reserve: 0, fees: 0, cashedOut: 0, ratePerMinBps: 600,
    blobs: new Map(blobs.map((b) => [b.id, b])), food: [], spikes: [],
    zone: { cx: 1000, cy: 1000, r: 1400, targetR: 1400 }, nextId: 1, pendingLog: [],
    ...over,
  };
}

/** Conservation gap; 0 means conserved. */
export { leakOf as leak } from "./invariant";
