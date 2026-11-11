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
  /** Turbine while held: base pitch (Hz) and how far it rises as the tank empties (1.0 to 1.35). */
  ENGINE_HZ: 110,
  ENGINE_PITCH_EMPTY: 1.35,
  ENGINE_GAIN: 0.06,
  /** A soft coin tick every this much of the tank borrowed (a cash register counting the loan). */
  COIN_TICK_STEP: 0.1,

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

  // Camera (agar-numbers + feel spec 2.1). Zoom z = max(FLOOR, min(R0 / r, 1) ^ POW): no zoom-out
  // until full-BOOST size, so players see themselves grow.
  ZOOM_R0: 89,
  ZOOM_POW: 0.4,
  ZOOM_FLOOR: 0.6,
  /** Ease time constant for size zoom (about 0.3 s to settle). */
  ZOOM_TAU_S: 0.1,
  /** While boosting: extra zoom-out, eased in over ~180 ms and back over ~450 ms. */
  BOOST_ZOOM_OUT: 0.08,
  BOOST_ZOOM_IN_TAU_S: 0.06,
  BOOST_ZOOM_BACK_TAU_S: 0.15,
  /** Camera leads this many screen px in the heading while boosting. */
  BOOST_LEAD_PX: 60,
  /** One kick against the heading on press, in screen px; no shake while held. */
  BOOST_KICK_PX: 2,
  KICK_TAU_S: 0.05,

  // Borrowing visuals (feel spec 2.1)
  /** Gold sparks that stream INTO my blob from behind (borrowed money arriving), per trail tick. */
  SPARKS_PER_TICK: 2,
  SPARK_TTL_S: 0.3,
  /** Edge speed lines, started by the press: how many, how strong, and the fade on release. */
  SPEED_LINES: 16,
  SPEED_LINE_ALPHA: 0.25,
  SPEED_LINE_FADE_MS: 250,

  // Eating a pellet (agar-numbers: growth per pellet is tiny, so make it feel good)
  PICKUP_SQUASH: 0.04,
  PICKUP_SQUASH_MS: 90,
  /** Blip pitch spread (fraction either way) and the shortest gap between blips. */
  PICKUP_PITCH_JITTER: 0.08,
  PICKUP_MIN_GAP_MS: 50,
  /** Pellets fade in over this long when they appear. */
  PELLET_FADE_S: 0.4,

  // Fuel ring
  /** A refill eases in over this long, with a gold shimmer. */
  FUEL_REFILL_MS: 300,

  // REPAY (hold-to-repay)
  /** While REPAY is held, this many coins leave my blob for the owe badge every REPAY_STREAM_MS. */
  REPAY_STREAM_MS: 50,
  REPAY_STREAM_COINS: 2,
  /** PAID OFF stays over my blob this long, with a burst of this many coins. */
  PAID_OFF_MS: 1100,
  PAID_OFF_COINS: 12,
  /** A press shorter than this is a tap: it gets the quick chunk number instead of the counter. */
  REPAY_TAP_MS: 250,
  COIN_FLY_MS: 450,
  /** Coins on a single quick press (the server repays one chunk). */
  REPAY_COINS: 5,
  /** Repay tone: starts here and climbs an octave as the debt clears. */
  REPAY_HZ: 440,
  REPAY_GAIN: 0.06,

  // Red state (feel spec 2.2): heartbeat speeds up as the margin thins (health 1.0 to 0.9).
  BEAT_SLOW_MS: 900,
  BEAT_FAST_MS: 350,
  /** The "HOLD R" hint beside my blob, once per match. */
  TAP_HINT_MS: 2500,

  // Clutch save (feel spec 2.2): fired only on the server's clutchSave event, never predicted.
  /** Freeze my picture this long so the save lands (visual only; the sim never pauses). */
  SAVE_FREEZE_MS: 80,
  /** How long the red frame and heartbeat stay silenced after a save. */
  SAVE_CALM_MS: 1200,
  SAVE_SPARKS: 18,

  // Before GO, other blobs are ghosts: overlap must never read as contact.
  GHOST_ALPHA: 0.35,

  // Soft body (membrane.ts): agar cells flatten on the wall and wobble like jelly
  /** Rim length per outline point, and the point count bounds. */
  MEMBRANE_SPACING: 7,
  MEMBRANE_MIN_PTS: 40,
  MEMBRANE_MAX_PTS: 100,
  /** Spring toward the target, pull toward the neighbours' average, and damping (per second). */
  MEMBRANE_K: 260,
  MEMBRANE_NEIGHBOUR: 160,
  MEMBRANE_DAMP: 14,
  /** Longest step the springs take, so a background tab never explodes the jelly. */
  MEMBRANE_MAX_DT: 1 / 30,
  /** No point of the outline closer to the centre than this share of the radius. */
  MEMBRANE_MIN: 0.45,
  /** World units the outline keeps from the centre even flat on the wall (no zero-size slivers). */
  MEMBRANE_WALL_MIN: 2,
  /** Dent under a bigger blob: full up to this overlap (share of my diameter), gone by the next. */
  MEMBRANE_DENT_FULL: 0.25,
  MEMBRANE_DENT_GONE: 0.5,
  /** How far the dent follows the bigger blob's edge (1 = all the way). */
  MEMBRANE_DENT_DEPTH: 0.6,
  /** A sudden size jump (an eat, a hit) kicks the rim outward this much per world unit of change. */
  MEMBRANE_KICK: 6,
  /** Living outline (agar): smooth irregular lumps as a share of the radius, at rest and at full speed. */
  MEMBRANE_NOISE_REST: 0.035,
  MEMBRANE_NOISE_MOVE: 0.06,
  /** Smoothed speed (world units per frame) that counts as full speed for the noise. */
  MEMBRANE_NOISE_SPEED: 6,
  /** Wall molding: the clamp blends in over this share of the radius, so corners round off. */
  MEMBRANE_WALL_SOFT: 0.25,
  /** A pellet across the rim dents it in by up to this share of the radius. */
  MEMBRANE_PELLET_DENT: 0.04,
  /** One rim (agar): its width as a share of the radius. It carries the health state. */
  RIM_FRAC: 0.075,
  /** My blob reads by a soft drop shadow (offset as a share of r, ink alpha), never a ring. */
  ME_SHADOW_DY: 0.07,
  ME_SHADOW_ALPHA: 0.18,

  /** The dotted max-size outline shown only while BOOST is held. */
  PREVIEW_ALPHA: 0.25,
  /** Smallest blob name on screen, CSS px (agar keeps names readable on the smallest cell). */
  NAME_MIN_PX: 15,
  /** Smallest liquidator drone on screen (hex radius, CSS px): it must read at a glance. */
  DRONE_MIN_PX: 26,
  /** The drone's name, CSS px: bigger than a blob name, it is the one AI that liquidates you. */
  DRONE_NAME_PX: 20,
} as const;
