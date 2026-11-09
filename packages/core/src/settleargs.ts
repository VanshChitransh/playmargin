// SettleResult (Micro) to the contract's settle args (USDC base units, 6 decimals).
// The contract checks sum(payouts) + vault_repaid + interest_to_vault + reserve == stakes + budget,
// so every Micro-to-USDC floor lands its dust in reserve and the sum stays exact.
import { LEVERAGE_CAP_BPS, MICRO, R } from "./constants";
import type { SettleArgs } from "./abi";
import type { Micro, SettleResult } from "./types";
import { mulBps } from "./units";

/** Micro per USDC base unit: 1 USDC = UNITS_PER_USDC units = 1e6 base units. */
export const MICRO_PER_USDC_BASE = (MICRO * R.UNITS_PER_USDC) / 1_000_000;

const base = (m: Micro): number => Math.floor(m / MICRO_PER_USDC_BASE);

/** Contract args for a settled paid match. Throws if a payout has no NEAR account. */
export function toSettleArgs(r: SettleResult): SettleArgs {
  const paid = r.payouts.reduce((s, p) => s + p.amount, 0);
  // settle() proved paid + repaid + interest + fees + reserve == stakes + lent, so stakes follow.
  const stakes = paid + r.vaultRepaid + r.interestToVault + r.fees + r.reserve - r.lent;
  const budget = mulBps(stakes, LEVERAGE_CAP_BPS - 10_000);
  const payouts: Array<[string, string]> = [];
  let outB = 0;
  for (const p of r.payouts) {
    if (p.amount === 0) continue;
    if (!p.accountId) throw new Error(`paid payout for ${p.id} has no NEAR account`);
    const b = base(p.amount);
    payouts.push([p.accountId, String(b)]);
    outB += b;
  }
  // The contract reserved the whole budget at open; what was never lent goes straight back.
  const vaultB = base(r.vaultRepaid + budget - r.lent);
  const interestB = base(r.interestToVault + r.fees);
  const totalB = base(stakes) + base(budget);
  if (totalB * MICRO_PER_USDC_BASE !== stakes + budget) throw new Error("stakes are not whole USDC base units");
  const reserveB = totalB - outB - vaultB - interestB;
  if (reserveB < base(r.reserve)) throw new Error("settle args lost reserve");
  return {
    match_id: r.matchId, payouts, vault_repaid: String(vaultB), interest_to_vault: String(interestB),
    reserve: String(reserveB), seq: r.seq, head: r.head,
  };
}
