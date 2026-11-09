// SettleResult (engine Micro) to the contract's SettleArgs (USDC base units, 6 decimals).
// 1 USDC = UNITS_PER_USDC game units, so one base unit is 100 Micro. Every amount is floored and
// the reserve takes the remainder: that keeps the contract's exact conservation check true and the
// reserve provably >= 0. Payouts with no account (drone bounties) are swept into the reserve.
import { MICRO, R, type SettleArgs, type SettleResult } from "@margin/core";

/** Micro per USDC base unit (100 with the current RULES). */
export const MICRO_PER_BASE = (R.UNITS_PER_USDC * MICRO) / 1_000_000;

const base = (m: number): bigint => BigInt(Math.floor(m / MICRO_PER_BASE));

/** Contract args for a settled paid match. Throws if the stakes are not whole base units. */
export function toSettleArgs(r: SettleResult): SettleArgs {
  const paidMicro = r.payouts.reduce((s, p) => s + p.amount, 0);
  const potMicro = paidMicro + r.vaultRepaid + r.interestToVault + r.fees + r.reserve - r.lent;
  if (potMicro % MICRO_PER_BASE !== 0) throw new Error(`stakes ${potMicro} Micro are not whole USDC base units`);

  const perAccount = new Map<string, bigint>();
  for (const p of r.payouts) {
    if (!p.accountId) continue;
    perAccount.set(p.accountId, (perAccount.get(p.accountId) ?? 0n) + base(p.amount));
  }
  const payouts = [...perAccount].filter(([, a]) => a > 0n).sort(([a], [b]) => (a < b ? -1 : 1));
  const lent = base(r.lent);
  const vaultRepaid = base(r.vaultRepaid);
  const interest = base(r.interestToVault);
  const fees = base(r.fees);
  const out = payouts.reduce((s, [, a]) => s + a, 0n) + vaultRepaid + interest + fees;
  const reserve = BigInt(potMicro / MICRO_PER_BASE) + lent - out;
  if (reserve < 0n) throw new Error(`negative reserve ${reserve}`);

  return {
    match_id: r.matchId,
    payouts: payouts.map(([a, v]) => [a, v.toString()]),
    lent: lent.toString(),
    vault_repaid: vaultRepaid.toString(),
    interest_to_vault: interest.toString(),
    fees: fees.toString(),
    reserve: reserve.toString(),
    seq: r.seq,
    head: r.head,
  };
}
