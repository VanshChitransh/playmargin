// QA-C harness: scripted humans play REAL matches on a running server, then every match is checked
// three ways: the client's log receipt (receiptFromLog), the live payout the server stored
// (match_players.payout) and settleVerified(log) must agree to the Micro, and settle's exact books
// equality (conservation) must hold. Usage:
//   QA_PORT=2601 QA_DB=/path/qa.sqlite npx tsx tools/sim/qa/qa-c.ts <scenario> [count]
// Scenarios: agents | duel | twelve | late | lone | afk | collude | borrowfeed | lastcash | wall | spikes
import { DatabaseSync } from "node:sqlite";
import { Client, type Room } from "@colyseus/sdk";
import { MICRO, settleVerified, type LogEntry } from "@margin/core";
import { receiptFromLog } from "../../../apps/client/src/game/receipt";

const PORT = Number(process.env.QA_PORT ?? 2601);
const DB = process.env.QA_DB ?? "";
const base = `http://localhost:${PORT}`;
const sdk = new Client(`ws://localhost:${PORT}`);
const scenario = process.argv[2] ?? "agents";
const count = Number(process.argv[3] ?? 1);
let keySeq = 0;
const guestKey = (): string => `ed25519:qac${Date.now().toString(36)}${(keySeq++).toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const code = (): string => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");

type B = { id: string; kind: string; label: string; x: number; y: number; radius: number; ring: string; equity: number; state: string; cashingOut: boolean };
type S = { phase: string; timeLeftS: number; blobs: Map<string, B>; food: Map<string, { x: number; y: number }>; spikes: Map<string, { x: number; y: number; live: boolean }>; arenaW: number; arenaH: number };
/** A brain sees the room state and my id, returns the held input for the next 50 ms. */
type Brain = (s: S, me: string, owe: number) => { dirX: number; dirY: number; boost: boolean; repay: boolean; cashout: boolean };
const norm = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l] as const; };
const mine = (s: S, me: string): B | undefined => s.blobs.get(me);

/** Eat food, flee bigger blobs, a little BOOST when clear, REPAY when not green (the sim newcomer). */
const newcomer = (opts: { boost?: boolean; cashAtLeft?: number } = {}): Brain => {
  let t = 0;
  return (s, me, owe) => {
    t++;
    const m = mine(s, me);
    const out = { dirX: 0, dirY: 0, boost: false, repay: false, cashout: false };
    if (!m || m.state !== "alive") return out;
    let dx = 0, dy = 0, threat = Infinity;
    s.blobs.forEach((o) => {
      if (o.id === me || o.state !== "alive" || o.kind === "drone" || o.radius <= m.radius * 1.07) return;
      const d = Math.hypot(o.x - m.x, o.y - m.y) - o.radius - m.radius;
      threat = Math.min(threat, d);
      if (d < 300) (dx -= (o.x - m.x) / (d + 1)), (dy -= (o.y - m.y) / (d + 1));
    });
    if (dx === 0 && dy === 0) {
      let best = Infinity;
      s.food.forEach((f) => { const d = Math.hypot(f.x - m.x, f.y - m.y); if (d < best) (best = d), (dx = f.x - m.x), (dy = f.y - m.y); });
    }
    [out.dirX, out.dirY] = norm(dx, dy);
    out.boost = !!opts.boost && m.ring === "green" && threat > 500 && t % 120 < 20;
    out.repay = m.ring !== "green" && owe > 0;
    out.cashout = opts.cashAtLeft !== undefined && s.phase === "LIVE" && s.timeLeftS <= opts.cashAtLeft;
    return out;
  };
};
const idle: Brain = () => ({ dirX: 0, dirY: 0, boost: false, repay: false, cashout: false });
/** Drive toward a partner's blob (feeding), optionally boosting first (borrow-and-feed). */
const feeder = (partner: () => string, boostFirst: boolean): Brain => (s, me) => {
  const m = mine(s, me), p = s.blobs.get(partner());
  if (!m || !p || m.state !== "alive") return idle(s, me, 0);
  const [dirX, dirY] = norm(p.x - m.x, p.y - m.y);
  return { dirX, dirY, boost: boostFirst && m.ring === "green", repay: false, cashout: false };
};
const toWall: Brain = (s, me) => { const m = mine(s, me); return m ? { dirX: 1, dirY: 1, boost: false, repay: false, cashout: false } : idle(s, me, 0); };
const toSpikes: Brain = (s, me) => {
  const m = mine(s, me);
  if (!m || m.state !== "alive") return idle(s, me, 0);
  let best = Infinity, dx = 0, dy = 0;
  s.spikes.forEach((k) => { if (!k.live) return; const d = Math.hypot(k.x - m.x, k.y - m.y); if (d < best) (best = d), (dx = k.x - m.x), (dy = k.y - m.y); });
  const [dirX, dirY] = norm(dx, dy);
  return { dirX, dirY, boost: m.ring === "green", repay: false, cashout: false };
};

interface Seat { room: Room; brain: Brain; owe: number; key: string; name: string }
async function seat(opts: { roomCode?: string; name: string; brain: Brain }): Promise<Seat> {
  const key = guestKey();
  const room = await sdk.joinOrCreate(opts.roomCode ? "private" : "match", { mode: "free", guestKey: key, roomCode: opts.roomCode, name: opts.name });
  const st: Seat = { room, brain: opts.brain, owe: 0, key, name: opts.name };
  room.onMessage("me", (m: { owe: number }) => void (st.owe = m.owe));
  room.onMessage("ev", () => {});
  room.onMessage("commander", () => {});
  return st;
}
function drive(seats: Seat[]): () => void {
  let seq = 0;
  const iv = setInterval(() => {
    seq++;
    for (const s of seats) {
      try {
        const cmd = s.brain(s.room.state as unknown as S, s.room.sessionId, s.owe);
        s.room.send("input", { seq, ...cmd });
      } catch { /* the room may have closed */ }
    }
  }, 50);
  return () => clearInterval(iv);
}
const ended = (seats: Seat[]) => Promise.all(seats.map((s) => new Promise<void>((r) => s.room.onLeave(() => r()))));

/** The money triple-check for one finished match. */
async function check(matchId: string, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/api/matches/${matchId}/log`);
  const body = (await res.json()) as { status: string; log: LogEntry[] };
  const log = body.log;
  const out: Record<string, unknown> = { label, matchId, status: body.status, entries: log.length };
  let settle: Awaited<ReturnType<typeof settleVerified>> | null = null;
  try { settle = await settleVerified(log); out.settle = "ok (books exact, chain intact)"; } catch (e) { out.settle = `REFUSED: ${(e as Error).message}`; }
  const db = new DatabaseSync(DB, { readOnly: true });
  const seats = db.prepare("SELECT blob_id AS blob, user_id AS user, entry, payout FROM match_players WHERE match_id = ?").all(matchId) as Array<{ blob: string; user: string; entry: number; payout: number | null }>;
  const rows = seats.map((s) => {
    const fromSettle = settle?.payouts.find((p) => p.id === s.blob)?.amount ?? 0;
    const rec = receiptFromLog(log, s.blob);
    const fromReceipt = rec ? Math.round(rec.end * MICRO) : null;
    const lineSum = rec ? Math.round((rec.start + rec.lines.reduce((a, l) => a + l.amount, 0)) * MICRO) : null;
    const ok = (s.payout ?? 0) === fromSettle && fromReceipt === fromSettle && lineSum === fromReceipt;
    return { blob: s.blob, live: s.payout ?? 0, settle: fromSettle, receipt: fromReceipt, receiptLinesSum: lineSum, kind: rec?.kind, ok };
  });
  db.close();
  out.seats = rows;
  out.allEqual = rows.every((r) => r.ok) && typeof out.settle === "string" && out.settle.startsWith("ok");
  const end = log.at(-1);
  if (end?.type === "MATCH_END") out.matchEnd = { toVault: end.data.toVault, dust: end.data.dust };
  out.bell = log.filter((e) => e.type === "CASHOUT" && e.tick === end?.tick).map((e) => ({ blob: (e.data as { blob: string }).blob, amount: (e.data as { amount: number }).amount }));
  return out;
}

