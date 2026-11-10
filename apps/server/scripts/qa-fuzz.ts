// QA-A2 protocol fuzz against a live server: garbage, floods, wrong-phase inputs and join abuse from
// raw Colyseus clients. After every step the server must still answer /health and the room must keep
// ticking. Money checks (conservation, credits) run afterwards on the DB (qa-db.ts).
// Usage: npx tsx apps/server/scripts/qa-fuzz.ts http://localhost:2611
import { Client, type Room } from "@colyseus/sdk";

const http = process.argv[2] ?? "http://localhost:2611";
const ws = http.replace(/^http/, "ws");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (w: string) => `qa-fz-${w}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const results: Array<{ step: string; ok: boolean; note: string }> = [];
const health = async () => (await (await fetch(`${http}/health`)).json()) as { ok: boolean; rooms: number; ticks: { count: number } };

async function step(name: string, fn: () => Promise<string>): Promise<void> {
  const before = await health();
  let note = "";
  try {
    note = await fn();
  } catch (e) {
    note = `threw: ${(e as Error).message}`;
  }
  await sleep(400);
  const after = await health().catch(() => null);
  const ok = !!after?.ok && after.ticks.count > before.ticks.count;
  results.push({ step: name, ok, note: `${note} | server ${after ? "up" : "DOWN"}, ticks +${after ? after.ticks.count - before.ticks.count : "?"}` });
}

const join = (opts: object, name = "match"): Promise<Room> => new Client(ws).joinOrCreate(name, opts);
/** leave() never settles on a socket the server already closed, so cap it. */
const bye = (r: Room) => Promise.race([r.leave().catch(() => 0), sleep(1500)]);
const watchState = (r: Room) => r.state as { phase?: string; tick?: number };
const closed = (r: Room) => new Promise<number>((res) => r.onLeave((c) => res(c)));

// Witness: a private lobby that just waits, so the server keeps ticking whatever the fuzzed rooms do.
const witness = await join({ mode: "free", roomCode: "QAWT", guestKey: key("wit") }, "private");
witness.onMessage("*", () => {});
const labels = (r: Room): string[] => {
  const out: string[] = [];
  (r.state as { blobs?: { forEach(cb: (b: { label: string }) => void): void } }).blobs?.forEach((b) => out.push(b.label));
  return out;
};

// A2.1 garbage payloads on "input" and unknown message types
await step("A2.1 garbage inputs", async () => {
  const r = await join({ mode: "free", guestKey: key("g") });
  r.onMessage("*", () => {});
  const junk: unknown[] = [null, 1, "str", [], {}, true, { seq: "a" }, { dirX: Number.NaN, dirY: Infinity }, { dirX: 1e308, dirY: -1e308, boost: "yes", repay: 7, cashout: {} }, { seq: -1 }, { seq: 2 ** 53 }, { ["__proto__"]: { polluted: 1 } }, "x".repeat(4_000)];
  for (const j of junk) r.send("input", j as never);
  await sleep(500);
  const afterJunk = r.connection.isOpen;
  r.send("hack", { boom: 1 });
  await sleep(500);
  const afterUnknown = r.connection.isOpen;
  await bye(r);
  return `${junk.length} junk inputs: still connected ${afterJunk} (dropped silently). Unknown type "hack": still connected ${afterUnknown} (Colyseus kicks 4002)`;
});

// A2.1b one oversized frame (1 MB): ws should close that socket only
await step("A2.1b oversized frame", async () => {
  const r = await join({ mode: "free", guestKey: key("big") });
  r.onMessage("*", () => {});
  const left = closed(r);
  r.send("input", "x".repeat(1_000_000) as never);
  const code = await Promise.race([left, sleep(3000).then(() => -1)]);
  await bye(r);
  return `1 MB frame: socket closed with code ${code}`;
});

// A2.2 flood far above 30/s: the guard should drop the client, the room and server stay up
await step("A2.2 input flood", async () => {
  const r = await join({ mode: "free", guestKey: key("f") });
  r.onMessage("*", () => {});
  const left = closed(r);
  const t0 = Date.now();
  let sent = 0;
  while (Date.now() - t0 < 2000 && r.connection.isOpen) {
    for (let i = 0; i < 50; i++) r.send("input", { seq: ++sent, dirX: 1, dirY: 0, boost: true, repay: false, cashout: false });
    await sleep(5);
  }
  const code = await Promise.race([left, sleep(3000).then(() => -1)]);
  await bye(r);
  return `sent ${sent} inputs in ${Date.now() - t0} ms, dropped by server with code ${code}`;
});

// A2.3 wrong-phase inputs: BOOST/REPAY/cashout in warm-up, startNow from a non-host in a private room
await step("A2.3 wrong phase", async () => {
  const r = await join({ mode: "free", guestKey: key("w") });
  r.onMessage("*", () => {});
  const phase0 = watchState(r).phase;
  for (let i = 1; i <= 25; i++) r.send("input", { seq: i, dirX: 0, dirY: 1, boost: i % 2 === 0, repay: true, cashout: true });
  const code = Array.from({ length: 4 }, () => "BCDFGHJKLMNPQRSTVWXZ"[Math.floor(Math.random() * 20)]).join("");
  const host = await join({ mode: "free", roomCode: code, guestKey: key("h") }, "private");
  const guest = await join({ mode: "free", roomCode: code, guestKey: key("p") }, "private");
  for (const x of [host, guest]) x.onMessage("*", () => {});
  guest.send("startNow");
  await sleep(1500);
  const privPhase = watchState(guest).phase;
  await Promise.all([bye(r), bye(host), bye(guest)]);
  return `public phase ${phase0} took boost/repay/cashout spam; private room phase after a guest's startNow: ${privPhase} (expected WARMUP)`;
});

