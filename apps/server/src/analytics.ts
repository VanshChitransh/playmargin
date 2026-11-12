// Anonymous funnel analytics: the client posts small batches of event names keyed by a random id
// that lives only in the player's browser (not the guestKey, so it never links to credits). We keep
// daily counters and which hashed ids were seen on which day. No names, IPs or wallets are stored.
// GET /api/insights is private: it answers only with the STATS_KEY, otherwise it looks like a 404.
import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Application } from "express";
import type { Db } from "./db";
import { REAL_SEATS, stats } from "./api";
import { requestIp } from "./matchmakeGuard";
import { RateLimiter } from "./rooms/guard";

/** The only event names accepted. Anything else in a batch is dropped. */
export const EVENTS = [
  "home_view", "how_view", "judges_view", "verify_view", "laptop_card_shown",
  "practice_click", "warmup_done", "match_finished", "play_again", "challenge_link_created", "friend_joined",
] as const;
export type EventName = (typeof EVENTS)[number];
const ALLOWED = new Set<string>(EVENTS);
const MAX_BATCH = 50;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** One batch per few seconds per visitor is normal; this only stops floods. */
const eventsLimit = new RateLimiter(60, 60_000);

/** Idempotent, so it is safe on a fresh DB and on every boot (no shared migration list touched). */
export function ensureTables(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_counts (day TEXT NOT NULL, event TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, event));
    CREATE TABLE IF NOT EXISTS analytics_seen (day TEXT NOT NULL, event TEXT NOT NULL, guest TEXT NOT NULL, PRIMARY KEY (day, event, guest));`);
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const hashId = (id: string): string => createHash("sha256").update(`margin-analytics:${id}`).digest("hex").slice(0, 32);

/** Validate and store one batch. Returns how many events were kept (0 for a bad body). */
export function recordEvents(db: Db, body: unknown, nowMs = Date.now()): number {
  const b = (typeof body === "object" && body !== null ? body : {}) as { id?: unknown; events?: unknown };
  if (typeof b.id !== "string" || !ID_RE.test(b.id) || !Array.isArray(b.events)) return 0;
  const names = b.events.slice(0, MAX_BATCH).filter((e): e is string => typeof e === "string" && ALLOWED.has(e));
  if (!names.length) return 0;
  const day = dayOf(nowMs); // the server's UTC day: a client clock is never trusted
  const guest = hashId(b.id);
  const count = db.prepare("INSERT INTO analytics_counts (day, event, n) VALUES (?, ?, 1) ON CONFLICT (day, event) DO UPDATE SET n = n + 1");
  const seen = db.prepare("INSERT OR IGNORE INTO analytics_seen (day, event, guest) VALUES (?, ?, ?)");
  for (const e of names) {
    count.run(day, e);
    seen.run(day, e, guest);
  }
  return names.length;
}

/** Everything the private /stats page draws, for the last `days` UTC days. */
export function insights(db: Db, nowMs = Date.now(), days = 30) {
  const from = dayOf(nowMs - (days - 1) * 86_400_000);
  const funnel = db
    .prepare(`SELECT c.day, c.event, c.n, (SELECT COUNT(*) FROM analytics_seen s WHERE s.day = c.day AND s.event = c.event) AS guests
      FROM analytics_counts c WHERE c.day >= ? ORDER BY c.day`)
    .all(from) as Array<{ day: string; event: string; n: number; guests: number }>;
  const totals = db
    .prepare("SELECT event, COUNT(DISTINCT guest) AS guests, COUNT(*) AS guestDays FROM analytics_seen WHERE day >= ? GROUP BY event")
    .all(from) as Array<{ event: string; guests: number; guestDays: number }>;
  const visitors = db.prepare("SELECT day, COUNT(DISTINCT guest) AS n FROM analytics_seen WHERE day >= ? GROUP BY day ORDER BY day").all(from) as Array<{ day: string; n: number }>;
  // Real players come from the game tables, with the same filter as /api/stats (no test keys, no Judge Runs).
  const seats = `SELECT r.user_id, r.match_id, date(m.ended / 1000, 'unixepoch') AS day, m.mode FROM (${REAL_SEATS}) r JOIN matches m ON m.id = r.match_id
    WHERE m.status = 'settled' AND m.ended IS NOT NULL`;
  const players = db.prepare(`SELECT day, COUNT(DISTINCT user_id) AS n FROM (${seats}) WHERE day >= ? GROUP BY day ORDER BY day`).all(from) as Array<{ day: string; n: number }>;
  const multi = db
    .prepare(`SELECT day, COUNT(*) AS n FROM (SELECT day, match_id FROM (${seats}) GROUP BY match_id HAVING COUNT(*) >= 2) WHERE day >= ? GROUP BY day ORDER BY day`)
    .all(from) as Array<{ day: string; n: number }>;
  const paid = db
    .prepare(`SELECT day, COUNT(DISTINCT match_id) AS n FROM (${seats}) WHERE mode = 'paid' AND day >= ? GROUP BY day ORDER BY day`)
    .all(from) as Array<{ day: string; n: number }>;
  // "ret", not "returning": RETURNING is an SQLite keyword.
  const { ret: returning } = db.prepare(`SELECT COUNT(*) AS ret FROM (SELECT user_id FROM (${seats}) GROUP BY user_id HAVING COUNT(DISTINCT day) >= 2)`).get() as {
    ret: number;
  };
  return { from, to: dayOf(nowMs), funnel, totals, visitors, players, multi, paid, returning, stats: stats(db) };
}

/** Constant-time key check; an unset STATS_KEY means the page does not exist. */
export function keyOk(given: unknown, want = process.env.STATS_KEY): boolean {
  if (!want || typeof given !== "string") return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(want));
}

/** Mount BEFORE mountApi: mountApi ends with the /api 404 catch-all. */
export function mountAnalytics(app: Application, db: () => Db): void {
  ensureTables(db());
  // sendBeacon posts text/plain, so read any body as text and parse it ourselves (4 KB cap).
  app.post("/api/events", express.text({ type: "*/*", limit: "4kb" }), (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    // The IP is used only here, in memory, to rate-limit: it is never written to the DB or a log.
    if (!eventsLimit.allow(requestIp(req))) return void res.status(429).end();
    let body: unknown;
    try {
      body = JSON.parse(typeof req.body === "string" ? req.body : "");
    } catch {
      return void res.status(400).end();
    }
    res.status(recordEvents(db(), body) ? 204 : 400).end();
  });
  app.get("/api/insights", (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-store");
    if (!keyOk(req.query.key)) return void res.status(404).json({ error: "not found" });
    res.json(insights(db()));
  });
}
