// Debug: what happens to a player who parks next to a spike? Logs phase, timeLeft, my state every 5 s.
import { Client } from "@colyseus/sdk";
const sdk = new Client(`ws://localhost:${process.env.QA_PORT ?? 2601}`);
const r = await sdk.joinOrCreate("match", { mode: "free", guestKey: `ed25519:baitdbg${Date.now().toString(36)}`, name: "Bait Dbg" });
r.onMessage("*", () => {});
let left = false;
r.onLeave((code) => { left = true; console.log("left", code); });
type St = { phase: string; timeLeftS: number; blobs: Map<string, { x: number; y: number; radius: number; state: string; equity: number; ring: string }>; spikes: Map<string, { x: number; y: number; live: boolean }> };
let seq = 0;
const t0 = Date.now();
const iv = setInterval(() => {
  const s = r.state as unknown as St;
  const m = s.blobs?.get(r.sessionId);
  let dx = 0, dy = 0, best = Infinity;
  if (m) s.spikes.forEach((k) => { if (!k.live) return; const d = Math.hypot(k.x - m.x, k.y - m.y); if (d < best) (best = d), (dx = k.x - m.x), (dy = k.y - m.y); });
  const park = !m || best < m.radius + 150;
  const l = Math.hypot(dx, dy) || 1;
  r.send("input", { seq: ++seq, dirX: park ? 0 : dx / l, dirY: park ? 0 : dy / l, boost: false, repay: false, cashout: false });
  if (seq % 100 === 0) console.log(JSON.stringify({ s: Math.round((Date.now() - t0) / 1000), phase: s.phase, left: s.timeLeftS, me: m && { state: m.state, eq: +m.equity.toFixed(1), ring: m.ring }, distToSpike: Math.round(best) }));
  if (left || Date.now() - t0 > 140_000) { clearInterval(iv); process.exit(0); }
}, 50);
