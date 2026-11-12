// Settlement adapter for free rooms: payouts are credit ledger rows, no chain tx. Entries were
// already debited at GO by the room, so open() has nothing to lock. Idempotent by matchId.
import type { MatchOpen, SettleResult, Settlement, TxRef } from "@margin/core";
import { creditsRepo } from "../credits";
import { withTx, type Db } from "../db";

export class CreditsSettlement implements Settlement {
  /** users: blob id to credits user id (agents are absent and never paid). */
  constructor(
    private readonly db: Db,
    private readonly users: ReadonlyMap<string, string>,
  ) {}

  async open(_match: MatchOpen): Promise<void> {}

  async settle(result: SettleResult, _head: string): Promise<TxRef | null> {
    const paid = this.db
      .prepare("SELECT 1 FROM credits_ledger WHERE match_id = ? AND reason = 'payout' LIMIT 1")
      .get(result.matchId);
    if (paid) return null;
    const repo = creditsRepo(this.db);
    // All payouts or none: a write that fails halfway (disk full) must not leave some players paid,
    // because the check above would then skip the rest on the retry.
    withTx(this.db, () => {
      for (const p of result.payouts) {
        const userId = this.users.get(p.id);
        if (userId && p.amount > 0) repo.append({ userId, delta: p.amount, reason: "payout", matchId: result.matchId });
      }
    });
    return null;
  }
}
