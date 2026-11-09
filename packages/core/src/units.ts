// Integer money helpers. All mass, debt and credits are Micro; every percentage is bps.
// mulBps floors, so the caller always knows which side the dust is on (it goes to reserve).
import { MICRO } from "./constants";
import type { Micro } from "./types";

/** Throws unless x is a non-negative safe integer. */
export function assertMicro(x: number, what = "value"): Micro {
  if (!Number.isSafeInteger(x) || x < 0) throw new Error(`${what} is not Micro: ${x}`);
  return x;
}

/** floor(x * bps / 10_000), Micro in and out. */
export function mulBps(x: Micro, bps: number): Micro {
  const p = x * bps;
  if (!Number.isSafeInteger(p)) throw new Error(`mulBps overflow: ${x} * ${bps}`);
  return Math.floor(p / 10_000);
}

function checkArgs(x: number, num: number, den: number): void {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(num) || !Number.isSafeInteger(den) || x < 0 || num < 0 || den <= 0) {
    throw new Error(`mulDiv bad input: ${x} * ${num} / ${den}`);
  }
}

function toSafe(r: bigint): Micro {
  if (r > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`mulDiv result overflows: ${r}`);
  return Number(r);
}

/**
 * floor(x * num / den) for ratios that are not bps (pro-rata splits). Pro-rata products of two
 * Micro amounts pass 2^53 for big blobs (fees 9.6 x debt 958 units), so those go through BigInt.
 */
export function mulDiv(x: Micro, num: number, den: number): Micro {
  checkArgs(x, num, den);
  const p = x * num;
  if (Number.isSafeInteger(p)) return Math.floor(p / den);
  return toSafe((BigInt(x) * BigInt(num)) / BigInt(den));
}

/** ceil(x * num / den): for amounts the house collects, so rounding never favours the payer. */
export function mulDivUp(x: Micro, num: number, den: number): Micro {
  checkArgs(x, num, den);
  const p = x * num;
  if (Number.isSafeInteger(p) && Number.isSafeInteger(p + den)) return Math.floor((p + den - 1) / den);
  return toSafe((BigInt(x) * BigInt(num) + BigInt(den) - 1n) / BigInt(den));
}

/** Display units (credits, mass) to Micro. */
export function toMicro(units: number): Micro {
  return assertMicro(Math.round(units * MICRO), "toMicro");
}

/** Micro to display units, for events and views only. */
export function toUnits(m: Micro): number {
  return m / MICRO;
}
