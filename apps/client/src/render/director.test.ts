import { describe, expect, it } from "vitest";
import type { BlobView } from "@margin/core";
import type { Frame } from "../game/frame";
import { Director, score } from "./director";

const blob = (o: Partial<BlobView>): BlobView =>
  ({ id: "a", label: "a", kind: "agent", state: "alive", x: 0, y: 0, radius: 50, equity: 80, owe: 0, ring: "green", cashingOut: false, shielded: false, pips: 3, ...o }) as BlobView;
const frame = (blobs: BlobView[]): Frame => ({ me: "", arena: { w: 1000, h: 1000 }, match: {} as Frame["match"], blobs, food: [], spikes: [] });

describe("director", () => {
  it("rates a red blob with a hunter close by above the biggest blob", () => {
    const red = blob({ id: "r", ring: "red", radius: 40 });
    const hunter = blob({ id: "h", x: 100, radius: 60 });
    const whale = blob({ id: "w", x: 5000, radius: 200 });
    const all = [red, hunter, whale];
    expect(score(red, all)).toBeGreaterThan(score(whale, all));
  });
  it("rates a chase above a bigger blob grazing alone", () => {
    const hunter = blob({ id: "h", radius: 80 });
    const prey = blob({ id: "p", x: 200, radius: 50 });
    const whale = blob({ id: "w", x: 5000, radius: 250 });
    const all = [hunter, prey, whale];
    expect(score(hunter, all)).toBeGreaterThan(score(whale, all));
  });
  it("holds a shot instead of twitching, and jumps to a pop", () => {
    const d = new Director();
    const a = blob({ id: "a", radius: 100 });
    const b = blob({ id: "b", x: 900, radius: 130 });
    expect(d.shot(frame([a]), 0)!.x).toBe(0);
    expect(d.shot(frame([a, b]), 1)!.x).toBe(0); // held
    expect(d.shot(frame([a, b]), 4)!.x).toBe(900); // after HOLD_S
    d.event({ type: "pop", by: "a", victim: "b", bounty: 1, keeper: false }, frame([a, b]), 5);
    expect(d.shot(frame([a]), 5.5)!.x).toBe(900);
  });
  it("after a kill, stays on the killer once the pop shot ends", () => {
    const d = new Director();
    const big = blob({ id: "big", x: 0, radius: 200 });
    const killer = blob({ id: "k", x: 700, radius: 60 });
    const victim = blob({ id: "me", x: 720, radius: 40 });
    d.shot(frame([big, killer, victim]), 0); // director on the biggest blob
    d.event({ type: "pop", by: "k", victim: "me", bounty: 1, keeper: false }, frame([big, killer, victim]), 10);
    expect(d.shot(frame([big, killer]), 11)!.x).toBe(720); // the pop itself
    expect(d.shot(frame([big, killer]), 13)!.x).toBe(700); // then the killer, not the biggest
  });
});
