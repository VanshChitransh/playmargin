// Public read API: match logs and proofs for the Verify page, the verified leaderboard, and the
// traction numbers the README quotes. Read only, CORS open; money leaves as display units.
import type { Application } from "express";
import { matchMaker } from "colyseus";
import { toUnits } from "@margin/core";
import { creditsRepo, isGuestKey, topUpDaily } from "./credits";
import { userForGuestKey, type Db } from "./db";
import { loadLog } from "./matches";
import { RateLimiter, rooms } from "./rooms/guard";
import { drain } from "./rooms/MatchRoom";
import { ticks } from "./obs";
import { sharedChain } from "./settlement";

const DAY_MS = 86_400_000;
/** Each new guestKey makes a user row, so cap credit lookups per IP. */
const creditsLimit = new RateLimiter(30, 60_000);
/** Each watch reserves a seat and may create a room, so cap it per IP too. */
const watchLimit = new RateLimiter(12, 60_000);
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

/** Traction numbers for the README: real counts straight from the tables, nothing estimated. */
export function stats(db: Db) {
  const one = <T>(sql: string): T => db.prepare(sql).get() as T;
  const { users } = one<{ users: number }>("SELECT COUNT(*) AS users FROM users");
  const { players } = one<{ players: number }>("SELECT COUNT(DISTINCT user_id) AS players FROM match_players");
  // Only matches a human played: agents-only rooms made for #/watch are not traction.
  const { matches } = one<{ matches: number }>(
    "SELECT COUNT(*) AS matches FROM matches m WHERE m.status = 'settled' AND EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id)",
  );
  const { multi } = one<{ multi: number }>(
    `SELECT COUNT(*) AS multi FROM (SELECT p.match_id FROM match_players p JOIN matches m ON m.id = p.match_id
     WHERE m.status = 'settled' GROUP BY p.match_id HAVING COUNT(*) >= 2)`,
  );
  const { agentPops } = one<{ agentPops: number }>(
    `SELECT COUNT(*) AS agentPops FROM events WHERE json_extract(json, '$.type') = 'POP'
     AND EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = events.match_id)
     AND (json_extract(json, '$.data.by') LIKE 'agent-%' OR json_extract(json, '$.data.by') LIKE 'drone-%')`,
  );
  return { users, players, matches, multiHumanPct: matches ? Math.round((100 * multi) / matches) : 0, agentPops };
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
  // Spectate (#/watch): a seat reservation in the busiest public free room, even one that is LIVE and
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
      rooms: rooms.live, uptimeS: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 2 ** 20), ticks: ticks.summary(),
    });
  });
  app.get("/api/stats", (_req, res) => void res.json(stats(db())));
}
