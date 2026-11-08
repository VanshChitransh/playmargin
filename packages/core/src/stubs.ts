// Engine signatures still waiting for C5 (log.ts, settle.ts). newWorld, step and
// checkInvariant now live in world.ts, step.ts and invariant.ts.
import type { LogEntry } from "./events";
import type { SettleResult } from "./types";

/** Pure replay of the money events. */
export function settle(_log: LogEntry[]): SettleResult {
  throw new Error("TODO C5");
}

/** Returns the first seq whose hash does not match, or null if the chain is intact. */
export async function verifyChain(_events: LogEntry[]): Promise<number | null> {
  throw new Error("TODO C5");
}
