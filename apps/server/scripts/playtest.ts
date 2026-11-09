// QA playtest harness: boots a fresh server + Vite client from this checkout, drives the REAL client
// in Chrome (playwright-core + the installed Google Chrome) with scripted mouse and keyboard play,
// and measures what a player sees. A spectator socket reads the exact world for the numbers.
//
//   npx tsx apps/server/scripts/playtest.ts play [strategy] [--cpu 4] [--w 1280 --h 800] [--mobile]
//   npx tsx apps/server/scripts/playtest.ts runs [n=10] [strategy=food] [--par 5]   n fresh-server matches
//   npx tsx apps/server/scripts/playtest.ts survival [n=10]        n staggered matches, no BOOST
//   npx tsx apps/server/scripts/playtest.ts edges                   reload, late join, 2 tabs, credits, freeze
//   npx tsx apps/server/scripts/playtest.ts walls                   4 walls, a corner, blob on blob: r/2 clamp
// strategies: wander | food | flee | boost | redrepay | cashout. Output: playtest-out/<run>/ (json, png, mp4)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client, type Room } from "@colyseus/sdk";
import { chromium, type Browser, type Page } from "playwright-core";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const argv = process.argv.slice(2);
const flag = (k: string, d?: string) => (argv.includes(`--${k}`) ? (argv[argv.indexOf(`--${k}`) + 1] ?? "1") : d);
const mode = argv[0] ?? "play";
const ROOT = new URL("../../../", import.meta.url).pathname;
const OUT = join(ROOT, "playtest-out", `${mode}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const report: Record<string, unknown> = { mode };
const procs: ChildProcess[] = [];
process.on("exit", () => procs.forEach((p) => p.kill("SIGKILL")));

const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

/** Fresh server (own DB) + Vite client pointed at it. */
async function boot(dir = OUT) {
  mkdirSync(dir, { recursive: true });
  const [sp, cp] = [await freePort(), await freePort()];
  const db = join(dir, "server.sqlite");
  const serverLog: string[] = [];
  const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: join(ROOT, "apps/server"),
    env: { ...process.env, PORT: String(sp), DB_PATH: db, JOIN_LIMIT_PER_MIN: "1000", CONTRACT_ID: "", SETTLER_PRIVATE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (b: Buffer) => serverLog.push(b.toString()));
  server.stderr!.on("data", (b: Buffer) => serverLog.push(b.toString()));
  const client = spawn(join(ROOT, "node_modules/.bin/vite"), ["--port", String(cp), "--strictPort"], {
    cwd: join(ROOT, "apps/client"),
    env: { ...process.env, VITE_SERVER_URL: `http://localhost:${sp}` },
    stdio: "ignore",
  });
  procs.push(server, client);
  for (let i = 0; i < 60; i++) {
    const ok = await Promise.all([fetch(`http://localhost:${sp}/health`), fetch(`http://localhost:${cp}/`)]).then((r) => r.every((x) => x.ok), () => false);
    if (ok) break;
    await sleep(500);
  }
  return { api: `http://localhost:${sp}`, web: `http://localhost:${cp}`, db, serverLog };
}

type Blob = { kind: string; label: string; x: number; y: number; radius: number; ring: string; state: string; fuel?: number; equity: number };
type St = { phase: string; timeLeftS: number; arenaW: number; arenaH: number; blobs: Map<string, Blob>; food: Map<string, { x: number; y: number; radius: number }>; spikes: Map<string, { x: number; y: number; radius: number; live: boolean }> };

/** Exact zoom the client targets (apps/client/src/render/arena.ts follow()). */
const zoomFor = (w: number, h: number, r: number) => (Math.max(w, h) / 2100) * Math.min(1.2, Math.max(0.35, Math.pow(57 / Math.max(r, 1), 0.4)));

