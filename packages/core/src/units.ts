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

/** floor(x * num / den) for ratios that are not bps (pro-rata splits). */
export function mulDiv(x: Micro, num: number, den: number): Micro {
  const p = x * num;
  if (!Number.isSafeInteger(p) || den <= 0) throw new Error(`mulDiv bad input: ${x} * ${num} / ${den}`);
  return Math.floor(p / den);
}

/** Display units (credits, mass) to Micro. */
export function toMicro(units: number): Micro {
  return assertMicro(Math.round(units * MICRO), "toMicro");
}

/** Micro to display units, for events and views only. */
export function toUnits(m: Micro): number {
  return m / MICRO;
}
