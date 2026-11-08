// C1 done-when: same seed gives the same sequence; distance per second is equal at 30 and 60 Hz.
import { describe, expect, it } from "vitest";
import { MICRO, R } from "./constants";
import { blobSpeed, move, radius, speed, BASE_SPEED_PX_S } from "./motion";
import { rand, randInt, seedRng } from "./rng";
import type { Blob } from "./types";
import { mulBps, mulDiv, toMicro, assertMicro } from "./units";

function blob(over: Partial<Blob> = {}): Blob {
  return {
    id: "a", kind: "human", label: "a", accountId: null, x: 500, y: 500, dirX: 1, dirY: 0,
    mass: 80 * MICRO, debt: 0, pips: 3, pipReadyAt: [], boostUntil: 0, repayReadyAt: 0,
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
    const b30 = blob({ dirX: 0.6, dirY: 0.8 });
    const b60 = blob({ dirX: 0.6, dirY: 0.8 });
    for (let i = 0; i < 30; i++) move(b30, 1 / 30, i * 2, arena);
    for (let i = 0; i < 60; i++) move(b60, 1 / 60, i, arena);
    expect(b30.x).toBeCloseTo(b60.x, 6);
    expect(b30.y).toBeCloseTo(b60.y, 6);
    expect(Math.hypot(b60.x - 500, b60.y - 500)).toBeCloseTo(BASE_SPEED_PX_S, 6);
  });
  it("burst x1.5, cash-out x0.5, dir clamped, arena clamped", () => {
    const b = blob({ boostUntil: 60 });
    expect(blobSpeed(b, 59)).toBeCloseTo(BASE_SPEED_PX_S * R.BOOST_SPEED_MULT);
    expect(blobSpeed(b, 60)).toBeCloseTo(BASE_SPEED_PX_S);
    expect(blobSpeed(blob({ cashout: { startedAt: 0 } }), 0)).toBeCloseTo(BASE_SPEED_PX_S / 2);
    const f = blob({ dirX: 50, dirY: 0 });
    move(f, 1, 100, { w: 1e6, h: 1e6 });
    expect(f.x - 500).toBeCloseTo(BASE_SPEED_PX_S);
    const e = blob({ dirX: -1, dirY: Number.NaN });
    move(e, 10, 100, { w: 1000, h: 1000 });
    expect(e.x).toBe(500);
    const w = blob({ dirX: -1, dirY: 0 });
    move(w, 10, 100, { w: 1000, h: 1000 });
    expect(w.x).toBe(0);
  });
});
