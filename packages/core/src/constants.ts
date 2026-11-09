// Every gameplay and economy number, copied verbatim from research/margin/RULES.html.
// Tune only here; constants.test.ts fails if this drifts from rules.snapshot.json.
// Derived integer forms below are what the engine actually uses (money is Micro + bps).

export const R = {
  "MATCH_S": 90,
  "PHASES_S": [
    30,
    60,
    90
  ],
  "TICK_HZ": 60,
  "SEND_HZ": 20,
  "MICRO_PER_UNIT": 1000000,
  "ENTRY_FREE": 100,
  "ENTRY_PAID_USDC": 1,
  "UNITS_PER_USDC": 100,
  "START_MASS_RATIO": 0.8,
  "FOOD_SEED_RATIO": 0.2,
  "FOOD_RADIUS_PX": 22,
  "FOOD_PELLET_UNITS": 0.5,
  "FOOD_ON_MAP_PER_PLAYER": 14,
  "ARENA_SIDE_PER_SQRT_PLAYER": 2600,
  "SPAWN_RING_MAX_PX": 1200,
  "PLAY_RADIUS_PX": 1800,
  "SPAWN_EDGE_MARGIN_PX": 300,
  "LT": 0.8,
  "HF_GREEN": 1.15,
  "HF_RED": 1.0,
  "HF_ULTRA": 0.9,
  "LEVERAGE_CAP": 2.5,
  "LEVERAGE_CAP_GOLD": 3.0,
  "BOOST_CHARGE_EQUITY": 0.5,
  "BOOST_PIPS": 3,
  "BOOST_PIPS_GOLD": 4,
  "BOOST_SPEED_MULT": 1.5,
  "BOOST_BURST_MULT": 0.4,
  "BOOST_BURST_TAU_S": 0.15,
  "BOOST_BURST_COOLDOWN_S": 0.8,
  "BOOST_EASE_BASE_S": 0.04,
  "BOOST_EASE_PER_RADIUS_PX_S": 0.0005,
  "BOOST_MIN_HOLD_S": 0.1,
  "BOOST_EMPTY_EASE_S": 0.1,
  "BOOST_EMPTY_SPUTTER_S": 0.3,
  "CLUTCH_RADIUS_PX": 300,
  "WALL_INSET_RADII": 0.85,
  "BASE_SPEED_PX_S": 480,
  "SPEED_REF_RADIUS_PX": 58,
  "SPEED_SIZE_EXP": 0.45,
  "EASE_BASE_S": 0.05,
  "EASE_PER_RADIUS_PX_S": 0.0005,
  "DRONE_EASE_S": 0.06,
  "DRONE_SPEED_MULT": 1.6,
  "CASHOUT_SPEED_MULT": 0.5,
  "FOOD_CLUSTER_SHARE": 0.6,
  "FOOD_CLUSTER_RADIUS_PX": 320,
  "SCATTER_PIECE_UNITS": 4,
  "SCATTER_MAX_PIECES": 6,
  "NITRO_RATE_EQUITY_PER_S": 1.0,
  "ROOM_VAULT_BUDGET": "(LEVERAGE_CAP - 1) * pot",
  "BORROW_FEE": 0.01,
  "BORROW_FEE_SPLIT": {
    "vault": 0.75,
    "reserve": 0.25
  },
  "RATE_PER_MIN": {
    "base": 0.06,
    "kink_util": 0.8,
    "at_kink": 0.15,
    "slope_above": 0.6
  },
  "INTEREST_ACCRUE_S": 1,
  "INTEREST_SPLIT": {
    "food": 0.8,
    "vault": 0.15,
    "reserve": 0.05
  },
  "REPAY_RATE_EQUITY_PER_S": 1.5,
  "REPAY_MIN_HOLD_S": 0.1,
  "RED_GRACE_MS": 150,
  "BOUNTY": 0.08,
  "LIQ_FEE": 0.02,
  "EAT_RADIUS_RATIO": 1.15,
  "EAT_TRANSFER": 0.7,
  "SPIKE_SMALL_BASE": 0.1,
  "SPIKE_BIG_BASE": 0.2,
  "SPIKE_LEVERAGE_MULT_MAX": 2.0,
  "SPIKE_BIG_SHARE": 0.5,
  "SPIKE_HF_FLOOR": 0.95,
  "SPIKES_PER_PLAYER": 1.5,
  "SPIKE_RADIUS_SMALL_PX": 48,
  "SPIKE_RADIUS_BIG_PX": 72,
  "SPIKE_MIN_SPACING_PX": 600,
  "SPIKE_CLEARANCE_PX": 120,
  "AGENT_NO_EAT_HUMAN_S": 30,
  "SPIKE_RESPAWN_S": 3,
  "SPIKE_IMMUNITY_S": 1,
  "ZONE_START_S": 60,
  "ZONE_START_S_DUEL": 40,
  "ZONE_FINAL_RADIUS": 0.25,
  "ZONE_DMG_PER_S": 0.04,
  "CASHOUT_OPEN_S": 45,
  "CASHOUT_CLOSE_S": 80,
  "CASHOUT_CHANNEL_S": 4,
  "CASHOUT_NO_THREAT_S": 2,
  "BOOST_LOCKOUT_S": 80,
  "LAST_CALL_S": 75,
  "WARMUP_S": 8,
  "COUNTDOWN_S": 3,
  "CHARGE_AT": "GO",
  "SHIELD_S": 5,
  "SHIELD_S_LATE_JOIN": 10,
  "SHIELD_S_PAID": 3,
  "LATE_JOIN_S": 15,
  "INPUT_EXPIRE_MS": 250,
  "LOBBY_WINDOW_S": 8,
  "ROOM_SIZE": 12,
  "LEADERBOARD_TOP": 5,
  "LEADERBOARD_HZ": 2,
  "PAID_MIN_HUMANS": 2,
  "PAID_WAIT_S": 20,
  "DRONES_PER_ROOM": "min(3, ceil(humans/3))",
  "COMMANDER_REPLAN_S": 15,
  "TICKET_REFUND_DEADLINE_MIN": 15,
  "DAILY_CREDIT_TOPUP_TO": 1000,
  "AD_CREDITS": 250,
  "ADS_PER_DAY": 5
} as const;

