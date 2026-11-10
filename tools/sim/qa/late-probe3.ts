// Probe: one human starts a public room (11 agents fill it at GO), then 11 more guests join late.
import { Client } from "@colyseus/sdk";
const sdk = new Client(`ws://localhost:${process.env.QA_PORT ?? 2601}`);
const key = (s: string) => `ed25519:probe${s}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const a = await sdk.joinOrCreate("match", { mode: "free", guestKey: key("a"), name: "Probe A" });
a.onMessage("*", () => {});
while ((a.state as { phase: string }).phase !== "LIVE") await new Promise((r) => setTimeout(r, 50));
const st = () => a.state as unknown as { blobs: Map<string, { kind: string }>; arenaW: number; humans: number; agents: number };
const atGo = { blobs: st().blobs.size, arenaW: st().arenaW };
const res = await Promise.all(Array.from({ length: 11 }, (_, i) => sdk.joinById(a.roomId, { mode: "free", guestKey: key(`l${i}`), name: `Late ${i}` }).then((r) => (r.onMessage("*", () => {}), "joined"), (e: Error) => e.message)));
await new Promise((r) => setTimeout(r, 500));
const kinds: Record<string, number> = {};
st().blobs.forEach((b) => void (kinds[b.kind] = (kinds[b.kind] ?? 0) + 1));
console.log(JSON.stringify({ atGo, lateJoins: res.filter((x) => x === "joined").length, refused: res.filter((x) => x !== "joined"), after: { blobs: st().blobs.size, kinds, arenaW: st().arenaW } }));
process.exit(0);
