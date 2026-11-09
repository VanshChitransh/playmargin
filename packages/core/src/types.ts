// World and blob state, owned by the server and replayed by tests and the Verify page.
// Every money field is Micro (integer micro-units); positions and speeds are floats.
// Times are ticks, never wall-clock, so the same seed and inputs replay identically.
import type { LogEvent } from "./events";
import type { InputCmd } from "./protocol";

/** Integer micro-units (1 game unit = 1_000_000). Always a safe integer. */
export type Micro = number;

export type Phase = "WARMUP" | "COUNTDOWN" | "LIVE" | "ENDED";
export type Ring = "green" | "yellow" | "red";
export type BlobKind = "human" | "agent" | "drone";
export type Mode = "free" | "paid";

export interface Blob {
  id: string;
  kind: BlobKind;
  label: string;
  /** NEAR account for paid humans and agents; null for guests and drones. */
  accountId: string | null;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** Current velocity in px/s: it eases toward dir * speed, so blobs accelerate and glide (agar feel). */
  vx: number;
  vy: number;
  mass: Micro;
  debt: Micro;
  /** Borrow fees paid on the open loan; added back when sizing BOOST so fees never shrink your limit (RULES worked check: a full hold borrows 120). */
  boostFees: Micro;
  /** What this blob left with (cash-out or bell); 0 if popped or eaten. */
  payout: Micro;
  /** Borrowed during the current BOOST hold, not yet logged (its fee is charged when logged). */
  pendingBorrow: Micro;
  /** BOOST was held last tick (press detection for the burst and the minimum hold). */
  boostHeld: boolean;
  /** A press borrows at least BOOST_MIN_HOLD_S: held until this tick even if released sooner. */
  boostMinUntil: number;
  /** Extra px/s from the press burst, decaying with BOOST_BURST_TAU_S. */
  burst: number;
  /** Tick the next press burst is allowed (BOOST_BURST_COOLDOWN_S). */
  burstReadyAt: number;
  /** Tick the empty-tank sputter (slow ease down from boost speed) ends. */
  sputterUntil: number;
  /** Repaid during the current REPAY hold, not yet logged (flushRepay). */
  pendingRepay: Micro;
  /** REPAY was held last tick (press detection for the minimum hold). */
  repayHeld: boolean;
  /** Tick the BOOST speed ends: the tick after the last held tick that borrowed. */
  boostUntil: number;
  /** A REPAY press holds until this tick even if released sooner, so a tap pays a visible chunk. */
  repayMinUntil: number;
  shieldUntil: number;
  spikeImmuneUntil: number;
  /** Tick the blob turned red, for the 300 ms grace before a touch pops it. */
  redSince: number | null;
  /** Last tick a bigger blob or drone was in threat range (cash-out no-threat rule). */
  lastThreatAt: number;
  cashout: { startedAt: number } | null;
  state: "alive" | "cashed" | "popped";
  lastInput: InputCmd | null;
  /** Tick lastInput arrived; held inputs expire INPUT_EXPIRE_MS later (no stuck BOOST). */
  lastInputAt: number;
}

export interface Food {
  id: number;
  x: number;
  y: number;
  mass: Micro;
}

export interface Spike {
  id: number;
  x: number;
  y: number;
  big: boolean;
  /** Tick the spike reappears after being consumed; null while it is live. */
  respawnAt: number | null;
}

export interface Zone {
  cx: number;
  cy: number;
  r: number;
  /** Radius the zone is shrinking toward. */
  targetR: number;
}

export interface Vault {
  /** (LEVERAGE_CAP - 1) * pot, reserved at match start so every pip always works. */
  budget: Micro;
  lent: Micro;
  repaid: Micro;
  interest: Micro;
  /** Debt written off when a popped or eaten blob had less mass than debt (the vault's loss). */
  badDebt: Micro;
}

/** A log event as the engine emits it; the server chains and hashes these (log.ts). */
export type PendingLog = LogEvent & { tick: number };

export interface World {
  matchId: string;
  seed: number;
  /** Mulberry32 state, advanced only by core/rng. */
  rngState: number;
  tick: number;
  phase: Phase;
  /** Tick of GO (match time 0); -1 until the match starts. */
  goTick: number;
  mode: Mode;
  arena: { w: number; h: number };
  pot: Micro;
  vault: Vault;
  reserve: Micro;
  fees: Micro;
  /** Paid out to blobs that cashed out, kept for the conservation invariant. */
  cashedOut: Micro;
  /** One rate per match, fixed before it starts from vault utilisation. */
  ratePerMinBps: number;
  /** Paid rooms: the contract's entry stake in USDC base units (1 USDC = 1e6). The game itself is the
   *  same at any stake (an entry is always ENTRY_PAID_MICRO); only the Micro to USDC rate follows it. */
  stakeBase: number;
  blobs: Map<string, Blob>;
  food: Food[];
  /** Interest and zone food not yet big enough for a whole pellet: dropped one pellet at a time so
   *  the map never floods with crumbs. Part of the pot (invariant), paid out with the leftover. */
  foodPool: Micro;
  spikes: Spike[];
  zone: Zone;
  nextId: number;
  /** Events emitted since the server last drained them into the hash-chained log. */
  pendingLog: PendingLog[];
}

/** Who enters a match; mass is derived from the entry, never sent by a client. */
export interface PlayerSeed {
  id: string;
  kind: BlobKind;
  label: string;
  accountId: string | null;
}

/** What settle(log) returns; the contract and Verify page check the same numbers. */
export interface SettleResult {
  matchId: string;
  payouts: Array<{ id: string; accountId: string | null; amount: Micro }>;
  /** Principal the vault lent (maps to SettleArgs.lent). */
  lent: Micro;
  vaultRepaid: Micro;
  interestToVault: Micro;
  reserve: Micro;
  fees: Micro;
  head: string;
  seq: number;
  /** Paid rooms: entry stake in USDC base units from MATCH_START (absent = 1e6 = 1 USDC). */
  stakeBase?: number;
}
