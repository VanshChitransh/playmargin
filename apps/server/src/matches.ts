// Match records and their hash-chained logs in SQLite. The events table is the durable copy of
// the log: the read API and the Verify page replay it, and the hourly anchor hashes its heads.
import type { LogEntry, Micro, Mode } from "@margin/core";
import { withTx, type Db } from "./db";

/** retrying: the log is proven but the payment tx has not landed yet (background retries). */
export type MatchStatus = "live" | "settled" | "retrying" | "refused";

/** Row for a match at GO. */
export function createMatch(db: Db, m: { id: string; mode: Mode; seed: number; pot: Micro }): void {
  db.prepare("INSERT INTO matches (id, mode, seed, status, pot, created) VALUES (?, ?, ?, 'live', ?, ?)").run(
    m.id,
    m.mode,
    m.seed,
    m.pot,
    Date.now(),
  );
}

/** A human seat (agents have no user row and stay out of this table). */
export function addMatchPlayer(db: Db, p: { matchId: string; userId: string; blobId: string; entry: Micro }): void {
  db.prepare("INSERT INTO match_players (match_id, user_id, blob_id, entry) VALUES (?, ?, ?, ?)").run(
    p.matchId,
    p.userId,
    p.blobId,
    p.entry,
  );
}

/** Persist log entries; re-saving the same seq is a no-op, so flushes can overlap safely. */
export function saveEvents(db: Db, matchId: string, entries: LogEntry[]): void {
  const ins = db.prepare("INSERT OR IGNORE INTO events (match_id, seq, json, hash) VALUES (?, ?, ?, ?)");
  withTx(db, () => {
    for (const e of entries) ins.run(matchId, e.seq, JSON.stringify(e), e.hash);
  });
}

/** Close a match: settled with its head (and tx for paid), or refused when settle failed. */
export function finishMatch(
  db: Db,
  id: string,
  f: { status: MatchStatus; head: string | null; txHash?: string | null; payouts?: Map<string, Micro> },
): void {
  // One transaction: the status, head and every payout land together or not at all.
  withTx(db, () => {
    db.prepare("UPDATE matches SET status = ?, head = ?, tx_hash = ?, ended = ? WHERE id = ?").run(
      f.status,
      f.head,
      f.txHash ?? null,
      Date.now(),
      id,
    );
    const up = db.prepare("UPDATE match_players SET payout = ? WHERE match_id = ? AND blob_id = ?");
    for (const [blobId, amount] of f.payouts ?? []) up.run(amount, id, blobId);
    // A popped player is not in the payouts: store a real 0, never NULL (QA-D-06), once the books are known.
    if (f.payouts) db.prepare("UPDATE match_players SET payout = 0 WHERE match_id = ? AND payout IS NULL").run(id);
  });
}

/** The stored log in seq order (what the Verify page replays). */
export function loadLog(db: Db, matchId: string): LogEntry[] {
  const rows = db.prepare("SELECT json FROM events WHERE match_id = ? ORDER BY seq").all(matchId) as Array<{ json: string }>;
  return rows.map((r) => JSON.parse(r.json) as LogEntry);
}
