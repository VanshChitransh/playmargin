// Soak against a live server: N full free matches, one bot human per private room (11 agents fill
// the rest), a new room every 6.5 s to stay under the 12 joins/min per IP limit. Prints /health
// tick timings and memory while it runs, and the settled count at the end.
// Usage: npx tsx apps/server/scripts/soak.ts http://localhost:2611 50
import { Client } from "@colyseus/sdk";

const base = process.argv[2] ?? "http://localhost:2567";
const N = Number(process.argv[3] ?? 50);
const sdk = new Client(base.replace(/^http/, "ws"));
const RUN = Date.now().toString(36);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (i: number) => String.fromCharCode(65 + ((i / 676) | 0) % 26, 65 + ((i / 26) | 0) % 26, 65 + (i % 26), 65 + ((RUN.charCodeAt(RUN.length - 1) + i) % 26));
const health = async () => (await fetch(`${base}/health`)).json() as Promise<{ rooms: number; rssMB: number; ticks: object }>;

let done = 0;
let failed = 0;
async function play(i: number): Promise<void> {
  const r = await sdk.joinOrCreate("private", { mode: "free", roomCode: code(i), guestKey: `ed25519:soak${RUN}k${i}` });
  r.onMessage("ev", () => {});
  r.onMessage("me", () => {});
  r.onMessage("commander", () => {});
  let t = 0;
  const iv = setInterval(() => {
    t++;
    r.send("input", { seq: t, dirX: Math.cos(t / 9 + i), dirY: Math.sin(t / 9 + i), boost: t % 100 < 20, repay: t % 70 === 30, cashout: t % 300 === 200 });
  }, 50);
  await new Promise<void>((res) => r.onLeave(() => res()));
  clearInterval(iv);
}

const started = Date.now();
const all: Promise<void>[] = [];
const peek = setInterval(async () => console.log(`${Math.round((Date.now() - started) / 1000)}s done ${done}/${N}`, JSON.stringify(await health())), 30_000);
for (let i = 0; i < N; i++) {
  all.push(play(i).then(() => void done++, (e: Error) => (failed++, console.error(`room ${i}:`, e.message))));
  await sleep(6_500);
}
await Promise.all(all);
clearInterval(peek);
const h = await health();
const stats = await (await fetch(`${base}/api/stats`)).json();
console.log(JSON.stringify({ matches: N, done, failed, minutes: Math.round((Date.now() - started) / 6000) / 10, health: h, stats }, null, 1));
process.exit(failed ? 1 : 0);