// A2.4 join abuse: same guest key twice, bad options, huge name, bad mode, bad room code
await step("A2.4 join abuse", async () => {
  const k = key("dup");
  const a = await join({ mode: "free", guestKey: k });
  a.onMessage("*", () => {});
  const out: string[] = [];
  const tryJoin = async (label: string, opts: object, name = "match") => {
    try {
      const r = await join(opts, name);
      r.onMessage("*", () => {});
      await sleep(400);
      const mine = labels(r).filter((l) => !l.includes("\u{1F916}"));
      out.push(`${label}: JOINED as ${JSON.stringify(mine.at(-1) ?? "?")} in mode ${(r.state as { mode?: string }).mode}`);
      await bye(r);
    } catch (e) {
      out.push(`${label}: refused (${(e as Error).message.slice(0, 60)})`);
    }
  };
  await tryJoin("same guest key, same room", { mode: "free", guestKey: k });
  await tryJoin("no guestKey", { mode: "free" });
  await tryJoin("guestKey 10 KB", { mode: "free", guestKey: "q".repeat(10_000) });
  await tryJoin("name 100 KB + html", { mode: "free", guestKey: key("n"), name: `<img src=x onerror=alert(1)>${"n".repeat(100_000)}` });
  await tryJoin("name posing as agent", { mode: "free", guestKey: key("a"), name: "Agent-3 \u{1F916}" });
  await tryJoin("mode bogus", { mode: "rich", guestKey: key("m") });
  await tryJoin("mode paid on a free server", { mode: "paid", guestKey: key("pp") });
  await tryJoin("roomCode lowercase/emoji", { mode: "free", guestKey: key("rc"), roomCode: "\u{1F600}x" }, "private");
  await tryJoin("judge with options", { mode: "paid", guestKey: key("j"), name: "x" }, "judge");
  await bye(a);
  return out.join("; ");
});

await bye(witness);
console.log(JSON.stringify(results, null, 1));
console.log(results.every((r) => r.ok) ? "FUZZ: server survived every step" : "FUZZ: SERVER PROBLEM");
process.exit(0);
