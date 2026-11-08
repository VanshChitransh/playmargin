// S4 gate (~110 s): a dropped tab leaves its blob in place, and SIGTERM mid-match still lets
// the match finish, pay out and only then exits the process.
// Usage: DB_PATH=/tmp/x.sqlite PORT=2599 npm start -w @margin/server &  then
//        npx tsx apps/server/scripts/smoke-drain.ts ws://localhost:2599 <server pid> /tmp/x.sqlite
import { DatabaseSync } from "node:sqlite";
import { Client, type Room } from "@colyseus/sdk";

const [url = "ws://localhost:2567", pidArg, dbPath] = process.argv.slice(2);
const pid = Number(pidArg);
const RUN = Date.now().toString(36);
const sdk = new Client(url);
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const join = async (k: number) => {
  const r = await sdk.joinOrCreate("match", { mode: "free", guestKey: `ed25519:drain${RUN}k${k}` });
  r.onMessage("ev", () => {});
  r.onMessage("me", () => {});
  return r;
};
const blob = (r: Room, id: string) =>
  (r.state as { blobs: Map<string, { x: number; y: number; state: string }> }).blobs.get(id);

const a = await join(1);
const b = await join(2);
const aId = a.sessionId;
const bLeftP = new Promise<number>((res) => b.onLeave((code) => { log(`b left ${code}`); res(code); }));
let phase = "WARMUP";
const live = new Promise<void>((res) =>
  b.onMessage("ev", (e: { type: string; phase?: string }) => {
    if (e.type === "phase") {
      log(`phase ${e.phase}`);
      phase = e.phase!;
    }
    if (e.phase === "LIVE") res();
  }),
);
log(`a=${a.sessionId} b=${b.sessionId} room ${a.roomId}/${b.roomId}`);
await live;
log("LIVE");
let seq = 0;
const steer = setInterval(() => a.send("input", { seq: ++seq, dirX: 0.6, dirY: 0.8, boost: false, repay: false, cashout: false }), 50);
await sleep(1000);
clearInterval(steer);
// A closed tab: drop the socket without consent and never come back.
a.reconnection.enabled = false;
void a.leave(false);
await sleep(500);
const p1 = { ...blob(b, aId)! };
await sleep(3000);
const p2 = blob(b, aId);
const blobStays = !!p2 && p2.state === "alive" && Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.01;

log(`blobStays=${blobStays}`);
const phaseAtKill = phase;
process.kill(pid, "SIGTERM");
log("SIGTERM sent");
await sleep(500);
const newJoin = await sdk.joinOrCreate("match", { mode: "free", guestKey: `ed25519:drain${RUN}k3` }).then(
  () => "joined",
  () => "refused",
);
log(`newJoin=${newJoin}`);
const bLeft = await bLeftP;
await sleep(1500);
let exited = false;
try {
  process.kill(pid, 0);
} catch {
  exited = true;
}
const db = new DatabaseSync(dbPath!);
const rows = db.prepare("SELECT reason, COUNT(*) AS n FROM credits_ledger WHERE match_id = ? GROUP BY reason").all(b.roomId);
const r = { phaseAtKill, blobStays, newJoin, bLeftCode: bLeft, exited, ledger: rows };
console.log(JSON.stringify(r));
const payouts = (rows as Array<{ reason: string; n: number }>).find((x) => x.reason === "payout")?.n;
// The match must still have been LIVE when SIGTERM landed, or this proves nothing.
const ok = phaseAtKill === "LIVE" && blobStays && newJoin === "refused" && exited && payouts === 2;
console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
