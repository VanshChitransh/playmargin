// Credits side of a free match: admit at join, charge the entry at GO (never earlier, so
// leaving during warm-up is free), pay out at the end. Agents never touch the ledger.
import { ENTRY_FREE_MICRO, type Micro, type SettleResult } from "@margin/core";
import { creditsRepo, isGuestKey, topUpDaily } from "../credits";
import { userForGuestKey, type Db } from "../db";

/** User id for a free join; throws (join refused) on a bad key or too few credits. */
export function admitFree(db: Db, opts: unknown): string {
  const guestKey = (opts as { guestKey?: unknown } | null)?.guestKey;
  if (!isGuestKey(guestKey)) throw new Error("free mode needs a guestKey (browser public key)");
  const userId = userForGuestKey(db, guestKey);
  topUpDaily(db, userId);
  if (creditsRepo(db).balance(userId) < ENTRY_FREE_MICRO) throw new Error("not enough credits");
  return userId;
}

/** Debit the entry at GO; false if the balance went short meanwhile (another tab spent it). */
export function chargeEntry(db: Db, userId: string, matchId: string): boolean {
  const repo = creditsRepo(db);
  if (repo.balance(userId) < ENTRY_FREE_MICRO) return false;
  repo.append({ userId, delta: -ENTRY_FREE_MICRO, reason: "entry", matchId });
  return true;
}

/** Credit each human's settled payout (from settle(log), never from live state). Returns the total. */
export function payFromSettle(db: Db, users: Map<string, string>, result: SettleResult, matchId: string): Micro {
  const repo = creditsRepo(db);
  let total = 0;
  for (const p of result.payouts) {
    const userId = users.get(p.id);
    if (!userId || p.amount <= 0) continue;
    repo.append({ userId, delta: p.amount, reason: "payout", matchId });
    total += p.amount;
  }
  return total;
}
