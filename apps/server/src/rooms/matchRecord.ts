// Everything durable about one match: the hash-chained log (persisted every 5 s and at the end),
// the match row and seats, and payment through the Settlement port. Hashing is async, so drains
// chain serially. At the bell the log, not the live world, decides payouts: settleVerified replays
// it and any disagreement with the world refuses payment.
import {
  drainLog, entryFor, settleVerified, type LogEntry, type Mode, type SettleResult, type Settlement, type World,
} from "@margin/core";
import type { Db } from "../db";
import { log } from "../obs";
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

  /** The adapter's open() for this world's players. Paid rooms await it before GO. */
  reserve(w: World): Promise<void> {
    const players = [...w.blobs.values()]
      .filter((b) => b.kind !== "drone")
      .map((b) => ({ id: b.id, accountId: b.accountId, entry: entryFor(this.mode) }));
    return this.settlement.open({ matchId: this.matchId, mode: this.mode, pot: w.pot, vaultBudget: w.vault.budget, players });
  }

  /** At GO: match row and human seats, plus open() unless the room already awaited it. */
  open(w: World, seed: number, users: ReadonlyMap<string, string>, reserved = false): void {
    createMatch(this.db, { id: this.matchId, mode: this.mode, seed, pot: w.pot });
    for (const [blobId, userId] of users) this.seat(userId, blobId);
    if (!reserved) this.reserve(w).catch((err: unknown) => log.error("open_failed", { matchId: this.matchId, err }));
  }

  /** A human seat (also used for late joins). */
  seat(userId: string, blobId: string): void {
    addMatchPlayer(this.db, { matchId: this.matchId, userId, blobId, entry: entryFor(this.mode) });
  }

  /** Background settle retries at 30 s, 2 min and 10 min, each failure an alert in the log. */
  private retrySettle(result: SettleResult, payouts: Map<string, number>, attempt: number): void {
    const delay = [30_000, 120_000, 600_000][attempt - 1];
    if (delay === undefined) {
      log.error("settle_gave_up", { matchId: this.matchId, attempts: attempt, note: "players can reclaim() after 15 min" });
      finishMatch(this.db, this.matchId, { status: "refused", head: result.head });
      return;
    }
    setTimeout(() => {
      this.settlement.settle(result, result.head).then(
        (tx) => {
          finishMatch(this.db, this.matchId, { status: "settled", head: result.head, txHash: tx?.hash, payouts });
          log.info("settled", { matchId: this.matchId, mode: this.mode, tx: tx?.hash ?? null, attempt: attempt + 1 });
        },
        (err: unknown) => {
          log.error("settle_revert", { matchId: this.matchId, attempt: attempt + 1, err });
          this.retrySettle(result, payouts, attempt + 1);
        },
      );
    }, delay).unref();
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
      const payouts = new Map(result.payouts.map((p) => [p.id, p.amount]));
      try {
        const tx = await this.settlement.settle(result, result.head);
        finishMatch(this.db, this.matchId, { status: "settled", head: result.head, txHash: tx?.hash, payouts });
        log.info("settled", { matchId: this.matchId, mode: this.mode, tx: tx?.hash ?? null });
      } catch (err) {
        // The log is proven; only the payment failed (contract revert, RPC down). Keep trying in the
        // background so the room can close; players can still reclaim() after 15 min if it never lands.
        log.error("settle_revert", { matchId: this.matchId, attempt: 1, err });
        finishMatch(this.db, this.matchId, { status: "retrying", head: result.head, payouts });
        this.retrySettle(result, payouts, 1);
      }
      return result;
    } catch (err) {
      log.error("settle_refused", { matchId: this.matchId, err });
      this.flush();
      finishMatch(this.db, this.matchId, { status: "refused", head: this.entries.at(-1)?.hash ?? null });
      return null;
    }
  }
}
