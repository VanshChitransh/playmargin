// The soft body flattens on the wall, dents only under a partly overlapping bigger blob,
// and its springs settle on the target.
import { describe, expect, it } from "vitest";
import { Membrane, dentStrength, pointCount, rayEnter, wallDistance } from "./membrane";

const circle = (r: number) => (): number => r;
// r 49 gives an even point count, so index n/2 points exactly left (angle pi).
const left = (m: Membrane): number => m.rad[m.n / 2]!;

describe("membrane", () => {
  it("scales the point count with the radius, within bounds", () => {
    expect(pointCount(10)).toBe(40);
    expect(pointCount(80)).toBeGreaterThan(40);
    expect(pointCount(1000)).toBe(100);
  });

  it("measures the ray to the wall", () => {
    expect(wallDistance(30, 500, -1, 0, 1000, 1000)).toBeCloseTo(30);
    expect(wallDistance(30, 500, 1, 0, 1000, 1000)).toBeCloseTo(970);
  });

  it("flattens against the wall and never crosses it, even while wobbling", () => {
    const m = new Membrane();
    m.target(25, 500, 49, circle(49), 1000, 1000, []);
    m.settleIfNew();
    expect(left(m)).toBeCloseTo(25);
    expect(m.rad[0]).toBeCloseTo(49); // the far side keeps its round shape
    m.kick(400);
    for (let i = 0; i < 30; i++) m.step(1 / 60, true);
    expect(left(m)).toBeLessThanOrEqual(25.001);
  });

  it("dents under a partly overlapping bigger blob, fades out by half overlap", () => {
    expect(dentStrength(150, 50, 100)).toBe(0); // just touching
    expect(dentStrength(130, 50, 100)).toBe(1); // 20% overlap
    expect(dentStrength(100, 50, 100)).toBe(0); // 50%: covered, no broken shape
    const m = new Membrane();
    m.target(500, 500, 49, circle(49), 1000, 1000, [{ x: 630, y: 500, r: 100 }]);
    m.settleIfNew();
    expect(m.rad[0]).toBeLessThan(45); // facing the big blob
    expect(left(m)).toBeCloseTo(49); // the other side untouched
    expect(rayEnter(0, 0, 1, 0, { x: 130, y: 0, r: 100 })).toBeCloseTo(30);
  });

  it("springs settle on the target, and reduced motion snaps there", () => {
    const m = new Membrane();
    m.target(500, 500, 50, circle(50), 1000, 1000, []);
    m.settleIfNew();
    m.target(500, 500, 60, circle(60), 1000, 1000, []);
    for (let i = 0; i < 240; i++) m.step(1 / 60, true);
    expect(m.rad[0]).toBeCloseTo(60, 1);
    expect(m.moving()).toBe(false);
    m.target(500, 500, 40, circle(40), 1000, 1000, []);
    m.step(1 / 60, false);
    expect(m.rad[0]).toBeCloseTo(40);
  });
});