const bps = (x: number): number => Math.round(x * 10_000);
const ticks = (s: number): number => Math.round(s * R.TICK_HZ);

/** Engine timing. */
export const TICK_MS = 1000 / R.TICK_HZ;
export const MATCH_TICKS = ticks(R.MATCH_S);
export const sToTicks = ticks;

/** Money scaling: 1 game unit = MICRO_PER_UNIT Micro. */
export const MICRO = R.MICRO_PER_UNIT;
export const ENTRY_FREE_MICRO = R.ENTRY_FREE * MICRO;
export const ENTRY_PAID_MICRO = R.ENTRY_PAID_USDC * R.UNITS_PER_USDC * MICRO;

/** Ratios as basis points (10_000 = 100%). */
export const START_MASS_BPS = bps(R.START_MASS_RATIO);
export const FOOD_SEED_BPS = bps(R.FOOD_SEED_RATIO);
export const LT_BPS = bps(R.LT);
export const HF_GREEN_BPS = bps(R.HF_GREEN);
export const HF_RED_BPS = bps(R.HF_RED);
export const HF_ULTRA_BPS = bps(R.HF_ULTRA);
export const LEVERAGE_CAP_BPS = bps(R.LEVERAGE_CAP);
export const NITRO_RATE_BPS = bps(R.NITRO_RATE_EQUITY_PER_S);
export const BORROW_FEE_BPS = bps(R.BORROW_FEE);
export const BORROW_FEE_VAULT_BPS = bps(R.BORROW_FEE_SPLIT.vault);
export const RATE_BASE_BPS = bps(R.RATE_PER_MIN.base);
export const RATE_KINK_UTIL_BPS = bps(R.RATE_PER_MIN.kink_util);
export const RATE_AT_KINK_BPS = bps(R.RATE_PER_MIN.at_kink);
export const RATE_SLOPE_ABOVE_BPS = bps(R.RATE_PER_MIN.slope_above);
export const INTEREST_FOOD_BPS = bps(R.INTEREST_SPLIT.food);
export const INTEREST_VAULT_BPS = bps(R.INTEREST_SPLIT.vault);
export const REPAY_RATE_BPS = bps(R.REPAY_RATE_EQUITY_PER_S);
export const BOUNTY_BPS = bps(R.BOUNTY);
export const LIQ_FEE_BPS = bps(R.LIQ_FEE);
export const EAT_TRANSFER_BPS = bps(R.EAT_TRANSFER);
export const SPIKE_SMALL_BPS = bps(R.SPIKE_SMALL_BASE);
export const SPIKE_BIG_BPS = bps(R.SPIKE_BIG_BASE);
export const SPIKE_LEV_MULT_MAX_BPS = bps(R.SPIKE_LEVERAGE_MULT_MAX);
export const SPIKE_BIG_SHARE_BPS = bps(R.SPIKE_BIG_SHARE);
export const SPIKE_HF_FLOOR_BPS = bps(R.SPIKE_HF_FLOOR);
export const ZONE_DMG_BPS_PER_S = bps(R.ZONE_DMG_PER_S);
