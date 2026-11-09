// C1 done-when: same seed gives the same sequence; distance per second is equal at 30 and 60 Hz.
import { describe, expect, it } from "vitest";
import { MICRO, R } from "./constants";
import { easeS, blobSpeed, move, radius, speed, BASE_SPEED_PX_S } from "./motion";
import { rand, randInt, seedRng } from "./rng";
import type { Blob } from "./types";
import { mulBps, mulDiv, mulDivUp, toMicro, assertMicro } from "./units";

function blob(over: Partial<Blob> = {}): Blob {
  return {
    id: "a", kind: "human", label: "a", accountId: null, x: 500, y: 500, dirX: 1, dirY: 0, vx: 0, vy: 0, boostHeld: false, boostMinUntil: 0, burst: 0, burstReadyAt: 0, sputterUntil: 0, repayQueued: false,
    mass: 80 * MICRO, debt: 0, boostFees: 0, payout: 0, lastInputAt: -1e9, pendingBorrow: 0, boostUntil: 0, repayReadyAt: 0,
    shieldUntil: 0, spikeImmuneUntil: 0, redSince: null, lastThreatAt: -1e9, cashout: null,
    state: "alive", lastInput: null, ...over,
  };
}

describe("rng", () => {
  it("same seed, same sequence; different seed differs", () => {
    const a = { rngState: seedRng(42) };
    const b = { rngState: seedRng(42) };
    const c = { rngState: seedRng(43) };
    const sa = Array.from({ length: 100 }, () => rand(a));
    const sb = Array.from({ length: 100 }, () => rand(b));
    const sc = Array.from({ length: 100 }, () => rand(c));
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
    const h = { rngState: 7 };
    for (let i = 0; i < 1000; i++) expect(randInt(h, 5)).toBeLessThan(5);
  });
});

describe("units", () => {
  it("mulBps floors and rejects overflow", () => {
    expect(mulBps(999, 800)).toBe(79);
    expect(mulBps(120 * MICRO, 800)).toBe(9.6 * MICRO);
    expect(() => mulBps(Number.MAX_SAFE_INTEGER, 10_000)).toThrow();
    expect(mulDiv(10, 1, 3)).toBe(3);
    // Regression (npm run sim): fees x debt of a big blob passes 2^53; must stay exact.
    expect(mulDiv(9_580_665, 958_066_032, 958_066_032)).toBe(9_580_665);
    expect(mulDivUp(9_580_665, 958_066_031, 958_066_032)).toBe(9_580_665);
    expect(mulDiv(2 ** 40, 2 ** 30, 2 ** 30)).toBe(2 ** 40);
    expect(toMicro(1.5)).toBe(1_500_000);
    expect(() => assertMicro(1.5)).toThrow();
    expect(() => assertMicro(-1)).toThrow();
  });
});

describe("motion", () => {
  it("radius follows agar.io-clone", () => {
    expect(radius(100 * MICRO)).toBeCloseTo(64);
  });
  it("start mass moves at base speed; bigger is slower", () => {
    expect(speed(80 * MICRO)).toBeCloseTo(BASE_SPEED_PX_S);
    expect(speed(200 * MICRO)).toBeLessThan(speed(80 * MICRO));
    expect(speed(10 * MICRO)).toBe(BASE_SPEED_PX_S);
  });
  it("distance per second is equal at 30 and 60 Hz", () => {
    const arena = { w: 1e6, h: 1e6 };
    // Already cruising, so easing has nothing to close and only the tick rate differs.
    const cruise = { dirX: 0.6, dirY: 0.8, vx: 0.6 * BASE_SPEED_PX_S, vy: 0.8 * BASE_SPEED_PX_S };
    const b30 = blob(cruise);
    const b60 = blob(cruise);
    for (let i = 0; i < 30; i++) move(b30, 1 / 30, i * 2, arena);
    for (let i = 0; i < 60; i++) move(b60, 1 / 60, i, arena);
    expect(b30.x).toBeCloseTo(b60.x, 6);
    expect(b30.y).toBeCloseTo(b60.y, 6);
    expect(Math.hypot(b60.x - 500, b60.y - 500)).toBeCloseTo(BASE_SPEED_PX_S, 6);
  });
  it("eases: from rest a start blob reaches ~63% of its speed in easeS, and glides to a stop", () => {
    const b = blob({ dirX: 1, dirY: 0 });
    const t = easeS(b);
    expect(t).toBeCloseTo(R.EASE_BASE_S + radius(80 * MICRO) * R.EASE_PER_RADIUS_PX_S);
    const ticks = Math.round(t * 60);
    for (let i = 0; i < ticks; i++) move(b, 1 / 60, i, { w: 1e6, h: 1e6 });
    expect(b.vx / BASE_SPEED_PX_S).toBeGreaterThan(0.6);
    expect(b.vx / BASE_SPEED_PX_S).toBeLessThan(0.66);
    expect(easeS(blob({ mass: 400 * MICRO }))).toBeGreaterThan(t); // big blobs are heavier
    b.dirX = 0;
    for (let i = 0; i < 60; i++) move(b, 1 / 60, 100 + i, { w: 1e6, h: 1e6 });
    expect(b.vx).toBeLessThan(1);
  });
  it("boost runs on equity, so holding nitro never slows you (80 -> 200 mass with 120 debt)", () => {
    const full = blob({ mass: 200 * MICRO, debt: 120 * MICRO, boostUntil: 10 });
    expect(blobSpeed(full, 5)).toBeCloseTo(R.BOOST_SPEED_MULT * BASE_SPEED_PX_S); // 1.5x speed(80 equity)
    expect(blobSpeed(full, 10)).toBeCloseTo(speed(200 * MICRO)); // released: the loan weighs you down
    expect(Math.abs(speed(200 * MICRO) - 395)).toBeLessThan(2); // agar curve, research table
    expect(Math.abs(speed(400 * MICRO) - 340)).toBeLessThan(2);
  });
  it("burst x1.5, cash-out x0.5, dir clamped, arena clamped", () => {
    const b = blob({ boostUntil: 60 });
    expect(blobSpeed(b, 59)).toBeCloseTo(BASE_SPEED_PX_S * R.BOOST_SPEED_MULT);
    expect(blobSpeed(b, 60)).toBeCloseTo(BASE_SPEED_PX_S);
    expect(blobSpeed(blob({ cashout: { startedAt: 0 } }), 0)).toBeCloseTo(BASE_SPEED_PX_S / 2);
    const f = blob({ dirX: 50, dirY: 0, vx: BASE_SPEED_PX_S });
    move(f, 1, 100, { w: 1e6, h: 1e6 });
    expect(f.x - 500).toBeCloseTo(BASE_SPEED_PX_S);
    const e = blob({ dirX: -1, dirY: Number.NaN });
    move(e, 10, 100, { w: 1000, h: 1000 });
    expect(e.x).toBe(500);
    const w = blob({ dirX: -1, dirY: 0 });
    move(w, 10, 100, { w: 1000, h: 1000 });
    expect(w.x).toBe(radius(w.mass) / 2); // centre stops half a radius from the wall
    expect(w.vx).toBe(0);
    const big = blob({ mass: 5000 * MICRO, x: 990, y: 990, dirX: 1, dirY: 1 });
    move(big, 1, 100, { w: 1000, h: 1000 });
    expect([big.x, big.y]).toEqual([1000 - radius(big.mass) / 2, 1000 - radius(big.mass) / 2]); // corner
  });
});
