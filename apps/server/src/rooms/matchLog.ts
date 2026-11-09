// The match's hash-chained log on the server side. Hashing is async, so every drain chains on
// the previous one and seqs can never interleave. At the bell the log, not the live world,
// decides payouts: settleVerified replays it and any disagreement with the world refuses payment.
import { drainLog, settleVerified, type LogEntry, type SettleResult, type World } from "@margin/core";

export class MatchLog {
  readonly entries: LogEntry[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  /** Queue the world's pending events onto the chain (call once per tick). */
  drain(w: World): void {
    this.chain = this.chain.then(() => drainLog(w, this.entries));
  }

  /** Wait for every queued drain, replay the log, and check it against the live world. */
  async settle(w: World): Promise<SettleResult> {
    this.drain(w);
    await this.chain;
    const result = await settleVerified(this.entries);
    for (const p of result.payouts) {
      const live = w.blobs.get(p.id)?.payout;
      if (live !== p.amount) throw new Error(`settle != live for ${p.id}: ${p.amount} vs ${live}`);
    }
    return result;
  }
}
