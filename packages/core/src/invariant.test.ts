// C4 done-when: 10,000 chaotic ticks x 20 seeds never create or destroy a Micro.
// A cramped arena and twitchy inputs force BOOST, REPAY, spikes, pops, eats and cash-outs.
import { describe, expect, it } from "vitest";
import { MICRO, sToTicks } from "./constants";
import { checkInvariant, debtGap, leakOf } from "./invariant";
import type { InputCmd } from "./protocol";
import { rand, seedRng } from "./rng";
import { step } from "./step";
import { makeBlob, makeWorld } from "./testkit";
import type { PlayerSeed, World } from "./types";
import { newWorld, startMatch } from "./world";

const TICKS_PER_SEED = 10_000;
const SEEDS = 20;

function chaosWorld(seed: number): World {
  const players: PlayerSeed[] = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`, kind: i < 3 ? "human" : i < 7 ? "agent" : "drone", label: `P${i}`, accountId: null,
  }));
  const w = newWorld(seed, seed % 2 ? "free" : "paid", players);
  w.arena = { w: 900, h: 900 };
  w.zone = { cx: 450, cy: 450, r: 640, targetR: 110 };
  startMatch(w, 1, 600 + (seed % 7) * 1000);
  return w;
}

function fuzz(seed: number): Record<string, number> {
  const seen: Record<string, number> = {};
  const r = { rngState: seedRng(seed * 7919) };
  let w = chaosWorld(seed);
  let tick = 1;
  for (let i = 0; i < TICKS_PER_SEED; i++) {
    tick++;
    if (w.phase === "ENDED") {
      w = chaosWorld(seed + i);
      tick = 2;
    }
    const inputs = new Map<string, InputCmd>();
    for (const id of w.blobs.keys()) {
      if (rand(r) < 0.5) continue;
      const a = rand(r) * Math.PI * 2;
      inputs.set(id, {
        seq: tick, dirX: Math.cos(a) * 1.4, dirY: Math.sin(a) * 1.4,
        boost: rand(r) < 0.08, repay: rand(r) < 0.04, cashout: rand(r) < 0.02,
      });
    }
    for (const e of step(w, inputs, tick)) seen[e.type] = (seen[e.type] ?? 0) + 1;
    expect(leakOf(w)).toBe(0); // step already throws; this keeps the failing seed in the report
  }
  for (const e of w.pendingLog) seen[`log:${e.type}`] = (seen[`log:${e.type}`] ?? 0) + 1;
  return seen;
}

describe("conservation fuzz", () => {
  it(`${SEEDS} seeds x ${TICKS_PER_SEED} ticks: 0 Micro created or destroyed`, () => {
    const total: Record<string, number> = {};
    for (let s = 1; s <= SEEDS; s++) {
      for (const [k, v] of Object.entries(fuzz(s))) total[k] = (total[k] ?? 0) + v;
    }
    // The fuzz must actually reach every money path, or a green run proves nothing.
    for (const k of ["boost", "repay", "spikeHit", "pop", "eat", "cashedOut", "matchEnd"]) {
      expect(total[k] ?? 0, k).toBeGreaterThan(0);
    }
  }, 30_000);

  it("checkInvariant catches a created Micro and a vanished debt", () => {
    const a = makeBlob({ mass: 100 * MICRO, debt: 20 * MICRO });
    const w = makeWorld([a]);
    checkInvariant(w);
    a.mass += 1;
    expect(() => checkInvariant(w)).toThrow(/conservation/);
    a.mass -= 1;
    a.debt = 0;
    expect(debtGap(w)).toBe(-20 * MICRO);
    expect(() => checkInvariant(w)).toThrow(/debt unaccounted/);
  });

  it("a full match ends with every Micro paid out or in a house bucket", () => {
    const w = chaosWorld(3);
    for (let t = 2; w.phase !== "ENDED"; t++) step(w, new Map(), t);
    expect(w.food).toEqual([]);
    const paid = [...w.blobs.values()].reduce((s, b) => s + b.payout, 0);
    expect(paid + w.vault.repaid + w.vault.interest + w.fees + w.reserve).toBe(w.pot + w.vault.lent);
    expect(sToTicks(90)).toBe(w.tick - 1);
  });
});
