import { describe, expect, it } from "vitest";
import type { BlobView } from "@margin/core";
import type { Frame } from "../game/frame";
import { interpolate, type Snapshot } from "./interp";

const blob = (x: number): BlobView => ({
  id: "a", kind: "human", label: "a", x, y: 0, radius: 10, ring: "green", pips: 3,
  owe: 0, equity: 80, shielded: false, cashingOut: false, state: "alive",
});
const frame = (x: number): Frame => ({
  me: "a",
  arena: { w: 100, h: 100 },
  match: { mode: "free", phase: "LIVE", tick: 0, timeLeftS: 90, rateTier: "LOW", zone: { cx: 0, cy: 0, r: x }, leaderboard: [] },
  blobs: [blob(x)],
  food: [],
  spikes: [],
});
const snaps: Snapshot[] = [
  { at: 0, frame: frame(0) },
  { at: 50, frame: frame(10) },
  { at: 100, frame: frame(30) },
];

describe("interpolate", () => {
  it("lerps between the snapshots around t", () => {
    expect(interpolate(snaps, 25)!.blobs[0]!.x).toBe(5);
    expect(interpolate(snaps, 75)!.blobs[0]!.x).toBe(20);
    expect(interpolate(snaps, 75)!.match.zone.r).toBe(20);
  });
  it("clamps at both ends and handles empty", () => {
    expect(interpolate(snaps, -10)!.blobs[0]!.x).toBe(0);
    expect(interpolate(snaps, 500)!.blobs[0]!.x).toBe(30);
    expect(interpolate([], 0)).toBeNull();
  });
});
