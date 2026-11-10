// Private room gate against a live server (~5 s): the host reloading in the lobby keeps the host
// role and its blob (the seat is held, not handed to the friend), and the friend sees one host.
// Usage: npx tsx apps/server/scripts/smoke-private.ts ws://localhost:2567
import { Client, type Room } from "@colyseus/sdk";

const url = process.argv[2] ?? "ws://localhost:2567";
const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
const opts = (who: string) => ({ mode: "free", roomCode: code, guestKey: `qa-${who}-${Date.now().toString(36)}`, name: who });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const st = (r: Room) => r.state as { host: string; humans: number };
const fail = (m: string) => (console.log(`SMOKE FAIL: ${m}`), process.exit(1));

const host = await new Client(url).joinOrCreate("private", opts("hostqa"));
const friend = await new Client(url).joinOrCreate("private", opts("friendqa"));
for (const r of [host, friend]) r.onMessage("*", () => {});
await sleep(800);
if (st(friend).host !== host.sessionId) fail("first joiner is not the host");

// A reload: the socket drops without consent, then the page reconnects with the stored token.
const token = host.reconnectionToken;
host.reconnection.enabled = false;
await host.leave(false);
await sleep(1500);
if (st(friend).host !== host.sessionId) fail(`host handed on during the reload (host is ${st(friend).host})`);
const back = await new Client(url).reconnect(token);
back.onMessage("*", () => {});
await sleep(800);
if (back.sessionId !== host.sessionId || st(back).host !== back.sessionId) fail("reloaded host is not the host");
if (st(friend).humans !== 2) fail(`expected 2 humans, got ${st(friend).humans}`);
console.log(`room ${code}: host kept across a reload, 2 humans`);
console.log("SMOKE OK");
await back.leave();
await friend.leave();
process.exit(0);
