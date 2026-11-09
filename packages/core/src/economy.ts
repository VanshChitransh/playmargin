// The money rules (RULES.html: BOOST, Interest, REPAY, Red and liquidation, Eating, Hazards,
// Cash-out). Each function moves Micro between blob, vault, fees, reserve and food so that
// checkInvariant always holds, logs the move for settle(log), and floors with dust to reserve.
import * as C from "./constants";
import { scatterFood } from "./food";
import { radius } from "./motion";
import type { Blob, Micro, Ring, World } from "./types";
import { mulBps, mulDivUp } from "./units";

const BPS = 10_000;
const BOOST_LOCKOUT_T = C.sToTicks(C.R.BOOST_LOCKOUT_S);
const REPAY_COOLDOWN_T = C.sToTicks(C.R.REPAY_COOLDOWN_S);
/** Interest food lands at least this far from the payer, so nobody re-eats their own drain. */

/** Match time in ticks since GO. */
export const matchT = (w: World, tick: number): number => tick - w.goTick;

/** mass - debt, Micro. The score. */
export const equity = (b: Blob): Micro => b.mass - b.debt;

/** Health factor in bps (mass * LT / debt); Infinity with no debt. */
export function hfBps(b: Blob): number {
  return b.debt === 0 ? Infinity : Math.floor((b.mass * C.LT_BPS) / b.debt);
}

/** Visible ring state (ultra red is a keeper pop, not a colour). */
export function ring(b: Blob): Ring {
  const hf = hfBps(b);
  if (hf >= C.HF_GREEN_BPS) return "green";
  return hf >= C.HF_RED_BPS ? "yellow" : "red";
}

/** Leverage mass / equity in bps; capped for an underwater blob. */
export function leverageBps(b: Blob): number {
  const e = equity(b);
  return e <= 0 ? C.LEVERAGE_CAP_BPS : Math.floor((b.mass * BPS) / e);
}

/** Equity before borrow fees on the open loan: what BOOST chunks and the cap are sized on. */
const borrowBase = (b: Blob): Micro => equity(b) + b.boostFees;

/** Micro this blob may still borrow before mass hits 2.5x its own money. */
export function boostRoom(b: Blob): Micro {
  return Math.max(0, mulBps(borrowBase(b), C.LEVERAGE_CAP_BPS - BPS) - b.debt);
}

const vaultLeft = (w: World): Micro => w.vault.budget - (w.vault.lent - w.vault.repaid);

/** Share of the full 2.5x room still free, 0 to 1: the fuel ring. Refills as REPAY or eating raise equity. */
export function fuel(b: Blob): number {
  const full = mulBps(borrowBase(b), C.LEVERAGE_CAP_BPS - BPS);
  return full > 0 ? Math.min(1, boostRoom(b) / full) : 0;
}

/** True when holding BOOST would borrow something this tick. */
export function canBoost(w: World, b: Blob, tick: number): boolean {
  return (
    w.phase === "LIVE" && b.state === "alive" && b.kind !== "drone" && !b.cashout &&
    tick >= b.shieldUntil && matchT(w, tick) < BOOST_LOCKOUT_T && ring(b) !== "red" && boostRoom(b) > 0 && vaultLeft(w) > 0
  );
}

/**
 * One tick of held BOOST (nitro): borrow NITRO_RATE x own money per second, capped at 2.5x, and
 * go x1.5 fast. The loan builds up in pendingBorrow and is logged with its fee by flushBoost, so a
 * 2 s hold is one BOOST entry, not 120. Not allowed (red, cap, lockout...) = the hold ends here.
 * Returns Micro borrowed this tick.
 */
export function boostHold(w: World, b: Blob, tick: number): Micro {
  if (!canBoost(w, b, tick)) return 0;
  const perTick = Math.max(1, Math.floor((borrowBase(b) * C.NITRO_RATE_BPS) / (BPS * C.R.TICK_HZ)));
  const amt = Math.min(perTick, boostRoom(b), vaultLeft(w));
  b.mass += amt;
  b.debt += amt;
  b.pendingBorrow += amt;
  w.vault.lent += amt;
  b.boostUntil = tick + 1;
  return amt;
}

/**
 * Log the loan built up by a hold, with its 1% fee from mass. Called when the hold ends and before
 * any event that settle checks against the debt (REPAY, pop, eat, cash-out). Mass always covers the
 * fee: a blob still alive owes at most mass / 0.9 * 0.8, far above 1% of its loan. Returns Micro logged.
 */
export function flushBoost(w: World, b: Blob, tick: number): Micro {
  const amt = b.pendingBorrow;
  if (amt === 0) return 0;
  const fee = mulDivUp(amt, C.BORROW_FEE_BPS, BPS);
  const feeVault = mulBps(fee, C.BORROW_FEE_VAULT_BPS);
  b.pendingBorrow = 0;
  b.mass -= fee;
  b.boostFees += fee;
  w.fees += feeVault;
  w.reserve += fee - feeVault;
  w.pendingLog.push({ type: "BOOST", tick, data: { blob: b.id, borrowed: amt, fee } });
  return amt;
}

