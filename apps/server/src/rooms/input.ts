// Trust boundary for client input. Anything malformed is dropped (never thrown), and each
// client gets at most INPUT_MAX_PER_S commands per second so a flood can't speed anyone up.
import type { InputCmd } from "@margin/core";

export const INPUT_MAX_PER_S = 30;

/** The command if every field is the right type and |dir| <= 1, else null. */
export function parseInput(msg: unknown): InputCmd | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  const { seq, dirX, dirY, boost, repay, cashout } = m;
  if (!Number.isSafeInteger(seq)) return null;
  if (typeof dirX !== "number" || typeof dirY !== "number") return null;
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY) || Math.hypot(dirX, dirY) > 1.0001) return null;
  if (typeof boost !== "boolean" || typeof repay !== "boolean" || typeof cashout !== "boolean") return null;
  return { seq: seq as number, dirX, dirY, boost, repay, cashout };
}

/** Fixed one-second window counter; returns false once the client is over the limit. */
export class RateLimit {
  private windowStart = 0;
  private count = 0;

  allow(nowMs: number): boolean {
    if (nowMs - this.windowStart >= 1000) {
      this.windowStart = nowMs;
      this.count = 0;
    }
    return ++this.count <= INPUT_MAX_PER_S;
  }
}
