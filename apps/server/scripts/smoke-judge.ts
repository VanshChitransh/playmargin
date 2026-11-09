// Judge Run gate against a live server (~12 s): a lone human gets the published scenario: the
// JUDGE_SEED world, 10 labelled agents plus Drone-1, a second judge join gets its own room, and
// at GO half the spikes are big (applyJudgeLayout ran).
// Usage: `npx tsx apps/server/scripts/smoke-judge.ts ws://localhost:2611`
import { Client } from "@colyseus/sdk";

const RUN = Date.now().toString(36);
const sdk = new Client(process.argv[2] ?? "ws://localhost:2567");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = <T extends { onMessage: (t: string, cb: () => void) => void }>(r: T) => {
  r.onMessage("ev", () => {});
  r.onMessage("me", () => {});
  return r;
};
type St = { phase: string; blobs: Map<string, { kind: string; label: string }>; spikes: Map<string, { big: boolean }> };

const a = quiet(await sdk.joinOrCreate("judge", { mode: "free", guestKey: `ed25519:judge${RUN}k1` }));
const b = quiet(await sdk.joinOrCreate("judge", { mode: "free", guestKey: `ed25519:judge${RUN}k2` }));
await sleep(12_500);
const st = a.state as unknown as St;
const blobs = [...st.blobs.values()];
const spikes = [...st.spikes.values()];
const r = {
  ownRoom: a.roomId !== b.roomId,
  phase: st.phase,
  humans: blobs.filter((x) => x.kind === "human").length,
  agents: blobs.filter((x) => x.kind === "agent" && x.label.startsWith("Agent-")).length,
  drone: blobs.filter((x) => x.kind === "drone").map((x) => x.label),
  bigSpikes: `${spikes.filter((x) => x.big).length}/${spikes.length}`,
};
console.log(JSON.stringify(r, null, 1));
const ok = r.ownRoom && r.phase === "LIVE" && r.humans === 1 && r.agents === 10 && r.drone[0] === "Drone-1 (liquidator)" &&
  spikes.filter((x) => x.big).length >= spikes.length / 2;
console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
