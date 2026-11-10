// QA-C-01 gate against a live server (~20 s): a free public room never shows more than ROOM_SIZE blobs.
// One human starts a room (agents fill it to 12), then three more join inside the late-join window:
// they must land in another room, and no room ever counts more than 12 blobs.
// Usage: npx tsx apps/server/scripts/smoke-roomsize.ts ws://localhost:2611
import { Client, type Room } from "@colyseus/sdk";
import { R } from "@margin/core";

const url = process.argv[2] ?? "ws://localhost:2567";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = () => `qa-size-${Date.now().toString(36)}${Math.floor(Math.random() * 1e9)}`;
const st = (r: Room) => r.state as { phase: string; blobs: { size: number } };
let worst = 0;
const watch = (r: Room) => {
  r.onMessage("*", () => {});
  r.onStateChange(() => (worst = Math.max(worst, st(r).blobs.size)));
};

const first = await new Client(url).joinOrCreate("match", { mode: "free", guestKey: key() });
watch(first);
for (let i = 0; i < 400 && st(first).phase !== "LIVE"; i++) await sleep(100);
if (st(first).phase !== "LIVE") (console.log(`SMOKE FAIL: never reached LIVE (${st(first).phase})`), process.exit(1));
const late: Room[] = [];
for (let i = 0; i < 3; i++) {
  const r = await new Client(url).joinOrCreate("match", { mode: "free", guestKey: key() });
  watch(r);
  late.push(r);
}
await sleep(1500);
const same = late.filter((r) => r.roomId === first.roomId).length;
console.log(`first room ${first.roomId}: ${st(first).blobs.size} blobs. late joiners in the same room: ${same}/3. most blobs any room showed: ${worst}`);
const ok = worst <= R.ROOM_SIZE && st(first).blobs.size <= R.ROOM_SIZE;
console.log(ok ? "SMOKE OK" : "SMOKE FAIL: a room went over ROOM_SIZE");
await Promise.all([first, ...late].map((r) => Promise.race([r.leave().catch(() => 0), sleep(1500)])));
process.exit(ok ? 0 : 1);
