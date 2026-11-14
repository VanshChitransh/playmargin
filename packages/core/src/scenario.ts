// The Judge Run: an openly labelled 90 s scenario, not a rigged outcome (EDGE-CASES PX-03).
// Published seed, normal money rules for everyone, works on /verify, kept off leaderboards. One
// disclosed difference (QA-B-07, shown at the start and in the README): its agents never hunt the
// judge and Drone-1 shadows them (agents/index.ts createBrain), so the lesson is the judge's own
// loan, never a bot ambush. The map only rearranges what the pot already paid for: the opening
// food lies around the player (get big fast, borrow to get bigger), and big spikes ring the spot
// where the Squeeze ends. One scripted beat, disclosed with the rest: max out the loan and a big
// spike drops in your path (judgeTrap).
import { boostRoom } from "./economy";
import { randRange } from "./rng";
import type { PlayerSeed, Spike, World } from "./types";
import { radius } from "./motion";
import { spikeRadius } from "./world";

/** Published so anyone can replay a Judge Run (14 Nov 2026, the deadline). */
export const JUDGE_SEED = 20261114;
const AGENTS = 10;
const FOOD_RING = { min: 110, max: 520 };
/** A moving judge meets the cap spike about this many seconds ahead, so they see it coming. */
const TRAP_LEAD_S = 0.6;

/** Judge Run worlds (applyJudgeLayout) and whether their cap spike has dropped. Kept beside World,
 *  not on it, so the shared types stay as they are; the server keeps one World object per match. */
const traps = new WeakMap<World, { judge: string; sprung: boolean }>();

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
  traps.set(w, { judge: playerId, sprung: false });
}

/**
 * The Judge Run's one scripted beat (README teardown 14 Nov: a judge who held BOOST and never
 * steered sat at the cap, green at HF 1.33, until the zone got them at 1:29). The first tick the
 * judge's loan is maxed out, one big spike drops in their path: TRAP_LEAD_S ahead on their heading,
 * or on their edge if they stand still. After that it is all normal rules: at full leverage a big
 * spike takes them to the HF 0.95 floor, red, and the drone circling them pops them unless they
 * REPAY in time. It is one of the map's own spikes (the farthest from the judge, never a Squeeze ring
 * spike if another is live), so nothing is added, and settle(log) is untouched: where a spike sits is
 * not money. step calls this every LIVE tick, before spike hits; a no-op outside a Judge Run.
 */
export function judgeTrap(w: World): void {
  const t = traps.get(w);
  if (!t || t.sprung) return;
  const b = w.blobs.get(t.judge);
  if (!b || b.state !== "alive" || b.debt === 0 || boostRoom(b) > 0) return;
  const live = (list: Spike[]): Spike[] => list.filter((s) => s.respawnAt === null);
  const spare = live(w.spikes.slice(Math.ceil(w.spikes.length / 2)));
  const d2 = (s: Spike): number => (s.x - b.x) ** 2 + (s.y - b.y) ** 2;
  const s = (spare.length > 0 ? spare : live(w.spikes)).reduce<Spike | null>((far, x) => (!far || d2(x) > d2(far) ? x : far), null);
  if (!s) return; // every spike is consumed right now: try again next tick
  const v = Math.hypot(b.vx, b.vy);
  // Heading: where the blob is going, or toward the zone centre for one standing still.
  const [hx, hy] = v > 1 ? [b.vx, b.vy] : [w.zone.cx - b.x, w.zone.cy - b.y];
  const hl = Math.hypot(hx, hy) || 1;
  s.big = true;
  const d = radius(b.mass) + spikeRadius(s) / 2 + v * TRAP_LEAD_S;
  s.x = Math.min(w.arena.w, Math.max(0, b.x + (hx / hl) * d));
  s.y = Math.min(w.arena.h, Math.max(0, b.y + (hy / hl) * d));
  t.sprung = true;
}
