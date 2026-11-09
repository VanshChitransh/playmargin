// SettleResult (engine Micro) to the contract's SettleArgs (USDC base units, 6 decimals).
// 1 USDC = UNITS_PER_USDC game units, so one base unit is 100 Micro. Every amount is floored and
// the reserve takes the remainder, so the contract's exact conservation check holds. Drone bounties
// go to their registered drone-N account (no account: swept into the reserve), and the drones' total
// is clamped to the contract's 12% of stakes. Bad debt is floored once and must fit both the chain's
// 10% cap and the reserve it is paid from: any excess is repaid to the vault out of the largest
// payouts first.
import { microPerBase, type SettleArgs, type SettleResult } from "@margin/core";

/** Micro per USDC base unit at the default 1 USDC stake (100). Any stake: microPerBase(stakeBase). */
export const MICRO_PER_BASE = microPerBase(1_000_000);
/** Mirrors contracts/margin/src/lib.rs: budget reserved at open, and the bad debt cap per match. */
const BUDGET_BPS = 15_000n;
const BAD_DEBT_MAX_BPS = 1_000n;
/** Mirrors AGENT_PAYOUT_MAX_BPS: registered drones may take at most this share of one match's stakes. */
const AGENT_PAYOUT_MAX_BPS = 1_200n;

export interface SettleContext {
  /** The contract's reserve() before this settle, in base units. Omitted: not bounded (tests, credits). */
  reserve?: bigint;
}

/** Contract args for a settled paid match. Throws if the stakes are not whole base units. */
export function toSettleArgs(r: SettleResult, ctx: SettleContext = {}): SettleArgs {
  // The room's stake sets the conversion (100 Micro per base unit at 1 USDC, 1000 at 0.10).
  const per = microPerBase(r.stakeBase ?? 1_000_000);
  const base = (m: number): bigint => BigInt(Math.floor(m / per));
  const paidMicro = r.payouts.reduce((s, p) => s + p.amount, 0);
  const potMicro = paidMicro + r.vaultRepaid + r.interestToVault + r.fees + r.reserve - r.lent;
  if (potMicro % per !== 0) throw new Error(`stakes ${potMicro} Micro are not whole USDC base units`);
  const stakes = BigInt(potMicro / per);

  const perAccount = new Map<string, bigint>();
  const drones = new Set<string>();
  for (const p of r.payouts) {
    if (!p.accountId) continue;
    if (p.id.startsWith("drone-")) drones.add(p.accountId);
    perAccount.set(p.accountId, (perAccount.get(p.accountId) ?? 0n) + base(p.amount));
  }
  // Drones over the chain's cap: trim the biggest drone payouts, the excess stays in the reserve.
  let droneOver = [...drones].reduce((s, a) => s + perAccount.get(a)!, 0n) - (stakes * AGENT_PAYOUT_MAX_BPS) / 10_000n;
  for (const a of [...drones].sort((x, y) => (perAccount.get(y)! > perAccount.get(x)! ? 1 : -1))) {
    if (droneOver <= 0n) break;
    const take = perAccount.get(a)! < droneOver ? perAccount.get(a)! : droneOver;
    perAccount.set(a, perAccount.get(a)! - take);
    droneOver -= take;
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
  // The chain pays bad debt from its reserve (plus this match's share), so with a thin reserve the
  // part it cannot cover comes out of payouts too. Algebra: payouts <= stakes - interest - fees +
  // min(bad, reserve), which reduces to the extra max(0, bad - reserve) below.
  let owed = out() - (stakes + lent) + (ctx.reserve !== undefined && bad > ctx.reserve ? bad - ctx.reserve : 0n);
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
