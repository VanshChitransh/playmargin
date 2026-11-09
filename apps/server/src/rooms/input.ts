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

interface Pending {
  cmd: InputCmd;
  boost: boolean;
  repay: boolean;
  cashout: boolean;
}

/**
 * Commands that arrived since the last tick, one per player, rate-limited. Core's step() keeps
 * the last direction and expires it after INPUT_EXPIRE_MS, so a dropped player stops by itself.
 */
export class InputQueue {
  private pending = new Map<string, Pending>();
  private limits = new Map<string, RateLimit>();

  open(id: string): void {
    this.limits.set(id, new RateLimit());
  }

  /** Stop accepting input from this player and forget anything not yet applied. */
  close(id: string): void {
    this.limits.delete(id);
    this.pending.delete(id);
  }

  push(id: string, msg: unknown, nowMs: number): void {
    if (!this.limits.get(id)?.allow(nowMs)) return;
    const cmd = parseInput(msg);
    if (!cmd) return;
    const prev = this.pending.get(id);
    // BOOST is held state: the latest message wins (core's 250 ms expiry ends it if messages stop).
    // REPAY and cash out are taps: OR them until a tick consumes them, so none is lost between ticks.
    this.pending.set(id, {
      cmd,
      boost: cmd.boost,
      repay: cmd.repay || (prev?.repay ?? false),
      cashout: cmd.cashout || (prev?.cashout ?? false),
    });
  }

  /** Everything that arrived since the last call, taps merged; the queue is then empty. */
  take(): Map<string, InputCmd> {
    const out = new Map<string, InputCmd>();
    for (const [id, p] of this.pending) out.set(id, { ...p.cmd, boost: p.boost, repay: p.repay, cashout: p.cashout });
    this.pending.clear();
    return out;
  }
}
