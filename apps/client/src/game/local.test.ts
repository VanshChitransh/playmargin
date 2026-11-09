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
