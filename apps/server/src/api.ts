// Public read API: match logs and proofs for the Verify page, the verified leaderboard, and the
// traction numbers the README quotes. Read only, CORS open; money leaves as display units.
import type { Application } from "express";
import { matchMaker } from "colyseus";
import { JUDGE_SEED, toUnits } from "@margin/core";
import { creditsRepo, isGuestKey, topUpDaily } from "./credits";
import { userForGuestKey, type Db } from "./db";
import { loadLog } from "./matches";
import { requestIp } from "./matchmakeGuard";
import { RateLimiter, rooms } from "./rooms/guard";
import { drain } from "./rooms/MatchRoom";
import { diskFree, settler, ticks } from "./obs";
import { sharedChain } from "./settlement";

const DAY_MS = 86_400_000;
/** Each new guestKey makes a user row, so cap credit lookups per IP. */
const creditsLimit = new RateLimiter(30, 60_000);
/** Each watch reserves a seat and may create a room, so cap it per IP too. */
const watchLimit = new RateLimiter(12, 60_000);
/** L2-04: /api/stats and /api/facts scan whole tables on the game thread, so cap them per IP too. */
const readLimit = new RateLimiter(30, 60_000);
const READ_CACHE_MS = 30_000;

/** f() at most once per READ_CACHE_MS: a loop of GET /api/facts froze every live arena for seconds (L2-04). */
function cached<T>(f: () => T): () => T {
  let at = -Infinity;
  let v = undefined as T;
  return () => {
    if (Date.now() - at >= READ_CACHE_MS) {
      v = f();
      at = Date.now();
    }
    return v;
  };
}
const PHASE_RANK: Record<string, number> = { LIVE: 3, COUNTDOWN: 2, WARMUP: 1 };

interface Listing {
  roomId: string;
  clients: number;
  maxClients: number;
  metadata?: { mode?: string; public?: boolean; phase?: string; humans?: number };
}

/** The public free room worth watching: LIVE first, then the most humans. Null if none has a free slot. */
export function pickWatchRoom<T extends Listing>(rooms: T[]): T | null {
  const ok = rooms.filter((r) => r.metadata?.mode === "free" && r.metadata.public && PHASE_RANK[r.metadata.phase ?? ""] && r.clients < r.maxClients);
  ok.sort((a, b) => PHASE_RANK[b.metadata!.phase!]! - PHASE_RANK[a.metadata!.phase!]! || (b.metadata!.humans ?? 0) - (a.metadata!.humans ?? 0));
  return ok[0] ?? null;
}

interface MatchRow {
  id: string;
  mode: string;
  status: string;
  head: string | null;
  tx_hash: string | null;
  anchor_hour: number | null;
  proof: string | null;
}

/**
 * The Verify page's input: the full hash-chained log, the head NEAR vouches for (null until the
 * settle tx or the hourly anchor lands) and that tx. Null if the match is unknown.
 */
export function matchLog(db: Db, id: string, network = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet") {
  const p = matchProof(db, id);
  if (!p) return null;
  const tx = p.mode === "paid" ? p.settleTx : (p.anchor?.tx ?? null);
  return { log: loadLog(db, id), anchorHead: tx ? p.head : null, tx, network, status: p.status };
}

/** How to prove this match: paid = its settle tx, free = Merkle proof to the hourly anchor tx. */
export function matchProof(db: Db, id: string) {
  const m = db.prepare("SELECT id, mode, status, head, tx_hash, anchor_hour, proof FROM matches WHERE id = ?").get(id) as
    | MatchRow
    | undefined;
  if (!m) return null;
  if (m.mode === "paid") return { id, mode: m.mode, status: m.status, head: m.head, settleTx: m.tx_hash };
  const a = m.anchor_hour === null ? undefined : (db.prepare("SELECT root, tx_hash FROM anchors WHERE hour = ?").get(m.anchor_hour) as
    | { root: string; tx_hash: string | null }
    | undefined);
  return {
    id,
    mode: m.mode,
    status: m.status,
    head: m.head,
    // null until the hour is over and anchored
    anchor: a ? { hour: m.anchor_hour, room: "free", root: a.root, tx: a.tx_hash, proof: JSON.parse(m.proof ?? "[]") as unknown } : null,
  };
}

