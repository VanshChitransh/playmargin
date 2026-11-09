// Pure replay of the money events in a match log. The server, the contract call and the
// Verify page all trust this one function: it reaches the exact numbers the live room reached
// and refuses any log a live room could not have produced, wherever that is checkable without
// food flows. What it cannot see (eat gains, bounty vs scatter, the leftover total) is protected by
// the settler-signed head anchored on NEAR, so always pair it with verifyChain (settleVerified).
import { BORROW_FEE_BPS, BORROW_FEE_VAULT_BPS, BOUNTY_BPS, INTEREST_FOOD_BPS, INTEREST_VAULT_BPS, LEVERAGE_CAP_BPS, LIQ_FEE_BPS, R, sToTicks } from "./constants";
import type { LogEntry } from "./events";
import { verifyChain } from "./log";
import type { BlobKind, Micro, SettleResult } from "./types";
import { assertMicro, mulBps, mulDivUp } from "./units";

interface Acct {
  accountId: string | null;
  kind: BlobKind;
  charged: boolean;
  debt: Micro;
  /** Closed by pop, eat or a mid-match cash-out; only bell-tick CASHOUTs may follow. */
  closedAt: number | null;
  /** Left by cash-out (not popped or eaten): with closedAt == the end tick, a bell survivor. */
  cashed: boolean;
}

const fail = (seq: number, why: string): never => {
  throw new Error(`settle: seq ${seq}: ${why}`);
};

