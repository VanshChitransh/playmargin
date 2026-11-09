// Every BOOST / REPAY / pop feel number in one place, so the feel spec can tune them without
// hunting through the renderer. Times are seconds unless named _MS; sizes are screen px at
// zoom 1 unless named _WORLD. Pure presentation: none of these change the game.
export const JUICE = {
  // BOOST (nitro)
  /** How often the gold "+N" ticks up while the loan grows. */
  NITRO_TICK_S: 0.3,
  /** Gap between ghost rings in the nitro trail. */
  NITRO_TRAIL_S: 0.05,
  /** How long one trail ring lives, and how strong it starts. */
  TRAIL_TTL_S: 0.35,
  TRAIL_ALPHA: 0.55,
  /** Warm-up practice inflate: grow and deflate rates (per second, eased). */
  INFLATE_GROW: 2.5,
  INFLATE_SHRINK: 6,
  /** Engine tone while held: start and top pitch (Hz), climb time, volume. */
  ENGINE_HZ_FROM: 90,
  ENGINE_HZ_TO: 260,
  ENGINE_CLIMB_S: 1.6,
  ENGINE_GAIN: 0.06,

  // Floating numbers (+N on BOOST, minus on REPAY, bounty)
  FLOAT_TTL_S: 0.9,
  FLOAT_RISE_PX_S: 90,
  FLOAT_FONT_PX: 30,

  // Pops
  /** Freeze on my own pop so it lands. */
  HIT_STOP_MS: 150,

  // Debt shell (feel spec 2.1): the borrowed part of MY blob drawn as a gold outer band.
  SHELL_COLOR: 0xf5b83d,
  SHELL_ALPHA: 0.6,
  /** Stretch along heading while boosting, eased in and out (fraction of size). */
  BOOST_STRETCH: 0.06,
  STRETCH_EASE: 12,
  /** REPAY squash: compress then spring back. */
  REPAY_SQUASH: 0.06,
  REPAY_SQUASH_MS: 120,

  // Red state (feel spec 2.2): heartbeat speeds up as the margin thins (health 1.0 to 0.9).
  BEAT_SLOW_MS: 900,
  BEAT_FAST_MS: 350,
  /** The "TAP R" hint beside my blob, once per match. */
  TAP_HINT_MS: 2500,

  // Before GO, other blobs are ghosts: overlap must never read as contact.
  GHOST_ALPHA: 0.35,
} as const;