/** Top NEAR-linked accounts by net result over the last 24 h (guests never rank). */
export function leaderboard(db: Db, nowMs = Date.now(), limit = 20) {
  const rows = db
    .prepare(
      `SELECT u.account_id AS account, SUM(COALESCE(p.payout, 0) - p.entry) AS net, COUNT(*) AS matches
       FROM match_players p JOIN users u ON u.id = p.user_id JOIN matches m ON m.id = p.match_id
       WHERE u.account_id IS NOT NULL AND m.status = 'settled' AND m.ended >= ?
       GROUP BY u.account_id ORDER BY net DESC, account LIMIT ?`,
    )
    .all(nowMs - DAY_MS, limit) as Array<{ account: string; net: number; matches: number }>;
  return rows.map((r) => ({ account: r.account, net: toUnits(r.net), matches: r.matches }));
}

/**
 * Who counts as a real user: a NEAR account, or a guest key from the real client (a random UUID).
 * Every test script and harness uses an "ed25519:" or "qa-" guest key, so local test traffic never
 * reaches the public numbers. Judge Runs (published JUDGE_SEED) are a scenario, not traction.
 * Team and QA users and wallets (table `team`, marked via POST /api/team) are kept but never counted.
 */
export const REAL_USER = `((u.account_id IS NOT NULL OR (u.guest_key NOT LIKE 'ed25519:%' AND u.guest_key NOT LIKE 'qa-%'))
  AND u.id NOT IN (SELECT id FROM team WHERE kind = 'user')
  AND (u.account_id IS NULL OR u.account_id NOT IN (SELECT id FROM team WHERE kind = 'account')))`;
export const REAL_SEATS = `SELECT p.match_id, p.user_id FROM match_players p JOIN users u ON u.id = p.user_id
  JOIN matches m ON m.id = p.match_id WHERE ${REAL_USER} AND m.seed != ${JUDGE_SEED}`;

/** Traction numbers for the README and landing: real users only, straight from the tables, nothing estimated. */
export function stats(db: Db) {
  const one = <T>(sql: string): T => db.prepare(sql).get() as T;
  const { users } = one<{ users: number }>(`SELECT COUNT(*) AS users FROM users u WHERE ${REAL_USER}`);
  const { players } = one<{ players: number }>(`SELECT COUNT(DISTINCT user_id) AS players FROM (${REAL_SEATS})`);
  // Only matches a real human played: agents-only /watch rooms, test runs and Judge Runs are not traction.
  const { matches } = one<{ matches: number }>(
    `SELECT COUNT(*) AS matches FROM matches m WHERE m.status = 'settled' AND m.id IN (SELECT match_id FROM (${REAL_SEATS}))`,
  );
  const { multi } = one<{ multi: number }>(
    `SELECT COUNT(*) AS multi FROM (SELECT r.match_id FROM (${REAL_SEATS}) r JOIN matches m ON m.id = r.match_id
     WHERE m.status = 'settled' GROUP BY r.match_id HAVING COUNT(*) >= 2)`,
  );
  const { agentPops } = one<{ agentPops: number }>(
    `SELECT COUNT(*) AS agentPops FROM events WHERE json_extract(json, '$.type') = 'POP'
     AND events.match_id IN (SELECT match_id FROM (${REAL_SEATS}))
     AND (json_extract(json, '$.data.by') LIKE 'agent-%' OR json_extract(json, '$.data.by') LIKE 'drone-%')`,
  );
  return { users, players, matches, multiHumanPct: matches ? Math.round((100 * multi) / matches) : 0, agentPops };
}

/**
 * Raw material for `npm run facts`: counts from the tables (real users only, as stats()) plus the
 * POINTERS the script checks on NEAR itself (paid match ids + heads, anchor txs). Nothing here is
 * trusted as an on-chain fact: the script counts only what the chain confirms. All of it is already
 * public (the Verify page, the leaderboard, the chain).
 */
