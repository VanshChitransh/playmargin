// QA-A-07 measure: a fixed flood of EXPECTED refusals, so the server log can be counted before/after.
// 40 private creates without a room code, 40 websocket joins past the 12/min join limit, 3 oversized
// frames. Run against a server started with default limits and its log going to a file.
// Usage: npx tsx apps/server/scripts/qa-logflood.ts http://localhost:2611
import { Client } from "@colyseus/sdk";

const http = process.argv[2] ?? "http://localhost:2611";
const ws = http.replace(/^http/, "ws");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let refused = 0;
for (let i = 0; i < 40; i++) {
  const r = await fetch(`${http}/matchmake/joinOrCreate/private`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.1.1.1" }, body: '{"mode":"free"}' });
  if (!r.ok) refused++;
  if (i === 25) await sleep(61_000); // stay under the 30/min reservation limit: this flood is about create refusals
}
console.log(`private creates without a code: ${refused}/40 refused`);
let joins = 0;
let limited = 0;
for (let i = 0; i < 40; i++) {
  try {
    const room = await new Client(ws).joinOrCreate("match", { mode: "free", guestKey: `qa-lf-${i}-${Date.now()}` });
    joins++;
    void Promise.race([room.leave(), sleep(500)]);
  } catch {
    limited++;
  }
}
console.log(`websocket joins: ${joins} in, ${limited} refused`);
for (let i = 0; i < 3; i++) {
  const room = await new Client(ws).joinOrCreate("match", { mode: "free", guestKey: `qa-lfbig-${i}-${Date.now()}` }).catch(() => null);
  room?.send("input", "x".repeat(1_000_000) as never);
  await sleep(500);
}
console.log("3 oversized frames sent");
process.exit(0);
