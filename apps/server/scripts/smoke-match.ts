// S1 gate, run against a live server: `PORT=2599 npm start -w @margin/server` then
// `npx tsx apps/server/scripts/smoke-match.ts ws://localhost:2599`. Takes one full match (~106 s).
// Checks the phase order, that garbage input moves nobody, a 100/s flood is no faster than 20/s,
// and a 300/s flooder is dropped while the room keeps running.
import { Client, type Room } from "@colyseus/sdk";

const url = process.argv[2] ?? "ws://localhost:2567";
const sdk = new Client(url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cmd = (seq: number, dirX: number) => ({ seq, dirX, dirY: 0, boost: false, repay: false, cashout: false });

const honest = await sdk.joinOrCreate("match");
const garbage = await sdk.join("match");
const flood = await sdk.join("match");
const hostile = await sdk.join("match");
let hostileDropped = false;
hostile.onLeave(() => (hostileDropped = true));

const phases: Array<[string, number]> = [];
const t0 = Date.now();
honest.onMessage("ev", (ev: { type: string; phase?: string }) => {
  if (ev.type === "phase") phases.push([ev.phase!, Math.round((Date.now() - t0) / 1000)]);
});
for (const r of [garbage, flood, hostile]) r.onMessage("ev", () => {});
for (const r of [honest, garbage, flood, hostile]) r.onMessage("me", () => {});

const pos = (r: Room, id = r.sessionId) => {
  const b = (r.state as { blobs: Map<string, { x: number; y: number }> }).blobs.get(id);
  return b ? { x: b.x, y: b.y } : null;
};
await sleep(300);
const garbageStart = pos(honest, garbage.sessionId);
const honestStart = pos(honest);
const floodStart = pos(honest, flood.sessionId);
// Head for the farther wall so 2 s of movement never clamps at the arena edge.
const away = (p: { x: number } | null) => (p && p.x > 1000 ? -1 : 1);
const hDir = away(honestStart), fDir = away(floodStart);

const junk: unknown[] = [null, "x", 7, { seq: 1, dirX: NaN, dirY: 0 }, { seq: 1, dirX: 50, dirY: 0, boost: false, repay: false, cashout: false }, { dirX: 1 }];
let seq = 0;
const timers = [
  setInterval(() => honest.send("input", cmd(++seq, hDir)), 50),
  setInterval(() => garbage.send("input", junk[seq % junk.length]), 10),
  setInterval(() => flood.send("input", cmd(++seq, fDir)), 10),
  setInterval(() => { if (!hostileDropped) for (let i = 0; i < 30; i++) hostile.send("input", cmd(++seq, 1)); }, 100),
];

// Warm-up ghosts move for ~2 s, then compare before the countdown teleports anyone.
await sleep(2000);
const g = pos(honest, garbage.sessionId), h = pos(honest), f = pos(honest, flood.sessionId);
const moved = (a: { x: number } | null, b: { x: number } | null) => (a && b ? Math.abs(b.x - a.x) : NaN);
const report = {
  garbageMoved: g && garbageStart ? Math.hypot(g.x - garbageStart.x, g.y - garbageStart.y) : NaN,
  honestDx: moved(honestStart, h),
  floodDx: moved(floodStart, f),
};

await new Promise<void>((resolve) => honest.onLeave(() => resolve()));
timers.forEach(clearInterval);
console.log(JSON.stringify({ phases, ...report, hostileDropped }, null, 1));

const order = phases.map((p) => p[0]).join(",");
const ok =
  order === "COUNTDOWN,LIVE,ENDED" &&
  report.garbageMoved === 0 &&
  report.honestDx > 0 &&
  report.floodDx <= report.honestDx + 1 &&
  hostileDropped;
console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
