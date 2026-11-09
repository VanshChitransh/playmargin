// Everything durable about one match: the hash-chained log (persisted every 5 s and at the end),
// the match row and seats, and payment through the Settlement port. Hashing is async, so drains
// chain serially. At the bell the log, not the live world, decides payouts: settleVerified replays
// it and any disagreement with the world refuses payment.
import {
  drainLog, entryFor, settleVerified, type LogEntry, type Mode, type SettleResult, type Settlement, type World,
} from "@margin/core";
import type { Db } from "../db";
import { addMatchPlayer, createMatch, finishMatch, saveEvents } from "../matches";

export class MatchRecord {
  readonly entries: LogEntry[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private saved = 0;

  constructor(
    private readonly db: Db,
    private readonly matchId: string,
    private readonly mode: Mode,
    private readonly settlement: Settlement,
  ) {}

  /** Queue the world's pending events onto the chain (call once per tick). */
  drain(w: World): void {
    this.chain = this.chain.then(() => drainLog(w, this.entries));
  }

  /** Write entries not yet on disk, so a crash loses at most one flush interval. */
  flush(): void {
    saveEvents(this.db, this.matchId, this.entries.slice(this.saved));
    this.saved = this.entries.length;
  }

  /** At GO: match row, human seats, and the adapter's open(). */
  open(w: World, seed: number, users: ReadonlyMap<string, string>): void {
    createMatch(this.db, { id: this.matchId, mode: this.mode, seed, pot: w.pot });
    for (const [blobId, userId] of users) this.seat(userId, blobId);
    const players = [...w.blobs.values()]
      .filter((b) => b.kind !== "drone")
      .map((b) => ({ id: b.id, accountId: b.accountId, entry: entryFor(this.mode) }));
    this.settlement
      .open({ matchId: this.matchId, mode: this.mode, pot: w.pot, vaultBudget: w.vault.budget, players })
      .catch((err: unknown) => console.error(`[open] ${this.matchId}:`, err));
  }

  /** A human seat (also used for late joins). */
  seat(userId: string, blobId: string): void {
    addMatchPlayer(this.db, { matchId: this.matchId, userId, blobId, entry: entryFor(this.mode) });
  }

  /** Replay, check against the live world, pay, and close the row. Never throws. */
  async settle(w: World): Promise<SettleResult | null> {
    try {
      this.drain(w);
      await this.chain;
      const result = await settleVerified(this.entries);
      for (const p of result.payouts) {
        const live = w.blobs.get(p.id)?.payout;
        if (live !== p.amount) throw new Error(`settle != live for ${p.id}: ${p.amount} vs ${live}`);
      }
      this.flush();
      const tx = await this.settlement.settle(result, result.head);
      const payouts = new Map(result.payouts.map((p) => [p.id, p.amount]));
      finishMatch(this.db, this.matchId, { status: "settled", head: result.head, txHash: tx?.hash, payouts });
      return result;
    } catch (err) {
      console.error(`[settle] ${this.matchId} refused:`, err);
      this.flush();
      finishMatch(this.db, this.matchId, { status: "refused", head: this.entries.at(-1)?.hash ?? null });
      return null;
    }
  }
}
