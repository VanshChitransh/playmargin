// Offline practice and the landing hero on the real engine. The bots tests lock the home page bug:
// bots parked on prey they could not eat, or pinned in a corner, made a blob sit and shake.
import { describe, expect, it } from "vitest";
import { R } from "@margin/core";
import { LocalMatch } from "./local";

describe("LocalMatch", () => {
  it("plays warm-up, a full match and ends, with BOOST working for me", () => {
    const m = new LocalMatch({ seed: 7, withMe: true, bots: 11, warmupS: 2 });
    const seen = new Set<string>();
    m.onEvent((e) => seen.add(e.type));
    let t = 0;
    let f = m.frameAt(t);
    expect(f.match.phase).toBe("WARMUP");
    while (f.match.phase !== "ENDED" && t < 120_000) {
      t += 50;
      // tap BOOST once, after the 5 s spawn shield
      const boost = t === 9_000;
      m.send({ seq: t, dirX: 1, dirY: 0, boost, repay: false, cashout: false });
      f = m.frameAt(t);
    }
    expect(f.match.phase).toBe("ENDED");
    expect(t).toBeLessThan((R.MATCH_S + 5) * 1000);
    expect(seen.has("boost")).toBe(true);
    expect(f.blobs).toHaveLength(12);
  });
});

function play(seed: number, greedy: boolean, seconds = 60) {
  const m = new LocalMatch({ seed, withMe: false, bots: 10, warmupS: 0, greedy });
  const s = { eats: 0, pops: 0, longestStillS: 0, firstPopS: Infinity };
  const still = new Map<string, number>();
  const last = new Map<string, [number, number]>();
  let t = 0;
  for (let i = 0; i < 60 * seconds; i++) {
    t += 1000 / 60;
    m.frameAt(t);
    for (const e of (m as unknown as { events: { type: string }[] }).events.splice(0)) {
      if (e.type === "EAT") s.eats++;
      if (e.type === "POP" || e.type === "KEEPER_POP") (s.pops++, (s.firstPopS = Math.min(s.firstPopS, i / 60)));
    }
    for (const b of m.w.blobs.values()) {
      if (b.state !== "alive") continue;
      const [lx, ly] = last.get(b.id) ?? [NaN, NaN];
      last.set(b.id, [b.x, b.y]);
      const n = Math.hypot(b.x - lx, b.y - ly) < 0.5 ? (still.get(b.id) ?? 0) + 1 : 0;
      still.set(b.id, n);
      s.longestStillS = Math.max(s.longestStillS, n / 60);
    }
  }
  return s;
}

// Six seeds, 60 s each: enough to catch a freeze or a dull match, light enough for the full suite.
const SEEDS = [7919, 15838, 23757, 31676, 39595, 55433];

describe("LocalMatch bots", () => {
  it("hero: nobody freezes, and eats and pops happen every match", () => {
    const runs = SEEDS.map((s) => play(s, true));
    for (const r of runs) expect(r.longestStillS).toBeLessThan(3);
    // Kills on screen (main today: about 2 eats and 0 pops a match). Greedy bots get popped before eaten.
    expect(runs.reduce((a, r) => a + r.eats + r.pops, 0) / runs.length).toBeGreaterThanOrEqual(4);
    expect(runs.reduce((a, r) => a + r.pops, 0) / runs.length).toBeGreaterThanOrEqual(2);
    const firsts = runs.map((r) => r.firstPopS).sort((a, b) => a - b);
    expect(firsts[Math.floor(firsts.length / 2)]).toBeLessThan(30); // median first liquidation
    expect(firsts.at(-1)).toBeLessThan(45);
  }, 30_000);
  it("practice bots (careful) never freeze either", () => {
    for (const s of SEEDS.slice(0, 3)) expect(play(s, false, 45).longestStillS).toBeLessThan(3);
  }, 20_000);
});