function repayFromMass(w: World, b: Blob, amt: Micro, tick: number): Micro {
  flushBoost(w, b, tick);
  const paid = Math.min(amt, b.debt, b.mass);
  if (paid <= 0) return 0;
  b.mass -= paid;
  // Fees shrink with the loan they were paid on, or borrow/repay cycles would ratchet the cap up.
  b.boostFees -= mulDivUp(b.boostFees, paid, b.debt);
  b.debt -= paid;
  w.vault.repaid += paid;
  w.pendingLog.push({ type: "REPAY", tick, data: { blob: b.id, amount: paid } });
  return paid;
}

/** One REPAY tap: 15% of current debt from mass, 0.4 s cooldown, any ring. Returns Micro repaid. */
export function repayTap(w: World, b: Blob, tick: number): Micro {
  if (w.phase !== "LIVE" || b.state !== "alive" || b.debt === 0 || tick < b.repayReadyAt) return 0;
  // A tiny debt would floor to 0 forever; take at least 1 Micro so REPAY always finishes.
  const paid = repayFromMass(w, b, Math.max(1, mulBps(b.debt, C.REPAY_TAP_BPS)), tick);
  if (paid > 0) b.repayReadyAt = tick + REPAY_COOLDOWN_T;
  return paid;
}

/** Interest rate per minute in bps for a vault utilisation in bps (kinked curve, fixed per match). */
export function matchRateBps(utilBps: number): number {
  const u = Math.min(BPS, Math.max(0, utilBps));
  const k = C.RATE_KINK_UTIL_BPS;
  if (u <= k) return C.RATE_BASE_BPS + Math.floor(((C.RATE_AT_KINK_BPS - C.RATE_BASE_BPS) * u) / k);
  return C.RATE_AT_KINK_BPS + Math.floor((C.RATE_SLOPE_ABOVE_BPS * (u - k)) / (BPS - k));
}

/** The one damage path (spike, zone, interest): removes up to amount from mass, returns what it took. */
export function takeMass(b: Blob, amount: Micro): Micro {
  const taken = Math.max(0, Math.min(amount, b.mass));
  b.mass -= taken;
  return taken;
}

/** One second of interest, from mass only; split food 80 / vault 15 / reserve rest. Returns Micro charged. */
export function accrueInterest(w: World, b: Blob, tick: number): Micro {
  if (b.state !== "alive" || b.debt === 0) return 0;
  // Interest runs on the whole debt, so a hold in progress is logged first: one BOOST a second.
  flushBoost(w, b, tick);
  const amount = takeMass(b, mulDivUp(b.debt, w.ratePerMinBps, BPS * 60));
  if (amount === 0) return 0;
  const toFood = mulBps(amount, C.INTEREST_FOOD_BPS);
  const toVault = mulBps(amount, C.INTEREST_VAULT_BPS);
  const toReserve = amount - toFood - toVault;
  w.vault.interest += toVault;
  w.reserve += toReserve;
  w.foodPool += toFood; // reappears as pellets via refillFood
  w.pendingLog.push({ type: "INTEREST", tick, data: { blob: b.id, amount, toFood, toVault, toReserve } });
  return amount;
}

/** Spike damage in Micro: 10% small / 20% big, x1.0 to x2.0 with leverage, never below HF 0.95 while owing. */
export function spikeDamage(b: Blob, big: boolean): Micro {
  const lev = leverageBps(b);
  const span = C.LEVERAGE_CAP_BPS - BPS;
  const mult = Math.min(
    C.SPIKE_LEV_MULT_MAX_BPS,
    BPS + Math.floor((Math.max(0, lev - BPS) * (C.SPIKE_LEV_MULT_MAX_BPS - BPS)) / span),
  );
  const raw = mulBps(b.mass, mulBps(big ? C.SPIKE_BIG_BPS : C.SPIKE_SMALL_BPS, mult));
  if (b.debt === 0) return raw;
  const floorMass = Math.ceil((b.debt * C.SPIKE_HF_FLOOR_BPS) / C.LT_BPS);
  return Math.max(0, Math.min(raw, b.mass - floorMass));
}

/** Apply a spike hit; shards scatter as food around the blob. Returns Micro lost. */
export function hitSpike(w: World, b: Blob, spikeId: number, big: boolean, tick: number): Micro {
  const damage = takeMass(b, spikeDamage(b, big));
  // Shards land outside the blob, or it would eat its own damage back the same tick.
  scatterFood(w, damage, b.x, b.y, radius(b.mass) + 40, radius(b.mass) + C.R.FOOD_RADIUS_PX + 12);
  w.pendingLog.push({ type: "SPIKE", tick, data: { blob: b.id, spike: spikeId, damage } });
  return damage;
}

