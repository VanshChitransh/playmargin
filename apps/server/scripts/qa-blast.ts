// QA-A3 blast: scripted humans against a live server, measuring matchmaking time and patch flow.
// Scenarios:
//   one   12 humans in ONE private room, host starts, one full match
//   mixed 10+ rooms at once: 3 public (2 humans + agents), 3 private duels, 1 private 12 humans,
//         1 public 12 humans (no agents), 2 agents-only rooms watched via /api/watch
//   soak  keep N clients playing (public and private, rejoin after each match) for M minutes
// Usage: npx tsx apps/server/scripts/qa-blast.ts <scenario> http://localhost:2611 [clients] [minutes]
// Bots wander, hold BOOST and REPAY in bursts and spam cash-out from 0:45, so the DB check (A5) also
// covers wrong-phase money. Guest keys start with "qa-" so stats() never counts this traffic.
import { Client, type Room } from "@colyseus/sdk";
import { R } from "@margin/core";

const [scenario = "one", http = "http://localhost:2611", nArg = "100", minArg = "15"] = process.argv.slice(2);
const ws = http.replace(/^http/, "ws");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (n: number) => Math.floor(Math.random() * n);
const code4 = () => Array.from({ length: 4 }, () => "BCDFGHJKLMNPQRSTVWXZ"[rnd(20)]).join("");

interface Stat { joinMs: number[]; patches: number; gaps: number; maxGapMs: number; ended: number; refused: string[]; kicked: number; liveS: number }
const stat: Stat = { joinMs: [], patches: 0, gaps: 0, maxGapMs: 0, ended: 0, refused: [], kicked: 0, liveS: 0 };
const GAP_MS = 3 * (1000 / R.SEND_HZ); // three missed patches in a row counts as a gap

/** One scripted human for one match. Resolves when the match ends or the client is dropped. */
async function human(opts: { roomCode?: string; host?: boolean; startWhen?: () => boolean }): Promise<void> {
  const t0 = performance.now();
  let room: Room;
  try {
    room = await new Client(ws).joinOrCreate(opts.roomCode ? "private" : "match", { mode: "free", guestKey: `qa-bl-${Date.now().toString(36)}${rnd(1e9)}`, roomCode: opts.roomCode, name: `bl${rnd(1000)}` });
  } catch (e) {
    stat.refused.push((e as Error).message.slice(0, 50));
    return;
  }
  stat.joinMs.push(performance.now() - t0);
  let last = 0;
  let liveAt = 0;
  room.onStateChange((s) => {
    const now = performance.now();
    stat.patches++;
    const phase = (s as { phase?: string }).phase;
    if (phase === "LIVE") {
      liveAt ||= now;
      if (last && now - last > GAP_MS) (stat.gaps++, (stat.maxGapMs = Math.max(stat.maxGapMs, now - last)));
    }
    last = now;
  });
  room.onMessage("*", () => {});
  let done = false;
  const finished = new Promise<void>((res) => {
    room.onMessage("ev", (e: { type: string }) => {
      if (e.type === "matchEnd") (stat.ended++, (done = true), res());
    });
    room.onLeave((c) => {
      if (!done && c !== 1000) stat.kicked++;
      done = true;
      res();
    });
  });
  let seq = 0;
  let a = Math.random() * 6.28;
  const iv = setInterval(() => {
    if (done) return;
    a += (Math.random() - 0.5) * 0.6;
    const t = seq++ % 100;
    const late = liveAt && performance.now() - liveAt > 45_000;
    room.send("input", { seq, dirX: Math.cos(a), dirY: Math.sin(a), boost: t < 10, repay: t >= 40 && t < 55, cashout: !!late && t % 10 === 0 });
    if (opts.host && opts.startWhen?.()) room.send("startNow");
  }, 50);
  await Promise.race([finished, sleep((R.MATCH_S + 60) * 1000)]);
  clearInterval(iv);
  if (liveAt) stat.liveS += (performance.now() - liveAt) / 1000;
  await Promise.race([room.leave().catch(() => 0), sleep(1500)]);
}

/** A private room of n humans; the host starts once everyone is in. */
async function privateRoom(n: number): Promise<void> {
  const code = code4();
  let joined = 0;
  const all = [human({ roomCode: code, host: true, startWhen: () => joined >= n })];
  joined++;
  await sleep(300);
  for (let i = 1; i < n; i++) {
    all.push(human({ roomCode: code }));
    joined++;
  }
  await Promise.all(all);
}

async function watchAgentsOnly(): Promise<void> {
  const r = await fetch(`${http}/api/watch`);
  if (!r.ok) return void stat.refused.push(`watch ${r.status}`);
  const room = await new Client(ws).consumeSeatReservation(await r.json());
  room.onMessage("*", () => {});
  await new Promise<void>((res) => room.onMessage("ev", (e: { type: string }) => e.type === "matchEnd" && res()));
  await Promise.race([room.leave().catch(() => 0), sleep(1500)]);
}

const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!.toFixed(0) : "-");
const report = (label: string) => {
  const live = stat.liveS || 1;
  console.log(JSON.stringify({ label, joins: stat.joinMs.length, joinMsP50: pct(stat.joinMs, 50), joinMsP99: pct(stat.joinMs, 99), joinMsMax: pct(stat.joinMs, 100), matchesEndedSeen: stat.ended, patches: stat.patches, patchesPerLiveClientS: (stat.patches / live).toFixed(1), expectedHz: R.SEND_HZ, gapsOver3Patches: stat.gaps, maxGapMs: stat.maxGapMs.toFixed(0), kicked: stat.kicked, refused: stat.refused.length, refusedSample: [...new Set(stat.refused)].slice(0, 3) }));
};

const t0 = Date.now();
if (scenario === "one") {
  await privateRoom(12);
} else if (scenario === "mixed") {
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < 3; i++) jobs.push(privateRoom(2)); // duels
  jobs.push(privateRoom(12)); // 12 humans, no agents
  for (let i = 0; i < 3; i++) jobs.push((async () => { const c = code4(); void c; await Promise.all([human({}), human({})]); })()); // public, filled by agents
  jobs.push(watchAgentsOnly(), watchAgentsOnly()); // agents-only rooms
  // public room with 12 humans: 12 joins at once land in the same unlocked public room
  jobs.push(Promise.all(Array.from({ length: 12 }, () => human({}))).then(() => {}));
  await Promise.all(jobs);
} else {
  const n = Number(nArg);
  const until = t0 + Number(minArg) * 60_000;
  const lane = async (i: number) => {
    while (Date.now() < until) {
      if (i % 4 === 0) await privateRoom(4);
      else await human({});
    }
  };
  // About n live clients: three of four lanes are one public human, one in four a private room of 4.
  const lanes = Math.round(n / 1.75);
  const tick = setInterval(() => report(`soak t+${Math.round((Date.now() - t0) / 1000)}s`), 60_000);
  await Promise.all(Array.from({ length: lanes }, (_, i) => sleep(i * 150).then(() => lane(i))));
  clearInterval(tick);
}
report(`${scenario} done in ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(0);
