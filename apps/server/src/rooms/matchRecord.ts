// Everything durable about one match: the hash-chained log (persisted every 5 s and at the end),
// the match row and seats, and payment through the Settlement port. Hashing is async, so drains
// chain serially. At the bell the log, not the live world, decides payouts: settleVerified replays
// it and any disagreement with the world refuses payment.
import {
  drainLog, entryFor, settleVerified, type LogEntry, type Mode, type SettleResult, type Settlement, type World,
} from "@margin/core";
import { withTx, type Db } from "../db";
import { log } from "../obs";
import { addMatchPlayer, createMatch, finishMatch, saveEvents } from "../matches";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MatchRecord {
  readonly entries: LogEntry[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private saved = 0;
  /** This match's DB writes, applied strictly in order (row before seats before log before close). */
  private writes: Promise<void> = Promise.resolve();
  private pendingWrites = 0;

  constructor(
    private readonly db: Db,
    private readonly matchId: string,
    private readonly mode: Mode,
    private readonly settlement: Settlement,
    /** Backoff between retries of a failed write, by attempt (tests pass tiny values). */
    private readonly retryMs: (attempt: number) => number = (a) => Math.min(60_000, 2_000 * a),
  ) {}

  /**
   * Queue a DB write and retry it until it lands. A full disk (SQLITE_FULL) or an I/O error delays a
   * money record, it never drops it, and it never throws into the room tick or settle. Alerts in the
   * log: db_write_failed (first try, then every 10th), db_write_recovered once it lands.
   */
  private persist(what: string, fn: () => void): void {
    this.pendingWrites++;
    this.writes = this.writes
      .then(async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            fn();
            if (attempt > 1) log.info("db_write_recovered", { matchId: this.matchId, what, attempts: attempt });
            return;
          } catch (err) {
            if (attempt === 1 || attempt % 10 === 0) log.error("db_write_failed", { matchId: this.matchId, what, attempt, err });
            await sleep(this.retryMs(attempt));
          }
        }
      })
      .finally(() => void this.pendingWrites--);
  }

  /** Resolves when every queued write has landed (tests, drain). */
  whenWritten(): Promise<void> {
    return this.writes;
  }

  /** Queue the world's pending events onto the chain (call once per tick). */
  drain(w: World): void {
    this.chain = this.chain.then(() => drainLog(w, this.entries));
  }

  /** Write entries not yet on disk, so a crash loses at most one flush interval. Never throws. */
  flush(): void {
    this.persist("log", () => {
      const upTo = this.entries.length;
      saveEvents(this.db, this.matchId, this.entries.slice(this.saved, upTo));
      this.saved = upTo;
    });
  }

  /** The 5 s periodic flush: skipped while earlier writes are still retrying (they will catch up). */
  flushIfIdle(): void {
    if (this.pendingWrites === 0) this.flush();
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
    const seats = [...users];
    // Row and seats in one transaction, so a retry after a failed write never hits a duplicate key.
    this.persist("open", () =>
      withTx(this.db, () => {
        createMatch(this.db, { id: this.matchId, mode: this.mode, seed, pot: w.pot });
        for (const [blobId, userId] of seats) addMatchPlayer(this.db, { matchId: this.matchId, userId, blobId, entry: entryFor(this.mode) });
      }),
    );
    if (!reserved) this.reserve(w).catch((err: unknown) => log.error("open_failed", { matchId: this.matchId, err }));
  }

  /** A human seat (also used for late joins). */
  seat(userId: string, blobId: string): void {
    this.persist("seat", () => addMatchPlayer(this.db, { matchId: this.matchId, userId, blobId, entry: entryFor(this.mode) }));
  }

  /** Background settle retries at 30 s, 2 min and 10 min, each failure an alert in the log. */
  private retrySettle(result: SettleResult, payouts: Map<string, number>, attempt: number): void {
    const delay = [30_000, 120_000, 600_000][attempt - 1];
    if (delay === undefined && this.mode === "free") {
      // Credits have no reclaim(): keep trying every 10 min (a full disk clears), never drop the payouts.
      log.error("settle_still_failing", { matchId: this.matchId, attempts: attempt });
      setTimeout(() => this.retrySettle(result, payouts, attempt), 600_000).unref();
      return;
    }
    if (delay === undefined) {
      log.error("settle_gave_up", { matchId: this.matchId, attempts: attempt, note: "players can reclaim() after 15 min" });
      this.persist("gave up", () => finishMatch(this.db, this.matchId, { status: "refused", head: result.head }));
      return;
    }
    setTimeout(() => {
      this.settlement.settle(result, result.head).then(
        (tx) => {
          this.persist("settled", () => finishMatch(this.db, this.matchId, { status: "settled", head: result.head, txHash: tx?.hash, payouts }));
          log.info("settled", { matchId: this.matchId, mode: this.mode, tx: tx?.hash ?? null, attempt: attempt + 1 });
        },
        (err: unknown) => {
          log.error("settle_revert", { matchId: this.matchId, attempt: attempt + 1, err });
          this.retrySettle(result, payouts, attempt + 1);
        },
      );
    }, delay).unref();
  }

  /**
   * Replay, check against the live world, pay, and close the row. Never throws: only a log that fails
   * verification is "refused"; a payment failure retries; every DB write is queued and retried, so a
   * full disk delays the record and never turns a valid match into a refused or lost one.
   */
  async settle(w: World): Promise<SettleResult | null> {
    let result: SettleResult;
    try {
      this.drain(w);
      await this.chain;
      result = await settleVerified(this.entries);
      for (const p of result.payouts) {
        const live = w.blobs.get(p.id)?.payout;
        if (live !== p.amount) throw new Error(`settle != live for ${p.id}: ${p.amount} vs ${live}`);
      }
    } catch (err) {
      log.error("settle_refused", { matchId: this.matchId, err });
      const head = this.entries.at(-1)?.hash ?? null;
      this.flush();
      this.persist("refused", () => finishMatch(this.db, this.matchId, { status: "refused", head }));
      return null;
    }
    this.flush();
    const payouts = new Map(result.payouts.map((p) => [p.id, p.amount]));
    const proven = result;
    try {
      const tx = await this.settlement.settle(proven, proven.head);
      this.persist("settled", () => finishMatch(this.db, this.matchId, { status: "settled", head: proven.head, txHash: tx?.hash, payouts }));
      log.info("settled", { matchId: this.matchId, mode: this.mode, tx: tx?.hash ?? null });
    } catch (err) {
      // The log is proven; only the payment failed (contract revert, RPC down, a full disk for credits).
      // Keep trying in the background so the room can close; paid players can reclaim() after 15 min.
      log.error("settle_revert", { matchId: this.matchId, attempt: 1, err });
      this.persist("retrying", () => finishMatch(this.db, this.matchId, { status: "retrying", head: proven.head, payouts }));
      this.retrySettle(proven, payouts, 1);
    }
    return result;
  }
}
