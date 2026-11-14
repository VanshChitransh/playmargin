// HUD rules derived only from display numbers, so the HUD never needs raw money.
// Every threshold comes from RULES.html via core R; tests pin the player-facing behaviour.
import { MICRO, R, radius, type BlobView, type MatchView, type RateTier } from "@margin/core";

/** Seconds since GO, from the whole seconds left that the server sends. */
export const elapsedS = (m: MatchView): number => (m.phase === "LIVE" ? R.MATCH_S - m.timeLeftS : 0);

/** True when my living blob is outside the zone in a live match: the zone drains it every second. */
export function outsideZone(b: BlobView | undefined, m: MatchView): boolean {
  return !!b && b.state === "alive" && m.phase === "LIVE" && Math.hypot(b.x - m.zone.cx, b.y - m.zone.cy) > m.zone.r;
}

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

/** Why BOOST is grey, in a few words (null when it works, or in warm-up where it is free practice). */
export function boostReason(me: BlobView, m: MatchView): string | null {
  if (m.phase !== "LIVE" || me.state !== "alive") return null;
  const e = elapsedS(m);
  if (e >= R.BOOST_LOCKOUT_S) return "Loans closed";
  if (me.ring === "red") return "Red: hold R";
  // The GO shield is the same for everyone; a late joiner's longer one has no countdown to show.
  if (me.shielded) return e < R.SHIELD_S ? `BOOST in ${Math.ceil(R.SHIELD_S - e)} s` : "Shield on";
  if (fuelOf(me) <= 0.001) return "Tank empty";
  return null;
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
  // Sort on the rounded number the row shows, ties by id: near-equal blobs no longer swap
  // places every refresh, and the rank always matches the visible order.
  return blobs
    .filter((b) => b.state !== "popped" && b.kind !== "drone")
    .sort((a, b) => Math.round(b.equity) - Math.round(a.equity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** conic-gradient for the pip ring: each pip is a 120 degree arc filled 0..1. */
/** One fuel ring as a conic gradient: lit arc for the fuel left, dim for the rest. */
/**
 * The fuel ring as a conic gradient, drawn in `segments` arcs with small gaps (each segment is
 * 0.5x equity of loan, feel spec 2.1). Drains clockwise.
 */
export function fuelGradient(fuel: number, on: string, off: string, segments = 3, gapDeg = 8): string {
  const lit = Math.max(0, Math.min(1, fuel)) * 360;
  const seg = 360 / segments;
  const stops: string[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = i * seg + gapDeg / 2;
    const a1 = (i + 1) * seg - gapDeg / 2;
    const mid = Math.max(a0, Math.min(a1, lit));
    stops.push(`transparent ${i * seg}deg ${a0}deg`, `${on} ${a0}deg ${mid}deg`, `${off} ${mid}deg ${a1}deg`, `transparent ${a1}deg ${(i + 1) * seg}deg`);
  }
  return `conic-gradient(${stops.join(", ")})`;
}

const ROBOT = "\u{1F916}";

/** Agents always read "🤖 name" (disclosure rule), whether or not the server already added the emoji. */
export function displayName(b: Pick<BlobView, "kind" | "label">): string {
  if (b.kind !== "agent") return b.label;
  return `${ROBOT} ${b.label.replaceAll(ROBOT, "").trim()}`;
}
