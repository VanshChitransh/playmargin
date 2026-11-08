// S2 gate against a live server (~10 s): two Play taps within 8 s share a room, private codes
// stay private, and at the 3-2-1 the room is topped up to 12 with labelled agents.
// Usage: `npx tsx apps/server/scripts/smoke-lobby.ts ws://localhost:2599`
import { Client } from "@colyseus/sdk";

const sdk = new Client(process.argv[2] ?? "ws://localhost:2567");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = <T extends { onMessage: (t: string, cb: () => void) => void }>(r: T) => {
  r.onMessage("ev", () => {});
  r.onMessage("me", () => {});
  return r;
};

const a = quiet(await sdk.joinOrCreate("match", { mode: "free" }));
await sleep(3000);
const b = quiet(await sdk.joinOrCreate("match", { mode: "free" }));
const f1 = quiet(await sdk.joinOrCreate("private", { mode: "free", roomCode: "ABCD" }));
const f2 = quiet(await sdk.joinOrCreate("private", { mode: "free", roomCode: "ABCD" }));
const noCode = await sdk.joinOrCreate("private", { mode: "free" }).then(() => "joined", () => "rejected");
const wrongCode = await sdk.join("private", { mode: "free", roomCode: "ZZZZ" }).then(() => "joined", () => "rejected");

await sleep(6000);
const st = a.state as { phase: string; humans: number; agents: number; blobs: Map<string, { kind: string; label: string }> };
const agents = [...st.blobs.values()].filter((x) => x.kind === "agent");
const r = {
  sameRoom: a.roomId === b.roomId,
  friendsTogether: f1.roomId === f2.roomId,
  privateSeparate: f1.roomId !== a.roomId,
  noCode,
  wrongCode,
  phase: st.phase,
  counter: `${st.humans + st.agents}/12 · ${st.humans} humans · ${st.agents} agents`,
  agentsLabelled: agents.length === 10 && agents.every((x) => x.label.startsWith("Agent-")),
};
console.log(JSON.stringify(r, null, 1));
const ok = r.sameRoom && r.friendsTogether && r.privateSeparate && noCode === "rejected" && wrongCode === "rejected" &&
  r.phase === "COUNTDOWN" && st.humans === 2 && r.agentsLabelled;
console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