async function newPage(browser: Browser, opts: { w: number; h: number; mobile?: boolean; guest?: string }) {
  const ctx = await browser.newContext({
    viewport: { width: opts.w, height: opts.h },
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
    deviceScaleFactor: opts.mobile ? 3 : 1,
  });
  if (opts.guest) await ctx.addInitScript(`localStorage.setItem("margin.guest", ${JSON.stringify(opts.guest)})`);
  // Frame timer: every rAF delta, read back at the end for FPS and frame time percentiles.
  // A string, not a function: tsx would wrap a function with a __name helper the page lacks.
  await ctx.addInitScript("window.__ft=[];let __l=performance.now();const __f=(t)=>{window.__ft.push(t-__l);__l=t;requestAnimationFrame(__f)};requestAnimationFrame(__f);");
  const page = await ctx.newPage();
  const consoleLog: string[] = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && consoleLog.push(`${m.type()}: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => consoleLog.push(`pageerror: ${e.message.slice(0, 200)}`));
  return { page, ctx, consoleLog };
}

async function frameStats(page: Page) {
  const ft = (await page.evaluate("window.__ft.slice(60)")) as number[];
  const s = [...ft].sort((a, b) => a - b);
  const q = (p: number) => Math.round((s[Math.floor(p * (s.length - 1))] ?? 0) * 10) / 10;
  return { frames: s.length, fps: Math.round(1000 / (ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length))), p50ms: q(0.5), p95ms: q(0.95), p99ms: q(0.99), over33ms: s.filter((x) => x > 33.4).length };
}

/** Steer: point the mouse from screen centre toward a world direction. */
async function steer(page: Page, w: number, h: number, dx: number, dy: number) {
  const n = Math.hypot(dx, dy) || 1;
  await page.mouse.move(w / 2 + (dx / n) * Math.min(w, h) * 0.3, h / 2 + (dy / n) * Math.min(w, h) * 0.3);
}

/** One full match as a browser player with a strategy, measured through a spectator. */
async function play(strategy: string, o: { w: number; h: number; cpu?: number; mobile?: boolean }, dir = OUT, record = true) {
  const env = await boot(dir);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--enable-gpu"] });
  const { page, ctx, consoleLog } = await newPage(browser, { ...o, guest: `qa-${strategy}-${Date.now()}` });
  if (o.cpu) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: o.cpu });
  await page.goto(`${env.web}/#/play`);
  await sleep(1500);
  const sdk = new Client(env.api.replace("http", "ws"));
  let spec: Room | null = null;
  // The player's room is the only one on this fresh server: wait for it, then /api/watch picks it.
  for (let i = 0; i < 40 && !spec; i++) {
    const { rooms } = (await (await fetch(`${env.api}/health`)).json()) as { rooms: number };
    if (rooms >= 1) spec = await sdk.consumeSeatReservation(await (await fetch(`${env.api}/api/watch`)).json());
    else await sleep(500);
  }
  if (!spec) throw new Error("could not spectate the player's room");
  // Film the same room from #/watch with S3's recorder (30 s mp4), in parallel.
  if (record) procs.push(spawn("bash", ["scripts/record.sh", "30", join(dir, "watch.mp4"), `${env.web}/?clean=1#/watch`], { cwd: join(ROOT, "apps/client"), stdio: "ignore" }));
  // Every game event the room broadcasts, by type (pops = liquidations seen, clutchSave, spikeHit...).
  const evCounts: Record<string, number> = {};
  spec.onMessage("ev", (e: { type: string }) => void (evCounts[e.type] = (evCounts[e.type] ?? 0) + 1));
  spec.onMessage("commander", () => {});
  const st = () => spec!.state as unknown as St;
  const m = { onScreen: [] as number[], firstContactS: null as number | null, speeds: [] as Array<{ r: number; pxs: number }>, foodPerMP: [] as number[], foodPct: 0, spikePct: 0, clump: [] as number[], jitter: [] as number[], earlyHunters: 0, redS: 0, boosted: false, repaid: false, cashTried: false, final: "" };
  let prev = new Map<string, { x: number; y: number; dx: number; dy: number }>();
  let wander = Math.random() * Math.PI * 2;
  let holding = false;
  let shot = 0;
  let liveAt = 0;
  for (let tick = 0; tick < 2000; tick++) {
    await sleep(100);
    const s = st();
    if (s.phase === "ENDED" || !s.blobs) break;
    const me = [...s.blobs.values()].find((b) => b.kind === "human");
    if (!me) continue;
    if (s.phase === "LIVE" && !liveAt) liveAt = Date.now();
    const t = liveAt ? (Date.now() - liveAt) / 1000 : 0;
    const z = zoomFor(o.w, o.h, me.radius);
    if (tick % 30 === 0) await page.screenshot({ path: join(dir, `shot-${String(shot++).padStart(3, "0")}.png`) });
    if (!liveAt || me.state !== "alive") {
      if (me.state !== "alive") m.final = me.state;
      continue;
    }
    // What a player sees: pellets in view per megapixel, sizes as % of screen width, speed on screen.
    const halfW = o.w / 2 / z;
    const halfH = o.h / 2 / z;
    const inView = (p: { x: number; y: number }) => Math.abs(p.x - me.x) < halfW && Math.abs(p.y - me.y) < halfH;
    const food = [...s.food.values()];
    const visible = food.filter(inView).length;
    m.foodPerMP.push(visible / ((o.w * o.h) / 1e6));
    m.onScreen.push(visible);
    m.foodPct = Math.round(((2 * (food[0]?.radius ?? 0) * z) / o.w) * 1000) / 10;
    m.spikePct = Math.round(((2 * ([...s.spikes.values()][0]?.radius ?? 0) * z) / o.w) * 1000) / 10;
    const others = [...s.blobs.entries()].filter(([, b]) => b !== me && b.state === "alive");
    if (m.firstContactS === null && others.some(([, b]) => Math.hypot(b.x - me.x, b.y - me.y) < b.radius + me.radius + 5)) m.firstContactS = Math.round(t);
    const next = new Map<string, { x: number; y: number; dx: number; dy: number }>();
    let turns = 0;
    for (const [id, b] of s.blobs) {
      const p = prev.get(id);
      const dx = p ? b.x - p.x : 0;
      const dy = p ? b.y - p.y : 0;
      next.set(id, { x: b.x, y: b.y, dx, dy });
      if (p && b === me) m.speeds.push({ r: Math.round(b.radius), pxs: Math.round(Math.hypot(dx, dy) * 10 * z) });
      if (p && b.kind === "agent" && Math.hypot(p.dx, p.dy) > 1 && Math.hypot(dx, dy) > 1) {
        const cos = (p.dx * dx + p.dy * dy) / (Math.hypot(p.dx, p.dy) * Math.hypot(dx, dy));
        if (cos < 0) turns++; // reversed direction within 100 ms: jitter
      }
    }
    prev = next;
    const agents = others.filter(([, b]) => b.kind === "agent").map(([, b]) => b);
    m.jitter.push(turns / Math.max(1, agents.length));
    m.clump.push(agents.filter((a) => agents.some((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius + 60)).length / Math.max(1, agents.length));
    if (t < 20) m.earlyHunters = Math.max(m.earlyHunters, agents.filter((a) => a.radius > me.radius * 1.15 && Math.hypot(a.x - me.x, a.y - me.y) < 400).length);
    if (me.ring === "red") m.redS += 0.1;
    // Strategy: a direction for the mouse, plus BOOST / REPAY / cash out keys.
    const nearestFood = food.reduce((a, f) => (Math.hypot(f.x - me.x, f.y - me.y) < Math.hypot(a.x - me.x, a.y - me.y) ? f : a), food[0] ?? me);
    const threat = others.map(([, b]) => b).filter((b) => b.radius > me.radius * 1.1 || b.kind === "drone").sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    const fd = Math.hypot(nearestFood.x - me.x, nearestFood.y - me.y) || 1;
    let aim: [number, number] = [(nearestFood.x - me.x) / fd, (nearestFood.y - me.y) / fd]; // unit, so spike push can win
    // Like a person: steer around spikes that sit on the way (within 2 radii ahead).
    for (const k of s.spikes.values()) {
      const d = Math.hypot(k.x - me.x, k.y - me.y);
      if (k.live && d < me.radius + k.radius + 70) aim = [aim[0] + ((me.x - k.x) / d) * 2, aim[1] + ((me.y - k.y) / d) * 2];
    }
    if (strategy === "wander") {
      if (tick % 20 === 0) wander += (Math.random() - 0.5) * 2;
      aim = [Math.cos(wander), Math.sin(wander)];
    }
    if ((strategy === "flee" || strategy === "cashout" || strategy === "redrepay") && threat && Math.hypot(threat.x - me.x, threat.y - me.y) < 450) aim = [me.x - threat.x, me.y - threat.y];
    await steer(page, o.w, o.h, aim[0], aim[1]);
    const wantBoost = (strategy === "boost" && t > 3) || (strategy === "redrepay" && me.ring !== "red" && !m.repaid && t > 3);
    if (wantBoost !== holding) {
      holding = wantBoost;
      await (holding ? page.keyboard.down("Space") : page.keyboard.up("Space"));
      if (holding) m.boosted = true;
    }
    if (strategy === "redrepay" && me.ring === "red" && tick % 4 === 0) {
      await page.keyboard.press("KeyR");
      m.repaid = true;
    }
    if (strategy === "cashout" && t > 46 && t < 79 && me.ring !== "red" && tick % 10 === 0) {
      await page.keyboard.press("KeyE");
      m.cashTried = true;
    }
  }
  const me = [...st().blobs.values()].find((b) => b.kind === "human");
  m.final = m.final || me?.state || "?";
  await sleep(2000);
  await page.screenshot({ path: join(dir, "result.png") });
  const fs = await frameStats(page);
  await spec.leave();
  await ctx.close();
  await browser.close();
  const avg = (a: number[]) => Math.round((a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)) * 100) / 100;
  const bySize = new Map<number, number[]>();
  for (const s of m.speeds) bySize.set(Math.round(s.r / 10) * 10, [...(bySize.get(Math.round(s.r / 10) * 10) ?? []), s.pxs]);
  // From the server's own log: spike hits and what ended the player, in seconds after GO.
  const db = new DatabaseSync(env.db, { readOnly: true });
  const q = (sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>;
  const go = (q("SELECT json_extract(json,'$.tick') AS t FROM events WHERE json_extract(json,'$.type')='MATCH_START'")[0]?.t as number) ?? 0;
  const human = "(SELECT blob_id FROM match_players)";
  const spikeHits = q(`SELECT COUNT(*) AS n FROM events WHERE json_extract(json,'$.type')='SPIKE' AND json_extract(json,'$.data.blob') IN ${human}`)[0]!.n as number;
  const death = q(`SELECT json_extract(json,'$.type') AS type, json_extract(json,'$.data.by') AS by, json_extract(json,'$.tick') AS t FROM events WHERE json_extract(json,'$.data.victim') IN ${human}`)[0];
  const cashed = q(`SELECT json_extract(json,'$.tick') AS t FROM events WHERE json_extract(json,'$.type')='CASHOUT' AND json_extract(json,'$.data.blob') IN ${human}`)[0];
  return {
    spikeHits, death: death ? { type: death.type, by: death.by, atS: Math.round(((death.t as number) - go) / 60) } : null,
    cashedAtS: cashed ? Math.round(((cashed.t as number) - go) / 60) : null,
    events: evCounts,
    pelletsOnScreen: Math.round(avg(m.onScreen)),
    startSpeedPxS: m.speeds.slice(0, 50).length ? Math.round(avg(m.speeds.slice(5, 50).map((x) => x.pxs))) : null,
    crossScreenS: m.speeds.length ? Math.round((o.w / Math.max(1, avg(m.speeds.slice(5, 50).map((x) => x.pxs)))) * 10) / 10 : null,
    strategy, viewport: `${o.w}x${o.h}${o.mobile ? " mobile" : ""}`, cpuThrottle: o.cpu ?? 1, frames: fs,
    pelletsPerMP: avg(m.foodPerMP), pelletPctWidth: m.foodPct, spikePctWidth: m.spikePct,
    speedPxPerSByRadius: Object.fromEntries([...bySize].sort((a, b) => a[0] - b[0]).map(([r, v]) => [r, Math.round(avg(v))])),
    firstContactS: m.firstContactS, final: m.final, redSeconds: Math.round(m.redS), boosted: m.boosted, repaid: m.repaid, cashTried: m.cashTried,
    agents: { clumpShare: avg(m.clump), reversalsPerAgentPer100ms: avg(m.jitter), bigAgentsNearMeFirst20s: m.earlyHunters },
    console: consoleLog.slice(0, 30), serverErrors: env.serverLog.join("").split("\n").filter((l) => /error|Error/.test(l)).slice(0, 20),
  };
}

/** n independent food (or other strategy) matches, each on its own fresh server, `par` at a time. */
async function runs(n: number, strategy: string, par: number) {
  const all: Array<Awaited<ReturnType<typeof play>>> = [];
  for (let i = 0; i < n; i += par) {
    const wave = Array.from({ length: Math.min(par, n - i) }, (_, k) => play(strategy, { w: 1280, h: 800 }, join(OUT, `run-${i + k}`), false));
    all.push(...(await Promise.all(wave)));
  }
  const died = all.filter((r) => r.death);
  Object.assign(report, {
    strategy, runs: n,
    survivedToBell: all.filter((r) => !r.death).length,
    deaths: died.map((r) => `${r.death!.type} by ${r.death!.by} at ${r.death!.atS}s`),
    spikeHitsPerMatch: all.map((r) => r.spikeHits),
    firstContactS: all.map((r) => r.firstContactS),
    fps: all.map((r) => r.frames.fps),
    console: [...new Set(all.flatMap((r) => r.console))].slice(0, 10),
    serverErrors: [...new Set(all.flatMap((r) => r.serverErrors))].slice(0, 10),
  });
}

/** n staggered public matches (30 s apart so each gets its own room), a food-chasing non-booster each. */
async function survival(n: number) {
  const env = await boot();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const runs = Array.from({ length: n }, async (_, i) => {
    await sleep(i * 30_000);
    const guest = `qa-surv-${i}-${Date.now()}`;
    const { page, ctx } = await newPage(browser, { w: 1280, h: 800, guest });
    await page.goto(`${env.web}/#/play`);
    // No spectator here (rooms run in parallel): steer with the canvas centre toward a slowly turning heading.
    let a = Math.random() * 6.28;
    for (let k = 0; k < 1150; k++) {
      if (k % 15 === 0) a += (Math.random() - 0.5) * 1.5;
      await steer(page, 1280, 800, Math.cos(a), Math.sin(a));
      await sleep(100);
    }
    await ctx.close();
    return guest;
  });
  const guests = await Promise.all(runs);
  await browser.close();
  await sleep(3000);
  const db = new DatabaseSync(env.db, { readOnly: true });
  const rows = guests.map((g) => {
    const seat = db.prepare("SELECT p.match_id AS m, p.blob_id AS b, p.payout FROM match_players p JOIN users u ON u.id = p.user_id WHERE u.guest_key = ?").get(g) as { m: string; b: string; payout: number | null } | undefined;
    if (!seat) return { guest: g, outcome: "no seat" };
    const death = db.prepare("SELECT json_extract(json,'$.type') AS t, json_extract(json,'$.tick') AS tick FROM events WHERE match_id = ? AND json_extract(json,'$.data.victim') = ?").get(seat.m, seat.b) as { t: string; tick: number } | undefined;
    return { match: seat.m, outcome: death ? `${death.t} at tick ${death.tick}` : "survived", payout: (seat.payout ?? 0) / 1e6 };
  });
  Object.assign(report, { matches: rows, survived: rows.filter((r) => r.outcome === "survived").length, of: n });
}

/** Edge cases on one server: 2 tabs same guest, late join, reload mid match, frozen tab mid BOOST, phone viewport, no credits. */
async function edges() {
  const env = await boot();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const out: Record<string, unknown> = {};
  const text = async (p: Page) => String(await p.evaluate("document.body.innerText")).replace(/\s+/g, " ").slice(0, 160);

  // Two tabs, same guest: the second must be refused with a clear message, the first plays on.
  const g = `qa-twotab-${Date.now()}`;
  const t1 = await newPage(browser, { w: 1280, h: 800, guest: g });
  await t1.page.goto(`${env.web}/#/play`);
  await sleep(1500);
  const t2 = await t1.ctx.newPage();
  const t2log: string[] = [];
  t2.on("console", (m) => t2log.push(m.text().slice(0, 160)));
  await t2.goto(`${env.web}/#/play`);
  await sleep(3000);
  await t2.screenshot({ path: join(OUT, "edge-two-tabs-second.png") });
  out.twoTabs = { secondTabText: await text(t2), secondTabConsole: t2log.filter((l) => /already|offline|unreach/i.test(l)).slice(0, 3) };

  // Late join: a second guest 5 s after GO lands in the same LIVE room.
  await sleep(14_000);
  const late = await newPage(browser, { w: 1280, h: 800, guest: `qa-late-${Date.now()}` });
  await late.page.goto(`${env.web}/#/play`);
  await sleep(4000);
  const rooms = (await (await fetch(`${env.api}/health`)).json()) as { rooms: number };
  await late.page.screenshot({ path: join(OUT, "edge-late-join.png") });
  out.lateJoin = { roomsLive: rooms.rooms, text: await text(late.page) };

  // Freeze tab 1 mid BOOST (worst case of a background tab): BOOST must stop server side within ~250 ms.
  await t1.page.keyboard.down("Space");
  await sleep(1500);
  const cdp = await t1.ctx.newCDPSession(t1.page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  const db = new DatabaseSync(env.db, { readOnly: true });
  const boostsAt = () => (db.prepare("SELECT COUNT(*) AS n FROM events WHERE json_extract(json,'$.type') = 'BOOST'").get() as { n: number }).n;
  await sleep(6000); // a flush (5 s) lands the frozen window's events
  const a = boostsAt();
  await sleep(6000);
  const b = boostsAt();
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await t1.page.keyboard.up("Space");
  out.frozenTabBoost = { boostEventsInWindow: b - a, note: "BOOST events are per tick while boosting; 0 here means the held boost expired when the tab froze" };

  // Reload mid match: what does the player get back?
  await t1.page.reload();
  await sleep(4000);
  await t1.page.screenshot({ path: join(OUT, "edge-reload.png") });
  out.reload = { text: await text(t1.page), console: t1.consoleLog.filter((l) => /already|offline|unreach|error/i.test(l)).slice(-3) };

  // Phone viewport 390 x 844: HUD present, no horizontal scroll.
  const ph = await newPage(browser, { w: 390, h: 844, mobile: true, guest: `qa-phone-${Date.now()}` });
  await ph.page.goto(`${env.web}/#/`);
  await sleep(1500);
  await ph.page.screenshot({ path: join(OUT, "edge-phone-landing.png") });
  const landingScroll = await ph.page.evaluate("document.documentElement.scrollWidth");
  await ph.page.goto(`${env.web}/#/play`);
  await sleep(12_000);
  await ph.page.screenshot({ path: join(OUT, "edge-phone-play.png") });
  out.phone = { landingScrollWidth: landingScroll, playScrollWidth: await ph.page.evaluate("document.documentElement.scrollWidth"), console: ph.consoleLog.slice(0, 5) };

  // Out of credits: a guest whose balance is below the entry.
  const poor = `qa-poor-${Date.now()}`;
  await fetch(`${env.api}/api/credits?guestKey=${poor}`); // creates the user with the daily 1,000
  const w = new DatabaseSync(env.db);
  const { id } = w.prepare("SELECT id FROM users WHERE guest_key = ?").get(poor) as { id: string };
  w.prepare("INSERT INTO credits_ledger (user_id, delta, reason, match_id, at) VALUES (?, ?, 'qa drain', NULL, ?)").run(id, -950_000_000, Date.now());
  const pp = await newPage(browser, { w: 1280, h: 800, guest: poor });
  await pp.page.goto(`${env.web}/#/play`);
  await sleep(4000);
  await pp.page.screenshot({ path: join(OUT, "edge-no-credits.png") });
  out.noCredits = { text: await text(pp.page), console: pp.consoleLog.filter((l) => /credit|offline|unreach/i.test(l)).slice(0, 3) };

  out.serverErrors = env.serverLog.join("").split("\n").filter((l) => /error|Error/.test(l)).slice(0, 20);
  await browser.close();
  Object.assign(report, out);
}

/**
 * Walls: one room, 7 browser players. Four push into a wall, one into the nearest corner, two push
 * into each other; each holds 2 s and screenshots. A spectator checks every synced blob, every
 * patch, against the edge clamp: centre at least r/2 inside each wall.
 */
async function walls(o: { w: number; h: number }) {
  const env = await boot();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--enable-gpu"] });
  const roles = ["left", "right", "top", "bottom", "corner", "pushA", "pushB"] as const;
  const pages: Array<Awaited<ReturnType<typeof newPage>> & { role: (typeof roles)[number]; label: string }> = [];
  const sdk = new Client(env.api.replace("http", "ws"));
  let spec: Room | null = null;
  // Join one at a time: the server labels humans "Player N" in join order, so N maps to a page.
  for (const role of roles) {
    const pg = await newPage(browser, { ...o, guest: `qa-wall-${role}-${Date.now()}` });
    await pg.page.goto(`${env.web}/#/play`);
    pages.push({ ...pg, role, label: `Player ${pages.length + 1}` });
    for (let i = 0; i < 20; i++) {
      if (!spec && ((await (await fetch(`${env.api}/health`)).json()) as { rooms: number }).rooms >= 1) spec = await sdk.consumeSeatReservation(await (await fetch(`${env.api}/api/watch`)).json());
      if (spec && (spec.state as unknown as St).blobs && [...(spec.state as unknown as St).blobs.values()].filter((b) => b.kind === "human").length >= pages.length) break;
      await sleep(300);
    }
  }
  if (!spec) throw new Error("could not spectate the room");
  spec.onMessage("ev", () => {});
  spec.onMessage("commander", () => {});
  const st = () => spec!.state as unknown as St;
  // The clamp, checked on every patch for every blob of every kind.
  const breaches: string[] = [];
  let checked = 0;
  spec.onStateChange(() => {
    const s = st();
    if (s.phase !== "LIVE") return;
    for (const b of s.blobs.values()) {
      if (b.state !== "alive") continue;
      checked++;
      const gap = Math.min(b.x, s.arenaW - b.x, b.y, s.arenaH - b.y) - b.radius / 2;
      if (gap < -1 && breaches.length < 20) breaches.push(`${b.label} r=${Math.round(b.radius)} at (${Math.round(b.x)},${Math.round(b.y)}) is ${Math.round(-gap)} px past r/2`);
    }
  });
  const mine = (label: string) => [...st().blobs.values()].find((b) => b.label === label);
  const results: Record<string, unknown> = {};
  const done = new Set<string>();
  const holdStart = new Map<string, number>();
  const pressed = new Map<string, { gap: number[]; dist: number[] }>();
  while (st().phase !== "LIVE" || !st().blobs) await sleep(200);
  const t0 = Date.now();
  while (done.size < pages.length && Date.now() - t0 < 50_000) {
    await sleep(100);
    const s = st();
    for (const pg of pages) {
      if (done.has(pg.role)) continue;
      const me = mine(pg.label);
      if (!me || me.state !== "alive") {
        results[pg.role] = { verdict: "DIED before the check", at: me ? `(${Math.round(me.x)},${Math.round(me.y)})` : "gone" };
        done.add(pg.role);
        continue;
      }
      // Direction to push, and how far the blob still is from touching what it pushes against.
      let dx = 0, dy = 0, away = Infinity;
      if (pg.role === "left") (dx = -1), (away = me.x - me.radius);
      if (pg.role === "right") (dx = 1), (away = s.arenaW - me.x - me.radius);
      if (pg.role === "top") (dy = -1), (away = me.y - me.radius);
      if (pg.role === "bottom") (dy = 1), (away = s.arenaH - me.y - me.radius);
      if (pg.role === "corner") {
        dx = me.x < s.arenaW / 2 ? -1 : 1;
        dy = me.y < s.arenaH / 2 ? -1 : 1;
        away = Math.max(Math.min(me.x, s.arenaW - me.x), Math.min(me.y, s.arenaH - me.y)) - me.radius;
      }
      let other: Blob | undefined;
      if (pg.role === "pushA" || pg.role === "pushB") {
        other = mine(pg.role === "pushA" ? pages[6]!.label : pages[5]!.label);
        if (!other || other.state !== "alive") {
          results[pg.role] = { verdict: "partner DIED before the check" };
          done.add(pg.role);
          continue;
        }
        (dx = other.x - me.x), (dy = other.y - me.y);
        away = Math.hypot(dx, dy) - me.radius - other.radius;
      }
      await steer(pg.page, o.w, o.h, dx, dy);
      if (away > 4 && !holdStart.has(pg.role)) continue;
      if (!holdStart.has(pg.role)) holdStart.set(pg.role, Date.now());
      const rec = pressed.get(pg.role) ?? { gap: [], dist: [] };
      pressed.set(pg.role, rec);
      if (other) rec.dist.push(Math.round((Math.hypot(other.x - me.x, other.y - me.y) / (me.radius + other.radius)) * 100) / 100);
      else rec.gap.push(Math.round(Math.min(me.x, s.arenaW - me.x, me.y, s.arenaH - me.y) - me.radius / 2));
      if (Date.now() - holdStart.get(pg.role)! < 2000) continue;
      await pg.page.screenshot({ path: join(OUT, `wall-${pg.role}.png`) });
      results[pg.role] = other
        ? { reachedS: Math.round((holdStart.get(pg.role)! - t0) / 100) / 10, centreDistOverRadiiSum: { min: Math.min(...rec.dist), max: Math.max(...rec.dist) }, bothAlive: other.state === "alive" }
        : { reachedS: Math.round((holdStart.get(pg.role)! - t0) / 100) / 10, radius: Math.round(me.radius), minGapPastHalfR: Math.min(...rec.gap), at: `(${Math.round(me.x)},${Math.round(me.y)})` };
      done.add(pg.role);
    }
  }
  for (const pg of pages) if (!done.has(pg.role)) results[pg.role] = { verdict: "never reached the target in 50 s" };
  const fps = await Promise.all(pages.map(async (pg) => ({ role: pg.role, ...(await frameStats(pg.page)), console: pg.consoleLog.slice(0, 5) })));
  await spec.leave();
  await browser.close();
  Object.assign(report, {
    arena: `${st().arenaW}x${st().arenaH}`,
    clamp: { blobPatchesChecked: checked, breaches: breaches.length, firstBreaches: breaches.slice(0, 8) },
    results,
    fps: fps.map((f) => ({ role: f.role, fps: f.fps, p95ms: f.p95ms, over33ms: f.over33ms, console: f.console })),
    serverErrors: env.serverLog.join("").split("\n").filter((l) => /error|Error/.test(l)).slice(0, 20),
  });
}

const w = Number(flag("w", "1280"));
const h = Number(flag("h", "800"));
if (mode === "play") Object.assign(report, await play(argv[1] && !argv[1].startsWith("--") ? argv[1] : "food", { w, h, cpu: flag("cpu") ? Number(flag("cpu")) : undefined, mobile: !!flag("mobile") }));
else if (mode === "runs") await runs(Number(argv[1] ?? 10), argv[2] ?? "food", Number(flag("par", "5")));
else if (mode === "survival") await survival(Number(argv[1] ?? 10));
else if (mode === "edges") await edges();
else if (mode === "walls") await walls({ w, h });
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
console.log(`artifacts: ${OUT}`);
process.exit(0);
