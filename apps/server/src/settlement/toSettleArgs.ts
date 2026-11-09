// SettleResult (engine Micro) to the contract's SettleArgs (USDC base units, 6 decimals).
// 1 USDC = UNITS_PER_USDC game units, so one base unit is 100 Micro. Every amount is floored and
// the reserve takes the remainder, so the contract's exact conservation check holds. Payouts with
// no account (drone bounties) are swept into the reserve. Bad debt is floored once and the chain's
// 10% cap is enforced here: any excess is repaid to the vault out of the largest payouts first.
import { MICRO, R, type SettleArgs, type SettleResult } from "@margin/core";

/** Micro per USDC base unit (100 with the current RULES). */
export const MICRO_PER_BASE = (R.UNITS_PER_USDC * MICRO) / 1_000_000;
/** Mirrors contracts/margin/src/lib.rs: budget reserved at open, and the bad debt cap per match. */
const BUDGET_BPS = 15_000n;
const BAD_DEBT_MAX_BPS = 1_000n;

const base = (m: number): bigint => BigInt(Math.floor(m / MICRO_PER_BASE));

/** Contract args for a settled paid match. Throws if the stakes are not whole base units. */
export function toSettleArgs(r: SettleResult): SettleArgs {
  const paidMicro = r.payouts.reduce((s, p) => s + p.amount, 0);
  const potMicro = paidMicro + r.vaultRepaid + r.interestToVault + r.fees + r.reserve - r.lent;
  if (potMicro % MICRO_PER_BASE !== 0) throw new Error(`stakes ${potMicro} Micro are not whole USDC base units`);
  const stakes = BigInt(potMicro / MICRO_PER_BASE);

  const perAccount = new Map<string, bigint>();
  for (const p of r.payouts) {
    if (!p.accountId) continue;
    perAccount.set(p.accountId, (perAccount.get(p.accountId) ?? 0n) + base(p.amount));
  }
  const lent = base(r.lent);
  const capBad = (stakes * BUDGET_BPS) / 10_000n * BAD_DEBT_MAX_BPS / 10_000n;
  let bad = base(r.lent - r.vaultRepaid);
  if (bad > lent) bad = lent;
  const interest = base(r.interestToVault);
  const fees = base(r.fees);
  const out = () => [...perAccount.values()].reduce((s, a) => s + a, 0n) + (lent - bad) + interest + fees;

  // Over the chain's cap, or rounding left the reserve short: take it from the biggest winners.
  if (bad > capBad) bad = capBad; // the excess becomes vault_repaid, so out() now overshoots
  let owed = out() - (stakes + lent);
  while (owed > 0n) {
    const top = [...perAccount].sort(([, a], [, b]) => (a < b ? 1 : a > b ? -1 : 0))[0];
    if (!top || top[1] === 0n) throw new Error(`cannot cover ${owed} base units of bad debt from payouts`);
    const take = top[1] < owed ? top[1] : owed;
    perAccount.set(top[0], top[1] - take);
    owed -= take;
  }
  const reserve = stakes + lent - out();
  if (reserve < 0n) throw new Error(`negative reserve ${reserve}`);

  const payouts = [...perAccount].filter(([, a]) => a > 0n).sort(([a], [b]) => (a < b ? -1 : 1));
  return {
    match_id: r.matchId,
    payouts: payouts.map(([a, v]) => [a, v.toString()]),
    lent: lent.toString(),
    vault_repaid: (lent - bad).toString(),
    interest_to_vault: interest.toString(),
    fees: fees.toString(),
    reserve: reserve.toString(),
    seq: r.seq,
    head: r.head,
  };
}
