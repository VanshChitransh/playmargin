// Ports the room depends on. Free and paid matches share all room code and differ
// only in which Settlement adapter they get; bots plug in behind Brain (Strategy).
import type { InputCmd } from "./protocol";
import type { Blob, Food, Micro, Mode, Phase, SettleResult, Spike, Zone } from "./types";

/** Reference to an on-chain transaction, for explorer links. */
export interface TxRef {
  network: "testnet" | "mainnet";
  hash: string;
}

export interface MatchOpen {
  matchId: string;
  mode: Mode;
  pot: Micro;
  vaultBudget: Micro;
  players: Array<{ id: string; accountId: string | null; entry: Micro; ticketId?: string }>;
}

export interface Settlement {
  /** Reserve the vault budget and lock entries before GO. */
  open(match: MatchOpen): Promise<void>;
  /** Pay out; returns null for credit matches (no chain tx). Idempotent by matchId. */
  settle(result: SettleResult, head: string): Promise<TxRef | null>;
}

/** Append-only credits ledger over node:sqlite (sync, so no Promise). */
export interface CreditsRepo {
  balance(userId: string): Micro;
  append(entry: { userId: string; delta: Micro; reason: string; matchId?: string }): void;
}

/** What a bot may see: its own blob plus everything within view. */
export interface AgentView {
  self: Readonly<Blob>;
  others: ReadonlyArray<Readonly<Blob>>;
  food: ReadonlyArray<Food>;
  spikes: ReadonlyArray<Spike>;
  zone: Readonly<Zone>;
  phase: Phase;
}

export interface Brain {
  decide(view: AgentView, tick: number): InputCmd;
}
