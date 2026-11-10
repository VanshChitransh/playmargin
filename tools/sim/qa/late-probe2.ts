// Probe: late join when the public room already has N humans (agents fill to 12 at the countdown).
import { Client } from "@colyseus/sdk";
const sdk = new Client(`ws://localhost:${process.env.QA_PORT ?? 2601}`);
const key = (s: string) => `ed25519:probe${s}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
for (const humans of [1, 2, 3, 6]) {
  const rs = [];
  for (let i = 0; i < humans; i++) {
    const r = await sdk.joinOrCreate("match", { mode: "free", guestKey: key(`h${i}`), name: `Probe ${i}` });
    r.onMessage("*", () => {});
    rs.push(r);
  }
  const a = rs[0]!;
  const same = rs.every((r) => r.roomId === a.roomId);
  while ((a.state as { phase: string }).phase !== "LIVE") await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 300));
  const blobs = (a.state as { blobs: Map<string, unknown> }).blobs.size;
  const late = await sdk.joinById(a.roomId, { mode: "free", guestKey: key("late"), name: "Late" }).then((r) => (r.leave(), "joined"), (e: Error) => `refused: ${e.message}`);
  console.log(JSON.stringify({ humans, sameRoom: same, blobsAtGo: blobs, lateJoinAt300ms: late }));
  rs.forEach((r) => r.leave());
}
process.exit(0);