async function runOne(i: number): Promise<Record<string, unknown>> {
  const pc = code();
  let seats: Seat[] = [];
  const host = async (n: number, brains: (k: number) => Brain) => {
    const first = await seat({ roomCode: pc, name: `QA H${i}x0`, brain: brains(0) });
    const rest = await Promise.all(Array.from({ length: n - 1 }, (_, k) => seat({ roomCode: pc, name: `QA H${i}x${k + 1}`, brain: brains(k + 1) })));
    seats = [first, ...rest];
    await new Promise((r) => setTimeout(r, 300));
    first.room.send("startNow");
  };
  switch (scenario) {
    case "agents": seats = [await seat({ name: `QA A${i}`, brain: newcomer({ boost: true }) })]; break;
    case "afk": seats = [await seat({ name: `QA AFK${i}`, brain: idle })]; break;
    case "wall": seats = [await seat({ name: `QA W${i}`, brain: toWall })]; break;
    case "spikes": seats = [await seat({ name: `QA S${i}`, brain: toSpikes })]; break;
    case "duel": await host(2, () => newcomer({ boost: true })); break;
    case "twelve": await host(12, (k) => newcomer({ boost: k % 2 === 0 })); break;
    case "lone": await host(4, (k) => (k === 0 ? newcomer() : newcomer({ cashAtLeft: 40 }))); break;
    case "lastcash": await host(3, (k) => newcomer({ cashAtLeft: k === 0 ? 14 : k === 1 ? 10 : 6 })); break;
    case "collude": await host(2, (k) => (k === 0 ? idle : feeder(() => seats[0]!.room.sessionId, false))); break;
    case "borrowfeed": await host(2, (k) => (k === 0 ? idle : feeder(() => seats[0]!.room.sessionId, true))); break;
    case "late": {
      // A filler joins a public room; the late joiner comes in after GO (the first 15 s allow it).
      const filler = await seat({ name: `QA L${i}a`, brain: newcomer() });
      const id = filler.room.roomId;
      while ((filler.room.state as unknown as S).phase !== "LIVE") await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 2000)); // 8 s of game time at SIM_SPEED 4
      const key = guestKey();
      const late = await sdk.joinById(id, { mode: "free", guestKey: key, name: `QA L${i}b` });
      const ls: Seat = { room: late, brain: newcomer(), owe: 0, key, name: "late" };
      late.onMessage("me", (m: { owe: number }) => void (ls.owe = m.owe));
      late.onMessage("ev", () => {});
      late.onMessage("commander", () => {});
      seats = [filler, ls];
      break;
    }
    default: throw new Error(`unknown scenario ${scenario}`);
  }
  const matchId = seats[0]!.room.roomId;
  const stop = drive(seats);
  await ended(seats);
  stop();
  await new Promise((r) => setTimeout(r, 500)); // settle is stored right after the bell
  return check(matchId, `${scenario}#${i}`);
}

const results = await Promise.all(Array.from({ length: count }, (_, i) => runOne(i).catch((e: Error) => ({ label: `${scenario}#${i}`, error: e.message }))));
console.log(JSON.stringify(results, null, 1));
const bad = results.filter((r) => !(r as { allEqual?: boolean }).allEqual);
console.log(`${scenario}: ${results.length - bad.length}/${results.length} matches with log receipt == live == settle and exact books`);
process.exit(bad.length ? 1 : 0);
