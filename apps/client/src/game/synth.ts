// Synthetic frames so the renderer and HUD can be built before the server exists.
// Pure function of time: 12 blobs (me, humans, agents, one drone) wander, borrow and
// repay on a loop so every ring state and spike warning shows up within a few seconds.
// Swap for fixtures/frames.json (S1, C3) or live snapshots (U2) without touching render/.
import { MICRO, R, radius, type BlobView, type Ring } from "@margin/core";
import type { Frame, FoodView, SpikeView } from "./frame";

const W = 3000;
const H = 3000;
const START = R.ENTRY_FREE * R.START_MASS_RATIO;

const KINDS: BlobView["kind"][] = ["human", "human", "human", "human", "human", "human", "human", "agent", "agent", "agent", "agent", "drone"];
const NAMES = ["you", "riya", "kabir", "zoe", "max", "anon42", "lena", "Agent-1", "Agent-2", "Agent-3", "Agent-4", "Drone-1"];

// Fixed-seed positions so the layout is stable across reloads (no Math.random).
const hash = (i: number): number => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const food: FoodView[] = Array.from({ length: 200 }, (_, i) => ({
  id: i,
  x: 100 + hash(i + 1) * (W - 200),
  y: 100 + hash(i + 501) * (H - 200),
  r: 6 + hash(i + 901) * 4,
}));

const spikes: SpikeView[] = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  x: 200 + hash(i + 2001) * (W - 400),
  y: 200 + hash(i + 3001) * (H - 400),
  big: hash(i + 4001) < R.SPIKE_BIG_SHARE,
}));

const ringOf = (equity: number, owe: number): Ring => {
  if (owe <= 0) return "green";
  const hf = ((equity + owe) * R.LT) / owe;
  return hf >= R.HF_GREEN ? "green" : hf >= R.HF_RED ? "yellow" : "red";
};

/** Frame at tS seconds; me cycles 0 to 3 pips then loses equity, so spikes flip to red. */
export function synthFrame(tS: number): Frame {
  const loop = tS % R.MATCH_S;
  const blobs: BlobView[] = KINDS.map((kind, i) => {
    const phase = hash(i + 7000) * Math.PI * 2;
    const orbit = 300 + hash(i + 8000) * 900;
    const sp = 0.08 + hash(i + 9000) * 0.12;
    const x = W / 2 + Math.cos(tS * sp + phase) * orbit;
    const y = H / 2 + Math.sin(tS * sp * 1.3 + phase) * orbit * 0.8;
    // Borrow cycle: 0..3 pips over 12 s, then a 70% equity loss that walks green, yellow, red.
    const c = (tS + i * 3) % 16;
    const pips = Math.min(3, Math.floor(c / 3));
    let equity = START * (1 + 0.3 * Math.sin(tS * 0.2 + i));
    const owe = equity * 0.5 * pips;
    if (c > 12) equity *= 1 - 0.7 * Math.min(1, (c - 12) / 3);
    const mass = equity + owe;
    return {
      id: `b${i}`,
      kind,
      label: NAMES[i]!,
      x,
      y,
      radius: kind === "drone" ? 28 : radius(Math.round(mass * MICRO)),
      ring: kind === "drone" ? "green" : ringOf(equity, owe),
      pips: 3 - pips,
      owe: Math.round(owe),
      equity: Math.round(equity),
      shielded: tS < R.SHIELD_S,
      cashingOut: false,
      state: "alive",
    };
  });
  const zoneR = loop < R.ZONE_START_S ? W * 0.75 : W * (0.75 - 0.5 * ((loop - R.ZONE_START_S) / (R.MATCH_S - R.ZONE_START_S)));
  return {
    me: "b0",
    arena: { w: W, h: H },
    match: {
      mode: "free",
      phase: "LIVE",
      tick: Math.floor(tS * R.TICK_HZ),
      timeLeftS: R.MATCH_S - loop,
      rateTier: "LOW",
      zone: { cx: W / 2, cy: H / 2, r: zoneR },
      leaderboard: [],
    },
    blobs,
    food,
    spikes,
  };
}
