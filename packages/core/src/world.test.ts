// addPlayer is atomic: a refused join (late, paid room, ended match, duplicate id) leaves the world
// exactly as it was, so the next step() still conserves money (red team L4-01: an uncharged blob
// left behind threw "conservation broken" every tick and hung the server).
import { describe, expect, it } from "vitest";
import { R, sToTicks } from "./constants";
import { checkInvariant } from "./invariant";
import { step } from "./step";
import type { Mode, PlayerSeed, World } from "./types";
import { addPlayer, newWorld, startMatch } from "./world";

const seeds = (n: number): PlayerSeed[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: "human", label: `P${i}`, accountId: null }));
const late: PlayerSeed = { id: "late", kind: "human", label: "Late", accountId: null };

function liveWorld(mode: Mode): World {
  const w = newWorld(7, mode, seeds(3));
  startMatch(w, 10);
  return w;
}

function expectRefusedUnchanged(w: World, p: PlayerSeed, tick: number, msg: string): void {
  const before = structuredClone(w);
  expect(() => addPlayer(w, p, tick)).toThrow(msg);
  expect(w).toEqual(before); // blobs, pendingLog, rngState, pot, vault, foodPool: all untouched
  checkInvariant(w);
}

describe("addPlayer refuses before it mutates", () => {
  it("late join at 15 s in a free room throws and leaves the world unchanged, next step conserves", () => {
    const w = liveWorld("free");
    const t = w.goTick + sToTicks(R.LATE_JOIN_S);
    expectRefusedUnchanged(w, late, t, "late join is free rooms, first 15 s only");
    expect(w.blobs.has("late")).toBe(false);
    expect(() => step(w, new Map(), t)).not.toThrow();
  });

  it("any late join into a paid room throws and leaves the world unchanged", () => {
    const w = liveWorld("paid");
    expectRefusedUnchanged(w, late, w.goTick + 1, "late join is free rooms, first 15 s only");
    expect(() => step(w, new Map(), w.goTick + 1)).not.toThrow();
  });

  it("a join into an ENDED match and a duplicate id both throw and leave the world unchanged", () => {
    const w = liveWorld("free");
    expectRefusedUnchanged(w, { ...late, id: "p0" }, w.goTick + 1, "duplicate player p0");
    w.phase = "ENDED";
    expectRefusedUnchanged(w, late, w.goTick + 1, "late join is free rooms, first 15 s only");
  });

  it("the last tick of the window still joins, charged and conserved", () => {
    const w = liveWorld("free");
    const t = w.goTick + sToTicks(R.LATE_JOIN_S) - 1;
    const pot = w.pot;
    addPlayer(w, late, t);
    expect(w.pot).toBeGreaterThan(pot);
    expect(() => step(w, new Map(), t)).not.toThrow();
  });
});
