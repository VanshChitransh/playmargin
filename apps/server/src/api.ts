// Public read API: match logs and proofs for the Verify page, the verified leaderboard, and the
// traction numbers the README quotes. Read only, CORS open; money leaves as display units.
import type { Application } from "express";
import { toUnits } from "@margin/core";
import { creditsRepo, isGuestKey, topUpDaily } from "./credits";
import { userForGuestKey, type Db } from "./db";
import { loadLog } from "./matches";

const DAY_MS = 86_400_000;

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
  const { matches } = one<{ matches: number }>("SELECT COUNT(*) AS matches FROM matches WHERE status = 'settled'");
  const { multi } = one<{ multi: number }>(
    `SELECT COUNT(*) AS multi FROM (SELECT p.match_id FROM match_players p JOIN matches m ON m.id = p.match_id
     WHERE m.status = 'settled' GROUP BY p.match_id HAVING COUNT(*) >= 2)`,
  );
  const { agentPops } = one<{ agentPops: number }>(
    `SELECT COUNT(*) AS agentPops FROM events WHERE json_extract(json, '$.type') = 'POP'
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
  app.get("/api/leaderboard", (_req, res) => void res.json(leaderboard(db())));
  app.get("/api/stats", (_req, res) => void res.json(stats(db())));
}
