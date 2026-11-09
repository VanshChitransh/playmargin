// The Judge Run: an openly labelled 90 s scenario, not a rigged outcome (EDGE-CASES PX-03).
// Published seed, normal rules for everyone, works on /verify, kept off leaderboards. The map
// only rearranges what the pot already paid for: the opening food lies around the player (get
// big fast, borrow to get bigger), and big spikes ring the spot where the Squeeze ends.
import { randRange } from "./rng";
import type { PlayerSeed, World } from "./types";
import { radius } from "./motion";

/** Published so anyone can replay a Judge Run (14 Nov 2026, the deadline). */
export const JUDGE_SEED = 20261114;
const AGENTS = 10;
const FOOD_RING = { min: 110, max: 520 };

/** The Judge Run lineup: the player, 10 labelled agents, 1 labelled liquidator drone. */
export function judgeLineup(player: PlayerSeed): PlayerSeed[] {
  const agents = Array.from({ length: AGENTS }, (_, i): PlayerSeed => ({
    id: `agent-${i + 1}`, kind: "agent", label: `Agent-${i + 1} \u{1F916}`, accountId: null,
  }));
  return [player, ...agents, { id: "drone-1", kind: "drone", label: "Drone-1 (liquidator)", accountId: null }];
}

/** Call right after startMatch: food around the player, a big-spike ring where the zone ends. */
export function applyJudgeLayout(w: World, playerId: string): void {
  const p = w.blobs.get(playerId);
  if (!p || w.phase !== "LIVE") throw new Error("applyJudgeLayout needs a LIVE world and the player's id");
  const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v));
  for (const f of w.food) {
    const a = randRange(w, 0, Math.PI * 2);
    const d = randRange(w, FOOD_RING.min + radius(p.mass), FOOD_RING.max);
    f.x = clamp(p.x + Math.cos(a) * d, w.arena.w);
    f.y = clamp(p.y + Math.sin(a) * d, w.arena.h);
  }
  // Half the spikes become big and sit on a ring just outside the final zone, so the Squeeze
  // pushes everyone through them at full leverage; the rest stay where the seed put them.
  const ring = w.spikes.slice(0, Math.ceil(w.spikes.length / 2));
  ring.forEach((s, i) => {
    const a = (i / ring.length) * Math.PI * 2;
    s.big = true;
    s.x = clamp(w.zone.cx + Math.cos(a) * w.zone.targetR * 1.25, w.arena.w);
    s.y = clamp(w.zone.cy + Math.sin(a) * w.zone.targetR * 1.25, w.arena.h);
  });
}
