// Garbage and floods must never become movement.
import { describe, expect, it } from "vitest";
import { INPUT_MAX_PER_S, InputQueue, RateLimit, parseInput } from "./input";

const ok = { seq: 1, dirX: 0.6, dirY: -0.8, boost: false, repay: false, cashout: false };

describe("parseInput", () => {
  it("accepts a valid command", () => expect(parseInput(ok)).toEqual(ok));
  it.each([
    null,
    "x",
    42,
    [],
    { ...ok, dirX: NaN },
    { ...ok, dirX: Infinity },
    { ...ok, dirX: 1, dirY: 1 },
    { ...ok, dirX: "1" },
    { ...ok, seq: 1.5 },
    { ...ok, boost: 1 },
    { dirX: 0, dirY: 0 },
  ])("rejects %j", (bad) => expect(parseInput(bad)).toBeNull());
});

describe("RateLimit", () => {
  it("allows 30 per second, then resets", () => {
    const rl = new RateLimit();
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (rl.allow(5000)) allowed++;
    expect(allowed).toBe(INPUT_MAX_PER_S);
    expect(rl.allow(6000)).toBe(true);
  });
});

describe("InputQueue", () => {
  it("merges taps, keeps BOOST as the latest held state, then empties, and ignores closed players", () => {
    const q = new InputQueue();
    q.open("a");
    q.push("a", { ...ok, boost: true, repay: true }, 0);
    q.push("a", { ...ok, seq: 2, boost: false, repay: false }, 0);
    expect(q.take().get("a")).toMatchObject({ seq: 2, boost: false, repay: true, dirX: 0.6 });
    q.push("a", { ...ok, seq: 3, boost: true }, 0);
    expect(q.take().get("a")).toMatchObject({ boost: true });
    expect(q.take().has("a")).toBe(false);
    q.close("a");
    q.push("a", ok, 0);
    expect(q.take().has("a")).toBe(false);
  });
});
