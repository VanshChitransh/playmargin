// HUD rules derived only from display numbers, so the HUD never needs raw money.
// Every threshold comes from RULES.html via core R; tests pin the player-facing behaviour.
import { MICRO, R, radius, type BlobView, type MatchView, type RateTier } from "@margin/core";

/** Seconds since GO, from the whole seconds left that the server sends. */
export const elapsedS = (m: MatchView): number => (m.phase === "LIVE" ? R.MATCH_S - m.timeLeftS : 0);

/** Grow / Hunt / Squeeze by elapsed seconds (RULES: PHASES_S). */
export function phaseName(elapsed: number): "GROW" | "HUNT" | "SQUEEZE" {
  return elapsed < R.PHASES_S[0] ? "GROW" : elapsed < R.PHASES_S[1] ? "HUNT" : "SQUEEZE";
}

/** True when a BOOST tap would be refused, so the pips go grey instead of lying. */
export function boostBlocked(me: BlobView, m: MatchView): boolean {
  return (
    m.phase !== "LIVE" ||
    me.state !== "alive" ||
    me.ring === "red" ||
    me.shielded ||
    fuelOf(me) <= 0.001 ||
    elapsedS(m) >= R.BOOST_LOCKOUT_S
  );
}

/** Cash-out button shows only inside its window and never while red. */
export function cashoutOpen(me: BlobView, m: MatchView): boolean {
  const e = elapsedS(m);
  return m.phase === "LIVE" && me.state === "alive" && me.ring !== "red" && e >= R.CASHOUT_OPEN_S && e < R.CASHOUT_CLOSE_S;
}

// Offline fallback only (live matches send ratePerMinBps): LOW = base, MED = at the kink,
// HIGH = kink plus half the steep slope.
const TIER_RATE_PER_MIN: Record<RateTier, number> = { LOW: 0.06, MED: 0.15, HIGH: 0.45 };

/** Interest drained from my mass per second, in display units; exact when the server sent the rate. */
export const interestPerS = (owe: number, tier: RateTier, rateBps?: number): number =>
  (owe * (rateBps !== undefined ? rateBps / 10_000 : TIER_RATE_PER_MIN[tier])) / 60;

/** Radii for the BOOST preview: after one tap, and after every lit pip (capped at 2.5x equity). */
/** Fuel 0..1 (S1 hold-to-nitro); falls back to the deprecated pips until the schema sends fuel. */
export function fuelOf(me: Pick<BlobView, "fuel" | "pips">): number {
  return Math.max(0, Math.min(1, me.fuel ?? me.pips / R.BOOST_PIPS));
}

/** Radii for the preview rings: my size after 1 s of nitro, and with every drop of fuel spent. */
export function boostPreview(me: BlobView): { next: number; max: number } | null {
  const f = fuelOf(me);
  if (f <= 0 || me.equity <= 0) return null;
  const mass = me.equity + me.owe;
  const cap = me.equity * R.LEVERAGE_CAP;
  const r = (units: number): number => radius(Math.round(Math.min(units, cap) * MICRO));
  return { next: r(mass + me.equity * R.NITRO_RATE_EQUITY_PER_S), max: r(cap) };
}

/** All non-popped, non-drone blobs (cashed ones keep their payout) ranked by equity, highest first (same order as the final ranking). */
export function ranking(blobs: BlobView[]): BlobView[] {
  return blobs.filter((b) => b.state !== "popped" && b.kind !== "drone").sort((a, b) => b.equity - a.equity);
}

/** conic-gradient for the pip ring: each pip is a 120 degree arc filled 0..1. */
/** One fuel ring as a conic gradient: lit arc for the fuel left, dim for the rest. */
export function fuelGradient(fuel: number, on: string, off: string): string {
  const deg = Math.round(Math.max(0, Math.min(1, fuel)) * 360);
  return `conic-gradient(${on} 0deg ${deg}deg, ${off} ${deg}deg 360deg)`;
}

const ROBOT = "\u{1F916}";

/** Agents always read "🤖 name" (disclosure rule), whether or not the server already added the emoji. */
export function displayName(b: Pick<BlobView, "kind" | "label">): string {
  if (b.kind !== "agent") return b.label;
  return `${ROBOT} ${b.label.replaceAll(ROBOT, "").trim()}`;
}
