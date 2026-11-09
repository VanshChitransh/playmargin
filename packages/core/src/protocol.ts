// Wire protocol between client and server. Clients send intent (Command pattern),
// never positions or money; the server answers with display-only views and events.
import type { BlobKind, Mode, Phase, Ring } from "./types";

/** Client to server, at most 30/s. boost and repay are HELD state (send true every message while
 *  held, it expires after 250 ms; a press repays for at least 0.1 s), cashout is an edge-triggered tap. */
export interface InputCmd {
  seq: number;
  dirX: number;
  dirY: number;
  boost: boolean;
  repay: boolean;
  cashout: boolean;
}

export type JoinOpts =
  | { mode: "free"; guestKey: string; roomCode?: string }
  | { mode: "paid"; accountId: string; ticketId: string; roomCode?: string };

/** Loan cost shown in the lobby instead of a rate number. */
export type RateTier = "LOW" | "MED" | "HIGH";

/** Server to client, as they happen. Amounts are display units (Micro / 1e6), never raw Micro. */
export type GameEventMsg =
  | { type: "phase"; phase: Phase; tick: number }
  | { type: "lastCall"; tick: number }
  | { type: "boost"; blob: string; amount: number }
  | { type: "repay"; blob: string; amount: number }
  /** A REPAY hold was logged (release, payoff, or once a second while held): amount repaid since the last one. */
  /** Left red on a REPAY (server-confirmed). clutch: a bigger blob or a drone was within 300 px. */
  | { type: "clutchSave"; blob: string; clutch: boolean }
  | { type: "spikeHit"; blob: string; big: boolean; damage: number }
  | { type: "pop"; by: string | null; victim: string; bounty: number; keeper: boolean }
  | { type: "eat"; by: string; victim: string; gained: number }
  | { type: "cashoutStart"; blob: string }
  | { type: "cashoutCancel"; blob: string; reason: "contact" | "spike" | "threat" }
  | { type: "cashedOut"; blob: string; amount: number }
  | { type: "matchEnd"; tick: number };

/**
 * The only blob fields the client may read (Mapper: toSchema copies these).
 * Money appears only as display numbers.
 */
export interface BlobView {
  id: string;
  kind: BlobKind;
  label: string;
  x: number;
  y: number;
  radius: number;
  ring: Ring;
  /** BOOST capacity left, 0 to 1: the fuel ring. Always set by the engine; optional only until the
   *  server schema and client carry it (S2/S3, BOOST hold-to-nitro). */
  fuel?: number;
  /** Deprecated, for the old pip HUD: fuel in segments of BOOST_CHARGE_EQUITY (0 to BOOST_PIPS). */
  pips: number;
  /** Display units owed, for the "owe 40" badge. */
  owe: number;
  equity: number;
  shielded: boolean;
  cashingOut: boolean;
  state: "alive" | "cashed" | "popped";
}

/** A food piece as drawn; r comes from the same mass-to-radius curve as blobs. */
export interface FoodView {
  id: number;
  x: number;
  y: number;
  r: number;
}

/** A live spike. Size only; the red warning colour is personal, so the client computes it. */
export interface SpikeView {
  id: number;
  x: number;
  y: number;
  big: boolean;
  /** Radius in px, drawn and hit-tested the same (SPIKE_RADIUS_SMALL_PX / SPIKE_RADIUS_BIG_PX). */
  r: number;
}

export interface MatchView {
  mode: Mode;
  phase: Phase;
  tick: number;
  timeLeftS: number;
  rateTier: RateTier;
  zone: { cx: number; cy: number; r: number };
  /** Top LEADERBOARD_TOP blob ids by equity, refreshed LEADERBOARD_HZ. */
  leaderboard: string[];
}
