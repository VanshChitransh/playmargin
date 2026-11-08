// Personal spike warning (RULES.html: "Colour = what it would do to YOU right now").
// Uses only my own display numbers, so the client never needs raw money values.
import { R } from "@margin/core";

/** True if a spike hit now would leave this blob red (HF below 1.0). Units: display. */
export function spikeWouldRedden(equity: number, owe: number, big: boolean): boolean {
  if (owe <= 0) return false; // no debt = always green
  const mass = equity + owe;
  if (equity <= 0) return true;
  // ponytail: linear x1.0 to x1.5 over leverage 1 to cap; swap for the core damage fn once S1 exports it.
  const t = Math.min(1, Math.max(0, (mass / equity - 1) / (R.LEVERAGE_CAP - 1)));
  const mult = 1 + (R.SPIKE_LEVERAGE_MULT_MAX - 1) * t;
  const dmg = (big ? R.SPIKE_BIG_BASE : R.SPIKE_SMALL_BASE) * mult;
  return (mass * (1 - dmg) * R.LT) / owe < R.HF_RED;
}