export function facts(db: Db, network = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet", contract: string | null = null) {
  const one = <T>(sql: string): T => db.prepare(sql).get() as T;
  const byMode = (mode: string) =>
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM matches m WHERE m.status = 'settled' AND m.mode = '${mode}' AND m.id IN (SELECT match_id FROM (${REAL_SEATS}))`).n;
  const seated = (cond: string) => one<{ n: number }>(`SELECT COUNT(DISTINCT r.user_id) AS n FROM (${REAL_SEATS}) r JOIN users u ON u.id = r.user_id WHERE ${cond}`).n;
  const paidSettled = db
    .prepare("SELECT id, head, tx_hash AS tx FROM matches WHERE mode = 'paid' AND status = 'settled' AND tx_hash IS NOT NULL ORDER BY ended DESC LIMIT 1000")
    .all() as Array<{ id: string; head: string; tx: string }>;
  const anchors = db.prepare("SELECT hour, tx_hash AS tx FROM anchors WHERE length(tx_hash) > 20 ORDER BY hour DESC LIMIT 2000").all() as Array<{ hour: number; tx: string }>;
  const wallets = (db.prepare(`SELECT DISTINCT u.account_id AS a FROM (${REAL_SEATS}) r JOIN users u ON u.id = r.user_id WHERE u.account_id IS NOT NULL`).all() as Array<{ a: string }>).map((r) => r.a);
  return {
    generatedAt: new Date().toISOString(),
    network,
    contract,
    matches: { free: byMode("free"), paid: byMode("paid") },
    players: { freeGuests: seated("u.account_id IS NULL"), wallets: seated("u.account_id IS NOT NULL") },
    agentPops: stats(db).agentPops,
    paidSettled,
    anchors,
    wallets,
  };
}

/** Mount every /api route. */
export function mountApi(app: Application, db: () => Db): void {
  app.use("/api", (_req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    next();
  });
  // Balance for the home screen; first visit of the UTC day also applies the daily top-up.
  app.get("/api/credits", (req, res) => {
    if (!creditsLimit.allow(req.get("x-real-ip") ?? req.socket.remoteAddress ?? "unknown")) return void res.status(429).json({ error: "slow down" });
    const key = req.query.guestKey;
    if (!isGuestKey(key)) return void res.status(400).json({ error: "bad guestKey" });
    const userId = userForGuestKey(db(), key);
    const toppedUp = topUpDaily(db(), userId);
    res.json({ balance: toUnits(creditsRepo(db()).balance(userId)), toppedUp: toUnits(toppedUp) });
  });
  app.get("/api/matches/:id/log", (req, res) => {
    const r = matchLog(db(), req.params.id);
    return r ? void res.json(r) : void res.status(404).json({ error: "unknown match" });
  });
  app.get("/api/matches/:id/proof", (req, res) => {
    const r = matchProof(db(), req.params.id);
    return r ? void res.json(r) : void res.status(404).json({ error: "unknown match" });
  });
  // Spectate (/watch): a seat reservation in the busiest public free room, even one that is LIVE and
  // locked; with none, a fresh agents-only room. Client: sdk.consumeSeatReservation(reservation).
  app.get("/api/watch", async (req, res) => {
    if (!watchLimit.allow(req.get("x-real-ip") ?? req.socket.remoteAddress ?? "unknown")) return void res.status(429).json({ error: "slow down" });
    try {
      const room = pickWatchRoom((await matchMaker.query({ name: "match" })) as unknown as Listing[]) ?? (await matchMaker.createRoom("match", { mode: "free" }));
      res.json(await matchMaker.reserveSeatFor(room as Parameters<typeof matchMaker.reserveSeatFor>[0], { spectate: true }));
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : "no room to watch" });
    }
  });
  app.get("/api/leaderboard", (_req, res) => void res.json(leaderboard(db())));
  // Liveness for deploy.sh and uptime checks: 503 while draining so nothing new is routed here.
  app.get("/health", (_req, res) => {
    const c = sharedChain()?.cfg;
    res.status(drain.on ? 503 : 200).json({
      ok: !drain.on, draining: drain.on, network: c?.network ?? "off", contract: c?.contractId ?? null,
      settler: c ? { near: settler.near, low: settler.low } : null,
      disk: diskFree(),
      rooms: rooms.live, uptimeS: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 2 ** 20), ticks: ticks.summary(),
    });
  });
  const statsNow = cached(() => stats(db()));
  const factsNow = cached(() => facts(db(), undefined, sharedChain()?.cfg.contractId ?? null));
  app.get("/api/stats", (req, res) => (readLimit.allow(requestIp(req)) ? void res.json(statsNow()) : void res.status(429).json({ error: "slow down" })));
  app.get("/api/facts", (req, res) => (readLimit.allow(requestIp(req)) ? void res.json(factsNow()) : void res.status(429).json({ error: "slow down" })));
  // Last: any other /api path or method answers JSON like every route above, never Express's HTML page.
  app.use("/api", (_req, res) => void res.status(404).json({ error: "not found" }));
}
