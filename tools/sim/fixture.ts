// Dumps 10 s of a real 6-bot match as JSON frames at SEND_HZ, so the client (S3) can build
// rendering against true engine output before the server is wired. Same seed, same file.
// Run: npx tsx tools/sim/fixture.ts [seed] [out]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  blobView, matchView, newWorld, rand, R, seedRng, startMatch, step, toUnits,
  type GameEventMsg, type InputCmd, type World,
} from "@margin/core";

const seed = Number(process.argv[2] ?? 42);
if (!Number.isInteger(seed)) throw new Error(`seed must be an integer, got ${process.argv[2]}`);
const out = process.argv[3] ?? "apps/client/fixtures/frames.json";
const WARMUP_TICKS = 2 * R.TICK_HZ;
const LIVE_TICKS = 10 * R.TICK_HZ;
const EVERY = R.TICK_HZ / R.SEND_HZ;

const players = Array.from({ length: 6 }, (_, i) => ({
  id: `b${i}`, kind: i === 0 ? ("human" as const) : ("agent" as const), label: i === 0 ? "You" : `Agent-${i}`, accountId: null,
}));
const w: World = newWorld(seed, "free", players, `fixture-${seed}`);
const bot = { rngState: seedRng(seed ^ 0x51ed) };

// ponytail: fixture bot = steer to the nearest food, tap BOOST now and then. The real FreeBot is A-phase.
function decide(id: string, tick: number): InputCmd {
  const b = w.blobs.get(id);
  let dx = 0;
  let dy = 0;
  if (b) {
    let best = Infinity;
    for (const f of w.food) {
      const d = Math.hypot(f.x - b.x, f.y - b.y);
      if (d < best) [best, dx, dy] = [d, (f.x - b.x) / d, (f.y - b.y) / d];
    }
  }
  return { seq: tick, dirX: dx, dirY: dy, boost: rand(bot) < 0.01, repay: false, cashout: false };
}

const frames: unknown[] = [];
let tick = 0;
let events: GameEventMsg[] = [];
while (tick < WARMUP_TICKS + LIVE_TICKS) {
  tick++;
  if (tick === WARMUP_TICKS) startMatch(w, tick);
  else {
    const inputs = new Map(tick % EVERY === 0 ? players.map((p) => [p.id, decide(p.id, tick)] as const) : []);
    events.push(...step(w, inputs, tick));
  }
  if (tick % EVERY !== 0) continue;
  frames.push({
    tick,
    match: matchView(w),
    arena: w.arena,
    blobs: [...w.blobs.values()].map((b) => blobView(b, tick)),
    food: w.food.map((f) => ({ id: f.id, x: f.x, y: f.y, mass: toUnits(f.mass) })),
    spikes: w.spikes.filter((s) => s.respawnAt === null).map((s) => ({ id: s.id, x: s.x, y: s.y, big: s.big })),
    events,
  });
  events = [];
}
mkdirSync(dirname(out), { recursive: true });
// Two decimals is plenty for pixels and display units, and keeps the file small.
const round = (_k: string, v: unknown): unknown => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v);
writeFileSync(out, JSON.stringify({ seed, sendHz: R.SEND_HZ, frames }, round));
console.log(`wrote ${frames.length} frames to ${out}`);
