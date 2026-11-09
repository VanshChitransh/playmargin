// End-to-end without keys or network (CI): boots the real server on a free port with a fresh DB and
// SIM_SPEED=4, two SDK clients play one full free match, then checks phases in order, the match
// settled, the credits ledger is exact for both players, and replaying the served log with
// settleVerified gives exactly the payouts the server stored. Usage: npm run e2e:local (~35 s).
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@colyseus/sdk";
import { R, settleVerified, type LogEntry } from "@margin/core";

const fail = (msg: string): never => {
  console.error(`E2E FAIL: ${msg}`);
  process.exit(1);
};
const port = await new Promise<number>((res) => {
  const s = createServer().listen(0, () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => res(p));
  });
});
const dbPath = join(mkdtempSync(join(tmpdir(), "margin-e2e-")), "e2e.sqlite");
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), DB_PATH: dbPath, SIM_SPEED: "4", NODE_ENV: "test", CONTRACT_ID: "", SETTLER_PRIVATE_KEY: "", NEAR_AI_API_KEY: "" },
  stdio: ["ignore", "pipe", "inherit"],
});
const killAll = () => server.kill("SIGKILL");
process.on("exit", killAll);
setTimeout(() => fail("timed out after 90 s"), 90_000).unref();
await new Promise<void>((res) => server.stdout!.on("data", (b: Buffer) => b.toString().includes('"event":"up"') && res()));

const base = `http://localhost:${port}`;
const sdk = new Client(`ws://localhost:${port}`);
const keys = [`ed25519:e2e${Date.now()}aaaaa`, `ed25519:e2e${Date.now()}bbbbb`];
const rooms = await Promise.all(keys.map((guestKey) => sdk.joinOrCreate("match", { mode: "free", guestKey })));
if (rooms[0]!.roomId !== rooms[1]!.roomId) fail("the two players landed in different rooms");
// A second tab with the same guest must not get a second seat (it used to double-charge and freeze GO).
const dupe = await sdk.joinOrCreate("match", { mode: "free", guestKey: keys[0] }).then(() => "joined", (e: Error) => e.message);
if (!/already in this match/.test(dupe)) fail(`same guest joined twice: ${dupe}`);
const phases: string[] = [];
rooms.forEach((r, i) => {
  r.onMessage("me", () => {});
  r.onMessage("commander", () => {});
  r.onMessage("ev", (e: { type: string; phase?: string }) => i === 0 && e.type === "phase" && phases.push(e.phase!));
});
await new Promise((r) => setTimeout(r, 300)); // first state patch
phases.unshift((rooms[0]!.state as { phase: string }).phase);
// BOOST is held: true in every message for 1 s out of 4. Fuel must be on the wire for the ring.
let fuelSeen = false;
let fuelDropped = false;
const radii = new Set<string>();
type Wire = { blobs: Map<string, { fuel?: number }>; food: Map<string, { radius: number }>; spikes: Map<string, { radius: number }> };
rooms[0]!.onStateChange((st: Wire) => {
  for (const f of st.food.values()) radii.add(`food:${f.radius}`);
  for (const k of st.spikes.values()) radii.add(`spike:${k.radius}`);
  const f = st.blobs.get(rooms[0]!.sessionId)?.fuel;
  if (typeof f === "number") fuelSeen = true;
  if (typeof f === "number" && f < 0.99) fuelDropped = true;
});
// Spectator (#/watch): once LIVE, /api/watch must hand out a seat in this locked room with no blob.
const watch = { joined: false, sawEvents: 0, gotMe: false, blobs: 0, humans: 0 };
const spectate = (async () => {
  while (!phases.includes("LIVE")) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 16_000 / 4)); // past the 15 s late-join lock (SIM_SPEED 4)
  const reservation = await (await fetch(`${base}/api/watch`)).json();
  const w = await sdk.consumeSeatReservation(reservation);
  watch.joined = w.roomId === rooms[0]!.roomId;
  w.onMessage("ev", () => void watch.sawEvents++);
  w.onMessage("me", () => void (watch.gotMe = true));
  w.onMessage("commander", () => {});
  await new Promise((r) => setTimeout(r, 1500));
  const st = w.state as unknown as { blobs: Map<string, unknown>; humans: number };
  watch.blobs = st.blobs.size;
  watch.humans = st.humans;
  await w.leave();
})();
let t = 0;
const iv = setInterval(() => {
  t++;
  rooms.forEach((r, i) => r.send("input", { seq: t, dirX: Math.cos(t / 8 + i * 3), dirY: Math.sin(t / 8 + i * 3), boost: t % 80 < 20, repay: t % 60 === 20, cashout: false }));
}, 50);
await Promise.all(rooms.map((r) => new Promise<void>((res) => r.onLeave(() => res()))));
clearInterval(iv);
await spectate;

const matchId = rooms[0]!.roomId;
const served = (await (await fetch(`${base}/api/matches/${matchId}/log`)).json()) as { status: string; log: LogEntry[] };
const db = new DatabaseSync(dbPath, { readOnly: true });
const seats = db
  .prepare("SELECT p.blob_id AS blob, p.user_id AS user, p.entry, p.payout FROM match_players p WHERE p.match_id = ?")
  .all(matchId) as Array<{ blob: string; user: string; entry: number; payout: number | null }>;
const replay = await settleVerified(served.log);
const checks = {
  phases: phases.join(" > "),
  status: served.status,
  seats: seats.length,
  ledgerExact: seats.every((s) => {
    const { bal } = db.prepare("SELECT SUM(delta) AS bal FROM credits_ledger WHERE user_id = ?").get(s.user) as { bal: number };
    return bal === 1_000_000_000 - s.entry + (s.payout ?? 0);
  }),
  replayEqualsStored: seats.every((s) => (replay.payouts.find((p) => p.id === s.blob)?.amount ?? 0) === (s.payout ?? 0)),
  logEntries: served.log.length,
  watch,
  fuelSeen,
  radii: [...radii].sort().join(" "),
  heldBoostBorrowed: fuelDropped && served.log.some((e) => e.type === "BOOST"),
};
console.log(checks);
if (checks.phases !== "WARMUP > COUNTDOWN > LIVE > ENDED") fail(`phases ${checks.phases}`);
if (checks.status !== "settled") fail(`status ${checks.status}`);
if (checks.seats !== 2) fail(`expected 2 seats, got ${checks.seats}`);
if (!checks.ledgerExact) fail("credits ledger is not exact");
// The client draws food and spikes at exactly the core hitbox.
// Spikes come in two sizes now (small and big); every wire radius must be one the core uses.
const wireOk = new Set([`food:${R.FOOD_RADIUS_PX}`, `spike:${R.SPIKE_RADIUS_SMALL_PX}`, `spike:${R.SPIKE_RADIUS_BIG_PX}`]);
const seen = checks.radii.split(" ");
if (!seen.includes(`food:${R.FOOD_RADIUS_PX}`) || !seen.every((r) => wireOk.has(r))) fail(`wire radii ${checks.radii}`);
if (!watch.joined || watch.sawEvents === 0 || watch.gotMe || watch.humans !== 2 || watch.blobs !== 12) fail(`spectate ${JSON.stringify(watch)}`);
if (!checks.fuelSeen) fail("BlobView.fuel never reached the client");
if (!checks.heldBoostBorrowed) fail("holding BOOST never borrowed");
if (!checks.replayEqualsStored) fail("settleVerified(log) differs from stored payouts");
console.log("E2E OK");
process.exit(0);
