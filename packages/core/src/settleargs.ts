// SettleResult (Micro) to the contract's settle args (USDC base units, 6 decimals).
// The contract checks sum(payouts) + vault_repaid + interest_to_vault + fees + reserve == stakes + lent,
// so every Micro-to-USDC floor lands its dust in reserve and the sum stays exact.
import { ENTRY_PAID_MICRO, MICRO, R } from "./constants";
import type { SettleArgs } from "./abi";
import type { Micro, SettleResult } from "./types";

/** Micro per USDC base unit at the default 1 USDC stake (see microPerBase for any stake). */
export const MICRO_PER_USDC_BASE = (MICRO * R.UNITS_PER_USDC) / 1_000_000;

/**
 * Micro per USDC base unit for a room whose entry stake is stakeBase base units. One entry is always
 * ENTRY_PAID_MICRO in the game, so a 0.10 USDC room plays exactly like a 1 USDC room; only this rate
 * changes (100 at 1 USDC, 1000 at 0.10).
 */
export function microPerBase(stakeBase: number): number {
  if (!Number.isSafeInteger(stakeBase) || stakeBase <= 0 || ENTRY_PAID_MICRO % stakeBase !== 0) throw new Error(`bad stake ${stakeBase}`);
  return ENTRY_PAID_MICRO / stakeBase;
}

/** Contract args for a settled paid match. Throws if a payout has no NEAR account. */
export function toSettleArgs(r: SettleResult): SettleArgs {
  const per = microPerBase(r.stakeBase ?? 1_000_000);
  const base = (m: Micro): number => Math.floor(m / per);
  const payouts: Array<[string, string]> = [];
  let outB = 0;
  for (const p of r.payouts) {
    if (p.amount === 0) continue;
    if (!p.accountId) throw new Error(`paid payout for ${p.id} has no NEAR account`);
    const b = base(p.amount);
    payouts.push([p.accountId, String(b)]);
    outB += b;
  }
  // settle() proved paid + repaid + interest + fees + reserve == stakes + lent, so stakes follow.
  const stakes = r.payouts.reduce((s, p) => s + p.amount, 0) + r.vaultRepaid + r.interestToVault + r.fees + r.reserve - r.lent;
  if (base(stakes) * per !== stakes) throw new Error("stakes are not whole USDC base units");
  const lentB = base(r.lent);
  // repaid <= lent in Micro, so the floors keep vault_repaid <= lent for the contract too.
  const repaidB = base(r.vaultRepaid);
  const interestB = base(r.interestToVault);
  const feesB = base(r.fees);
  const reserveB = base(stakes) + lentB - outB - repaidB - interestB - feesB;
  if (reserveB < 0) throw new Error("settle args underflow");
  return {
    match_id: r.matchId, payouts, lent: String(lentB), vault_repaid: String(repaidB),
    interest_to_vault: String(interestB), fees: String(feesB), reserve: String(reserveB), seq: r.seq, head: r.head,
  };
}
