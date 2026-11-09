// Commander gate against a live server started with NEAR_AI_API_KEY (~40 s): a free room with one
// human gets at least one "commander" message with a non-empty rationale during LIVE.
// Usage: npx tsx apps/server/scripts/smoke-commander.ts ws://localhost:2611
import { Client } from "@colyseus/sdk";

const sdk = new Client(process.argv[2] ?? "ws://localhost:2567");
const r = await sdk.joinOrCreate("match", { mode: "free", guestKey: `ed25519:cmdr${Date.now().toString(36)}k1` });
r.onMessage("ev", () => {});
r.onMessage("me", () => {});
const seen: string[] = [];
r.onMessage("commander", (m: { rationale: string | null }) => m.rationale && seen.push(m.rationale));
let t = 0;
const iv = setInterval(() => r.send("input", { seq: ++t, dirX: Math.cos(t / 10), dirY: Math.sin(t / 10), boost: false, repay: false, cashout: false }), 100);
await new Promise((res) => setTimeout(res, 40_000));
clearInterval(iv);
console.log(seen);
console.log(seen.length > 0 ? "SMOKE OK" : "SMOKE FAIL");
process.exit(seen.length > 0 ? 0 : 1);
