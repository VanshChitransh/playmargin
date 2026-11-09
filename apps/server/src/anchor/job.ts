// Hourly anchor of free matches: one Merkle root per finished UTC hour goes on chain as
// anchor("free", hour, root), so a free match is provable with its head, proof and that tx.
// seq = hour index, which only grows, so hours are anchored oldest first. Without a settler key
// roots and proofs are still stored and the tx waits for a box that has one.
import type { Db } from "../db";
import type { Chain } from "../settlement/chain";
import { merkle } from "@margin/core";

export const HOUR_MS = 3_600_000;
export const ANCHOR_ROOM = "free";

/** Build roots for finished hours, then send any unsent anchor txs. Returns hours anchored on chain. */
export async function anchorPending(db: Db, chain: Chain | null, nowMs = Date.now()): Promise<number> {
  const thisHour = Math.floor(nowMs / HOUR_MS);
  const rows = db
    .prepare(
      `SELECT id, head, ended FROM matches
       WHERE mode = 'free' AND status = 'settled' AND anchor_hour IS NULL AND head IS NOT NULL AND ended < ?`,
    )
    .all(thisHour * HOUR_MS) as Array<{ id: string; head: string; ended: number }>;
  const byHour = new Map<number, Array<{ id: string; head: string }>>();
  for (const r of rows) {
    const h = Math.floor(r.ended / HOUR_MS);
    byHour.set(h, [...(byHour.get(h) ?? []), r]);
  }
  for (const [hour, ms] of [...byHour].sort(([a], [b]) => a - b)) {
    if (db.prepare("SELECT 1 FROM anchors WHERE hour = ?").get(hour)) continue; // root already fixed
    const { root, proofs } = await merkle(ms.map((m) => m.head));
    const setProof = db.prepare("UPDATE matches SET anchor_hour = ?, proof = ? WHERE id = ?");
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO anchors (hour, root, created) VALUES (?, ?, ?)").run(hour, root, nowMs);
      for (const m of ms) setProof.run(hour, JSON.stringify(proofs.get(m.head)), m.id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  if (!chain) return 0;
  let sent = 0;
  const unsent = db.prepare("SELECT hour, root FROM anchors WHERE tx_hash IS NULL ORDER BY hour").all() as Array<{ hour: number; root: string }>;
  for (const a of unsent) {
    const onchain = await chain.view<{ seq: number; head: string }>("anchor_of", { room_id: ANCHOR_ROOM });
    if (onchain && onchain.seq >= a.hour) {
      // Already on chain (a lost reply) or overtaken by a later hour: record and move on.
      db.prepare("UPDATE anchors SET tx_hash = ? WHERE hour = ?").run(onchain.seq === a.hour ? "onchain" : "skipped", a.hour);
      continue;
    }
    const hash = await chain.call("anchor", { room_id: ANCHOR_ROOM, seq: a.hour, head: a.root });
    db.prepare("UPDATE anchors SET tx_hash = ? WHERE hour = ?").run(hash, a.hour);
    sent++;
  }
  return sent;
}
