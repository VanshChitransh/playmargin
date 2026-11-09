// Credits side of a free match: admit at join and charge the entry at GO (never earlier, so
// leaving during warm-up is free). Payouts go through CreditsSettlement. Agents never touch the ledger.
import { ENTRY_FREE_MICRO } from "@margin/core";
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
