// Wire protocol between client and server. Clients send intent (Command pattern),
// never positions or money; the server answers with display-only views and events.
import type { BlobKind, Mode, Phase, Ring } from "./types";

/** Client to server, at most 30/s. boost/repay/cashout are edge-triggered taps. */
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
