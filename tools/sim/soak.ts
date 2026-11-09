// `npm run soak`: A4. Starts the real server (fresh temp DB), opens N private free rooms with one
// guest each (11 labelled agents fill the rest), and measures server CPU per room tick while all
// matches are LIVE, plus whether every match still lasted 90 real seconds under load.
import { Client, type Room } from "@colyseus/sdk";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MATCH_TICKS } from "@margin/core";

const i = process.argv.indexOf("--rooms");
const ROOMS = Number(i >= 0 ? process.argv[i + 1] : 50);
const PORT = 2600 + Math.floor(Math.random() * 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CPU seconds the server process has used so far (user + system). */
function cpuS(pid: number): number {
  const t = execFileSync("ps", ["-p", String(pid), "-o", "time="]).toString().trim(); // [[h:]m:]s.cc
  return t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

// Run from apps/server so tsx picks up the server tsconfig (Colyseus schema decorators).
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: join(import.meta.dirname, "../../apps/server"),
  env: { ...process.env, PORT: String(PORT), JOIN_LIMIT_PER_MIN: "100000", DB_PATH: join(mkdtempSync(join(tmpdir(), "margin-soak-")), "soak.sqlite") },
  stdio: ["ignore", "pipe", "inherit"],
});
// The server logs one JSON object per line; it is ready at {"event":"up"}. Give up after 60 s.
await new Promise<void>((ok, fail) => {
  const timer = setTimeout(() => fail(new Error("server did not log its \"up\" event within 60 s")), 60_000);
  server.stdout!.on("data", (d: Buffer) => {
    if (/"event":"up"|server up/.test(d.toString())) {
      clearTimeout(timer);
      ok();
    }
  });
  server.on("exit", (c) => fail(new Error(`server exited (${c}) before it was up`)));
}).catch((e: unknown) => {
  console.error(`soak FAILED: ${e instanceof Error ? e.message : String(e)}`);
  server.kill();
  process.exit(1);
});

/** Fail loudly, never hang: stop the server we spawned and exit 1. */
function abort(why: string): never {
  console.error(`soak FAILED: ${why}`);
  server.kill();
  process.exit(1);
}
/** Wait for a condition, but give up after `s` seconds (a stuck room would otherwise hang the run). */
async function until(ok: () => boolean, s: number, what: string): Promise<void> {
  const end = Date.now() + s * 1000;
  while (!ok()) {
    if (Date.now() > end) abort(`timed out after ${s} s waiting for ${what}`);
    await sleep(200);
  }
}

const sdk = new Client(`ws://localhost:${PORT}`);
const code = (n: number): string => [0, 1, 2, 3].map((k) => String.fromCharCode(65 + (Math.floor(n / 26 ** k) % 26))).join("");
const live = new Map<number, number>();
const ended = new Map<number, number>();
const rooms: Room[] = [];
for (let n = 0; n < ROOMS; n++) {
  const r = await sdk
    .joinOrCreate("private", { mode: "free", roomCode: code(n), guestKey: `ed25519:soak${PORT}x${n}` })
    .catch((e: unknown) => abort(`room ${n} refused the join: ${e instanceof Error ? e.message : String(e)}`));
  r.onMessage("me", () => {});
  r.onMessage("ev", (ev: { type: string; phase?: string }) => {
    if (ev.type !== "phase") return;
    if (ev.phase === "LIVE") live.set(n, Date.now());
    if (ev.phase === "ENDED") ended.set(n, Date.now());
  });
  rooms.push(r);
}
console.log(`${ROOMS} rooms joined, 12 blobs each (1 guest + 11 agents)`);

await until(() => live.size === ROOMS, 60, `all ${ROOMS} rooms to go LIVE (${live.size} did)`);
const cpu0 = cpuS(server.pid!);
const t0 = Date.now();
await until(() => ended.size === ROOMS, 150, `all ${ROOMS} matches to end (${ended.size} did)`);
const cpu1 = cpuS(server.pid!);
const wall = (Date.now() - t0) / 1000;

const roomTicks = ROOMS * MATCH_TICKS;
const msPerTick = ((cpu1 - cpu0) * 1000) / roomTicks;
const durations = [...ended].map(([n, t]) => (t - live.get(n)!) / 1000);
const worst = Math.max(...durations);
console.log(`LIVE window ${wall.toFixed(1)} s wall · server CPU ${(cpu1 - cpu0).toFixed(1)} s for ${roomTicks.toLocaleString("en-US")} room ticks`);
console.log(`avg ${msPerTick.toFixed(3)} ms CPU per room tick (target < 4 ms) · one core used ${((100 * (cpu1 - cpu0)) / wall).toFixed(0)}%`);
console.log(`match length under load: min ${Math.min(...durations).toFixed(1)} s, max ${worst.toFixed(1)} s (90 s expected)`);
for (const r of rooms) void r.leave();
server.kill();
process.exit(msPerTick < 4 && worst < 92 ? 0 : 1);
