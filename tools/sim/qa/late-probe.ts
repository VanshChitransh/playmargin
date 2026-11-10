// Probe: can a second guest join a public free room after GO (RULES: late join in the first 15 s)?
import { Client } from "@colyseus/sdk";
const sdk = new Client(`ws://localhost:${process.env.QA_PORT ?? 2601}`);
const key = (s: string) => `ed25519:probe${s}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
for (const delayMs of [0, 300, 1000, 2500]) {
  const a = await sdk.joinOrCreate("match", { mode: "free", guestKey: key("a"), name: "Probe A" });
  a.onMessage("*", () => {});
  while ((a.state as { phase: string }).phase !== "LIVE") await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, delayMs));
  const t = (a.state as { timeLeftS: number }).timeLeftS;
  const byId = await sdk.joinById(a.roomId, { mode: "free", guestKey: key("b"), name: "Probe B" }).then((r) => (r.leave(), "joined"), (e: Error) => `refused: ${e.message}`);
  const viaMatch = await sdk.joinOrCreate("match", { mode: "free", guestKey: key("c"), name: "Probe C" }).then((r) => { const same = r.roomId === a.roomId; r.leave(); return same ? "joined the LIVE room" : "got a different room"; }, (e: Error) => `refused: ${e.message}`);
  console.log(JSON.stringify({ delayMs, timeLeftS: t, joinById: byId, joinOrCreate: viaMatch }));
  a.leave();
}
process.exit(0);
