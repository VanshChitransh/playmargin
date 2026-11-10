// QA-A4 chaos against a live server: drops mid-match and reconnects inside/after the hold, a client
// killed in warm-up, two tabs on one guest key, and a client that stops reading its socket.
// Usage: npx tsx apps/server/scripts/qa-chaos.ts http://localhost:2611
import { Client, type Room } from "@colyseus/sdk";

const http = process.argv[2] ?? "http://localhost:2611";
const ws = http.replace(/^http/, "ws");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (w: string) => `qa-ch-${w}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
const st = (r: Room) => r.state as { phase: string; humans: number; blobs: { get(id: string): { state?: string } | undefined; size: number } };
const out: string[] = [];
const log = (m: string) => (out.push(m), console.log(m));
const join = async (opts: object, name = "match") => {
  const r = await new Client(ws).joinOrCreate(name, opts);
  r.onMessage("*", () => {});
  return r;
};
const drop = async (r: Room) => {
  r.reconnection.enabled = false;
  await Promise.race([r.leave(false).catch(() => 0), sleep(1500)]); // not consented: a crash or lost wifi
};
const until = async (r: Room, phase: string, s = 40) => {
  for (let i = 0; i < s * 10 && st(r).phase !== phase; i++) await sleep(100);
  return st(r).phase;
};

// A4.1 drop mid-match, come back inside the hold: same blob, same session
{
  const r = await join({ mode: "free", guestKey: key("a") });
  const phase = await until(r, "LIVE");
  const token = r.reconnectionToken;
  await drop(r);
  await sleep(3000);
  try {
    const back = await new Client(ws).reconnect(token);
    back.onMessage("*", () => {});
    await sleep(500);
    log(`A4.1 drop in ${phase}, back after 3 s: same session ${back.sessionId === r.sessionId}, blob ${st(back).blobs.get(back.sessionId)?.state ?? "missing"}`);
    await drop(back);
  } catch (e) {
    log(`A4.1 drop in ${phase}, back after 3 s: REFUSED ${(e as Error).message}`);
  }
}

// A4.1b a token for a room that is gone: refused cleanly, no crash
{
  const r = await join({ mode: "free", roomCode: "QAGN", guestKey: key("g") }, "private");
  const token = r.reconnectionToken;
  await Promise.race([r.leave().catch(() => 0), sleep(1500)]); // consented: the lone lobby closes
  await sleep(1500);
  try {
    await new Client(ws).reconnect(token);
    log("A4.1b stale token: RECONNECTED (unexpected)");
  } catch (e) {
    log(`A4.1b stale token for a closed room: refused cleanly (${(e as Error).message.slice(0, 60)})`);
  }
}

// A4.2 a client killed in warm-up: its blob leaves, nobody is charged before GO
{
  const a = await join({ mode: "free", roomCode: "QAWU", guestKey: key("w1") }, "private");
  const b = await join({ mode: "free", roomCode: "QAWU", guestKey: key("w2") }, "private");
  await sleep(500);
  const before = st(a).humans;
  await drop(b);
  await sleep(1000);
  log(`A4.2 kill in warm-up (private lobby): humans ${before} -> ${st(a).humans} while held, then after the 20 s hold:`);
  await sleep(21_000);
  log(`A4.2 humans now ${st(a).humans} (expected 1)`);
  await Promise.race([a.leave().catch(() => 0), sleep(1500)]);
}

// A4.5 two tabs on one guest key: same room refused, a different room allowed (each pays its own entry)
{
  const k = key("tabs");
  const a = await join({ mode: "free", guestKey: k });
  try {
    await join({ mode: "free", guestKey: k });
    log("A4.5 second tab, same public room: JOINED (unexpected)");
  } catch (e) {
    log(`A4.5 second tab, same room: refused (${(e as Error).message})`);
  }
  try {
    const p = await join({ mode: "free", roomCode: "QATB", guestKey: k }, "private");
    log("A4.5 second tab, a private room: joined (a separate match, charged at its own GO)");
    await Promise.race([p.leave().catch(() => 0), sleep(1500)]);
  } catch (e) {
    log(`A4.5 second tab, private room: refused (${(e as Error).message})`);
  }
  await Promise.race([a.leave().catch(() => 0), sleep(1500)]);
}

// A4.4 a client that stops reading: the server must not buffer for it forever or slow others down
{
  const healthy = await join({ mode: "free", guestKey: key("ok") });
  const slow = await join({ mode: "free", guestKey: key("slow") });
  const sock = (slow.connection as unknown as { transport: { ws: { _socket?: { pause(): void } } } }).transport.ws._socket;
  sock?.pause();
  let patches = 0;
  healthy.onStateChange(() => patches++);
  const rss0 = (await (await fetch(`${http}/health`)).json()) as { rssMB: number };
  await sleep(20_000);
  const h = (await (await fetch(`${http}/health`)).json()) as { rssMB: number; ticks: { p99Ms: number } };
  log(`A4.4 one client paused its socket for 20 s: healthy client got ${patches} patches (${(patches / 20).toFixed(1)}/s), server RSS ${rss0.rssMB} -> ${h.rssMB} MB, tick p99 ${h.ticks.p99Ms} ms, paused socket paused: ${!!sock}`);
  await drop(slow);
  await Promise.race([healthy.leave().catch(() => 0), sleep(1500)]);
}

const alive = await fetch(`${http}/health`).then((r) => r.ok).catch(() => false);
log(`server alive after chaos: ${alive}`);
process.exit(0);
