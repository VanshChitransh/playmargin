// Hash-chained match log. The log is the truth: settle(log) replays only these events,
// and changing any entry breaks every hash after it (verifyChain finds the first bad seq).
import type { Micro, Mode, PlayerSeed } from "./types";

export type LogEvent =
  | { type: "MATCH_START"; data: { matchId: string; seed: number; mode: Mode; ratePerMinBps: number; stakeBase?: number; rateFrom?: string; rulesVersion?: number } }
  | { type: "JOIN"; data: { player: PlayerSeed } }
  | { type: "CHARGE"; data: { blob: string; entry: Micro } }
  | { type: "BOOST"; data: { blob: string; borrowed: Micro; fee: Micro } }
  | { type: "REPAY"; data: { blob: string; amount: Micro } }
  | { type: "INTEREST"; data: { blob: string; amount: Micro; toFood: Micro; toVault: Micro; toReserve: Micro } }
  | { type: "SPIKE"; data: { blob: string; spike: number; damage: Micro } }
  | { type: "EAT"; data: { by: string; victim: string; debtRepaid: Micro; badDebt: Micro; gained: Micro; scattered: Micro } }
  | { type: "POP"; data: { by: string; victim: string; debtRepaid: Micro; badDebt: Micro; bounty: Micro; fee: Micro; scattered: Micro } }
  | { type: "KEEPER_POP"; data: { victim: string; debtRepaid: Micro; badDebt: Micro; fee: Micro; scattered: Micro } }
  | { type: "CASHOUT"; data: { blob: string; amount: Micro } }
  | { type: "MATCH_END"; data: { tick: number; finalMasses: Record<string, Micro>; dust: Micro; toVault: Micro; ranking: string[] } };

export type LogType = LogEvent["type"];

/** One chained entry: hash = sha256(canonical({seq, tick, type, data, prevHash})). */
export type LogEntry = LogEvent & {
  seq: number;
  tick: number;
  prevHash: string;
  hash: string;
};

/** prevHash of the first entry. */
export const GENESIS_HASH = "0".repeat(64);
