// Engine signatures everyone codes against from H1. Bodies land in C2 to C5 and move
// into their own files (world.ts, step.ts, invariant.ts, log.ts, settle.ts) as they do.
import type { LogEntry } from "./events";
import type { GameEventMsg, InputCmd } from "./protocol";
import type { Mode, PlayerSeed, SettleResult, World } from "./types";

/** Fresh world in WARMUP; seeded so the same inputs replay identically. */
export function newWorld(_seed: number, _mode: Mode, _players: PlayerSeed[]): World {
  throw new Error("TODO C3");
}

/** Advance one tick in place; inputs are keyed by blob id. */
export function step(_world: World, _inputs: Map<string, InputCmd>, _tick: number): GameEventMsg[] {
  throw new Error("TODO C3");
}

/** Throws if any Micro was created or destroyed. */
export function checkInvariant(_world: World): void {
  throw new Error("TODO C4");
}

/** Pure replay of the money events. */
export function settle(_log: LogEntry[]): SettleResult {
  throw new Error("TODO C5");
}

/** Returns the first seq whose hash does not match, or null if the chain is intact. */
export async function verifyChain(_events: LogEntry[]): Promise<number | null> {
  throw new Error("TODO C5");
}
