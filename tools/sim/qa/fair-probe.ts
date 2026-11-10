// QA-C probes: leaderboard order = equity (C2.12), warm-up leave costs nothing (C3.8), guest key
// reuse in the same and in another room (C3.9).
import { DatabaseSync } from "node:sqlite";
import { Client } from "@colyseus/sdk";
const sdk = new Client(`ws://localhost:${process.env.QA_PORT ?? 2601}`);
const DB = process.env.QA_DB!;
const key = (s: string) => `ed25519:fair${s}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const ledger = (guest: string) => {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare("SELECT l.delta, l.reason FROM credits_ledger l JOIN users u ON u.id = l.user_id WHERE u.guest_key = ?").all(guest) as Array<{ delta: number; reason: string }>;
  db.close();
  return rows.map((r) => `${r.reason} ${r.delta / 1e6}`);
};
// 1. Warm-up leave: join, leave before GO.
const k1 = key("leave");
const r1 = await sdk.joinOrCreate("match", { mode: "free", guestKey: k1, name: "Leaver" });
await new Promise((r) => setTimeout(r, 300));
await r1.leave();
await new Promise((r) => setTimeout(r, 300));
console.log(JSON.stringify({ probe: "warm-up leave", ledger: ledger(k1) }));
// 2. Same key twice in one room, and in a second (private) room at the same time.
const k2 = key("dup");
const a = await sdk.joinOrCreate("match", { mode: "free", guestKey: k2, name: "Dup" });
a.onMessage("*", () => {});
const sameRoom = await sdk.joinOrCreate("match", { mode: "free", guestKey: k2, name: "Dup2" }).then((r) => (r.leave(), `joined ${r.roomId === a.roomId ? "same" : "other"} room`), (e: Error) => `refused: ${e.message}`);
const otherRoom = await sdk.joinOrCreate("private", { mode: "free", guestKey: k2, roomCode: "QQZZ", name: "Dup3" }).then((r) => (r.onMessage("*", () => {}), r), (e: Error) => `refused: ${e.message}`);
console.log(JSON.stringify({ probe: "guest key reuse", sameRoom, otherRoom: typeof otherRoom === "string" ? otherRoom : "joined a second room" }));
// 3. Leaderboard = equity while LIVE.
while ((a.state as { phase: string }).phase !== "LIVE") await new Promise((r) => setTimeout(r, 50));
let samples = 0, mismatches = 0;
const examples: unknown[] = [];
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const st = a.state as unknown as { leaderboard: string[]; blobs: Map<string, { id: string; kind: string; state: string; equity: number }> };
  const lb = [...st.leaderboard];
  const alive = [...st.blobs.values()].filter((b) => b.kind !== "drone" && b.state === "alive").sort((x, y) => y.equity - x.equity);
  const top = alive.slice(0, lb.length).map((b) => b.equity);
  const shown = lb.map((id) => st.blobs.get(id)?.equity ?? -1);
  samples++;
  if (shown.some((e, j) => e !== top[j])) (mismatches++, examples.length < 3 && examples.push({ shown, top }));
}
console.log(JSON.stringify({ probe: "leaderboard = equity", samples, mismatches, examples }));
if (typeof otherRoom !== "string") otherRoom.leave();
a.leave();
await new Promise((r) => setTimeout(r, 500));
console.log(JSON.stringify({ probe: "ledger after leaving mid-match (charged at GO, never refunded)", ledger: ledger(k2) }));
process.exit(0);
