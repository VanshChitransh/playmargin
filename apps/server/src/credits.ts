// Free-mode credits over the append-only ledger (Repository). Balance is always SUM(delta).
// Credits can never be bought or cashed out; the daily top-up is lazy (first visit each UTC day)
// and leaves a row even when it adds 0, so losing a match later that day can't trigger a second one.
import { MICRO, R, type CreditsRepo, type Micro } from "@margin/core";
import { appendCredit, creditBalance, type Db } from "./db";

const DAY_MS = 86_400_000;
export const TOPUP_TO_MICRO: Micro = R.DAILY_CREDIT_TOPUP_TO * MICRO;

/** The CreditsRepo port backed by SQLite. */
export function creditsRepo(db: Db): CreditsRepo {
  return {
    balance: (userId) => creditBalance(db, userId),
    append: (entry) => appendCredit(db, entry),
  };
}

/** Top the user up to DAILY_CREDIT_TOPUP_TO once per UTC day; returns the Micro added. */
export function topUpDaily(db: Db, userId: string, nowMs = Date.now()): Micro {
  const dayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const done = db
    .prepare("SELECT 1 FROM credits_ledger WHERE user_id = ? AND reason = 'daily_topup' AND at >= ? LIMIT 1")
    .get(userId, dayStart);
  if (done) return 0;
  const delta = Math.max(0, TOPUP_TO_MICRO - creditBalance(db, userId));
  db.prepare("INSERT INTO credits_ledger (user_id, delta, reason, at) VALUES (?, ?, 'daily_topup', ?)").run(
    userId,
    delta,
    nowMs,
  );
  return delta;
}

/** Browser-generated public key (e.g. "ed25519:<base58>"); anything else is rejected. */
export function isGuestKey(k: unknown): k is string {
  return typeof k === "string" && /^[A-Za-z0-9:_-]{16,128}$/.test(k);
}