/** Settle a finished match from its log. Throws if the log is incomplete, impossible or unbalanced. */
export function settle(log: LogEntry[]): SettleResult {
  let matchId = "";
  let pot: Micro = 0;
  let budget: Micro = 0;
  let lent: Micro = 0;
  let vaultRepaid: Micro = 0;
  let badDebt: Micro = 0;
  let goTick = 0;
  let interestToVault: Micro = 0;
  let reserve: Micro = 0;
  let fees: Micro = 0;
  const blobs = new Map<string, Acct>();
  const paid = new Map<string, Micro>();
  const lateCashouts: Array<{ seq: number; tick: number; blob: string; amount: Micro }> = [];
  let end: { tick: number; finalMasses: Record<string, Micro>; toVault: Micro; dust: Micro } | null = null;

  const m = (seq: number, x: number, what: string): Micro => {
    try {
      return assertMicro(x, what);
    } catch {
      return fail(seq, `${what} is not Micro: ${x}`);
    }
  };
  const live = (seq: number, id: string): Acct => {
    const a = blobs.get(id) ?? fail(seq, `unknown blob ${id}`);
    if (a.closedAt !== null) fail(seq, `${id} already left the match`);
    return a;
  };

  for (const e of log) {
    const s = e.seq;
    if (end) fail(s, "event after MATCH_END");
    if (!matchId && e.type !== "JOIN" && e.type !== "MATCH_START") fail(s, `${e.type} before MATCH_START`);
    switch (e.type) {
      case "MATCH_START":
        if (matchId) fail(s, "second MATCH_START");
        matchId = e.data.matchId;
        goTick = e.tick;
        break;
      case "JOIN": {
        const p = e.data.player;
        if (blobs.has(p.id)) fail(s, `second JOIN for ${p.id}`);
        blobs.set(p.id, { accountId: p.accountId, kind: p.kind, charged: false, debt: 0, closedAt: null, cashed: false });
        break;
      }
      case "CHARGE": {
        const a = live(s, e.data.blob);
        if (a.charged || a.kind === "drone") fail(s, `bad CHARGE for ${e.data.blob}`);
        a.charged = true;
        const entry = m(s, e.data.entry, "entry");
        pot += entry;
        budget += mulBps(entry, LEVERAGE_CAP_BPS - 10_000);
        break;
      }
      case "BOOST": {
        const a = live(s, e.data.blob);
        const borrowed = m(s, e.data.borrowed, "borrowed");
        const fee = m(s, e.data.fee, "fee");
        if (!a.charged || borrowed === 0) fail(s, "BOOST by a blob with no stake");
        if (fee !== mulDivUp(borrowed, BORROW_FEE_BPS, 10_000)) fail(s, `fee ${fee} is not 1% of ${borrowed}`);
        a.debt += borrowed;
        lent += borrowed;
        if (lent - vaultRepaid - badDebt > budget) fail(s, "vault lent past its budget");
        const feeVault = mulBps(fee, BORROW_FEE_VAULT_BPS);
        fees += feeVault;
        reserve += fee - feeVault;
        break;
      }
      case "REPAY": {
        const a = live(s, e.data.blob);
        const amount = m(s, e.data.amount, "repay");
        if (amount === 0 || amount > a.debt) fail(s, `REPAY ${amount} against debt ${a.debt}`);
        a.debt -= amount;
        vaultRepaid += amount;
        break;
      }
      case "INTEREST": {
        const a = live(s, e.data.blob);
        const amount = m(s, e.data.amount, "interest");
        if (a.debt === 0) fail(s, "INTEREST with no debt");
        const toFood = mulBps(amount, INTEREST_FOOD_BPS);
        const toVault = mulBps(amount, INTEREST_VAULT_BPS);
        if (e.data.toFood !== toFood || e.data.toVault !== toVault || e.data.toReserve !== amount - toFood - toVault) {
          fail(s, "INTEREST split is not 80/15/5");
        }
        interestToVault += toVault;
        reserve += amount - toFood - toVault;
        break;
      }
      case "EAT":
      case "POP":
      case "KEEPER_POP": {
        const v = live(s, e.data.victim);
        if (e.type === "EAT" && v.kind === "human" && blobs.get(e.data.by)?.kind === "agent" && e.tick - goTick < sToTicks(R.AGENT_NO_EAT_HUMAN_S)) {
          fail(s, "an agent ate a human in the first 30 s");
        }
        const repaid = m(s, e.data.debtRepaid, "debtRepaid");
        const lost = m(s, e.data.badDebt, "badDebt");
        if (repaid + lost !== v.debt) fail(s, `${e.type} closes ${repaid + lost} of debt ${v.debt}`);
        if (e.type !== "EAT") {
          const fee = m(s, e.data.fee, "fee");
          const max = mulBps(v.debt, LIQ_FEE_BPS) + (e.type === "KEEPER_POP" ? mulBps(v.debt, BOUNTY_BPS) : 0);
          if (fee > max) fail(s, `liquidation fee ${fee} over ${max}`);
          if (e.type === "POP" && m(s, e.data.bounty, "bounty") > mulBps(v.debt, BOUNTY_BPS)) fail(s, "bounty over 8%");
          if (e.type === "POP") live(s, e.data.by);
          reserve += fee;
        } else live(s, e.data.by);
        vaultRepaid += repaid;
        badDebt += lost;
        v.debt = 0;
        v.closedAt = e.tick;
        break;
      }
      case "CASHOUT": {
        const a = blobs.get(e.data.blob) ?? fail(s, `CASHOUT for unknown blob ${e.data.blob}`);
        if (!a.charged && a.kind !== "drone") fail(s, `CASHOUT for ${e.data.blob}, which never paid in`);
        if (a.debt !== 0) fail(s, `CASHOUT with ${a.debt} still owed`);
        const amount = m(s, e.data.amount, "cashout");
        if (a.closedAt !== null) lateCashouts.push({ seq: s, tick: e.tick, blob: e.data.blob, amount });
        else [a.closedAt, a.cashed] = [e.tick, true];
        paid.set(e.data.blob, (paid.get(e.data.blob) ?? 0) + amount);
        break;
      }
      case "MATCH_END":
        end = e.data;
        reserve += m(s, e.data.dust, "dust");
        // No-survivor leftover is LP yield: it rides in interest_to_vault, so the contract's
        // equality holds unchanged.
        interestToVault += m(s, e.data.toVault, "toVault");
        break;
      case "SPIKE":
        live(s, e.data.blob);
        break; // mass to food: ends in someone's payout or the leftover split
    }
  }
  const last = log.at(-1) ?? fail(-1, "empty log");
  if (!end) return fail(last.seq, "log has no MATCH_END");
  // A closed blob is paid again only by the bell (leftover food), which happens on the end tick.
  for (const c of lateCashouts) if (c.tick !== end.tick) fail(c.seq, "CASHOUT after the blob left, before the bell");
  // Leftover food at the bell: an equal share to each human alive at the bell (dust < their count),
  // or, with none alive, all of it to the vault. A mid-match cash-out can't land on the bell tick
  // (it must start by 80 s and takes 4 s), so "closed by cash-out on the end tick" = alive at the bell.
  const bell = [...blobs].filter(([, a]) => a.kind === "human" && a.cashed && a.closedAt === end.tick).map(([id]) => id);
  const shares = new Set<string>();
  for (const c of lateCashouts) {
    if (!bell.includes(c.blob) || shares.has(c.blob)) fail(c.seq, `${c.blob} is paid leftover but was not alive at the bell`);
    if (c.amount !== lateCashouts[0]?.amount) fail(c.seq, "leftover shares are not equal");
    shares.add(c.blob);
  }
  const dust = end.dust;
  if (bell.length === 0 ? dust !== 0 : end.toVault !== 0 || dust >= bell.length || (shares.size !== 0 && shares.size !== bell.length)) {
    fail(last.seq, `leftover split does not match ${bell.length} survivors (toVault ${end.toVault}, dust ${dust})`);
  }
  for (const [id, a] of blobs) if (a.debt !== 0) fail(last.seq, `${id} ends owing ${a.debt}`);

  const payouts: SettleResult["payouts"] = [];
  let totalPaid: Micro = 0;
  for (const [id, amount] of [...paid].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if ((end.finalMasses[id] ?? 0) !== amount) fail(last.seq, `payout for ${id} is ${amount}, MATCH_END says ${end.finalMasses[id]}`);
    payouts.push({ id, accountId: blobs.get(id)?.accountId ?? null, amount });
    totalPaid += amount;
  }
  for (const [id, x] of Object.entries(end.finalMasses)) {
    if (x !== (paid.get(id) ?? 0)) fail(last.seq, `MATCH_END pays ${id} ${x} with no matching CASHOUT`);
  }
  // Exact equality, no plug: every Micro that came in (entries + loans) has exactly one home.
  const out = totalPaid + vaultRepaid + interestToVault + reserve + fees;
  if (out !== pot + lent) fail(last.seq, `books off by ${out - (pot + lent)} Micro`);
  return { matchId, payouts, lent, vaultRepaid, interestToVault, reserve, fees, head: last.hash, seq: last.seq };
}

/** verifyChain then settle: the only entry point the server, contract call and Verify page should use. */
export async function settleVerified(log: LogEntry[]): Promise<SettleResult> {
  const bad = await verifyChain(log);
  if (bad !== null) throw new Error(`settle: hash chain broken at seq ${bad}`);
  return settle(log);
}