/** One second outside the zone (4% of mass); goes to one food piece inside the zone. Returns Micro lost. */
export function zoneTick(w: World, b: Blob): Micro {
  const lost = takeMass(b, mulDivUp(b.mass, C.ZONE_DMG_BPS_PER_S, BPS));
  w.foodPool += lost;
  return lost;
}

export interface PopResult {
  debtRepaid: Micro;
  /** Debt the victim's mass could not cover: the vault's loss. 0 whenever the keeper ran in time. */
  badDebt: Micro;
  bounty: Micro;
  fee: Micro;
  scattered: Micro;
}

function closeBlob(b: Blob): void {
  b.mass = 0;
  b.debt = 0;
  b.boostFees = 0;
  b.payout = 0;
  b.cashout = null;
}

/** Liquidation waterfall: vault first, 8% bounty to popper (reserve on a keeper pop), 2% fee, rest scatters. */
export function liquidate(w: World, victim: Blob, popper: Blob | null, tick: number): PopResult {
  flushBoost(w, victim, tick);
  const debtRepaid = Math.min(victim.debt, victim.mass);
  let rest = victim.mass - debtRepaid;
  const bounty = Math.min(mulBps(victim.debt, C.BOUNTY_BPS), rest);
  rest -= bounty;
  const fee = Math.min(mulBps(victim.debt, C.LIQ_FEE_BPS), rest);
  const scattered = rest - fee;
  const badDebt = victim.debt - debtRepaid;
  w.vault.repaid += debtRepaid;
  w.vault.badDebt += badDebt;
  if (popper) popper.mass += bounty;
  else w.reserve += bounty;
  w.reserve += fee;
  scatterFood(w, scattered, victim.x, victim.y, radius(victim.mass));
  closeBlob(victim);
  victim.state = "popped";
  if (popper) {
    w.pendingLog.push({ type: "POP", tick, data: { by: popper.id, victim: victim.id, debtRepaid, badDebt, bounty, fee, scattered } });
  } else {
    w.pendingLog.push({ type: "KEEPER_POP", tick, data: { victim: victim.id, debtRepaid, badDebt, fee: fee + bounty, scattered } });
  }
  return { debtRepaid, badDebt, bounty, fee, scattered };
}

/** Ultra red (HF < 0.90) after any damage: the vault keeper closes the loan. The split, or null if safe. */
export function keeperCheck(w: World, b: Blob, tick: number): PopResult | null {
  if (b.state !== "alive" || b.debt === 0 || hfBps(b) >= C.HF_ULTRA_BPS) return null;
  return liquidate(w, b, null, tick);
}

/** True when a's mass is at least 1.15x b's (geometry is the caller's job). */
/** agar.io eat rule: the eater's radius is at least EAT_RADIUS_RATIO x the victim's (about 1.32x mass). */
export const outweighs = (a: Blob, b: Blob): boolean => radius(a.mass) >= C.R.EAT_RADIUS_RATIO * radius(b.mass);

/** A eats B: B's debt repaid first, A gets 70% of B's equity, 30% scatters. Returns Micro gained. */
export function eat(w: World, eater: Blob, victim: Blob, tick: number): Micro {
  flushBoost(w, victim, tick);
  const debtRepaid = Math.min(victim.debt, victim.mass);
  const eq = victim.mass - debtRepaid;
  const gained = mulBps(eq, C.EAT_TRANSFER_BPS);
  const scattered = eq - gained;
  const badDebt = victim.debt - debtRepaid;
  w.vault.repaid += debtRepaid;
  w.vault.badDebt += badDebt;
  eater.mass += gained;
  // The 30% must really scatter: outside the eater, or feeding a teammate would cost nothing.
  scatterFood(w, scattered, eater.x, eater.y, radius(victim.mass) + 40, radius(eater.mass) + C.R.FOOD_RADIUS_PX + 12);
  closeBlob(victim);
  victim.state = "popped";
  w.pendingLog.push({ type: "EAT", tick, data: { by: eater.id, victim: victim.id, debtRepaid, badDebt, gained, scattered } });
  return gained;
}

/** Leave with equity: debt auto-repaid from mass, the rest is paid out. Returns Micro paid. */
export function cashOut(w: World, b: Blob, tick: number): Micro {
  repayFromMass(w, b, b.debt, tick);
  // Unreachable while alive (keeper pops below HF 0.90), but never let a debt vanish silently.
  if (b.debt > 0) throw new Error(`cashOut with unpaid debt on ${b.id}`);
  const amount = b.mass;
  w.cashedOut += amount;
  closeBlob(b);
  b.payout = amount;
  b.state = "cashed";
  w.pendingLog.push({ type: "CASHOUT", tick, data: { blob: b.id, amount } });
  return amount;
}
